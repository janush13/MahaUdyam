import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NotificationsCoreModule } from '../notifications/notifications-core.module';
import { UsersModule } from '../users/users.module';
import { EnterpriseAccessService } from './enterprise-access.service';
import { EnterprisesController } from './enterprises.controller';
import { EnterprisesService } from './enterprises.service';
import { EnterpriseAccessGuard } from './guards/enterprise-access.guard';
import { RepresentativeAuthorisationsController } from './representative-authorisations.controller';
import { RepresentativesController } from './representatives.controller';
import { RepresentativesService } from './representatives.service';

/**
 * Enterprise CRUD + representative authorisation (Blueprint EnterpriseModule,
 * FRD §20). EnterpriseAccessService/Guard are exported so later modules
 * (projects, applications, documents) authorise enterprise-scoped routes
 * with the same primitive instead of re-implementing ownership checks.
 * Prisma and Audit are global modules.
 */
@Module({
  imports: [AuthModule, UsersModule, NotificationsCoreModule],
  controllers: [
    EnterprisesController,
    RepresentativesController,
    RepresentativeAuthorisationsController,
  ],
  providers: [
    EnterprisesService,
    RepresentativesService,
    EnterpriseAccessService,
    EnterpriseAccessGuard,
  ],
  exports: [EnterpriseAccessService, EnterpriseAccessGuard],
})
export class EnterprisesModule {}
