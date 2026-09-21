import { SchemeApplicationStatus } from '@prisma/client';
import { EnterpriseAccessLevel } from '../enterprises/constants/representative-scope.constant';

/**
 * Who may do what with a scheme, expressed against the EXISTING enterprise
 * access levels (FRD 20.3) - no second permission system. Reading (browsing
 * recommendations, tracking an application): any live scope. Applying and
 * adding evidence is "fill, upload and submit applications on the
 * entrepreneur's behalf": Prepare & Submit or above.
 */
export const SCHEME_READ_LEVEL: EnterpriseAccessLevel = 'VIEW_ONLY';
export const SCHEME_WRITE_LEVEL: EnterpriseAccessLevel = 'PREPARE_SUBMIT';

export const SCHEME_OFFICER_ROLE = 'SCHEME_OFFICER';

/** FRD 29.4, verbatim: shown with EVERY recommended scheme. */
export const RECOMMENDATION_NOTICE =
  'You may be eligible for this scheme based on your project details. This is not an official eligibility determination — apply to receive a decision from the administering department.';

/** Shown once with the whole recommendation list (FRD 29.3 / 29.4, TRD 15). */
export const RECOMMENDATIONS_NOTICE =
  'These schemes are suggestions based only on the project details you entered and the eligibility rules the departments have configured. A suggestion is not an official eligibility determination and never implies approval: apply to receive a decision from the administering department. If no rule is configured for a scheme, it is not suggested — the scheme catalogue lists every published scheme.';

/** Statuses in which an application still counts as live for the
 * "one application per scheme per project" rule (a rejected one does not). */
export const LIVE_SCHEME_STATUSES: readonly SchemeApplicationStatus[] = [
  'APPLIED',
  'UNDER_REVIEW',
  'APPROVED',
  'DISBURSED',
];

/** Evidence can be added or replaced until the Scheme Officer decides. */
export const EVIDENCE_OPEN_STATUSES: readonly SchemeApplicationStatus[] = [
  'APPLIED',
  'UNDER_REVIEW',
];

/** An officer reviews (verifies / rejects) evidence only while reviewing. */
export const EVIDENCE_REVIEW_STATUSES: readonly SchemeApplicationStatus[] = [
  'UNDER_REVIEW',
];

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;
