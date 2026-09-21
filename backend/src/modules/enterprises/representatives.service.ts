import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EnterpriseRepresentative, Prisma } from '@prisma/client';
import { ErrorCodes } from '../../common/constants/error-codes.constant';
import { AuditActions } from '../../infrastructure/audit/audit-actions.constant';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { UsersService } from '../users/users.service';
import {
  isExpired,
  isWidening,
} from './constants/representative-scope.constant';
import { NotificationEventsService } from '../notifications/notification-events.service';
import { AuthoriseRepresentativeDto } from './dto/authorise-representative.dto';
import {
  MyAuthorisationResponseDto,
  RepresentativeResponseDto,
} from './dto/representative-response.dto';
import { UpdateRepresentativeDto } from './dto/update-representative.dto';
import { EnterpriseAccess } from './interfaces/enterprise-access.interface';

const APPLICANT_ROLE = 'APPLICANT';

type WithRepresentativeName = EnterpriseRepresentative & {
  representative: { name: string };
};
type WithEnterpriseSummary = EnterpriseRepresentative & {
  enterprise: { id: string; name: string; referenceNumber: string };
};

function toRepresentativeResponse(
  record: WithRepresentativeName,
): RepresentativeResponseDto {
  return {
    id: record.id,
    enterpriseId: record.enterpriseId,
    representativeName: record.representative.name,
    scope: record.scope,
    scopedProjectIds: record.scopedProjectIds,
    status: record.status,
    isExpired: isExpired(record),
    authorisedAt: record.authorisedAt,
    expiresAt: record.expiresAt,
    revokedAt: record.revokedAt,
    createdAt: record.createdAt,
  };
}

function toMyAuthorisationResponse(
  record: WithEnterpriseSummary,
): MyAuthorisationResponseDto {
  return {
    id: record.id,
    enterprise: {
      id: record.enterprise.id,
      name: record.enterprise.name,
      referenceNumber: record.enterprise.referenceNumber,
    },
    scope: record.scope,
    scopedProjectIds: record.scopedProjectIds,
    status: record.status,
    isExpired: isExpired(record),
    authorisedAt: record.authorisedAt,
    expiresAt: record.expiresAt,
    createdAt: record.createdAt,
  };
}

/** Non-secret snapshot of an authorisation for audit before/after state. */
function snapshot(record: EnterpriseRepresentative): Prisma.InputJsonObject {
  return {
    enterpriseId: record.enterpriseId,
    representativeUserId: record.representativeUserId,
    scope: record.scope,
    scopedProjectIds: record.scopedProjectIds,
    status: record.status,
    expiresAt: record.expiresAt?.toISOString() ?? null,
  };
}

/**
 * Representative authorisation lifecycle (FRD §20):
 *
 *   owner grants  -> PENDING   (no access yet)
 *   rep accepts   -> ACTIVE    (two-sided consent; access starts)
 *   owner revokes -> REVOKED   (immediate, permanent; a new grant is a new record)
 *   expiresAt passing ends access without any state change.
 *
 * Only the enterprise owner can grant, change or revoke — enforced by the
 * route guards before these methods run (OWNER level is unreachable for any
 * representative, so a representative can never escalate their own scope or
 * authorise anyone else). Only the named representative can accept.
 */
@Injectable()
export class RepresentativesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly users: UsersService,
    private readonly notifications: NotificationEventsService,
  ) {}

  async authorise(
    access: EnterpriseAccess,
    ownerUserId: string,
    dto: AuthoriseRepresentativeDto,
    ipAddress: string,
  ): Promise<RepresentativeResponseDto> {
    const enterpriseId = access.enterprise.id;
    this.assertFutureExpiry(dto.expiresAt);

    const target = await this.users.findByEmailOrMobile(dto.emailOrMobile);
    if (!target || !target.isActive) {
      throw new NotFoundException({
        code: ErrorCodes.REPRESENTATIVE_USER_NOT_FOUND,
        message: 'No registered user matches that email or mobile number.',
      });
    }
    if (target.id === ownerUserId) {
      throw new BadRequestException({
        code: ErrorCodes.CANNOT_AUTHORISE_SELF,
        message: 'You already have full access to your own enterprise.',
      });
    }

    const projectIds = dto.projectIds ?? [];
    await this.assertProjectsBelongToEnterprise(enterpriseId, projectIds);

    const created = await this.prisma.$transaction(async (tx) => {
      // Serialise concurrent grants for the same pair so the "one live
      // authorisation per representative" rule holds without a partial
      // unique index (which Prisma cannot express without drift).
      // $executeRaw, not $queryRaw: the function returns `void`, which
      // Prisma cannot deserialise as a query result column.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${enterpriseId}:${target.id}`}, 0))`;

      const now = new Date();
      const existing = await tx.enterpriseRepresentative.findFirst({
        where: {
          enterpriseId,
          representativeUserId: target.id,
          status: { in: ['PENDING', 'ACTIVE'] },
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
        select: { id: true },
      });
      if (existing) {
        throw new ConflictException({
          code: ErrorCodes.REPRESENTATIVE_ALREADY_AUTHORISED,
          message:
            'This user already has a pending or active authorisation for the enterprise. Change or revoke it instead.',
        });
      }

      return tx.enterpriseRepresentative.create({
        data: {
          enterpriseId,
          representativeUserId: target.id,
          scope: dto.scope,
          scopedProjectIds: projectIds,
          expiresAt: dto.expiresAt ?? null,
          // status defaults to PENDING: never granted directly as ACTIVE.
        },
        include: { representative: { select: { name: true } } },
      });
    });

    await this.audit.record({
      userId: ownerUserId,
      roleAtTime: APPLICANT_ROLE,
      action: AuditActions.REPRESENTATIVE_AUTHORISED,
      entityType: 'EnterpriseRepresentative',
      entityId: created.id,
      afterState: snapshot(created),
      ipAddress,
    });
    // FRD 20.2: the representative is told of the offer (no access yet).
    await this.notifications.representativeAuthorisationRequested(
      created.id,
      created.createdAt,
    );

    return toRepresentativeResponse(created);
  }

  async list(enterpriseId: string): Promise<RepresentativeResponseDto[]> {
    const records = await this.prisma.enterpriseRepresentative.findMany({
      where: { enterpriseId },
      include: { representative: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return records.map(toRepresentativeResponse);
  }

  async update(
    access: EnterpriseAccess,
    authorisationId: string,
    ownerUserId: string,
    dto: UpdateRepresentativeDto,
    ipAddress: string,
  ): Promise<RepresentativeResponseDto> {
    const enterpriseId = access.enterprise.id;
    const record = await this.findInEnterprise(enterpriseId, authorisationId);

    if (record.status === 'REVOKED') {
      throw this.revokedError();
    }
    if (
      dto.scope === undefined &&
      dto.projectIds === undefined &&
      dto.expiresAt === undefined
    ) {
      throw new BadRequestException({
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'At least one field to update must be provided.',
      });
    }
    if (dto.expiresAt) {
      this.assertFutureExpiry(dto.expiresAt);
    }
    if (dto.projectIds) {
      await this.assertProjectsBelongToEnterprise(enterpriseId, dto.projectIds);
    }

    const next = {
      scope: dto.scope ?? record.scope,
      scopedProjectIds: dto.projectIds ?? record.scopedProjectIds,
      expiresAt: dto.expiresAt === undefined ? record.expiresAt : dto.expiresAt,
    };

    const unchanged =
      next.scope === record.scope &&
      next.scopedProjectIds.length === record.scopedProjectIds.length &&
      next.scopedProjectIds.every((id) =>
        record.scopedProjectIds.includes(id),
      ) &&
      next.expiresAt?.getTime() === record.expiresAt?.getTime();
    if (unchanged) {
      return this.reload(record.id);
    }

    // Widening what an ALREADY-ACCEPTED authorisation covers requires the
    // representative to accept again; otherwise the owner could grant a
    // narrow scope, get consent, then silently upgrade it (FRD §20.2).
    const needsReAcceptance =
      record.status === 'ACTIVE' && isWidening(record, next);

    const result = await this.prisma.enterpriseRepresentative.updateMany({
      // Never modify a record that was revoked in the meantime.
      where: { id: record.id, status: { not: 'REVOKED' } },
      data: {
        scope: next.scope,
        scopedProjectIds: next.scopedProjectIds,
        expiresAt: next.expiresAt,
        ...(needsReAcceptance ? { status: 'PENDING', authorisedAt: null } : {}),
      },
    });
    if (result.count === 0) {
      throw this.revokedError();
    }

    const updated = await this.reload(record.id);
    await this.audit.record({
      userId: ownerUserId,
      roleAtTime: APPLICANT_ROLE,
      action: AuditActions.REPRESENTATIVE_AUTHORISATION_UPDATED,
      entityType: 'EnterpriseRepresentative',
      entityId: record.id,
      beforeState: snapshot(record),
      afterState: {
        ...snapshot({ ...record, ...next, status: updated.status }),
        requiresReAcceptance: needsReAcceptance,
      },
      ipAddress,
    });
    // A widened authorisation needs fresh consent (FRD 20.2): tell them again.
    if (needsReAcceptance) {
      await this.notifications.representativeAuthorisationRequested(
        record.id,
        new Date(),
      );
    }

    return updated;
  }

  /** Idempotent: revoking an already-revoked authorisation succeeds and
   * writes no second audit entry. Effective immediately — access checks read
   * the status on every request. */
  async revoke(
    access: EnterpriseAccess,
    authorisationId: string,
    ownerUserId: string,
    ipAddress: string,
  ): Promise<RepresentativeResponseDto> {
    const record = await this.findInEnterprise(
      access.enterprise.id,
      authorisationId,
    );

    const result = await this.prisma.enterpriseRepresentative.updateMany({
      where: { id: record.id, status: { not: 'REVOKED' } },
      data: { status: 'REVOKED', revokedAt: new Date() },
    });

    if (result.count === 1) {
      await this.audit.record({
        userId: ownerUserId,
        roleAtTime: APPLICANT_ROLE,
        action: AuditActions.REPRESENTATIVE_AUTHORISATION_REVOKED,
        entityType: 'EnterpriseRepresentative',
        entityId: record.id,
        beforeState: snapshot(record),
        afterState: snapshot({ ...record, status: 'REVOKED' }),
        ipAddress,
      });
    }

    return this.reload(record.id);
  }

  /** Authorisations offered to (or held by) the caller, so a PENDING one can
   * be seen and accepted. REVOKED ones are not listed. */
  async listMine(userId: string): Promise<MyAuthorisationResponseDto[]> {
    const records = await this.prisma.enterpriseRepresentative.findMany({
      where: {
        representativeUserId: userId,
        status: { in: ['PENDING', 'ACTIVE'] },
      },
      include: {
        enterprise: { select: { id: true, name: true, referenceNumber: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return records.map(toMyAuthorisationResponse);
  }

  /** The representative's consent (FRD §20.2). Takes no body — there is
   * nothing the representative can choose or alter, so acceptance can never
   * be used to change scope. Only the named representative can accept; anyone
   * else gets NOT_FOUND. */
  async accept(
    userId: string,
    authorisationId: string,
    ipAddress: string,
  ): Promise<MyAuthorisationResponseDto> {
    const record = await this.prisma.enterpriseRepresentative.findFirst({
      where: { id: authorisationId, representativeUserId: userId },
    });
    if (!record) {
      throw this.authorisationNotFound();
    }
    this.assertAcceptable(record);

    const now = new Date();
    const claimed = await this.prisma.enterpriseRepresentative.updateMany({
      where: {
        id: record.id,
        representativeUserId: userId,
        status: 'PENDING',
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      data: { status: 'ACTIVE', authorisedAt: now },
    });
    if (claimed.count === 0) {
      // Lost a race (revoked / accepted / expired in between): report why.
      const current = await this.prisma.enterpriseRepresentative.findUnique({
        where: { id: record.id },
      });
      if (current) {
        this.assertAcceptable(current);
      }
      throw new ConflictException({
        code: ErrorCodes.CONFLICT,
        message: 'This authorisation can no longer be accepted.',
      });
    }

    const accepted =
      await this.prisma.enterpriseRepresentative.findUniqueOrThrow({
        where: { id: record.id },
        include: {
          enterprise: {
            select: { id: true, name: true, referenceNumber: true },
          },
        },
      });

    await this.audit.record({
      userId,
      roleAtTime: APPLICANT_ROLE,
      action: AuditActions.REPRESENTATIVE_AUTHORISATION_ACCEPTED,
      entityType: 'EnterpriseRepresentative',
      entityId: record.id,
      beforeState: snapshot(record),
      afterState: snapshot(accepted),
      ipAddress,
    });

    return toMyAuthorisationResponse(accepted);
  }

  // ---- helpers ---------------------------------------------------------

  private assertAcceptable(record: EnterpriseRepresentative): void {
    if (record.status === 'REVOKED') {
      throw this.revokedError();
    }
    if (record.status === 'ACTIVE') {
      throw new ConflictException({
        code: ErrorCodes.AUTHORISATION_ALREADY_ACTIVE,
        message: 'This authorisation has already been accepted.',
      });
    }
    if (isExpired(record)) {
      throw new ConflictException({
        code: ErrorCodes.AUTHORISATION_EXPIRED,
        message:
          'This authorisation has expired and can no longer be accepted.',
      });
    }
  }

  private assertFutureExpiry(expiresAt: Date | null | undefined): void {
    if (expiresAt && expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException({
        code: ErrorCodes.INVALID_EXPIRY,
        message: 'expiresAt must be in the future.',
      });
    }
  }

  private async assertProjectsBelongToEnterprise(
    enterpriseId: string,
    projectIds: string[],
  ): Promise<void> {
    if (projectIds.length === 0) {
      return;
    }
    const found = await this.prisma.project.count({
      where: { enterpriseId, id: { in: projectIds } },
    });
    if (found !== projectIds.length) {
      throw new BadRequestException({
        code: ErrorCodes.INVALID_PROJECT_SCOPE,
        message: 'Every projectId must be a project of this enterprise.',
      });
    }
  }

  /** Scoped to the enterprise so an id from another enterprise is
   * indistinguishable from a nonexistent one. */
  private async findInEnterprise(
    enterpriseId: string,
    authorisationId: string,
  ): Promise<EnterpriseRepresentative> {
    const record = await this.prisma.enterpriseRepresentative.findFirst({
      where: { id: authorisationId, enterpriseId },
    });
    if (!record) {
      throw this.authorisationNotFound();
    }
    return record;
  }

  private reload(id: string): Promise<RepresentativeResponseDto> {
    return this.prisma.enterpriseRepresentative
      .findUniqueOrThrow({
        where: { id },
        include: { representative: { select: { name: true } } },
      })
      .then(toRepresentativeResponse);
  }

  private authorisationNotFound(): NotFoundException {
    return new NotFoundException({
      code: ErrorCodes.NOT_FOUND,
      message: 'Authorisation not found.',
    });
  }

  private revokedError(): ConflictException {
    return new ConflictException({
      code: ErrorCodes.AUTHORISATION_REVOKED,
      message: 'This authorisation has been revoked.',
    });
  }
}
