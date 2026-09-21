import request from 'supertest';
import { API, E2eContext, createE2eContext } from './support/e2e-helpers';

jest.setTimeout(240_000);

/**
 * Exercises RolesGuard / PermissionsGuard / DepartmentScopeGuard over real
 * HTTP against the real database, through TEST-ONLY routes defined in
 * test/support/authz-test.module.ts (not part of the application).
 */
describe('Auth e2e — RBAC, permissions and department scoping', () => {
  let ctx: E2eContext;
  let deptA: string;
  let deptB: string;

  beforeAll(async () => {
    ctx = await createE2eContext();
    const a = await ctx.prisma.department.create({
      data: { name: `E2E Dept A ${ctx.runId}`, code: `E2E-A-${ctx.runId}` },
    });
    const b = await ctx.prisma.department.create({
      data: { name: `E2E Dept B ${ctx.runId}`, code: `E2E-B-${ctx.runId}` },
    });
    deptA = a.id;
    deptB = b.id;
    ctx.departmentIds.push(a.id, b.id);
  });

  afterAll(async () => {
    await ctx.cleanup();
    await ctx.app.close();
  });

  const get = (path: string, token?: string) => {
    const req = request(ctx.http).get(`${API}/test-authz/${path}`);
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  };

  describe('roles (RolesGuard)', () => {
    it('denies an unauthenticated caller before any role check', async () => {
      await get('officer-only').expect(401);
    });

    it('denies an APPLICANT on an officer-only route with INSUFFICIENT_ROLE', async () => {
      const { accessToken } = await ctx.applicantSession('rbac-applicant');
      const res = await get('officer-only', accessToken).expect(403);
      expect(res.body.error.code).toBe('INSUFFICIENT_ROLE');
    });

    it('allows a SCRUTINY_OFFICER who has completed MFA', async () => {
      const officer = await ctx.registerWithRole(
        'rbac-officer',
        'SCRUTINY_OFFICER',
      );
      const { accessToken } = await ctx.fullMfaSession(officer);
      await get('officer-only', accessToken).expect(200);
    });

    it('denies an officer holding a different role', async () => {
      const inspector = await ctx.registerWithRole(
        'rbac-inspector',
        'INSPECTOR',
      );
      const { accessToken } = await ctx.fullMfaSession(inspector);
      const res = await get('officer-only', accessToken).expect(403);
      expect(res.body.error.code).toBe('INSUFFICIENT_ROLE');
    });

    it('re-checks roles in the database on every request: revoking a role takes effect immediately, before the token expires', async () => {
      const officer = await ctx.registerWithRole(
        'rbac-revoke',
        'SCRUTINY_OFFICER',
      );
      const { accessToken } = await ctx.fullMfaSession(officer);
      await get('officer-only', accessToken).expect(200);

      await ctx.prisma.userRole.deleteMany({
        where: { userId: officer.id, role: { code: 'SCRUTINY_OFFICER' } },
      });
      const res = await get('officer-only', accessToken).expect(403);
      expect(res.body.error.code).toBe('INSUFFICIENT_ROLE');
    });

    it('authorises from the database, not from the JWT roles claim — and a role granted mid-session does NOT bypass mandatory MFA', async () => {
      const { user, accessToken } = await ctx.applicantSession('rbac-claims');
      // Claim in the token says APPLICANT; DB now says SCRUTINY_OFFICER.
      await ctx.users.assignRole({
        userId: user.id,
        roleCode: 'SCRUTINY_OFFICER',
        assignedByUserId: null,
        ipAddress: '127.0.0.1',
      });

      // This 15-minute token was issued before the role existed, i.e. with
      // no MFA. The officer role now requires MFA, so it must be refused on
      // every route (including one with no role check at all) until the
      // user has completed MFA — not silently upgraded to officer access.
      const denied = await get('officer-only', accessToken).expect(403);
      expect(denied.body.error.code).toBe('MFA_REQUIRED');
      const deniedMe = await request(ctx.http)
        .get(`${API}/auth/me`)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(403);
      expect(deniedMe.body.error.code).toBe('MFA_REQUIRED');

      // Re-login is routed through MFA setup (no session issued)...
      const relogin = await ctx.login(user).expect(200);
      expect(relogin.body.status).toBe('MFA_SETUP_REQUIRED');
      expect(relogin.body.accessToken).toBeUndefined();

      // ...and once MFA is genuinely completed, the officer role works.
      const { accessToken: mfaToken } = await ctx.fullMfaSession(user);
      await get('officer-only', mfaToken).expect(200);
      // A forged claim cannot help either: covered in auth-session
      // (tampered payload / wrong secret => 401).
    });
  });

  describe('permissions (PermissionsGuard)', () => {
    it('denies an APPLICANT (no USER_MANAGE) with INSUFFICIENT_PERMISSION', async () => {
      const { accessToken } = await ctx.applicantSession('perm-applicant');
      const res = await get('manage-users', accessToken).expect(403);
      expect(res.body.error.code).toBe('INSUFFICIENT_PERMISSION');
    });

    it('denies a SCRUTINY_OFFICER: officer roles are not granted USER_MANAGE', async () => {
      const officer = await ctx.registerWithRole(
        'perm-officer',
        'SCRUTINY_OFFICER',
      );
      const { accessToken } = await ctx.fullMfaSession(officer);
      const res = await get('manage-users', accessToken).expect(403);
      expect(res.body.error.code).toBe('INSUFFICIENT_PERMISSION');
    });

    it('allows SYSTEM_ADMIN, whose role carries USER_MANAGE', async () => {
      const admin = await ctx.registerWithRole('perm-admin', 'SYSTEM_ADMIN');
      const { accessToken } = await ctx.fullMfaSession(admin);
      await get('manage-users', accessToken).expect(200);
    });

    it('denies unauthenticated callers', async () => {
      await get('manage-users').expect(401);
    });
  });

  describe('department scoping (DepartmentScopeGuard)', () => {
    it('lets a user reach their own department and denies a different department', async () => {
      const officer = await ctx.registerWithRole(
        'dept-a',
        'SCRUTINY_OFFICER',
        deptA,
      );
      const { accessToken } = await ctx.fullMfaSession(officer);

      await get(`department/${deptA}`, accessToken).expect(200);
      const denied = await get(`department/${deptB}`, accessToken).expect(403);
      expect(denied.body.error.code).toBe('INSUFFICIENT_PERMISSION');
    });

    it('isolates two departments from each other in both directions', async () => {
      const a = await ctx.registerWithRole(
        'dept-iso-a',
        'SCRUTINY_OFFICER',
        deptA,
      );
      const b = await ctx.registerWithRole(
        'dept-iso-b',
        'SCRUTINY_OFFICER',
        deptB,
      );
      const sa = await ctx.fullMfaSession(a);
      const sb = await ctx.fullMfaSession(b);

      await get(`department/${deptA}`, sa.accessToken).expect(200);
      await get(`department/${deptB}`, sa.accessToken).expect(403);
      await get(`department/${deptB}`, sb.accessToken).expect(200);
      await get(`department/${deptA}`, sb.accessToken).expect(403);
    });

    it('denies an applicant with no department assignment', async () => {
      const { accessToken } = await ctx.applicantSession('dept-applicant');
      await get(`department/${deptA}`, accessToken).expect(403);
    });

    it('denies (does not 500) on a malformed or unknown department id', async () => {
      const officer = await ctx.registerWithRole(
        'dept-bad',
        'SCRUTINY_OFFICER',
        deptA,
      );
      const { accessToken } = await ctx.fullMfaSession(officer);

      for (const id of [
        'not-a-uuid',
        "1'; DROP TABLE users;--",
        '00000000-0000-0000-0000-000000000000',
      ]) {
        const res = await get(
          `department/${encodeURIComponent(id)}`,
          accessToken,
        );
        expect(res.status).toBe(403);
        expect(res.text.toLowerCase()).not.toContain('prisma');
      }
    });

    it('requires authentication', async () => {
      await get(`department/${deptA}`).expect(401);
    });
  });

  describe('privilege escalation', () => {
    it('an applicant cannot self-assign a privileged role through registration', async () => {
      const identity = ctx.newIdentity('esc-register');
      await request(ctx.http)
        .post(`${API}/auth/register`)
        .send({ name: 'Mallory Tester', ...identity, roles: ['SUPER_ADMIN'] })
        .expect(400);
    });

    it('exposes no HTTP route that assigns roles or manages users', async () => {
      const { user, accessToken } = await ctx.applicantSession('esc-routes');
      const attempts: Array<[string, string]> = [
        ['post', `${API}/users`],
        ['post', `${API}/users/${user.id}/roles`],
        ['patch', `${API}/users/${user.id}`],
        ['put', `${API}/auth/me`],
        ['patch', `${API}/auth/me`],
        ['post', `${API}/auth/roles`],
        ['post', `${API}/roles`],
      ];
      for (const [method, url] of attempts) {
        const res = await (request(ctx.http) as any)
          [method](url)
          .set('Authorization', `Bearer ${accessToken}`)
          .send({ roles: ['SUPER_ADMIN'], roleCode: 'SUPER_ADMIN' });
        expect([404, 405]).toContain(res.status);
      }
      expect(await ctx.users.getRoleCodes(user.id)).toEqual(['APPLICANT']);
    });

    it('an applicant token cannot reach privileged test routes', async () => {
      const { accessToken } = await ctx.applicantSession('esc-token');
      await get('officer-only', accessToken).expect(403);
      await get('manage-users', accessToken).expect(403);
      await get(`department/${deptA}`, accessToken).expect(403);
    });

    it('privileged role assignment via the internal service is audited with the target user and role', async () => {
      const officer = await ctx.registerWithRole(
        'esc-audit',
        'DEPT_ADMIN',
        deptA,
      );
      const rows = await ctx.prisma.auditLog.findMany({
        where: {
          action: 'ROLE_ASSIGNED',
          afterState: { path: ['userId'], equals: officer.id },
        },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0].entityType).toBe('UserRole');
      expect(rows[0].afterState).toMatchObject({
        userId: officer.id,
        roleCode: 'DEPT_ADMIN',
        departmentId: deptA,
      });
    });
  });
});
