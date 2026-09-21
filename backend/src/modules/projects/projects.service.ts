import { isDeepStrictEqual } from 'node:util';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Project } from '@prisma/client';
import { ErrorCodes } from '../../common/constants/error-codes.constant';
import { AuditActions } from '../../infrastructure/audit/audit-actions.constant';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { EnterpriseAccess } from '../enterprises/interfaces/enterprise-access.interface';
import { LEASED_LAND_STATUS } from './constants/project-values.constant';
import { CreateProjectDto } from './dto/create-project.dto';
import { ProjectResponseDto } from './dto/project-response.dto';
import { UpdateProjectDto } from './dto/update-project.dto';

const APPLICANT_ROLE = 'APPLICANT';

/** The project's editable data as plain JSON-safe values (Decimal -> number,
 * DATE -> 'YYYY-MM-DD'), used for diffing, validation and audit snapshots. */
export interface ProjectValues {
  name: string;
  district: string;
  taluka: string;
  industrialArea: string | null;
  sectorCode: string;
  enterpriseSizeBand: string;
  investmentAmount: number;
  employmentCount: number;
  projectStage: string;
  landStatus: string;
  landLeaseDetails: { lessorName: string; leaseTermMonths: number } | null;
  constructionStatus: string;
  productionStatus: string;
  hazardousFlag: boolean;
  hazardousCategory: string | null;
  environmentalCategory: string | null;
  additionalSiteDetails: string | null;
  expectedCommissioningDate: string | null;
}

const EDITABLE_FIELDS = [
  'name',
  'district',
  'taluka',
  'industrialArea',
  'sectorCode',
  'enterpriseSizeBand',
  'investmentAmount',
  'employmentCount',
  'projectStage',
  'landStatus',
  'landLeaseDetails',
  'constructionStatus',
  'productionStatus',
  'hazardousFlag',
  'hazardousCategory',
  'environmentalCategory',
  'additionalSiteDetails',
  'expectedCommissioningDate',
] as const satisfies ReadonlyArray<keyof ProjectValues>;

function formatDate(date: Date | null): string | null {
  return date ? date.toISOString().slice(0, 10) : null;
}

function readLeaseDetails(
  json: Prisma.JsonValue,
): ProjectValues['landLeaseDetails'] {
  if (json === null || typeof json !== 'object' || Array.isArray(json)) {
    return null;
  }
  const record = json as Record<string, unknown>;
  // Only the known keys are ever exposed, whatever the column holds.
  return {
    lessorName: String(record.lessorName ?? ''),
    leaseTermMonths: Number(record.leaseTermMonths ?? 0),
  };
}

export function toProjectValues(project: Project): ProjectValues {
  return {
    name: project.name,
    district: project.district,
    taluka: project.taluka,
    industrialArea: project.industrialArea,
    sectorCode: project.sectorCode,
    enterpriseSizeBand: project.enterpriseSizeBand,
    investmentAmount: Number(project.investmentAmount),
    employmentCount: project.employmentCount,
    projectStage: project.projectStage,
    landStatus: project.landStatus,
    landLeaseDetails: readLeaseDetails(project.landLeaseDetails),
    constructionStatus: project.constructionStatus,
    productionStatus: project.productionStatus,
    hazardousFlag: project.hazardousFlag,
    hazardousCategory: project.hazardousCategory,
    environmentalCategory: project.environmentalCategory,
    additionalSiteDetails: project.additionalSiteDetails,
    expectedCommissioningDate: formatDate(project.expectedCommissioningDate),
  };
}

export function toProjectResponse(project: Project): ProjectResponseDto {
  return {
    id: project.id,
    referenceNumber: project.referenceNumber,
    enterpriseId: project.enterpriseId,
    ...toProjectValues(project),
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
}

/** Values in the shape Prisma stores them. */
function toPrismaValue(
  field: (typeof EDITABLE_FIELDS)[number],
  value: unknown,
) {
  if (field === 'landLeaseDetails') {
    return value === null ? Prisma.DbNull : (value as Prisma.InputJsonObject);
  }
  if (field === 'expectedCommissioningDate') {
    return value === null ? null : new Date(`${value as string}T00:00:00.000Z`);
  }
  return value;
}

function fieldError(field: string, message: string): BadRequestException {
  return new BadRequestException({
    code: ErrorCodes.VALIDATION_ERROR,
    message: 'Validation failed',
    fields: { [field]: [message] },
  });
}

/** Rules that depend on more than one field, checked against the project as
 * it WOULD be after the change — so an update cannot leave orphaned lease
 * details or a hazardous category on a non-hazardous project. */
export function assertConsistent(values: ProjectValues): void {
  if (
    values.landLeaseDetails !== null &&
    values.landStatus !== LEASED_LAND_STATUS
  ) {
    throw fieldError(
      'landLeaseDetails',
      'landLeaseDetails is only allowed when landStatus is "leased" (send null to clear it when changing landStatus)',
    );
  }
  if (values.hazardousCategory !== null && !values.hazardousFlag) {
    throw fieldError(
      'hazardousCategory',
      'hazardousCategory is only allowed when hazardousFlag is true (send null to clear it when unsetting the flag)',
    );
  }
  if (values.expectedCommissioningDate !== null) {
    const parsed = new Date(
      `${values.expectedCommissioningDate}T00:00:00.000Z`,
    );
    if (
      Number.isNaN(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== values.expectedCommissioningDate
    ) {
      throw fieldError(
        'expectedCommissioningDate',
        'expectedCommissioningDate must be a real calendar date',
      );
    }
  }
}

/**
 * Project CRUD (Blueprint §13.2, FRD §9.2). Authorisation is NOT decided
 * here: routes are protected by EnterpriseAccessGuard, which has already
 * resolved the caller's relationship to the enterprise (owner, or a live
 * representative with a sufficient scope and, if restricted, this project in
 * their list) before any method runs. This service receives that decision as
 * `access` and never trusts a client-supplied enterprise or owner.
 *
 * There is no project lifecycle: FRD/TRD/Blueprint define none, so there is
 * no status to transition and no status field to write.
 */
@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(
    access: EnterpriseAccess,
    actorUserId: string,
    dto: CreateProjectDto,
    ipAddress: string,
  ): Promise<ProjectResponseDto> {
    const values: ProjectValues = {
      name: dto.name,
      district: dto.district,
      taluka: dto.taluka,
      industrialArea: dto.industrialArea ?? null,
      sectorCode: dto.sectorCode,
      enterpriseSizeBand: dto.enterpriseSizeBand,
      investmentAmount: dto.investmentAmount,
      employmentCount: dto.employmentCount,
      projectStage: dto.projectStage,
      landStatus: dto.landStatus,
      landLeaseDetails: dto.landLeaseDetails
        ? {
            lessorName: dto.landLeaseDetails.lessorName,
            leaseTermMonths: dto.landLeaseDetails.leaseTermMonths,
          }
        : null,
      constructionStatus: dto.constructionStatus,
      productionStatus: dto.productionStatus,
      hazardousFlag: dto.hazardousFlag,
      hazardousCategory: dto.hazardousCategory ?? null,
      environmentalCategory: dto.environmentalCategory ?? null,
      additionalSiteDetails: dto.additionalSiteDetails ?? null,
      expectedCommissioningDate: dto.expectedCommissioningDate ?? null,
    };
    assertConsistent(values);

    const data: Record<string, unknown> = {};
    for (const field of EDITABLE_FIELDS) {
      // Omit nulls on create so column defaults / NULLs apply naturally.
      if (values[field] !== null) {
        data[field] = toPrismaValue(field, values[field]);
      }
    }

    const project = await this.prisma.project.create({
      data: {
        ...(data as Omit<Prisma.ProjectUncheckedCreateInput, 'enterpriseId'>),
        // Always the authorised enterprise from the route — never the body.
        enterpriseId: access.enterprise.id,
      },
    });

    await this.audit.record({
      userId: actorUserId,
      roleAtTime: APPLICANT_ROLE,
      action: AuditActions.PROJECT_CREATED,
      entityType: 'Project',
      entityId: project.id,
      afterState: {
        enterpriseId: access.enterprise.id,
        actingAs: access.relation,
        referenceNumber: project.referenceNumber,
        name: project.name,
        projectStage: project.projectStage,
      },
      ipAddress,
    });

    return toProjectResponse(project);
  }

  /** A project-restricted representative sees only their authorised
   * projects; the owner and unrestricted representatives see all. */
  async list(access: EnterpriseAccess): Promise<ProjectResponseDto[]> {
    const restricted = access.scopedProjectIds.length > 0;
    const projects = await this.prisma.project.findMany({
      where: {
        enterpriseId: access.enterprise.id,
        ...(restricted ? { id: { in: access.scopedProjectIds } } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
    return projects.map(toProjectResponse);
  }

  async get(
    access: EnterpriseAccess,
    projectId: string,
  ): Promise<ProjectResponseDto> {
    return toProjectResponse(await this.findInEnterprise(access, projectId));
  }

  async update(
    access: EnterpriseAccess,
    projectId: string,
    actorUserId: string,
    dto: UpdateProjectDto,
    ipAddress: string,
  ): Promise<ProjectResponseDto> {
    const current = await this.findInEnterprise(access, projectId);
    const before = toProjectValues(current);
    const next: ProjectValues = { ...before };
    const nextRecord = next as unknown as Record<string, unknown>;

    let anyFieldProvided = false;
    for (const field of EDITABLE_FIELDS) {
      const provided = dto[field];
      if (provided === undefined) {
        continue;
      }
      anyFieldProvided = true;
      nextRecord[field] =
        field === 'landLeaseDetails' && provided !== null
          ? {
              lessorName: (provided as { lessorName: string }).lessorName,
              leaseTermMonths: (provided as { leaseTermMonths: number })
                .leaseTermMonths,
            }
          : provided;
    }
    if (!anyFieldProvided) {
      throw new BadRequestException({
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'At least one field to update must be provided.',
      });
    }

    assertConsistent(next);

    const previous: Record<string, unknown> = {};
    const changes: Record<string, unknown> = {};
    const data: Record<string, unknown> = {};
    for (const field of EDITABLE_FIELDS) {
      if (!isDeepStrictEqual(before[field], next[field])) {
        previous[field] = before[field];
        changes[field] = next[field];
        data[field] = toPrismaValue(field, next[field]);
      }
    }

    // Nothing actually differs: succeed without a write or an audit entry.
    if (Object.keys(changes).length === 0) {
      return toProjectResponse(current);
    }

    const updated = await this.prisma.project.update({
      // Scoped by enterprise as well as id — defence in depth on top of the
      // lookup above.
      where: { id: current.id, enterpriseId: access.enterprise.id },
      data: data as Prisma.ProjectUncheckedUpdateInput,
    });

    await this.audit.record({
      userId: actorUserId,
      roleAtTime: APPLICANT_ROLE,
      action: AuditActions.PROJECT_UPDATED,
      entityType: 'Project',
      entityId: current.id,
      beforeState: previous as Prisma.InputJsonObject,
      afterState: {
        ...changes,
        enterpriseId: access.enterprise.id,
        actingAs: access.relation,
      } as Prisma.InputJsonObject,
      ipAddress,
    });

    return toProjectResponse(updated);
  }

  /** Always scoped to the authorised enterprise, so a project id belonging
   * to another enterprise is indistinguishable from a nonexistent one. */
  private async findInEnterprise(
    access: EnterpriseAccess,
    projectId: string,
  ): Promise<Project> {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, enterpriseId: access.enterprise.id },
    });
    if (!project) {
      throw new NotFoundException({
        code: ErrorCodes.NOT_FOUND,
        message: 'Project not found.',
      });
    }
    return project;
  }
}
