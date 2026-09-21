import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import {
  WorkingCalendar,
  addWorkingDays,
} from '../../src/modules/sla/working-days';

/**
 * Configures an approval type's workflow with one SCRUTINY stage in a
 * department, optionally with an SLA duration / pause rule. Test fixtures only:
 * the platform ships no SLA duration anywhere (Blueprint 23.4), so a stage
 * created without `slaDays` is "Timeline not yet configured". The stage is
 * removed by the E2E cleanup before its workflow.
 */
export async function addScrutinyStage(
  prisma: PrismaService,
  approvalTypeId: string,
  departmentId: string,
  config: { slaDays?: number | null; pauseOnQuery?: boolean } = {},
): Promise<{ id: string }> {
  const workflow = await prisma.workflow.findFirstOrThrow({
    where: { approvalTypeId, isActive: true },
  });
  return prisma.workflowStage.create({
    data: {
      workflowId: workflow.id,
      sequenceOrder: 1,
      name: 'E2E document scrutiny',
      departmentId,
      stageType: 'SCRUTINY',
      slaDays: config.slaDays ?? null,
      slaPauseOnQuery: config.pauseOnQuery ?? false,
    },
    select: { id: true },
  });
}

/** The default calendar (IST, Saturday + Sunday) with the given holidays. */
export const calendarWith = (
  holidays: readonly string[] = [],
): WorkingCalendar => ({
  utcOffsetMinutes: 330,
  weekendDays: [0, 6],
  holidays: new Set(holidays),
});

/** What a clock started at `start` for `days` should be due, by the pure
 * calculation the service uses (unit-tested on fixed dates). */
export const expectedDue = (
  start: Date,
  days: number,
  holidays: readonly string[] = [],
): Date => addWorkingDays(start, days, calendarWith(holidays));

/** The clock of an application, with its pause periods. */
export const clockOf = (prisma: PrismaService, applicationId: string) =>
  prisma.slaInstance.findFirst({
    where: { applicationId },
    include: {
      pauses: { orderBy: [{ pausedAt: 'asc' }, { id: 'asc' }] },
      applicationStage: true,
    },
  });

/**
 * Replaces an application's clock with one dated in the past, so breach
 * behaviour can be tested without waiting. INSERTs are allowed any dates (only
 * what a clock does AFTER it exists is constrained by the database), which is
 * exactly what the tests need; the stage row is kept.
 */
export async function backdateClock(
  prisma: PrismaService,
  applicationId: string,
  over: {
    status?: 'RUNNING' | 'PAUSED' | 'NOT_CONFIGURED';
    startedHoursAgo?: number;
    dueHoursAgo?: number | null;
    pausedHoursAgo?: number;
    pauseOnQuery?: boolean;
  } = {},
): Promise<string> {
  const existing = await prisma.slaInstance.findFirstOrThrow({
    where: { applicationId },
  });
  await prisma.slaPause.deleteMany({ where: { slaInstanceId: existing.id } });
  await prisma.slaInstance.delete({ where: { id: existing.id } });
  const ago = (h: number) => new Date(Date.now() - h * 3_600_000);
  const status = over.status ?? 'RUNNING';
  const dueHoursAgo = over.dueHoursAgo === undefined ? 24 : over.dueHoursAgo;
  const due = dueHoursAgo === null ? null : ago(dueHoursAgo);
  // A clock is BORN running (or unconfigured); the database refuses any other
  // start, so a paused one is running first and then paused, as in life.
  const created = await prisma.slaInstance.create({
    data: {
      applicationId,
      applicationStageId: existing.applicationStageId,
      status: status === 'NOT_CONFIGURED' ? 'NOT_CONFIGURED' : 'RUNNING',
      startedAt: ago(over.startedHoursAgo ?? 24 * 10),
      slaDays: due === null ? null : 3,
      pauseOnQuery: over.pauseOnQuery ?? status === 'PAUSED',
      originalDueAt: due,
      dueAt: due,
    },
  });
  if (status === 'PAUSED') {
    await prisma.slaInstance.update({
      where: { id: created.id },
      data: { status: 'PAUSED', pausedAt: ago(over.pausedHoursAgo ?? 24 * 5) },
    });
  }
  return created.id;
}
