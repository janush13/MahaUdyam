import { Module } from '@nestjs/common';
import { ApplicationsModule } from '../applications/applications.module';
import { AuthModule } from '../auth/auth.module';
import { DocumentsModule } from '../documents/documents.module';
import { EnterprisesModule } from '../enterprises/enterprises.module';
import { NotificationsCoreModule } from '../notifications/notifications-core.module';
import { SlaCoreModule } from '../sla/sla-core.module';
import { UsersModule } from '../users/users.module';
import { ApplicationQueriesController } from './application-queries.controller';
import { AssignmentService } from './assignment.service';
import { OfficerAccessService } from './officer-access.service';
import { OfficerWorkspaceService } from './officer-workspace.service';
import { OfficerController } from './officer.controller';
import { QueriesService } from './queries.service';
import { ScrutinyService } from './scrutiny.service';
import { ScrutinySupport } from './scrutiny-support.service';

/**
 * Officer workspace + application scrutiny (Blueprint OfficerModule).
 * Reuses, imports and re-implements NOTHING of: authentication / MFA / RBAC
 * (AuthModule, UsersModule -> RolesGuard), enterprise access for the applicant
 * side of queries (EnterprisesModule), the application and document services
 * (ApplicationsModule, DocumentsModule). Prisma and Audit are global.
 */
@Module({
  imports: [
    AuthModule,
    UsersModule,
    EnterprisesModule,
    ApplicationsModule,
    DocumentsModule,
    SlaCoreModule,
    NotificationsCoreModule,
  ],
  controllers: [OfficerController, ApplicationQueriesController],
  providers: [
    OfficerAccessService,
    ScrutinySupport,
    OfficerWorkspaceService,
    ScrutinyService,
    QueriesService,
    AssignmentService,
  ],
  exports: [OfficerAccessService, ScrutinySupport],
})
export class OfficerModule {}
