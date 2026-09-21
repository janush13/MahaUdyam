import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ErrorCodes } from '../../../common/constants/error-codes.constant';
import { ENTERPRISE_ACCESS_KEY } from '../constants/enterprise-access-key.constant';
import { EnterpriseAccessLevel } from '../constants/representative-scope.constant';
import { EnterpriseAccessService } from '../enterprise-access.service';
import { EnterpriseAccessRequest } from '../interfaces/enterprise-access.interface';

/**
 * Object-level authorisation for enterprise-scoped routes. Applied via
 * @EnterpriseAccessRequired(level). If the metadata were ever missing the
 * guard falls back to the MOST restrictive level (OWNER) rather than
 * allowing access — fail closed.
 */
@Injectable()
export class EnterpriseAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly accessService: EnterpriseAccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required =
      this.reflector.getAllAndOverride<EnterpriseAccessLevel>(
        ENTERPRISE_ACCESS_KEY,
        [context.getHandler(), context.getClass()],
      ) ?? 'OWNER';

    const request = context
      .switchToHttp()
      .getRequest<EnterpriseAccessRequest>();
    const enterpriseId = request.params?.enterpriseId;

    if (!request.user || !enterpriseId) {
      throw new NotFoundException({
        code: ErrorCodes.NOT_FOUND,
        message: 'Enterprise not found.',
      });
    }

    request.enterpriseAccess = await this.accessService.assertAccess(
      request.user.userId,
      enterpriseId,
      required,
      request.params?.projectId,
    );
    return true;
  }
}
