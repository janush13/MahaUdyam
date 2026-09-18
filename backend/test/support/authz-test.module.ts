import { Controller, Get, Module, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { AuthModule } from '../../src/modules/auth/auth.module';
import { Permissions } from '../../src/modules/auth/decorators/permissions.decorator';
import { Roles } from '../../src/modules/auth/decorators/roles.decorator';
import { DepartmentScopeGuard } from '../../src/modules/auth/guards/department-scope.guard';
import { PermissionsGuard } from '../../src/modules/auth/guards/permissions.guard';
import { RolesGuard } from '../../src/modules/auth/guards/roles.guard';
import { UsersModule } from '../../src/modules/users/users.module';

/**
 * TEST-ONLY. Lives under test/ (never under src/), is imported solely by
 * the e2e suite's testing module, and is hidden from Swagger. It exists
 * only because Step 4 ships reusable authorization primitives (RolesGuard,
 * PermissionsGuard, DepartmentScopeGuard) with no business controller yet
 * to exercise them over real HTTP. It is not part of the application
 * and is not reachable in any real deployment.
 */
@ApiExcludeController()
@Controller('test-authz')
class TestAuthzController {
  @Get('authenticated')
  authenticated() {
    return { ok: true };
  }

  @Get('officer-only')
  @UseGuards(RolesGuard)
  @Roles('SCRUTINY_OFFICER')
  officerOnly() {
    return { ok: true };
  }

  @Get('manage-users')
  @UseGuards(PermissionsGuard)
  @Permissions('USER_MANAGE')
  manageUsers() {
    return { ok: true };
  }

  @Get('department/:departmentId')
  @UseGuards(DepartmentScopeGuard)
  department() {
    return { ok: true };
  }
}

@Module({
  imports: [AuthModule, UsersModule],
  controllers: [TestAuthzController],
})
export class AuthzTestModule {}
