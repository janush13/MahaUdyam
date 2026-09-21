import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { NotificationDeliveryService } from './delivery/notification-delivery.service';

/**
 * Blueprint 24 / 4.7: "a scheduled job retries failures" - the in-process
 * @nestjs/schedule cron, no queue or worker. It only ever touches the optional
 * EMAIL / SMS mirrors; in-app notifications are complete when written. A failed
 * run is logged and the next minute retries.
 */
@Injectable()
export class NotificationRetryJob {
  private readonly logger = new Logger(NotificationRetryJob.name);

  constructor(private readonly delivery: NotificationDeliveryService) {}

  @Cron('* * * * *', { name: 'notification-delivery-retry' })
  async scheduled(): Promise<void> {
    if (!this.delivery.settings.retryEnabled) {
      return;
    }
    try {
      await this.delivery.retryDue();
    } catch (error) {
      this.logger.error(
        `Notification retry run failed: ${(error as Error)?.name ?? 'UnknownError'}`,
      );
    }
  }
}
