import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ErrorCodes } from '../../../common/constants/error-codes.constant';
import { UsersService } from '../../users/users.service';
import { rolesRequireMfa } from '../constants/mfa-required-roles.constant';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { AuthenticatedRequest } from '../interfaces/authenticated-request.interface';

/**
 * Enforces "MFA is mandatory for officer/admin roles" on every request made
 * with a full access token, not just at login. Login alone is not enough:
 * an applicant can hold a valid, MFA-free session when a privileged role is
 * later assigned to them, and RolesGuard/PermissionsGuard read the CURRENT
 * roles from the database — so without this check that pre-existing token
 * would gain officer access without ever completing a second factor.
 *
 * Registered globally after JwtAuthGuard (see AuthModule). Skips @Public()
 * routes and the narrow mfa_setup/mfa_challenge tokens (those exist
 * precisely for users who have not yet completed MFA and grant nothing
 * beyond the MFA endpoints). The remedy for a denied user is to log in
 * again, which routes them through MFA setup.
 */
@Injectable()
export class MfaEnforcementGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly usersService: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.user || request.user.type !== 'access') {
      return true;
    }

    const state = await this.usersService.getMfaEnforcementState(
      request.user.userId,
    );
    if (!state) {
      throw new UnauthorizedException({
        code: ErrorCodes.UNAUTHENTICATED,
        message: 'Authentication required.',
      });
    }

    if (rolesRequireMfa(state.roleCodes) && !state.mfaEnabled) {
      throw new ForbiddenException({
        code: ErrorCodes.MFA_REQUIRED,
        message:
          'Multi-factor authentication is required for your role. Please log in again to set it up.',
      });
    }

    return true;
  }
}
