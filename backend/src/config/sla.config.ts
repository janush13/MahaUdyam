export interface SlaSettings {
  /** Whether the in-process breach sweep (Blueprint 23.3, @nestjs/schedule,
   * hourly) runs on its schedule. The sweep is idempotent either way; tests switch the
   * schedule off and call it directly. */
  sweepEnabled: boolean;
  /** Working days are counted in one fixed-offset calendar (India has no DST).
   * Maharashtra government time = IST, +05:30. */
  utcOffsetMinutes: number;
  /** Weekdays that are not working days (0 = Sunday ... 6 = Saturday).
   * Blueprint 23.2: "skips weekends". Which weekdays a department treats as a
   * weekend is a per-department fact that is TO BE VALIDATED; the default is the
   * plain reading (Saturday and Sunday) and is configuration, not code. */
  weekendDays: number[];
  /** Blueprint 23.3: a warning threshold ("e.g., 80% elapsed"). There is no
   * default: with none configured, no warning state is reported. */
  warningThresholdPercent: number | null;
}

export const DEFAULT_UTC_OFFSET_MINUTES = 330;
export const DEFAULT_WEEKEND_DAYS = [0, 6];

function parseWeekendDays(raw: string | undefined): number[] {
  if (raw === undefined) {
    return DEFAULT_WEEKEND_DAYS;
  }
  const days = raw
    .split(',')
    .map((d) => d.trim())
    .filter((d) => d !== '')
    .map(Number);
  const unique = [...new Set(days)];
  // Every day a weekend would make "N working days" unreachable: refuse it and
  // fall back rather than loop forever.
  if (
    unique.some((d) => !Number.isInteger(d) || d < 0 || d > 6) ||
    unique.length > 6
  ) {
    return DEFAULT_WEEKEND_DAYS;
  }
  return unique;
}

function parseThreshold(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === '') {
    return null;
  }
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 && value < 100 ? value : null;
}

export const buildSlaConfig = (): SlaSettings => {
  const offset = parseInt(
    process.env.SLA_UTC_OFFSET_MINUTES ?? String(DEFAULT_UTC_OFFSET_MINUTES),
    10,
  );
  return {
    sweepEnabled: (process.env.SLA_SWEEP_ENABLED ?? 'true') !== 'false',
    utcOffsetMinutes: Number.isFinite(offset)
      ? offset
      : DEFAULT_UTC_OFFSET_MINUTES,
    weekendDays: parseWeekendDays(process.env.SLA_WEEKEND_DAYS),
    warningThresholdPercent: parseThreshold(
      process.env.SLA_WARNING_THRESHOLD_PERCENT,
    ),
  };
};
