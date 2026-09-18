import { SetMetadata } from '@nestjs/common';
import { TokenType } from '../interfaces/jwt-payload.interface';

export const TOKEN_TYPE_KEY = 'requiredTokenType';

/** Restricts a route to specific JWT token types. Defaults to `['access']`
 * when not set (see JwtAuthGuard) — only the MFA enroll/confirm endpoints
 * need to widen this to also accept 'mfa_setup'. */
export const RequireTokenType = (...types: TokenType[]) =>
  SetMetadata(TOKEN_TYPE_KEY, types);
