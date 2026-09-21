import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UsersService } from '../../users/users.service';
import { MfaEnforcementGuard } from './mfa-enforcement.guard';

function buildContext(user: unknown): ExecutionContext {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

function build(
  state: { mfaEnabled: boolean; roleCodes: string[] } | null,
  isPublic = false,
) {
  const usersService = {
    getMfaEnforcementState: jest.fn().mockResolvedValue(state),
  } as unknown as UsersService;
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(isPublic),
  } as unknown as Reflector;
  return {
    guard: new MfaEnforcementGuard(reflector, usersService),
    usersService,
  };
}

const accessUser = { userId: 'u1', type: 'access', roles: [] };

describe('MfaEnforcementGuard', () => {
  it('skips @Public() routes without touching the database', async () => {
    const { guard, usersService } = build(null, true);
    await expect(guard.canActivate(buildContext(undefined))).resolves.toBe(
      true,
    );
    expect(usersService.getMfaEnforcementState).not.toHaveBeenCalled();
  });

  it.each(['mfa_setup', 'mfa_challenge'])(
    'does not apply to %s tokens (they exist for users who have not finished MFA)',
    async (type) => {
      const { guard, usersService } = build({
        mfaEnabled: false,
        roleCodes: ['SCRUTINY_OFFICER'],
      });
      await expect(
        guard.canActivate(buildContext({ userId: 'u1', type, roles: [] })),
      ).resolves.toBe(true);
      expect(usersService.getMfaEnforcementState).not.toHaveBeenCalled();
    },
  );

  it('allows an applicant without MFA', async () => {
    const { guard } = build({ mfaEnabled: false, roleCodes: ['APPLICANT'] });
    await expect(guard.canActivate(buildContext(accessUser))).resolves.toBe(
      true,
    );
  });

  it('allows a privileged role that has MFA enabled', async () => {
    const { guard } = build({
      mfaEnabled: true,
      roleCodes: ['APPLICANT', 'SCRUTINY_OFFICER'],
    });
    await expect(guard.canActivate(buildContext(accessUser))).resolves.toBe(
      true,
    );
  });

  it('denies a privileged role WITHOUT MFA enabled with MFA_REQUIRED', async () => {
    const { guard } = build({
      mfaEnabled: false,
      roleCodes: ['APPLICANT', 'SUPER_ADMIN'],
    });
    const error = await guard
      .canActivate(buildContext(accessUser))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ForbiddenException);
    expect((error as ForbiddenException).getResponse()).toMatchObject({
      code: 'MFA_REQUIRED',
    });
  });

  it('denies when the user no longer exists', async () => {
    const { guard } = build(null);
    await expect(guard.canActivate(buildContext(accessUser))).rejects.toThrow(
      UnauthorizedException,
    );
  });
});
