import request from 'supertest';
import {
  API,
  E2eContext,
  base64url,
  createE2eContext,
  extractSecret,
  freshTotp,
  setCookieHeaders,
  wrongTotp,
} from './support/e2e-helpers';

jest.setTimeout(180_000);

describe('Auth e2e — MFA (TOTP)', () => {
  let ctx: E2eContext;

  beforeAll(async () => {
    ctx = await createE2eContext();
  });

  afterAll(async () => {
    await ctx.cleanup();
    await ctx.app.close();
  });

  describe('mandatory MFA for privileged roles', () => {
    it('issues NO access token and NO refresh session before MFA is set up', async () => {
      const officer = await ctx.registerWithRole('mfa-req', 'SCRUTINY_OFFICER');
      const res = await ctx.login(officer).expect(200);

      expect(res.body.status).toBe('MFA_SETUP_REQUIRED');
      expect(typeof res.body.challengeToken).toBe('string');
      expect(res.body.accessToken).toBeUndefined();
      expect(res.body.user).toBeUndefined();
      expect(setCookieHeaders(res)).toHaveLength(0);

      const sessions = await ctx.prisma.refreshSession.count({
        where: { userId: officer.id },
      });
      expect(sessions).toBe(0);
    });

    it('the setup challenge token grants nothing beyond the MFA setup endpoints', async () => {
      const officer = await ctx.registerWithRole(
        'mfa-narrow',
        'SCRUTINY_OFFICER',
      );
      const { body } = await ctx.login(officer).expect(200);
      const bearer = { Authorization: `Bearer ${body.challengeToken}` };

      const me = await request(ctx.http)
        .get(`${API}/auth/me`)
        .set(bearer)
        .expect(403);
      expect(me.body.error.code).toBe('INVALID_TOKEN_TYPE');
      const guarded = await request(ctx.http)
        .get(`${API}/test-authz/officer-only`)
        .set(bearer)
        .expect(403);
      expect(guarded.body.error.code).toBe('INVALID_TOKEN_TYPE');
      await ctx.refresh(body.challengeToken).expect(401);
    });

    it('cannot be bypassed by skipping enrollment: still MFA_SETUP_REQUIRED until confirmation succeeds', async () => {
      const officer = await ctx.registerWithRole(
        'mfa-nobypass',
        'APPROVING_AUTHORITY',
      );
      const first = await ctx.login(officer).expect(200);
      await request(ctx.http)
        .post(`${API}/auth/mfa/enroll`)
        .set('Authorization', `Bearer ${first.body.challengeToken}`)
        .expect(201);

      // Enrolled but NOT confirmed -> MFA is not enabled and must not count.
      const again = await ctx.login(officer).expect(200);
      expect(again.body.status).toBe('MFA_SETUP_REQUIRED');
      expect(again.body.accessToken).toBeUndefined();
      const row = await ctx.prisma.user.findUniqueOrThrow({
        where: { id: officer.id },
      });
      expect(row.mfaEnabled).toBe(false);
    });

    it('every MFA-mandated role is challenged at login (not only SCRUTINY_OFFICER)', async () => {
      const roles = ['SYSTEM_ADMIN', 'SUPER_ADMIN', 'AUDITOR', 'LEADERSHIP'];
      for (const role of roles) {
        const user = await ctx.registerWithRole(`mfa-role-${role}`, role);
        const res = await ctx.login(user).expect(200);
        expect(res.body.status).toBe('MFA_SETUP_REQUIRED');
        expect(res.body.accessToken).toBeUndefined();
      }
    });
  });

  describe('enrollment & confirmation', () => {
    it('stores the TOTP secret encrypted and only enables MFA after a valid confirmation code', async () => {
      const officer = await ctx.registerWithRole('mfa-enroll', 'INSPECTOR');
      const { body } = await ctx.login(officer).expect(200);
      const bearer = { Authorization: `Bearer ${body.challengeToken}` };

      const enroll = await request(ctx.http)
        .post(`${API}/auth/mfa/enroll`)
        .set(bearer)
        .expect(201);
      expect(Object.keys(enroll.body)).toEqual(['provisioningUri']);
      expect(enroll.body.provisioningUri).toMatch(/^otpauth:\/\/totp\//);
      const secret = extractSecret(enroll.body.provisioningUri);

      const cred = await ctx.prisma.mfaCredential.findUniqueOrThrow({
        where: { userId: officer.id },
      });
      expect(cred.enabledAt).toBeNull();
      expect(cred.totpSecret).not.toContain(secret);
      expect(cred.totpSecret.split(':')).toHaveLength(3); // iv:tag:ciphertext (AES-256-GCM)
      let row = await ctx.prisma.user.findUniqueOrThrow({
        where: { id: officer.id },
      });
      expect(row.mfaEnabled).toBe(false);

      const bad = await request(ctx.http)
        .post(`${API}/auth/mfa/confirm`)
        .set(bearer)
        .send({ code: wrongTotp(secret) })
        .expect(400);
      expect(bad.body.error.code).toBe('INVALID_MFA_CODE');
      row = await ctx.prisma.user.findUniqueOrThrow({
        where: { id: officer.id },
      });
      expect(row.mfaEnabled).toBe(false);

      await request(ctx.http)
        .post(`${API}/auth/mfa/confirm`)
        .set(bearer)
        .send({ code: await freshTotp(secret) })
        .expect(200);
      row = await ctx.prisma.user.findUniqueOrThrow({
        where: { id: officer.id },
      });
      expect(row.mfaEnabled).toBe(true);
      const enabled = await ctx.prisma.mfaCredential.findUniqueOrThrow({
        where: { userId: officer.id },
      });
      expect(enabled.enabledAt).not.toBeNull();
    });

    it('confirm without a prior enrollment is rejected', async () => {
      const officer = await ctx.registerWithRole('mfa-noenroll', 'INSPECTOR');
      const { body } = await ctx.login(officer).expect(200);
      const res = await request(ctx.http)
        .post(`${API}/auth/mfa/confirm`)
        .set('Authorization', `Bearer ${body.challengeToken}`)
        .send({ code: '123456' })
        .expect(400);
      expect(res.body.error.code).toBe('MFA_NOT_ENROLLED');
    });

    it('rejects malformed confirmation codes with 400', async () => {
      const officer = await ctx.registerWithRole('mfa-badfmt', 'INSPECTOR');
      const { body } = await ctx.login(officer).expect(200);
      for (const code of ['12345', '1234567', 'abcdef', '']) {
        await request(ctx.http)
          .post(`${API}/auth/mfa/confirm`)
          .set('Authorization', `Bearer ${body.challengeToken}`)
          .send({ code })
          .expect(400);
      }
    });

    it('requires authentication for enroll and confirm', async () => {
      await request(ctx.http).post(`${API}/auth/mfa/enroll`).expect(401);
      await request(ctx.http)
        .post(`${API}/auth/mfa/confirm`)
        .send({ code: '123456' })
        .expect(401);
    });

    it('refuses to re-enroll once MFA is enabled (cannot silently replace the secret)', async () => {
      const officer = await ctx.registerWithRole('mfa-reenroll', 'AUDITOR');
      const session = await ctx.fullMfaSession(officer);
      const res = await request(ctx.http)
        .post(`${API}/auth/mfa/enroll`)
        .set('Authorization', `Bearer ${session.accessToken}`)
        .expect(409);
      expect(res.body.error.code).toBe('MFA_ALREADY_ENABLED');
    });

    it('applicants may opt in to MFA with a normal access token, and are then challenged at login', async () => {
      const { user, accessToken } = await ctx.applicantSession('mfa-optin');
      const secret = await ctx.enrollAndConfirm(accessToken);
      const res = await ctx.login(user).expect(200);
      expect(res.body.status).toBe('MFA_REQUIRED');
      expect(res.body.accessToken).toBeUndefined();
      expect(setCookieHeaders(res)).toHaveLength(0);
      expect((await ctx.mfaLogin(user, secret)).accessToken).toBeDefined();
    });

    it('never exposes the TOTP secret after enrollment (login, verify, me)', async () => {
      const officer = await ctx.registerWithRole('mfa-nosecret', 'DEPT_ADMIN');
      const { body } = await ctx.login(officer).expect(200);
      const secret = await ctx.enrollAndConfirm(body.challengeToken);

      const challenge = await ctx.login(officer).expect(200);
      const verify = await request(ctx.http)
        .post(`${API}/auth/mfa/verify`)
        .send({
          challengeToken: challenge.body.challengeToken,
          code: await freshTotp(secret),
        })
        .expect(200);
      const me = await ctx.me(verify.body.accessToken).expect(200);

      for (const res of [challenge, verify, me]) {
        expect(res.text).not.toContain(secret);
        expect(res.text.toLowerCase()).not.toContain('otpauth');
        expect(res.text.toLowerCase()).not.toContain('totp');
      }
    });
  });

  describe('login challenge (POST /auth/mfa/verify)', () => {
    it('primary auth -> MFA challenge -> TOTP -> authenticated session', async () => {
      const officer = await ctx.registerWithRole(
        'mfa-flow',
        'SCRUTINY_OFFICER',
      );
      const { secret } = await ctx.fullMfaSession(officer);

      const challenge = await ctx.login(officer).expect(200);
      expect(challenge.body.status).toBe('MFA_REQUIRED');
      expect(challenge.body.accessToken).toBeUndefined();
      expect(setCookieHeaders(challenge)).toHaveLength(0);
      expect(
        await ctx.prisma.refreshSession.count({
          where: { userId: officer.id, revokedAt: null },
        }),
      ).toBe(1); // only the one from fullMfaSession — the challenge issued none

      const verify = await request(ctx.http)
        .post(`${API}/auth/mfa/verify`)
        .send({
          challengeToken: challenge.body.challengeToken,
          code: await freshTotp(secret),
        })
        .expect(200);

      expect(verify.body.status).toBe('AUTHENTICATED');
      expect([...verify.body.user.roles].sort()).toEqual([
        'APPLICANT',
        'SCRUTINY_OFFICER',
      ]);
      expect(verify.body.user.mfaEnabled).toBe(true);
      expect(setCookieHeaders(verify).join(';')).toMatch(/HttpOnly/i);
      await ctx.me(verify.body.accessToken).expect(200);
    });

    it('rejects an invalid TOTP code without issuing a session', async () => {
      const officer = await ctx.registerWithRole(
        'mfa-badcode',
        'SCRUTINY_OFFICER',
      );
      const { secret } = await ctx.fullMfaSession(officer);
      const challenge = await ctx.login(officer).expect(200);

      const res = await request(ctx.http)
        .post(`${API}/auth/mfa/verify`)
        .send({
          challengeToken: challenge.body.challengeToken,
          code: wrongTotp(secret),
        })
        .expect(401);
      expect(res.body.error.code).toBe('INVALID_MFA_CODE');
      expect(res.body.accessToken).toBeUndefined();
      expect(setCookieHeaders(res)).toHaveLength(0);
    });

    it('rejects a malformed code and a missing challenge token with 400', async () => {
      await request(ctx.http)
        .post(`${API}/auth/mfa/verify`)
        .send({ challengeToken: 'x', code: 'abc' })
        .expect(400);
      await request(ctx.http)
        .post(`${API}/auth/mfa/verify`)
        .send({ code: '123456' })
        .expect(400);
    });

    it('rejects garbage, wrong-type and forged challenge tokens', async () => {
      const officer = await ctx.registerWithRole(
        'mfa-tokens',
        'SCRUTINY_OFFICER',
      );
      const session = await ctx.fullMfaSession(officer);
      const code = await freshTotp(session.secret);

      const garbage = await request(ctx.http)
        .post(`${API}/auth/mfa/verify`)
        .send({ challengeToken: 'garbage', code })
        .expect(401);
      expect(garbage.body.error.code).toBe('UNAUTHENTICATED');

      // A full access token is not a challenge token.
      const wrongType = await request(ctx.http)
        .post(`${API}/auth/mfa/verify`)
        .send({ challengeToken: session.accessToken, code })
        .expect(401);
      expect(wrongType.body.error.code).toBe('INVALID_TOKEN_TYPE');

      // An mfa_setup token (issued to a privileged user who has not yet
      // enrolled) is not an mfa_challenge token either.
      const unenrolled = await ctx.registerWithRole(
        'mfa-tokens-setup',
        'INSPECTOR',
      );
      const setupToken = (await ctx.login(unenrolled).expect(200)).body
        .challengeToken;
      const asSetup = await request(ctx.http)
        .post(`${API}/auth/mfa/verify`)
        .send({ challengeToken: setupToken, code })
        .expect(401);
      expect(asSetup.body.error.code).toBe('INVALID_TOKEN_TYPE');

      // alg=none forgery.
      const forged = `${base64url({ alg: 'none', typ: 'JWT' })}.${base64url({
        sub: officer.id,
        type: 'mfa_challenge',
      })}.`;
      await request(ctx.http)
        .post(`${API}/auth/mfa/verify`)
        .send({ challengeToken: forged, code })
        .expect(401);
    });

    it('rate-limits code guessing: repeated wrong codes lock the account, even against a correct code afterwards', async () => {
      const officer = await ctx.registerWithRole(
        'mfa-brute',
        'SCRUTINY_OFFICER',
      );
      const { secret } = await ctx.fullMfaSession(officer);
      const challenge = await ctx.login(officer).expect(200);

      for (let i = 0; i < ctx.maxFailedAttempts; i += 1) {
        await request(ctx.http)
          .post(`${API}/auth/mfa/verify`)
          .send({
            challengeToken: challenge.body.challengeToken,
            code: wrongTotp(secret),
          })
          .expect(401);
      }

      const afterLock = await request(ctx.http)
        .post(`${API}/auth/mfa/verify`)
        .send({
          challengeToken: challenge.body.challengeToken,
          code: await freshTotp(secret),
        })
        .expect(401);
      expect(afterLock.body.error.code).toBe('ACCOUNT_LOCKED');
      expect(setCookieHeaders(afterLock)).toHaveLength(0);

      const relogin = await ctx.login(officer).expect(401);
      expect(relogin.body.error.code).toBe('ACCOUNT_LOCKED');
    });

    it('a correct password cannot be used to refresh the MFA failure budget', async () => {
      const officer = await ctx.registerWithRole(
        'mfa-budget',
        'SCRUTINY_OFFICER',
      );
      const { secret } = await ctx.fullMfaSession(officer);

      // Interleave "log in with the right password" and "one wrong code".
      // If the password step reset the counter, this would never lock.
      for (let i = 0; i < ctx.maxFailedAttempts; i += 1) {
        const challenge = await ctx.login(officer).expect(200);
        await request(ctx.http)
          .post(`${API}/auth/mfa/verify`)
          .send({
            challengeToken: challenge.body.challengeToken,
            code: wrongTotp(secret),
          })
          .expect(401);
      }
      const res = await ctx.login(officer).expect(401);
      expect(res.body.error.code).toBe('ACCOUNT_LOCKED');
    });

    it('a disabled account cannot complete an already-issued challenge', async () => {
      const officer = await ctx.registerWithRole(
        'mfa-disabled',
        'SCRUTINY_OFFICER',
      );
      const { secret } = await ctx.fullMfaSession(officer);
      const challenge = await ctx.login(officer).expect(200);
      await ctx.prisma.user.update({
        where: { id: officer.id },
        data: { isActive: false },
      });

      await request(ctx.http)
        .post(`${API}/auth/mfa/verify`)
        .send({
          challengeToken: challenge.body.challengeToken,
          code: await freshTotp(secret),
        })
        .expect(401);
    });
  });
});
