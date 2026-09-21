import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../config/configuration';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { NotificationEventsService } from '../notifications/notification-events.service';
import {
  ComplianceEvent,
  ComplianceLifecycleService,
  ComplianceScope,
  SYSTEM_ACTOR,
} from './compliance-lifecycle.service';

export interface ComplianceSyncResult {
  /** Obligation occurrences created this run. */
  created: number;
  /** Status changes made this run (UPCOMING -> DUE -> OVERDUE). */
  advanced: number;
}

/**
 * The hourly compliance job (Blueprint 4.7: "scheduled compliance-deadline
 * checks" by the in-process @nestjs/schedule cron - no queue, no worker):
 *
 *   1. give every ACTIVE application the occurrences it is missing;
 *   2. move every not-yet-fulfilled obligation to where today puts it;
 *   3. tell the applicant side of each obligation that just became DUE
 *      (FRD 26.1 "compliance deadline approaching") through the existing
 *      NotificationEventsService - after the change is committed, and never
 *      able to fail it.
 *
 * Idempotent: a second run over the same state finds nothing to do (creation is
 * checked under the application lock and by a unique index; status changes are
 * conditional), so running it twice, or two at once, changes and notifies once.
 * A failed run is logged and the next hour retries. `run(now)` takes the time so
 * it can be driven deterministically.
 */
@Injectable()
export class ComplianceSyncService {
  private readonly logger = new Logger(ComplianceSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly lifecycle: ComplianceLifecycleService,
    private readonly notifications: NotificationEventsService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  @Cron('30 * * * *', { name: 'compliance-sync' })
  async scheduled(): Promise<void> {
    if (!this.config.get('compliance', { infer: true }).syncEnabled) {
      return;
    }
    try {
      const { created, advanced } = await this.run();
      if (created > 0 || advanced > 0) {
        this.logger.log(
          `Compliance sync: ${created} obligation(s) created, ${advanced} status change(s).`,
        );
      }
    } catch (error) {
      // Only what it IS: a failed statement can embed values.
      this.logger.error(
        `Compliance sync failed: ${(error as Error)?.name ?? 'UnknownError'}`,
      );
    }
  }

  async run(
    now: Date = new Date(),
    only?: ComplianceScope,
  ): Promise<ComplianceSyncResult> {
    let created = 0;
    let after: string | undefined;
    for (;;) {
      const ids = await this.lifecycle.activeApplicationsAfter(after, only);
      if (ids.length === 0) {
        break;
      }
      for (const applicationId of ids) {
        const events: ComplianceEvent[] = await this.prisma.$transaction(
          (tx) => this.lifecycle.ensureOccurrences(tx, applicationId, now),
          { timeout: 20_000 },
        );
        created += events.length;
        await this.lifecycle.record(events, SYSTEM_ACTOR);
      }
      after = ids[ids.length - 1];
    }

    const { events, becameDue } = await this.lifecycle.advanceStatuses(
      now,
      only,
    );
    await this.lifecycle.record(events, SYSTEM_ACTOR);
    for (const due of becameDue) {
      await this.notifications.complianceDeadlineApproaching(
        due.applicationId,
        due.recordId,
        due.dueDate,
      );
    }
    return { created, advanced: events.length };
  }
}
