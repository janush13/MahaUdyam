import {
  ClockRow,
  PausePeriod,
  extendDue,
  isBreached,
  measure,
  pausedMs,
} from './sla-clock';

const H = 3_600_000;
const t0 = new Date('2026-09-21T04:30:00.000Z');
const at = (hours: number) => new Date(t0.getTime() + hours * H);

const clock = (over: Partial<ClockRow> = {}): ClockRow => ({
  status: 'RUNNING',
  startedAt: t0,
  originalDueAt: at(100),
  dueAt: at(100),
  pausedAt: null,
  completedAt: null,
  breachedAt: null,
  ...over,
});

describe('extendDue (Blueprint 23.2: recalculated forward by the elapsed pause duration)', () => {
  it('moves the deadline forward by exactly the paused time', () => {
    expect(extendDue(at(100), at(10), at(34)).getTime()).toBe(
      at(124).getTime(),
    );
  });

  it('never moves it earlier', () => {
    expect(extendDue(at(100), at(34), at(10)).getTime()).toBe(
      at(100).getTime(),
    );
    expect(extendDue(at(100), at(10), at(10)).getTime()).toBe(
      at(100).getTime(),
    );
  });
});

describe('pausedMs', () => {
  const periods: PausePeriod[] = [
    { pausedAt: at(10), resumedAt: at(14) },
    { pausedAt: at(20), resumedAt: at(21) },
    { pausedAt: at(30), resumedAt: null },
  ];

  it('sums every period; an open pause counts to now', () => {
    expect(pausedMs(periods.slice(0, 2), at(50))).toBe(5 * H);
    expect(pausedMs(periods, at(32))).toBe(7 * H);
    expect(pausedMs([], at(32))).toBe(0);
  });
});

describe('isBreached', () => {
  it('a running clock is breached once its deadline has passed — strictly after', () => {
    expect(isBreached(clock(), at(100))).toBe(false);
    expect(isBreached(clock(), new Date(at(100).getTime() + 1))).toBe(true);
    expect(isBreached(clock(), at(1))).toBe(false);
  });

  it('a paused clock is frozen at the moment it paused', () => {
    const paused = clock({ status: 'PAUSED', pausedAt: at(50) });
    expect(isBreached(paused, at(500))).toBe(false);
    expect(
      isBreached(clock({ status: 'PAUSED', pausedAt: at(101) }), at(101)),
    ).toBe(true);
  });

  it('a completed clock is breached only if it finished after its deadline', () => {
    const done = (h: number) =>
      clock({ status: 'COMPLETED', completedAt: at(h) });
    expect(isBreached(done(99), at(500))).toBe(false);
    expect(isBreached(done(100), at(500))).toBe(false);
    expect(isBreached(done(101), at(500))).toBe(true);
  });

  it('a recorded breach stays a breach, and a clock with no deadline can never breach', () => {
    expect(isBreached(clock({ breachedAt: at(101) }), at(1))).toBe(true);
    const none = clock({
      status: 'NOT_CONFIGURED',
      originalDueAt: null,
      dueAt: null,
    });
    expect(isBreached(none, at(100_000))).toBe(false);
  });
});

describe('measure', () => {
  it('elapsed excludes paused time; remaining counts to the (extended) deadline', () => {
    const paused: PausePeriod[] = [{ pausedAt: at(10), resumedAt: at(34) }];
    const m = measure(clock({ dueAt: at(124) }), paused, at(50), null);
    expect(m.totalPausedMs).toBe(24 * H);
    expect(m.elapsedMs).toBe(26 * H);
    expect(m.remainingMs).toBe(74 * H);
    expect(m.breached).toBe(false);
    expect(m.percentElapsed).toBeCloseTo(26, 5);
  });

  it('remaining is FROZEN while paused', () => {
    const c = clock({ status: 'PAUSED', pausedAt: at(10) });
    const open: PausePeriod[] = [{ pausedAt: at(10), resumedAt: null }];
    expect(measure(c, open, at(20), null).remainingMs).toBe(90 * H);
    expect(measure(c, open, at(900), null).remainingMs).toBe(90 * H);
    expect(measure(c, open, at(900), null).elapsedMs).toBe(10 * H);
  });

  it('remaining goes negative once past the deadline, and is null with no deadline or once completed', () => {
    expect(measure(clock(), [], at(110), null).remainingMs).toBe(-10 * H);
    const none = clock({
      status: 'NOT_CONFIGURED',
      originalDueAt: null,
      dueAt: null,
    });
    const m = measure(none, [], at(50), 80);
    expect(m.remainingMs).toBeNull();
    expect(m.percentElapsed).toBeNull();
    expect(m.warning).toBe(false);
    const done = clock({ status: 'COMPLETED', completedAt: at(40) });
    const md = measure(done, [], at(500), null);
    expect(md.remainingMs).toBeNull();
    expect(md.elapsedMs).toBe(40 * H);
  });

  it('warns only when a threshold is configured, the clock runs, and it has reached it', () => {
    expect(measure(clock(), [], at(79), 80).warning).toBe(false);
    expect(measure(clock(), [], at(80), 80).warning).toBe(true);
    expect(measure(clock(), [], at(99), 80).warning).toBe(true);
    // No default threshold: nothing is inferred.
    expect(measure(clock(), [], at(99), null).warning).toBe(false);
    // Past the deadline it is a breach, not a warning.
    const late = measure(clock(), [], at(101), 80);
    expect(late.breached).toBe(true);
    expect(late.warning).toBe(false);
    // Not while paused or completed.
    expect(
      measure(clock({ status: 'PAUSED', pausedAt: at(90) }), [], at(95), 80)
        .warning,
    ).toBe(false);
  });

  it('is derived from the stored clock alone (the same inputs give the same numbers)', () => {
    const a = measure(clock(), [], at(33), 80);
    const b = measure(clock(), [], at(33), 80);
    expect(a).toEqual(b);
  });
});
