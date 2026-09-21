import { ApplicantStatus, InternalApplicationState } from '@prisma/client';

/**
 * The two-layer status model (Step 2 schema; TRD §3.2 / FRD §11.2).
 *
 *  - internal state: the engine-owned technical lifecycle. Clients can never
 *    set it; it changes only through the explicit actions below, executed by
 *    ApplicationsService.
 *  - applicant status: the vocabulary shown to the applicant. It is DERIVED
 *    from the internal state (`applicantStatusFor`), never independently
 *    settable.
 *
 * ONLY what the requirements define AND this step delivers is executable:
 * the applicant action SUBMIT, DRAFT -> SUBMITTED (TRD §3.2 "DRAFT ->
 * SUBMITTED"; FRD §17). Every later arrow of the TRD graph (scrutiny, query
 * loop, inspection, recommendation, decision, certificate, renewal,
 * withdrawal, cancellation, duplicate handling) belongs to the officer /
 * workflow / renewal steps and is deliberately NOT executable here — and the
 * scrutiny-recommends / Approving-Authority-decides boundary is preserved by
 * there being no path here from any applicant action to a decision state.
 *
 * Pure: no framework, no I/O.
 */
export type ApplicationAction = 'SUBMIT';

export interface TransitionDefinition {
  action: ApplicationAction;
  from: InternalApplicationState;
  to: InternalApplicationState;
}

export const EXECUTABLE_TRANSITIONS: readonly TransitionDefinition[] = [
  { action: 'SUBMIT', from: 'DRAFT', to: 'SUBMITTED' },
];

/** The transition an action performs from a state, or undefined when the
 * action is not defined from that state. */
export function findTransition(
  action: ApplicationAction,
  from: InternalApplicationState,
): TransitionDefinition | undefined {
  return EXECUTABLE_TRANSITIONS.find(
    (t) => t.action === action && t.from === from,
  );
}

/** FRD §17.3: the form is editable by the applicant only while a draft. */
export function isEditable(state: InternalApplicationState): boolean {
  return state === 'DRAFT';
}

/**
 * The applicant may add or replace documents while the application is a draft
 * (FRD 13/14) AND while a department query is open (FRD 19.1: a query can ask
 * for documents and the response has "a document upload option"). Never
 * otherwise: a submitted form is read-only (FRD 17.3).
 */
export function allowsDocumentChanges(
  state: InternalApplicationState,
): boolean {
  return state === 'DRAFT' || state === 'QUERY_RAISED';
}

/** Internal states from which an application can never proceed again (TRD
 * §3.2: rejected, withdrawn, cancelled, expired, or flagged duplicate). Any
 * other state is "live" for the one-application-per-approval rule. */
const TERMINAL_STATES: readonly InternalApplicationState[] = [
  'REJECTED',
  'WITHDRAWN_BY_APPLICANT',
  'CANCELLED',
  'EXPIRED',
  'DUPLICATE_FLAGGED',
];

export function isLive(state: InternalApplicationState): boolean {
  return !TERMINAL_STATES.includes(state);
}

/** Internal states that count as "live" — for use in a database filter. */
export const LIVE_STATES: InternalApplicationState[] = Object.values(
  InternalApplicationState,
).filter((state) => isLive(state));

/**
 * The applicant-facing status for an internal state (FRD 11.2 vocabulary).
 * Defined for the states the applicant lifecycle and officer scrutiny produce:
 *   DRAFT                    -> "Draft", or "Ready to Submit" once
 *                               pre-submission validation has no blocking problem
 *   SUBMITTED                -> "Submitted"
 *   UNDER_SCRUTINY           -> "Under Scrutiny"
 *   QUERY_RAISED             -> "Query Raised"
 *   APPLICANT_RESPONDED      -> "Under Scrutiny" (the answer is back with the
 *                               department; FRD 11.2 has no separate "responded")
 *   RECOMMENDED_FOR_APPROVAL -> "Awaiting Decision" (scrutiny is finished; only
 *                               the Approving Authority can decide)
 *   APPROVED / CERTIFICATE_ISSUED / ACTIVE -> "Approved" (the Approving
 *                               Authority approved it; certificate issuance and
 *                               the compliance period do not change what the
 *                               applicant is told: FRD 11.2 has no separate
 *                               status for them)
 *   REJECTED                 -> "Rejected"
 * "Awaiting Applicant" is deliberately NOT used: FRD 11.2 lists it right after
 * "Query Raised" without saying how the two differ, so no rule is invented.
 * Any other state returns null: its mapping belongs to the step that
 * introduces it (inspection, renewal...). "Closed" is never derived: what
 * closes an application (FRD 11.2 "Closed") is not defined.
 */
export function applicantStatusFor(
  state: InternalApplicationState,
  readyToSubmit = false,
): ApplicantStatus | null {
  switch (state) {
    case 'DRAFT':
      return readyToSubmit ? 'READY_TO_SUBMIT' : 'DRAFT';
    case 'SUBMITTED':
      return 'SUBMITTED';
    case 'UNDER_SCRUTINY':
    case 'APPLICANT_RESPONDED':
      return 'UNDER_SCRUTINY';
    case 'QUERY_RAISED':
      return 'QUERY_RAISED';
    case 'RECOMMENDED_FOR_APPROVAL':
      return 'AWAITING_DECISION';
    case 'APPROVED':
    case 'CERTIFICATE_ISSUED':
    case 'ACTIVE':
      return 'APPROVED';
    case 'REJECTED':
      return 'REJECTED';
    default:
      return null;
  }
}
