import { Injectable, NotFoundException } from '@nestjs/common';
import { User } from '@prisma/client';
import { AuditActions } from '../../infrastructure/audit/audit-actions.constant';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ErrorCodes } from '../../common/constants/error-codes.constant';

export interface RoleAssignment {
  roleCode: string;
  departmentId: string | null;
}

/**
 * Minimal user infrastructure for authentication — NOT the future
 * user-management system. No public CRUD; every method here exists to
 * support AuthService or a later admin module's internal calls.
 */
@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  findByMobile(mobile: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { mobile } });
  }

  /** Login accepts either identifier — tries email first (cheap format
   * check), falls back to mobile. */
  findByEmailOrMobile(identifier: string): Promise<User | null> {
    const looksLikeEmail = identifier.includes('@');
    return looksLikeEmail
      ? this.prisma.user.findUnique({ where: { email: identifier } })
      : this.prisma.user.findUnique({ where: { mobile: identifier } });
  }

  findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  /**
   * Creates an applicant account and assigns the APPLICANT role in one
   * transaction. This is the ONLY role self-registration ever grants —
   * RegisterDto has no role field, so there is no way for a caller to
   * request anything else through this path.
   */
  async createApplicant(input: {
    name: string;
    email: string;
    mobile: string;
    passwordHash: string;
  }): Promise<User> {
    return this.prisma.$transaction(async (tx) => {
      const applicantRole = await tx.role.findUnique({
        where: { code: 'APPLICANT' },
      });
      if (!applicantRole) {
        // Seed data missing — a deployment/ops problem, not a client error.
        throw new Error(
          'APPLICANT role is not seeded — run `npx prisma db seed`.',
        );
      }

      const user = await tx.user.create({
        data: {
          name: input.name,
          email: input.email,
          mobile: input.mobile,
          passwordHash: input.passwordHash,
        },
      });

      await tx.userRole.create({
        data: { userId: user.id, roleId: applicantRole.id },
      });

      return user;
    });
  }

  async getRoleAssignments(userId: string): Promise<RoleAssignment[]> {
    const rows = await this.prisma.userRole.findMany({
      where: { userId },
      include: { role: true },
    });
    return rows.map((row) => ({
      roleCode: row.role.code,
      departmentId: row.departmentId,
    }));
  }

  async getRoleCodes(userId: string): Promise<string[]> {
    const assignments = await this.getRoleAssignments(userId);
    return assignments.map((a) => a.roleCode);
  }

  async getPermissionCodes(userId: string): Promise<string[]> {
    const rows = await this.prisma.userRole.findMany({
      where: { userId },
      include: {
        role: {
          include: { rolePermissions: { include: { permission: true } } },
        },
      },
    });

    const codes = new Set<string>();
    for (const row of rows) {
      for (const rolePermission of row.role.rolePermissions) {
        codes.add(rolePermission.permission.code);
      }
    }
    return [...codes];
  }

  /** Reusable authorization primitive for future department-scoped
   * business modules — true if the user holds ANY role assignment scoped
   * to this department. Not consumed by a public endpoint yet in Step 4
   * (see DepartmentScopeGuard). */
  async hasDepartmentAccess(
    userId: string,
    departmentId: string,
  ): Promise<boolean> {
    const match = await this.prisma.userRole.findFirst({
      where: { userId, departmentId },
      select: { id: true },
    });
    return match !== null;
  }

  /**
   * Internal service capability only — deliberately NOT exposed via a
   * public endpoint (privileged roles must never be self-assignable, and
   * the exact administrative provisioning process is not yet specified by
   * the requirements). Callable today only from seed scripts and tests;
   * a future controlled admin endpoint would call this same method.
   */
  async assignRole(input: {
    userId: string;
    roleCode: string;
    departmentId?: string | null;
    assignedByUserId: string | null;
    ipAddress: string;
  }): Promise<void> {
    const role = await this.prisma.role.findUnique({
      where: { code: input.roleCode },
    });
    if (!role) {
      throw new NotFoundException({
        code: ErrorCodes.NOT_FOUND,
        message: `Role "${input.roleCode}" does not exist.`,
      });
    }

    const created = await this.prisma.userRole.create({
      data: {
        userId: input.userId,
        roleId: role.id,
        departmentId: input.departmentId ?? null,
      },
    });

    await this.audit.record({
      userId: input.assignedByUserId,
      action: AuditActions.ROLE_ASSIGNED,
      entityType: 'UserRole',
      entityId: created.id,
      afterState: {
        userId: input.userId,
        roleCode: input.roleCode,
        departmentId: input.departmentId ?? null,
      },
      ipAddress: input.ipAddress,
    });
  }

  async recordFailedLogin(
    userId: string,
    maxAttempts: number,
    lockoutDurationMinutes: number,
  ): Promise<{ locked: boolean }> {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { failedLoginAttempts: { increment: 1 } },
    });

    if (user.failedLoginAttempts >= maxAttempts) {
      const lockedUntil = new Date(
        Date.now() + lockoutDurationMinutes * 60_000,
      );
      await this.prisma.user.update({
        where: { id: userId },
        data: { lockedUntil, failedLoginAttempts: 0 },
      });
      return { locked: true };
    }

    return { locked: false };
  }

  async resetFailedLoginAttempts(userId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { failedLoginAttempts: 0, lockedUntil: null },
    });
  }
}
