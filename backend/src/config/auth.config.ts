export interface AuthSettings {
  jwt: {
    accessSecret: string;
    refreshSecret: string;
    accessExpiresIn: string;
    refreshExpiresIn: string;
  };
  /** Base64-encoded 32-byte AES-256-GCM key used to encrypt TOTP secrets
   * at rest (mfa_credentials.totp_secret) — a distinct secret from the JWT
   * ones, deliberately, since it protects a different kind of data for a
   * different purpose (never reuse a key across purposes). */
  mfaEncryptionKey: string;
  refreshCookieName: string;
  maxFailedLoginAttempts: number;
  lockoutDurationMinutes: number;
}

/**
 * Auth-related configuration only — no authentication logic, guards, or
 * strategies live here. This exists so auth modules read secrets via
 * ConfigService instead of `process.env`, and so the required-secret
 * validation (validation.ts) has a single place documenting what's needed.
 */
export const buildAuthConfig = (): AuthSettings => ({
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET ?? '',
    refreshSecret: process.env.JWT_REFRESH_SECRET ?? '',
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN ?? '15m',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN ?? '7d',
  },
  mfaEncryptionKey: process.env.MFA_ENCRYPTION_KEY ?? '',
  refreshCookieName:
    process.env.REFRESH_COOKIE_NAME ?? 'mahaudyam_refresh_token',
  maxFailedLoginAttempts: parseInt(
    process.env.AUTH_MAX_FAILED_LOGIN_ATTEMPTS ?? '5',
    10,
  ),
  lockoutDurationMinutes: parseInt(
    process.env.AUTH_LOCKOUT_DURATION_MINUTES ?? '15',
    10,
  ),
});
