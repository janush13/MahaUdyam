import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { isUUID } from 'class-validator';
import { ErrorCodes } from '../../common/constants/error-codes.constant';
import { AppConfig } from '../../config/configuration';
import { SchemePublisherRole } from '../../config/schemes.config';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { SCHEME_OFFICER_ROLE } from './scheme.constants';

/** What a role may do to a scheme CATALOGUE ENTRY. */
export type SchemeCapability = 'VIEW' | 'MAINTAIN' | 'PUBLISH' | 'WITHDRAW';

/** A role the caller holds, and the department it is held for (null for a
 * role that is not department-scoped). */
interface Grant {
  role: string;
  departmentId: string | null;
}

/** The roles the caller uses to act on a scheme, and the one acting. */
export interface SchemeActor {
  userId: string;
  actingRole: string;
}

const SCHEME_INCLUDE = { department: true } satisfies Prisma.SchemeInclude;
export type SchemeWithDepartment = Prisma.SchemeGetPayload<{
  include: typeof SCHEME_INCLUDE;
}>;

const notFound = (what: string) =>
  new NotFoundException({
    code: ErrorCodes.NOT_FOUND,
    message: `${what} not found.`,
  });

/**
 * Object-level, department-scoped authorisation for the scheme officers.
 *
 *  - SCHEME_OFFICER (for a department): maintains that department's catalogue
 *    entries as drafts (FRD 4.7 / 34), withdraws them (returns to draft,
 *    deactivates), and works that department's scheme applications. Publishes
 *    only if the deployment names the role a publisher.
 *  - the configured PUBLISHER roles (FRD 34: "Department Admin or a separate
 *    Legal/Compliance role", TO BE VALIDATED - so configuration): view and
 *    publish, and withdraw. A Department Administrator's role is
 *    department-scoped; LEGAL_COMPLIANCE is not (its assignment need not carry a
 *    department), so it reaches every department's schemes.
 *  - no other role has any: least privilege, and never a System Administrator
 *    (FRD 35.2 "approving a scheme eligibility rule" is business authority).
 *
 * The department is DERIVED from the scheme (never from the client) and
 * compared with the caller's own user_roles rows. A scheme the caller cannot see
 * is the same 404 as a nonexistent one; only one they can see but lack the
 * capability for is a 403 (the convention of Steps 5-15).
 */
@Injectable()
export class SchemeAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  publisherRoles(): SchemePublisherRole[] {
    return this.config.get('schemes', { infer: true }).publisherRoles;
  }

  private async grantsFor(userId: string): Promise<Grant[]> {
    const assignments = await this.users.getRoleAssignments(userId);
    return assignments.map((a) => ({
      role: a.roleCode,
      departmentId: a.departmentId,
    }));
  }

  /** Whether a grant reaches a department: LEGAL_COMPLIANCE is platform-wide,
   * every other role is bound to its own department. */
  private reaches(grant: Grant, departmentId: string): boolean {
    return (
      grant.role === 'LEGAL_COMPLIANCE' || grant.departmentId === departmentId
    );
  }

  /** What one grant lets its holder do. */
  private capabilitiesOf(role: string): ReadonlySet<SchemeCapability> {
    const publishes = (this.publisherRoles() as string[]).includes(role);
    if (role === SCHEME_OFFICER_ROLE) {
      return new Set<SchemeCapability>([
        'VIEW',
        'MAINTAIN',
        'WITHDRAW',
        ...(publishes ? (['PUBLISH'] as const) : []),
      ]);
    }
    return publishes
      ? new Set<SchemeCapability>(['VIEW', 'WITHDRAW', 'PUBLISH'])
      : new Set<SchemeCapability>();
  }

  /** The capabilities the caller holds on a scheme of this department. */
  private async capabilitiesFor(
    userId: string,
    departmentId: string,
  ): Promise<{
    caps: Set<SchemeCapability>;
    roleFor: Map<SchemeCapability, string>;
  }> {
    const grants = (await this.grantsFor(userId)).filter((g) =>
      this.reaches(g, departmentId),
    );
    const caps = new Set<SchemeCapability>();
    const roleFor = new Map<SchemeCapability, string>();
    for (const grant of grants) {
      for (const cap of this.capabilitiesOf(grant.role)) {
        caps.add(cap);
        if (!roleFor.has(cap)) {
          roleFor.set(cap, grant.role);
        }
      }
    }
    return { caps, roleFor };
  }

  /** The caller's capabilities on a scheme, for the "what can I do here" flags. */
  async describe(
    userId: string,
    departmentId: string,
  ): Promise<Set<SchemeCapability>> {
    return (await this.capabilitiesFor(userId, departmentId)).caps;
  }

  /**
   * Loads a scheme (with its department) and decides whether `userId` may
   * perform `capability`: 404 when they cannot see it, 403 when they can see it
   * but their role lacks the capability.
   */
  async resolveScheme(
    userId: string,
    schemeId: string,
    capability: SchemeCapability,
  ): Promise<{ scheme: SchemeWithDepartment; actor: SchemeActor }> {
    if (!isUUID(schemeId)) {
      throw notFound('Scheme');
    }
    const scheme = await this.prisma.scheme.findUnique({
      where: { id: schemeId },
      include: SCHEME_INCLUDE,
    });
    if (!scheme) {
      throw notFound('Scheme');
    }
    const { caps, roleFor } = await this.capabilitiesFor(
      userId,
      scheme.departmentId,
    );
    if (!caps.has('VIEW')) {
      throw notFound('Scheme');
    }
    if (!caps.has(capability)) {
      throw new ForbiddenException({
        code: ErrorCodes.INSUFFICIENT_PERMISSION,
        message: 'Your role does not permit this action on this scheme.',
      });
    }
    return {
      scheme,
      actor: { userId, actingRole: roleFor.get(capability)! },
    };
  }

  /** The departments in which the caller may MAINTAIN schemes (a Scheme
   * Officer of them). */
  async maintainedDepartments(userId: string): Promise<string[]> {
    const grants = await this.grantsFor(userId);
    return [
      ...new Set(
        grants
          .filter((g) => g.role === SCHEME_OFFICER_ROLE && g.departmentId)
          .map((g) => g.departmentId as string),
      ),
    ];
  }

  /** The where-clause for "schemes this user can see in the officer catalogue":
   * for each grant that can VIEW, its department (or, for the platform-wide
   * role, every department). No such grant means nothing. */
  async visibleWhere(userId: string): Promise<Prisma.SchemeWhereInput> {
    const grants = (await this.grantsFor(userId)).filter((g) =>
      this.capabilitiesOf(g.role).has('VIEW'),
    );
    if (grants.length === 0) {
      return { id: { in: [] } };
    }
    if (grants.some((g) => g.role === 'LEGAL_COMPLIANCE')) {
      return {};
    }
    const departmentIds = [
      ...new Set(
        grants.map((g) => g.departmentId).filter((d): d is string => !!d),
      ),
    ];
    return { departmentId: { in: departmentIds } };
  }

  /** Resolves a scheme APPLICATION for a Scheme Officer of the scheme's own
   * department. Publishers who are not also Scheme Officers have no access to
   * applications: the requirements give them none. */
  async resolveApplicationDepartment(
    userId: string,
    departmentId: string,
  ): Promise<SchemeActor | null> {
    const grants = await this.grantsFor(userId);
    return grants.some(
      (g) => g.role === SCHEME_OFFICER_ROLE && g.departmentId === departmentId,
    )
      ? { userId, actingRole: SCHEME_OFFICER_ROLE }
      : null;
  }
}
