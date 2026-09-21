import { Controller, Get, Module, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { AuthModule } from '../../src/modules/auth/auth.module';
import { Permissions } from '../../src/modules/auth/decorators/permissions.decorator';
import { Roles } from '../../src/modules/auth/decorators/roles.decorator';
import { DepartmentScopeGuard } from '../../src/modules/auth/guards/department-scope.guard';
import { PermissionsGuard } from '../../src/modules/auth/guards/permissions.guard';
import { RolesGuard } from '../../src/modules/auth/guards/roles.guard';
import { EnterpriseAccessRequired } from '../../src/modules/enterprises/decorators/enterprise-access.decorator';
import { EnterprisesModule } from '../../src/modules/enterprises/enterprises.module';
import { UsersModule } from '../../src/modules/users/users.module';

/**
 * TEST-ONLY. Lives under test/ (never under src/), is imported solely by
 * the e2e suite's testing module, and is hidden from Swagger. It exists
 * only because the reusable authorization primitives (RolesGuard,
 * PermissionsGuard, DepartmentScopeGuard, and — Step 5 — the enterprise
 * access guard at each representative scope level) have no business
 * controller yet to exercise them over real HTTP. It is not part of the
 * application and is not reachable in any real deployment.
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

  // ---- Step 5: enterprise access levels ---------------------------------
  // Stand-ins for the operations later steps will add (view applications,
  // prepare/submit them, respond to queries, ...), one route per level.

  @Get('enterprise/:enterpriseId/view')
  @EnterpriseAccessRequired('VIEW_ONLY')
  enterpriseView() {
    return { ok: true };
  }

  @Get('enterprise/:enterpriseId/prepare')
  @EnterpriseAccessRequired('PREPARE_SUBMIT')
  enterprisePrepare() {
    return { ok: true };
  }

  @Get('enterprise/:enterpriseId/full')
  @EnterpriseAccessRequired('FULL')
  enterpriseFull() {
    return { ok: true };
  }

  @Get('enterprise/:enterpriseId/owner')
  @EnterpriseAccessRequired('OWNER')
  enterpriseOwner() {
    return { ok: true };
  }

  @Get('enterprise/:enterpriseId/project/:projectId/prepare')
  @EnterpriseAccessRequired('PREPARE_SUBMIT')
  projectPrepare() {
    return { ok: true };
  }

  @Get('enterprise/:enterpriseId/project/:projectId/view')
  @EnterpriseAccessRequired('VIEW_ONLY')
  projectView() {
    return { ok: true };
  }
}

@Module({
  imports: [AuthModule, UsersModule, EnterprisesModule],
  controllers: [TestAuthzController],
})
export class AuthzTestModule {}
