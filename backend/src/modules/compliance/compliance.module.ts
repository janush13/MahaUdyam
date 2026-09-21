import { Module } from '@nestjs/common';
import { ApplicationsModule } from '../applications/applications.module';
import { AuthModule } from '../auth/auth.module';
import { DocumentsModule } from '../documents/documents.module';
import { EnterprisesModule } from '../enterprises/enterprises.module';
import { NotificationsCoreModule } from '../notifications/notifications-core.module';
import { OfficerModule } from '../officer/officer.module';
import { SlaCoreModule } from '../sla/sla-core.module';
import { UsersModule } from '../users/users.module';
import { ComplianceAdminService } from './compliance-admin.service';
import { ComplianceFulfilmentService } from './compliance-fulfilment.service';
import { ComplianceLifecycleService } from './compliance-lifecycle.service';
import { ComplianceSyncService } from './compliance-sync.service';
import { ComplianceViewService } from './compliance-view.service';
import {
  ApplicantComplianceController,
  ComplianceAdminController,
  OfficerComplianceController,
} from './compliance.controllers';

/**
 * Compliance management (Blueprint ComplianceModule: "post-approval obligation
 * tracking"). Everything is reused, nothing re-implemented: authentication /
 * MFA / RBAC (AuthModule, UsersModule -> RolesGuard), the enterprise access
 * model and the application lookup (EnterprisesModule, ApplicationsModule), the
 * department-scoped officer access (OfficerModule), Step 9's document pipeline
 * (DocumentsModule), the calendar's UTC offset (SlaCoreModule) and the
 * notification mechanism (NotificationsCoreModule). Prisma and Audit are
 * global; the hourly job rides the ScheduleModule the SLA module registers.
 */
@Module({
  imports: [
    AuthModule,
    UsersModule,
    EnterprisesModule,
    ApplicationsModule,
    OfficerModule,
    DocumentsModule,
    SlaCoreModule,
    NotificationsCoreModule,
  ],
  controllers: [
    ApplicantComplianceController,
    OfficerComplianceController,
    ComplianceAdminController,
  ],
  providers: [
    ComplianceLifecycleService,
    ComplianceSyncService,
    ComplianceViewService,
    ComplianceFulfilmentService,
    ComplianceAdminService,
  ],
  exports: [ComplianceLifecycleService],
})
export class ComplianceModule {}
