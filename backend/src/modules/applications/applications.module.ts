import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { EnterprisesModule } from '../enterprises/enterprises.module';
import { NotificationsCoreModule } from '../notifications/notifications-core.module';
import { SlaCoreModule } from '../sla/sla-core.module';
import { UsersModule } from '../users/users.module';
import { ApplicationsController } from './applications.controller';
import { ApplicationsService } from './applications.service';

/**
 * Application lifecycle (Blueprint ApplicationModule). Authorisation reuses
 * the enterprise module's EnterpriseAccessService/Guard — imported, not
 * re-implemented. It reads the Step 7 discovery snapshots straight from the
 * database (they are immutable records), so it does not depend on the
 * discovery module. UsersModule: RolesGuard (applied via @UseGuards) resolves
 * UsersService in the consuming module's context. Prisma and Audit are global.
 */
@Module({
  imports: [
    AuthModule,
    UsersModule,
    EnterprisesModule,
    SlaCoreModule,
    NotificationsCoreModule,
  ],
  controllers: [ApplicationsController],
  providers: [ApplicationsService],
  exports: [ApplicationsService],
})
export class ApplicationsModule {}
