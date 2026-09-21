import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AuditActions } from '../../infrastructure/audit/audit-actions.constant';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { NotificationEventsService } from '../notifications/notification-events.service';
import { SlaCalendarService } from './sla-calendar.service';
import { measure } from './sla-clock';
import { SYSTEM_ACTOR, SlaLifecycleService } from './sla-lifecycle.service';

const BATCH = 200;

/** Restricts a run to some applications' clocks (a targeted re-check; the
 * tests use it so that parallel suites cannot sweep each other's fixtures).
 * Omitted, a run covers every clock, as the hourly cron does. */
export interface SweepScope {
  applicationIds: readonly string[];
}

const scoped = (only?: SweepScope) =>
  only ? { applicationId: { in: [...only.applicationIds] } } : {};

/**
 * Breach detection (Blueprint 23.3): a deadline that has passed on a RUNNING
 * clock is recorded ONCE, as `breached_at`, and audited.
 *
 *  - Deterministic: "breached" is exactly `due_at < now` for a running clock.
 *    A paused clock is frozen and a completed one is decided at completion, so
 *    neither is touched here.
 *  - Idempotent and race-safe: each clock is claimed with ONE conditional
 *    UPDATE (`... WHERE status = RUNNING AND breached_at IS NULL AND due_at <
 *    now`), re-evaluated by PostgreSQL after it takes the row lock. Two sweeps
 *    (or a sweep and a pause / completion) racing on a clock cannot both claim
 *    it, so a breach is recorded and audited exactly once and running the sweep
 *    again is a no-op.
 *  - It is the ONLY periodic job: a single in-process @nestjs/schedule cron, no
 *    queue, no worker. A failed run is logged and the next hourly run retries
 *    (Blueprint 4.7). It sends no notification (that module does not exist yet).
 *
 * `sweep(now)` takes the time so it can be driven deterministically.
 */
@Injectable()
export class SlaSweepService {
  private readonly logger = new Logger(SlaSweepService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly lifecycle: SlaLifecycleService,
    private readonly calendar: SlaCalendarService,
    private readonly notifications: NotificationEventsService,
  ) {}

  @Cron('0 * * * *', { name: 'sla-breach-sweep' })
  async scheduled(): Promise<void> {
    if (!this.calendar.settings.sweepEnabled) {
      return;
    }
    try {
      const { breached } = await this.sweep();
      if (breached > 0) {
        this.logger.log(`SLA sweep recorded ${breached} breach(es).`);
      }
      await this.warn();
    } catch (error) {
      // Only what it IS: a failed statement can embed values.
      this.logger.error(
        `SLA sweep failed: ${(error as Error)?.name ?? 'UnknownError'}`,
      );
    }
  }

  async sweep(
    now: Date = new Date(),
    only?: SweepScope,
  ): Promise<{ breached: number }> {
    let breached = 0;
    let after: string | undefined;
    for (;;) {
      const candidates = await this.prisma.slaInstance.findMany({
        where: {
          status: 'RUNNING',
          breachedAt: null,
          dueAt: { lt: now },
          ...scoped(only),
          ...(after ? { id: { gt: after } } : {}),
        },
        select: { id: true, applicationId: true, dueAt: true },
        orderBy: { id: 'asc' },
        take: BATCH,
      });
      if (candidates.length === 0) {
        return { breached };
      }
      for (const clock of candidates) {
        const { count } = await this.prisma.slaInstance.updateMany({
          where: {
            id: clock.id,
            status: 'RUNNING',
            breachedAt: null,
            dueAt: { lt: now },
          },
          data: { breachedAt: now },
        });
        if (count === 1) {
          breached += 1;
          await this.auditBreach(clock, now);
        }
      }
      after = candidates[candidates.length - 1].id;
    }
  }

  /**
   * The warning threshold (Blueprint 23.3: "e.g., 80% elapsed -> warning"): a
   * RUNNING, unbreached clock whose elapsed share of its window has reached the
   * CONFIGURED `SLA_WARNING_THRESHOLD_PERCENT` is told to the officers. There is
   * no default threshold, so with none configured nothing happens.
   *
   * The arithmetic is `measure()` from sla-clock.ts - the one the officer views
   * use - not a second implementation. Nothing is recorded on the clock: the
   * notification's own dedupe key (one per clock) makes a repeat run a no-op,
   * so this is idempotent and cannot warn twice. A paused clock is not warned
   * (its `measure` warning is false), a breached one is the breach's business.
   */
  async warn(
    now: Date = new Date(),
    only?: SweepScope,
  ): Promise<{ atThreshold: number }> {
    const threshold = this.calendar.settings.warningThresholdPercent;
    if (threshold === null) {
      return { atThreshold: 0 };
    }
    let atThreshold = 0;
    let after: string | undefined;
    for (;;) {
      const clocks = await this.prisma.slaInstance.findMany({
        where: {
          status: 'RUNNING',
          breachedAt: null,
          dueAt: { gte: now },
          ...scoped(only),
          ...(after ? { id: { gt: after } } : {}),
        },
        include: { pauses: { select: { pausedAt: true, resumedAt: true } } },
        orderBy: { id: 'asc' },
        take: BATCH,
      });
      if (clocks.length === 0) {
        return { atThreshold };
      }
      for (const clock of clocks) {
        const metrics = measure(clock, clock.pauses, now, threshold);
        if (metrics.warning && clock.dueAt !== null) {
          atThreshold += 1;
          await this.notifications.slaWarning(
            clock.applicationId,
            clock.id,
            clock.dueAt,
            metrics.percentElapsed ?? threshold,
          );
        }
      }
      after = clocks[clocks.length - 1].id;
    }
  }

  private async auditBreach(
    clock: { id: string; applicationId: string; dueAt: Date | null },
    now: Date,
  ): Promise<void> {
    const app = await this.prisma.approvalApplication.findUniqueOrThrow({
      where: { id: clock.applicationId },
      select: {
        projectId: true,
        approvalType: { select: { departmentId: true } },
      },
    });
    await this.lifecycle.record(
      [
        {
          action: AuditActions.SLA_BREACHED,
          applicationId: clock.applicationId,
          details: {
            slaInstanceId: clock.id,
            applicationId: clock.applicationId,
            projectId: app.projectId,
            departmentId: app.approvalType.departmentId,
            dueAt: clock.dueAt,
            breachedAt: now,
            detectedBy: 'SWEEP',
          },
        },
      ],
      SYSTEM_ACTOR,
    );
  }
}
