import { InternalApplicationState } from '@prisma/client';

/**
 * Who may do what on an application, per role — validated line by line
 * against FRD 4.3–4.6 / 5 / 22.1, TRD 28 and Blueprint 20.2. Least privilege:
 * a capability the requirements do not give a role is simply absent, and no
 * role inherits another's.
 *
 *   SCRUTINY_OFFICER      works ONLY the applications assigned to them:
 *                         start scrutiny, record internal observations, raise
 *                         and close queries, review (verify / reject)
 *                         documents, recommend approval or rejection. Never
 *                         decides (FRD 22.1: "scrutiny never itself finalises a
 *                         statutory outcome").
 *   DEPT_ADMIN            department-wide read, and assigns officers (FRD 21.2,
 *                         TRD 28). Does no scrutiny and can never decide
 *                         (FRD 4.6).
 *   APPROVING_AUTHORITY   sight of the department's applications that are
 *                         awaiting a decision (including the officer's
 *                         recommendation) and of those it has decided, and the
 *                         statutory acts themselves: approve or reject with a
 *                         mandatory reason, and trigger issuance of the
 *                         approval certificate (FRD 4.5, TRD 28, Blueprint
 *                         20.2). No scrutiny capability.
 *
 * INSPECTOR, SYSTEM_ADMIN, LEADERSHIP, AUDITOR and every other role have NO
 * scrutiny capability (FRD 4.4, 4.9, 4.10: inspectors see only assigned
 * inspections; technical/leadership roles never see individual applications).
 */
export type OfficerRole =
  'SCRUTINY_OFFICER' | 'DEPT_ADMIN' | 'APPROVING_AUTHORITY';

export const OFFICER_ROLES: readonly OfficerRole[] = [
  'SCRUTINY_OFFICER',
  'DEPT_ADMIN',
  'APPROVING_AUTHORITY',
];

export type OfficerCapability =
  | 'VIEW'
  | 'START_SCRUTINY'
  | 'RECORD_OBSERVATION'
  | 'RAISE_QUERY'
  | 'CLOSE_QUERY'
  | 'REVIEW_DOCUMENT'
  | 'RECOMMEND'
  | 'ASSIGN'
  | 'SCHEDULE_INSPECTION'
  | 'DECIDE'
  | 'ISSUE_CERTIFICATE';

export const ROLE_CAPABILITIES: Record<
  OfficerRole,
  ReadonlySet<OfficerCapability>
> = {
  SCRUTINY_OFFICER: new Set<OfficerCapability>([
    'VIEW',
    'START_SCRUTINY',
    'RECORD_OBSERVATION',
    'RAISE_QUERY',
    'CLOSE_QUERY',
    'REVIEW_DOCUMENT',
    'RECOMMEND',
    // FRD 4.3 "assign/request inspection"; Blueprint 13.7 (Scrutiny Officer).
    'SCHEDULE_INSPECTION',
  ]),
  DEPT_ADMIN: new Set<OfficerCapability>(['VIEW', 'ASSIGN']),
  // FRD 4.5 / TRD 28 / Blueprint 20.2 "Statutory decision (approve/reject):
  // Full" - and "trigger issuance of the approval document" (FRD 4.5).
  APPROVING_AUTHORITY: new Set<OfficerCapability>([
    'VIEW',
    'DECIDE',
    'ISSUE_CERTIFICATE',
  ]),
};

/** Which of a department's applications a role can see at all (Blueprint
 * 20.2: Scrutiny "assigned only", Approving Authority "dept queue", Dept Admin
 * "dept-wide"). Drafts are never visible to any officer. */
export type Visibility = 'ASSIGNED_TO_ME' | 'DEPARTMENT' | 'AWAITING_DECISION';

export const ROLE_VISIBILITY: Record<OfficerRole, Visibility> = {
  SCRUTINY_OFFICER: 'ASSIGNED_TO_ME',
  DEPT_ADMIN: 'DEPARTMENT',
  APPROVING_AUTHORITY: 'AWAITING_DECISION',
};

/** The Approving Authority's queue: scrutiny finished, decision pending. */
export const AWAITING_DECISION_STATES: readonly InternalApplicationState[] = [
  'RECOMMENDED_FOR_APPROVAL',
];

/** What the Approving Authority can see at all: the queue above, plus the
 * applications it has decided (it issues the certificate after approving, and
 * a decision it made stays readable: FRD 21.1 "recently completed
 * applications (for reference)"). */
export const APPROVING_AUTHORITY_VISIBLE_STATES: readonly InternalApplicationState[] =
  [
    ...AWAITING_DECISION_STATES,
    'APPROVED',
    'REJECTED',
    'CERTIFICATE_ISSUED',
    'ACTIVE',
  ];

/** FRD 5 "internal administrative metadata (assignment logic, workload)" is for
 * the Department Administrator only, so the assignment history is shown to no
 * other role. (Internal scrutiny notes are visible to all three officer roles —
 * the assigned Scrutiny Officer, the Approving Authority and the Department
 * Administrator — and never to anyone on the applicant side.) */
export const CAN_SEE_ASSIGNMENT_HISTORY: readonly OfficerRole[] = [
  'DEPT_ADMIN',
];

export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 25;

export const MAX_TEXT_LENGTH = 5000;
