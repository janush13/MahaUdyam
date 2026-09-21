import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { SchemePublisherRole } from '../../config/schemes.config';
import { SchemeAccessService } from './scheme-access.service';

const DEPT_A = '00000000-0000-4000-8000-00000000000a';
const DEPT_B = '00000000-0000-4000-8000-00000000000b';
const SCHEME = '00000000-0000-4000-8000-0000000000e1';
const USER = 'user-1';

function build(
  assignments: Array<{ roleCode: string; departmentId: string | null }>,
  publisherRoles: SchemePublisherRole[] = ['DEPT_ADMIN'],
) {
  const prisma = {
    scheme: {
      findUnique: jest.fn().mockResolvedValue({
        id: SCHEME,
        departmentId: DEPT_A,
        department: { id: DEPT_A },
      }),
    },
  };
  const users = {
    getRoleAssignments: jest.fn().mockResolvedValue(assignments),
  };
  const config = { get: jest.fn().mockReturnValue({ publisherRoles }) };
  const service = new SchemeAccessService(
    prisma as never,
    users as never,
    config as never,
  );
  return { service, prisma, users };
}

const caps = async (
  assignments: Array<{ roleCode: string; departmentId: string | null }>,
  publisherRoles?: SchemePublisherRole[],
  departmentId = DEPT_A,
) =>
  [
    ...(await build(assignments, publisherRoles).service.describe(
      USER,
      departmentId,
    )),
  ].sort();

describe('SchemeAccessService capabilities', () => {
  it('a Scheme Officer of the department drafts, edits and withdraws - and does NOT publish by default', async () => {
    expect(
      await caps([{ roleCode: 'SCHEME_OFFICER', departmentId: DEPT_A }]),
    ).toEqual(['MAINTAIN', 'VIEW', 'WITHDRAW']);
  });

  it('a Scheme Officer publishes only when the deployment names that role', async () => {
    expect(
      await caps(
        [{ roleCode: 'SCHEME_OFFICER', departmentId: DEPT_A }],
        ['SCHEME_OFFICER'],
      ),
    ).toEqual(['MAINTAIN', 'PUBLISH', 'VIEW', 'WITHDRAW']);
  });

  it('the default publisher (Department Administrator) can view, publish and withdraw its own department’s schemes - never edit them', async () => {
    expect(
      await caps([{ roleCode: 'DEPT_ADMIN', departmentId: DEPT_A }]),
    ).toEqual(['PUBLISH', 'VIEW', 'WITHDRAW']);
  });

  it('every role is bound to its own department: another department’s officer or administrator has nothing', async () => {
    expect(
      await caps([{ roleCode: 'SCHEME_OFFICER', departmentId: DEPT_B }]),
    ).toEqual([]);
    expect(
      await caps([{ roleCode: 'DEPT_ADMIN', departmentId: DEPT_B }]),
    ).toEqual([]);
    // a role with no department never grants access to a department-scoped one
    expect(
      await caps([{ roleCode: 'SCHEME_OFFICER', departmentId: null }]),
    ).toEqual([]);
    expect(
      await caps([{ roleCode: 'DEPT_ADMIN', departmentId: null }]),
    ).toEqual([]);
  });

  it('Legal / Compliance is platform-wide, but only if named as a publisher', async () => {
    const legal = [{ roleCode: 'LEGAL_COMPLIANCE', departmentId: null }];
    expect(await caps(legal)).toEqual([]);
    expect(await caps(legal, ['LEGAL_COMPLIANCE'])).toEqual([
      'PUBLISH',
      'VIEW',
      'WITHDRAW',
    ]);
    expect(await caps(legal, ['LEGAL_COMPLIANCE'], DEPT_B)).toEqual([
      'PUBLISH',
      'VIEW',
      'WITHDRAW',
    ]);
  });

  it('a role that is not named as a publisher gets nothing from being a Department Administrator', async () => {
    expect(
      await caps(
        [{ roleCode: 'DEPT_ADMIN', departmentId: DEPT_A }],
        ['LEGAL_COMPLIANCE'],
      ),
    ).toEqual([]);
  });

  it('no other role has any capability, whatever else the caller is: applicant, scrutiny, approving, inspector, system administrator, leadership, auditor', async () => {
    for (const roleCode of [
      'APPLICANT',
      'SCRUTINY_OFFICER',
      'APPROVING_AUTHORITY',
      'INSPECTOR',
      'SYSTEM_ADMIN',
      'SUPER_ADMIN',
      'LEADERSHIP',
      'AUDITOR',
      'GRIEVANCE_OFFICER',
    ]) {
      expect(
        await caps(
          [{ roleCode, departmentId: DEPT_A }],
          ['DEPT_ADMIN', 'SCHEME_OFFICER'],
        ),
      ).toEqual([]);
    }
  });

  it('capabilities from several roles add up', async () => {
    expect(
      await caps([
        { roleCode: 'SCHEME_OFFICER', departmentId: DEPT_A },
        { roleCode: 'DEPT_ADMIN', departmentId: DEPT_A },
      ]),
    ).toEqual(['MAINTAIN', 'PUBLISH', 'VIEW', 'WITHDRAW']);
  });
});

describe('SchemeAccessService.resolveScheme', () => {
  it('returns the scheme and the role acting, when the capability is held', async () => {
    const { service } = build([
      { roleCode: 'SCHEME_OFFICER', departmentId: DEPT_A },
    ]);
    const res = await service.resolveScheme(USER, SCHEME, 'MAINTAIN');
    expect(res.scheme.id).toBe(SCHEME);
    expect(res.actor).toEqual({ userId: USER, actingRole: 'SCHEME_OFFICER' });
  });

  it('records the role that actually grants the capability (publish by the administrator, not the officer)', async () => {
    const { service } = build([
      { roleCode: 'SCHEME_OFFICER', departmentId: DEPT_A },
      { roleCode: 'DEPT_ADMIN', departmentId: DEPT_A },
    ]);
    expect(
      (await service.resolveScheme(USER, SCHEME, 'PUBLISH')).actor.actingRole,
    ).toBe('DEPT_ADMIN');
    expect(
      (await service.resolveScheme(USER, SCHEME, 'MAINTAIN')).actor.actingRole,
    ).toBe('SCHEME_OFFICER');
  });

  it('is a 404 - not a 403 - for a scheme the caller cannot see at all', async () => {
    const { service } = build([
      { roleCode: 'SCHEME_OFFICER', departmentId: DEPT_B },
    ]);
    await expect(
      service.resolveScheme(USER, SCHEME, 'VIEW'),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.resolveScheme(USER, SCHEME, 'MAINTAIN'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('is a 403 for one the caller can see but lacks the capability for', async () => {
    const { service } = build([
      { roleCode: 'DEPT_ADMIN', departmentId: DEPT_A },
    ]);
    await expect(
      service.resolveScheme(USER, SCHEME, 'MAINTAIN'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    const officer = build([
      { roleCode: 'SCHEME_OFFICER', departmentId: DEPT_A },
    ]);
    await expect(
      officer.service.resolveScheme(USER, SCHEME, 'PUBLISH'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('is a 404 for a malformed or unknown id, without touching the database for the former', async () => {
    const { service, prisma } = build([
      { roleCode: 'SCHEME_OFFICER', departmentId: DEPT_A },
    ]);
    await expect(
      service.resolveScheme(USER, 'not-a-uuid', 'VIEW'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.scheme.findUnique).not.toHaveBeenCalled();
    prisma.scheme.findUnique.mockResolvedValue(null);
    await expect(
      service.resolveScheme(USER, SCHEME, 'VIEW'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('SchemeAccessService scoping helpers', () => {
  it('maintained departments are exactly the Scheme Officer grants with a department', async () => {
    const { service } = build([
      { roleCode: 'SCHEME_OFFICER', departmentId: DEPT_A },
      { roleCode: 'SCHEME_OFFICER', departmentId: null },
      { roleCode: 'DEPT_ADMIN', departmentId: DEPT_B },
      { roleCode: 'SCHEME_OFFICER', departmentId: DEPT_A },
    ]);
    expect(await service.maintainedDepartments(USER)).toEqual([DEPT_A]);
  });

  it('the visible catalogue is the viewable departments; nothing without a grant; everything for a named Legal / Compliance', async () => {
    expect(
      await build([
        { roleCode: 'APPLICANT', departmentId: null },
      ]).service.visibleWhere(USER),
    ).toEqual({ id: { in: [] } });
    expect(
      await build(
        [
          { roleCode: 'SCHEME_OFFICER', departmentId: DEPT_A },
          { roleCode: 'DEPT_ADMIN', departmentId: DEPT_B },
        ],
        ['LEGAL_COMPLIANCE'],
      ).service.visibleWhere(USER),
    ).toEqual({ departmentId: { in: [DEPT_A] } });
    expect(
      await build(
        [
          { roleCode: 'SCHEME_OFFICER', departmentId: DEPT_A },
          { roleCode: 'DEPT_ADMIN', departmentId: DEPT_B },
        ],
        ['DEPT_ADMIN', 'SCHEME_OFFICER'],
      ).service.visibleWhere(USER),
    ).toEqual({ departmentId: { in: [DEPT_A, DEPT_B] } });
    expect(
      await build(
        [{ roleCode: 'LEGAL_COMPLIANCE', departmentId: null }],
        ['LEGAL_COMPLIANCE'],
      ).service.visibleWhere(USER),
    ).toEqual({});
    expect(
      await build([
        { roleCode: 'LEGAL_COMPLIANCE', departmentId: null },
      ]).service.visibleWhere(USER),
    ).toEqual({ id: { in: [] } });
  });

  it('scheme APPLICATIONS are the Scheme Officer’s alone: an administrator or publisher has no access', async () => {
    const officer = build([
      { roleCode: 'SCHEME_OFFICER', departmentId: DEPT_A },
    ]);
    expect(
      await officer.service.resolveApplicationDepartment(USER, DEPT_A),
    ).toEqual({
      userId: USER,
      actingRole: 'SCHEME_OFFICER',
    });
    expect(
      await officer.service.resolveApplicationDepartment(USER, DEPT_B),
    ).toBeNull();
    const admin = build(
      [
        { roleCode: 'DEPT_ADMIN', departmentId: DEPT_A },
        { roleCode: 'LEGAL_COMPLIANCE', departmentId: null },
      ],
      ['DEPT_ADMIN', 'LEGAL_COMPLIANCE'],
    );
    expect(
      await admin.service.resolveApplicationDepartment(USER, DEPT_A),
    ).toBeNull();
  });
});
