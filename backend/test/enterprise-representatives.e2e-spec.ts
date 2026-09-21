import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { API, E2eContext, createE2eContext } from './support/e2e-helpers';

jest.setTimeout(300_000);

type Scope = 'VIEW_ONLY' | 'PREPARE_SUBMIT' | 'FULL';
interface Actor {
  user: { id: string; email: string; mobile: string };
  accessToken: string;
}

/**
 * Representative authorisation (FRD §20) over real HTTP -> Nest -> Prisma ->
 * PostgreSQL. Enterprise-level operations of each scope are exercised through
 * the TEST-ONLY routes in test/support/authz-test.module.ts, which sit behind
 * the real EnterpriseAccessGuard.
 */
describe('Enterprise representatives e2e — lifecycle, scopes, expiry, revocation, escalation', () => {
  let ctx: E2eContext;
  let owner: Actor;
  let repA: Actor;
  let repB: Actor;
  let stranger: Actor;
  let owner2: Actor;

  const as = (token: string) => ({
    get: (p: string) =>
      request(ctx.http)
        .get(`${API}${p}`)
        .set('Authorization', `Bearer ${token}`),
    post: (p: string) =>
      request(ctx.http)
        .post(`${API}${p}`)
        .set('Authorization', `Bearer ${token}`),
    put: (p: string) =>
      request(ctx.http)
        .put(`${API}${p}`)
        .set('Authorization', `Bearer ${token}`),
    patch: (p: string) =>
      request(ctx.http)
        .patch(`${API}${p}`)
        .set('Authorization', `Bearer ${token}`),
    del: (p: string) =>
      request(ctx.http)
        .delete(`${API}${p}`)
        .set('Authorization', `Bearer ${token}`),
  });

  const newEnterprise = async (tag: string, actor: Actor = owner) =>
    (await ctx.createEnterprise(actor.accessToken, tag)).id;

  const grant = (
    enterpriseId: string,
    body: Record<string, unknown>,
    by: Actor = owner,
  ) =>
    as(by.accessToken)
      .post(`/enterprises/${enterpriseId}/representatives`)
      .send(body);

  const accept = (authId: string, by: Actor) =>
    as(by.accessToken).post(`/representative-authorisations/${authId}/accept`);

  /** Grant (by email) + accept, returning the authorisation id. */
  const activate = async (
    enterpriseId: string,
    rep: Actor,
    scope: Scope,
    extra: Record<string, unknown> = {},
  ): Promise<string> => {
    const granted = await grant(enterpriseId, {
      emailOrMobile: rep.user.email,
      scope,
      ...extra,
    }).expect(201);
    await accept(granted.body.id, rep).expect(200);
    return granted.body.id;
  };

  const testRoute = (enterpriseId: string, path: string, by: Actor) =>
    as(by.accessToken).get(`/test-authz/enterprise/${enterpriseId}/${path}`);

  const auditRows = (entityId: string, action: string) =>
    ctx.prisma.auditLog.findMany({ where: { entityId, action } });

  beforeAll(async () => {
    ctx = await createE2eContext();
    [owner, repA, repB, stranger, owner2] = await Promise.all([
      ctx.applicantSession('rep-owner'),
      ctx.applicantSession('rep-a'),
      ctx.applicantSession('rep-b'),
      ctx.applicantSession('rep-stranger'),
      ctx.applicantSession('rep-owner2'),
    ]);
  });

  afterAll(async () => {
    await ctx.cleanup();
    await ctx.app.close();
  });

  // -----------------------------------------------------------------------
  describe('granting (POST /enterprises/:id/representatives)', () => {
    it('creates a PENDING authorisation by email — never ACTIVE — and exposes no personal identifiers', async () => {
      const enterpriseId = await newEnterprise('grant-email');
      const res = await grant(enterpriseId, {
        emailOrMobile: repA.user.email,
        scope: 'PREPARE_SUBMIT',
      }).expect(201);

      expect(res.body).toMatchObject({
        enterpriseId,
        representativeName: 'E2E rep-a',
        scope: 'PREPARE_SUBMIT',
        scopedProjectIds: [],
        status: 'PENDING',
        isExpired: false,
        authorisedAt: null,
        expiresAt: null,
        revokedAt: null,
      });
      expect(Object.keys(res.body).sort()).toEqual(
        [
          'id',
          'enterpriseId',
          'representativeName',
          'scope',
          'scopedProjectIds',
          'status',
          'isExpired',
          'authorisedAt',
          'expiresAt',
          'revokedAt',
          'createdAt',
        ].sort(),
      );
      const text = JSON.stringify(res.body);
      expect(text).not.toContain(repA.user.email);
      expect(text).not.toContain(repA.user.mobile);
      expect(text).not.toContain(repA.user.id);
    });

    it('accepts the representative’s mobile number as the identifier too', async () => {
      const enterpriseId = await newEnterprise('grant-mobile');
      const res = await grant(enterpriseId, {
        emailOrMobile: repB.user.mobile,
        scope: 'VIEW_ONLY',
      }).expect(201);
      expect(res.body.status).toBe('PENDING');
    });

    it('stores an expiry and a project restriction when provided', async () => {
      const enterpriseId = await newEnterprise('grant-opts');
      const projectId = await ctx.createProject(enterpriseId);
      const expiresAt = new Date(Date.now() + 86_400_000).toISOString();
      const res = await grant(enterpriseId, {
        emailOrMobile: repA.user.email,
        scope: 'FULL',
        expiresAt,
        projectIds: [projectId],
      }).expect(201);
      expect(res.body.expiresAt).toBe(expiresAt);
      expect(res.body.scopedProjectIds).toEqual([projectId]);
    });

    it('ignores nothing silently: status, authorisedAt and other lifecycle fields in the body are rejected', async () => {
      const enterpriseId = await newEnterprise('grant-mass');
      for (const extra of [
        { status: 'ACTIVE' },
        { authorisedAt: new Date().toISOString() },
        { revokedAt: null },
        { representativeUserId: repA.user.id },
        { enterpriseId: randomUUID() },
      ]) {
        const res = await grant(enterpriseId, {
          emailOrMobile: repA.user.email,
          scope: 'FULL',
          ...extra,
        }).expect(400);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
      }
      expect(
        await ctx.prisma.enterpriseRepresentative.count({
          where: { enterpriseId },
        }),
      ).toBe(0);
    });

    it('validates scope, identifier, expiry and project ids', async () => {
      const enterpriseId = await newEnterprise('grant-invalid');
      const otherEnterpriseProject = await ctx.createProject(
        await newEnterprise('grant-foreign-proj', owner2),
      );

      await grant(enterpriseId, {
        emailOrMobile: repA.user.email,
        scope: 'ADMIN',
      }).expect(400);
      await grant(enterpriseId, { emailOrMobile: repA.user.email }).expect(400);
      await grant(enterpriseId, { scope: 'FULL' }).expect(400);
      await grant(enterpriseId, {
        emailOrMobile: repA.user.email,
        scope: 'FULL',
        expiresAt: 'soon',
      }).expect(400);
      await grant(enterpriseId, {
        emailOrMobile: repA.user.email,
        scope: 'FULL',
        projectIds: ['x'],
      }).expect(400);

      const past = await grant(enterpriseId, {
        emailOrMobile: repA.user.email,
        scope: 'FULL',
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      }).expect(400);
      expect(past.body.error.code).toBe('INVALID_EXPIRY');

      const foreign = await grant(enterpriseId, {
        emailOrMobile: repA.user.email,
        scope: 'FULL',
        projectIds: [otherEnterpriseProject],
      }).expect(400);
      expect(foreign.body.error.code).toBe('INVALID_PROJECT_SCOPE');

      expect(
        await ctx.prisma.enterpriseRepresentative.count({
          where: { enterpriseId },
        }),
      ).toBe(0);
    });

    it('rejects an unregistered identifier with 404 REPRESENTATIVE_USER_NOT_FOUND', async () => {
      const enterpriseId = await newEnterprise('grant-unknown');
      const res = await grant(enterpriseId, {
        emailOrMobile: `nobody-${ctx.runId}@example.test`,
        scope: 'FULL',
      }).expect(404);
      expect(res.body.error.code).toBe('REPRESENTATIVE_USER_NOT_FOUND');
    });

    it('does not let the owner authorise themselves', async () => {
      const enterpriseId = await newEnterprise('grant-self');
      const res = await grant(enterpriseId, {
        emailOrMobile: owner.user.email,
        scope: 'FULL',
      }).expect(400);
      expect(res.body.error.code).toBe('CANNOT_AUTHORISE_SELF');
    });

    it('rejects a second live authorisation for the same representative — and exactly one of two simultaneous grants wins', async () => {
      const enterpriseId = await newEnterprise('grant-dup');
      await grant(enterpriseId, {
        emailOrMobile: repA.user.email,
        scope: 'VIEW_ONLY',
      }).expect(201);
      const dup = await grant(enterpriseId, {
        emailOrMobile: repA.user.email,
        scope: 'FULL',
      }).expect(409);
      expect(dup.body.error.code).toBe('REPRESENTATIVE_ALREADY_AUTHORISED');

      const raceEnterprise = await newEnterprise('grant-race');
      const results = await Promise.all([
        grant(raceEnterprise, {
          emailOrMobile: repB.user.email,
          scope: 'VIEW_ONLY',
        }),
        grant(raceEnterprise, {
          emailOrMobile: repB.user.email,
          scope: 'VIEW_ONLY',
        }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(
        await ctx.prisma.enterpriseRepresentative.count({
          where: { enterpriseId: raceEnterprise },
        }),
      ).toBe(1);
    });

    it('audits the grant against the owner, with no secrets', async () => {
      const enterpriseId = await newEnterprise('grant-audit');
      const res = await grant(enterpriseId, {
        emailOrMobile: repA.user.email,
        scope: 'PREPARE_SUBMIT',
      }).expect(201);
      const rows = await auditRows(res.body.id, 'REPRESENTATIVE_AUTHORISED');
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        userId: owner.user.id,
        entityType: 'EnterpriseRepresentative',
      });
      expect(rows[0].afterState).toMatchObject({
        enterpriseId,
        representativeUserId: repA.user.id,
        scope: 'PREPARE_SUBMIT',
        status: 'PENDING',
      });
      expect(JSON.stringify(rows[0]).toLowerCase()).not.toMatch(
        /password|secret|token|hash/,
      );
    });

    it('is authenticated and owner-only: a stranger gets 404, no token 401, and nothing is created', async () => {
      const enterpriseId = await newEnterprise('grant-authz');
      await request(ctx.http)
        .post(`${API}/enterprises/${enterpriseId}/representatives`)
        .send({ emailOrMobile: repA.user.email, scope: 'FULL' })
        .expect(401);
      const res = await grant(
        enterpriseId,
        { emailOrMobile: repA.user.email, scope: 'FULL' },
        stranger,
      ).expect(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
      expect(
        await ctx.prisma.enterpriseRepresentative.count({
          where: { enterpriseId },
        }),
      ).toBe(0);
    });
  });

  // -----------------------------------------------------------------------
  describe('PENDING -> ACTIVE: two-sided consent (FRD §20.2)', () => {
    it('a PENDING representative has zero access: enterprise is 404, not listed, and test routes are 404', async () => {
      const enterpriseId = await newEnterprise('pending');
      await grant(enterpriseId, {
        emailOrMobile: repA.user.email,
        scope: 'FULL',
      }).expect(201);

      await as(repA.accessToken)
        .get(`/enterprises/${enterpriseId}`)
        .expect(404);
      const list = await as(repA.accessToken).get('/enterprises').expect(200);
      expect(list.body.map((e: { id: string }) => e.id)).not.toContain(
        enterpriseId,
      );
      for (const route of ['view', 'prepare', 'full']) {
        await testRoute(enterpriseId, route, repA).expect(404);
      }
    });

    it('the representative sees the invitation (enterprise name and reference only) in their own list', async () => {
      const enterpriseId = await newEnterprise('pending-list');
      const granted = await grant(enterpriseId, {
        emailOrMobile: repA.user.email,
        scope: 'VIEW_ONLY',
      }).expect(201);

      const mine = await as(repA.accessToken)
        .get('/representative-authorisations')
        .expect(200);
      const invite = mine.body.find(
        (a: { id: string }) => a.id === granted.body.id,
      );
      expect(invite).toMatchObject({
        scope: 'VIEW_ONLY',
        status: 'PENDING',
        authorisedAt: null,
      });
      expect(Object.keys(invite.enterprise).sort()).toEqual([
        'id',
        'name',
        'referenceNumber',
      ]);
      expect(JSON.stringify(invite)).not.toContain(owner.user.id);

      const strangers = await as(stranger.accessToken)
        .get('/representative-authorisations')
        .expect(200);
      expect(strangers.body.map((a: { id: string }) => a.id)).not.toContain(
        granted.body.id,
      );
    });

    it('only the named representative can accept: anyone else (even the owner) gets 404 and the record stays PENDING', async () => {
      const enterpriseId = await newEnterprise('accept-authz');
      const granted = await grant(enterpriseId, {
        emailOrMobile: repA.user.email,
        scope: 'FULL',
      }).expect(201);

      await accept(granted.body.id, stranger).expect(404);
      await accept(granted.body.id, owner).expect(404);
      await accept(granted.body.id, repB).expect(404);
      await request(ctx.http)
        .post(`${API}/representative-authorisations/${granted.body.id}/accept`)
        .expect(401);

      const row = await ctx.prisma.enterpriseRepresentative.findUniqueOrThrow({
        where: { id: granted.body.id },
      });
      expect(row.status).toBe('PENDING');
      expect(row.authorisedAt).toBeNull();
    });

    it('acceptance activates it, records authorisedAt, grants access and is audited under the representative', async () => {
      const enterpriseId = await newEnterprise('accept');
      const granted = await grant(enterpriseId, {
        emailOrMobile: repA.user.email,
        scope: 'PREPARE_SUBMIT',
      }).expect(201);

      const res = await accept(granted.body.id, repA).expect(200);
      expect(res.body).toMatchObject({
        status: 'ACTIVE',
        scope: 'PREPARE_SUBMIT',
      });
      expect(res.body.authorisedAt).not.toBeNull();

      const get = await as(repA.accessToken)
        .get(`/enterprises/${enterpriseId}`)
        .expect(200);
      expect(get.body).toMatchObject({
        id: enterpriseId,
        accessType: 'REPRESENTATIVE',
        representativeScope: 'PREPARE_SUBMIT',
      });
      expect(JSON.stringify(get.body)).not.toContain(owner.user.id);

      const list = await as(repA.accessToken).get('/enterprises').expect(200);
      expect(
        list.body.find((e: { id: string }) => e.id === enterpriseId),
      ).toMatchObject({
        accessType: 'REPRESENTATIVE',
        representativeScope: 'PREPARE_SUBMIT',
      });

      const rows = await auditRows(
        granted.body.id,
        'REPRESENTATIVE_AUTHORISATION_ACCEPTED',
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].userId).toBe(repA.user.id);
      expect(rows[0].beforeState).toMatchObject({ status: 'PENDING' });
      expect(rows[0].afterState).toMatchObject({ status: 'ACTIVE' });
    });

    it('accepting again is a 409 and changes nothing', async () => {
      const enterpriseId = await newEnterprise('accept-twice');
      const authId = await activate(enterpriseId, repA, 'VIEW_ONLY');
      const res = await accept(authId, repA).expect(409);
      expect(res.body.error.code).toBe('AUTHORISATION_ALREADY_ACTIVE');
      expect(
        await auditRows(authId, 'REPRESENTATIVE_AUTHORISATION_ACCEPTED'),
      ).toHaveLength(1);
    });

    it('acceptance takes no body: it cannot be used to choose or change the scope', async () => {
      const enterpriseId = await newEnterprise('accept-body');
      const granted = await grant(enterpriseId, {
        emailOrMobile: repA.user.email,
        scope: 'VIEW_ONLY',
      }).expect(201);
      await accept(granted.body.id, repA)
        .send({ scope: 'FULL', status: 'ACTIVE' })
        .expect(200);
      const row = await ctx.prisma.enterpriseRepresentative.findUniqueOrThrow({
        where: { id: granted.body.id },
      });
      expect(row.scope).toBe('VIEW_ONLY');
    });

    it('a malformed authorisation id is a 400, an unknown one a 404', async () => {
      await as(repA.accessToken)
        .post('/representative-authorisations/not-a-uuid/accept')
        .expect(400);
      await accept(randomUUID(), repA).expect(404);
    });
  });

  // -----------------------------------------------------------------------
  describe('scopes enforced on enterprise operations (FRD §20.3)', () => {
    const expected: Record<
      Scope,
      Record<'view' | 'prepare' | 'full' | 'owner', number>
    > = {
      VIEW_ONLY: { view: 200, prepare: 403, full: 403, owner: 403 },
      PREPARE_SUBMIT: { view: 200, prepare: 200, full: 403, owner: 403 },
      FULL: { view: 200, prepare: 200, full: 200, owner: 403 },
    };

    it.each(['VIEW_ONLY', 'PREPARE_SUBMIT', 'FULL'] as Scope[])(
      'a %s representative can do exactly what that scope allows — and never an owner-only operation',
      async (scope) => {
        const enterpriseId = await newEnterprise(`scope-${scope}`);
        await activate(enterpriseId, repA, scope);

        for (const [route, status] of Object.entries(expected[scope])) {
          const res = await testRoute(enterpriseId, route, repA);
          expect({ route, status: res.status }).toEqual({ route, status });
          if (status === 403) {
            expect(res.body.error.code).toBe('FORBIDDEN_SCOPE');
          }
        }
      },
    );

    it('the owner passes every level, including OWNER; a stranger passes none (404)', async () => {
      const enterpriseId = await newEnterprise('scope-owner');
      for (const route of ['view', 'prepare', 'full', 'owner']) {
        await testRoute(enterpriseId, route, owner).expect(200);
        await testRoute(enterpriseId, route, stranger).expect(404);
      }
    });

    it('a representative’s authorisation applies only to the enterprise it was granted for', async () => {
      const granted = await newEnterprise('scope-iso-a');
      const other = await newEnterprise('scope-iso-b');
      await activate(granted, repA, 'FULL');
      await testRoute(granted, 'full', repA).expect(200);
      await testRoute(other, 'view', repA).expect(404);
      await as(repA.accessToken).get(`/enterprises/${other}`).expect(404);
    });

    it('a project-restricted authorisation covers only its projects; the enterprise itself stays viewable', async () => {
      const enterpriseId = await newEnterprise('scope-project');
      const inScope = await ctx.createProject(enterpriseId, 'in');
      const outOfScope = await ctx.createProject(enterpriseId, 'out');
      await activate(enterpriseId, repA, 'PREPARE_SUBMIT', {
        projectIds: [inScope],
      });

      await testRoute(enterpriseId, 'view', repA).expect(200);
      await testRoute(enterpriseId, 'prepare', repA).expect(403);
      await testRoute(enterpriseId, `project/${inScope}/prepare`, repA).expect(
        200,
      );
      await testRoute(enterpriseId, `project/${inScope}/view`, repA).expect(
        200,
      );
      const denied = await testRoute(
        enterpriseId,
        `project/${outOfScope}/prepare`,
        repA,
      ).expect(403);
      expect(denied.body.error.code).toBe('FORBIDDEN_SCOPE');
      await testRoute(enterpriseId, `project/${outOfScope}/view`, repA).expect(
        403,
      );
      // The owner is never restricted.
      await testRoute(
        enterpriseId,
        `project/${outOfScope}/prepare`,
        owner,
      ).expect(200);
    });
  });

  // -----------------------------------------------------------------------
  describe('a representative can never escalate or delegate (FRD §20.3)', () => {
    it('even a FULL representative cannot edit the enterprise profile', async () => {
      const enterpriseId = await newEnterprise('esc-profile');
      await activate(enterpriseId, repA, 'FULL');
      const res = await as(repA.accessToken)
        .put(`/enterprises/${enterpriseId}`)
        .send({ name: 'Taken Over Ltd' })
        .expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN_SCOPE');
      const row = await ctx.prisma.enterprise.findUniqueOrThrow({
        where: { id: enterpriseId },
      });
      expect(row.name).not.toBe('Taken Over Ltd');
      expect(await auditRows(enterpriseId, 'ENTERPRISE_UPDATED')).toHaveLength(
        0,
      );
    });

    it('a FULL representative cannot authorise anyone — another user or themselves — nor list, change or revoke authorisations', async () => {
      const enterpriseId = await newEnterprise('esc-delegate');
      const authId = await activate(enterpriseId, repA, 'FULL');

      const forOther = await grant(
        enterpriseId,
        { emailOrMobile: repB.user.email, scope: 'FULL' },
        repA,
      ).expect(403);
      expect(forOther.body.error.code).toBe('FORBIDDEN_SCOPE');
      await grant(
        enterpriseId,
        { emailOrMobile: repA.user.email, scope: 'FULL' },
        repA,
      ).expect(403);
      await as(repA.accessToken)
        .get(`/enterprises/${enterpriseId}/representatives`)
        .expect(403);
      await as(repA.accessToken)
        .patch(`/enterprises/${enterpriseId}/representatives/${authId}`)
        .send({ scope: 'FULL' })
        .expect(403);
      await as(repA.accessToken)
        .del(`/enterprises/${enterpriseId}/representatives/${authId}`)
        .expect(403);

      expect(
        await ctx.prisma.enterpriseRepresentative.count({
          where: { enterpriseId },
        }),
      ).toBe(1);
      // repB never gained access.
      await as(repB.accessToken)
        .get(`/enterprises/${enterpriseId}`)
        .expect(404);
    });

    it('a VIEW_ONLY representative cannot raise their own scope, by any route', async () => {
      const enterpriseId = await newEnterprise('esc-scope');
      const authId = await activate(enterpriseId, repA, 'VIEW_ONLY');

      await as(repA.accessToken)
        .patch(`/enterprises/${enterpriseId}/representatives/${authId}`)
        .send({ scope: 'FULL' })
        .expect(403);
      // Accepting again is not a way to change it either.
      await accept(authId, repA).send({ scope: 'FULL' }).expect(409);

      const row = await ctx.prisma.enterpriseRepresentative.findUniqueOrThrow({
        where: { id: authId },
      });
      expect(row.scope).toBe('VIEW_ONLY');
      await testRoute(enterpriseId, 'prepare', repA).expect(403);
    });

    it('a PENDING representative cannot use owner endpoints either (no relationship = 404)', async () => {
      const enterpriseId = await newEnterprise('esc-pending');
      await grant(enterpriseId, {
        emailOrMobile: repA.user.email,
        scope: 'FULL',
      }).expect(201);
      await as(repA.accessToken)
        .get(`/enterprises/${enterpriseId}/representatives`)
        .expect(404);
      await grant(
        enterpriseId,
        { emailOrMobile: repB.user.email, scope: 'FULL' },
        repA,
      ).expect(404);
    });

    it('a user who owns their own enterprise gains nothing over someone else’s by owning one', async () => {
      const mine = await newEnterprise('esc-own-a', owner2);
      const theirs = await newEnterprise('esc-own-b', owner);
      await as(owner2.accessToken).get(`/enterprises/${mine}`).expect(200);
      await as(owner2.accessToken).get(`/enterprises/${theirs}`).expect(404);
      await grant(
        theirs,
        { emailOrMobile: repA.user.email, scope: 'FULL' },
        owner2,
      ).expect(404);
    });

    it('an authorisation id from another enterprise cannot be read, changed or revoked through this enterprise’s URL', async () => {
      const enterpriseA = await newEnterprise('esc-cross-a');
      const enterpriseB = await newEnterprise('esc-cross-b');
      const authOfB = await activate(enterpriseB, repA, 'FULL');

      await as(owner.accessToken)
        .patch(`/enterprises/${enterpriseA}/representatives/${authOfB}`)
        .send({ scope: 'VIEW_ONLY' })
        .expect(404);
      await as(owner.accessToken)
        .del(`/enterprises/${enterpriseA}/representatives/${authOfB}`)
        .expect(404);
      const row = await ctx.prisma.enterpriseRepresentative.findUniqueOrThrow({
        where: { id: authOfB },
      });
      expect(row).toMatchObject({ scope: 'FULL', status: 'ACTIVE' });
    });

    it('another owner cannot manage this enterprise’s representatives', async () => {
      const enterpriseId = await newEnterprise('esc-owner2');
      const authId = await activate(enterpriseId, repA, 'FULL');
      await as(owner2.accessToken)
        .get(`/enterprises/${enterpriseId}/representatives`)
        .expect(404);
      await as(owner2.accessToken)
        .del(`/enterprises/${enterpriseId}/representatives/${authId}`)
        .expect(404);
      await testRoute(enterpriseId, 'full', repA).expect(200);
    });
  });

  // -----------------------------------------------------------------------
  describe('owner listing and changing authorisations (GET/PATCH)', () => {
    it('the owner lists every authorisation with its status and expiry flag', async () => {
      const enterpriseId = await newEnterprise('list');
      await activate(enterpriseId, repA, 'FULL');
      await grant(enterpriseId, {
        emailOrMobile: repB.user.email,
        scope: 'VIEW_ONLY',
      }).expect(201);

      const res = await as(owner.accessToken)
        .get(`/enterprises/${enterpriseId}/representatives`)
        .expect(200);
      expect(res.body).toHaveLength(2);
      expect(res.body.map((r: { status: string }) => r.status).sort()).toEqual([
        'ACTIVE',
        'PENDING',
      ]);
      expect(JSON.stringify(res.body)).not.toContain(repA.user.email);
    });

    it('raising the scope of an ACTIVE authorisation requires re-acceptance: access stops until the representative accepts again', async () => {
      const enterpriseId = await newEnterprise('patch-up');
      const authId = await activate(enterpriseId, repA, 'VIEW_ONLY');
      await testRoute(enterpriseId, 'prepare', repA).expect(403);

      const patched = await as(owner.accessToken)
        .patch(`/enterprises/${enterpriseId}/representatives/${authId}`)
        .send({ scope: 'FULL' })
        .expect(200);
      expect(patched.body).toMatchObject({
        scope: 'FULL',
        status: 'PENDING',
        authorisedAt: null,
      });

      // The upgrade is not usable — and the existing access is suspended too.
      await as(repA.accessToken)
        .get(`/enterprises/${enterpriseId}`)
        .expect(404);
      await testRoute(enterpriseId, 'full', repA).expect(404);

      await accept(authId, repA).expect(200);
      await testRoute(enterpriseId, 'full', repA).expect(200);

      const updates = await auditRows(
        authId,
        'REPRESENTATIVE_AUTHORISATION_UPDATED',
      );
      expect(updates).toHaveLength(1);
      expect(updates[0].userId).toBe(owner.user.id);
      expect(updates[0].beforeState).toMatchObject({
        scope: 'VIEW_ONLY',
        status: 'ACTIVE',
      });
      expect(updates[0].afterState).toMatchObject({
        scope: 'FULL',
        status: 'PENDING',
        requiresReAcceptance: true,
      });
    });

    it('reducing the scope takes effect immediately without re-acceptance', async () => {
      const enterpriseId = await newEnterprise('patch-down');
      const authId = await activate(enterpriseId, repA, 'FULL');
      await testRoute(enterpriseId, 'full', repA).expect(200);

      const patched = await as(owner.accessToken)
        .patch(`/enterprises/${enterpriseId}/representatives/${authId}`)
        .send({ scope: 'VIEW_ONLY' })
        .expect(200);
      expect(patched.body).toMatchObject({
        scope: 'VIEW_ONLY',
        status: 'ACTIVE',
      });
      await testRoute(enterpriseId, 'full', repA).expect(403);
      await testRoute(enterpriseId, 'view', repA).expect(200);
    });

    it('widening the project list also requires re-acceptance; narrowing does not', async () => {
      const enterpriseId = await newEnterprise('patch-projects');
      const p1 = await ctx.createProject(enterpriseId, 'p1');
      const p2 = await ctx.createProject(enterpriseId, 'p2');
      const authId = await activate(enterpriseId, repA, 'PREPARE_SUBMIT', {
        projectIds: [p1],
      });
      const url = `/enterprises/${enterpriseId}/representatives/${authId}`;

      const widened = await as(owner.accessToken)
        .patch(url)
        .send({ projectIds: [p1, p2] })
        .expect(200);
      expect(widened.body.status).toBe('PENDING');
      await accept(authId, repA).expect(200);

      const narrowed = await as(owner.accessToken)
        .patch(url)
        .send({ projectIds: [p1] })
        .expect(200);
      expect(narrowed.body.status).toBe('ACTIVE');
      await testRoute(enterpriseId, `project/${p2}/prepare`, repA).expect(403);
    });

    it('rejects an empty PATCH, a foreign project id and a past expiry', async () => {
      const enterpriseId = await newEnterprise('patch-invalid');
      const authId = await activate(enterpriseId, repA, 'VIEW_ONLY');
      const url = `/enterprises/${enterpriseId}/representatives/${authId}`;
      const foreignProject = await ctx.createProject(
        await newEnterprise('patch-foreign', owner2),
      );

      await as(owner.accessToken).patch(url).send({}).expect(400);
      await as(owner.accessToken)
        .patch(url)
        .send({ scope: 'NOPE' })
        .expect(400);
      await as(owner.accessToken)
        .patch(url)
        .send({ status: 'ACTIVE' })
        .expect(400);
      const proj = await as(owner.accessToken)
        .patch(url)
        .send({ projectIds: [foreignProject] })
        .expect(400);
      expect(proj.body.error.code).toBe('INVALID_PROJECT_SCOPE');
      const past = await as(owner.accessToken)
        .patch(url)
        .send({ expiresAt: new Date(Date.now() - 1000).toISOString() })
        .expect(400);
      expect(past.body.error.code).toBe('INVALID_EXPIRY');
    });

    it('sets and removes an expiry without disturbing an accepted authorisation', async () => {
      const enterpriseId = await newEnterprise('patch-expiry');
      const authId = await activate(enterpriseId, repA, 'FULL');
      const url = `/enterprises/${enterpriseId}/representatives/${authId}`;
      const expiresAt = new Date(Date.now() + 86_400_000).toISOString();

      const set = await as(owner.accessToken)
        .patch(url)
        .send({ expiresAt })
        .expect(200);
      expect(set.body).toMatchObject({ status: 'ACTIVE', expiresAt });
      const cleared = await as(owner.accessToken)
        .patch(url)
        .send({ expiresAt: null })
        .expect(200);
      expect(cleared.body).toMatchObject({ status: 'ACTIVE', expiresAt: null });
      await testRoute(enterpriseId, 'full', repA).expect(200);
    });
  });

  // -----------------------------------------------------------------------
  describe('expiry', () => {
    it('an authorisation stops working the moment it expires, with no status change, and is reported as expired', async () => {
      const enterpriseId = await newEnterprise('expiry-active');
      const authId = await activate(enterpriseId, repA, 'FULL', {
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      });
      await testRoute(enterpriseId, 'full', repA).expect(200);

      // Time passes: move the expiry into the past directly in the database.
      await ctx.prisma.enterpriseRepresentative.update({
        where: { id: authId },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      await as(repA.accessToken)
        .get(`/enterprises/${enterpriseId}`)
        .expect(404);
      await testRoute(enterpriseId, 'view', repA).expect(404);
      const list = await as(repA.accessToken).get('/enterprises').expect(200);
      expect(list.body.map((e: { id: string }) => e.id)).not.toContain(
        enterpriseId,
      );

      const owners = await as(owner.accessToken)
        .get(`/enterprises/${enterpriseId}/representatives`)
        .expect(200);
      expect(
        owners.body.find((r: { id: string }) => r.id === authId),
      ).toMatchObject({ status: 'ACTIVE', isExpired: true });
      // Owner access is unaffected.
      await as(owner.accessToken)
        .get(`/enterprises/${enterpriseId}`)
        .expect(200);
    });

    it('a PENDING authorisation that expires can no longer be accepted', async () => {
      const enterpriseId = await newEnterprise('expiry-pending');
      const granted = await grant(enterpriseId, {
        emailOrMobile: repA.user.email,
        scope: 'FULL',
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      }).expect(201);
      await ctx.prisma.enterpriseRepresentative.update({
        where: { id: granted.body.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      const res = await accept(granted.body.id, repA).expect(409);
      expect(res.body.error.code).toBe('AUTHORISATION_EXPIRED');
      await as(repA.accessToken)
        .get(`/enterprises/${enterpriseId}`)
        .expect(404);
    });

    it('an expired authorisation does not block granting the same person again', async () => {
      const enterpriseId = await newEnterprise('expiry-regrant');
      const authId = await activate(enterpriseId, repA, 'VIEW_ONLY', {
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      });
      await ctx.prisma.enterpriseRepresentative.update({
        where: { id: authId },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      const again = await grant(enterpriseId, {
        emailOrMobile: repA.user.email,
        scope: 'PREPARE_SUBMIT',
      }).expect(201);
      expect(again.body.id).not.toBe(authId);
      await accept(again.body.id, repA).expect(200);
      await testRoute(enterpriseId, 'prepare', repA).expect(200);
    });

    it('extending the expiry of an expired authorisation restores access', async () => {
      const enterpriseId = await newEnterprise('expiry-extend');
      const authId = await activate(enterpriseId, repA, 'VIEW_ONLY', {
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      });
      await ctx.prisma.enterpriseRepresentative.update({
        where: { id: authId },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      await testRoute(enterpriseId, 'view', repA).expect(404);

      await as(owner.accessToken)
        .patch(`/enterprises/${enterpriseId}/representatives/${authId}`)
        .send({ expiresAt: new Date(Date.now() + 86_400_000).toISOString() })
        .expect(200);
      await testRoute(enterpriseId, 'view', repA).expect(200);
    });
  });

  // -----------------------------------------------------------------------
  describe('revocation (DELETE /enterprises/:id/representatives/:repId)', () => {
    it('takes effect immediately, keeps the record as REVOKED, and audits it', async () => {
      const enterpriseId = await newEnterprise('revoke');
      const authId = await activate(enterpriseId, repA, 'FULL');
      await testRoute(enterpriseId, 'full', repA).expect(200);

      const res = await as(owner.accessToken)
        .del(`/enterprises/${enterpriseId}/representatives/${authId}`)
        .expect(200);
      expect(res.body).toMatchObject({ id: authId, status: 'REVOKED' });
      expect(res.body.revokedAt).not.toBeNull();

      // The very next request — with the same still-valid access token — is refused.
      await as(repA.accessToken)
        .get(`/enterprises/${enterpriseId}`)
        .expect(404);
      await testRoute(enterpriseId, 'view', repA).expect(404);
      const list = await as(repA.accessToken).get('/enterprises').expect(200);
      expect(list.body.map((e: { id: string }) => e.id)).not.toContain(
        enterpriseId,
      );
      const mine = await as(repA.accessToken)
        .get('/representative-authorisations')
        .expect(200);
      expect(mine.body.map((a: { id: string }) => a.id)).not.toContain(authId);

      const row = await ctx.prisma.enterpriseRepresentative.findUniqueOrThrow({
        where: { id: authId },
      });
      expect(row.status).toBe('REVOKED');

      const rows = await auditRows(
        authId,
        'REPRESENTATIVE_AUTHORISATION_REVOKED',
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].userId).toBe(owner.user.id);
      expect(rows[0].beforeState).toMatchObject({ status: 'ACTIVE' });
      expect(rows[0].afterState).toMatchObject({ status: 'REVOKED' });
    });

    it('is idempotent: a second revoke succeeds and adds no second audit entry', async () => {
      const enterpriseId = await newEnterprise('revoke-twice');
      const authId = await activate(enterpriseId, repA, 'VIEW_ONLY');
      const url = `/enterprises/${enterpriseId}/representatives/${authId}`;
      const first = await as(owner.accessToken).del(url).expect(200);
      const second = await as(owner.accessToken).del(url).expect(200);
      expect(second.body.revokedAt).toBe(first.body.revokedAt);
      expect(
        await auditRows(authId, 'REPRESENTATIVE_AUTHORISATION_REVOKED'),
      ).toHaveLength(1);
    });

    it('a revoked authorisation cannot be accepted or changed — reviving one needs a fresh grant', async () => {
      const enterpriseId = await newEnterprise('revoke-final');
      const granted = await grant(enterpriseId, {
        emailOrMobile: repA.user.email,
        scope: 'FULL',
      }).expect(201);
      const url = `/enterprises/${enterpriseId}/representatives/${granted.body.id}`;
      await as(owner.accessToken).del(url).expect(200);

      const acc = await accept(granted.body.id, repA).expect(409);
      expect(acc.body.error.code).toBe('AUTHORISATION_REVOKED');
      const upd = await as(owner.accessToken)
        .patch(url)
        .send({ scope: 'VIEW_ONLY' })
        .expect(409);
      expect(upd.body.error.code).toBe('AUTHORISATION_REVOKED');
      await as(repA.accessToken)
        .get(`/enterprises/${enterpriseId}`)
        .expect(404);

      // A brand-new grant is allowed and starts from PENDING again.
      const fresh = await grant(enterpriseId, {
        emailOrMobile: repA.user.email,
        scope: 'VIEW_ONLY',
      }).expect(201);
      expect(fresh.body.id).not.toBe(granted.body.id);
      expect(fresh.body.status).toBe('PENDING');
      await as(repA.accessToken)
        .get(`/enterprises/${enterpriseId}`)
        .expect(404);
      await accept(fresh.body.id, repA).expect(200);
      await as(repA.accessToken)
        .get(`/enterprises/${enterpriseId}`)
        .expect(200);
    });

    it('revoking one representative leaves others untouched', async () => {
      const enterpriseId = await newEnterprise('revoke-isolated');
      const authA = await activate(enterpriseId, repA, 'FULL');
      await activate(enterpriseId, repB, 'VIEW_ONLY');
      await as(owner.accessToken)
        .del(`/enterprises/${enterpriseId}/representatives/${authA}`)
        .expect(200);
      await testRoute(enterpriseId, 'view', repA).expect(404);
      await testRoute(enterpriseId, 'view', repB).expect(200);
    });

    it('only the owner can revoke; unknown ids are 404 and malformed ids 400', async () => {
      const enterpriseId = await newEnterprise('revoke-authz');
      const authId = await activate(enterpriseId, repA, 'FULL');
      await request(ctx.http)
        .delete(`${API}/enterprises/${enterpriseId}/representatives/${authId}`)
        .expect(401);
      await as(stranger.accessToken)
        .del(`/enterprises/${enterpriseId}/representatives/${authId}`)
        .expect(404);
      await as(owner.accessToken)
        .del(`/enterprises/${enterpriseId}/representatives/${randomUUID()}`)
        .expect(404);
      await as(owner.accessToken)
        .del(`/enterprises/${enterpriseId}/representatives/not-a-uuid`)
        .expect(400);
      const row = await ctx.prisma.enterpriseRepresentative.findUniqueOrThrow({
        where: { id: authId },
      });
      expect(row.status).toBe('ACTIVE');
    });

    it('revoking a PENDING invitation stops it from ever being accepted', async () => {
      const enterpriseId = await newEnterprise('revoke-pending');
      const granted = await grant(enterpriseId, {
        emailOrMobile: repA.user.email,
        scope: 'FULL',
      }).expect(201);
      await as(owner.accessToken)
        .del(`/enterprises/${enterpriseId}/representatives/${granted.body.id}`)
        .expect(200);
      await accept(granted.body.id, repA).expect(409);
      const mine = await as(repA.accessToken)
        .get('/representative-authorisations')
        .expect(200);
      expect(mine.body.map((a: { id: string }) => a.id)).not.toContain(
        granted.body.id,
      );
    });
  });

  // -----------------------------------------------------------------------
  describe('secrets and audit hygiene', () => {
    it('no enterprise/representative audit row contains credentials, tokens or secrets', async () => {
      const rows = await ctx.prisma.auditLog.findMany({
        where: {
          userId: { in: [owner.user.id, repA.user.id, repB.user.id] },
          action: {
            in: [
              'ENTERPRISE_CREATED',
              'ENTERPRISE_UPDATED',
              'REPRESENTATIVE_AUTHORISED',
              'REPRESENTATIVE_AUTHORISATION_ACCEPTED',
              'REPRESENTATIVE_AUTHORISATION_UPDATED',
              'REPRESENTATIVE_AUTHORISATION_REVOKED',
            ],
          },
        },
      });
      expect(rows.length).toBeGreaterThan(10);
      for (const row of rows) {
        expect(JSON.stringify(row).toLowerCase()).not.toMatch(
          /password|secret|token|hash|otpauth/,
        );
        expect(row.ipAddress).toBeTruthy();
      }
    });

    it('representative endpoints appear in Swagger with bearer auth', async () => {
      const { body } = await request(ctx.http)
        .get('/api/docs-json')
        .expect(200);
      const ops: Array<[string, string]> = [
        [`${API}/enterprises/{enterpriseId}/representatives`, 'post'],
        [`${API}/enterprises/{enterpriseId}/representatives`, 'get'],
        [
          `${API}/enterprises/{enterpriseId}/representatives/{representativeId}`,
          'patch',
        ],
        [
          `${API}/enterprises/{enterpriseId}/representatives/{representativeId}`,
          'delete',
        ],
        [`${API}/representative-authorisations`, 'get'],
        [
          `${API}/representative-authorisations/{authorisationId}/accept`,
          'post',
        ],
      ];
      for (const [path, method] of ops) {
        expect(body.paths[path][method].security).toBeDefined();
      }
    });
  });
});
