import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from './jwt-auth.guard';

function buildContext(): ExecutionContext {
  return {
    getHandler: () => ({}) as any,
    getClass: () => ({}) as any,
  } as unknown as ExecutionContext;
}

describe('JwtAuthGuard', () => {
  describe('canActivate', () => {
    it('bypasses authentication entirely for @Public() routes', () => {
      const reflector = {
        getAllAndOverride: jest.fn().mockReturnValue(true),
      } as unknown as Reflector;
      const guard = new JwtAuthGuard(reflector);

      expect(guard.canActivate(buildContext())).toBe(true);
    });
  });

  describe('handleRequest', () => {
    it('throws UNAUTHENTICATED when there is no user (missing/invalid token)', () => {
      const reflector = {
        getAllAndOverride: jest.fn().mockReturnValue(undefined),
      } as unknown as Reflector;
      const guard = new JwtAuthGuard(reflector);

      expect(() =>
        guard.handleRequest(null, false, null, buildContext()),
      ).toThrow(UnauthorizedException);
    });

    it('throws UNAUTHENTICATED when Passport reports an error', () => {
      const reflector = {
        getAllAndOverride: jest.fn().mockReturnValue(undefined),
      } as unknown as Reflector;
      const guard = new JwtAuthGuard(reflector);

      expect(() =>
        guard.handleRequest(new Error('boom'), false, null, buildContext()),
      ).toThrow(UnauthorizedException);
    });

    it('allows a default "access" token when no @RequireTokenType is set', () => {
      const reflector = {
        getAllAndOverride: jest.fn().mockReturnValue(undefined),
      } as unknown as Reflector;
      const guard = new JwtAuthGuard(reflector);
      const user = { userId: 'u1', type: 'access' as const, roles: [] };

      expect(guard.handleRequest(null, user, null, buildContext())).toBe(user);
    });

    it("rejects a token type not in the route's @RequireTokenType list", () => {
      const reflector = {
        getAllAndOverride: jest.fn().mockReturnValue(['access']),
      } as unknown as Reflector;
      const guard = new JwtAuthGuard(reflector);
      const user = { userId: 'u1', type: 'mfa_setup' as const, roles: [] };

      expect(() =>
        guard.handleRequest(null, user, null, buildContext()),
      ).toThrow(ForbiddenException);
    });

    it('allows a widened token type set (e.g. mfa/enroll accepting access or mfa_setup)', () => {
      const reflector = {
        getAllAndOverride: jest.fn().mockReturnValue(['access', 'mfa_setup']),
      } as unknown as Reflector;
      const guard = new JwtAuthGuard(reflector);
      const user = { userId: 'u1', type: 'mfa_setup' as const, roles: [] };

      expect(guard.handleRequest(null, user, null, buildContext())).toBe(user);
    });
  });
});
