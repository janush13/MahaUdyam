import { InternalApplicationState } from '@prisma/client';
import { EXECUTABLE_TRANSITIONS } from '../applications/application-state.machine';
import { SCRUTINY_TRANSITIONS } from '../officer/scrutiny-state.machine';
import {
  DECIDED_STATES,
  DECISION_TRANSITIONS,
  actionForOutcome,
  authorityActionsFrom,
  findDecisionTransition,
} from './decision-state.machine';

const ALL_STATES = Object.values(InternalApplicationState);

describe('decision state machine (TRD 3.2)', () => {
  it('defines exactly the four documented arrows', () => {
    expect(
      DECISION_TRANSITIONS.map((t) => `${t.action}: ${t.from} -> ${t.to}`),
    ).toEqual([
      'APPROVE: RECOMMENDED_FOR_APPROVAL -> APPROVED',
      'REJECT: RECOMMENDED_FOR_APPROVAL -> REJECTED',
      'ISSUE_CERTIFICATE: APPROVED -> CERTIFICATE_ISSUED',
      'ACTIVATE: CERTIFICATE_ISSUED -> ACTIVE',
    ]);
  });

  it('the decision is the Approving Authority’s; activation is the platform’s consequence, never a client action', () => {
    for (const t of DECISION_TRANSITIONS) {
      expect(t.actor).toBe(
        t.action === 'ACTIVATE' ? 'SYSTEM' : 'APPROVING_AUTHORITY',
      );
    }
    expect(
      ALL_STATES.flatMap((s) => authorityActionsFrom(s)).includes('ACTIVATE'),
    ).toBe(false);
  });

  it.each(ALL_STATES.filter((s) => s !== 'RECOMMENDED_FOR_APPROVAL'))(
    'no decision can be made from %s',
    (state) => {
      expect(findDecisionTransition('APPROVE', state)).toBeUndefined();
      expect(findDecisionTransition('REJECT', state)).toBeUndefined();
    },
  );

  it.each(ALL_STATES.filter((s) => s !== 'APPROVED'))(
    'no certificate can be issued from %s',
    (state) => {
      expect(
        findDecisionTransition('ISSUE_CERTIFICATE', state),
      ).toBeUndefined();
    },
  );

  it('maps each outcome to its own action', () => {
    expect(actionForOutcome('APPROVE')).toBe('APPROVE');
    expect(actionForOutcome('REJECT')).toBe('REJECT');
  });

  it('offers the authority its acts by state, and nothing once decided and issued', () => {
    expect(authorityActionsFrom('RECOMMENDED_FOR_APPROVAL')).toEqual([
      'APPROVE',
      'REJECT',
    ]);
    expect(authorityActionsFrom('APPROVED')).toEqual(['ISSUE_CERTIFICATE']);
    for (const s of ['REJECTED', 'CERTIFICATE_ISSUED', 'ACTIVE'] as const) {
      expect(authorityActionsFrom(s)).toEqual([]);
    }
  });

  it('keeps recommendation and decision apart: no applicant or scrutiny arrow reaches a decision state', () => {
    const decisionTargets = new Set(
      DECISION_TRANSITIONS.map((t) => t.to as string),
    );
    for (const t of [...EXECUTABLE_TRANSITIONS, ...SCRUTINY_TRANSITIONS]) {
      expect(decisionTargets.has(t.to)).toBe(false);
    }
  });

  it('lists the states after a decision', () => {
    expect([...DECIDED_STATES]).toEqual([
      'APPROVED',
      'REJECTED',
      'CERTIFICATE_ISSUED',
      'ACTIVE',
    ]);
  });
});
