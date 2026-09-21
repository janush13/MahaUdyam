import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthModule } from '../auth/auth.module';
import { EnterprisesModule } from '../enterprises/enterprises.module';
import { NotificationsCoreModule } from '../notifications/notifications-core.module';
import { OfficerModule } from '../officer/officer.module';
import { UsersModule } from '../users/users.module';
import { SlaAdminService } from './sla-admin.service';
import { SlaSweepService } from './sla-sweep.service';
import { SlaViewService } from './sla-view.service';
import {
  ApplicantSlaController,
  OfficerSlaController,
  SlaAdminController,
} from './sla.controllers';
import { SlaCoreModule } from './sla-core.module';

/**
 * SLA management (Step 12): the read views (applicant, officer), the
 * department-scoped configuration, and the hourly breach sweep (the one
 * in-process @nestjs/schedule cron - no queue, no worker). Authentication /
 * MFA / RBAC (AuthModule, UsersModule -> RolesGuard), the enterprise access
 * model (EnterprisesModule) and the department-scoped officer access
 * (OfficerModule) are reused, not re-implemented.
 */
@Module({
  imports: [
    ScheduleModule.forRoot(),
    AuthModule,
    UsersModule,
    EnterprisesModule,
    OfficerModule,
    SlaCoreModule,
    NotificationsCoreModule,
  ],
  controllers: [
    ApplicantSlaController,
    OfficerSlaController,
    SlaAdminController,
  ],
  providers: [SlaViewService, SlaAdminService, SlaSweepService],
})
export class SlaModule {}
