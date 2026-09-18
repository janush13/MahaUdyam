import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ErrorCodes } from '../../../common/constants/error-codes.constant';
import { AppConfig } from '../../../config/configuration';
import {
  AnyJwtPayload,
  AuthenticatedUser,
} from '../interfaces/jwt-payload.interface';

/**
 * Verifies the Bearer token's signature and expiry (Passport handles
 * that), then maps the payload onto `request.user`. Only signature/expiry
 * checking happens here — which specific token *type* a route requires
 * (access vs mfa_setup, etc.) is a separate check in JwtAuthGuard, kept
 * apart so this strategy stays a pure "is this a validly-signed token"
 * check.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(configService: ConfigService<AppConfig, true>) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get('jwt.accessSecret', { infer: true }),
    });
  }

  validate(payload: AnyJwtPayload): AuthenticatedUser {
    // Refresh tokens are signed with a different secret and are never
    // accepted here anyway, but this guards against a hypothetical future
    // mistake (e.g. reusing a secret) rather than relying on that alone.
    if (payload.type === 'refresh') {
      throw new UnauthorizedException({
        code: ErrorCodes.INVALID_TOKEN_TYPE,
        message: 'Refresh tokens cannot be used as a bearer token.',
      });
    }

    return {
      userId: payload.sub,
      type: payload.type,
      roles: 'roles' in payload ? payload.roles : [],
    };
  }
}
