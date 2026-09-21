import { InternalApplicationState } from '@prisma/client';
import {
  EXECUTABLE_TRANSITIONS,
  allowsDocumentChanges,
  LIVE_STATES,
  applicantStatusFor,
  findTransition,
  isEditable,
  isLive,
} from './application-state.machine';

const ALL_STATES = Object.values(InternalApplicationState);

describe('application state machine', () => {
  describe('executable transitions', () => {
    it('defines exactly one applicant transition: SUBMIT, DRAFT -> SUBMITTED', () => {
      expect(EXECUTABLE_TRANSITIONS).toEqual([
        { action: 'SUBMIT', from: 'DRAFT', to: 'SUBMITTED' },
      ]);
    });

    it('resolves SUBMIT from DRAFT', () => {
      expect(findTransition('SUBMIT', 'DRAFT')).toEqual({
        action: 'SUBMIT',
        from: 'DRAFT',
        to: 'SUBMITTED',
      });
    });

    it.each(ALL_STATES.filter((s) => s !== 'DRAFT'))(
      'does not allow SUBMIT from %s',
      (state) => {
        expect(findTransition('SUBMIT', state)).toBeUndefined();
      },
    );

    it('offers no path from an applicant action to any decision state (recommend is not decide)', () => {
      const reachable = new Set(EXECUTABLE_TRANSITIONS.map((t) => t.to));
      for (const decision of [
        'RECOMMENDED_FOR_APPROVAL',
        'APPROVED',
        'REJECTED',
        'CERTIFICATE_ISSUED',
      ] as const) {
        expect(reachable.has(decision)).toBe(false);
      }
    });
  });

  describe('editability', () => {
    it('is editable only while DRAFT (FRD 17.3)', () => {
      for (const state of ALL_STATES) {
        expect(isEditable(state)).toBe(state === 'DRAFT');
      }
    });
  });

  describe('applicant-facing status derivation', () => {
    it('maps DRAFT to Draft, or Ready to Submit when validation passes', () => {
      expect(applicantStatusFor('DRAFT')).toBe('DRAFT');
      expect(applicantStatusFor('DRAFT', false)).toBe('DRAFT');
      expect(applicantStatusFor('DRAFT', true)).toBe('READY_TO_SUBMIT');
    });

    it('maps SUBMITTED to Submitted regardless of readiness', () => {
      expect(applicantStatusFor('SUBMITTED')).toBe('SUBMITTED');
      expect(applicantStatusFor('SUBMITTED', true)).toBe('SUBMITTED');
    });

    it('maps the scrutiny states to the FRD 11.2 vocabulary (Step 10)', () => {
      expect(applicantStatusFor('UNDER_SCRUTINY')).toBe('UNDER_SCRUTINY');
      expect(applicantStatusFor('QUERY_RAISED')).toBe('QUERY_RAISED');
      // FRD 11.2 has no separate "responded": the answer is back with the
      // department, so the applicant sees "Under Scrutiny".
      expect(applicantStatusFor('APPLICANT_RESPONDED')).toBe('UNDER_SCRUTINY');
      // Scrutiny is finished; only the Approving Authority can decide.
      expect(applicantStatusFor('RECOMMENDED_FOR_APPROVAL')).toBe(
        'AWAITING_DECISION',
      );
    });

    it('maps the decision states to Approved / Rejected (Step 15); no status is derived for Closed', () => {
      for (const state of [
        'APPROVED',
        'CERTIFICATE_ISSUED',
        'ACTIVE',
      ] as const) {
        expect(applicantStatusFor(state)).toBe('APPROVED');
      }
      expect(applicantStatusFor('REJECTED')).toBe('REJECTED');
      for (const state of ALL_STATES) {
        expect(applicantStatusFor(state)).not.toBe('CLOSED');
      }
    });

    const MAPPED = new Set([
      'DRAFT',
      'SUBMITTED',
      'UNDER_SCRUTINY',
      'QUERY_RAISED',
      'APPLICANT_RESPONDED',
      'RECOMMENDED_FOR_APPROVAL',
      'APPROVED',
      'CERTIFICATE_ISSUED',
      'ACTIVE',
      'REJECTED',
    ]);
    it.each(ALL_STATES.filter((s) => !MAPPED.has(s)))(
      'does not invent a mapping for %s (owned by a later step)',
      (state) => {
        expect(applicantStatusFor(state)).toBeNull();
      },
    );
  });

  describe('document changes', () => {
    it('are open to the applicant only while a draft or while a department query is open (FRD 13/14, 19.1)', () => {
      for (const state of ALL_STATES) {
        expect(allowsDocumentChanges(state)).toBe(
          state === 'DRAFT' || state === 'QUERY_RAISED',
        );
      }
    });
  });

  describe('live vs terminal states', () => {
    it('treats rejected / withdrawn / cancelled / expired / duplicate as terminal', () => {
      for (const s of [
        'REJECTED',
        'WITHDRAWN_BY_APPLICANT',
        'CANCELLED',
        'EXPIRED',
        'DUPLICATE_FLAGGED',
      ] as const) {
        expect(isLive(s)).toBe(false);
        expect(LIVE_STATES).not.toContain(s);
      }
    });

    it('treats DRAFT, SUBMITTED and in-progress states as live', () => {
      for (const s of [
        'DRAFT',
        'SUBMITTED',
        'UNDER_SCRUTINY',
        'ACTIVE',
      ] as const) {
        expect(isLive(s)).toBe(true);
        expect(LIVE_STATES).toContain(s);
      }
    });
  });
});
