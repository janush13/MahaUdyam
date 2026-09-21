import { SchemeApplicationStatus } from '@prisma/client';
import {
  SCHEME_TRANSITIONS,
  availableActions,
  findSchemeTransition,
  isFinalStatus,
} from './scheme-state.machine';

const ALL: SchemeApplicationStatus[] = [
  'APPLIED',
  'UNDER_REVIEW',
  'APPROVED',
  'REJECTED',
  'DISBURSED',
];

describe('scheme application state machine (TRD 15)', () => {
  it('defines exactly the documented flow: Applied -> Under Review -> Approved/Rejected -> Disbursed', () => {
    expect(SCHEME_TRANSITIONS.map((t) => `${t.from}>${t.to}`)).toEqual([
      'APPLIED>UNDER_REVIEW',
      'UNDER_REVIEW>APPROVED',
      'UNDER_REVIEW>REJECTED',
      'APPROVED>DISBURSED',
    ]);
  });

  it('finds a transition only from the status the action leaves', () => {
    expect(findSchemeTransition('START_REVIEW', 'APPLIED')?.to).toBe(
      'UNDER_REVIEW',
    );
    expect(findSchemeTransition('APPROVE', 'UNDER_REVIEW')?.to).toBe(
      'APPROVED',
    );
    expect(findSchemeTransition('REJECT', 'UNDER_REVIEW')?.to).toBe('REJECTED');
    expect(findSchemeTransition('DISBURSE', 'APPROVED')?.to).toBe('DISBURSED');
  });

  it('refuses every other (action, status) pair - no skipping, no going back, no leaving a final status', () => {
    const allowed = new Set(
      SCHEME_TRANSITIONS.map((t) => `${t.action}:${t.from}`),
    );
    for (const action of [
      'START_REVIEW',
      'APPROVE',
      'REJECT',
      'DISBURSE',
    ] as const) {
      for (const status of ALL) {
        expect(findSchemeTransition(action, status) !== undefined).toBe(
          allowed.has(`${action}:${status}`),
        );
      }
    }
  });

  it('cannot decide before review starts, or disburse what was not approved', () => {
    expect(findSchemeTransition('APPROVE', 'APPLIED')).toBeUndefined();
    expect(findSchemeTransition('REJECT', 'APPLIED')).toBeUndefined();
    expect(findSchemeTransition('DISBURSE', 'UNDER_REVIEW')).toBeUndefined();
    expect(findSchemeTransition('DISBURSE', 'REJECTED')).toBeUndefined();
  });

  it('reports what can happen next, and which statuses are the end of the line', () => {
    expect(availableActions('APPLIED')).toEqual(['START_REVIEW']);
    expect(availableActions('UNDER_REVIEW')).toEqual(['APPROVE', 'REJECT']);
    expect(availableActions('APPROVED')).toEqual(['DISBURSE']);
    expect(isFinalStatus('REJECTED')).toBe(true);
    expect(isFinalStatus('DISBURSED')).toBe(true);
    expect(isFinalStatus('APPROVED')).toBe(false);
  });
});
