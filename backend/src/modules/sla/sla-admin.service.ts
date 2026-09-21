import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
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
import { UsersService } from '../users/users.service';
import { SlaHolidayDto, SlaStageConfigDto } from './dto/sla-response.dto';
import { AddSlaHolidayDto, UpdateSlaStageDto } from './dto/sla-request.dto';

const DEPT_ADMIN = 'DEPT_ADMIN';
const SYSTEM_ADMIN = 'SYSTEM_ADMIN';

const STAGE_INCLUDE = {
  workflow: {
    select: {
      id: true,
      name: true,
      version: true,
      isActive: true,
      approvalType: { select: { id: true, name: true } },
    },
  },
} satisfies Prisma.WorkflowStageInclude;

type StageRow = Prisma.WorkflowStageGetPayload<{
  include: typeof STAGE_INCLUDE;
}>;

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

function toStageConfig(row: StageRow): SlaStageConfigDto {
  return {
    id: row.id,
    name: row.name,
    stageType: row.stageType,
    sequenceOrder: row.sequenceOrder,
    departmentId: row.departmentId,
    slaDays: row.slaDays,
    pauseOnQuery: row.slaPauseOnQuery,
    workflowId: row.workflow.id,
    workflowName: row.workflow.name,
    workflowVersion: row.workflow.version,
    workflowActive: row.workflow.isActive,
    approvalTypeId: row.workflow.approvalType.id,
    approvalTypeName: row.workflow.approvalType.name,
  };
}

function toHolidayDto(row: {
  id: string;
  departmentId: string | null;
  holidayDate: Date;
  description: string;
  createdByUserId: string;
  createdAt: Date;
}): SlaHolidayDto {
  return {
    id: row.id,
    departmentId: row.departmentId,
    date: row.holidayDate.toISOString().slice(0, 10),
    description: row.description,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt,
  };
}

/** A real calendar date `YYYY-MM-DD`, as a UTC date. */
function parseDate(value: string): Date {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    throw invalid('date', 'date must be a real calendar date');
  }
  return parsed;
}

interface AdminScope {
  /** Departments where the caller is a Department Administrator. */
  departmentIds: string[];
  /** The caller is a System Administrator: state-wide master data only. */
  statewide: boolean;
}

/**
 * SLA configuration (TRD 12 "SLA definition is configuration, not code";
 * Blueprint 23.1 / 23.4; FRD 21 / 35). Who may change what:
 *
 *  - A stage's duration and pause rule: the DEPARTMENT ADMINISTRATOR of the
 *    department that acts on the stage, and nobody else. A System Administrator
 *    is deliberately excluded - "changing a statutory SLA value" is Business /
 *    Statutory authority a System Administrator never holds (FRD 35.2).
 *  - The working-day calendar: a Department Administrator maintains their own
 *    department's holidays (FRD 21 "holiday calendar overrides"); the state-wide
 *    calendar is master data (Blueprint 12.7) kept by a System Administrator.
 *
 * A change never touches a running clock (each clock snapshots what it started
 * under) and every change is audited with its before and after.
 */
@Injectable()
export class SlaAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly officers: OfficerAccessService,
    private readonly users: UsersService,
  ) {}

  // ---- stage configuration -----------------------------------------------------

  async listStages(userId: string): Promise<SlaStageConfigDto[]> {
    const { departmentIds } = await this.scope(userId);
    if (departmentIds.length === 0) {
      return [];
    }
    const rows = await this.prisma.workflowStage.findMany({
      where: { departmentId: { in: departmentIds } },
      include: STAGE_INCLUDE,
      orderBy: [
        { workflow: { approvalType: { name: 'asc' } } },
        { workflow: { version: 'desc' } },
        { sequenceOrder: 'asc' },
        { id: 'asc' },
      ],
    });
    return rows.map(toStageConfig);
  }

  async updateStage(
    userId: string,
    stageId: string,
    dto: UpdateSlaStageDto,
    ipAddress: string,
  ): Promise<SlaStageConfigDto> {
    if (!isUUID(stageId)) {
      throw notFound('Workflow stage');
    }
    if (dto.slaDays === undefined && dto.pauseOnQuery === undefined) {
      throw invalid('slaDays', 'Provide slaDays and / or pauseOnQuery');
    }
    const { departmentIds } = await this.scope(userId);
    const { before, after } = await this.prisma.$transaction(async (tx) => {
      // Locked, so two administrators editing one stage are serialised and each
      // audit record shows the true before / after.
      await tx.$queryRaw`SELECT id FROM workflow_stages WHERE id = ${stageId}::uuid FOR UPDATE`;
      const current = await tx.workflowStage.findUnique({
        where: { id: stageId },
        include: STAGE_INCLUDE,
      });
      // Not theirs = indistinguishable from nonexistent.
      if (!current || !departmentIds.includes(current.departmentId)) {
        throw notFound('Workflow stage');
      }
      const slaDays = dto.slaDays === undefined ? current.slaDays : dto.slaDays;
      const pauseOnQuery =
        dto.pauseOnQuery === undefined
          ? current.slaPauseOnQuery
          : dto.pauseOnQuery;
      if (
        slaDays === current.slaDays &&
        pauseOnQuery === current.slaPauseOnQuery
      ) {
        throw invalid('slaDays', 'That is already the configured value');
      }
      const updated = await tx.workflowStage.update({
        where: { id: stageId },
        data: { slaDays, slaPauseOnQuery: pauseOnQuery },
        include: STAGE_INCLUDE,
      });
      return { before: current, after: updated };
    });
    await this.audit.record({
      userId,
      roleAtTime: DEPT_ADMIN,
      action: AuditActions.SLA_CONFIGURATION_CHANGED,
      entityType: 'WorkflowStage',
      entityId: after.id,
      beforeState: {
        slaDays: before.slaDays,
        pauseOnQuery: before.slaPauseOnQuery,
      },
      afterState: {
        departmentId: after.departmentId,
        workflowId: after.workflow.id,
        workflowVersion: after.workflow.version,
        approvalTypeId: after.workflow.approvalType.id,
        stageName: after.name,
        slaDays: after.slaDays,
        pauseOnQuery: after.slaPauseOnQuery,
        // Running clocks keep the configuration they started under.
        appliesTo: 'APPLICATIONS_SUBMITTED_AFTER_THIS_CHANGE',
      },
      ipAddress,
    });
    return toStageConfig(after);
  }

  // ---- holiday calendar ------------------------------------------------------------

  async listHolidays(userId: string): Promise<SlaHolidayDto[]> {
    const { departmentIds, statewide } = await this.scope(userId);
    const rows = await this.prisma.slaHoliday.findMany({
      where: statewide
        ? {}
        : {
            OR: [
              { departmentId: null },
              { departmentId: { in: departmentIds } },
            ],
          },
      orderBy: [{ holidayDate: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toHolidayDto);
  }

  async addHoliday(
    userId: string,
    dto: AddSlaHolidayDto,
    ipAddress: string,
  ): Promise<SlaHolidayDto> {
    const date = parseDate(dto.date);
    const { departmentIds, statewide } = await this.scope(userId);
    let roleAtTime: string;
    if (dto.departmentId === undefined) {
      if (!statewide) {
        throw invalid(
          'departmentId',
          'departmentId is required: choose the department whose calendar this is',
        );
      }
      roleAtTime = SYSTEM_ADMIN;
    } else {
      if (!departmentIds.includes(dto.departmentId)) {
        throw new ForbiddenException({
          code: ErrorCodes.FORBIDDEN,
          message:
            'You can only maintain the holiday calendar of a department you administer.',
        });
      }
      roleAtTime = DEPT_ADMIN;
    }
    let created;
    try {
      created = await this.prisma.slaHoliday.create({
        data: {
          departmentId: dto.departmentId ?? null,
          holidayDate: date,
          description: dto.description,
          createdByUserId: userId,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException({
          code: ErrorCodes.HOLIDAY_ALREADY_EXISTS,
          message: 'That date is already in this holiday calendar.',
        });
      }
      throw error;
    }
    await this.audit.record({
      userId,
      roleAtTime,
      action: AuditActions.SLA_HOLIDAY_ADDED,
      entityType: 'SlaHoliday',
      entityId: created.id,
      afterState: {
        departmentId: created.departmentId,
        date: dto.date,
        description: created.description,
        // Clocks already running keep the deadline they were given.
        appliesTo: 'CLOCKS_STARTED_AFTER_THIS_CHANGE',
      },
      ipAddress,
    });
    return toHolidayDto(created);
  }

  async removeHoliday(
    userId: string,
    holidayId: string,
    ipAddress: string,
  ): Promise<void> {
    if (!isUUID(holidayId)) {
      throw notFound('Holiday');
    }
    const { departmentIds, statewide } = await this.scope(userId);
    const holiday = await this.prisma.slaHoliday.findUnique({
      where: { id: holidayId },
    });
    const allowed =
      holiday !== null &&
      (holiday.departmentId === null
        ? statewide
        : departmentIds.includes(holiday.departmentId));
    if (!holiday || !allowed) {
      throw notFound('Holiday');
    }
    const { count } = await this.prisma.slaHoliday.deleteMany({
      where: { id: holiday.id },
    });
    if (count !== 1) {
      throw notFound('Holiday');
    }
    await this.audit.record({
      userId,
      roleAtTime: holiday.departmentId === null ? SYSTEM_ADMIN : DEPT_ADMIN,
      action: AuditActions.SLA_HOLIDAY_REMOVED,
      entityType: 'SlaHoliday',
      entityId: holiday.id,
      beforeState: {
        departmentId: holiday.departmentId,
        date: holiday.holidayDate.toISOString().slice(0, 10),
        description: holiday.description,
      },
      ipAddress,
    });
  }

  // ---- scope ---------------------------------------------------------------------------

  private async scope(userId: string): Promise<AdminScope> {
    const [grants, assignments] = await Promise.all([
      this.officers.grantsFor(userId),
      this.users.getRoleAssignments(userId),
    ]);
    return {
      departmentIds: [
        ...new Set(
          grants
            .filter((g) => g.role === DEPT_ADMIN)
            .map((g) => g.departmentId),
        ),
      ],
      statewide: assignments.some((a) => a.roleCode === SYSTEM_ADMIN),
    };
  }
}
