import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ComplianceModule } from '../compliance/compliance.module';
import { DocumentsModule } from '../documents/documents.module';
import { EnterprisesModule } from '../enterprises/enterprises.module';
import { NotificationsCoreModule } from '../notifications/notifications-core.module';
import { OfficerModule } from '../officer/officer.module';
import { UsersModule } from '../users/users.module';
import { CertificateService } from './certificate.service';
import { DecisionViewService } from './decision-view.service';
import {
  ApplicantDecisionController,
  OfficerDecisionController,
} from './decision.controllers';
import { DecisionService } from './decision.service';

/**
 * The Approving Authority's decision and the certificate it leads to (Step 15).
 * Reuses, imports and re-implements NOTHING of: authentication / MFA / RBAC
 * (AuthModule, UsersModule -> RolesGuard), department-scoped officer
 * authorisation and the application row lock / audit helpers (OfficerModule),
 * enterprise access for the applicant side (EnterprisesModule), document
 * storage, scanning and download (DocumentsModule), the compliance calendar's
 * occurrence creation (ComplianceModule) and the notification events
 * (NotificationsCoreModule). Prisma and Audit are global.
 *
 * A module of its own, not part of OfficerModule, because ComplianceModule
 * already imports OfficerModule: activation needs both, and neither may import
 * the other's dependant.
 */
@Module({
  imports: [
    AuthModule,
    UsersModule,
    EnterprisesModule,
    OfficerModule,
    DocumentsModule,
    ComplianceModule,
    NotificationsCoreModule,
  ],
  controllers: [OfficerDecisionController, ApplicantDecisionController],
  providers: [DecisionService, CertificateService, DecisionViewService],
})
export class DecisionModule {}
