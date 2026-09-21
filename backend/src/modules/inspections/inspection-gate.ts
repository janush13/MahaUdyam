import { InspectionFinding, InspectionStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { OPEN_STATUSES } from './constants/inspection.constants';

/**
 * Inspection facts that scrutiny (Step 10) needs, and the one rule that joins
 * the two flows. Kept free of Nest wiring so the officer module can use it
 * inside its own row-locked transaction without depending on the inspection
 * module.
 *
 * What the requirements actually say (and therefore all this enforces):
 *
 *  - TRD 3.3 "Inspection path: scrutiny triggers inspection before
 *    recommendation" and the TRD 3.2 machine (UNDER_SCRUTINY -> INSPECTION_
 *    SCHEDULED -> INSPECTION_COMPLETED -> UNDER_SCRUTINY -> RECOMMENDED): an
 *    inspection that has been triggered finishes BEFORE the recommendation.
 *  - TRD 10.1 "Requirement determination: driven by the ApprovalType's
 *    workflow definition" and Blueprint 9.1/9.2 (a workflow stage has
 *    `stage_type` SCRUTINY | INSPECTION | DECISION): an approval REQUIRES an
 *    inspection exactly when the workflow version pinned on the application
 *    has an INSPECTION stage.
 *
 * What it deliberately does NOT do: a project-size threshold (TRD 10.1 "only
 * above a project-size threshold") has no configured representation, and
 * risk-based intensity is "RECOMMENDED, subject to policy" - neither is
 * inferred. The inspection's OUTCOME (compliant / non-compliant / conditional)
 * never blocks or decides a recommendation: no approval criterion is defined,
 * so the officer sees the outcome and decides.
 */

type Db = Prisma.TransactionClient | PrismaService;

export type RecommendationBlock = 'INSPECTION_OPEN' | 'INSPECTION_REQUIRED';

export interface InspectionFacts {
  /** Configured requirement: the application's pinned workflow has an
   * INSPECTION stage. Says nothing about whether one has happened. */
  required: boolean;
  /** Inspections still to happen (PENDING / SCHEDULED). */
  open: number;
  /** Inspections finished with a submitted report. */
  completed: number;
}

/** Why a recommendation cannot be made yet, or null when inspection does not
 * stand in the way. An open inspection is checked first: it must finish
 * whether or not the workflow required it. */
export function recommendationBlock(
  facts: InspectionFacts,
): RecommendationBlock | null {
  if (facts.open > 0) {
    return 'INSPECTION_OPEN';
  }
  if (facts.required && facts.completed === 0) {
    return 'INSPECTION_REQUIRED';
  }
  return null;
}

export const RECOMMENDATION_BLOCK_MESSAGES: Record<
  RecommendationBlock,
  string
> = {
  INSPECTION_OPEN:
    'An inspection of this application is still pending or scheduled; it must be completed before a recommendation can be made.',
  INSPECTION_REQUIRED:
    'This approval requires an inspection and none has been completed; request one and wait for its report before recommending.',
};

/** Whether the application's pinned workflow requires an inspection. */
export async function inspectionRequired(
  db: Db,
  applicationId: string,
): Promise<boolean> {
  const row = await db.approvalApplication.findUnique({
    where: { id: applicationId },
    select: {
      workflow: {
        select: {
          stages: { where: { stageType: 'INSPECTION' }, select: { id: true } },
        },
      },
    },
  });
  return (row?.workflow.stages.length ?? 0) > 0;
}

/** Reads the facts. Call it INSIDE the application-row-locked transaction to
 * make a decision on it; called outside, it is advisory only. */
export async function loadInspectionFacts(
  db: Db,
  applicationId: string,
): Promise<InspectionFacts> {
  const [required, groups] = await Promise.all([
    inspectionRequired(db, applicationId),
    db.inspection.groupBy({
      by: ['status'],
      where: { applicationId },
      _count: { _all: true },
    }),
  ]);
  const count = (statuses: readonly InspectionStatus[]): number =>
    groups
      .filter((g) => statuses.includes(g.status))
      .reduce((sum, g) => sum + g._count._all, 0);
  return {
    required,
    open: count(OPEN_STATUSES),
    completed: count(['COMPLETED']),
  };
}

/** The submitted result of a completed inspection. */
export interface InspectionOutcome {
  overallFinding: InspectionFinding;
  summary: string;
  correctiveAction: string | null;
  submittedAt: Date;
  submittedByUserId: string;
}

/** The inspections of one application, oldest first, each with its report
 * when one was submitted. Nothing is filtered by inspector: a reassignment
 * never hides history. */
export function loadInspectionsWithOutcome(db: Db, applicationId: string) {
  return db.inspection.findMany({
    where: { applicationId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      status: true,
      scheduledAt: true,
      confirmedAt: true,
      siteAddress: true,
      createdAt: true,
      updatedAt: true,
      reportSummary: {
        select: {
          overallFinding: true,
          summary: true,
          correctiveAction: true,
          submittedAt: true,
          submittedByUserId: true,
        },
      },
    },
  });
}
