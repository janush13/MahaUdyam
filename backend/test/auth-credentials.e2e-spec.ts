import request from 'supertest';
import {
  API,
  E2eContext,
  PASSWORD,
  cookieHeader,
  cookieValue,
  createE2eContext,
  setCookieHeaders,
  sha256,
} from './support/e2e-helpers';

jest.setTimeout(120_000);

describe('Auth e2e — registration & login (real HTTP -> Nest -> Prisma -> PostgreSQL)', () => {
  let ctx: E2eContext;

  beforeAll(async () => {
    ctx = await createE2eContext();
  });

  afterAll(async () => {
    await ctx.cleanup();
    await ctx.app.close();
  });

  describe('POST /auth/register', () => {
    it('registers an applicant and returns only safe profile fields', async () => {
      const identity = ctx.newIdentity('reg-ok');
      const res = await request(ctx.http)
        .post(`${API}/auth/register`)
        .send({ name: 'Asha Registrant', ...identity })
        .expect(201);
      ctx.userIds.push(res.body.id);

      expect(Object.keys(res.body).sort()).toEqual(
        ['email', 'id', 'isVerified', 'mobile', 'name'].sort(),
      );
      expect(res.body.email).toBe(identity.email);
      expect(res.body.isVerified).toBe(false);

      const raw = JSON.stringify(res.body).toLowerCase();
      for (const forbidden of [
        'password',
        'hash',
        '$argon2',
        'secret',
        'totp',
        'refresh',
        'token',
      ]) {
        expect(raw).not.toContain(forbidden);
      }
      expect(setCookieHeaders(res)).toHaveLength(0);
    });

    it('stores an Argon2id hash (never the plaintext) and grants exactly the APPLICANT role', async () => {
      const user = await ctx.register('reg-db');
      const row = await ctx.prisma.user.findUniqueOrThrow({
        where: { id: user.id },
      });
      expect(row.passwordHash).toMatch(/^\$argon2id\$/);
      expect(row.passwordHash).not.toContain(PASSWORD);
      expect(row.isVerified).toBe(false);
      expect(row.mfaEnabled).toBe(false);

      const roles = await ctx.users.getRoleCodes(user.id);
      expect(roles).toEqual(['APPLICANT']);
    });

    it.each([
      ['invalid email', { email: 'not-an-email' }, 'email'],
      ['short mobile', { mobile: '12345' }, 'mobile'],
      ['non-numeric mobile', { mobile: 'abcdefghij' }, 'mobile'],
      ['short password', { password: 'Sh0rt' }, 'password'],
      [
        'password without a digit',
        { password: 'NoDigitsHereAtAll' },
        'password',
      ],
      [
        'password without uppercase',
        { password: 'nouppercase12345' },
        'password',
      ],
      ['too-short name', { name: 'A' }, 'name'],
    ])(
      'rejects %s with a field-level VALIDATION_ERROR',
      async (_label, override, field) => {
        const identity = ctx.newIdentity('reg-bad');
        const res = await request(ctx.http)
          .post(`${API}/auth/register`)
          .send({ name: 'Valid Name', ...identity, ...override })
          .expect(400);

        expect(res.body.error.code).toBe('VALIDATION_ERROR');
        expect(res.body.error.fields[field]).toBeDefined();
        const exists = await ctx.prisma.user.findUnique({
          where: { email: identity.email },
        });
        expect(exists).toBeNull();
      },
    );

    it('rejects a body missing every required field', async () => {
      const res = await request(ctx.http)
        .post(`${API}/auth/register`)
        .send({})
        .expect(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects privilege-escalation attempts: no role/roles/isActive/mfaEnabled field is accepted', async () => {
      for (const extra of [
        { roles: ['SUPER_ADMIN'] },
        { role: 'SYSTEM_ADMIN' },
        { roleCode: 'SUPER_ADMIN' },
        { isVerified: true },
        { mfaEnabled: false },
        { isActive: true },
      ]) {
        const identity = ctx.newIdentity('reg-escalate');
        const res = await request(ctx.http)
          .post(`${API}/auth/register`)
          .send({ name: 'Mallory Tester', ...identity, ...extra })
          .expect(400);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');

        const created = await ctx.prisma.user.findUnique({
          where: { email: identity.email },
        });
        expect(created).toBeNull();
      }
    });

    it('rejects a duplicate email with 409 EMAIL_ALREADY_REGISTERED', async () => {
      const first = await ctx.register('dup-email');
      const other = ctx.newIdentity('dup-email-2');
      const res = await request(ctx.http)
        .post(`${API}/auth/register`)
        .send({ name: 'Second Person', ...other, email: first.email })
        .expect(409);
      expect(res.body.error.code).toBe('EMAIL_ALREADY_REGISTERED');
      expect(JSON.stringify(res.body)).not.toContain(first.id);
    });

    it('rejects a duplicate mobile with 409 MOBILE_ALREADY_REGISTERED', async () => {
      const first = await ctx.register('dup-mobile');
      const other = ctx.newIdentity('dup-mobile-2');
      const res = await request(ctx.http)
        .post(`${API}/auth/register`)
        .send({ name: 'Second Person', ...other, mobile: first.mobile })
        .expect(409);
      expect(res.body.error.code).toBe('MOBILE_ALREADY_REGISTERED');
    });
  });

  describe('POST /auth/login', () => {
    it('authenticates with email and returns an access token plus an HttpOnly refresh cookie — and never a refresh token in JSON', async () => {
      const user = await ctx.register('login-ok');
      const res = await ctx.login(user).expect(200);

      expect(res.body.status).toBe('AUTHENTICATED');
      expect(typeof res.body.accessToken).toBe('string');
      expect(res.body.challengeToken).toBeUndefined();
      expect(res.body.user).toEqual({
        id: user.id,
        name: expect.any(String),
        email: user.email,
        mobile: user.mobile,
        isVerified: false,
        mfaEnabled: false,
        roles: ['APPLICANT'],
      });

      const header = cookieHeader(res, ctx.cookieName)!;
      expect(header).toBeDefined();
      expect(header).toMatch(/HttpOnly/i);
      expect(header).toMatch(/SameSite=Lax/i);
      expect(header).toMatch(/Path=\/api\/v1\/auth(;|$)/);
      expect(header).toMatch(/Expires=/i);
      expect(header).not.toMatch(/;\s*Secure/i); // Secure is production-only

      const refreshToken = cookieValue(res, ctx.cookieName)!;
      expect(refreshToken.split('.')).toHaveLength(3);
      expect(res.text).not.toContain(refreshToken);
      expect(Object.keys(res.body).sort()).toEqual(
        ['accessToken', 'status', 'user'].sort(),
      );
    });

    it('authenticates with mobile number too', async () => {
      const user = await ctx.register('login-mobile');
      const res = await request(ctx.http)
        .post(`${API}/auth/login`)
        .send({ emailOrMobile: user.mobile, password: user.password })
        .expect(200);
      expect(res.body.status).toBe('AUTHENTICATED');
    });

    it('issues a short-lived access token with minimal, non-sensitive claims', async () => {
      const user = await ctx.register('login-claims');
      const res = await ctx.login(user).expect(200);
      const [, payloadB64] = res.body.accessToken.split('.');
      const claims = JSON.parse(
        Buffer.from(payloadB64, 'base64url').toString(),
      );

      expect(Object.keys(claims).sort()).toEqual(
        ['exp', 'iat', 'roles', 'sub', 'type'].sort(),
      );
      expect(claims.type).toBe('access');
      expect(claims.sub).toBe(user.id);
      expect(claims.roles).toEqual(['APPLICANT']);
      expect(claims.exp - claims.iat).toBe(15 * 60);
      const raw = JSON.stringify(claims);
      expect(raw).not.toContain(user.email);
      expect(raw).not.toContain('argon2');
    });

    it('persists only a SHA-256 hash of the refresh token — the raw token is stored nowhere', async () => {
      const user = await ctx.register('login-hash');
      const res = await ctx.login(user).expect(200);
      const raw = cookieValue(res, ctx.cookieName)!;

      const session = await ctx.prisma.refreshSession.findFirstOrThrow({
        where: { userId: user.id },
      });
      expect(session.tokenHash).toBe(sha256(raw));
      expect(session.tokenHash).not.toBe(raw);

      const rows = await ctx.prisma.$queryRaw<{ n: bigint }[]>`
        SELECT count(*) AS n FROM refresh_sessions rs WHERE rs::text LIKE ${'%' + raw + '%'}`;
      expect(Number(rows[0].n)).toBe(0);
    });

    it('rejects a wrong password with 401 INVALID_CREDENTIALS and sets no cookie', async () => {
      const user = await ctx.register('login-wrong');
      const res = await ctx
        .login({ email: user.email, password: 'Wr0ngPasswordEntirely' })
        .expect(401);
      expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
      expect(res.body.accessToken).toBeUndefined();
      expect(setCookieHeaders(res)).toHaveLength(0);
    });

    it('returns an identical response for a nonexistent account and a wrong password (no account enumeration)', async () => {
      const user = await ctx.register('login-enum');
      const wrongPassword = await ctx
        .login({ email: user.email, password: 'Wr0ngPasswordEntirely' })
        .expect(401);
      const noAccount = await ctx
        .login({
          email: `nobody-${ctx.runId}@example.test`,
          password: 'Wr0ngPasswordEntirely',
        })
        .expect(401);

      expect(noAccount.body).toEqual(wrongPassword.body);
      expect(noAccount.status).toBe(wrongPassword.status);
      expect(setCookieHeaders(noAccount)).toHaveLength(0);
    });

    it('rejects a malformed login body with 400', async () => {
      const res = await request(ctx.http)
        .post(`${API}/auth/login`)
        .send({ emailOrMobile: '', password: '' })
        .expect(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('never leaks password_hash or password in any login response', async () => {
      const user = await ctx.register('login-leak');
      for (const res of [
        await ctx.login(user).expect(200),
        await ctx
          .login({ email: user.email, password: 'Wr0ngPasswordEntirely' })
          .expect(401),
      ]) {
        const text = res.text.toLowerCase();
        expect(text).not.toContain('passwordhash');
        expect(text).not.toContain('password_hash');
        expect(text).not.toContain('$argon2');
        expect(text).not.toContain(PASSWORD.toLowerCase());
      }
    });

    it('rejects a disabled account with 401 ACCOUNT_DISABLED', async () => {
      const user = await ctx.register('login-disabled');
      await ctx.prisma.user.update({
        where: { id: user.id },
        data: { isActive: false },
      });
      const res = await ctx.login(user).expect(401);
      expect(res.body.error.code).toBe('ACCOUNT_DISABLED');
      expect(setCookieHeaders(res)).toHaveLength(0);
    });

    it('locks the account after the configured number of failures, even for the correct password, and audits it', async () => {
      const user = await ctx.register('login-lock');
      for (let i = 0; i < ctx.maxFailedAttempts; i += 1) {
        await ctx
          .login({ email: user.email, password: 'Wr0ngPasswordEntirely' })
          .expect(401);
      }

      const locked = await ctx.login(user).expect(401);
      expect(locked.body.error.code).toBe('ACCOUNT_LOCKED');
      expect(setCookieHeaders(locked)).toHaveLength(0);

      const row = await ctx.prisma.user.findUniqueOrThrow({
        where: { id: user.id },
      });
      expect(row.lockedUntil!.getTime()).toBeGreaterThan(Date.now());

      const actions = (
        await ctx.prisma.auditLog.findMany({ where: { userId: user.id } })
      ).map((a) => a.action);
      expect(actions).toContain('ACCOUNT_LOCKED');
      expect(actions.filter((a) => a === 'LOGIN_FAILURE')).toHaveLength(
        ctx.maxFailedAttempts,
      );
    });

    it('lets the user back in once the lock has expired', async () => {
      const user = await ctx.register('login-unlock');
      await ctx.prisma.user.update({
        where: { id: user.id },
        data: { lockedUntil: new Date(Date.now() - 1000) },
      });
      const res = await ctx.login(user).expect(200);
      expect(res.body.status).toBe('AUTHENTICATED');
    });

    it('resets the failure counter after a successful login', async () => {
      const user = await ctx.register('login-reset');
      for (let i = 0; i < ctx.maxFailedAttempts - 1; i += 1) {
        await ctx
          .login({ email: user.email, password: 'Wr0ngPasswordEntirely' })
          .expect(401);
      }
      await ctx.login(user).expect(200);
      const row = await ctx.prisma.user.findUniqueOrThrow({
        where: { id: user.id },
      });
      expect(row.failedLoginAttempts).toBe(0);
    });
  });
});
