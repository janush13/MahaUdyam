import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { OfficerAccessService } from '../officer/officer-access.service';
import { UsersService } from '../users/users.service';
import { InspectionAccessService } from './inspection-access.service';

const USER = '00000000-0000-4000-8000-0000000000a1';
const DEPT_A = '22222222-2222-4222-8222-22222222222a';
const DEPT_B = '22222222-2222-4222-8222-22222222222b';
const NOTHING = { id: { in: [] } };

function build(
  grants: Array<{ role: string; departmentId: string }>,
  roles: Array<{ roleCode: string; departmentId: string | null }>,
) {
  const visibilityWhere = jest.fn().mockReturnValue({ marker: 'visible' });
  const officers = {
    grantsFor: jest.fn().mockResolvedValue(grants),
    visibilityWhere,
  } as unknown as OfficerAccessService;
  const users = {
    getRoleAssignments: jest.fn().mockResolvedValue(roles),
  } as unknown as UsersService;
  const count = jest.fn().mockResolvedValue(0);
  return {
    service: new InspectionAccessService(officers, users, {
      inspection: { count },
    } as unknown as PrismaService),
    visibilityWhere,
    count,
  };
}

describe('InspectionAccessService', () => {
  it('a caller with no relevant role sees nothing (fail closed)', async () => {
    const { service } = build(
      [],
      [
        { roleCode: 'APPLICANT', departmentId: null },
        { roleCode: 'SYSTEM_ADMIN', departmentId: null },
      ],
    );
    expect(await service.scopes(USER)).toEqual({
      officer: NOTHING,
      inspector: NOTHING,
    });
  });

  it('officer scope is exactly the Step 10 application visibility', async () => {
    const grants = [{ role: 'DEPT_ADMIN', departmentId: DEPT_A }];
    const { service, visibilityWhere } = build(grants, []);
    const scopes = await service.scopes(USER);
    expect(visibilityWhere).toHaveBeenCalledWith(USER, grants);
    expect(scopes.officer).toEqual({ application: { marker: 'visible' } });
    expect(scopes.inspector).toEqual(NOTHING);
  });

  it('an Inspector sees only their own assignments, in departments where they hold the role', async () => {
    const { service } = build(
      [],
      [
        { roleCode: 'INSPECTOR', departmentId: DEPT_A },
        { roleCode: 'INSPECTOR', departmentId: DEPT_A },
        { roleCode: 'INSPECTOR', departmentId: DEPT_B },
      ],
    );
    const { inspector, officer } = await service.scopes(USER);
    expect(officer).toEqual(NOTHING);
    expect(inspector).toEqual({
      inspectorId: USER,
      application: {
        internalState: { not: 'DRAFT' },
        approvalType: { departmentId: { in: [DEPT_A, DEPT_B] } },
      },
    });
  });

  it('an Inspector role without a department grants nothing', async () => {
    const { service } = build(
      [],
      [{ roleCode: 'INSPECTOR', departmentId: null }],
    );
    expect((await service.scopes(USER)).inspector).toEqual(NOTHING);
  });

  it('the Inspector role gives no officer scope, and an officer role gives no Inspector scope', async () => {
    const asOfficer = build(
      [{ role: 'SCRUTINY_OFFICER', departmentId: DEPT_A }],
      [{ roleCode: 'SCRUTINY_OFFICER', departmentId: DEPT_A }],
    );
    expect((await asOfficer.service.scopes(USER)).inspector).toEqual(NOTHING);
    const asInspector = build(
      [],
      [{ roleCode: 'INSPECTOR', departmentId: DEPT_A }],
    );
    expect((await asInspector.service.scopes(USER)).officer).toEqual(NOTHING);
  });

  describe('resolveView', () => {
    it('is OFFICER when the officer scope matches, and does not look further', async () => {
      const { service, count } = build(
        [{ role: 'DEPT_ADMIN', departmentId: DEPT_A }],
        [{ roleCode: 'INSPECTOR', departmentId: DEPT_A }],
      );
      count.mockResolvedValueOnce(1);
      expect(await service.resolveView(USER, 'insp')).toBe('OFFICER');
      expect(count).toHaveBeenCalledTimes(1);
    });

    it('is INSPECTOR when only the Inspector scope matches', async () => {
      const { service, count } = build(
        [],
        [{ roleCode: 'INSPECTOR', departmentId: DEPT_A }],
      );
      count.mockResolvedValueOnce(0).mockResolvedValueOnce(1);
      expect(await service.resolveView(USER, 'insp')).toBe('INSPECTOR');
      const where = count.mock.calls[1][0].where;
      expect(where.AND[0]).toEqual({ id: 'insp' });
      expect(where.AND[1]).toMatchObject({ inspectorId: USER });
    });

    it('is null — a plain 404 — when neither scope matches', async () => {
      const { service } = build([], []);
      expect(await service.resolveView(USER, 'insp')).toBeNull();
    });
  });
});
