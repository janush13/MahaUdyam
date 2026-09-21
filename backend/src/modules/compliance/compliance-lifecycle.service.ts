import { Injectable } from '@nestjs/common';
import { ComplianceRecordStatus, Prisma } from '@prisma/client';
import {
  AuditAction,
  AuditActions,
} from '../../infrastructure/audit/audit-actions.constant';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { SlaCalendarService } from '../sla/sla-calendar.service';
import {
  Ymd,
  evaluateStatus,
  firstDueDate,
  occurrenceDueDate,
  toYmd,
  todayYmd,
  ymdToDate,
} from './compliance-dates';

const BATCH = 200;
/** A defensive bound on catch-up: a recurring obligation whose job was down for
 * this many periods is a configuration problem, not a reason to loop. */
const MAX_CATCH_UP_OCCURRENCES = 120;

/** Restricts a run to some applications (a targeted run; the tests use it so
 * parallel suites cannot process each other's fixtures). Omitted, a run covers
 * every application, as the hourly cron does. */
export interface ComplianceScope {
  applicationIds: readonly string[];
}

/** One thing that happened to an obligation, audited once the transaction that
 * caused it has committed. Audited against the APPLICATION, like every other
 * application event, so it appears in its history. */
export interface ComplianceEvent {
  action: AuditAction;
  applicationId: string;
  details: Record<string, unknown>;
}

export interface ComplianceActor {
  userId: string | null;
  roleAtTime: string;
  ipAddress: string;
}

export const SYSTEM_ACTOR: ComplianceActor = {
  userId: null,
  roleAtTime: 'SYSTEM',
  ipAddress: 'system',
};

export interface BecameDue {
  applicationId: string;
  recordId: string;
  dueDate: Ymd;
}

/** A status only ever moves forward. */
const RANK: Record<string, number> = { UPCOMING: 0, DUE: 1, OVERDUE: 2 };

const scoped = (only?: ComplianceScope) =>
  only ? { in: [...only.applicationIds] } : undefined;

/**
 * The compliance calendar's lifecycle (FRD 27.1, TRD 14, Blueprint 4.7).
 *
 * WHAT creates an obligation: an application in the ACTIVE state (TRD 3.2
 * "ACTIVE (compliance period)") whose approval type has an ACTIVE requirement a
 * department configured. Nothing is inferred; no requirement, no obligation.
 * The step that makes an application ACTIVE (the decision / certificate step)
 * does not exist yet, so this is reconciled by the scheduled job rather than
 * called from a transition: it finds ACTIVE applications and gives each the
 * occurrences it is missing. `ensureOccurrences` is transaction-scoped and
 * idempotent, so that later step can also call it directly inside its own
 * transition, with the real activation time.
 *
 * WHAT an occurrence is: one row, snapshotting the requirement. A recurring
 * obligation gets its NEXT occurrence once the previous occurrence's due date
 * is reached (so exactly one future occurrence is ever visible), counted from
 * the first due date; no occurrence is ever overwritten. A deactivated
 * requirement creates no further occurrences.
 *
 * HOW a status moves: only forward, only by date (UPCOMING -> DUE -> OVERDUE) or
 * by the applicant's fulfilment (see the fulfilment service). Each change is one
 * conditional UPDATE from the status that was read, so racing runs (or a run
 * racing a fulfilment) cannot both apply, and re-running is a no-op.
 *
 * Nothing here is an SLA: no clock, no working days. It shares only the
 * calendar's UTC offset so "today" is the same day everywhere.
 */
@Injectable()
export class ComplianceLifecycleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly calendar: SlaCalendarService,
    private readonly audit: AuditService,
  ) {}

  private get utcOffset(): number {
    return this.calendar.settings.utcOffsetMinutes;
  }

  // ---- occurrences -----------------------------------------------------------

  /**
   * Gives an ACTIVE application the occurrences it is missing. Runs inside the
   * caller's transaction and under the application's row lock. Returns what it
   * created, for auditing after the commit.
   */
  async ensureOccurrences(
    tx: Prisma.TransactionClient,
    applicationId: string,
    now: Date = new Date(),
  ): Promise<ComplianceEvent[]> {
    await tx.$queryRaw`SELECT id FROM approval_applications WHERE id = ${applicationId}::uuid FOR UPDATE`;
    const app = await tx.approvalApplication.findUnique({
      where: { id: applicationId },
      select: {
        internalState: true,
        projectId: true,
        approvalTypeId: true,
        approvalType: { select: { departmentId: true } },
        project: { select: { enterpriseId: true } },
      },
    });
    if (!app || app.internalState !== 'ACTIVE') {
      return [];
    }
    const requirements = await tx.complianceRequirement.findMany({
      where: { approvalTypeId: app.approvalTypeId, isActive: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const today = todayYmd(now, this.utcOffset);
    const events: ComplianceEvent[] = [];

    for (const req of requirements) {
      const existing = await tx.complianceRecord.findMany({
        where: {
          applicationId,
          complianceRequirementId: req.id,
        },
        orderBy: { occurrenceNumber: 'asc' },
        select: { occurrenceNumber: true, dueDate: true },
      });
      const snapshot = {
        requirementVersion: req.version,
        description: req.description,
        frequency: req.frequency,
        evidenceRequired: req.evidenceRequired,
        applicantAction: req.applicantAction,
        sourceReference: req.sourceReference,
        dueWindowDays: req.dueWindowDays,
      };
      const create = async (occurrence: number, due: Ymd | null) => {
        const record = await tx.complianceRecord.create({
          data: {
            applicationId,
            complianceRequirementId: req.id,
            occurrenceNumber: occurrence,
            dueDate: due === null ? null : ymdToDate(due),
            ...snapshot,
          },
        });
        events.push({
          action: AuditActions.COMPLIANCE_OBLIGATION_CREATED,
          applicationId,
          details: {
            complianceRecordId: record.id,
            requirementId: req.id,
            requirementVersion: req.version,
            occurrenceNumber: occurrence,
            frequency: req.frequency,
            dueDate: due,
            evidenceRequired: req.evidenceRequired,
            enterpriseId: app.project.enterpriseId,
            projectId: app.projectId,
            departmentId: app.approvalType.departmentId,
          },
        });
      };

      if (existing.length === 0) {
        await create(
          1,
          firstDueDate(now, req.firstDueAfterDays, this.utcOffset),
        );
        continue;
      }
      const first = existing[0];
      if (req.frequency === 'ONE_TIME' || first.dueDate === null) {
        continue; // one-time, or a recurrence with no date to count from
      }
      const firstDue = toYmd(first.dueDate);
      let last = existing[existing.length - 1];
      for (let i = 0; i < MAX_CATCH_UP_OCCURRENCES; i++) {
        if (last.dueDate === null || toYmd(last.dueDate) > today) {
          break; // the latest occurrence's due date is still ahead
        }
        const occurrence = last.occurrenceNumber + 1;
        const due = occurrenceDueDate(firstDue, req.frequency, occurrence);
        if (due === null) {
          break;
        }
        await create(occurrence, due);
        last = { occurrenceNumber: occurrence, dueDate: ymdToDate(due) };
      }
    }
    return events;
  }

  // ---- status ----------------------------------------------------------------

  /**
   * Moves every not-yet-fulfilled obligation to where `now` puts it (UPCOMING
   * -> DUE -> OVERDUE). Idempotent and race-safe: each change is conditional on
   * the status that was read. Returns the changes (to audit) and the records
   * that just became DUE (to notify).
   */
  async advanceStatuses(
    now: Date = new Date(),
    only?: ComplianceScope,
  ): Promise<{ events: ComplianceEvent[]; becameDue: BecameDue[] }> {
    const today = todayYmd(now, this.utcOffset);
    const events: ComplianceEvent[] = [];
    const becameDue: BecameDue[] = [];
    let after: string | undefined;
    for (;;) {
      const rows = await this.prisma.complianceRecord.findMany({
        where: {
          status: { in: ['UPCOMING', 'DUE'] },
          dueDate: { not: null },
          ...(only ? { applicationId: scoped(only) } : {}),
          ...(after ? { id: { gt: after } } : {}),
        },
        select: {
          id: true,
          applicationId: true,
          status: true,
          dueDate: true,
          dueWindowDays: true,
          occurrenceNumber: true,
        },
        orderBy: { id: 'asc' },
        take: BATCH,
      });
      if (rows.length === 0) {
        return { events, becameDue };
      }
      for (const row of rows) {
        const due = toYmd(row.dueDate as Date);
        const next = evaluateStatus(due, today, row.dueWindowDays);
        if (RANK[next] <= RANK[row.status]) {
          continue; // already there (or a clock that stepped back: never regress)
        }
        const { count } = await this.prisma.complianceRecord.updateMany({
          where: { id: row.id, status: row.status },
          data: { status: next },
        });
        if (count !== 1) {
          continue; // a racing run or a fulfilment got there first
        }
        events.push({
          action: AuditActions.COMPLIANCE_STATUS_CHANGED,
          applicationId: row.applicationId,
          details: {
            complianceRecordId: row.id,
            occurrenceNumber: row.occurrenceNumber,
            from: row.status as ComplianceRecordStatus,
            to: next,
            dueDate: due,
            asOf: today,
          },
        });
        if (next === 'DUE') {
          becameDue.push({
            applicationId: row.applicationId,
            recordId: row.id,
            dueDate: due,
          });
        }
      }
      after = rows[rows.length - 1].id;
    }
  }

  // ---- applications to reconcile --------------------------------------------------

  /** The ACTIVE applications (in id order, a page at a time) whose approval type
   * has an active requirement - the only ones that can need an occurrence. */
  async activeApplicationsAfter(
    after: string | undefined,
    only?: ComplianceScope,
  ): Promise<string[]> {
    const rows = await this.prisma.approvalApplication.findMany({
      where: {
        internalState: 'ACTIVE',
        approvalType: { complianceRequirements: { some: { isActive: true } } },
        ...(only ? { id: scoped(only) } : {}),
        ...(after ? { id: { gt: after, ...(only ? scoped(only) : {}) } } : {}),
      },
      select: { id: true },
      orderBy: { id: 'asc' },
      take: BATCH,
    });
    return rows.map((r) => r.id);
  }

  // ---- audit -------------------------------------------------------------------

  async record(
    events: readonly ComplianceEvent[],
    actor: ComplianceActor,
    context: Record<string, unknown> = {},
  ): Promise<void> {
    for (const event of events) {
      await this.audit.record({
        userId: actor.userId,
        roleAtTime: actor.roleAtTime,
        action: event.action,
        entityType: 'ApprovalApplication',
        entityId: event.applicationId,
        afterState: { ...context, ...event.details },
        ipAddress: actor.ipAddress,
      });
    }
  }
}
