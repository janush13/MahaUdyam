import { randomUUID } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import {
  API,
  E2eContext,
  base64url,
  cookieHeader,
  cookieValue,
  createE2eContext,
  setCookieHeaders,
  sha256,
} from './support/e2e-helpers';

jest.setTimeout(180_000);

describe('Auth e2e — refresh tokens, logout and JWT guard', () => {
  let ctx: E2eContext;
  const jwt = new JwtService();

  beforeAll(async () => {
    ctx = await createE2eContext();
  });

  afterAll(async () => {
    await ctx.cleanup();
    await ctx.app.close();
  });

  const nowSec = () => Math.floor(Date.now() / 1000);

  describe('POST /auth/refresh', () => {
    it('rotates: returns a new access token and a NEW refresh cookie, never the token in JSON', async () => {
      const { user, refreshCookieValue: first } =
        await ctx.applicantSession('rf-ok');

      const res = await ctx.refresh(first).expect(200);
      expect(Object.keys(res.body)).toEqual(['accessToken']);

      const second = cookieValue(res, ctx.cookieName)!;
      expect(second).toBeDefined();
      expect(second).not.toBe(first);
      expect(res.text).not.toContain(second);
      expect(res.text).not.toContain(first);

      const header = cookieHeader(res, ctx.cookieName)!;
      expect(header).toMatch(/HttpOnly/i);
      expect(header).toMatch(/SameSite=Lax/i);
      expect(header).toMatch(/Path=\/api\/v1\/auth(;|$)/);

      await ctx.me(res.body.accessToken).expect(200);

      // Old session revoked and linked to its replacement; new one is live.
      const old = await ctx.prisma.refreshSession.findUniqueOrThrow({
        where: { tokenHash: sha256(first) },
      });
      const fresh = await ctx.prisma.refreshSession.findUniqueOrThrow({
        where: { tokenHash: sha256(second) },
      });
      expect(old.revokedAt).not.toBeNull();
      expect(old.replacedById).toBe(fresh.id);
      expect(fresh.revokedAt).toBeNull();
      expect(fresh.familyId).toBe(old.familyId);
      expect(fresh.userId).toBe(user.id);
    });

    it('detects reuse of a rotated token, revokes the whole family (including the newest token) and audits it', async () => {
      const { user, refreshCookieValue: first } =
        await ctx.applicantSession('rf-reuse');
      const rotated = await ctx.refresh(first).expect(200);
      const second = cookieValue(rotated, ctx.cookieName)!;

      const replay = await ctx.refresh(first).expect(401);
      expect(replay.body.error.code).toBe('REFRESH_TOKEN_REUSED');
      expect(setCookieHeaders(replay)).toHaveLength(0);

      // The legitimate holder's newest token is now dead too.
      const afterKill = await ctx.refresh(second).expect(401);
      expect(afterKill.body.error.code).toBe('REFRESH_TOKEN_REUSED');
      expect(
        await ctx.prisma.refreshSession.count({
          where: { userId: user.id, revokedAt: null },
        }),
      ).toBe(0);

      const actions = (
        await ctx.prisma.auditLog.findMany({ where: { userId: user.id } })
      ).map((a) => a.action);
      expect(actions).toContain('REFRESH_TOKEN_ROTATED');
      expect(actions).toContain('REFRESH_TOKEN_REUSE_DETECTED');
    });

    it('lets exactly one of two concurrent refreshes with the same token succeed (atomic rotation)', async () => {
      const { user, refreshCookieValue } =
        await ctx.applicantSession('rf-race');
      const results = await Promise.all([
        ctx.refresh(refreshCookieValue),
        ctx.refresh(refreshCookieValue),
      ]);
      const statuses = results.map((r) => r.status).sort();
      expect(statuses).toEqual([200, 401]);
      const loser = results.find((r) => r.status === 401)!;
      expect(loser.body.error.code).toBe('REFRESH_TOKEN_REUSED');
      expect(setCookieHeaders(loser)).toHaveLength(0);

      // The original session was claimed exactly once — never forked into
      // two live children.
      const original = await ctx.prisma.refreshSession.findUniqueOrThrow({
        where: { tokenHash: sha256(refreshCookieValue) },
      });
      expect(original.revokedAt).not.toBeNull();
      const children = await ctx.prisma.refreshSession.count({
        where: {
          userId: user.id,
          id: { not: original.id },
          familyId: original.familyId,
        },
      });
      expect(children).toBe(1);
    });

    it('rejects a request with no cookie', async () => {
      const res = await ctx.refresh().expect(401);
      expect(res.body.error.code).toBe('REFRESH_TOKEN_INVALID');
    });

    it('does not read the refresh token from the body or Authorization header', async () => {
      const { refreshCookieValue } = await ctx.applicantSession('rf-body');
      await request(ctx.http)
        .post(`${API}/auth/refresh`)
        .send({ refreshToken: refreshCookieValue })
        .expect(401);
      await request(ctx.http)
        .post(`${API}/auth/refresh`)
        .set('Authorization', `Bearer ${refreshCookieValue}`)
        .expect(401);
    });

    it('rejects a garbage cookie', async () => {
      const res = await ctx.refresh('not-a-jwt').expect(401);
      expect(res.body.error.code).toBe('REFRESH_TOKEN_INVALID');
    });

    it('rejects a token signed with the wrong secret (e.g. the access secret)', async () => {
      const user = await ctx.register('rf-wrongsecret');
      const forged = await jwt.signAsync(
        { sub: user.id, type: 'refresh', jti: randomUUID() },
        { secret: ctx.accessSecret, expiresIn: '7d' },
      );
      const res = await ctx.refresh(forged).expect(401);
      expect(res.body.error.code).toBe('REFRESH_TOKEN_INVALID');
    });

    it('rejects a correctly-signed token that was never issued by the server (no session row)', async () => {
      const user = await ctx.register('rf-unissued');
      const unissued = await jwt.signAsync(
        { sub: user.id, type: 'refresh', jti: randomUUID() },
        { secret: ctx.refreshSecret, expiresIn: '7d' },
      );
      const res = await ctx.refresh(unissued).expect(401);
      expect(res.body.error.code).toBe('REFRESH_TOKEN_INVALID');
    });

    it('rejects an expired refresh JWT with REFRESH_TOKEN_EXPIRED', async () => {
      const user = await ctx.register('rf-expired-jwt');
      const expired = await jwt.signAsync(
        {
          sub: user.id,
          type: 'refresh',
          jti: randomUUID(),
          iat: nowSec() - 100,
          exp: nowSec() - 10,
        },
        { secret: ctx.refreshSecret },
      );
      const res = await ctx.refresh(expired).expect(401);
      expect(res.body.error.code).toBe('REFRESH_TOKEN_EXPIRED');
    });

    it('rejects a session whose server-side expiry has passed even if the JWT is still valid', async () => {
      const { user, refreshCookieValue } =
        await ctx.applicantSession('rf-expired-db');
      await ctx.prisma.refreshSession.updateMany({
        where: { userId: user.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      const res = await ctx.refresh(refreshCookieValue).expect(401);
      expect(res.body.error.code).toBe('REFRESH_TOKEN_EXPIRED');
    });

    it('rejects a refresh token whose session was revoked administratively', async () => {
      const { user, refreshCookieValue } =
        await ctx.applicantSession('rf-revoked');
      await ctx.prisma.refreshSession.updateMany({
        where: { userId: user.id },
        data: { revokedAt: new Date() },
      });
      await ctx.refresh(refreshCookieValue).expect(401);
    });

    it('stops a disabled account from refreshing and kills its session family', async () => {
      const { user, refreshCookieValue } =
        await ctx.applicantSession('rf-disabled');
      await ctx.prisma.user.update({
        where: { id: user.id },
        data: { isActive: false },
      });

      await ctx.refresh(refreshCookieValue).expect(401);
      expect(
        await ctx.prisma.refreshSession.count({
          where: { userId: user.id, revokedAt: null },
        }),
      ).toBe(0);
    });

    it('a refresh token is useless as a Bearer token', async () => {
      const { refreshCookieValue } = await ctx.applicantSession('rf-asbearer');
      await ctx.me(refreshCookieValue).expect(401);
    });

    it('re-reads roles from the database when minting the new access token', async () => {
      const { user, refreshCookieValue } =
        await ctx.applicantSession('rf-roles');
      const res = await ctx.refresh(refreshCookieValue).expect(200);
      const claims = JSON.parse(
        Buffer.from(res.body.accessToken.split('.')[1], 'base64url').toString(),
      );
      expect(claims.roles).toEqual(await ctx.users.getRoleCodes(user.id));
    });
  });

  describe('POST /auth/logout', () => {
    it('login -> refresh -> logout -> refresh again fails, and the cookie is cleared', async () => {
      const { user, refreshCookieValue: first } =
        await ctx.applicantSession('lo-flow');
      const rotated = await ctx.refresh(first).expect(200);
      const current = cookieValue(rotated, ctx.cookieName)!;

      const out = await ctx.logout(current).expect(200);
      expect(out.body).toEqual({ success: true });

      const cleared = cookieHeader(out, ctx.cookieName)!;
      expect(cleared).toBeDefined();
      expect(cleared.startsWith(`${ctx.cookieName}=;`)).toBe(true);
      expect(cleared).toMatch(/Expires=Thu, 01 Jan 1970/i);
      expect(cleared).toMatch(/HttpOnly/i);
      expect(cleared).toMatch(/Path=\/api\/v1\/auth(;|$)/);

      const after = await ctx.refresh(current).expect(401);
      expect(after.body.error.code).toBe('REFRESH_TOKEN_REUSED');

      const audited = await ctx.prisma.auditLog.findMany({
        where: { userId: user.id, action: 'LOGOUT' },
      });
      expect(audited).toHaveLength(1);
      expect(audited[0].entityId).toBe(user.id);
    });

    it('is idempotent: works with no cookie, and a second logout adds no second audit entry', async () => {
      const { user, refreshCookieValue } =
        await ctx.applicantSession('lo-idem');

      const noCookie = await ctx.logout().expect(200);
      expect(noCookie.body).toEqual({ success: true });
      expect(cookieHeader(noCookie, ctx.cookieName)).toBeDefined();

      await ctx.logout(refreshCookieValue).expect(200);
      await ctx.logout(refreshCookieValue).expect(200);

      expect(
        await ctx.prisma.auditLog.count({
          where: { userId: user.id, action: 'LOGOUT' },
        }),
      ).toBe(1);
    });

    it('with a bogus cookie succeeds without leaking anything', async () => {
      const res = await ctx.logout('bogus').expect(200);
      expect(res.body).toEqual({ success: true });
    });

    it("only ends the session that presented the cookie, not the same user's other devices", async () => {
      const user = await ctx.register('lo-multi');
      const a = await ctx.login(user).expect(200);
      const b = await ctx.login(user).expect(200);
      await ctx.logout(cookieValue(a, ctx.cookieName)).expect(200);
      await ctx.refresh(cookieValue(b, ctx.cookieName)).expect(200);
    });
  });

  describe('JwtAuthGuard on a protected endpoint (GET /auth/me)', () => {
    it('rejects a missing token with 401 UNAUTHENTICATED', async () => {
      const res = await request(ctx.http).get(`${API}/auth/me`).expect(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });

    it.each([
      ['a malformed token', 'Bearer not.a.jwt'],
      ['a non-JWT string', 'Bearer abc'],
      ['the wrong scheme', 'Basic dXNlcjpwYXNz'],
      ['an empty bearer', 'Bearer '],
    ])('rejects %s', async (_label, header) => {
      const res = await request(ctx.http)
        .get(`${API}/auth/me`)
        .set('Authorization', header)
        .expect(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('rejects an expired access token', async () => {
      const user = await ctx.register('jwt-expired');
      const expired = await jwt.signAsync(
        {
          sub: user.id,
          type: 'access',
          roles: ['APPLICANT'],
          iat: nowSec() - 100,
          exp: nowSec() - 10,
        },
        { secret: ctx.accessSecret },
      );
      const res = await ctx.me(expired).expect(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('rejects a token signed with the wrong secret', async () => {
      const user = await ctx.register('jwt-badsig');
      const forged = await jwt.signAsync(
        { sub: user.id, type: 'access', roles: ['SUPER_ADMIN'] },
        { secret: 'attacker-chosen-secret', expiresIn: '15m' },
      );
      await ctx.me(forged).expect(401);
    });

    it('rejects an unsigned (alg=none) token', async () => {
      const user = await ctx.register('jwt-none');
      const forged = `${base64url({ alg: 'none', typ: 'JWT' })}.${base64url({
        sub: user.id,
        type: 'access',
        roles: ['SUPER_ADMIN'],
        exp: nowSec() + 900,
      })}.`;
      await ctx.me(forged).expect(401);
    });

    it('rejects a tampered payload (signature no longer matches)', async () => {
      const { user, accessToken } = await ctx.applicantSession('jwt-tamper');
      const [h, , s] = accessToken.split('.');
      const evil = base64url({
        sub: user.id,
        type: 'access',
        roles: ['SUPER_ADMIN'],
        exp: nowSec() + 900,
      });
      await ctx.me(`${h}.${evil}.${s}`).expect(401);
    });

    it("accepts a valid token and returns only the caller's own safe profile", async () => {
      const { user, accessToken } = await ctx.applicantSession('jwt-valid');
      const res = await ctx.me(accessToken).expect(200);
      expect(res.body).toEqual({
        id: user.id,
        name: expect.any(String),
        email: user.email,
        mobile: user.mobile,
        isVerified: false,
        mfaEnabled: false,
        roles: ['APPLICANT'],
      });
      expect(res.text.toLowerCase()).not.toContain('hash');
    });

    it('rejects a valid token whose user no longer exists', async () => {
      const { user, accessToken } = await ctx.applicantSession('jwt-deleted');
      await ctx.prisma.auditLog.deleteMany({ where: { userId: user.id } });
      await ctx.prisma.user.delete({ where: { id: user.id } });
      const res = await ctx.me(accessToken).expect(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('is deny-by-default: an unknown protected-looking route without a token is 401, not 404-information', async () => {
      await request(ctx.http)
        .get(`${API}/test-authz/authenticated`)
        .expect(401);
      const { accessToken } = await ctx.applicantSession('jwt-default');
      await request(ctx.http)
        .get(`${API}/test-authz/authenticated`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
    });
  });
});
