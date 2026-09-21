import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { OfficerAccessService } from './officer-access.service';

const USER = '00000000-0000-4000-8000-0000000000a1';
const OTHER = '00000000-0000-4000-8000-0000000000a2';
const APP = '11111111-1111-4111-8111-111111111111';
const DEPT_A = '22222222-2222-4222-8222-22222222222a';
const DEPT_B = '22222222-2222-4222-8222-22222222222b';

type Roles = Array<{ roleCode: string; departmentId: string | null }>;

function app(over: Record<string, unknown> = {}) {
  return {
    id: APP,
    internalState: 'UNDER_SCRUTINY',
    approvalType: { departmentId: DEPT_A },
    assignments: [{ officerUserId: USER }],
    ...over,
  };
}

function build(roles: Roles, found: object | null = app()) {
  const findFirst = jest.fn().mockResolvedValue(found);
  const prisma = {
    approvalApplication: { findFirst },
  } as unknown as PrismaService;
  const users = {
    getRoleAssignments: jest.fn().mockResolvedValue(roles),
  } as unknown as UsersService;
  return { service: new OfficerAccessService(prisma, users), findFirst };
}

describe('OfficerAccessService', () => {
  describe('grantsFor', () => {
    it('keeps only officer roles that carry a department, once each', async () => {
      const { service } = build([
        { roleCode: 'SCRUTINY_OFFICER', departmentId: DEPT_A },
        { roleCode: 'SCRUTINY_OFFICER', departmentId: DEPT_A },
        { roleCode: 'DEPT_ADMIN', departmentId: DEPT_B },
        { roleCode: 'APPROVING_AUTHORITY', departmentId: null },
        { roleCode: 'INSPECTOR', departmentId: DEPT_A },
        { roleCode: 'SYSTEM_ADMIN', departmentId: null },
        { roleCode: 'APPLICANT', departmentId: null },
      ]);
      expect(await service.grantsFor(USER)).toEqual([
        { role: 'SCRUTINY_OFFICER', departmentId: DEPT_A },
        { role: 'DEPT_ADMIN', departmentId: DEPT_B },
      ]);
    });
  });

  describe('visibilityWhere', () => {
    const { service } = build([]);

    it('matches nothing without a grant (fail closed)', () => {
      expect(service.visibilityWhere(USER, [])).toEqual({ id: { in: [] } });
    });

    it('never includes drafts, for any role', () => {
      const where = service.visibilityWhere(USER, [
        { role: 'DEPT_ADMIN', departmentId: DEPT_A },
      ]);
      expect(where).toEqual({
        OR: [
          {
            approvalType: { departmentId: DEPT_A },
            internalState: { not: 'DRAFT' },
          },
        ],
      });
    });

    it('limits a Scrutiny Officer to their active assignments', () => {
      const where = service.visibilityWhere(USER, [
        { role: 'SCRUTINY_OFFICER', departmentId: DEPT_A },
      ]);
      expect(where.OR?.[0]).toMatchObject({
        approvalType: { departmentId: DEPT_A },
        assignments: { some: { officerUserId: USER, endedAt: null } },
      });
    });

    it('limits the Approving Authority to applications awaiting a decision or already decided', () => {
      const where = service.visibilityWhere(USER, [
        { role: 'APPROVING_AUTHORITY', departmentId: DEPT_A },
      ]);
      expect(where.OR?.[0]).toMatchObject({
        internalState: {
          in: [
            'RECOMMENDED_FOR_APPROVAL',
            'APPROVED',
            'REJECTED',
            'CERTIFICATE_ISSUED',
            'ACTIVE',
          ],
        },
      });
    });

    it('a department filter can only NARROW the caller’s own grants', () => {
      const grants = [{ role: 'DEPT_ADMIN' as const, departmentId: DEPT_A }];
      expect(service.visibilityWhere(USER, grants, DEPT_B)).toEqual({
        id: { in: [] },
      });
      expect(service.visibilityWhere(USER, grants, DEPT_A).OR).toHaveLength(1);
    });
  });

  describe('resolveApplication', () => {
    const officer: Roles = [
      { roleCode: 'SCRUTINY_OFFICER', departmentId: DEPT_A },
    ];

    it('lets the assigned Scrutiny Officer act, deriving the department from the application', async () => {
      const { service } = build(officer);
      const ctx = await service.resolveApplication(USER, APP, 'START_SCRUTINY');
      expect(ctx).toMatchObject({
        actingRole: 'SCRUTINY_OFFICER',
        departmentId: DEPT_A,
        assignedToMe: true,
      });
    });

    it('is a 404 for a malformed id, without touching the database', async () => {
      const { service, findFirst } = build(officer);
      await expect(
        service.resolveApplication(USER, 'not-a-uuid', 'VIEW'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(findFirst).not.toHaveBeenCalled();
    });

    it('is a 404 for an application that does not exist (or is a draft)', async () => {
      const { service } = build(officer, null);
      await expect(
        service.resolveApplication(USER, APP, 'VIEW'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('is a 404 across departments: the caller’s role is for another department', async () => {
      const { service } = build([
        { roleCode: 'DEPT_ADMIN', departmentId: DEPT_B },
      ]);
      await expect(
        service.resolveApplication(USER, APP, 'VIEW'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('is a 404 for a Scrutiny Officer it is not assigned to, in their own department', async () => {
      const { service } = build(
        officer,
        app({ assignments: [{ officerUserId: OTHER }] }),
      );
      await expect(
        service.resolveApplication(USER, APP, 'VIEW'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('is a 404 for an unassigned application, for a Scrutiny Officer', async () => {
      const { service } = build(officer, app({ assignments: [] }));
      await expect(
        service.resolveApplication(USER, APP, 'VIEW'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('is a 403 (visible, not permitted) for the administrator doing scrutiny', async () => {
      const { service } = build([
        { roleCode: 'DEPT_ADMIN', departmentId: DEPT_A },
      ]);
      await expect(
        service.resolveApplication(USER, APP, 'RECOMMEND'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        service.resolveApplication(USER, APP, 'ASSIGN'),
      ).resolves.toMatchObject({ actingRole: 'DEPT_ADMIN' });
    });

    it('gives the Approving Authority sight only once a recommendation exists, and never scrutiny', async () => {
      const aa: Roles = [
        { roleCode: 'APPROVING_AUTHORITY', departmentId: DEPT_A },
      ];
      await expect(
        build(aa).service.resolveApplication(USER, APP, 'VIEW'),
      ).rejects.toBeInstanceOf(NotFoundException);
      const recommended = build(
        aa,
        app({ internalState: 'RECOMMENDED_FOR_APPROVAL', assignments: [] }),
      );
      await expect(
        recommended.service.resolveApplication(USER, APP, 'VIEW'),
      ).resolves.toMatchObject({ actingRole: 'APPROVING_AUTHORITY' });
      await expect(
        recommended.service.resolveApplication(USER, APP, 'RECOMMEND'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('is a 404 for a caller with no officer role at all', async () => {
      const { service } = build([
        { roleCode: 'INSPECTOR', departmentId: DEPT_A },
        { roleCode: 'SYSTEM_ADMIN', departmentId: null },
      ]);
      await expect(
        service.resolveApplication(USER, APP, 'VIEW'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('a user with roles in two departments acts under the one matching the application', async () => {
      const { service } = build(
        [
          { roleCode: 'DEPT_ADMIN', departmentId: DEPT_B },
          { roleCode: 'SCRUTINY_OFFICER', departmentId: DEPT_A },
        ],
        app(),
      );
      const ctx = await service.resolveApplication(USER, APP, 'VIEW');
      expect(ctx.actingRole).toBe('SCRUTINY_OFFICER');
      expect(ctx.departmentId).toBe(DEPT_A);
    });
  });
});
