import { Module } from '@nestjs/common';
import { OfficerModule } from '../officer/officer.module';
import { NotificationAccessService } from './notification-access.service';
import { NotificationRetryJob } from './notification-retry.job';
import { NotificationsController } from './notifications.controller';
import { NotificationsCoreModule } from './notifications-core.module';
import { NotificationsService } from './notifications.service';

/**
 * The in-app notification centre and the delivery-retry job. JWT + MFA are the
 * global guards; there is no role restriction (any authenticated user has their
 * own notifications) - what a caller may READ is decided per row by
 * `NotificationAccessService`, reusing the enterprise / officer access rules.
 */
@Module({
  imports: [OfficerModule, NotificationsCoreModule],
  controllers: [NotificationsController],
  providers: [
    NotificationAccessService,
    NotificationsService,
    NotificationRetryJob,
  ],
})
export class NotificationsModule {}
