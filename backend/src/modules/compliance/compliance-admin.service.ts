import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { isUUID } from 'class-validator';
import { ErrorCodes } from '../../common/constants/error-codes.constant';
import { AuditActions } from '../../infrastructure/audit/audit-actions.constant';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { OfficerAccessService } from '../officer/officer-access.service';
import {
  CreateComplianceRequirementDto,
  ListRequirementsQueryDto,
  UpdateComplianceRequirementDto,
} from './dto/compliance-request.dto';
import { ComplianceRequirementDto } from './dto/compliance-response.dto';

const DEPT_ADMIN = 'DEPT_ADMIN';

const INCLUDE = {
  approvalType: { select: { id: true, name: true, departmentId: true } },
} satisfies Prisma.ComplianceRequirementInclude;

type Row = Prisma.ComplianceRequirementGetPayload<{ include: typeof INCLUDE }>;

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

export function toRequirementDto(row: Row): ComplianceRequirementDto {
  return {
    id: row.id,
    approvalTypeId: row.approvalTypeId,
    approvalTypeName: row.approvalType.name,
    departmentId: row.approvalType.departmentId,
    description: row.description,
    frequency: row.frequency,
    applicantAction: row.applicantAction,
    sourceReference: row.sourceReference,
    evidenceRequired: row.evidenceRequired,
    firstDueAfterDays: row.firstDueAfterDays,
    dueWindowDays: row.dueWindowDays,
    version: row.version,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const snapshotOf = (row: Row) => ({
  description: row.description,
  frequency: row.frequency,
  applicantAction: row.applicantAction,
  sourceReference: row.sourceReference,
  evidenceRequired: row.evidenceRequired,
  firstDueAfterDays: row.firstDueAfterDays,
  dueWindowDays: row.dueWindowDays,
  isActive: row.isActive,
  version: row.version,
});

/**
 * Configuring a department's compliance obligations (FRD 27.2: "obligations that
 * a government department has explicitly configured against an approval type";
 * TRD 14; FRD 21 department-scoped configuration).
 *
 * WHO: the requirements name no configuring role. Following FRD 21 ("configure
 * department-scoped ... values where authorised") the DEPARTMENT ADMINISTRATOR of
 * the approval type's department configures it, and nobody else: not another
 * department's administrator, and not a System Administrator (a statutory
 * value is business authority a platform administrator never holds, FRD 35.2).
 * This choice is TO BE VALIDATED (FRD 37 lists the split as open).
 *
 * WHAT: an edit is applied in place and bumps `version`; occurrences already
 * created keep the version they were created under, so no history is re-written.
 * Nothing is ever deleted (`isActive: false` stops NEW occurrences). Every change
 * is audited with its before and after.
 */
@Injectable()
export class ComplianceAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly officers: OfficerAccessService,
  ) {}

  async list(
    userId: string,
    query: ListRequirementsQueryDto,
  ): Promise<ComplianceRequirementDto[]> {
    const departmentIds = await this.departments(userId);
    if (departmentIds.length === 0) {
      return [];
    }
    const rows = await this.prisma.complianceRequirement.findMany({
      where: {
        approvalType: { departmentId: { in: departmentIds } },
        ...(query.approvalTypeId
          ? { approvalTypeId: query.approvalTypeId }
          : {}),
      },
      include: INCLUDE,
      orderBy: [{ approvalTypeId: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toRequirementDto);
  }

  async create(
    userId: string,
    dto: CreateComplianceRequirementDto,
    ipAddress: string,
  ): Promise<ComplianceRequirementDto> {
    const departmentIds = await this.departments(userId);
    const type = await this.prisma.approvalType.findUnique({
      where: { id: dto.approvalTypeId },
      select: { departmentId: true },
    });
    // Not theirs = indistinguishable from nonexistent.
    if (!type || !departmentIds.includes(type.departmentId)) {
      throw notFound('Approval type');
    }
    const created = await this.prisma.complianceRequirement.create({
      data: {
        approvalTypeId: dto.approvalTypeId,
        description: dto.description,
        frequency: dto.frequency,
        evidenceRequired: dto.evidenceRequired ?? false,
        applicantAction: dto.applicantAction ?? null,
        sourceReference: dto.sourceReference ?? null,
        firstDueAfterDays: dto.firstDueAfterDays ?? null,
        dueWindowDays: dto.dueWindowDays ?? 0,
      },
      include: INCLUDE,
    });
    await this.audit.record({
      userId,
      roleAtTime: DEPT_ADMIN,
      action: AuditActions.COMPLIANCE_REQUIREMENT_CREATED,
      entityType: 'ComplianceRequirement',
      entityId: created.id,
      afterState: {
        approvalTypeId: created.approvalTypeId,
        departmentId: created.approvalType.departmentId,
        ...snapshotOf(created),
      },
      ipAddress,
    });
    return toRequirementDto(created);
  }

  async update(
    userId: string,
    requirementId: string,
    dto: UpdateComplianceRequirementDto,
    ipAddress: string,
  ): Promise<ComplianceRequirementDto> {
    if (!isUUID(requirementId)) {
      throw notFound('Compliance requirement');
    }
    const departmentIds = await this.departments(userId);
    const { before, after } = await this.prisma.$transaction(async (tx) => {
      // Locked, so two administrators editing one requirement are serialised,
      // each version is unique, and each audit record shows the true before.
      await tx.$queryRaw`SELECT id FROM compliance_requirements WHERE id = ${requirementId}::uuid FOR UPDATE`;
      const current = await tx.complianceRequirement.findUnique({
        where: { id: requirementId },
        include: INCLUDE,
      });
      if (
        !current ||
        !departmentIds.includes(current.approvalType.departmentId)
      ) {
        throw notFound('Compliance requirement');
      }
      const data: Prisma.ComplianceRequirementUpdateInput = {};
      const set = <K extends keyof Row>(
        key: K,
        value: Row[K] | undefined | null,
        allowNull = false,
      ) => {
        if (value === undefined || (value === null && !allowNull)) {
          return;
        }
        if (value !== current[key]) {
          (data as Record<string, unknown>)[key as string] = value;
        }
      };
      set('description', dto.description);
      set('frequency', dto.frequency);
      set('evidenceRequired', dto.evidenceRequired);
      set('applicantAction', dto.applicantAction, true);
      set('sourceReference', dto.sourceReference, true);
      set('firstDueAfterDays', dto.firstDueAfterDays, true);
      set('dueWindowDays', dto.dueWindowDays);
      set('isActive', dto.isActive);
      if (Object.keys(data).length === 0) {
        throw invalid('_', 'The request changes nothing.');
      }
      const updated = await tx.complianceRequirement.update({
        where: { id: requirementId },
        data: { ...data, version: { increment: 1 } },
        include: INCLUDE,
      });
      return { before: current, after: updated };
    });
    await this.audit.record({
      userId,
      roleAtTime: DEPT_ADMIN,
      action: AuditActions.COMPLIANCE_REQUIREMENT_UPDATED,
      entityType: 'ComplianceRequirement',
      entityId: after.id,
      beforeState: snapshotOf(before),
      afterState: {
        approvalTypeId: after.approvalTypeId,
        departmentId: after.approvalType.departmentId,
        ...snapshotOf(after),
        // Occurrences already created keep the version they were created under.
        appliesTo: 'OCCURRENCES_CREATED_AFTER_THIS_CHANGE',
      },
      ipAddress,
    });
    return toRequirementDto(after);
  }

  /** Departments where the caller is a Department Administrator. */
  private async departments(userId: string): Promise<string[]> {
    const grants = await this.officers.grantsFor(userId);
    return [
      ...new Set(
        grants.filter((g) => g.role === DEPT_ADMIN).map((g) => g.departmentId),
      ),
    ];
  }
}
