/**
 * Limits on what the Approving Authority types. They bound input; they decide
 * nothing statutory. No approval criterion, rejection ground, certificate
 * numbering scheme or validity period exists in the requirements, so none is
 * defined here.
 */
export const MAX_DECISION_REASON_LENGTH = 2000;
export const MAX_CERTIFICATE_NUMBER_LENGTH = 100;

/** Shown with every decision the applicant reads: the wording makes no promise
 * about what follows (no appeal, resubmission or validity rule is defined;
 * those are TO BE VALIDATED WITH GOVERNMENT DEPARTMENT). */
export const DECISION_VIEW_NOTE =
  'This is the department’s recorded decision on this application. Any further steps (such as review, resubmission or renewal) are set by the department and are not decided or promised by this platform.';

/** The role a decision-related audit event / download is recorded under. */
export const AUTHORITY_ROLE = 'APPROVING_AUTHORITY';
