import { InspectionStatus } from '@prisma/client';

/**
 * Pure rules of inspection execution — no framework, no I/O.
 *
 * The lifecycle this step executes (FRD 24 / TRD 10 / Blueprint 12.5), and
 * nothing more:
 *
 *   PENDING   --(officer sets a date, Step 11A)-->  SCHEDULED
 *   SCHEDULED --(inspector submits the report)-->   COMPLETED
 *
 * "Confirm" and "reschedule" (FRD 4.4) act on a SCHEDULED inspection but move
 * no status: the requirements define no "confirmed" or "in progress" state, so
 * a confirmation is data (`confirmed_at`). CANCELLED exists in the schema but
 * no requirement says who may cancel or when, so nothing here produces it.
 * The application's own state is not touched by any of it.
 */

/** Statuses in which an inspector may act at all. */
export const EXECUTABLE_STATUSES: readonly InspectionStatus[] = ['SCHEDULED'];

export function isExecutable(status: InspectionStatus): boolean {
  return EXECUTABLE_STATUSES.includes(status);
}

/** A finished or cancelled inspection is a historical record. */
export function isFinal(status: InspectionStatus): boolean {
  return status === 'COMPLETED' || status === 'CANCELLED';
}

export interface ResultLike {
  id: string;
  checklistItemId: string;
  recordedAt: Date;
}

/** Newest first, ties broken by id — the same order the database index serves. */
function newerFirst(a: ResultLike, b: ResultLike): number {
  const byTime = b.recordedAt.getTime() - a.recordedAt.getTime();
  return byTime !== 0 ? byTime : b.id < a.id ? -1 : b.id > a.id ? 1 : 0;
}

/**
 * The CURRENT result of each checklist item: the most recently recorded one.
 * Results are append-only, so an earlier answer is never lost; it is simply no
 * longer current.
 */
export function currentResults<T extends ResultLike>(
  rows: readonly T[],
): Map<string, T> {
  const current = new Map<string, T>();
  for (const row of [...rows].sort(newerFirst)) {
    if (!current.has(row.checklistItemId)) {
      current.set(row.checklistItemId, row);
    }
  }
  return current;
}

/** A checklist item's earlier (superseded) results, oldest first. */
export function supersededResults<T extends ResultLike>(
  rows: readonly T[],
  checklistItemId: string,
): T[] {
  return [...rows]
    .filter((r) => r.checklistItemId === checklistItemId)
    .sort(newerFirst)
    .slice(1)
    .reverse();
}

/** Checklist items that still have no recorded result. */
export function missingItems(
  itemIds: readonly string[],
  results: readonly ResultLike[],
): string[] {
  const answered = new Set(results.map((r) => r.checklistItemId));
  return itemIds.filter((id) => !answered.has(id));
}

/**
 * FRD 24.2: a corrective-action recommendation is captured "where findings are
 * non-compliant". A NON_COMPLIANT overall finding therefore needs one; for the
 * other findings it is optional. (The database enforces the same rule.)
 */
export function correctiveActionRequired(
  overallFinding: 'COMPLIANT' | 'NON_COMPLIANT' | 'CONDITIONAL',
): boolean {
  return overallFinding === 'NON_COMPLIANT';
}
