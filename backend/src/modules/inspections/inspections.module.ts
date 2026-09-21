import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DocumentsModule } from '../documents/documents.module';
import { EnterprisesModule } from '../enterprises/enterprises.module';
import { NotificationsCoreModule } from '../notifications/notifications-core.module';
import { OfficerModule } from '../officer/officer.module';
import { UsersModule } from '../users/users.module';
import { ApplicantInspectionsController } from './applicant-inspections.controller';
import { ApplicantInspectionsService } from './applicant-inspections.service';
import { InspectionAccessService } from './inspection-access.service';
import { InspectionExecutionController } from './inspection-execution.controller';
import { InspectionExecutionService } from './inspection-execution.service';
import { InspectionReportService } from './inspection-report.service';
import {
  ApplicationInspectionsController,
  InspectionsController,
} from './inspections.controller';
import { InspectionsService } from './inspections.service';

/**
 * Inspection foundation (Blueprint InspectionModule, Step 11A). Reuses, and
 * re-implements nothing of, authentication / MFA / RBAC (AuthModule,
 * UsersModule -> RolesGuard) and the department-scoped application access and
 * row-locked, audited write path of the OfficerModule. Prisma and Audit are
 * global.
 */
@Module({
  imports: [
    AuthModule,
    UsersModule,
    OfficerModule,
    DocumentsModule,
    EnterprisesModule,
    NotificationsCoreModule,
  ],
  controllers: [
    ApplicationInspectionsController,
    InspectionsController,
    InspectionExecutionController,
    ApplicantInspectionsController,
  ],
  providers: [
    InspectionsService,
    InspectionAccessService,
    InspectionExecutionService,
    InspectionReportService,
    ApplicantInspectionsService,
  ],
})
export class InspectionsModule {}
