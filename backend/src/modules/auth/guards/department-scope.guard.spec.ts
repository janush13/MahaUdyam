import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { UsersService } from '../../users/users.service';
import { DepartmentScopeGuard } from './department-scope.guard';

function buildContext(
  user: unknown,
  params: Record<string, string>,
): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user, params }) }),
  } as unknown as ExecutionContext;
}

// department_id is a UUID column; the guard denies anything that isn't one
// before it reaches the database, so fixtures must be well-formed UUIDs.
const DEPT_ID = '3f9c1f0e-6b1d-4c53-9d0a-5b8a2f7e1c11';

describe('DepartmentScopeGuard', () => {
  it('denies when there is no departmentId route param', async () => {
    const usersService = {
      hasDepartmentAccess: jest.fn(),
    } as unknown as UsersService;
    const guard = new DepartmentScopeGuard(usersService);

    await expect(
      guard.canActivate(buildContext({ userId: 'u1' }, {})),
    ).resolves.toBe(false);
  });

  it('denies when there is no authenticated user', async () => {
    const usersService = {
      hasDepartmentAccess: jest.fn(),
    } as unknown as UsersService;
    const guard = new DepartmentScopeGuard(usersService);

    await expect(
      guard.canActivate(buildContext(undefined, { departmentId: DEPT_ID })),
    ).resolves.toBe(false);
  });

  it('allows when the user has an assignment scoped to that department', async () => {
    const usersService = {
      hasDepartmentAccess: jest.fn().mockResolvedValue(true),
    } as unknown as UsersService;
    const guard = new DepartmentScopeGuard(usersService);

    await expect(
      guard.canActivate(
        buildContext({ userId: 'u1' }, { departmentId: DEPT_ID }),
      ),
    ).resolves.toBe(true);
    expect(usersService.hasDepartmentAccess).toHaveBeenCalledWith(
      'u1',
      DEPT_ID,
    );
  });

  it('throws when the user has no assignment scoped to that department', async () => {
    const usersService = {
      hasDepartmentAccess: jest.fn().mockResolvedValue(false),
    } as unknown as UsersService;
    const guard = new DepartmentScopeGuard(usersService);

    await expect(
      guard.canActivate(
        buildContext({ userId: 'u1' }, { departmentId: DEPT_ID }),
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('denies a malformed (non-UUID) departmentId without querying the database', async () => {
    const usersService = {
      hasDepartmentAccess: jest.fn().mockResolvedValue(true),
    } as unknown as UsersService;
    const guard = new DepartmentScopeGuard(usersService);

    await expect(
      guard.canActivate(
        buildContext({ userId: 'u1' }, { departmentId: 'dept-1' }),
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(usersService.hasDepartmentAccess).not.toHaveBeenCalled();
  });
});
