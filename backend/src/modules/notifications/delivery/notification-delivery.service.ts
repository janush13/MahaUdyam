import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../../config/configuration';
import { NotificationSettings } from '../../../config/notifications.config';
import { AuditActions } from '../../../infrastructure/audit/audit-actions.constant';
import { AuditService } from '../../../infrastructure/audit/audit.service';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import {
  EMAIL_ADAPTER,
  EmailAdapter,
  SMS_ADAPTER,
  SmsAdapter,
} from './channel-adapters';

export type DeliveryOutcome = 'SENT' | 'FAILED' | 'SKIPPED';

const RETRY_BATCH = 100;

/** Backoff before attempt `attempts + 1` (Blueprint 24: exponential). */
export function nextAttemptDelayMs(
  attempts: number,
  baseSeconds: number,
): number {
  return baseSeconds * 1000 * 2 ** Math.max(0, attempts - 1);
}

/**
 * Delivery of the optional EMAIL / SMS mirrors (Blueprint 24). The in-app row
 * never comes through here: it IS its own delivery.
 *
 *  - Each attempt is CLAIMED by one conditional UPDATE (attempt count
 *    incremented), so the inline attempt and the retry job - or two retry runs -
 *    can never send the same row twice.
 *  - A failure records only a short failure CODE (never provider output or the
 *    message), schedules the next attempt with exponential backoff, and after
 *    the configured maximum leaves the row FAILED for good and audits it
 *    (Blueprint 4.7: "left as FAILED and visible to a System Admin").
 *  - The in-app notification is unaffected by any of this.
 */
@Injectable()
export class NotificationDeliveryService {
  private readonly logger = new Logger(NotificationDeliveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService<AppConfig, true>,
    @Inject(EMAIL_ADAPTER) private readonly email: EmailAdapter,
    @Inject(SMS_ADAPTER) private readonly sms: SmsAdapter,
  ) {}

  get settings(): NotificationSettings {
    return this.config.get('notifications', { infer: true });
  }

  /** "Dispatched via an async function call" (Blueprint, module table): never
   * awaited by the request that caused it, never able to fail it. */
  deliverInBackground(notificationId: string): void {
    this.attempt(notificationId).catch((error: unknown) => {
      this.logger.error(
        `Notification delivery attempt failed unexpectedly: ${(error as Error)?.name ?? 'UnknownError'}`,
      );
    });
  }

  async attempt(
    notificationId: string,
    now: Date = new Date(),
  ): Promise<DeliveryOutcome> {
    const { maxAttempts, retryBaseSeconds } = this.settings;
    const row = await this.prisma.notification.findUnique({
      where: { id: notificationId },
      include: { user: { select: { email: true, mobile: true } } },
    });
    if (
      !row ||
      row.channel === 'IN_APP' ||
      (row.status !== 'PENDING' && row.status !== 'FAILED') ||
      row.attemptCount >= maxAttempts ||
      (row.nextAttemptAt !== null &&
        row.nextAttemptAt.getTime() > now.getTime())
    ) {
      return 'SKIPPED';
    }
    const { count } = await this.prisma.notification.updateMany({
      where: {
        id: row.id,
        status: { in: ['PENDING', 'FAILED'] },
        attemptCount: row.attemptCount,
      },
      data: { attemptCount: { increment: 1 }, nextAttemptAt: null },
    });
    if (count !== 1) {
      return 'SKIPPED';
    }
    const attempts = row.attemptCount + 1;
    try {
      if (row.channel === 'EMAIL') {
        await this.email.send(row.user.email, row.title, row.message);
      } else {
        await this.sms.send(row.user.mobile, row.message);
      }
    } catch {
      const final = attempts >= maxAttempts;
      await this.prisma.notification.update({
        where: { id: row.id },
        data: {
          status: 'FAILED',
          failureReason: 'DELIVERY_ERROR',
          nextAttemptAt: final
            ? null
            : new Date(
                now.getTime() + nextAttemptDelayMs(attempts, retryBaseSeconds),
              ),
        },
      });
      if (final) {
        await this.audit.record({
          userId: null,
          roleAtTime: 'SYSTEM',
          action: AuditActions.NOTIFICATION_DELIVERY_FAILED,
          entityType: 'Notification',
          entityId: row.id,
          afterState: {
            eventType: row.eventType,
            channel: row.channel,
            attempts,
            applicationId: row.applicationId,
          },
          ipAddress: 'system',
        });
      }
      return 'FAILED';
    }
    await this.prisma.notification.update({
      where: { id: row.id },
      data: { status: 'SENT', sentAt: now, failureReason: null },
    });
    return 'SENT';
  }

  /** The scheduled retry (Blueprint 24): every mirror row still owed a delivery
   * whose next attempt is due. */
  async retryDue(now: Date = new Date()): Promise<{ attempted: number }> {
    const { maxAttempts } = this.settings;
    const due = await this.prisma.notification.findMany({
      where: {
        channel: { not: 'IN_APP' },
        status: { in: ['PENDING', 'FAILED'] },
        attemptCount: { lt: maxAttempts },
        OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
      },
      select: { id: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: RETRY_BATCH,
    });
    let attempted = 0;
    for (const { id } of due) {
      if ((await this.attempt(id, now)) !== 'SKIPPED') {
        attempted += 1;
      }
    }
    return { attempted };
  }
}
