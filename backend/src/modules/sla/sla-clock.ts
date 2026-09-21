import { SlaStatus } from '@prisma/client';

/**
 * The deterministic arithmetic of an SLA clock (TRD 12, Blueprint 23.2) —
 * pure, with the current time always passed in.
 *
 *   due        = started + sla_days working days           (working-days.ts)
 *   pause      = the deadline stops counting down; the moment it resumes the
 *                deadline moves forward by exactly the time it was paused
 *                ("recalculated forward by the elapsed pause duration")
 *   breached   = a running clock whose deadline has passed, or a clock
 *                completed after its deadline
 *
 * The values a reader gets are all derived from what is stored, never from the
 * present configuration, so a later change to a stage's sla_days cannot alter
 * an existing clock.
 */
export interface ClockRow {
  status: SlaStatus;
  startedAt: Date;
  originalDueAt: Date | null;
  dueAt: Date | null;
  pausedAt: Date | null;
  completedAt: Date | null;
  breachedAt: Date | null;
}

export interface PausePeriod {
  pausedAt: Date;
  resumedAt: Date | null;
}

/** The deadline after a pause of `[pausedAt, resumedAt]` (never earlier). */
export function extendDue(dueAt: Date, pausedAt: Date, resumedAt: Date): Date {
  const paused = Math.max(0, resumedAt.getTime() - pausedAt.getTime());
  return new Date(dueAt.getTime() + paused);
}

/** Total time spent paused up to `now` (an open pause counts to `now`). */
export function pausedMs(pauses: readonly PausePeriod[], now: Date): number {
  return pauses.reduce((sum, p) => {
    const end = p.resumedAt ?? now;
    return sum + Math.max(0, end.getTime() - p.pausedAt.getTime());
  }, 0);
}

/** Whether this clock is past its deadline as of `now`. */
export function isBreached(clock: ClockRow, now: Date): boolean {
  if (clock.breachedAt !== null) {
    return true;
  }
  if (clock.dueAt === null) {
    return false;
  }
  if (clock.status === 'COMPLETED') {
    return (
      clock.completedAt !== null &&
      clock.completedAt.getTime() > clock.dueAt.getTime()
    );
  }
  // A paused clock is frozen at the moment it paused.
  const at = clock.status === 'PAUSED' ? (clock.pausedAt ?? now) : now;
  return at.getTime() > clock.dueAt.getTime();
}

export interface ClockMetrics {
  /** Time the clock has actually been running: start (or, once completed,
   * completion) minus every pause. */
  elapsedMs: number;
  totalPausedMs: number;
  /** Time left to the deadline (negative once past it). Frozen while paused;
   * null when there is no configured deadline or the clock is completed. */
  remainingMs: number | null;
  breached: boolean;
  /** Share of the original working window that has elapsed, 0-100+; null when
   * there is no configured deadline. */
  percentElapsed: number | null;
  /** True once `percentElapsed` has reached the configured warning threshold
   * and the clock is running, unbreached and incomplete. */
  warning: boolean;
}

export function measure(
  clock: ClockRow,
  pauses: readonly PausePeriod[],
  now: Date,
  warningPercent: number | null,
): ClockMetrics {
  const end = clock.completedAt ?? now;
  const totalPausedMs = pausedMs(pauses, end);
  const elapsedMs = Math.max(
    0,
    end.getTime() - clock.startedAt.getTime() - totalPausedMs,
  );
  const breached = isBreached(clock, now);

  let remainingMs: number | null = null;
  if (clock.dueAt !== null && clock.status !== 'COMPLETED') {
    const at = clock.status === 'PAUSED' ? (clock.pausedAt ?? now) : now;
    remainingMs = clock.dueAt.getTime() - at.getTime();
  }

  let percentElapsed: number | null = null;
  if (clock.originalDueAt !== null) {
    const window = clock.originalDueAt.getTime() - clock.startedAt.getTime();
    percentElapsed = window > 0 ? (elapsedMs / window) * 100 : 100;
  }

  const warning =
    warningPercent !== null &&
    percentElapsed !== null &&
    clock.status === 'RUNNING' &&
    !breached &&
    percentElapsed >= warningPercent;

  return {
    elapsedMs,
    totalPausedMs,
    remainingMs,
    breached,
    percentElapsed,
    warning,
  };
}
