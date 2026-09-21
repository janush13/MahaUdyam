import { InternalApplicationState } from '@prisma/client';
import {
  ASSIGNABLE_STATES,
  DOCUMENT_REVIEW_STATES,
  SCRUTINY_TRANSITIONS,
  ScrutinyAction,
  WORKING_STATES,
  findScrutinyTransition,
  officerActionsFrom,
} from './scrutiny-state.machine';

const ALL_STATES = Object.values(InternalApplicationState);
const ACTIONS: ScrutinyAction[] = [
  'START_SCRUTINY',
  'RAISE_QUERY',
  'RESPOND_TO_QUERY',
  'CLOSE_QUERY',
  'RECOMMEND',
];

describe('scrutiny state machine', () => {
  it('defines exactly the five arrows this step delivers', () => {
    expect(
      SCRUTINY_TRANSITIONS.map((t) => `${t.action}:${t.from}->${t.to}`),
    ).toEqual([
      'START_SCRUTINY:SUBMITTED->UNDER_SCRUTINY',
      'RAISE_QUERY:UNDER_SCRUTINY->QUERY_RAISED',
      'RESPOND_TO_QUERY:QUERY_RAISED->APPLICANT_RESPONDED',
      'CLOSE_QUERY:APPLICANT_RESPONDED->UNDER_SCRUTINY',
      'RECOMMEND:UNDER_SCRUTINY->RECOMMENDED_FOR_APPROVAL',
    ]);
  });

  it('only the applicant answers a query; every other arrow is the officer’s', () => {
    for (const t of SCRUTINY_TRANSITIONS) {
      expect(t.actor).toBe(
        t.action === 'RESPOND_TO_QUERY' ? 'APPLICANT' : 'OFFICER',
      );
    }
  });

  it('has no path to a decision, certificate, inspection or terminal state', () => {
    const targets = new Set(SCRUTINY_TRANSITIONS.map((t) => t.to));
    for (const forbidden of [
      'APPROVED',
      'REJECTED',
      'CERTIFICATE_ISSUED',
      'INSPECTION_SCHEDULED',
      'WITHDRAWN_BY_APPLICANT',
      'CANCELLED',
    ] as InternalApplicationState[]) {
      expect(targets.has(forbidden)).toBe(false);
    }
  });

  it('nothing leaves RECOMMENDED_FOR_APPROVAL: it is the Approving Authority’s', () => {
    for (const action of ACTIONS) {
      expect(
        findScrutinyTransition(action, 'RECOMMENDED_FOR_APPROVAL'),
      ).toBeUndefined();
    }
    expect(officerActionsFrom('RECOMMENDED_FOR_APPROVAL')).toEqual([]);
  });

  it('every action is defined from exactly one state, and refused from all others', () => {
    for (const action of ACTIONS) {
      const allowed = ALL_STATES.filter((s) =>
        findScrutinyTransition(action, s),
      );
      expect(allowed).toHaveLength(1);
    }
  });

  it('never allows a draft to be scrutinised', () => {
    for (const action of ACTIONS) {
      expect(findScrutinyTransition(action, 'DRAFT')).toBeUndefined();
    }
  });

  it('offers an officer only their own actions, per state', () => {
    expect(officerActionsFrom('SUBMITTED')).toEqual(['START_SCRUTINY']);
    expect(officerActionsFrom('UNDER_SCRUTINY')).toEqual([
      'RAISE_QUERY',
      'RECOMMEND',
    ]);
    // Awaiting the applicant: the officer can do nothing to the state.
    expect(officerActionsFrom('QUERY_RAISED')).toEqual([]);
    expect(officerActionsFrom('APPLICANT_RESPONDED')).toEqual(['CLOSE_QUERY']);
    expect(officerActionsFrom('DRAFT')).toEqual([]);
  });

  it('assignment is possible before and during scrutiny, never after it', () => {
    expect([...ASSIGNABLE_STATES].sort()).toEqual(
      ['SUBMITTED', ...WORKING_STATES].sort(),
    );
    expect(ASSIGNABLE_STATES).not.toContain('RECOMMENDED_FOR_APPROVAL');
    expect(ASSIGNABLE_STATES).not.toContain('DRAFT');
  });

  it('documents are reviewed only while scrutiny is active, not mid-query', () => {
    expect(DOCUMENT_REVIEW_STATES).toEqual(['UNDER_SCRUTINY']);
  });
});
