/**
 * Roles for which MFA is mandatory, per TRD §26 ("MFA mandatory for all
 * officer/admin roles... recommended, not yet mandatory, for applicants").
 * Every one of the 12 approved roles except APPLICANT — LEADERSHIP is
 * included as a judgment call (read-only but cross-department/government-
 * side and sensitive; TRD doesn't name it explicitly as "officer/admin"
 * but nothing in FRD/TRD excludes it either, and it's clearly not an
 * applicant-side role). Documented here rather than silently assumed.
 */
export const MFA_REQUIRED_ROLES: readonly string[] = [
  'SCRUTINY_OFFICER',
  'APPROVING_AUTHORITY',
  'INSPECTOR',
  'DEPT_ADMIN',
  'SCHEME_OFFICER',
  'GRIEVANCE_OFFICER',
  'SYSTEM_ADMIN',
  'SUPER_ADMIN',
  'LEGAL_COMPLIANCE',
  'AUDITOR',
  'LEADERSHIP',
];

export function rolesRequireMfa(roleCodes: string[]): boolean {
  return roleCodes.some((code) => MFA_REQUIRED_ROLES.includes(code));
}
