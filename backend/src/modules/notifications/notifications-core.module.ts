import { Module } from '@nestjs/common';
import {
  EMAIL_ADAPTER,
  MockEmailProvider,
  MockSmsProvider,
  SMS_ADAPTER,
} from './delivery/channel-adapters';
import { NotificationDeliveryService } from './delivery/notification-delivery.service';
import { NotificationEventsService } from './notification-events.service';
import { NotificationRecipientsService } from './notification-recipients.service';
import { NotificationService } from './notification.service';

/**
 * Raising notifications (Blueprint NotificationModule: "event-to-notification
 * dispatch, channel adapters, retry"). Depends on nothing but the global
 * Prisma / Audit / Config, so the modules that own the transitions (applications,
 * officer, inspections, enterprises, SLA) can import it without a cycle. The
 * HTTP surface and the retry job live in NotificationsModule.
 *
 * Adapters: only the mock providers exist (Blueprint 25.2); configuration
 * refuses any other provider name at start-up.
 */
@Module({
  providers: [
    { provide: EMAIL_ADAPTER, useClass: MockEmailProvider },
    { provide: SMS_ADAPTER, useClass: MockSmsProvider },
    NotificationDeliveryService,
    NotificationRecipientsService,
    NotificationService,
    NotificationEventsService,
  ],
  exports: [NotificationEventsService, NotificationDeliveryService],
})
export class NotificationsCoreModule {}
