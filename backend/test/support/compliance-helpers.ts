import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';

/** A moment `days` days from now, keeping the time of day (so its calendar
 * date, in any fixed offset, is exactly `days` later). */
export const daysFromNow = (days: number): Date =>
  new Date(Date.now() + days * 86_400_000);

/** `YYYY-MM-DD` of an instant in the platform's default calendar (IST). */
export const istDate = (d: Date = new Date()): string =>
  new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);

/**
 * Puts an application in the compliance period (TRD 3.2 ACTIVE) directly, on a
 * row that has gone through the real submission. Since Step 15 the real route
 * is decision -> certificate issuance (see decision-helpers); the compliance
 * calendar's own tests keep this shortcut because they are about obligations,
 * not about how an application got here.
 */
export async function activate(
  prisma: PrismaService,
  applicationId: string,
): Promise<void> {
  await prisma.approvalApplication.update({
    where: { id: applicationId },
    data: { internalState: 'ACTIVE', applicantStatus: 'APPROVED' },
  });
}

/**
 * Moves an obligation's due date, which the database otherwise never lets
 * change: only inside one transaction with triggers disabled (the dev database
 * user is a superuser). This is how a test makes an obligation LATE without
 * waiting; it never happens through the application.
 */
export async function backdateDue(
  prisma: PrismaService,
  recordId: string,
  ymd: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
    await tx.$executeRaw`UPDATE compliance_records SET due_date = ${ymd}::date WHERE id = ${recordId}::uuid`;
  });
}

/** The records of an application, oldest occurrence first. */
export const recordsOf = (prisma: PrismaService, applicationId: string) =>
  prisma.complianceRecord.findMany({
    where: { applicationId },
    orderBy: [{ complianceRequirementId: 'asc' }, { occurrenceNumber: 'asc' }],
  });
