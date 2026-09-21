import {
  addDaysYmd,
  addMonthsYmd,
  evaluateStatus,
  firstDueDate,
  occurrenceDueDate,
  recurrenceMonths,
  toYmd,
  todayYmd,
  ymdToDate,
} from './compliance-dates';

const IST = 330;

describe('calendar dates', () => {
  it('round-trips a @db.Date value', () => {
    expect(toYmd(ymdToDate('2027-02-28'))).toBe('2027-02-28');
    expect(ymdToDate('2027-02-28').toISOString()).toBe(
      '2027-02-28T00:00:00.000Z',
    );
  });

  it('"today" is the calendar day in the configured offset, not in UTC', () => {
    // 20:00 UTC on 30 Sep is already 1 Oct in India.
    expect(todayYmd(new Date('2026-09-30T20:00:00.000Z'), IST)).toBe(
      '2026-10-01',
    );
    expect(todayYmd(new Date('2026-09-30T20:00:00.000Z'), 0)).toBe(
      '2026-09-30',
    );
  });

  it('adds days across month and year ends, and backwards', () => {
    expect(addDaysYmd('2026-12-30', 3)).toBe('2027-01-02');
    expect(addDaysYmd('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDaysYmd('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDaysYmd('2026-05-05', 0)).toBe('2026-05-05');
  });

  it('adds months, clamping to the end of a shorter month', () => {
    expect(addMonthsYmd('2027-01-31', 1)).toBe('2027-02-28');
    expect(addMonthsYmd('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonthsYmd('2027-01-15', 12)).toBe('2028-01-15');
    expect(addMonthsYmd('2027-11-30', 3)).toBe('2028-02-29');
    expect(addMonthsYmd('2027-03-31', -1)).toBe('2027-02-28');
  });

  it('rejects something that is not a calendar date', () => {
    expect(() => addDaysYmd('31/12/2026', 1)).toThrow(RangeError);
  });
});

describe('firstDueDate: nothing is guessed', () => {
  it('is null when no offset is configured', () => {
    expect(
      firstDueDate(new Date('2026-09-25T10:00:00Z'), null, IST),
    ).toBeNull();
  });

  it('is the start day plus the configured calendar days (0 = the start day itself)', () => {
    const start = new Date('2026-09-25T10:00:00Z');
    expect(firstDueDate(start, 0, IST)).toBe('2026-09-25');
    expect(firstDueDate(start, 30, IST)).toBe('2026-10-25');
  });

  it('counts the start day in the configured calendar', () => {
    expect(firstDueDate(new Date('2026-09-25T20:00:00Z'), 1, IST)).toBe(
      '2026-09-27',
    );
  });
});

describe('recurrence is what the frequency names, counted from the first due date', () => {
  it('steps: ONE_TIME none, MONTHLY 1 month, ANNUAL 12', () => {
    expect(recurrenceMonths('ONE_TIME')).toBeNull();
    expect(recurrenceMonths('MONTHLY')).toBe(1);
    expect(recurrenceMonths('ANNUAL')).toBe(12);
  });

  it('a one-time obligation has only its first occurrence', () => {
    expect(occurrenceDueDate('2027-01-31', 'ONE_TIME', 1)).toBe('2027-01-31');
    expect(occurrenceDueDate('2027-01-31', 'ONE_TIME', 2)).toBeNull();
  });

  it('a month-end anchor does not drift (31 Jan, 28 Feb, 31 Mar, 30 Apr)', () => {
    const due = [1, 2, 3, 4].map((n) =>
      occurrenceDueDate('2027-01-31', 'MONTHLY', n),
    );
    expect(due).toEqual([
      '2027-01-31',
      '2027-02-28',
      '2027-03-31',
      '2027-04-30',
    ]);
  });

  it('an annual obligation recurs each year, leap days included', () => {
    expect(occurrenceDueDate('2027-06-15', 'ANNUAL', 3)).toBe('2029-06-15');
    expect(occurrenceDueDate('2027-02-28', 'ANNUAL', 2)).toBe('2028-02-28');
  });
});

describe('evaluateStatus (FRD 27.1 Upcoming -> Due -> Overdue)', () => {
  it('is UPCOMING before the window, DUE from the window start through the due date, OVERDUE after', () => {
    // due 2026-10-10, window 3 days: due from 2026-10-07.
    expect(evaluateStatus('2026-10-10', '2026-10-06', 3)).toBe('UPCOMING');
    expect(evaluateStatus('2026-10-10', '2026-10-07', 3)).toBe('DUE');
    expect(evaluateStatus('2026-10-10', '2026-10-10', 3)).toBe('DUE');
    expect(evaluateStatus('2026-10-10', '2026-10-11', 3)).toBe('OVERDUE');
  });

  it('with no window it is DUE only on the due date itself', () => {
    expect(evaluateStatus('2026-10-10', '2026-10-09', 0)).toBe('UPCOMING');
    expect(evaluateStatus('2026-10-10', '2026-10-10', 0)).toBe('DUE');
    expect(evaluateStatus('2026-10-10', '2026-10-11', 0)).toBe('OVERDUE');
  });

  it('with no due date there is nothing to be due or overdue against', () => {
    expect(evaluateStatus(null, '2099-01-01', 0)).toBe('UPCOMING');
  });

  it('never returns FULFILLED: that is an action, not a date', () => {
    for (const today of ['2020-01-01', '2026-10-10', '2099-01-01']) {
      expect(evaluateStatus('2026-10-10', today, 5)).not.toBe('FULFILLED');
    }
  });
});
