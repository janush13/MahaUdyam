import { ComplianceFrequency, ComplianceRecordStatus } from '@prisma/client';
import { localDateOf } from '../sla/working-days';

/**
 * The date arithmetic of the compliance calendar. Pure: no framework, no I/O,
 * no clock (the current time is always passed in).
 *
 * Compliance deadlines are CALENDAR DATES, not instants (FRD 27.1 "due date"),
 * held as `YYYY-MM-DD` strings in ONE fixed-offset calendar - the same one the
 * SLA clock counts working days in (`SLA_UTC_OFFSET_MINUTES`, default IST) - so
 * "today" means the same day here as it does for an SLA. No working-day or
 * holiday logic applies: a compliance date is the date it says.
 *
 * Nothing here decides how LONG anything is. The first due date is the
 * department's configured offset (or absent); the recurrence step is the one
 * the frequency itself names (MONTHLY = one month, ANNUAL = twelve).
 */
export type Ymd = string;

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The calendar date a `@db.Date` value (UTC midnight) stands for. */
export function toYmd(value: Date): Ymd {
  return value.toISOString().slice(0, 10);
}

/** UTC midnight of a calendar date, for a `@db.Date` column. */
export function ymdToDate(ymd: Ymd): Date {
  return new Date(`${ymd}T00:00:00.000Z`);
}

/** Today's date in the configured calendar. */
export function todayYmd(now: Date, utcOffsetMinutes: number): Ymd {
  return localDateOf(now, utcOffsetMinutes);
}

function parts(ymd: Ymd): [number, number, number] {
  const m = YMD.exec(ymd);
  if (!m) {
    throw new RangeError(`not a calendar date: ${ymd}`);
  }
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

export function addDaysYmd(ymd: Ymd, days: number): Ymd {
  const [y, m, d] = parts(ymd);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** `months` after `ymd`, the day clamped to the end of a shorter month (31
 * January + 1 month = 28 / 29 February). */
export function addMonthsYmd(ymd: Ymd, months: number): Ymd {
  const [y, m, d] = parts(ymd);
  const target = m - 1 + months;
  const year = y + Math.floor(target / 12);
  const month = ((target % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(d, lastDay)))
    .toISOString()
    .slice(0, 10);
}

/** The first due date: the start of the compliance period plus the configured
 * offset in calendar days, or null when no offset is configured ("not yet
 * configured" - nothing is guessed). */
export function firstDueDate(
  start: Date,
  offsetDays: number | null,
  utcOffsetMinutes: number,
): Ymd | null {
  return offsetDays === null
    ? null
    : addDaysYmd(localDateOf(start, utcOffsetMinutes), offsetDays);
}

/** The months between successive occurrences of a frequency; null for a
 * one-time obligation, which has exactly one occurrence. */
export function recurrenceMonths(
  frequency: ComplianceFrequency,
): number | null {
  switch (frequency) {
    case 'MONTHLY':
      return 1;
    case 'ANNUAL':
      return 12;
    default:
      return null;
  }
}

/**
 * The due date of occurrence `n` (1-based) of a recurring obligation, always
 * counted from the FIRST due date - so a month-end anchor does not drift
 * (31 Jan, 28 Feb, 31 Mar, ...). Null for a one-time obligation past its first.
 */
export function occurrenceDueDate(
  firstDue: Ymd,
  frequency: ComplianceFrequency,
  occurrence: number,
): Ymd | null {
  if (occurrence === 1) {
    return firstDue;
  }
  const step = recurrenceMonths(frequency);
  return step === null ? null : addMonthsYmd(firstDue, step * (occurrence - 1));
}

/**
 * Where a not-yet-fulfilled obligation stands on `today` (FRD 27.1 "Upcoming ->
 * Due -> Overdue"):
 *   OVERDUE   the due date has passed;
 *   DUE       today is the due date, or within the configured window before it;
 *   UPCOMING  earlier than that - and always, while there is no due date.
 * FULFILLED is not a function of the date: it is an action, so it is never
 * returned here.
 */
export function evaluateStatus(
  due: Ymd | null,
  today: Ymd,
  windowDays: number,
): Exclude<ComplianceRecordStatus, 'FULFILLED'> {
  if (due === null) {
    return 'UPCOMING';
  }
  if (today > due) {
    return 'OVERDUE';
  }
  return today >= addDaysYmd(due, -windowDays) ? 'DUE' : 'UPCOMING';
}
