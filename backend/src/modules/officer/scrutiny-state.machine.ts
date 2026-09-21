import { InternalApplicationState } from '@prisma/client';

/**
 * The scrutiny part of the TRD 3.2 state machine — ONLY the arrows the
 * requirements define AND this step delivers:
 *
 *   SUBMITTED           -> UNDER_SCRUTINY            officer starts scrutiny
 *   UNDER_SCRUTINY      -> QUERY_RAISED              officer raises a query
 *   QUERY_RAISED        -> APPLICANT_RESPONDED       APPLICANT answers it
 *   APPLICANT_RESPONDED -> UNDER_SCRUTINY            officer closes the query
 *                                                    and resumes ("query loop")
 *   UNDER_SCRUTINY      -> RECOMMENDED_FOR_APPROVAL  officer recommends
 *                                                    approval OR rejection to the
 *                                                    Approving Authority
 *
 * Deliberately absent, because they belong to later steps or are undefined:
 * inspection arrows, APPROVED / REJECTED / CERTIFICATE_ISSUED (the Approving
 * Authority's decision), returning a recommendation for clarification,
 * withdrawal, cancellation, escalation, the capped query loop. There is no path
 * from any action here to a decision state.
 *
 * Every transition names WHO may perform it, and every state change goes
 * through `findScrutinyTransition` — a client can never name a target state.
 * Pure: no framework, no I/O.
 */
export type ScrutinyAction =
  | 'START_SCRUTINY'
  | 'RAISE_QUERY'
  | 'RESPOND_TO_QUERY'
  | 'CLOSE_QUERY'
  | 'RECOMMEND';

export type ScrutinyActor = 'OFFICER' | 'APPLICANT';

export interface ScrutinyTransition {
  action: ScrutinyAction;
  from: InternalApplicationState;
  to: InternalApplicationState;
  actor: ScrutinyActor;
}

export const SCRUTINY_TRANSITIONS: readonly ScrutinyTransition[] = [
  {
    action: 'START_SCRUTINY',
    from: 'SUBMITTED',
    to: 'UNDER_SCRUTINY',
    actor: 'OFFICER',
  },
  {
    action: 'RAISE_QUERY',
    from: 'UNDER_SCRUTINY',
    to: 'QUERY_RAISED',
    actor: 'OFFICER',
  },
  {
    action: 'RESPOND_TO_QUERY',
    from: 'QUERY_RAISED',
    to: 'APPLICANT_RESPONDED',
    actor: 'APPLICANT',
  },
  {
    action: 'CLOSE_QUERY',
    from: 'APPLICANT_RESPONDED',
    to: 'UNDER_SCRUTINY',
    actor: 'OFFICER',
  },
  {
    action: 'RECOMMEND',
    from: 'UNDER_SCRUTINY',
    to: 'RECOMMENDED_FOR_APPROVAL',
    actor: 'OFFICER',
  },
];

export function findScrutinyTransition(
  action: ScrutinyAction,
  from: InternalApplicationState,
): ScrutinyTransition | undefined {
  return SCRUTINY_TRANSITIONS.find(
    (t) => t.action === action && t.from === from,
  );
}

/** States in which scrutiny is under way: an officer may record observations. */
export const WORKING_STATES: readonly InternalApplicationState[] = [
  'UNDER_SCRUTINY',
  'QUERY_RAISED',
  'APPLICANT_RESPONDED',
];

/** States in which an application can be (re)assigned to an officer: awaiting
 * scrutiny, or under it. Not once scrutiny has finished (the recommendation is
 * with the Approving Authority). */
export const ASSIGNABLE_STATES: readonly InternalApplicationState[] = [
  'SUBMITTED',
  ...WORKING_STATES,
];

/** Documents are reviewed (verified / rejected) while scrutiny is active — not
 * mid-query, when the applicant may still be changing them. */
export const DOCUMENT_REVIEW_STATES: readonly InternalApplicationState[] = [
  'UNDER_SCRUTINY',
];

/** The actions an officer could take from a state, for the UI (advisory: the
 * server re-checks every one). */
export function officerActionsFrom(
  state: InternalApplicationState,
): ScrutinyAction[] {
  return SCRUTINY_TRANSITIONS.filter(
    (t) => t.from === state && t.actor === 'OFFICER',
  ).map((t) => t.action);
}
