export type TokenType = 'access' | 'refresh' | 'mfa_challenge' | 'mfa_setup';

interface BaseJwtPayload {
  /** userId */
  sub: string;
  type: TokenType;
}

/** Fully authenticated, general-purpose bearer token. `roles` is
 * informational only (e.g. for client-side UI) — RolesGuard/
 * PermissionsGuard re-check against the database on every request rather
 * than trusting this claim, so a mid-session role change takes effect
 * immediately rather than only after the token expires. */
export interface AccessTokenPayload extends BaseJwtPayload {
  type: 'access';
  roles: string[];
}

/** Never accepted as a Bearer token — only ever exchanged via the refresh
 * cookie mechanism. `jti` gives each issuance high entropy independent of
 * timing. */
export interface RefreshTokenPayload extends BaseJwtPayload {
  type: 'refresh';
  jti: string;
}

/** Short-lived, narrow-purpose tokens issued instead of a full access
 * token when primary credentials succeed but MFA must still be completed
 * (mfa_challenge: code required from an already-enrolled user) or set up
 * first (mfa_setup: role requires MFA, user hasn't enrolled yet). Neither
 * grants access to anything beyond the specific MFA endpoints that accept
 * it. */
export interface MfaChallengePayload extends BaseJwtPayload {
  type: 'mfa_challenge' | 'mfa_setup';
}

export type AnyJwtPayload =
  AccessTokenPayload | RefreshTokenPayload | MfaChallengePayload;

/** Shape of `request.user` after JwtStrategy validates a Bearer token. */
export interface AuthenticatedUser {
  userId: string;
  type: TokenType;
  roles: string[];
}
