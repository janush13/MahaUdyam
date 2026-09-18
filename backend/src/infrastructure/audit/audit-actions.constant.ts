/**
 * Authentication-related audit action names (audit_logs.action). Free text
 * at the schema level (TRD §29's audit design), kept as named constants
 * here purely so call sites can't typo an action name. Extended by future
 * modules as they're built — not a closed enum.
 */
export const AuditActions = {
  USER_REGISTERED: 'USER_REGISTERED',
  LOGIN_SUCCESS: 'LOGIN_SUCCESS',
  LOGIN_FAILURE: 'LOGIN_FAILURE',
  LOGOUT: 'LOGOUT',
  MFA_ENROLLED: 'MFA_ENROLLED',
  MFA_ENABLED: 'MFA_ENABLED',
  MFA_VERIFY_FAILURE: 'MFA_VERIFY_FAILURE',
  MFA_LOGIN_SUCCESS: 'MFA_LOGIN_SUCCESS',
  REFRESH_TOKEN_ROTATED: 'REFRESH_TOKEN_ROTATED',
  REFRESH_TOKEN_REUSE_DETECTED: 'REFRESH_TOKEN_REUSE_DETECTED',
  ROLE_ASSIGNED: 'ROLE_ASSIGNED',
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
} as const;

export type AuditAction = (typeof AuditActions)[keyof typeof AuditActions];
