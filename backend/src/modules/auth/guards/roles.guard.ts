import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ErrorCodes } from '../../../common/constants/error-codes.constant';
import { UsersService } from '../../users/users.service';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { AuthenticatedRequest } from '../interfaces/authenticated-request.interface';

/**
 * Authorization ("what are you allowed to do?") — a no-op (returns true)
 * on any route without @Roles(...), so it's safe to apply broadly without
 * accidentally locking out routes that don't need role checks. Always
 * queries the database for the user's CURRENT roles rather than trusting
 * the JWT's `roles` claim, so a role change takes effect immediately, not
 * only after the token expires (see jwt-payload.interface.ts).
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly usersService: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.user) {
      return false;
    }

    const roleCodes = await this.usersService.getRoleCodes(request.user.userId);
    const allowed = requiredRoles.some((role) => roleCodes.includes(role));

    if (!allowed) {
      throw new ForbiddenException({
        code: ErrorCodes.INSUFFICIENT_ROLE,
        message: 'You do not have the required role for this action.',
      });
    }

    return true;
  }
}
