import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ApprovalRule, Prisma } from '@prisma/client';
import { ErrorCodes } from '../../common/constants/error-codes.constant';
import { AuditActions } from '../../infrastructure/audit/audit-actions.constant';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { RuleDescriptor } from './engine/discovery-engine';
import { validateCondition } from './engine/rule-condition';

export interface PublishRuleVersionInput {
  approvalTypeId: string;
  conditions: unknown;
  excludesIf?: unknown | null;
  /** Defaults to now. Must not precede the previous version's. */
  effectiveFrom?: Date;
  effectiveTo?: Date | null;
  isActive?: boolean;
  /** Only when the department has confirmed the rule as authoritative
   * (FRD §10.3). Defaults to false: "Potentially Applicable". */
  isOfficiallyRequired?: boolean;
  priority?: number;
  /** Evidence for the rule. Use the literal `TBD` when the department has
   * not yet supplied a citation — never a guessed one. */
  sourceReference: string;
  createdByUserId: string;
  ipAddress: string;
}

const MAX_SOURCE_REFERENCE = 500;

function definitionError(
  field: 'conditions' | 'excludesIf',
  issues: Array<{ path: string; message: string }>,
): BadRequestException {
  return new BadRequestException({
    code: ErrorCodes.INVALID_RULE_DEFINITION,
    message: 'The rule definition does not conform to the condition grammar.',
    fields: { [field]: issues.map((i) => `${i.path}: ${i.message}`) },
  });
}

/**
 * Rule storage with versioning that never rewrites history.
 *
 *  - PUBLISH: every change is a NEW row with the next version number for its
 *    approval type (Blueprint §10.4). Definitions are validated against the
 *    closed grammar first, so an invalid rule can never be stored through
 *    this path. The database additionally forbids updating a published
 *    version's definition (trigger), so this is enforced below the
 *    application too.
 *  - RESOLVE: for a given instant, the rule that applies to an approval type
 *    is its HIGHEST version among those already effective — not "any active
 *    row". Older versions therefore never need their `effective_to` edited
 *    when a newer one is published, and evaluating "as of" an earlier
 *    instant selects the earlier version.
 *
 * There is intentionally no HTTP endpoint for publishing: rule administration
 * (who may author rules for which department) belongs to the admin module.
 * Nothing here seeds statutory content.
 */
@Injectable()
export class ApprovalRulesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async publishVersion(input: PublishRuleVersionInput): Promise<ApprovalRule> {
    const conditionIssues = validateCondition(input.conditions);
    if (conditionIssues.length > 0) {
      throw definitionError('conditions', conditionIssues);
    }
    if (input.excludesIf !== undefined && input.excludesIf !== null) {
      const excludeIssues = validateCondition(input.excludesIf);
      if (excludeIssues.length > 0) {
        throw definitionError('excludesIf', excludeIssues);
      }
    }

    const sourceReference = input.sourceReference?.trim() ?? '';
    if (
      sourceReference.length < 3 ||
      sourceReference.length > MAX_SOURCE_REFERENCE
    ) {
      throw new BadRequestException({
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'Validation failed',
        fields: {
          sourceReference: [
            `must be 3 to ${MAX_SOURCE_REFERENCE} characters (use "TBD" if the department has not supplied one)`,
          ],
        },
      });
    }

    const priority = input.priority ?? 100;
    if (!Number.isInteger(priority) || priority < 0 || priority > 10_000) {
      throw new BadRequestException({
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'Validation failed',
        fields: { priority: ['must be an integer from 0 to 10000'] },
      });
    }

    const effectiveFrom = input.effectiveFrom ?? new Date();
    const effectiveTo = input.effectiveTo ?? null;
    if (
      effectiveTo !== null &&
      effectiveTo.getTime() <= effectiveFrom.getTime()
    ) {
      throw new BadRequestException({
        code: ErrorCodes.INVALID_EFFECTIVE_DATES,
        message: 'effectiveTo must be after effectiveFrom.',
      });
    }

    const approvalType = await this.prisma.approvalType.findUnique({
      where: { id: input.approvalTypeId },
      select: { id: true },
    });
    if (!approvalType) {
      throw new NotFoundException({
        code: ErrorCodes.NOT_FOUND,
        message: 'Approval type not found.',
      });
    }

    const created = await this.prisma.$transaction(async (tx) => {
      // Serialise concurrent publishes for one approval type so version
      // numbers stay strictly sequential (the unique index is the backstop).
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`approval-rule:${input.approvalTypeId}`}, 0))`;

      const latest = await tx.approvalRule.findFirst({
        where: { approvalTypeId: input.approvalTypeId },
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

      return tx.approvalRule.create({
        data: {
          approvalTypeId: input.approvalTypeId,
          version: (latest?.version ?? 0) + 1,
          effectiveFrom,
          effectiveTo,
          isActive: input.isActive ?? true,
          isOfficiallyRequired: input.isOfficiallyRequired ?? false,
          priority,
          sourceReference,
          conditions: input.conditions as Prisma.InputJsonValue,
          excludesIf:
            input.excludesIf === undefined || input.excludesIf === null
              ? Prisma.DbNull
              : (input.excludesIf as Prisma.InputJsonValue),
          createdBy: input.createdByUserId,
        },
      });
    });

    await this.audit.record({
      userId: input.createdByUserId,
      action: AuditActions.RULE_VERSION_PUBLISHED,
      entityType: 'ApprovalRule',
      entityId: created.id,
      afterState: {
        approvalTypeId: created.approvalTypeId,
        version: created.version,
        effectiveFrom: created.effectiveFrom.toISOString(),
        effectiveTo: created.effectiveTo?.toISOString() ?? null,
        isActive: created.isActive,
        isOfficiallyRequired: created.isOfficiallyRequired,
        priority: created.priority,
        sourceReference: created.sourceReference,
        conditions: input.conditions as Prisma.InputJsonValue,
        excludesIf: (input.excludesIf ?? null) as Prisma.InputJsonValue,
      },
      ipAddress: input.ipAddress,
    });

    return created;
  }

  /**
   * The rule version to evaluate for each approval type at `asOf`, as
   * self-contained descriptors: for each approval type, its highest version
   * that is already effective (and not yet ended); if THAT version is
   * inactive the approval type is simply not evaluated — a retired rule does
   * not fall back to an older version. Approval types and departments that
   * are deactivated are skipped.
   */
  async loadEffectiveRules(asOf: Date): Promise<RuleDescriptor[]> {
    const rows = await this.prisma.approvalRule.findMany({
      where: {
        effectiveFrom: { lte: asOf },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: asOf } }],
        approvalType: { isActive: true, department: { isActive: true } },
      },
      include: { approvalType: { include: { department: true } } },
      orderBy: [{ approvalTypeId: 'asc' }, { version: 'desc' }],
    });

    const chosen = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      if (!chosen.has(row.approvalTypeId)) {
        chosen.set(row.approvalTypeId, row);
      }
    }
    const active = [...chosen.values()].filter((r) => r.isActive);
    if (active.length === 0) {
      return [];
    }

    // approval_dependencies rows read "approvalTypeId depends on
    // dependsOnApprovalTypeId".
    const dependencies = await this.prisma.approvalDependency.findMany({
      where: { approvalTypeId: { in: active.map((r) => r.approvalTypeId) } },
      include: { dependsOnApprovalType: { select: { id: true, name: true } } },
    });
    const dependsOn = new Map<
      string,
      Array<{ approvalTypeId: string; name: string }>
    >();
    for (const dep of dependencies) {
      const list = dependsOn.get(dep.approvalTypeId) ?? [];
      list.push({
        approvalTypeId: dep.dependsOnApprovalType.id,
        name: dep.dependsOnApprovalType.name,
      });
      dependsOn.set(dep.approvalTypeId, list);
    }

    return active.map((r) => ({
      ruleId: r.id,
      version: r.version,
      priority: r.priority,
      effectiveFrom: r.effectiveFrom.toISOString(),
      effectiveTo: r.effectiveTo?.toISOString() ?? null,
      isOfficiallyRequired: r.isOfficiallyRequired,
      sourceReference: r.sourceReference,
      conditions: r.conditions,
      excludesIf: r.excludesIf,
      approvalType: {
        id: r.approvalType.id,
        name: r.approvalType.name,
        legalName: r.approvalType.legalName,
        legalReference: r.approvalType.legalReference,
      },
      department: {
        id: r.approvalType.department.id,
        code: r.approvalType.department.code,
        name: r.approvalType.department.name,
      },
      dependsOn: dependsOn.get(r.approvalTypeId) ?? [],
    }));
  }
}
