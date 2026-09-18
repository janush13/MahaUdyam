import {
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { ErrorCodes } from '../../../common/constants/error-codes.constant';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { TOKEN_TYPE_KEY } from '../decorators/token-type.decorator';
import {
  AuthenticatedUser,
  TokenType,
} from '../interfaces/jwt-payload.interface';

/**
 * Authentication ("who are you?") only — registered globally (see
 * AuthModule) so every route requires a valid access-realm token by
 * default. @Public() routes skip it entirely; @RequireTokenType(...)
 * narrows which token types a route accepts (defaults to ['access']).
 * Role/permission checks ("what are you allowed to do?") are deliberately
 * separate — see RolesGuard/PermissionsGuard.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    return super.canActivate(context);
  }

  handleRequest<TUser = AuthenticatedUser>(
    err: unknown,
    user: AuthenticatedUser | false,
    _info: unknown,
    context: ExecutionContext,
  ): TUser {
    if (err || !user) {
      throw new UnauthorizedException({
        code: ErrorCodes.UNAUTHENTICATED,
        message: 'Authentication required.',
      });
    }

    const requiredTypes = this.reflector.getAllAndOverride<TokenType[]>(
      TOKEN_TYPE_KEY,
      [context.getHandler(), context.getClass()],
    ) ?? ['access'];

    if (!requiredTypes.includes(user.type)) {
      throw new ForbiddenException({
        code: ErrorCodes.INVALID_TOKEN_TYPE,
        message: 'This token cannot be used for this action.',
      });
    }

    return user as unknown as TUser;
  }
}
