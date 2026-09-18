import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { isUUID } from 'class-validator';
import { ErrorCodes } from '../../../common/constants/error-codes.constant';
import { UsersService } from '../../users/users.service';
import { AuthenticatedRequest } from '../interfaces/authenticated-request.interface';

/**
 * Reusable department-scoping primitive for future business modules
 * (§17) — expects a `:departmentId` route param and denies access unless
 * the authenticated user holds some role assignment scoped to that exact
 * department. Not consumed by any endpoint in Step 4 (no department-scoped
 * routes exist yet); provided now as tested infrastructure, the same
 * precedent as the S3 storage interface in Step 3.
 */
@Injectable()
export class DepartmentScopeGuard implements CanActivate {
  constructor(private readonly usersService: UsersService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const departmentId = request.params?.departmentId;

    if (!request.user || !departmentId) {
      return false;
    }

    // department_id is a UUID column — a malformed id can never match a
    // real assignment, and passing it to Prisma would surface as a 500.
    // Deny outright instead (no access, not "server error").
    const hasAccess =
      isUUID(departmentId) &&
      (await this.usersService.hasDepartmentAccess(
        request.user.userId,
        departmentId,
      ));

    if (!hasAccess) {
      throw new ForbiddenException({
        code: ErrorCodes.INSUFFICIENT_PERMISSION,
        message: 'You do not have access to this department.',
      });
    }

    return true;
  }
}
