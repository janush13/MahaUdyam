import { Injectable } from '@nestjs/common';
import { Prisma, SlaInstance } from '@prisma/client';
import {
  AuditAction,
  AuditActions,
} from '../../infrastructure/audit/audit-actions.constant';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { NotificationEventsService } from '../notifications/notification-events.service';
import { SlaCalendarService } from './sla-calendar.service';
import { extendDue } from './sla-clock';
import { addWorkingDays } from './working-days';

/** One thing that happened to a clock, to be audited once the transaction that
 * caused it has committed. */
export interface SlaEvent {
  action: AuditAction;
  applicationId: string;
  before?: Record<string, unknown>;
  details: Record<string, unknown>;
}

/** Who to attribute the events to. The sweep has no user (`userId: null`). */
export interface SlaActor {
  userId: string | null;
  roleAtTime: string;
  ipAddress: string;
  /** Extra context the caller already holds (enterprise, acting-as, ...). */
  context?: Record<string, unknown>;
  ruleVersionUsed?: string | null;
}

export const SYSTEM_ACTOR: SlaActor = {
  userId: null,
  roleAtTime: 'SYSTEM',
  ipAddress: 'system',
};

/**
 * The SLA clock's lifecycle, driven ONLY by the application's own transitions
 * (TRD 12; Blueprint 23.2). Every method runs INSIDE the transaction - and
 * under the application row lock - of the transition that causes it, so a clock
 * can never disagree with the state of its application, and two racing
 * transitions cannot interleave. Nothing here decides or changes an
 * application's state.
 *
 *   start    at submission                     (the scrutiny stage is entered)
 *   pause    when a query is raised            (only where the stage pauses)
 *   resume   when the applicant answers it
 *   complete when scrutiny finishes            (the recommendation)
 *
 * The clock tracks the workflow's entry SCRUTINY stage in the application's own
 * department. A workflow with no such stage has no clock (nothing is invented);
 * a stage with no configured duration gets a NOT_CONFIGURED clock ("Timeline not
 * yet configured"). What the stage was configured with is SNAPSHOTTED on the
 * clock, so changing the configuration later never re-times an application.
 */
@Injectable()
export class SlaLifecycleService {
  constructor(
    private readonly calendar: SlaCalendarService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationEventsService,
  ) {}

  // ---- start -------------------------------------------------------------

  async startAtSubmission(
    tx: Prisma.TransactionClient,
    applicationId: string,
    now: Date = new Date(),
  ): Promise<SlaEvent[]> {
    const app = await tx.approvalApplication.findUnique({
      where: { id: applicationId },
      select: {
        workflowId: true,
        projectId: true,
        approvalType: { select: { departmentId: true } },
      },
    });
    if (!app) {
      return [];
    }
    const departmentId = app.approvalType.departmentId;
    const stage = await tx.workflowStage.findFirst({
      where: {
        workflowId: app.workflowId,
        stageType: 'SCRUTINY',
        departmentId,
        // Entry stage: nothing it waits for (Blueprint 9.2, depends_on NULL).
        dependencies: { none: {} },
      },
      orderBy: [{ sequenceOrder: 'asc' }, { id: 'asc' }],
    });
    if (!stage) {
      return [];
    }
    const due =
      stage.slaDays === null
        ? null
        : addWorkingDays(
            now,
            stage.slaDays,
            await this.calendar.forDepartment(tx, stage.departmentId, now),
          );
    const applicationStage = await tx.applicationStage.create({
      data: {
        applicationId,
        workflowStageId: stage.id,
        status: 'ACTIVE',
        startedAt: now,
      },
    });
    const clock = await tx.slaInstance.create({
      data: {
        applicationId,
        applicationStageId: applicationStage.id,
        status: due === null ? 'NOT_CONFIGURED' : 'RUNNING',
        startedAt: now,
        slaDays: stage.slaDays,
        pauseOnQuery: stage.slaPauseOnQuery,
        originalDueAt: due,
        dueAt: due,
      },
    });
    return [
      {
        action: AuditActions.SLA_STARTED,
        applicationId,
        details: {
          ...this.scope(app.projectId, departmentId, clock),
          stageName: stage.name,
          configured: due !== null,
          slaDays: stage.slaDays,
          pauseOnQuery: stage.slaPauseOnQuery,
          startedAt: now,
          dueAt: due,
        },
      },
    ];
  }

  // ---- pause / resume ------------------------------------------------------

  /** A query was raised: the clock stops, where the stage is configured to. */
  async pauseForQuery(
    tx: Prisma.TransactionClient,
    applicationId: string,
    queryId: string,
    now: Date = new Date(),
  ): Promise<SlaEvent[]> {
    const clock = await tx.slaInstance.findFirst({
      where: { applicationId, status: 'RUNNING', pauseOnQuery: true },
    });
    if (!clock) {
      // No clock, no timeline configured, or a stage that keeps running during
      // a query (TRD 12: "must not be assumed uniformly true").
      return [];
    }
    const events = await this.breachIfLate(tx, clock, now, 'PAUSE');
    await tx.slaPause.create({
      data: {
        slaInstanceId: clock.id,
        reason: 'QUERY_AWAITING_APPLICANT',
        queryId,
        pausedAt: now,
      },
    });
    await tx.slaInstance.update({
      where: { id: clock.id },
      data: { status: 'PAUSED', pausedAt: now },
    });
    events.push({
      action: AuditActions.SLA_PAUSED,
      applicationId,
      details: {
        ...(await this.scopeOf(tx, applicationId, clock)),
        reason: 'QUERY_AWAITING_APPLICANT',
        queryId,
        pausedAt: now,
        dueAt: clock.dueAt,
      },
    });
    return events;
  }

  /** The applicant answered the query: the clock resumes, its deadline moved
   * forward by exactly the time it was paused. */
  async resumeForQuery(
    tx: Prisma.TransactionClient,
    applicationId: string,
    queryId: string,
    now: Date = new Date(),
  ): Promise<SlaEvent[]> {
    const pause = await tx.slaPause.findFirst({
      where: {
        queryId,
        resumedAt: null,
        slaInstance: { applicationId, status: 'PAUSED' },
      },
      include: { slaInstance: true },
    });
    if (!pause) {
      return [];
    }
    const clock = pause.slaInstance;
    const dueAt = extendDue(clock.dueAt as Date, pause.pausedAt, now);
    await tx.slaPause.update({
      where: { id: pause.id },
      data: { resumedAt: now },
    });
    await tx.slaInstance.update({
      where: { id: clock.id },
      data: { status: 'RUNNING', pausedAt: null, dueAt },
    });
    return [
      {
        action: AuditActions.SLA_RESUMED,
        applicationId,
        before: { dueAt: clock.dueAt },
        details: {
          ...(await this.scopeOf(tx, applicationId, clock)),
          queryId,
          pausedAt: pause.pausedAt,
          resumedAt: now,
          pausedMs: now.getTime() - pause.pausedAt.getTime(),
          dueAt,
        },
      },
    ];
  }

  // ---- complete ------------------------------------------------------------

  /** Scrutiny finished (the recommendation): the stage's clock ends; no further
   * calculation applies to it (Blueprint 23.2 "Completion"). */
  async completeScrutiny(
    tx: Prisma.TransactionClient,
    applicationId: string,
    now: Date = new Date(),
  ): Promise<SlaEvent[]> {
    const clock = await tx.slaInstance.findFirst({
      where: { applicationId, status: { in: ['RUNNING', 'NOT_CONFIGURED'] } },
    });
    if (!clock) {
      return [];
    }
    const events = await this.breachIfLate(tx, clock, now, 'COMPLETION');
    const breached =
      clock.breachedAt !== null ||
      (clock.dueAt !== null && now.getTime() > clock.dueAt.getTime());
    await tx.slaInstance.update({
      where: { id: clock.id },
      data: { status: 'COMPLETED', completedAt: now },
    });
    await tx.applicationStage.update({
      where: { id: clock.applicationStageId },
      data: { status: 'COMPLETED', completedAt: now },
    });
    events.push({
      action: AuditActions.SLA_COMPLETED,
      applicationId,
      details: {
        ...(await this.scopeOf(tx, applicationId, clock)),
        configured: clock.dueAt !== null,
        completedAt: now,
        dueAt: clock.dueAt,
        withinTimeline: clock.dueAt === null ? null : !breached,
      },
    });
    return events;
  }

  // ---- breach ----------------------------------------------------------------

  /** A state event found the deadline already passed: record the breach then
   * (once), so a clock cannot pause or complete its way out of one. */
  private async breachIfLate(
    tx: Prisma.TransactionClient,
    clock: SlaInstance,
    now: Date,
    detectedBy: 'PAUSE' | 'COMPLETION',
  ): Promise<SlaEvent[]> {
    if (
      clock.breachedAt !== null ||
      clock.dueAt === null ||
      now.getTime() <= clock.dueAt.getTime()
    ) {
      return [];
    }
    // Conditional: a sweep may have recorded this breach a moment ago, and a
    // recorded breach is never rewritten (the database refuses it).
    const { count } = await tx.slaInstance.updateMany({
      where: { id: clock.id, breachedAt: null },
      data: { breachedAt: now },
    });
    if (count !== 1) {
      return [];
    }
    return [
      {
        action: AuditActions.SLA_BREACHED,
        applicationId: clock.applicationId,
        details: {
          ...(await this.scopeOf(tx, clock.applicationId, clock)),
          dueAt: clock.dueAt,
          breachedAt: now,
          detectedBy,
        },
      },
    ];
  }

  // ---- audit -------------------------------------------------------------------

  /** Audits committed events (entity = the application, like every other
   * application event, so they appear in its history). */
  async record(events: readonly SlaEvent[], actor: SlaActor): Promise<void> {
    for (const event of events) {
      await this.audit.record({
        userId: actor.userId,
        roleAtTime: actor.roleAtTime,
        action: event.action,
        entityType: 'ApprovalApplication',
        entityId: event.applicationId,
        beforeState: event.before,
        afterState: { ...actor.context, ...event.details },
        ipAddress: actor.ipAddress,
        ruleVersionUsed: actor.ruleVersionUsed ?? null,
      });
      // A breach - however it was found (sweep, pause, completion) - is told to
      // the officers once: it was recorded once, and the dispatch is idempotent.
      if (event.action === AuditActions.SLA_BREACHED) {
        const { slaInstanceId, dueAt } = event.details as {
          slaInstanceId: string;
          dueAt: Date;
        };
        await this.notifications.slaBreached(
          event.applicationId,
          slaInstanceId,
          dueAt,
        );
      }
    }
  }

  // ---- context -------------------------------------------------------------------

  private scope(projectId: string, departmentId: string, clock: SlaInstance) {
    return {
      slaInstanceId: clock.id,
      applicationId: clock.applicationId,
      projectId,
      departmentId,
    };
  }

  private async scopeOf(
    tx: Prisma.TransactionClient,
    applicationId: string,
    clock: SlaInstance,
  ) {
    const app = await tx.approvalApplication.findUniqueOrThrow({
      where: { id: applicationId },
      select: {
        projectId: true,
        approvalType: { select: { departmentId: true } },
      },
    });
    return this.scope(app.projectId, app.approvalType.departmentId, clock);
  }
}
