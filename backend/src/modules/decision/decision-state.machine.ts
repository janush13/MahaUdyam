import { DecisionOutcome, InternalApplicationState } from '@prisma/client';

/**
 * The decision part of the TRD 3.2 state machine — ONLY the arrows the
 * requirements define AND this step delivers:
 *
 *   RECOMMENDED_FOR_APPROVAL -> APPROVED            the Approving Authority approves
 *   RECOMMENDED_FOR_APPROVAL -> REJECTED            the Approving Authority rejects
 *   APPROVED                 -> CERTIFICATE_ISSUED  the certificate is issued
 *   CERTIFICATE_ISSUED       -> ACTIVE              the compliance period begins
 *
 * (TRD 3.2: "RECOMMENDED_FOR_APPROVAL → APPROVED → CERTIFICATE_ISSUED → ACTIVE
 * (compliance period)" and "REJECTED"; Blueprint 8: "Approved → Approval Issued
 * → Compliance Obligations Activated".)
 *
 * Deliberately absent, because they belong to later steps or are undefined:
 * what follows REJECTED ("WITHDRAWN | RESUBMITTED as new version"), renewal
 * (RENEWAL_DUE / RENEWAL_SUBMITTED / EXPIRED), returning an application for
 * clarification (FRD 4.5 "where the department's workflow authorises this
 * step" - no such workflow is configured), correcting a decision (TRD 3.3
 * "within a defined window" - the window is not defined), withdrawal,
 * cancellation, closure. No path here starts anywhere but the recommendation
 * the scrutiny officer produced.
 *
 * Every transition names WHO performs it, and every state change goes through
 * `findDecisionTransition` — a client can never name a target state.
 * Pure: no framework, no I/O.
 */
export type DecisionAction =
  'APPROVE' | 'REJECT' | 'ISSUE_CERTIFICATE' | 'ACTIVATE';

/** `APPROVING_AUTHORITY` is a person's act; `SYSTEM` is the consequence of an
 * act already taken (the compliance period starting once the certificate is
 * issued), never a separate client action. */
export type DecisionActor = 'APPROVING_AUTHORITY' | 'SYSTEM';

export interface DecisionTransition {
  action: DecisionAction;
  from: InternalApplicationState;
  to: InternalApplicationState;
  actor: DecisionActor;
}

export const DECISION_TRANSITIONS: readonly DecisionTransition[] = [
  {
    action: 'APPROVE',
    from: 'RECOMMENDED_FOR_APPROVAL',
    to: 'APPROVED',
    actor: 'APPROVING_AUTHORITY',
  },
  {
    action: 'REJECT',
    from: 'RECOMMENDED_FOR_APPROVAL',
    to: 'REJECTED',
    actor: 'APPROVING_AUTHORITY',
  },
  {
    action: 'ISSUE_CERTIFICATE',
    from: 'APPROVED',
    to: 'CERTIFICATE_ISSUED',
    actor: 'APPROVING_AUTHORITY',
  },
  {
    action: 'ACTIVATE',
    from: 'CERTIFICATE_ISSUED',
    to: 'ACTIVE',
    actor: 'SYSTEM',
  },
];

export function findDecisionTransition(
  action: DecisionAction,
  from: InternalApplicationState,
): DecisionTransition | undefined {
  return DECISION_TRANSITIONS.find(
    (t) => t.action === action && t.from === from,
  );
}

/** The decision action a requested outcome performs. */
export function actionForOutcome(outcome: DecisionOutcome): DecisionAction {
  return outcome === 'APPROVE' ? 'APPROVE' : 'REJECT';
}

/** States an application is in once the Approving Authority has decided. */
export const DECIDED_STATES: readonly InternalApplicationState[] = [
  'APPROVED',
  'REJECTED',
  'CERTIFICATE_ISSUED',
  'ACTIVE',
];

/** The actions the Approving Authority could take from a state, for the UI
 * (advisory: the server re-checks every one). */
export function authorityActionsFrom(
  state: InternalApplicationState,
): DecisionAction[] {
  return DECISION_TRANSITIONS.filter(
    (t) => t.from === state && t.actor === 'APPROVING_AUTHORITY',
  ).map((t) => t.action);
}
