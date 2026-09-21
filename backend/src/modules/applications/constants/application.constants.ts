import { EnterpriseAccessLevel } from '../../enterprises/constants/representative-scope.constant';

/**
 * Who may do what with an application, expressed against the EXISTING
 * enterprise access levels (FRD §20.3) — no second permission system.
 *
 *  - Reading an application / its status: any live scope (View Only sees
 *    "applications/status/documents").
 *  - Creating, editing a draft, running pre-submission validation and
 *    submitting: Prepare & Submit or above ("fill, upload, and submit
 *    applications on the entrepreneur's behalf"). View Only "cannot submit".
 *
 * Named constants so relaxing or tightening either is a one-line, reviewable
 * change.
 */
export const APPLICATION_READ_LEVEL: EnterpriseAccessLevel = 'VIEW_ONLY';
export const APPLICATION_WRITE_LEVEL: EnterpriseAccessLevel = 'PREPARE_SUBMIT';

/** FRD §16.2 — mandatory wording on every validation summary, verbatim. */
export const VALIDATION_DISCLAIMER =
  'Passing these checks confirms your application is complete for submission. It does not guarantee approval by the relevant department, which will conduct its own review.';

/** Shown with every application: what the discovery link means. FRD §10.3 /
 * §10.4 — recommendation is never a statutory determination. */
export const DISCOVERY_CONTEXT_NOTE =
  'This records why the approval was suggested when the application was started, and the rule version that suggested it. It is a recommendation, not a statutory determination — the responsible department decides.';

/** Limits on the free-form approval-specific details (formData). The
 * per-approval field definitions are department configuration that does not
 * exist yet, so only structural limits apply. */
export const FORM_DATA_MAX_FIELDS = 50;
export const FORM_DATA_MAX_KEY_LENGTH = 64;
export const FORM_DATA_MAX_STRING_LENGTH = 2000;
