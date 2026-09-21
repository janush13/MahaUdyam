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

  // ---- Enterprise & representative authorisation (Step 5) ------------
  /** The caller can see the enterprise but their relationship to it (a
   * representative's scope, or being a non-owner) is not enough for this
   * operation. Named in Blueprint §13.2. Callers with NO relationship to an
   * enterprise get NOT_FOUND instead, so enterprise ids can't be probed. */
  FORBIDDEN_SCOPE: 'FORBIDDEN_SCOPE',
  REPRESENTATIVE_USER_NOT_FOUND: 'REPRESENTATIVE_USER_NOT_FOUND',
  REPRESENTATIVE_ALREADY_AUTHORISED: 'REPRESENTATIVE_ALREADY_AUTHORISED',
  CANNOT_AUTHORISE_SELF: 'CANNOT_AUTHORISE_SELF',
  INVALID_PROJECT_SCOPE: 'INVALID_PROJECT_SCOPE',
  INVALID_EXPIRY: 'INVALID_EXPIRY',
  AUTHORISATION_REVOKED: 'AUTHORISATION_REVOKED',
  AUTHORISATION_EXPIRED: 'AUTHORISATION_EXPIRED',
  AUTHORISATION_ALREADY_ACTIVE: 'AUTHORISATION_ALREADY_ACTIVE',

  // ---- Approval discovery & rules (Step 7) -----------------------------
  /** A rule's condition/excludes_if does not conform to the closed grammar. */
  INVALID_RULE_DEFINITION: 'INVALID_RULE_DEFINITION',
  /** A rule version's effective dates are inconsistent or out of sequence. */
  INVALID_EFFECTIVE_DATES: 'INVALID_EFFECTIVE_DATES',

  // ---- Application lifecycle (Step 8) ----------------------------------
  /** The application has been submitted; its form is read-only to the
   * applicant (FRD §17.3, Blueprint §13.4). */
  ALREADY_SUBMITTED: 'ALREADY_SUBMITTED',
  /** The requested transition is not defined from the current state. */
  INVALID_STATE_TRANSITION: 'INVALID_STATE_TRANSITION',
  /** Pre-submission validation found blocking problems (FRD §16). */
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  /** The approval was not among the applicable approvals of the cited
   * discovery result. */
  APPROVAL_NOT_IN_DISCOVERY: 'APPROVAL_NOT_IN_DISCOVERY',
  APPROVAL_TYPE_INACTIVE: 'APPROVAL_TYPE_INACTIVE',
  /** No active workflow is configured for the approval type yet. */
  WORKFLOW_NOT_CONFIGURED: 'WORKFLOW_NOT_CONFIGURED',
  APPLICATION_ALREADY_EXISTS: 'APPLICATION_ALREADY_EXISTS',

  // ---- Document management (Step 9) ------------------------------------
  FILE_REQUIRED: 'FILE_REQUIRED',
  FILE_EMPTY: 'FILE_EMPTY',
  /** Blueprint 13.5 / 22. */
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  /** Blueprint 13.5 / 22. */
  UNSUPPORTED_TYPE: 'UNSUPPORTED_TYPE',
  /** The declared content type disagrees with what the bytes actually are. */
  MIME_TYPE_MISMATCH: 'MIME_TYPE_MISMATCH',
  INVALID_FILENAME: 'INVALID_FILENAME',
  CORRUPT_FILE: 'CORRUPT_FILE',
  /** Blueprint 22. */
  MALWARE_DETECTED: 'MALWARE_DETECTED',
  /** The scanner could not deliver a verdict; nothing was stored (fail closed). */
  SCANNER_UNAVAILABLE: 'SCANNER_UNAVAILABLE',
  STORAGE_UNAVAILABLE: 'STORAGE_UNAVAILABLE',
  DOCUMENT_REQUIREMENT_MISMATCH: 'DOCUMENT_REQUIREMENT_MISMATCH',
  REQUIREMENT_ALREADY_HAS_DOCUMENT: 'REQUIREMENT_ALREADY_HAS_DOCUMENT',
  /** Only the current version of a document can be replaced. */
  DOCUMENT_NOT_CURRENT: 'DOCUMENT_NOT_CURRENT',
  /** The document exists but its state does not permit download. */
  DOCUMENT_NOT_AVAILABLE: 'DOCUMENT_NOT_AVAILABLE',
  DOCUMENT_INTEGRITY_ERROR: 'DOCUMENT_INTEGRITY_ERROR',

  // ---- Officer workspace + scrutiny (Step 10) --------------------------
  /** The application already has an active officer assignment. */
  ALREADY_ASSIGNED: 'ALREADY_ASSIGNED',
  /** A reassignment was requested but nobody is currently assigned. */
  NOT_ASSIGNED: 'NOT_ASSIGNED',
  /** The chosen officer cannot be assigned to this application. */
  INVALID_ASSIGNEE: 'INVALID_ASSIGNEE',
  /** The query is not in a state that allows this action. */
  QUERY_NOT_OPEN: 'QUERY_NOT_OPEN',
  /** The document cannot be reviewed now (not current / not awaiting review). */
  DOCUMENT_NOT_REVIEWABLE: 'DOCUMENT_NOT_REVIEWABLE',

  // ---- Inspection foundation (Step 11A) ---------------------------------
  /** The application already has an open (pending / scheduled) inspection. */
  INSPECTION_ALREADY_OPEN: 'INSPECTION_ALREADY_OPEN',
  /** The inspection is finished or cancelled, or the application is not in a
   * state that allows inspection changes. */
  INSPECTION_NOT_MODIFIABLE: 'INSPECTION_NOT_MODIFIABLE',
  /** The chosen inspector has a declared / confirmed conflict of interest for
   * this project (TRD 10.1). */
  INSPECTOR_CONFLICT_OF_INTEREST: 'INSPECTOR_CONFLICT_OF_INTEREST',

  // ---- Inspection execution (Step 11B) ----------------------------------
  /** The inspection has no schedule yet, so there is nothing to confirm,
   * reschedule or conduct. */
  INSPECTION_NOT_SCHEDULED: 'INSPECTION_NOT_SCHEDULED',
  /** The current schedule was already confirmed. */
  INSPECTION_ALREADY_CONFIRMED: 'INSPECTION_ALREADY_CONFIRMED',
  /** The checklist item is not one of this inspection's checklist. */
  INVALID_CHECKLIST_ITEM: 'INVALID_CHECKLIST_ITEM',
  /** The evidence is not usable for this inspection (not its own, or not
   * scanned / usable). */
  EVIDENCE_NOT_USABLE: 'EVIDENCE_NOT_USABLE',
  /** The report cannot be submitted until every checklist item has a result. */
  CHECKLIST_INCOMPLETE: 'CHECKLIST_INCOMPLETE',

  // ---- Inspection flow integration (Step 11C) ---------------------------
  /** The application's workflow requires an inspection and none has been
   * completed yet, so scrutiny cannot recommend (TRD 3.3). */
  INSPECTION_REQUIRED: 'INSPECTION_REQUIRED',
  /** An inspection is still pending / scheduled, so scrutiny cannot recommend
   * until it is completed (TRD 3.2: inspection completes, then scrutiny
   * resumes). */
  INSPECTION_OPEN: 'INSPECTION_OPEN',

  // ---- SLA management (Step 12) ------------------------------------------
  /** That date is already in the holiday calendar. */
  HOLIDAY_ALREADY_EXISTS: 'HOLIDAY_ALREADY_EXISTS',

  // ---- Compliance management (Step 14) -----------------------------------
  /** That obligation occurrence has already been fulfilled (permanent). */
  COMPLIANCE_ALREADY_FULFILLED: 'COMPLIANCE_ALREADY_FULFILLED',
  /** The obligation requires a supporting document to be fulfilled. */
  COMPLIANCE_EVIDENCE_REQUIRED: 'COMPLIANCE_EVIDENCE_REQUIRED',

  // ---- Approval decision + certificate (Step 15) --------------------------
  /** The recommendation the decision answers is missing (the application is
   * not in a state that carries one). */
  RECOMMENDATION_NOT_FOUND: 'RECOMMENDATION_NOT_FOUND',
  /** The application already has a decision (a decision is made once). */
  DECISION_ALREADY_RECORDED: 'DECISION_ALREADY_RECORDED',
  /** The application has no approving decision to issue a certificate for. */
  CERTIFICATE_NOT_ALLOWED: 'CERTIFICATE_NOT_ALLOWED',
  /** A certificate has already been issued for the application. */
  CERTIFICATE_ALREADY_ISSUED: 'CERTIFICATE_ALREADY_ISSUED',

  // ---- Schemes / government support (Step 16) -------------------------------
  /** A published scheme's content, rules and document requirements are frozen;
   * it must be returned to draft before they can change. */
  SCHEME_NOT_EDITABLE: 'SCHEME_NOT_EDITABLE',
  SCHEME_ALREADY_PUBLISHED: 'SCHEME_ALREADY_PUBLISHED',
  SCHEME_NOT_PUBLISHED: 'SCHEME_NOT_PUBLISHED',
  /** The document requirement already has evidence against it, so it cannot be
   * removed. */
  SCHEME_REQUIREMENT_IN_USE: 'SCHEME_REQUIREMENT_IN_USE',
  /** The scheme's configured application deadline has passed. */
  SCHEME_APPLICATION_CLOSED: 'SCHEME_APPLICATION_CLOSED',
  /** One live application per scheme per project. */
  SCHEME_APPLICATION_ALREADY_EXISTS: 'SCHEME_APPLICATION_ALREADY_EXISTS',
  /** Evidence can no longer be changed (the application has been decided). */
  SCHEME_EVIDENCE_LOCKED: 'SCHEME_EVIDENCE_LOCKED',
  /** A mandatory document requirement of the scheme has no usable document. */
  SCHEME_EVIDENCE_INCOMPLETE: 'SCHEME_EVIDENCE_INCOMPLETE',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];
