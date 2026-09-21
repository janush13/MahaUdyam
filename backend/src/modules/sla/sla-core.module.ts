import { Module } from '@nestjs/common';
import { NotificationsCoreModule } from '../notifications/notifications-core.module';
import { SlaCalendarService } from './sla-calendar.service';
import { SlaLifecycleService } from './sla-lifecycle.service';

/**
 * The SLA clock itself (Blueprint SlaModule: "SLA config, clock logic"): the
 * calendar and the lifecycle that the application, scrutiny and query
 * transitions call INSIDE their own transactions. It depends on nothing but the
 * global Prisma / Audit / Config, so the modules that own those transitions can
 * import it without a cycle. The HTTP surface and the sweep live in SlaModule.
 */
@Module({
  imports: [NotificationsCoreModule],
  providers: [SlaCalendarService, SlaLifecycleService],
  exports: [SlaCalendarService, SlaLifecycleService],
})
export class SlaCoreModule {}
