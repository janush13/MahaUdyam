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
      guard.canActivate(buildContext(undefined, { departmentId: 'dept-1' })),
    ).resolves.toBe(false);
  });

  it('allows when the user has an assignment scoped to that department', async () => {
    const usersService = {
      hasDepartmentAccess: jest.fn().mockResolvedValue(true),
    } as unknown as UsersService;
    const guard = new DepartmentScopeGuard(usersService);

    await expect(
      guard.canActivate(
        buildContext({ userId: 'u1' }, { departmentId: 'dept-1' }),
      ),
    ).resolves.toBe(true);
    expect(usersService.hasDepartmentAccess).toHaveBeenCalledWith(
      'u1',
      'dept-1',
    );
  });

  it('throws when the user has no assignment scoped to that department', async () => {
    const usersService = {
      hasDepartmentAccess: jest.fn().mockResolvedValue(false),
    } as unknown as UsersService;
    const guard = new DepartmentScopeGuard(usersService);

    await expect(
      guard.canActivate(
        buildContext({ userId: 'u1' }, { departmentId: 'dept-1' }),
      ),
    ).rejects.toThrow(ForbiddenException);
  });
});
