import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { isUUID } from 'class-validator';
import { ErrorCodes } from '../../common/constants/error-codes.constant';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { UsersService } from '../users/users.service';
import {
  APPROVING_AUTHORITY_VISIBLE_STATES,
  OFFICER_ROLES,
  OfficerCapability,
  OfficerRole,
  ROLE_CAPABILITIES,
  ROLE_VISIBILITY,
} from './constants/officer.constants';

/** Everything an officer operation needs about the application, in one query. */
export const OFFICER_APPLICATION_INCLUDE = {
  approvalType: { include: { department: true } },
  project: { include: { enterprise: true } },
  assignments: {
    where: { endedAt: null },
    take: 1,
    include: { officer: { select: { id: true, name: true } } },
  },
} satisfies Prisma.ApprovalApplicationInclude;

export type OfficerApplicationRow = Prisma.ApprovalApplicationGetPayload<{
  include: typeof OFFICER_APPLICATION_INCLUDE;
}>;

/** "This user holds this officer role for this department" — one row of
 * user_roles. A role with no department never grants access. */
export interface OfficerGrant {
  role: OfficerRole;
  departmentId: string;
}

export interface OfficerApplicationContext {
  userId: string;
  app: OfficerApplicationRow;
  /** The role under which the caller is acting on THIS application. */
  actingRole: OfficerRole;
  departmentId: string;
  assignedToMe: boolean;
}

const notFound = () =>
  new NotFoundException({
    code: ErrorCodes.NOT_FOUND,
    message: 'Application not found.',
  });

/**
 * Object-level, department-scoped authorisation for officer operations —
 * the DepartmentScopeGuard idea (Blueprint 20.1) applied to a resource: the
 * department is DERIVED from the application (its approval type's
 * department) and compared with the caller's own user_roles assignments. A
 * client-supplied department id is never trusted.
 *
 * Complements, never replaces, the existing pieces: JWT + MFA + RolesGuard
 * still decide whether the caller may use officer routes at all; this decides
 * which applications, and what they may do to them.
 *
 * Response convention (Steps 5–9): an application the caller cannot see —
 * nonexistent, a draft, another department's, or not assigned to them — is
 * the same 404. Only an application they CAN see but lack the capability for
 * is a 403.
 */
@Injectable()
export class OfficerAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
  ) {}

  /** The caller's officer roles, each with its department. */
  async grantsFor(userId: string): Promise<OfficerGrant[]> {
    const assignments = await this.users.getRoleAssignments(userId);
    const seen = new Set<string>();
    const grants: OfficerGrant[] = [];
    for (const a of assignments) {
      if (
        a.departmentId &&
        (OFFICER_ROLES as readonly string[]).includes(a.roleCode)
      ) {
        const key = `${a.roleCode}:${a.departmentId}`;
        if (!seen.has(key)) {
          seen.add(key);
          grants.push({
            role: a.roleCode as OfficerRole,
            departmentId: a.departmentId,
          });
        }
      }
    }
    return grants;
  }

  /**
   * The where-clause for "applications this user can see": for each grant,
   * the department's NON-DRAFT applications narrowed by that role's
   * visibility. No grants means nothing.
   */
  visibilityWhere(
    userId: string,
    grants: readonly OfficerGrant[],
    onlyDepartmentId?: string,
  ): Prisma.ApprovalApplicationWhereInput {
    const relevant = onlyDepartmentId
      ? grants.filter((g) => g.departmentId === onlyDepartmentId)
      : grants;
    if (relevant.length === 0) {
      return { id: { in: [] } };
    }
    return {
      OR: relevant.map((g) => {
        const base: Prisma.ApprovalApplicationWhereInput = {
          approvalType: { departmentId: g.departmentId },
          internalState: { not: 'DRAFT' },
        };
        switch (ROLE_VISIBILITY[g.role]) {
          case 'ASSIGNED_TO_ME':
            return {
              ...base,
              assignments: {
                some: { officerUserId: userId, endedAt: null },
              },
            };
          case 'AWAITING_DECISION':
            return {
              ...base,
              internalState: { in: [...APPROVING_AUTHORITY_VISIBLE_STATES] },
            };
          case 'DEPARTMENT':
            return base;
        }
      }),
    };
  }

  private isVisibleTo(
    role: OfficerRole,
    app: OfficerApplicationRow,
    userId: string,
  ): boolean {
    if (app.internalState === 'DRAFT') {
      return false;
    }
    switch (ROLE_VISIBILITY[role]) {
      case 'ASSIGNED_TO_ME':
        return app.assignments[0]?.officerUserId === userId;
      case 'AWAITING_DECISION':
        return APPROVING_AUTHORITY_VISIBLE_STATES.includes(app.internalState);
      case 'DEPARTMENT':
        return true;
    }
  }

  /**
   * Loads the application and decides whether `userId` may perform
   * `capability` on it. 404 when they cannot see it; 403 when they can see it
   * but their role lacks the capability.
   */
  async resolveApplication(
    userId: string,
    applicationId: string,
    capability: OfficerCapability,
  ): Promise<OfficerApplicationContext> {
    if (!isUUID(applicationId)) {
      throw notFound();
    }
    const [grants, app] = await Promise.all([
      this.grantsFor(userId),
      this.prisma.approvalApplication.findFirst({
        where: { id: applicationId, internalState: { not: 'DRAFT' } },
        include: OFFICER_APPLICATION_INCLUDE,
      }),
    ]);
    if (!app) {
      throw notFound();
    }
    const departmentId = app.approvalType.departmentId;
    const visible = grants.filter(
      (g) =>
        g.departmentId === departmentId &&
        this.isVisibleTo(g.role, app, userId),
    );
    if (visible.length === 0) {
      throw notFound();
    }
    const capable = visible.find((g) =>
      ROLE_CAPABILITIES[g.role].has(capability),
    );
    if (!capable) {
      throw new ForbiddenException({
        code: ErrorCodes.INSUFFICIENT_PERMISSION,
        message: 'Your role does not permit this action on this application.',
      });
    }
    return {
      userId,
      app,
      actingRole: capable.role,
      departmentId,
      assignedToMe: app.assignments[0]?.officerUserId === userId,
    };
  }

  /** The capabilities a role holds — for the "what can I do here" hints. */
  capabilitiesOf(role: OfficerRole): ReadonlySet<OfficerCapability> {
    return ROLE_CAPABILITIES[role];
  }
}
