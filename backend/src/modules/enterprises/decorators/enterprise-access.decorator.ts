import {
  applyDecorators,
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
  UseGuards,
} from '@nestjs/common';
import { ENTERPRISE_ACCESS_KEY } from '../constants/enterprise-access-key.constant';
import { EnterpriseAccessLevel } from '../constants/representative-scope.constant';
import { EnterpriseAccessGuard } from '../guards/enterprise-access.guard';
import {
  EnterpriseAccess,
  EnterpriseAccessRequest,
} from '../interfaces/enterprise-access.interface';

/**
 * Requires the caller to hold at least `level` on the enterprise named by
 * the route's `:enterpriseId` param — `'OWNER'` (Applicant Admin only) or a
 * representative scope (`VIEW_ONLY` < `PREPARE_SUBMIT` < `FULL`; the owner
 * always satisfies these). Applies EnterpriseAccessGuard itself, so a route
 * cannot forget to wire the guard. Put `@Roles(...)` + RolesGuard on the
 * controller for the role check; class-level guards run first.
 */
export const EnterpriseAccessRequired = (level: EnterpriseAccessLevel) =>
  applyDecorators(
    SetMetadata(ENTERPRISE_ACCESS_KEY, level),
    UseGuards(EnterpriseAccessGuard),
  );

/** The access decision made by EnterpriseAccessGuard for this request. */
export const CurrentEnterpriseAccess = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): EnterpriseAccess => {
    const request = ctx.switchToHttp().getRequest<EnterpriseAccessRequest>();
    return request.enterpriseAccess as EnterpriseAccess;
  },
);
