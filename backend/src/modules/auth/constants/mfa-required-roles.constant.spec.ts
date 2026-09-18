import {
  MFA_REQUIRED_ROLES,
  rolesRequireMfa,
} from './mfa-required-roles.constant';

describe('rolesRequireMfa', () => {
  it('returns false for APPLICANT alone', () => {
    expect(rolesRequireMfa(['APPLICANT'])).toBe(false);
  });

  it('returns false for an empty role list', () => {
    expect(rolesRequireMfa([])).toBe(false);
  });

  it.each(MFA_REQUIRED_ROLES)('returns true for %s', (role) => {
    expect(rolesRequireMfa([role])).toBe(true);
  });

  it('returns true when a user holds both APPLICANT and a required role', () => {
    expect(rolesRequireMfa(['APPLICANT', 'SCRUTINY_OFFICER'])).toBe(true);
  });
});
