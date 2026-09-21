import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { EnterprisesModule } from '../enterprises/enterprises.module';
import { UsersModule } from '../users/users.module';
import { ApprovalRulesService } from './approval-rules.service';
import { DiscoveryController } from './discovery.controller';
import { DiscoveryService } from './discovery.service';

/**
 * Approval discovery + the deterministic rule engine (Blueprint
 * DiscoveryModule). Authorisation reuses the enterprise module's
 * EnterpriseAccessService/Guard. UsersModule: RolesGuard (applied via
 * @UseGuards) resolves UsersService in the consuming module's context.
 * Prisma and Audit are global modules.
 */
@Module({
  imports: [AuthModule, UsersModule, EnterprisesModule],
  controllers: [DiscoveryController],
  providers: [ApprovalRulesService, DiscoveryService],
  exports: [ApprovalRulesService, DiscoveryService],
})
export class DiscoveryModule {}
