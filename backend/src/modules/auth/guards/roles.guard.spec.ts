import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UsersService } from '../../users/users.service';
import { RolesGuard } from './roles.guard';

function buildContext(user: unknown): ExecutionContext {
  return {
    getHandler: () => ({}) as any,
    getClass: () => ({}) as any,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  it('is a no-op (allows) when the route has no @Roles() metadata', async () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(undefined),
    } as unknown as Reflector;
    const usersService = { getRoleCodes: jest.fn() } as unknown as UsersService;
    const guard = new RolesGuard(reflector, usersService);

    await expect(
      guard.canActivate(buildContext({ userId: 'u1' })),
    ).resolves.toBe(true);
    expect(usersService.getRoleCodes).not.toHaveBeenCalled();
  });

  it('denies when there is no authenticated user on the request', async () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(['DEPT_ADMIN']),
    } as unknown as Reflector;
    const usersService = { getRoleCodes: jest.fn() } as unknown as UsersService;
    const guard = new RolesGuard(reflector, usersService);

    await expect(guard.canActivate(buildContext(undefined))).resolves.toBe(
      false,
    );
  });

  it('allows when the user holds one of the required roles (fetched live from the DB)', async () => {
    const reflector = {
      getAllAndOverride: jest
        .fn()
        .mockReturnValue(['DEPT_ADMIN', 'SUPER_ADMIN']),
    } as unknown as Reflector;
    const usersService = {
      getRoleCodes: jest.fn().mockResolvedValue(['APPLICANT', 'DEPT_ADMIN']),
    } as unknown as UsersService;
    const guard = new RolesGuard(reflector, usersService);

    await expect(
      guard.canActivate(buildContext({ userId: 'u1' })),
    ).resolves.toBe(true);
    expect(usersService.getRoleCodes).toHaveBeenCalledWith('u1');
  });

  it('throws INSUFFICIENT_ROLE when the user holds none of the required roles', async () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(['SUPER_ADMIN']),
    } as unknown as Reflector;
    const usersService = {
      getRoleCodes: jest.fn().mockResolvedValue(['APPLICANT']),
    } as unknown as UsersService;
    const guard = new RolesGuard(reflector, usersService);

    await expect(
      guard.canActivate(buildContext({ userId: 'u1' })),
    ).rejects.toThrow(ForbiddenException);
  });
});
