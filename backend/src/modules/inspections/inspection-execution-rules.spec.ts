import {
  correctiveActionRequired,
  currentResults,
  isExecutable,
  isFinal,
  missingItems,
  supersededResults,
} from './inspection-execution-rules';

const at = (n: number) => new Date(Date.UTC(2026, 9, 1, 0, 0, n));
const result = (id: string, item: string, seconds: number) => ({
  id,
  checklistItemId: item,
  recordedAt: at(seconds),
});

describe('inspection execution rules', () => {
  describe('lifecycle', () => {
    it('only a SCHEDULED inspection can be acted on', () => {
      expect(isExecutable('SCHEDULED')).toBe(true);
      for (const status of ['PENDING', 'COMPLETED', 'CANCELLED'] as const) {
        expect(isExecutable(status)).toBe(false);
      }
    });

    it('COMPLETED and CANCELLED are final; PENDING and SCHEDULED are not', () => {
      expect(isFinal('COMPLETED')).toBe(true);
      expect(isFinal('CANCELLED')).toBe(true);
      expect(isFinal('PENDING')).toBe(false);
      expect(isFinal('SCHEDULED')).toBe(false);
    });
  });

  describe('currentResults / supersededResults (append-only results)', () => {
    const rows = [
      result('a1', 'item-A', 1),
      result('b1', 'item-B', 2),
      result('a2', 'item-A', 3),
      result('a3', 'item-A', 5),
    ];

    it('the most recently recorded result of an item is the current one', () => {
      const current = currentResults(rows);
      expect(current.size).toBe(2);
      expect(current.get('item-A')?.id).toBe('a3');
      expect(current.get('item-B')?.id).toBe('b1');
    });

    it('every earlier result stays on the record, oldest first', () => {
      expect(supersededResults(rows, 'item-A').map((r) => r.id)).toEqual([
        'a1',
        'a2',
      ]);
      expect(supersededResults(rows, 'item-B')).toEqual([]);
      expect(supersededResults(rows, 'nope')).toEqual([]);
    });

    it('does not depend on the order the rows arrive in', () => {
      const shuffled = [rows[3], rows[0], rows[2], rows[1]];
      expect(currentResults(shuffled).get('item-A')?.id).toBe('a3');
      expect(supersededResults(shuffled, 'item-A').map((r) => r.id)).toEqual([
        'a1',
        'a2',
      ]);
    });

    it('breaks a tie on the timestamp deterministically: the higher id is newer (as the recording query orders it)', () => {
      const tied = [result('x-1', 'item-A', 7), result('x-2', 'item-A', 7)];
      expect(currentResults(tied).get('item-A')?.id).toBe('x-2');
      expect(currentResults([...tied].reverse()).get('item-A')?.id).toBe('x-2');
    });

    it('does not mutate its input', () => {
      const copy = [...rows];
      currentResults(rows);
      supersededResults(rows, 'item-A');
      expect(rows).toEqual(copy);
    });
  });

  describe('missingItems', () => {
    it('lists the checklist items that have no result, in checklist order', () => {
      const results = [result('r1', 'item-B', 1)];
      expect(missingItems(['item-A', 'item-B', 'item-C'], results)).toEqual([
        'item-A',
        'item-C',
      ]);
    });

    it('a corrected item counts once answered; an empty checklist is complete', () => {
      const results = [result('r1', 'item-A', 1), result('r2', 'item-A', 2)];
      expect(missingItems(['item-A'], results)).toEqual([]);
      expect(missingItems([], [])).toEqual([]);
    });
  });

  describe('correctiveActionRequired (FRD 24.2)', () => {
    it('a NON_COMPLIANT finding needs a corrective-action recommendation; the others do not', () => {
      expect(correctiveActionRequired('NON_COMPLIANT')).toBe(true);
      expect(correctiveActionRequired('COMPLIANT')).toBe(false);
      expect(correctiveActionRequired('CONDITIONAL')).toBe(false);
    });
  });
});
