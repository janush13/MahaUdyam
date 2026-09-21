/**
 * The WorkingDaysCalculator of Blueprint 23.2: "started_at + sla_days working
 * days ... skips weekends and a configurable holidays master-data table".
 * Pure: no framework, no I/O, no clock.
 *
 * Days are counted in ONE fixed-offset calendar (`utcOffsetMinutes`; India has
 * no daylight saving), so a day is always exactly 24 hours and the result keeps
 * the time of day of the start. "N working days after S" is the instant reached
 * by stepping forward a day at a time from S and counting each step whose
 * calendar day is a working day; the start day itself is never counted.
 */
export interface WorkingCalendar {
  utcOffsetMinutes: number;
  /** 0 = Sunday ... 6 = Saturday. */
  weekendDays: readonly number[];
  /** Holiday calendar dates, `YYYY-MM-DD`, in the same calendar. */
  holidays: ReadonlySet<string>;
}

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;
/** A defensive bound: a sane calendar reaches N working days within a few
 * times N steps; anything else is a configuration error, not an infinite loop. */
const MAX_STEPS_PER_DAY = 62;

/** The calendar date (`YYYY-MM-DD`) of an instant in the calendar's offset. */
export function localDateOf(instant: Date, utcOffsetMinutes: number): string {
  return new Date(instant.getTime() + utcOffsetMinutes * MINUTE_MS)
    .toISOString()
    .slice(0, 10);
}

/** The weekday (0 = Sunday) of an instant in the calendar's offset. */
export function localWeekdayOf(
  instant: Date,
  utcOffsetMinutes: number,
): number {
  return new Date(instant.getTime() + utcOffsetMinutes * MINUTE_MS).getUTCDay();
}

export function isWorkingDay(
  instant: Date,
  calendar: WorkingCalendar,
): boolean {
  return (
    !calendar.weekendDays.includes(
      localWeekdayOf(instant, calendar.utcOffsetMinutes),
    ) && !calendar.holidays.has(localDateOf(instant, calendar.utcOffsetMinutes))
  );
}

/** `start` plus `days` working days. `days` must be a positive integer. */
export function addWorkingDays(
  start: Date,
  days: number,
  calendar: WorkingCalendar,
): Date {
  if (!Number.isInteger(days) || days < 1) {
    throw new RangeError('days must be a positive whole number');
  }
  if (calendar.weekendDays.length >= 7) {
    throw new RangeError('every weekday is a weekend: no working day exists');
  }
  let cursor = start.getTime();
  let remaining = days;
  let steps = 0;
  const limit = days * MAX_STEPS_PER_DAY;
  while (remaining > 0) {
    if (++steps > limit) {
      throw new RangeError('the calendar has too few working days');
    }
    cursor += DAY_MS;
    if (isWorkingDay(new Date(cursor), calendar)) {
      remaining -= 1;
    }
  }
  return new Date(cursor);
}
