import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UsersService } from '../../users/users.service';
import { PermissionsGuard } from './permissions.guard';

function buildContext(user: unknown): ExecutionContext {
  return {
    getHandler: () => ({}) as any,
    getClass: () => ({}) as any,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

describe('PermissionsGuard', () => {
  it('is a no-op (allows) when the route has no @Permissions() metadata', async () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(undefined),
    } as unknown as Reflector;
    const usersService = {
      getPermissionCodes: jest.fn(),
    } as unknown as UsersService;
    const guard = new PermissionsGuard(reflector, usersService);

    await expect(
      guard.canActivate(buildContext({ userId: 'u1' })),
    ).resolves.toBe(true);
    expect(usersService.getPermissionCodes).not.toHaveBeenCalled();
  });

  it('allows when the user holds one of the required permissions', async () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(['USER_MANAGE']),
    } as unknown as Reflector;
    const usersService = {
      getPermissionCodes: jest
        .fn()
        .mockResolvedValue(['USER_READ', 'USER_MANAGE']),
    } as unknown as UsersService;
    const guard = new PermissionsGuard(reflector, usersService);

    await expect(
      guard.canActivate(buildContext({ userId: 'u1' })),
    ).resolves.toBe(true);
  });

  it('throws INSUFFICIENT_PERMISSION when the user holds none of the required permissions', async () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(['USER_MANAGE']),
    } as unknown as Reflector;
    const usersService = {
      getPermissionCodes: jest.fn().mockResolvedValue(['USER_READ']),
    } as unknown as UsersService;
    const guard = new PermissionsGuard(reflector, usersService);

    await expect(
      guard.canActivate(buildContext({ userId: 'u1' })),
    ).rejects.toThrow(ForbiddenException);
  });
});
