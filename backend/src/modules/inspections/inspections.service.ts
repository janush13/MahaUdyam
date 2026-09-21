import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { isUUID } from 'class-validator';
import { ErrorCodes } from '../../common/constants/error-codes.constant';
import { AuditActions } from '../../infrastructure/audit/audit-actions.constant';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  OfficerAccessService,
  OfficerApplicationContext,
} from '../officer/officer-access.service';
import { NotificationEventsService } from '../notifications/notification-events.service';
import { ScrutinySupport } from '../officer/scrutiny-support.service';
import {
  BLOCKING_CONFLICT_STATUSES,
  DEFAULT_PAGE_SIZE,
  INSPECTION_CHANGE_STATES,
  INSPECTION_CREATION_STATES,
  INSPECTOR_ROLE,
  OPEN_STATUSES,
} from './constants/inspection.constants';
import {
  CreateInspectionDto,
  ListInspectionsQueryDto,
  UpdateInspectionDto,
} from './dto/inspection-request.dto';
import {
  InspectionDto,
  InspectionListDto,
} from './dto/inspection-response.dto';
import { InspectionAccessService } from './inspection-access.service';
import {
  INSPECTION_INCLUDE,
  InspectionRow,
  toInspectionDto,
} from './inspection.mapper';
import { planChange, statusFor } from './inspection-rules';

const notFound = () =>
  new NotFoundException({
    code: ErrorCodes.NOT_FOUND,
    message: 'Inspection not found.',
  });

function invalid(field: string, message: string): BadRequestException {
  return new BadRequestException({
    code: ErrorCodes.VALIDATION_ERROR,
    message: 'Validation failed',
    fields: { [field]: [message] },
  });
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

/** A schedule must be a real instant that has not already passed. (The
 * requirements set no minimum lead time or working-hours window, so none is
 * invented — that is per-department policy, TO BE VALIDATED.) */
export function futureInstant(value: string, field: string, now: Date): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw invalid(field, `${field} must be a real date and time`);
  }
  if (date.getTime() <= now.getTime()) {
    throw invalid(field, `${field} must be in the future`);
  }
  return date;
}

/**
 * Inspection foundation (FRD 4.3 / 4.4 / 24; TRD 10, 23; Blueprint 13.7,
 * 12.5): request/assign an inspector and schedule the visit, and read
 * inspections back. Nothing here records a report, finding or completion, and
 * NO application state changes: the TRD arrows around inspection
 * (UNDER_SCRUTINY -> INSPECTION_SCHEDULED -> INSPECTION_COMPLETED) are not
 * executable until the inspection-report step exists to complete the loop.
 *
 * Authorisation is layered on what already exists — JWT + MFA + RolesGuard on
 * the route, then `OfficerAccessService` (writes: the Scrutiny Officer the
 * application is assigned to) or `InspectionAccessService` (reads). Every
 * write runs under the application's row lock (`ScrutinySupport.run`), so it
 * serialises with the scrutiny actions and with a competing inspection request.
 */
@Injectable()
export class InspectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly officers: OfficerAccessService,
    private readonly access: InspectionAccessService,
    private readonly support: ScrutinySupport,
    private readonly notifications: NotificationEventsService,
  ) {}

  // ---- writes -------------------------------------------------------------

  async create(
    userId: string,
    applicationId: string,
    dto: CreateInspectionDto,
    ipAddress: string,
  ): Promise<InspectionDto> {
    const ctx = await this.officers.resolveApplication(
      userId,
      applicationId,
      'SCHEDULE_INSPECTION',
    );
    const scheduledAt = dto.scheduledAt
      ? futureInstant(dto.scheduledAt, 'scheduledAt', new Date())
      : null;

    const row = await this.support.run(ctx, async (tx, locked) => {
      if (!INSPECTION_CREATION_STATES.includes(locked.internalState)) {
        throw new ConflictException({
          code: ErrorCodes.INSPECTION_NOT_MODIFIABLE,
          message:
            'An inspection can be requested only while the application is under scrutiny.',
        });
      }
      await this.assertEligibleInspector(tx, ctx, dto.inspectorUserId);
      const open = await tx.inspection.count({
        where: {
          applicationId: ctx.app.id,
          status: { in: [...OPEN_STATUSES] },
        },
      });
      if (open > 0) {
        throw this.alreadyOpen();
      }
      try {
        return await tx.inspection.create({
          data: {
            applicationId: ctx.app.id,
            inspectorId: dto.inspectorUserId,
            siteAddress: dto.siteAddress,
            scheduledAt,
            status: statusFor(scheduledAt),
            createdByUserId: userId,
            assignedByUserId: userId,
          },
          include: INSPECTION_INCLUDE,
        });
      } catch (error) {
        // The partial unique index is the backstop behind the check above.
        throw isUniqueViolation(error) ? this.alreadyOpen() : error;
      }
    });

    await this.support.recordOfficerEvent(
      ctx,
      AuditActions.INSPECTION_CREATED,
      {
        inspectionId: row.id,
        inspectorUserId: row.inspectorId,
        status: row.status,
        scheduledAt: row.scheduledAt,
      },
      ipAddress,
    );
    // Told once a visit actually has a date (an inspection awaiting one is
    // not yet "scheduled").
    if (row.scheduledAt) {
      await this.notifications.inspectionScheduled(
        ctx.app.id,
        row.id,
        row.scheduledAt,
      );
    }
    return this.toDto(row, true);
  }

  async update(
    userId: string,
    applicationId: string,
    inspectionId: string,
    dto: UpdateInspectionDto,
    ipAddress: string,
  ): Promise<InspectionDto> {
    if (!isUUID(inspectionId)) {
      throw notFound();
    }
    const ctx = await this.officers.resolveApplication(
      userId,
      applicationId,
      'SCHEDULE_INSPECTION',
    );
    const now = new Date();
    const requestedTime = dto.scheduledAt
      ? new Date(dto.scheduledAt)
      : undefined;

    const outcome = await this.support.run(ctx, async (tx, locked) => {
      // Another application's inspection is simply not found here.
      const current = await tx.inspection.findFirst({
        where: { id: inspectionId, applicationId: ctx.app.id },
      });
      if (!current) {
        throw notFound();
      }
      if (
        !INSPECTION_CHANGE_STATES.includes(locked.internalState) ||
        !OPEN_STATUSES.includes(current.status)
      ) {
        throw new ConflictException({
          code: ErrorCodes.INSPECTION_NOT_MODIFIABLE,
          message:
            'This inspection can no longer be changed (it is finished or cancelled, or scrutiny has finished).',
        });
      }

      const plan = planChange(current, {
        inspectorUserId: dto.inspectorUserId,
        scheduledAt: requestedTime,
        siteAddress: dto.siteAddress,
      });
      if (plan.events.length === 0) {
        throw invalid(
          '_',
          'The request changes nothing: give a different inspector, schedule or site.',
        );
      }
      if (plan.data.scheduledAt) {
        futureInstant(dto.scheduledAt as string, 'scheduledAt', now);
      }
      if (plan.data.inspectorId) {
        if (!dto.reason) {
          throw invalid(
            'reason',
            'reason is required when the inspector is changed',
          );
        }
        await this.assertEligibleInspector(tx, ctx, plan.data.inspectorId);
      }

      const row = await tx.inspection.update({
        where: { id: current.id },
        data: {
          ...plan.data,
          ...(plan.data.inspectorId
            ? { assignedByUserId: userId, assignedAt: new Date() }
            : {}),
          // A confirmation refers to one date and one inspector: changing
          // either withdraws it (the database enforces the same rule).
          ...(plan.data.inspectorId || plan.data.scheduledAt
            ? { confirmedAt: null, confirmedByUserId: null }
            : {}),
        },
        include: INSPECTION_INCLUDE,
      });
      return { row, current, plan };
    });

    for (const action of outcome.plan.events) {
      await this.support.recordOfficerEvent(
        ctx,
        action,
        {
          inspectionId: outcome.row.id,
          inspectorUserId: outcome.row.inspectorId,
          status: outcome.row.status,
          scheduledAt: outcome.row.scheduledAt,
          ...(action === AuditActions.INSPECTION_REASSIGNED
            ? { reason: dto.reason }
            : {}),
        },
        ipAddress,
        {
          inspectorUserId: outcome.current.inspectorId,
          status: outcome.current.status,
          scheduledAt: outcome.current.scheduledAt,
        },
      );
    }
    if (outcome.row.scheduledAt) {
      if (outcome.plan.events.includes(AuditActions.INSPECTION_SCHEDULED)) {
        await this.notifications.inspectionScheduled(
          ctx.app.id,
          outcome.row.id,
          outcome.row.scheduledAt,
        );
      }
      if (outcome.plan.events.includes(AuditActions.INSPECTION_RESCHEDULED)) {
        await this.notifications.inspectionRescheduled(
          ctx.app.id,
          outcome.row.id,
          outcome.row.scheduledAt,
          outcome.row.updatedAt,
        );
      }
    }
    return this.toDto(outcome.row, true);
  }

  // ---- reads --------------------------------------------------------------

  /** An application's inspections, newest first — officer roles only. */
  async listForApplication(
    userId: string,
    applicationId: string,
  ): Promise<InspectionDto[]> {
    const ctx = await this.officers.resolveApplication(
      userId,
      applicationId,
      'VIEW',
    );
    const rows = await this.prisma.inspection.findMany({
      where: { applicationId: ctx.app.id },
      include: INSPECTION_INCLUDE,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    });
    return rows.map((r) => this.toDto(r, true));
  }

  /** Every inspection the caller may see, paginated. Officer roles see their
   * application scope; an Inspector sees only their own assignments. */
  async list(
    userId: string,
    query: ListInspectionsQueryDto,
  ): Promise<InspectionListDto> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;
    const from = query.scheduledFrom
      ? new Date(query.scheduledFrom)
      : undefined;
    const to = query.scheduledTo ? new Date(query.scheduledTo) : undefined;
    if (from && to && from.getTime() > to.getTime()) {
      throw invalid(
        'scheduledFrom',
        'scheduledFrom must not be after scheduledTo',
      );
    }
    const scopes = await this.access.scopes(userId);
    const filters: Prisma.InspectionWhereInput[] = [
      { OR: [scopes.officer, scopes.inspector] },
    ];
    if (query.status) {
      filters.push({ status: query.status });
    }
    if (query.applicationId) {
      filters.push({ applicationId: query.applicationId });
    }
    if (from || to) {
      filters.push({
        scheduledAt: { ...(from && { gte: from }), ...(to && { lte: to }) },
      });
    }
    const where: Prisma.InspectionWhereInput = { AND: filters };
    const [total, rows] = await Promise.all([
      this.prisma.inspection.count({ where }),
      this.prisma.inspection.findMany({
        where,
        include: INSPECTION_INCLUDE,
        // Stable: soonest first (unscheduled last), then newest, then id.
        orderBy: [
          { scheduledAt: { sort: 'asc', nulls: 'last' } },
          { createdAt: 'desc' },
          { id: 'asc' },
        ],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    const officerViewIds = await this.officerViewIds(scopes.officer, rows);
    return {
      items: rows.map((r) => this.toDto(r, officerViewIds.has(r.id))),
      page,
      pageSize,
      total,
    };
  }

  async get(userId: string, inspectionId: string): Promise<InspectionDto> {
    if (!isUUID(inspectionId)) {
      throw notFound();
    }
    const scopes = await this.access.scopes(userId);
    const asOfficer = await this.prisma.inspection.findFirst({
      where: { AND: [{ id: inspectionId }, scopes.officer] },
      include: INSPECTION_INCLUDE,
    });
    if (asOfficer) {
      return this.toDto(asOfficer, true);
    }
    const asInspector = await this.prisma.inspection.findFirst({
      where: { AND: [{ id: inspectionId }, scopes.inspector] },
      include: INSPECTION_INCLUDE,
    });
    if (!asInspector) {
      throw notFound();
    }
    return this.toDto(asInspector, false);
  }

  // ---- helpers ------------------------------------------------------------

  /** The rows of this page the caller sees in their OFFICER capacity (one
   * query for the page, not one per row). */
  private async officerViewIds(
    officerScope: Prisma.InspectionWhereInput,
    rows: InspectionRow[],
  ): Promise<Set<string>> {
    if (rows.length === 0) {
      return new Set();
    }
    const visible = await this.prisma.inspection.findMany({
      where: { AND: [{ id: { in: rows.map((r) => r.id) } }, officerScope] },
      select: { id: true },
    });
    return new Set(visible.map((v) => v.id));
  }

  /** The inspector must be an ACTIVE Inspector of THIS application's
   * department (derived from the application, never the request) with no
   * declared / confirmed conflict of interest for this project (TRD 10.1). */
  private async assertEligibleInspector(
    tx: Prisma.TransactionClient,
    ctx: OfficerApplicationContext,
    inspectorUserId: string,
  ): Promise<void> {
    const grant = await tx.userRole.findFirst({
      where: {
        userId: inspectorUserId,
        departmentId: ctx.departmentId,
        role: { code: INSPECTOR_ROLE },
        user: { isActive: true },
      },
      select: { userId: true },
    });
    if (!grant) {
      throw new UnprocessableEntityException({
        code: ErrorCodes.INVALID_ASSIGNEE,
        message:
          'That user is not an active Inspector of this application’s department.',
      });
    }
    const conflict = await tx.inspectorConflict.findFirst({
      where: {
        inspectorId: inspectorUserId,
        projectId: ctx.app.projectId,
        status: { in: [...BLOCKING_CONFLICT_STATUSES] },
      },
      select: { id: true },
    });
    if (conflict) {
      throw new UnprocessableEntityException({
        code: ErrorCodes.INSPECTOR_CONFLICT_OF_INTEREST,
        message:
          'That inspector has a conflict of interest recorded for this project and cannot be assigned.',
      });
    }
  }

  private alreadyOpen(): ConflictException {
    return new ConflictException({
      code: ErrorCodes.INSPECTION_ALREADY_OPEN,
      message:
        'This application already has an inspection that is pending or scheduled; change that one instead.',
    });
  }

  private toDto(row: InspectionRow, officerView: boolean): InspectionDto {
    return toInspectionDto(row, officerView);
  }
}
