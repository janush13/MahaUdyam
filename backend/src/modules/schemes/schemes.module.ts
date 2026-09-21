import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DocumentsModule } from '../documents/documents.module';
import { EnterprisesModule } from '../enterprises/enterprises.module';
import { NotificationsCoreModule } from '../notifications/notifications-core.module';
import { UsersModule } from '../users/users.module';
import { SchemeAccessService } from './scheme-access.service';
import { SchemeApplicationsService } from './scheme-applications.service';
import { SchemeBrowseService } from './scheme-browse.service';
import { SchemeCatalogueController } from './scheme-catalogue.controller';
import { SchemeCatalogueService } from './scheme-catalogue.service';
import { SchemeEvidenceService } from './scheme-evidence.service';
import { SchemeOfficerService } from './scheme-officer.service';
import { SchemeRecommendationService } from './scheme-recommendation.service';
import { SchemeRulesService } from './scheme-rules.service';
import {
  ApplicantSchemesController,
  SchemeOfficerApplicationsController,
  SchemesPublicController,
} from './schemes.controllers';

/**
 * Schemes / government support services (Blueprint SchemeModule, FRD 29 / 34,
 * TRD 15). Reuses, imports and re-implements NOTHING of: authentication / MFA /
 * RBAC (AuthModule, UsersModule -> RolesGuard), enterprise / project /
 * representative access for the applicant side (EnterprisesModule), document
 * validation, scanning, storage, versioning and download (DocumentsModule), the
 * notification events (NotificationsCoreModule), and the rule-condition grammar
 * and evaluator of approval discovery (imported as pure functions, so approval
 * discovery is not a dependency). Prisma, Audit and Config are global.
 *
 * A module of its own: schemes are a parallel track to approvals (TRD 3), not part
 * of the approval application, officer or decision modules.
 */
@Module({
  imports: [
    AuthModule,
    UsersModule,
    EnterprisesModule,
    DocumentsModule,
    NotificationsCoreModule,
  ],
  controllers: [
    SchemesPublicController,
    ApplicantSchemesController,
    SchemeOfficerApplicationsController,
    SchemeCatalogueController,
  ],
  providers: [
    SchemeAccessService,
    SchemeRulesService,
    SchemeBrowseService,
    SchemeRecommendationService,
    SchemeApplicationsService,
    SchemeCatalogueService,
    SchemeOfficerService,
    SchemeEvidenceService,
  ],
})
export class SchemesModule {}
