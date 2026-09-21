import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { EnterprisesModule } from '../enterprises/enterprises.module';
import { UsersModule } from '../users/users.module';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';

/**
 * Project CRUD (Blueprint ProjectModule). Authorisation reuses the
 * enterprise module's EnterpriseAccessService/Guard — imported, not
 * re-implemented. Prisma and Audit are global modules.
 */
@Module({
  // UsersModule: RolesGuard (applied via @UseGuards) resolves UsersService in
  // the consuming module's context.
  imports: [AuthModule, UsersModule, EnterprisesModule],
  controllers: [ProjectsController],
  providers: [ProjectsService],
  exports: [ProjectsService],
})
export class ProjectsModule {}
