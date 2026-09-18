/**
 * Generic, transport-level error codes used by the global exception filter.
 * Domain-specific codes (e.g. APPLICATION_INVALID_STATE) are introduced by
 * each business module as it is implemented — this file intentionally holds
 * only the foundation-level set, not the full future error catalogue.
 */
export const ErrorCodes = {
  BAD_REQUEST: 'BAD_REQUEST',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',

  // ---- Authentication (Step 4) --------------------------------------
  /** No/invalid/expired JWT on a protected route — distinct from
   * INVALID_CREDENTIALS, which is specifically a failed login attempt. */
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  /** A JWT was valid but of the wrong type for this endpoint (e.g. an
   * mfa_setup token used against a route that requires a full access
   * token). */
  INVALID_TOKEN_TYPE: 'INVALID_TOKEN_TYPE',
  EMAIL_ALREADY_REGISTERED: 'EMAIL_ALREADY_REGISTERED',
  MOBILE_ALREADY_REGISTERED: 'MOBILE_ALREADY_REGISTERED',
  /** Unified for "wrong password" AND "no such account" — deliberately
   * indistinguishable to the caller to prevent account enumeration. */
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  ACCOUNT_DISABLED: 'ACCOUNT_DISABLED',
  /** Reserved for future authenticated-context lookups — never returned
   * by the public login flow (see INVALID_CREDENTIALS above). */
  ACCOUNT_NOT_FOUND: 'ACCOUNT_NOT_FOUND',
  MFA_REQUIRED: 'MFA_REQUIRED',
  INVALID_MFA_CODE: 'INVALID_MFA_CODE',
  MFA_ALREADY_ENABLED: 'MFA_ALREADY_ENABLED',
  MFA_NOT_ENROLLED: 'MFA_NOT_ENROLLED',
  REFRESH_TOKEN_INVALID: 'REFRESH_TOKEN_INVALID',
  REFRESH_TOKEN_EXPIRED: 'REFRESH_TOKEN_EXPIRED',
  REFRESH_TOKEN_REUSED: 'REFRESH_TOKEN_REUSED',
  INSUFFICIENT_ROLE: 'INSUFFICIENT_ROLE',
  INSUFFICIENT_PERMISSION: 'INSUFFICIENT_PERMISSION',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];
