import request from 'supertest';
import {
  API,
  E2eContext,
  PASSWORD,
  captureOutput,
  cookieValue,
  createE2eContext,
  extractSecret,
  freshTotp,
  wrongTotp,
} from './support/e2e-helpers';

jest.setTimeout(240_000);

describe('Auth e2e — audit trail, secret hygiene, CORS, Swagger, health', () => {
  let ctx: E2eContext;

  beforeAll(async () => {
    ctx = await createE2eContext({ verboseLogs: true });
  });

  afterAll(async () => {
    await ctx.cleanup();
    await ctx.app.close();
  });

  describe('audit_logs', () => {
    it('records every authentication lifecycle event with the right actor, entity and no secrets', async () => {
      const officer = await ctx.registerWithRole(
        'audit-life',
        'SCRUTINY_OFFICER',
      );

      // Failed password, then MFA setup -> enable.
      await ctx
        .login({ email: officer.email, password: 'Wr0ngPasswordEntirely' })
        .expect(401);
      const setup = await ctx.login(officer).expect(200);
      const enroll = await request(ctx.http)
        .post(`${API}/auth/mfa/enroll`)
        .set('Authorization', `Bearer ${setup.body.challengeToken}`)
        .expect(201);
      const secret = extractSecret(enroll.body.provisioningUri);
      await request(ctx.http)
        .post(`${API}/auth/mfa/confirm`)
        .set('Authorization', `Bearer ${setup.body.challengeToken}`)
        .send({ code: wrongTotp(secret) })
        .expect(400);
      await request(ctx.http)
        .post(`${API}/auth/mfa/confirm`)
        .set('Authorization', `Bearer ${setup.body.challengeToken}`)
        .send({ code: await freshTotp(secret) })
        .expect(200);

      // MFA login: one failure, one success.
      const challenge = await ctx.login(officer).expect(200);
      await request(ctx.http)
        .post(`${API}/auth/mfa/verify`)
        .send({
          challengeToken: challenge.body.challengeToken,
          code: wrongTotp(secret),
        })
        .expect(401);
      const verified = await request(ctx.http)
        .post(`${API}/auth/mfa/verify`)
        .send({
          challengeToken: challenge.body.challengeToken,
          code: await freshTotp(secret),
        })
        .expect(200);

      // Rotation, reuse detection, logout.
      const first = cookieValue(verified, ctx.cookieName)!;
      const rotated = await ctx.refresh(first).expect(200);
      const second = cookieValue(rotated, ctx.cookieName)!;
      await ctx.refresh(first).expect(401); // reuse
      const relogin = await ctx.mfaLogin(officer, secret);
      await ctx.logout(relogin.refreshCookieValue).expect(200);

      const rows = await ctx.prisma.auditLog.findMany({
        where: { userId: officer.id },
        orderBy: { createdAt: 'asc' },
      });
      const actions = rows.map((r) => r.action);
      for (const expected of [
        'USER_REGISTERED',
        'LOGIN_FAILURE',
        'MFA_ENROLLED',
        'MFA_VERIFY_FAILURE',
        'MFA_ENABLED',
        'MFA_LOGIN_SUCCESS',
        'REFRESH_TOKEN_ROTATED',
        'REFRESH_TOKEN_REUSE_DETECTED',
        'LOGOUT',
      ]) {
        expect(actions).toContain(expected);
      }
      // Both the wrong confirm code and the wrong login code were audited.
      expect(actions.filter((a) => a === 'MFA_VERIFY_FAILURE')).toHaveLength(2);

      const assigned = await ctx.prisma.auditLog.findMany({
        where: {
          action: 'ROLE_ASSIGNED',
          afterState: { path: ['userId'], equals: officer.id },
        },
      });
      expect(assigned).toHaveLength(1);

      // Every row is well-formed and carries a real client address.
      for (const row of rows) {
        expect(row.entityId).toMatch(/^[0-9a-f-]{36}$/);
        expect(row.ipAddress).not.toBe('');
        expect(row.ipAddress).not.toBe('internal');
      }

      // No secret material anywhere in any audit row for this user.
      const blob = JSON.stringify([...rows, ...assigned]);
      for (const secretish of [
        PASSWORD,
        secret,
        first,
        second,
        relogin.refreshCookieValue,
        relogin.accessToken,
        'otpauth',
        'passwordHash',
        '$argon2',
      ]) {
        expect(blob).not.toContain(secretish);
      }
    });

    it('audits a successful password login for a non-MFA account', async () => {
      const { user } = await ctx.applicantSession('audit-plain');
      const actions = (
        await ctx.prisma.auditLog.findMany({ where: { userId: user.id } })
      ).map((a) => a.action);
      expect(actions).toEqual(
        expect.arrayContaining(['USER_REGISTERED', 'LOGIN_SUCCESS']),
      );
    });

    it('does not audit (or reveal) attempts against nonexistent accounts', async () => {
      const before = await ctx.prisma.auditLog.count({
        where: { action: 'LOGIN_FAILURE' },
      });
      await ctx
        .login({
          email: `ghost-${ctx.runId}@example.test`,
          password: 'Wr0ngPasswordEntirely',
        })
        .expect(401);
      const after = await ctx.prisma.auditLog.count({
        where: { action: 'LOGIN_FAILURE' },
      });
      expect(after).toBe(before);
    });
  });

  describe('log hygiene', () => {
    it('never writes passwords, TOTP secrets, tokens or hashes to stdout/stderr through a full lifecycle, including failures', async () => {
      const capture = captureOutput();
      let secret = '';
      let tokens: string[] = [];
      let password = PASSWORD;
      try {
        const officer = await ctx.registerWithRole('logs', 'SCRUTINY_OFFICER');
        password = officer.password;
        await ctx
          .login({ email: officer.email, password: 'Wr0ngPasswordEntirely' })
          .expect(401);
        const setup = await ctx.login(officer).expect(200);
        secret = await ctx.enrollAndConfirm(setup.body.challengeToken);
        const session = await ctx.mfaLogin(officer, secret);
        const rotated = await ctx
          .refresh(session.refreshCookieValue)
          .expect(200);
        await ctx.refresh(session.refreshCookieValue).expect(401);
        await request(ctx.http)
          .post(`${API}/auth/register`)
          .send({ name: 'Bad', email: 'nope', mobile: '1', password: 'x' })
          .expect(400);
        tokens = [
          setup.body.challengeToken,
          session.accessToken,
          session.refreshCookieValue,
          rotated.body.accessToken,
          cookieValue(rotated, ctx.cookieName)!,
        ];
      } finally {
        const output = capture.stop();
        expect(output.length).toBeGreaterThan(0); // the logger really was captured
        for (const sensitive of [
          password,
          secret,
          ...tokens,
          '$argon2',
          'passwordHash',
        ]) {
          expect(sensitive).toBeTruthy();
          expect(output).not.toContain(sensitive);
        }
      }
    });
  });

  describe('error hygiene', () => {
    it('error responses never contain stack traces, SQL, file paths or secrets', async () => {
      const bodies = [
        await request(ctx.http).get(`${API}/auth/me`).expect(401),
        await request(ctx.http)
          .post(`${API}/auth/register`)
          .send({})
          .expect(400),
        await request(ctx.http).get(`${API}/nope`).expect(404),
        await ctx
          .login({ email: 'x@example.test', password: 'Wr0ngPasswordEntirely' })
          .expect(401),
        await request(ctx.http)
          .post(`${API}/auth/login`)
          .set('Content-Type', 'application/json')
          .send('{"broken":')
          .expect(400),
      ];
      for (const res of bodies) {
        expect(Object.keys(res.body)).toEqual(['error']);
        const text = res.text;
        expect(text).not.toMatch(/\bat\s+\S+\s+\(.*:\d+:\d+\)/); // stack frame
        expect(text.toLowerCase()).not.toMatch(
          /prisma|select |insert |postgres|node_modules|stack/,
        );
        expect(text).not.toContain(ctx.accessSecret);
        expect(text).not.toContain(ctx.refreshSecret);
        expect(text).not.toMatch(/[A-Z]:\\|\/home\//);
      }
    });

    it('security headers are present (helmet) and the server does not advertise its framework', async () => {
      const res = await request(ctx.http).get(`${API}/health`).expect(200);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-powered-by']).toBeUndefined();
      expect(res.headers['strict-transport-security']).toBeDefined();
    });
  });

  describe('CORS', () => {
    const frontendUrl = () => ctx.config.getOrThrow<string>('frontendUrl');

    it('allows credentialed requests only from the configured frontend origin — never a wildcard', async () => {
      const res = await request(ctx.http)
        .options(`${API}/auth/login`)
        .set('Origin', frontendUrl())
        .set('Access-Control-Request-Method', 'POST')
        .expect(204);
      expect(res.headers['access-control-allow-origin']).toBe(frontendUrl());
      expect(res.headers['access-control-allow-origin']).not.toBe('*');
      expect(res.headers['access-control-allow-credentials']).toBe('true');
    });

    it('does not grant CORS access to any other origin', async () => {
      const res = await request(ctx.http)
        .options(`${API}/auth/login`)
        .set('Origin', 'https://evil.example')
        .set('Access-Control-Request-Method', 'POST');
      expect(res.headers['access-control-allow-origin']).not.toBe(
        'https://evil.example',
      );
      expect(res.headers['access-control-allow-origin']).not.toBe('*');

      const actual = await request(ctx.http)
        .get(`${API}/health`)
        .set('Origin', 'https://evil.example')
        .expect(200);
      expect(actual.headers['access-control-allow-origin']).not.toBe(
        'https://evil.example',
      );
      expect(actual.headers['access-control-allow-origin']).not.toBe('*');
    });
  });

  describe('Swagger (/api/docs, /api/docs-json)', () => {
    it('serves the UI and documents exactly the real authentication + health endpoints', async () => {
      await request(ctx.http).get('/api/docs').expect(200);
      const res = await request(ctx.http).get('/api/docs-json').expect(200);
      const paths = Object.keys(res.body.paths).sort();

      expect(paths).toEqual(
        [
          `${API}/auth/register`,
          `${API}/auth/login`,
          `${API}/auth/mfa/verify`,
          `${API}/auth/refresh`,
          `${API}/auth/logout`,
          `${API}/auth/me`,
          `${API}/auth/mfa/enroll`,
          `${API}/auth/mfa/confirm`,
          `${API}/health`,
          `${API}/health/db`,
        ].sort(),
      );
      expect(paths.some((p) => p.includes('test-authz'))).toBe(false);
    });

    it('response schemas expose no password hashes, refresh tokens, secrets or internal columns', async () => {
      const { body } = await request(ctx.http)
        .get('/api/docs-json')
        .expect(200);
      const schemas = body.components.schemas as Record<
        string,
        { properties?: Record<string, unknown> }
      >;
      const forbidden =
        /hash|refresh|totpsecret|secret|failedlogin|lockedun|isactive|token_hash|familyid/i;

      const responseSchemas = [
        'AuthenticatedUserDto',
        'LoginResponseDto',
        'RegisterResponseDto',
        'MfaEnrollResponseDto',
        'SimpleSuccessResponseDto',
      ];
      for (const name of responseSchemas) {
        expect(schemas[name]).toBeDefined();
        for (const prop of Object.keys(schemas[name].properties ?? {})) {
          expect(prop).not.toMatch(forbidden);
        }
      }
      // The only "password" the API accepts is the write-only input on
      // register/login — it must never appear in a response schema.
      for (const name of responseSchemas) {
        expect(Object.keys(schemas[name].properties ?? {})).not.toContain(
          'password',
        );
      }
      // Login/MFA request schemas never accept a refresh token or secret.
      for (const name of [
        'LoginDto',
        'RegisterDto',
        'MfaVerifyDto',
        'MfaConfirmDto',
      ]) {
        for (const prop of Object.keys(schemas[name].properties ?? {})) {
          expect(prop).not.toMatch(/refresh|hash|secret/i);
        }
      }
    });

    it('marks protected endpoints as bearer-authenticated and leaves register/login/refresh/logout open', async () => {
      const { body } = await request(ctx.http)
        .get('/api/docs-json')
        .expect(200);
      for (const path of ['me', 'mfa/enroll', 'mfa/confirm']) {
        const op = Object.values(body.paths[`${API}/auth/${path}`])[0] as {
          security?: unknown[];
        };
        expect(op.security).toBeDefined();
      }
    });
  });

  describe('health (public, backed by the Docker PostgreSQL)', () => {
    it('GET /health is reachable without credentials', async () => {
      const res = await request(ctx.http).get(`${API}/health`).expect(200);
      expect(res.body.status).toBe('ok');
    });

    it('GET /health/db reports the database as up, without leaking connection details', async () => {
      const res = await request(ctx.http).get(`${API}/health/db`).expect(200);
      expect(res.body.status).toBe('up');
      expect(typeof res.body.latencyMs).toBe('number');
      expect(res.text).not.toMatch(/postgres|mahaudyam|5433|password/i);
    });
  });
});
