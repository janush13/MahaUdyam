import { BadRequestException, Injectable } from '@nestjs/common';
import { Enterprise } from '@prisma/client';
import { ErrorCodes } from '../../common/constants/error-codes.constant';
import { AuditActions } from '../../infrastructure/audit/audit-actions.constant';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  higherScope,
  isAuthorisationLive,
} from './constants/representative-scope.constant';
import { CreateEnterpriseDto } from './dto/create-enterprise.dto';
import { EnterpriseResponseDto } from './dto/enterprise-response.dto';
import { UpdateEnterpriseDto } from './dto/update-enterprise.dto';
import { EnterpriseAccess } from './interfaces/enterprise-access.interface';

/** The profile fields an owner may edit. Ownership and the reference
 * number are absent on purpose — they are never client-writable. */
const EDITABLE_FIELDS = [
  'name',
  'businessType',
  'registrationNumber',
  'registrationNumberType',
  'address',
  'sector',
  'tradeName',
  'website',
  'contactPersonName',
  'contactPersonMobile',
] as const;

const APPLICANT_ROLE = 'APPLICANT';

export function toEnterpriseResponse(
  enterprise: Enterprise,
  access: Pick<EnterpriseAccess, 'relation' | 'scope'>,
): EnterpriseResponseDto {
  return {
    id: enterprise.id,
    referenceNumber: enterprise.referenceNumber,
    name: enterprise.name,
    tradeName: enterprise.tradeName,
    businessType: enterprise.businessType,
    registrationNumber: enterprise.registrationNumber,
    registrationNumberType: enterprise.registrationNumberType,
    sector: enterprise.sector,
    address: enterprise.address,
    website: enterprise.website,
    contactPersonName: enterprise.contactPersonName,
    contactPersonMobile: enterprise.contactPersonMobile,
    createdAt: enterprise.createdAt,
    updatedAt: enterprise.updatedAt,
    accessType: access.relation,
    ...(access.relation === 'REPRESENTATIVE' && access.scope
      ? { representativeScope: access.scope }
      : {}),
  };
}

/**
 * Enterprise CRUD (Blueprint §13.2). Authorisation is NOT decided here —
 * routes are protected by EnterpriseAccessGuard, which resolves the caller's
 * relationship before these methods run; this service only receives an
 * already-authorised `access`. Ownership is set exclusively from the
 * authenticated user, never from the request body.
 */
@Injectable()
export class EnterprisesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(
    ownerUserId: string,
    dto: CreateEnterpriseDto,
    ipAddress: string,
  ): Promise<EnterpriseResponseDto> {
    const enterprise = await this.prisma.enterprise.create({
      data: {
        name: dto.name,
        businessType: dto.businessType,
        registrationNumber: dto.registrationNumber,
        registrationNumberType: dto.registrationNumberType,
        address: dto.address,
        sector: dto.sector,
        tradeName: dto.tradeName ?? null,
        website: dto.website ?? null,
        contactPersonName: dto.contactPersonName ?? null,
        contactPersonMobile: dto.contactPersonMobile ?? null,
        ownerUserId,
      },
    });

    await this.audit.record({
      userId: ownerUserId,
      roleAtTime: APPLICANT_ROLE,
      action: AuditActions.ENTERPRISE_CREATED,
      entityType: 'Enterprise',
      entityId: enterprise.id,
      afterState: {
        referenceNumber: enterprise.referenceNumber,
        name: enterprise.name,
        businessType: enterprise.businessType,
        sector: enterprise.sector,
      },
      ipAddress,
    });

    return toEnterpriseResponse(enterprise, { relation: 'OWNER' });
  }

  /** Enterprises the caller owns, plus those where they hold a live
   * (ACTIVE, unexpired) representative authorisation. PENDING, REVOKED and
   * expired authorisations grant no visibility. */
  async listForUser(userId: string): Promise<EnterpriseResponseDto[]> {
    const [owned, authorisations] = await Promise.all([
      this.prisma.enterprise.findMany({
        where: { ownerUserId: userId },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.enterpriseRepresentative.findMany({
        where: { representativeUserId: userId, status: 'ACTIVE' },
        include: { enterprise: true },
      }),
    ]);

    const items: EnterpriseResponseDto[] = owned.map((enterprise) =>
      toEnterpriseResponse(enterprise, { relation: 'OWNER' }),
    );

    const byEnterprise = new Map<
      string,
      { enterprise: Enterprise; scope: EnterpriseAccess['scope'] }
    >();
    for (const authorisation of authorisations) {
      if (!isAuthorisationLive(authorisation)) {
        continue;
      }
      const existing = byEnterprise.get(authorisation.enterpriseId);
      byEnterprise.set(authorisation.enterpriseId, {
        enterprise: authorisation.enterprise,
        scope: existing?.scope
          ? higherScope(existing.scope, authorisation.scope)
          : authorisation.scope,
      });
    }
    for (const { enterprise, scope } of byEnterprise.values()) {
      items.push(
        toEnterpriseResponse(enterprise, { relation: 'REPRESENTATIVE', scope }),
      );
    }

    return items;
  }

  async update(
    access: EnterpriseAccess,
    actorUserId: string,
    dto: UpdateEnterpriseDto,
    ipAddress: string,
  ): Promise<EnterpriseResponseDto> {
    const before = access.enterprise;

    const changes: Record<string, unknown> = {};
    const previous: Record<string, unknown> = {};
    let anyFieldProvided = false;
    for (const field of EDITABLE_FIELDS) {
      const next = dto[field];
      if (next === undefined) {
        continue;
      }
      anyFieldProvided = true;
      if (next !== before[field]) {
        changes[field] = next;
        previous[field] = before[field];
      }
    }

    if (!anyFieldProvided) {
      throw new BadRequestException({
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'At least one field to update must be provided.',
      });
    }

    // Nothing actually differs: succeed without a write or an audit entry.
    if (Object.keys(changes).length === 0) {
      return toEnterpriseResponse(before, access);
    }

    const updated = await this.prisma.enterprise.update({
      where: { id: before.id },
      data: changes,
    });

    await this.audit.record({
      userId: actorUserId,
      roleAtTime: APPLICANT_ROLE,
      action: AuditActions.ENTERPRISE_UPDATED,
      entityType: 'Enterprise',
      entityId: before.id,
      beforeState: previous,
      afterState: changes,
      ipAddress,
    });

    return toEnterpriseResponse(updated, access);
  }
}
