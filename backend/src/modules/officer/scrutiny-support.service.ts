import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InternalApplicationState, Prisma } from '@prisma/client';
import { ErrorCodes } from '../../common/constants/error-codes.constant';
import { AuditActions } from '../../infrastructure/audit/audit-actions.constant';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  ApplicationDiscoveryContext,
  ruleVersionLabel,
} from '../applications/application-discovery-context';
import { applicantStatusFor } from '../applications/application-state.machine';
import { ROLE_VISIBILITY } from './constants/officer.constants';
import {
  OfficerApplicationContext,
  OfficerApplicationRow,
} from './officer-access.service';
import {
  ScrutinyAction,
  ScrutinyTransition,
  findScrutinyTransition,
} from './scrutiny-state.machine';

/** What the application looked like once locked, inside a transaction. */
export interface LockedApplication {
  internalState: InternalApplicationState;
  assignmentId: string | null;
  assignedOfficerUserId: string | null;
}

const notFound = (what = 'Application') =>
  new NotFoundException({
    code: ErrorCodes.NOT_FOUND,
    message: `${what} not found.`,
  });

/**
 * The one place officer-side (and applicant query-side) operations get their
 * concurrency and state-machine guarantees:
 *
 *  - `run` opens a transaction, takes a ROW LOCK on the application
 *    (SELECT ... FOR UPDATE), re-reads its state and assignment, and only then
 *    lets the operation act — so two officers racing on one application are
 *    serialised by PostgreSQL, and everything decided before the lock (who may
 *    see it, what state it was in) is re-checked after it.
 *  - `transition` performs a state change ONLY through the scrutiny transition
 *    table, as a guarded UPDATE (`WHERE internal_state = <from>`).
 *  - audit helpers give every officer event the same context (actor, role,
 *    department, enterprise, project, application, rule version).
 */
@Injectable()
export class ScrutinySupport {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async run<T>(
    ctx: OfficerApplicationContext,
    fn: (tx: Prisma.TransactionClient, locked: LockedApplication) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      const locked = await this.lock(tx, ctx.app.id);
      if (!locked) {
        throw notFound();
      }
      // A role that only sees ITS assigned applications loses sight of one the
      // moment it is reassigned - even mid-request.
      if (
        ROLE_VISIBILITY[ctx.actingRole] === 'ASSIGNED_TO_ME' &&
        locked.assignedOfficerUserId !== ctx.userId
      ) {
        throw notFound();
      }
      return fn(tx, locked);
    });
  }

  /** Locks the application row and reads its state and active assignment. */
  async lock(
    tx: Prisma.TransactionClient,
    applicationId: string,
  ): Promise<LockedApplication | null> {
    await tx.$queryRaw`SELECT id FROM approval_applications WHERE id = ${applicationId}::uuid FOR UPDATE`;
    const row = await tx.approvalApplication.findUnique({
      where: { id: applicationId },
      select: {
        internalState: true,
        assignments: {
          where: { endedAt: null },
          take: 1,
          select: { id: true, officerUserId: true },
        },
      },
    });
    if (!row) {
      return null;
    }
    return {
      internalState: row.internalState,
      assignmentId: row.assignments[0]?.id ?? null,
      assignedOfficerUserId: row.assignments[0]?.officerUserId ?? null,
    };
  }

  /** The transition `action` performs from `from`, or a 409 — the client never
   * names a target state. */
  transitionFor(
    action: ScrutinyAction,
    from: InternalApplicationState,
  ): ScrutinyTransition {
    const transition = findScrutinyTransition(action, from);
    if (!transition) {
      throw new ConflictException({
        code: ErrorCodes.INVALID_STATE_TRANSITION,
        message: `This action is not available while the application is in its current state (${from}).`,
      });
    }
    return transition;
  }

  /** Applies a validated transition as a guarded update, and bumps
   * `updated_at`. The derived applicant-facing status moves with it. */
  async apply(
    tx: Prisma.TransactionClient,
    applicationId: string,
    transition: ScrutinyTransition,
  ): Promise<void> {
    const applicantStatus = applicantStatusFor(transition.to);
    if (!applicantStatus) {
      // Unreachable for the defined transitions; fail closed rather than guess.
      throw new ConflictException({
        code: ErrorCodes.INVALID_STATE_TRANSITION,
        message: 'No applicant-facing status is defined for this transition.',
      });
    }
    const { count } = await tx.approvalApplication.updateMany({
      where: { id: applicationId, internalState: transition.from },
      data: {
        internalState: transition.to,
        applicantStatus,
        updatedAt: new Date(),
      },
    });
    if (count !== 1) {
      throw new ConflictException({
        code: ErrorCodes.CONFLICT,
        message:
          'The application changed while this action was being processed. Reload it and try again.',
      });
    }
  }

  // ---- audit --------------------------------------------------------------

  contextOf(ctx: OfficerApplicationContext): Record<string, unknown> {
    return {
      enterpriseId: ctx.app.project.enterpriseId,
      projectId: ctx.app.projectId,
      applicationId: ctx.app.id,
      departmentId: ctx.departmentId,
      actingAs: ctx.actingRole,
    };
  }

  ruleVersionOf(app: OfficerApplicationRow): string | null {
    return ruleVersionLabel(
      app.discoveryContext as unknown as ApplicationDiscoveryContext | null,
    );
  }

  /** An officer event about the application (entity = the application). */
  async recordOfficerEvent(
    ctx: OfficerApplicationContext,
    action: (typeof AuditActions)[keyof typeof AuditActions],
    details: Record<string, unknown>,
    ipAddress: string,
    beforeState?: Record<string, unknown>,
  ): Promise<void> {
    await this.audit.record({
      userId: ctx.userId,
      roleAtTime: ctx.actingRole,
      action,
      entityType: 'ApprovalApplication',
      entityId: ctx.app.id,
      beforeState,
      afterState: { ...this.contextOf(ctx), ...details },
      ipAddress,
      ruleVersionUsed: this.ruleVersionOf(ctx.app),
    });
  }

  /** The before/after record of a state change (FRD 22.2). */
  async recordStatusChange(
    ctx: OfficerApplicationContext,
    transition: ScrutinyTransition,
    ipAddress: string,
  ): Promise<void> {
    await this.recordOfficerEvent(
      ctx,
      AuditActions.APPLICATION_STATUS_CHANGED,
      {
        action: transition.action,
        internalState: transition.to,
        applicantStatus: applicantStatusFor(transition.to),
      },
      ipAddress,
      {
        internalState: transition.from,
        applicantStatus: applicantStatusFor(transition.from),
      },
    );
  }
}
