import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { DepartmentScopeGuard } from './guards/department-scope.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { MfaEnforcementGuard } from './guards/mfa-enforcement.guard';
import { PermissionsGuard } from './guards/permissions.guard';
import { RolesGuard } from './guards/roles.guard';
import { MfaService } from './mfa.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { TokenService } from './token.service';

/**
 * JwtAuthGuard is registered as a global APP_GUARD here — every route in
 * the application requires a valid access-realm token by default, unless
 * explicitly marked @Public(). This is deliberate (§35): a future business
 * controller can never be accidentally left unguarded just because nobody
 * remembered to add @UseGuards(JwtAuthGuard) to it.
 *
 * MfaEnforcementGuard is global too: mandatory-MFA roles are re-checked on
 * every access-token request, not only at login.
 *
 * RolesGuard/PermissionsGuard/DepartmentScopeGuard are exported but NOT
 * global — they're no-ops without their matching decorator, so applying
 * them broadly would be harmless, but they're still opt-in per route since
 * that's the more explicit, standard pattern for authorization (as opposed
 * to authentication, which is safe-by-default here).
 */
@Module({
  imports: [UsersModule, PassportModule, JwtModule.register({})],
  controllers: [AuthController],
  providers: [
    AuthService,
    TokenService,
    MfaService,
    JwtStrategy,
    RolesGuard,
    PermissionsGuard,
    DepartmentScopeGuard,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // Must stay AFTER JwtAuthGuard: it reads the request.user that guard sets.
    { provide: APP_GUARD, useClass: MfaEnforcementGuard },
  ],
  exports: [RolesGuard, PermissionsGuard, DepartmentScopeGuard],
})
export class AuthModule {}
