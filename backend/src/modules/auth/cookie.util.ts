import { CookieOptions, Response } from 'express';

/** Only what cookie handling actually needs — narrower than the full
 * AppConfig so callers don't need to reconstruct the whole config object
 * (ConfigService has no single call that returns it as one value; see
 * AuthController.cookieConfig()). */
export interface RefreshCookieConfig {
  env: string;
  apiPrefix: string;
  refreshCookieName: string;
}

/**
 * Scoped to `${apiPrefix}/auth` (not the whole site) — the refresh cookie
 * is never sent to any other route, minimising CSRF surface. Not a
 * separate env var: computed from the existing apiPrefix so there's one
 * less knob to misconfigure.
 */
function cookiePath(config: RefreshCookieConfig): string {
  return `/${config.apiPrefix}/auth`;
}

function baseOptions(config: RefreshCookieConfig): CookieOptions {
  return {
    httpOnly: true,
    secure: config.env === 'production',
    // 'lax' balances CSRF protection with normal top-level-navigation login
    // flows; 'strict' would break some legitimate cross-site navigations
    // into an authenticated session.
    sameSite: 'lax',
    path: cookiePath(config),
  };
}

export function setRefreshCookie(
  res: Response,
  config: RefreshCookieConfig,
  token: string,
  expiresAt: Date,
): void {
  res.cookie(config.refreshCookieName, token, {
    ...baseOptions(config),
    expires: expiresAt,
  });
}

export function clearRefreshCookie(
  res: Response,
  config: RefreshCookieConfig,
): void {
  res.clearCookie(config.refreshCookieName, baseOptions(config));
}

export function readRefreshCookie(
  req: { cookies?: Record<string, string> },
  config: RefreshCookieConfig,
): string | undefined {
  return req.cookies?.[config.refreshCookieName];
}
