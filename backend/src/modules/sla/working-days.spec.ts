import {
  WorkingCalendar,
  addWorkingDays,
  isWorkingDay,
  localDateOf,
  localWeekdayOf,
} from './working-days';

const IST = 330;
const calendar = (over: Partial<WorkingCalendar> = {}): WorkingCalendar => ({
  utcOffsetMinutes: IST,
  weekendDays: [0, 6],
  holidays: new Set<string>(),
  ...over,
});
/** An instant from an IST wall-clock time, so the cases read like a diary.
 * (2026-09-21 is a Monday.) */
const ist = (iso: string): Date => new Date(`${iso}+05:30`);
const at = (d: Date): string =>
  new Date(d.getTime() + IST * 60_000).toISOString().slice(0, 16);

describe('addWorkingDays (Blueprint 23.2: started_at + sla_days working days)', () => {
  it('counts weekdays and keeps the time of day', () => {
    expect(at(addWorkingDays(ist('2026-09-21T10:30'), 1, calendar()))).toBe(
      '2026-09-22T10:30',
    );
    expect(at(addWorkingDays(ist('2026-09-21T10:30'), 3, calendar()))).toBe(
      '2026-09-24T10:30',
    );
  });

  it('skips the weekend', () => {
    // Friday + 1 = Monday; Monday + 5 = the next Monday.
    expect(at(addWorkingDays(ist('2026-09-25T09:00'), 1, calendar()))).toBe(
      '2026-09-28T09:00',
    );
    expect(at(addWorkingDays(ist('2026-09-21T09:00'), 5, calendar()))).toBe(
      '2026-09-28T09:00',
    );
    expect(at(addWorkingDays(ist('2026-09-21T09:00'), 10, calendar()))).toBe(
      '2026-10-05T09:00',
    );
  });

  it('a start on a non-working day is not itself counted', () => {
    // Saturday + 1 working day = Monday (Sunday is skipped, Monday counts).
    expect(at(addWorkingDays(ist('2026-09-26T12:00'), 1, calendar()))).toBe(
      '2026-09-28T12:00',
    );
    expect(at(addWorkingDays(ist('2026-09-27T12:00'), 1, calendar()))).toBe(
      '2026-09-28T12:00',
    );
  });

  it('skips configured holidays', () => {
    const holidays = new Set(['2026-09-22']);
    expect(
      at(addWorkingDays(ist('2026-09-21T10:00'), 1, calendar({ holidays }))),
    ).toBe('2026-09-23T10:00');
    // A holiday on the weekend changes nothing; back-to-back holidays chain.
    expect(
      at(
        addWorkingDays(
          ist('2026-09-24T10:00'),
          1,
          calendar({ holidays: new Set(['2026-09-26']) }),
        ),
      ),
    ).toBe('2026-09-25T10:00');
    expect(
      at(
        addWorkingDays(
          ist('2026-09-24T10:00'),
          2,
          calendar({ holidays: new Set(['2026-09-25', '2026-09-28']) }),
        ),
      ),
    ).toBe('2026-09-30T10:00');
  });

  it('counts calendar days in the configured offset, not in UTC', () => {
    // 20:00 UTC on Friday is 01:30 on SATURDAY in IST.
    const start = new Date('2026-09-25T20:00:00Z');
    expect(localDateOf(start, IST)).toBe('2026-09-26');
    expect(localWeekdayOf(start, IST)).toBe(6);
    // Working days from a Saturday start: Monday.
    expect(addWorkingDays(start, 1, calendar()).toISOString()).toBe(
      '2026-09-27T20:00:00.000Z',
    );
    // The same instant in a UTC calendar is a Friday, so the next working day
    // is the Monday after the weekend, a day later.
    expect(
      addWorkingDays(start, 1, calendar({ utcOffsetMinutes: 0 })).toISOString(),
    ).toBe('2026-09-28T20:00:00.000Z');
  });

  it('honours a different weekend', () => {
    // Only Friday off: Thursday + 1 skips Friday.
    expect(
      at(
        addWorkingDays(
          ist('2026-09-24T10:00'),
          1,
          calendar({ weekendDays: [5] }),
        ),
      ),
    ).toBe('2026-09-26T10:00');
    // No weekend at all: plain calendar days.
    expect(
      at(
        addWorkingDays(
          ist('2026-09-25T10:00'),
          3,
          calendar({ weekendDays: [] }),
        ),
      ),
    ).toBe('2026-09-28T10:00');
  });

  it('is deterministic and does not mutate its inputs', () => {
    const start = ist('2026-09-21T10:00');
    const holidays = new Set(['2026-09-22']);
    const a = addWorkingDays(start, 7, calendar({ holidays }));
    const b = addWorkingDays(start, 7, calendar({ holidays }));
    expect(a.getTime()).toBe(b.getTime());
    expect(start.getTime()).toBe(ist('2026-09-21T10:00').getTime());
    expect(holidays.size).toBe(1);
  });

  it('refuses a non-positive or fractional duration, and an impossible calendar', () => {
    for (const days of [0, -1, 1.5, Number.NaN]) {
      expect(() =>
        addWorkingDays(ist('2026-09-21T10:00'), days, calendar()),
      ).toThrow(RangeError);
    }
    expect(() =>
      addWorkingDays(
        ist('2026-09-21T10:00'),
        1,
        calendar({ weekendDays: [0, 1, 2, 3, 4, 5, 6] }),
      ),
    ).toThrow(RangeError);
    // Every day a holiday for years: refuses instead of looping forever.
    const many = new Set<string>();
    for (let i = 0; i < 400; i++) {
      many.add(
        new Date(Date.UTC(2026, 8, 22) + i * 86_400_000)
          .toISOString()
          .slice(0, 10),
      );
    }
    expect(() =>
      addWorkingDays(ist('2026-09-21T10:00'), 1, calendar({ holidays: many })),
    ).toThrow(RangeError);
  });
});

describe('isWorkingDay', () => {
  it('is false on weekends and holidays only', () => {
    const cal = calendar({ holidays: new Set(['2026-09-23']) });
    expect(isWorkingDay(ist('2026-09-21T10:00'), cal)).toBe(true);
    expect(isWorkingDay(ist('2026-09-23T10:00'), cal)).toBe(false);
    expect(isWorkingDay(ist('2026-09-26T10:00'), cal)).toBe(false);
    expect(isWorkingDay(ist('2026-09-27T10:00'), cal)).toBe(false);
  });
});
