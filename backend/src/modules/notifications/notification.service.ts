import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  NotificationAudience,
  NotificationChannel,
  Prisma,
} from '@prisma/client';
import { AppConfig } from '../../config/configuration';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { NotificationDeliveryService } from './delivery/notification-delivery.service';
import { NotificationEventType } from './notification-events.constant';

export interface CreateNotificationInput {
  recipients: readonly string[];
  eventType: NotificationEventType;
  audience: NotificationAudience;
  title: string;
  message: string;
  /** Non-sensitive structured facts (a due date, a schedule). */
  payload?: Record<string, unknown>;
  /** Identifies THIS occurrence of the event: creating it again (a retry, a
   * duplicate dispatch, two racing requests) is a no-op per recipient and
   * channel. */
  dedupeKey: string;
  enterpriseId?: string | null;
  projectId?: string | null;
  applicationId?: string | null;
}

export interface CreateNotificationResult {
  created: number;
  duplicates: number;
}

const isUniqueViolation = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  error.code === 'P2002';

/**
 * Persists notifications. Every recipient gets the IN_APP row - always, the
 * guaranteed channel (Blueprint 24) - and, when the platform is configured for
 * it, an EMAIL / SMS mirror that the delivery service then sends. There is no
 * public endpoint that reaches this: only the event service, called by the
 * platform's own transitions.
 *
 * Idempotent and race-safe by construction: the (recipient, channel, dedupe
 * key) unique index decides, so two creators of the same event cannot both
 * insert; the loser is counted as a duplicate.
 */
@Injectable()
export class NotificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly delivery: NotificationDeliveryService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  async create(
    input: CreateNotificationInput,
    now: Date = new Date(),
  ): Promise<CreateNotificationResult> {
    const recipients = [...new Set(input.recipients)];
    const { extraChannels } = this.config.get('notifications', {
      infer: true,
    });
    const channels: NotificationChannel[] = ['IN_APP', ...extraChannels];
    const result: CreateNotificationResult = { created: 0, duplicates: 0 };
    const toDeliver: string[] = [];

    for (const userId of recipients) {
      for (const channel of channels) {
        // The common repeat (a re-run sweep, a duplicate dispatch) is answered
        // by a read; the unique index below still decides a genuine race.
        const existing = await this.prisma.notification.findUnique({
          where: {
            userId_channel_dedupeKey: {
              userId,
              channel,
              dedupeKey: input.dedupeKey,
            },
          },
          select: { id: true },
        });
        if (existing) {
          result.duplicates += 1;
          continue;
        }
        try {
          const row = await this.prisma.notification.create({
            data: {
              userId,
              eventType: input.eventType,
              channel,
              audience: input.audience,
              title: input.title,
              message: input.message,
              payload: (input.payload as Prisma.InputJsonValue) ?? undefined,
              dedupeKey: input.dedupeKey,
              enterpriseId: input.enterpriseId ?? null,
              projectId: input.projectId ?? null,
              applicationId: input.applicationId ?? null,
              // The in-app row is its own delivery; a mirror awaits one.
              status: channel === 'IN_APP' ? 'SENT' : 'PENDING',
              sentAt: channel === 'IN_APP' ? now : null,
            },
            select: { id: true },
          });
          result.created += 1;
          if (channel !== 'IN_APP') {
            toDeliver.push(row.id);
          }
        } catch (error) {
          if (!isUniqueViolation(error)) {
            throw error;
          }
          result.duplicates += 1;
        }
      }
    }
    for (const id of toDeliver) {
      this.delivery.deliverInBackground(id);
    }
    return result;
  }
}
