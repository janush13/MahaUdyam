import {
  ConflictException,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ErrorCodes } from '../../common/constants/error-codes.constant';
import { AuditActions } from '../../infrastructure/audit/audit-actions.constant';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AssigneeDto, AssignmentResultDto } from './dto/officer-response.dto';
import {
  OfficerAccessService,
  OfficerApplicationContext,
} from './officer-access.service';
import { ASSIGNABLE_STATES } from './scrutiny-state.machine';
import { ScrutinySupport } from './scrutiny-support.service';

const ASSIGNEE_ROLE = 'SCRUTINY_OFFICER';

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

const invalidAssignee = (message: string) =>
  new UnprocessableEntityException({
    code: ErrorCodes.INVALID_ASSIGNEE,
    message,
  });

/**
 * Officer assignment (FRD 21.2 "assigned officer", TRD 28 "Assign", TRD 29.1
 * "officer assignment/reassignment").
 *
 * Deliberately MINIMAL — only what the requirements define:
 *  - a Department Administrator assigns an application of THEIR department to a
 *    Scrutiny Officer of that same department, and may reassign it (with a
 *    reason, kept as history);
 *  - an application can remain unassigned; there is NO automatic assignment and
 *    NO workload balancing (none is defined), and no self-claim (not defined for
 *    applications either);
 *  - delegation / substitution (TRD 8.3) is a later step: it is a distinct
 *    mechanism "logged distinctly from a permanent reassignment", so it is not
 *    approximated here.
 *
 * Races (two assigns, or an assign racing a reassign) are serialised by the
 * application row lock; the partial unique index (one ACTIVE assignment per
 * application) is the database-level backstop.
 */
@Injectable()
export class AssignmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OfficerAccessService,
    private readonly support: ScrutinySupport,
  ) {}

  /** First assignment of an unassigned application. */
  async assign(
    userId: string,
    applicationId: string,
    officerUserId: string,
    ipAddress: string,
  ): Promise<AssignmentResultDto> {
    const ctx = await this.access.resolveApplication(
      userId,
      applicationId,
      'ASSIGN',
    );
    const created = await this.persist(ctx, officerUserId, null, ipAddress);
    return created;
  }

  /** Move an assigned application to a different officer. */
  async reassign(
    userId: string,
    applicationId: string,
    officerUserId: string,
    reason: string,
    ipAddress: string,
  ): Promise<AssignmentResultDto> {
    const ctx = await this.access.resolveApplication(
      userId,
      applicationId,
      'ASSIGN',
    );
    return this.persist(ctx, officerUserId, reason, ipAddress);
  }

  private async persist(
    ctx: OfficerApplicationContext,
    officerUserId: string,
    reassignReason: string | null,
    ipAddress: string,
  ): Promise<AssignmentResultDto> {
    const isReassign = reassignReason !== null;

    // The assignee must be an ACTIVE Scrutiny Officer of THIS application's
    // department — derived from the application, never from the request.
    const assignee = await this.prisma.userRole.findFirst({
      where: {
        userId: officerUserId,
        departmentId: ctx.departmentId,
        role: { code: ASSIGNEE_ROLE },
        user: { isActive: true },
      },
      select: { userId: true },
    });
    if (!assignee) {
      throw invalidAssignee(
        'That user is not an active Scrutiny Officer of this application’s department.',
      );
    }

    let result: {
      row: { id: string; assignedAt: Date };
      previous: string | null;
    };
    try {
      result = await this.support.run(ctx, async (tx, locked) => {
        if (!ASSIGNABLE_STATES.includes(locked.internalState)) {
          throw new ConflictException({
            code: ErrorCodes.INVALID_STATE_TRANSITION,
            message:
              'An application can be assigned only before its scrutiny is finished.',
          });
        }
        let previous: string | null = null;
        if (isReassign) {
          if (!locked.assignmentId) {
            throw new ConflictException({
              code: ErrorCodes.NOT_ASSIGNED,
              message: 'This application is not assigned; assign it first.',
            });
          }
          if (locked.assignedOfficerUserId === officerUserId) {
            throw invalidAssignee(
              'The application is already assigned to that officer.',
            );
          }
          previous = locked.assignedOfficerUserId;
          await tx.applicationAssignment.update({
            where: { id: locked.assignmentId },
            data: {
              endedAt: new Date(),
              endedByUserId: ctx.userId,
              endReason: reassignReason,
            },
          });
        } else if (locked.assignmentId) {
          throw new ConflictException({
            code: ErrorCodes.ALREADY_ASSIGNED,
            message:
              'This application already has an assigned officer; use reassignment to change it.',
          });
        }
        const row = await tx.applicationAssignment.create({
          data: {
            applicationId: ctx.app.id,
            departmentId: ctx.departmentId,
            officerUserId,
            assignedByUserId: ctx.userId,
          },
          select: { id: true, assignedAt: true },
        });
        // Assignment never changes the workflow state, but it does touch the
        // application, so anything that read it earlier re-checks.
        await tx.approvalApplication.update({
          where: { id: ctx.app.id },
          data: { updatedAt: new Date() },
        });
        return { row, previous };
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        // The database-level backstop of "one active assignment".
        throw new ConflictException({
          code: ErrorCodes.ALREADY_ASSIGNED,
          message: 'This application was just assigned by someone else.',
        });
      }
      throw error;
    }

    await this.audit.record({
      userId: ctx.userId,
      roleAtTime: ctx.actingRole,
      action: isReassign
        ? AuditActions.APPLICATION_REASSIGNED
        : AuditActions.APPLICATION_ASSIGNED,
      entityType: 'ApprovalApplication',
      entityId: ctx.app.id,
      beforeState: isReassign
        ? { assignedOfficerUserId: result.previous }
        : undefined,
      afterState: {
        ...this.support.contextOf(ctx),
        assignmentId: result.row.id,
        assignedOfficerUserId: officerUserId,
        ...(isReassign ? { reason: reassignReason } : {}),
      },
      ipAddress,
      ruleVersionUsed: this.support.ruleVersionOf(ctx.app),
    });
    return {
      id: result.row.id,
      applicationId: ctx.app.id,
      officerUserId,
      assignedByUserId: ctx.userId,
      assignedAt: result.row.assignedAt,
    };
  }

  /**
   * The Scrutiny Officers a Department Administrator can assign to — only of
   * departments where the caller IS an administrator — with their open
   * workload (FRD 5: administrative metadata, Department Administrator only).
   */
  async listAssignees(userId: string): Promise<AssigneeDto[]> {
    const grants = (await this.access.grantsFor(userId)).filter(
      (g) => g.role === 'DEPT_ADMIN',
    );
    if (grants.length === 0) {
      return [];
    }
    const officers = await this.prisma.userRole.findMany({
      where: {
        departmentId: { in: grants.map((g) => g.departmentId) },
        role: { code: ASSIGNEE_ROLE },
        user: { isActive: true },
      },
      select: {
        departmentId: true,
        user: { select: { id: true, name: true } },
      },
      orderBy: [{ user: { name: 'asc' } }, { userId: 'asc' }],
    });
    const load = await this.prisma.applicationAssignment.groupBy({
      by: ['officerUserId', 'departmentId'],
      where: {
        endedAt: null,
        departmentId: { in: grants.map((g) => g.departmentId) },
        application: { internalState: { in: [...ASSIGNABLE_STATES] } },
      },
      _count: { _all: true },
    });
    const counts = new Map(
      load.map((l) => [`${l.officerUserId}:${l.departmentId}`, l._count._all]),
    );
    return officers.map((o) => ({
      userId: o.user.id,
      name: o.user.name,
      departmentId: o.departmentId as string,
      openAssignments: counts.get(`${o.user.id}:${o.departmentId}`) ?? 0,
    }));
  }
}
