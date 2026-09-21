import { SchemeApplicationStatus } from '@prisma/client';

/**
 * The scheme application's status changes - exactly TRD 15's "Applied -> Under
 * Review -> Approved/Rejected -> Disbursed" and nothing else. No draft, query,
 * withdrawn or reopened state is defined for a scheme application, so none is
 * modelled and no transition to or from one exists.
 *
 * Each transition is a named DOMAIN ACTION of the Scheme Officer. A client
 * never names a target status: there is no endpoint that takes one.
 *
 * (APPLIED itself is not an action: an application is BORN applied, when the
 * applicant applies.)
 */
export type SchemeAction = 'START_REVIEW' | 'APPROVE' | 'REJECT' | 'DISBURSE';

export interface SchemeTransition {
  action: SchemeAction;
  from: SchemeApplicationStatus;
  to: SchemeApplicationStatus;
}

export const SCHEME_TRANSITIONS: readonly SchemeTransition[] = [
  { action: 'START_REVIEW', from: 'APPLIED', to: 'UNDER_REVIEW' },
  { action: 'APPROVE', from: 'UNDER_REVIEW', to: 'APPROVED' },
  { action: 'REJECT', from: 'UNDER_REVIEW', to: 'REJECTED' },
  { action: 'DISBURSE', from: 'APPROVED', to: 'DISBURSED' },
];

export function findSchemeTransition(
  action: SchemeAction,
  from: SchemeApplicationStatus,
): SchemeTransition | undefined {
  return SCHEME_TRANSITIONS.find((t) => t.action === action && t.from === from);
}

/** The actions available from a status (empty at the end of the line). */
export function availableActions(
  from: SchemeApplicationStatus,
): SchemeAction[] {
  return SCHEME_TRANSITIONS.filter((t) => t.from === from).map((t) => t.action);
}

/** No further change is possible from these. */
export function isFinalStatus(status: SchemeApplicationStatus): boolean {
  return availableActions(status).length === 0;
}

export function actionForOutcome(outcome: 'APPROVE' | 'REJECT'): SchemeAction {
  return outcome;
}
