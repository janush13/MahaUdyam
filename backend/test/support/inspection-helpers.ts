import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

/**
 * Finishes an inspection at the database level, the only way the database
 * allows: SCHEDULED, then a submitted report, then COMPLETED. Used by tests
 * that need "an inspection that has already happened" without driving the whole
 * inspector flow. Requires that the approval has no checklist items (the
 * database insists every item has a result before a report is accepted).
 */
export async function finishInspection(
  prisma: PrismaService,
  inspectionId: string,
): Promise<void> {
  const inspection = await prisma.inspection.findUniqueOrThrow({
    where: { id: inspectionId },
  });
  if (inspection.status === 'PENDING') {
    await prisma.inspection.update({
      where: { id: inspectionId },
      data: {
        scheduledAt: new Date(Date.now() + 86_400_000),
        status: 'SCHEDULED',
      },
    });
  }
  await prisma.inspectionReportSummary.create({
    data: {
      inspectionId,
      overallFinding: 'COMPLIANT',
      summary: 'Finished directly by a test.',
      submittedByUserId: inspection.inspectorId,
    },
  });
  await prisma.inspection.update({
    where: { id: inspectionId },
    data: { status: 'COMPLETED' },
  });
}

/** An ISO instant `days` from now (UTC). */
export const future = (days: number): string =>
  new Date(Date.now() + days * 86_400_000).toISOString();

/**
 * Department checklist items for an approval, in order. Test fixtures only:
 * the platform seeds no statutory checklist.
 */
export async function addChecklistItems(
  prisma: PrismaService,
  approvalTypeId: string,
  texts: string[],
): Promise<Array<{ id: string; itemText: string; sequenceOrder: number }>> {
  const rows: Array<{ id: string; itemText: string; sequenceOrder: number }> =
    [];
  for (const [index, itemText] of texts.entries()) {
    rows.push(
      await prisma.inspectionChecklist.create({
        data: { approvalTypeId, itemText, sequenceOrder: index + 1 },
        select: { id: true, itemText: true, sequenceOrder: true },
      }),
    );
  }
  return rows;
}

/**
 * Puts an application in "scrutiny has finished" directly. Since Step 11C the
 * recommendation endpoint refuses while an inspection is still open, so tests
 * that need an application WITH an open inspection AND a finished scrutiny (to
 * prove nothing can be changed any more) set that state the way the
 * recommendation would have, without the (now correctly refused) request.
 */
export async function markScrutinyFinished(
  prisma: PrismaService,
  applicationId: string,
): Promise<void> {
  await prisma.approvalApplication.update({
    where: { id: applicationId },
    data: {
      internalState: 'RECOMMENDED_FOR_APPROVAL',
      applicantStatus: 'AWAITING_DECISION',
    },
  });
}

/**
 * Configures an approval type's workflow to require an inspection (Blueprint
 * 9.2: a workflow stage of type INSPECTION). Test fixture only — the platform
 * seeds no statutory workflow. The stage is removed by the E2E cleanup before
 * its workflow.
 */
export async function addInspectionStage(
  prisma: PrismaService,
  approvalTypeId: string,
  departmentId: string,
): Promise<void> {
  const workflow = await prisma.workflow.findFirstOrThrow({
    where: { approvalTypeId, isActive: true },
  });
  await prisma.workflowStage.create({
    data: {
      workflowId: workflow.id,
      sequenceOrder: 2,
      name: 'E2E site inspection',
      departmentId,
      stageType: 'INSPECTION',
    },
  });
}
