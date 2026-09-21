import { ExecutionContext, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { EnterpriseAccessService } from '../enterprise-access.service';
import { EnterpriseAccessGuard } from './enterprise-access.guard';

function context(request: object): ExecutionContext {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function build(level: string | undefined) {
  const access = {
    relation: 'OWNER',
    enterprise: { id: 'e1' },
    scopedProjectIds: [],
  };
  const service = {
    assertAccess: jest.fn().mockResolvedValue(access),
  } as unknown as EnterpriseAccessService;
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(level),
  } as unknown as Reflector;
  return {
    guard: new EnterpriseAccessGuard(reflector, service),
    service,
    access,
  };
}

describe('EnterpriseAccessGuard', () => {
  it('passes the required level, user, enterprise and project ids to the service and attaches the result', async () => {
    const { guard, service, access } = build('PREPARE_SUBMIT');
    const request: Record<string, unknown> = {
      user: { userId: 'u1' },
      params: { enterpriseId: 'e1', projectId: 'p1' },
    };

    await expect(guard.canActivate(context(request))).resolves.toBe(true);
    expect(service.assertAccess).toHaveBeenCalledWith(
      'u1',
      'e1',
      'PREPARE_SUBMIT',
      'p1',
    );
    expect(request.enterpriseAccess).toBe(access);
  });

  it('fails closed: with no level metadata it demands OWNER, the most restrictive level', async () => {
    const { guard, service } = build(undefined);
    await guard.canActivate(
      context({ user: { userId: 'u1' }, params: { enterpriseId: 'e1' } }),
    );
    expect(service.assertAccess).toHaveBeenCalledWith(
      'u1',
      'e1',
      'OWNER',
      undefined,
    );
  });

  it('is a 404 when the route has no enterpriseId param', async () => {
    const { guard, service } = build('VIEW_ONLY');
    await expect(
      guard.canActivate(context({ user: { userId: 'u1' }, params: {} })),
    ).rejects.toThrow(NotFoundException);
    expect(service.assertAccess).not.toHaveBeenCalled();
  });

  it('is a 404 when there is no authenticated user', async () => {
    const { guard, service } = build('VIEW_ONLY');
    await expect(
      guard.canActivate(context({ params: { enterpriseId: 'e1' } })),
    ).rejects.toThrow(NotFoundException);
    expect(service.assertAccess).not.toHaveBeenCalled();
  });
});
