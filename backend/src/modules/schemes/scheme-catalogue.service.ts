import { isDeepStrictEqual } from 'node:util';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { isUUID } from 'class-validator';
import { ErrorCodes } from '../../common/constants/error-codes.constant';
import {
  AuditAction,
  AuditActions,
} from '../../infrastructure/audit/audit-actions.constant';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { validateCondition } from '../discovery/engine/rule-condition';
import {
  AddSchemeRuleDto,
  CreateSchemeDocumentRequirementDto,
  CreateSchemeDto,
  ListSchemesAdminQueryDto,
  SetSchemeActiveDto,
  UpdateSchemeDocumentRequirementDto,
  UpdateSchemeDto,
} from './dto/scheme-request.dto';
import {
  SchemeAdminDto,
  SchemeAdminListDto,
  SchemeCapabilitiesDto,
  SchemeDocumentRequirementDto,
  SchemeRuleDto,
} from './dto/scheme-response.dto';
import { SchemeAccessService, SchemeActor } from './scheme-access.service';
import {
  SCHEME_ADMIN_INCLUDE,
  SchemeAdminRow,
  schemeAuditState,
  toRequirementDto,
  toRuleDto,
  toSchemeAdminDto,
} from './scheme.mappers';

const notFound = (what: string) =>
  new NotFoundException({
    code: ErrorCodes.NOT_FOUND,
    message: `${what} not found.`,
  });

function invalid(field: string, message: string): BadRequestException {
  return new BadRequestException({
    code: ErrorCodes.VALIDATION_ERROR,
    message: 'Validation failed',
    fields: { [field]: [message] },
  });
}

const notEditable = () =>
  new ConflictException({
    code: ErrorCodes.SCHEME_NOT_EDITABLE,
    message:
      'A published scheme cannot be changed. Return it to draft first; it is published again once it has been approved for publication.',
  });

const asDate = (value: string | null | undefined): Date | null =>
  value === undefined || value === null ? null : new Date(value);

/**
 * Maintaining the scheme catalogue (FRD 4.7 / 34, TRD 15, Blueprint 12.7).
 *
 *  - The Scheme Officer of a department DRAFTS entries, their eligibility rule
 *    versions and their required documents. Nothing is seeded and nothing is
 *    defaulted: every name, benefit, criterion, threshold and deadline is the
 *    department's own.
 *  - PUBLISHING is a separate act (FRD 34 "subject to a publish/approval
 *    step"), by a role the deployment names (SCHEME_PUBLISHER_ROLES - FRD register
 *    item 10 is TO BE VALIDATED). Only a PUBLISHED, active scheme is visible to
 *    applicants or evaluated for recommendations.
 *  - A published scheme is FROZEN - content, rules, requirements (also enforced
 *    by database triggers). To revise it, it returns to DRAFT (hidden), is
 *    edited, and is published again. Applications already made keep the
 *    catalogue entry they were made on (their own snapshot).
 *  - Every change is audited with actor, role and before / after state.
 *
 * Authorisation is department-scoped and derived from the scheme itself (see
 * SchemeAccessService); nothing is trusted from the client.
 */
@Injectable()
export class SchemeCatalogueService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: SchemeAccessService,
  ) {}

  // ---- read -------------------------------------------------------------------

  async list(
    userId: string,
    query: ListSchemesAdminQueryDto,
  ): Promise<SchemeAdminListDto> {
    const visible = await this.access.visibleWhere(userId);
    const rows = await this.prisma.scheme.findMany({
      where: {
        AND: [
          visible,
          query.publishStatus ? { publishStatus: query.publishStatus } : {},
          query.departmentId ? { departmentId: query.departmentId } : {},
        ],
      },
      include: SCHEME_ADMIN_INCLUDE,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    const items: SchemeAdminDto[] = [];
    const now = new Date();
    for (const row of rows) {
      items.push(
        toSchemeAdminDto(
          row,
          await this.capabilities(userId, row.departmentId),
          now,
        ),
      );
    }
    return { items };
  }

  async get(userId: string, schemeId: string): Promise<SchemeAdminDto> {
    const { scheme } = await this.access.resolveScheme(
      userId,
      schemeId,
      'VIEW',
    );
    return this.view(userId, scheme.id);
  }

  // ---- draft ------------------------------------------------------------------

  async create(
    userId: string,
    dto: CreateSchemeDto,
    ipAddress: string,
  ): Promise<SchemeAdminDto> {
    const departments = await this.access.maintainedDepartments(userId);
    // A department the caller does not maintain is indistinguishable from a
    // nonexistent one.
    if (!departments.includes(dto.departmentId)) {
      throw notFound('Department');
    }
    const created = await this.prisma.scheme.create({
      data: {
        departmentId: dto.departmentId,
        name: dto.name,
        description: dto.description,
        benefits: dto.benefits,
        eligibilityCriteria: dto.eligibilityCriteria,
        benefitType: dto.benefitType ?? null,
        applicableSectors: dto.applicableSectors ?? [],
        applicableDistricts: dto.applicableDistricts ?? [],
        applicableEnterpriseSizes: dto.applicableEnterpriseSizes ?? [],
        applicationDeadline: asDate(dto.applicationDeadline),
        sourceReference: dto.sourceReference ?? null,
        createdByUserId: userId,
      },
      include: SCHEME_ADMIN_INCLUDE,
    });
    await this.record(
      { userId, actingRole: 'SCHEME_OFFICER' },
      AuditActions.SCHEME_CREATED,
      created.id,
      ipAddress,
      null,
      schemeAuditState(created),
    );
    return this.view(userId, created.id);
  }

  async update(
    userId: string,
    schemeId: string,
    dto: UpdateSchemeDto,
    ipAddress: string,
  ): Promise<SchemeAdminDto> {
    const { actor } = await this.access.resolveScheme(
      userId,
      schemeId,
      'MAINTAIN',
    );
    const { before, after } = await this.prisma.$transaction(async (tx) => {
      const current = await this.lockDraft(tx, schemeId);
      const data: Prisma.SchemeUpdateInput = {};
      const set = <K extends keyof typeof current>(
        key: K,
        value: (typeof current)[K] | undefined,
      ) => {
        if (value !== undefined && !isDeepStrictEqual(value, current[key])) {
          (data as Record<string, unknown>)[key as string] = value;
        }
      };
      set('name', dto.name);
      set('description', dto.description);
      set('benefits', dto.benefits);
      set('eligibilityCriteria', dto.eligibilityCriteria);
      set('benefitType', dto.benefitType);
      set('applicableSectors', dto.applicableSectors);
      set('applicableDistricts', dto.applicableDistricts);
      set('applicableEnterpriseSizes', dto.applicableEnterpriseSizes);
      set('sourceReference', dto.sourceReference);
      if (dto.applicationDeadline !== undefined) {
        const next = asDate(dto.applicationDeadline);
        if (next?.getTime() !== current.applicationDeadline?.getTime()) {
          data.applicationDeadline = next;
        }
      }
      if (Object.keys(data).length === 0) {
        throw invalid('_', 'The request changes nothing.');
      }
      const updated = await tx.scheme.update({
        where: { id: schemeId },
        data: { ...data, version: { increment: 1 } },
        include: SCHEME_ADMIN_INCLUDE,
      });
      return { before: current, after: updated };
    });
    await this.record(
      actor,
      AuditActions.SCHEME_UPDATED,
      schemeId,
      ipAddress,
      schemeAuditState(before),
      schemeAuditState(after),
    );
    return this.view(userId, schemeId);
  }

  /** Adds a NEW version of the eligibility rule (history is never rewritten:
   * the highest effective version is the one that applies). Only to a draft. */
  async addRule(
    userId: string,
    schemeId: string,
    dto: AddSchemeRuleDto,
    ipAddress: string,
  ): Promise<SchemeRuleDto> {
    const { actor } = await this.access.resolveScheme(
      userId,
      schemeId,
      'MAINTAIN',
    );
    const issues = validateCondition(dto.conditions);
    if (issues.length > 0) {
      throw new BadRequestException({
        code: ErrorCodes.INVALID_RULE_DEFINITION,
        message:
          'The rule definition does not conform to the condition grammar.',
        fields: {
          conditions: issues.map((i) => `${i.path}: ${i.message}`),
        },
      });
    }
    const sourceReference = dto.sourceReference;
    if (sourceReference.length < 3) {
      throw invalid(
        'sourceReference',
        'must be 3 to 500 characters (use "TBD" if the department has not supplied one)',
      );
    }
    const effectiveFrom = dto.effectiveFrom
      ? new Date(dto.effectiveFrom)
      : new Date();
    const effectiveTo = dto.effectiveTo ? new Date(dto.effectiveTo) : null;
    if (effectiveTo && effectiveTo.getTime() <= effectiveFrom.getTime()) {
      throw new BadRequestException({
        code: ErrorCodes.INVALID_EFFECTIVE_DATES,
        message: 'effectiveTo must be after effectiveFrom.',
      });
    }

    const created = await this.prisma.$transaction(async (tx) => {
      await this.lockDraft(tx, schemeId);
      const latest = await tx.schemeRule.findFirst({
        where: { schemeId },
        orderBy: { version: 'desc' },
        select: { version: true, effectiveFrom: true },
      });
      if (latest && effectiveFrom.getTime() < latest.effectiveFrom.getTime()) {
        throw new BadRequestException({
          code: ErrorCodes.INVALID_EFFECTIVE_DATES,
          message:
            'A new version cannot take effect before the previous version did.',
        });
      }
      return tx.schemeRule.create({
        data: {
          schemeId,
          version: (latest?.version ?? 0) + 1,
          effectiveFrom,
          effectiveTo,
          isActive: dto.isActive ?? true,
          conditions: dto.conditions as Prisma.InputJsonValue,
          priority: dto.priority ?? 100,
          sourceReference,
          createdByUserId: userId,
        },
      });
    });
    await this.record(
      actor,
      AuditActions.SCHEME_RULE_VERSION_ADDED,
      schemeId,
      ipAddress,
      null,
      {
        schemeId,
        ruleId: created.id,
        version: created.version,
        effectiveFrom: created.effectiveFrom.toISOString(),
        effectiveTo: created.effectiveTo?.toISOString() ?? null,
        isActive: created.isActive,
        priority: created.priority,
        sourceReference: created.sourceReference,
        conditions: dto.conditions,
      },
      `${created.id}@v${created.version}`,
    );
    return toRuleDto(created);
  }

  // ---- required documents ---------------------------------------------------------

  async addRequirement(
    userId: string,
    schemeId: string,
    dto: CreateSchemeDocumentRequirementDto,
    ipAddress: string,
  ): Promise<SchemeDocumentRequirementDto> {
    const { actor } = await this.access.resolveScheme(
      userId,
      schemeId,
      'MAINTAIN',
    );
    const created = await this.prisma.$transaction(async (tx) => {
      await this.lockDraft(tx, schemeId);
      return tx.schemeDocumentRequirement.create({
        data: {
          schemeId,
          name: dto.name,
          isMandatory: dto.isMandatory,
          description: dto.description ?? null,
          maxSizeBytes: dto.maxSizeBytes ?? null,
          allowedMimeTypes: dto.allowedMimeTypes ?? [],
        },
      });
    });
    await this.record(
      actor,
      AuditActions.SCHEME_DOCUMENT_REQUIREMENT_ADDED,
      schemeId,
      ipAddress,
      null,
      { schemeId, requirementId: created.id, ...requirementState(created) },
    );
    return toRequirementDto(created);
  }

  async updateRequirement(
    userId: string,
    schemeId: string,
    requirementId: string,
    dto: UpdateSchemeDocumentRequirementDto,
    ipAddress: string,
  ): Promise<SchemeDocumentRequirementDto> {
    const { actor } = await this.access.resolveScheme(
      userId,
      schemeId,
      'MAINTAIN',
    );
    if (!isUUID(requirementId)) {
      throw notFound('Document requirement');
    }
    const { before, after } = await this.prisma.$transaction(async (tx) => {
      await this.lockDraft(tx, schemeId);
      const current = await tx.schemeDocumentRequirement.findFirst({
        where: { id: requirementId, schemeId },
      });
      if (!current) {
        throw notFound('Document requirement');
      }
      const data: Prisma.SchemeDocumentRequirementUpdateInput = {};
      const set = <K extends keyof typeof current>(
        key: K,
        value: (typeof current)[K] | undefined,
      ) => {
        if (value !== undefined && !isDeepStrictEqual(value, current[key])) {
          (data as Record<string, unknown>)[key as string] = value;
        }
      };
      set('name', dto.name);
      set('isMandatory', dto.isMandatory);
      set('description', dto.description);
      set('maxSizeBytes', dto.maxSizeBytes);
      set('allowedMimeTypes', dto.allowedMimeTypes);
      if (Object.keys(data).length === 0) {
        throw invalid('_', 'The request changes nothing.');
      }
      const updated = await tx.schemeDocumentRequirement.update({
        where: { id: requirementId },
        data,
      });
      return { before: current, after: updated };
    });
    await this.record(
      actor,
      AuditActions.SCHEME_DOCUMENT_REQUIREMENT_UPDATED,
      schemeId,
      ipAddress,
      { requirementId, ...requirementState(before) },
      { requirementId, ...requirementState(after) },
    );
    return toRequirementDto(after);
  }

  async removeRequirement(
    userId: string,
    schemeId: string,
    requirementId: string,
    ipAddress: string,
  ): Promise<void> {
    const { actor } = await this.access.resolveScheme(
      userId,
      schemeId,
      'MAINTAIN',
    );
    if (!isUUID(requirementId)) {
      throw notFound('Document requirement');
    }
    const removed = await this.prisma.$transaction(async (tx) => {
      await this.lockDraft(tx, schemeId);
      const current = await tx.schemeDocumentRequirement.findFirst({
        where: { id: requirementId, schemeId },
      });
      if (!current) {
        throw notFound('Document requirement');
      }
      const inUse = await tx.schemeApplicationDocument.count({
        where: { schemeDocumentRequirementId: requirementId },
      });
      if (inUse > 0) {
        throw new ConflictException({
          code: ErrorCodes.SCHEME_REQUIREMENT_IN_USE,
          message:
            'Evidence has already been provided against this requirement, so it cannot be removed.',
        });
      }
      await tx.schemeDocumentRequirement.delete({
        where: { id: requirementId },
      });
      return current;
    });
    await this.record(
      actor,
      AuditActions.SCHEME_DOCUMENT_REQUIREMENT_REMOVED,
      schemeId,
      ipAddress,
      { requirementId, ...requirementState(removed) },
      null,
    );
  }

  // ---- publication --------------------------------------------------------------

  /** Makes a drafted scheme visible to applicants. A separate, authorised act
   * from drafting it (FRD 34). */
  async publish(
    userId: string,
    schemeId: string,
    ipAddress: string,
  ): Promise<SchemeAdminDto> {
    const { actor } = await this.access.resolveScheme(
      userId,
      schemeId,
      'PUBLISH',
    );
    const { before, after } = await this.prisma.$transaction(async (tx) => {
      const current = await this.lock(tx, schemeId);
      if (current.publishStatus === 'PUBLISHED') {
        throw new ConflictException({
          code: ErrorCodes.SCHEME_ALREADY_PUBLISHED,
          message: 'This scheme is already published.',
        });
      }
      const updated = await tx.scheme.update({
        where: { id: schemeId },
        data: {
          publishStatus: 'PUBLISHED',
          publishedAt: new Date(),
          publishedByUserId: userId,
        },
        include: SCHEME_ADMIN_INCLUDE,
      });
      return { before: current, after: updated };
    });
    await this.record(
      actor,
      AuditActions.SCHEME_PUBLISHED,
      schemeId,
      ipAddress,
      schemeAuditState(before),
      {
        ...schemeAuditState(after),
        publishedAt: after.publishedAt?.toISOString() ?? null,
        // What exactly was approved for publication.
        ruleVersions: after.rules.map((r) => ({
          id: r.id,
          version: r.version,
        })),
        documentRequirementCount: after.documentRequirements.length,
        // The publisher and the drafter, so any separation of the two is
        // evident from the record.
        draftedByUserId: after.createdByUserId,
      },
    );
    return this.view(userId, schemeId);
  }

  /** Returns a published scheme to draft: hidden from applicants and editable
   * again. Existing applications are unaffected. */
  async unpublish(
    userId: string,
    schemeId: string,
    ipAddress: string,
  ): Promise<SchemeAdminDto> {
    const { actor } = await this.access.resolveScheme(
      userId,
      schemeId,
      'WITHDRAW',
    );
    const { before, after } = await this.prisma.$transaction(async (tx) => {
      const current = await this.lock(tx, schemeId);
      if (current.publishStatus !== 'PUBLISHED') {
        throw new ConflictException({
          code: ErrorCodes.SCHEME_NOT_PUBLISHED,
          message: 'This scheme is not published.',
        });
      }
      const updated = await tx.scheme.update({
        where: { id: schemeId },
        data: {
          publishStatus: 'DRAFT',
          publishedAt: null,
          publishedByUserId: null,
        },
        include: SCHEME_ADMIN_INCLUDE,
      });
      return { before: current, after: updated };
    });
    await this.record(
      actor,
      AuditActions.SCHEME_UNPUBLISHED,
      schemeId,
      ipAddress,
      {
        ...schemeAuditState(before),
        publishedAt: before.publishedAt?.toISOString() ?? null,
        publishedByUserId: before.publishedByUserId,
      },
      schemeAuditState(after),
    );
    return this.view(userId, schemeId);
  }

  /** Activates / deactivates a scheme: an inactive scheme is hidden and takes no
   * new applications. Its published content is untouched. */
  async setActive(
    userId: string,
    schemeId: string,
    dto: SetSchemeActiveDto,
    ipAddress: string,
  ): Promise<SchemeAdminDto> {
    const { actor } = await this.access.resolveScheme(
      userId,
      schemeId,
      'WITHDRAW',
    );
    const { before, after } = await this.prisma.$transaction(async (tx) => {
      const current = await this.lock(tx, schemeId);
      if (current.isActive === dto.isActive) {
        throw invalid('isActive', 'The request changes nothing.');
      }
      const updated = await tx.scheme.update({
        where: { id: schemeId },
        data: { isActive: dto.isActive },
        include: SCHEME_ADMIN_INCLUDE,
      });
      return { before: current, after: updated };
    });
    await this.record(
      actor,
      AuditActions.SCHEME_ACTIVATION_CHANGED,
      schemeId,
      ipAddress,
      { isActive: before.isActive },
      { isActive: after.isActive, publishStatus: after.publishStatus },
    );
    return this.view(userId, schemeId);
  }

  // ---- internals ----------------------------------------------------------------

  /** Locks the scheme row: concurrent edits, rule versions and publication of
   * one scheme are serialised, and everything is re-checked under the lock. */
  private async lock(
    tx: Prisma.TransactionClient,
    schemeId: string,
  ): Promise<SchemeAdminRow> {
    await tx.$queryRaw`SELECT id FROM schemes WHERE id = ${schemeId}::uuid FOR UPDATE`;
    const row = await tx.scheme.findUnique({
      where: { id: schemeId },
      include: SCHEME_ADMIN_INCLUDE,
    });
    if (!row) {
      throw notFound('Scheme');
    }
    return row;
  }

  private async lockDraft(
    tx: Prisma.TransactionClient,
    schemeId: string,
  ): Promise<SchemeAdminRow> {
    const row = await this.lock(tx, schemeId);
    if (row.publishStatus !== 'DRAFT') {
      throw notEditable();
    }
    return row;
  }

  private async capabilities(
    userId: string,
    departmentId: string,
  ): Promise<SchemeCapabilitiesDto> {
    const caps = await this.access.describe(userId, departmentId);
    return {
      canMaintain: caps.has('MAINTAIN'),
      canPublish: caps.has('PUBLISH'),
      canWithdraw: caps.has('WITHDRAW'),
    };
  }

  private async view(
    userId: string,
    schemeId: string,
  ): Promise<SchemeAdminDto> {
    const row = await this.prisma.scheme.findUnique({
      where: { id: schemeId },
      include: SCHEME_ADMIN_INCLUDE,
    });
    if (!row) {
      throw notFound('Scheme');
    }
    return toSchemeAdminDto(
      row,
      await this.capabilities(userId, row.departmentId),
    );
  }

  private record(
    actor: SchemeActor,
    action: AuditAction,
    schemeId: string,
    ipAddress: string,
    beforeState: Record<string, unknown> | null,
    afterState: Record<string, unknown> | null,
    ruleVersionUsed?: string,
  ): Promise<void> {
    return this.audit.record({
      userId: actor.userId,
      roleAtTime: actor.actingRole,
      action,
      entityType: 'Scheme',
      entityId: schemeId,
      beforeState,
      afterState: { schemeId, ...afterState },
      ipAddress,
      ruleVersionUsed,
    });
  }
}

function requirementState(r: {
  name: string;
  isMandatory: boolean;
  description: string | null;
  maxSizeBytes: number | null;
  allowedMimeTypes: string[];
}) {
  return {
    name: r.name,
    isMandatory: r.isMandatory,
    description: r.description,
    maxSizeBytes: r.maxSizeBytes,
    allowedMimeTypes: r.allowedMimeTypes ?? [],
  };
}
