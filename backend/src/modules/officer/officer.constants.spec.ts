import {
  APPROVING_AUTHORITY_VISIBLE_STATES,
  AWAITING_DECISION_STATES,
  CAN_SEE_ASSIGNMENT_HISTORY,
  OFFICER_ROLES,
  OfficerCapability,
  ROLE_CAPABILITIES,
  ROLE_VISIBILITY,
} from './constants/officer.constants';

const has = (role: (typeof OFFICER_ROLES)[number], c: OfficerCapability) =>
  ROLE_CAPABILITIES[role].has(c);

const SCRUTINY_WRITES: OfficerCapability[] = [
  'START_SCRUTINY',
  'RECORD_OBSERVATION',
  'RAISE_QUERY',
  'CLOSE_QUERY',
  'REVIEW_DOCUMENT',
  'RECOMMEND',
  'SCHEDULE_INSPECTION',
];

describe('officer capability matrix (least privilege)', () => {
  it('covers exactly the three officer roles and gives every one a visibility', () => {
    expect([...OFFICER_ROLES].sort()).toEqual(
      ['APPROVING_AUTHORITY', 'DEPT_ADMIN', 'SCRUTINY_OFFICER'].sort(),
    );
    for (const role of OFFICER_ROLES) {
      expect(ROLE_CAPABILITIES[role]).toBeDefined();
      expect(ROLE_VISIBILITY[role]).toBeDefined();
    }
  });

  it('never grants INSPECTOR, SYSTEM_ADMIN, LEADERSHIP or AUDITOR anything', () => {
    for (const role of ['INSPECTOR', 'SYSTEM_ADMIN', 'LEADERSHIP', 'AUDITOR']) {
      expect(OFFICER_ROLES as readonly string[]).not.toContain(role);
    }
  });

  it('the Scrutiny Officer does the scrutiny work, and does not assign', () => {
    expect(has('SCRUTINY_OFFICER', 'VIEW')).toBe(true);
    for (const c of SCRUTINY_WRITES) {
      expect(has('SCRUTINY_OFFICER', c)).toBe(true);
    }
    expect(has('SCRUTINY_OFFICER', 'ASSIGN')).toBe(false);
  });

  it('the Department Administrator assigns and reads, and does no scrutiny', () => {
    expect([...ROLE_CAPABILITIES.DEPT_ADMIN].sort()).toEqual([
      'ASSIGN',
      'VIEW',
    ]);
  });

  it('the Approving Authority views and makes the statutory acts (decide, issue the certificate), with no scrutiny and no assignment', () => {
    expect([...ROLE_CAPABILITIES.APPROVING_AUTHORITY].sort()).toEqual([
      'DECIDE',
      'ISSUE_CERTIFICATE',
      'VIEW',
    ]);
  });

  it('no other role can decide or issue a certificate (Blueprint 20.2: recommend only; 20.3: never the technical admin)', () => {
    for (const role of ['SCRUTINY_OFFICER', 'DEPT_ADMIN'] as const) {
      expect(has(role, 'DECIDE')).toBe(false);
      expect(has(role, 'ISSUE_CERTIFICATE')).toBe(false);
    }
  });

  it('every role can view; only the Scrutiny Officer can write scrutiny', () => {
    for (const role of OFFICER_ROLES) {
      expect(has(role, 'VIEW')).toBe(true);
    }
    for (const role of ['DEPT_ADMIN', 'APPROVING_AUTHORITY'] as const) {
      for (const c of SCRUTINY_WRITES) {
        expect(has(role, c)).toBe(false);
      }
    }
  });

  it('scopes visibility per Blueprint 20.2: assigned only / dept-wide / awaiting decision', () => {
    expect(ROLE_VISIBILITY).toEqual({
      SCRUTINY_OFFICER: 'ASSIGNED_TO_ME',
      DEPT_ADMIN: 'DEPARTMENT',
      APPROVING_AUTHORITY: 'AWAITING_DECISION',
    });
    expect(AWAITING_DECISION_STATES).toEqual(['RECOMMENDED_FOR_APPROVAL']);
    // The Approving Authority also keeps sight of what it has decided (it
    // issues the certificate after approving).
    expect(APPROVING_AUTHORITY_VISIBLE_STATES).toEqual([
      'RECOMMENDED_FOR_APPROVAL',
      'APPROVED',
      'REJECTED',
      'CERTIFICATE_ISSUED',
      'ACTIVE',
    ]);
  });

  it('shows the assignment history (administrative metadata) to the administrator alone', () => {
    expect(CAN_SEE_ASSIGNMENT_HISTORY).toEqual(['DEPT_ADMIN']);
  });
});
