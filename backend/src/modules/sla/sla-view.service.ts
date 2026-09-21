import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ErrorCodes } from '../../common/constants/error-codes.constant';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { EnterpriseAccess } from '../enterprises/interfaces/enterprise-access.interface';
import { OfficerAccessService } from '../officer/officer-access.service';
import {
  ApplicantSlaDto,
  ApplicantSlaStatus,
  OfficerSlaDto,
  OfficerSlaItemDto,
  OfficerSlaListDto,
  TIMELINE_NOT_CONFIGURED,
} from './dto/sla-response.dto';
import { ListSlaQueryDto, SLA_DEFAULT_PAGE_SIZE } from './dto/sla-request.dto';
import { SlaCalendarService } from './sla-calendar.service';
import { ClockMetrics, measure } from './sla-clock';

const CLOCK_INCLUDE = {
  applicationStage: {
    select: {
      workflowStage: { select: { id: true, name: true, stageType: true } },
    },
  },
  pauses: { orderBy: [{ pausedAt: 'asc' }, { id: 'asc' }] },
} satisfies Prisma.SlaInstanceInclude;

type ClockRow = Prisma.SlaInstanceGetPayload<{
  include: typeof CLOCK_INCLUDE;
}>;

const notFound = (what: string) =>
  new NotFoundException({
    code: ErrorCodes.NOT_FOUND,
    message: `${what} not found.`,
  });

/**
 * Reading SLA information. Every figure is DERIVED from what the clock stored
 * (its snapshot, its deadline, its pause periods) and the time of the request -
 * never from the stage's present configuration - so a later configuration
 * change cannot alter what any existing application shows.
 *
 * Applicants see only what FRD 25.1 lists, through the enterprise access model
 * they already use; officers see FRD 25.2's countdown, warning and "Breached"
 * through the department / assignment scope of the officer workspace. There is
 * no write here.
 */
@Injectable()
export class SlaViewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly calendar: SlaCalendarService,
    private readonly officers: OfficerAccessService,
  ) {}

  // ---- applicant ------------------------------------------------------------

  async forApplicant(
    access: EnterpriseAccess,
    projectId: string,
    applicationId: string,
    now: Date = new Date(),
  ): Promise<ApplicantSlaDto> {
    const app = await this.prisma.approvalApplication.findFirst({
      where: {
        id: applicationId,
        projectId,
        project: { enterpriseId: access.enterprise.id },
      },
      select: { id: true, submittedAt: true },
    });
    if (!app) {
      throw notFound('Application');
    }
    const clock = await this.prisma.slaInstance.findFirst({
      where: { applicationId },
      include: CLOCK_INCLUDE,
    });
    const configured = clock !== null && clock.dueAt !== null;
    const status: ApplicantSlaStatus =
      app.submittedAt === null || clock === null ? 'NOT_TRACKED' : clock.status;
    const stage = clock?.applicationStage.workflowStage;
    return {
      applicationId,
      submittedAt: app.submittedAt,
      currentStage: stage
        ? { id: stage.id, name: stage.name, type: stage.stageType }
        : null,
      status,
      timelineConfigured: configured,
      timelineMessage: configured ? null : TIMELINE_NOT_CONFIGURED,
      expectedBy: configured ? (clock?.dueAt ?? null) : null,
      waitingForApplicant: clock?.status === 'PAUSED',
      elapsedSinceSubmissionMs: app.submittedAt
        ? Math.max(0, now.getTime() - app.submittedAt.getTime())
        : null,
    };
  }

  // ---- officer ------------------------------------------------------------

  async forOfficer(
    userId: string,
    applicationId: string,
    now: Date = new Date(),
  ): Promise<OfficerSlaDto> {
    const ctx = await this.officers.resolveApplication(
      userId,
      applicationId,
      'VIEW',
    );
    const clock = await this.prisma.slaInstance.findFirst({
      where: { applicationId: ctx.app.id },
      include: CLOCK_INCLUDE,
    });
    const reference = ctx.app.referenceNumber as string;
    if (!clock) {
      return {
        applicationId: ctx.app.id,
        applicationReference: reference,
        stage: null,
        status: 'NOT_CONFIGURED',
        configured: false,
        timelineMessage: TIMELINE_NOT_CONFIGURED,
        slaDays: null,
        pauseOnQuery: false,
        startedAt: null,
        originalDueAt: null,
        dueAt: null,
        pausedAt: null,
        completedAt: null,
        breachedAt: null,
        remainingMs: null,
        breached: false,
        warning: false,
        percentElapsed: null,
        elapsedMs: 0,
        totalPausedMs: 0,
        pauses: [],
      };
    }
    const metrics = this.metricsOf(clock, now);
    const stage = clock.applicationStage.workflowStage;
    return {
      applicationId: ctx.app.id,
      applicationReference: reference,
      stage: { id: stage.id, name: stage.name, type: stage.stageType },
      ...this.headline(clock, metrics),
      timelineMessage: clock.dueAt === null ? TIMELINE_NOT_CONFIGURED : null,
      slaDays: clock.slaDays,
      pauseOnQuery: clock.pauseOnQuery,
      startedAt: clock.startedAt,
      originalDueAt: clock.originalDueAt,
      pausedAt: clock.pausedAt,
      completedAt: clock.completedAt,
      breachedAt: clock.breachedAt,
      elapsedMs: metrics.elapsedMs,
      totalPausedMs: metrics.totalPausedMs,
      pauses: clock.pauses.map((p) => ({
        id: p.id,
        reason: p.reason,
        queryId: p.queryId,
        pausedAt: p.pausedAt,
        resumedAt: p.resumedAt,
        durationMs: Math.max(
          0,
          (p.resumedAt ?? now).getTime() - p.pausedAt.getTime(),
        ),
      })),
    };
  }

  /** The officer's SLA queue (Blueprint OFF-04 "countdown per queue item"):
   * the clocks of exactly the applications the caller's role can already see,
   * most urgent deadline first. */
  async listForOfficer(
    userId: string,
    query: ListSlaQueryDto,
    now: Date = new Date(),
  ): Promise<OfficerSlaListDto> {
    const grants = await this.officers.grantsFor(userId);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? SLA_DEFAULT_PAGE_SIZE;
    const overdueRunning: Prisma.SlaInstanceWhereInput = {
      status: 'RUNNING',
      dueAt: { lt: now },
    };
    const where: Prisma.SlaInstanceWhereInput = {
      application: this.officers.visibilityWhere(userId, grants),
      ...(query.status ? { status: query.status } : {}),
      ...(query.breached === true
        ? { OR: [{ breachedAt: { not: null } }, overdueRunning] }
        : {}),
      ...(query.breached === false
        ? { breachedAt: null, NOT: overdueRunning }
        : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.slaInstance.count({ where }),
      this.prisma.slaInstance.findMany({
        where,
        include: {
          ...CLOCK_INCLUDE,
          application: {
            select: {
              referenceNumber: true,
              approvalType: { select: { name: true, departmentId: true } },
            },
          },
        },
        orderBy: [{ dueAt: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    const items: OfficerSlaItemDto[] = rows.map((row) => ({
      applicationId: row.applicationId,
      applicationReference: row.application.referenceNumber as string,
      approvalType: row.application.approvalType.name,
      departmentId: row.application.approvalType.departmentId,
      stageName: row.applicationStage.workflowStage.name,
      startedAt: row.startedAt,
      ...this.headline(row, this.metricsOf(row, now)),
    }));
    return { items, page, pageSize, total };
  }

  // ---- shared ------------------------------------------------------------

  private metricsOf(clock: ClockRow, now: Date): ClockMetrics {
    return measure(
      clock,
      clock.pauses,
      now,
      this.calendar.settings.warningThresholdPercent,
    );
  }

  private headline(clock: ClockRow, m: ClockMetrics) {
    return {
      status: clock.status,
      configured: clock.dueAt !== null,
      dueAt: clock.dueAt,
      remainingMs: m.remainingMs,
      breached: m.breached,
      warning: m.warning,
      percentElapsed: m.percentElapsed,
    };
  }
}
