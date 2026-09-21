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
 * Who may do what to projects, through the EXISTING EnterpriseAccessGuard
 * (Step 5) — no second authorisation system. Real HTTP -> Nest -> Prisma ->
 * PostgreSQL. Rules under test:
 *   read  (list/get)   : owner, or any live representative scope
 *   write (create/put) : owner, or a live FULL representative
 *                        (PROJECT_WRITE_LEVEL; FRD §20.3 gives Prepare & Submit
 *                        application-level powers only)
 *   PENDING / REVOKED / expired authorisations: nothing (404)
 *   project-restricted representatives: only their listed projects; they can
 *   never create new ones
 */
describe('Projects e2e — representative access, scopes and restrictions', () => {
  let ctx: E2eContext;
  let owner: Actor;
  let owner2: Actor;
  let repFull: Actor;
  let repPrepare: Actor;
  let repView: Actor;
  let repRestricted: Actor;
  let stranger: Actor;

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

  /** An enterprise owned by `owner` with two projects, created over HTTP. */
  const setup = async (tag: string, by: Actor = owner) => {
    const enterpriseId = (await ctx.createEnterprise(by.accessToken, tag)).id;
    const p1 = (
      await ctx.createProjectVia(by.accessToken, enterpriseId, `${tag}-1`)
    ).id;
    const p2 = (
      await ctx.createProjectVia(by.accessToken, enterpriseId, `${tag}-2`)
    ).id;
    return { enterpriseId, p1, p2 };
  };

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

  const listUrl = (e: string) => `/enterprises/${e}/projects`;
  const oneUrl = (e: string, p: string) => `/enterprises/${e}/projects/${p}`;
  const projectAudit = (entityId: string, action: string) =>
    ctx.prisma.auditLog.findMany({ where: { entityId, action } });

  beforeAll(async () => {
    ctx = await createE2eContext();
    [owner, owner2, repFull, repPrepare, repView, repRestricted, stranger] =
      await Promise.all([
        ctx.applicantSession('pa-owner'),
        ctx.applicantSession('pa-owner2'),
        ctx.applicantSession('pa-full'),
        ctx.applicantSession('pa-prepare'),
        ctx.applicantSession('pa-view'),
        ctx.applicantSession('pa-restricted'),
        ctx.applicantSession('pa-stranger'),
      ]);
  });

  afterAll(async () => {
    await ctx.cleanup();
    await ctx.app.close();
  });

  // -------------------------------------------------------------------------
  describe('scope × operation', () => {
    const rep = (scope: Scope) =>
      ({ VIEW_ONLY: repView, PREPARE_SUBMIT: repPrepare, FULL: repFull })[
        scope
      ];
    const expected: Record<
      Scope,
      { list: number; get: number; create: number; update: number }
    > = {
      VIEW_ONLY: { list: 200, get: 200, create: 403, update: 403 },
      PREPARE_SUBMIT: { list: 200, get: 200, create: 403, update: 403 },
      FULL: { list: 200, get: 200, create: 201, update: 200 },
    };

    it.each(['VIEW_ONLY', 'PREPARE_SUBMIT', 'FULL'] as Scope[])(
      'a %s representative can do exactly what that scope allows on projects',
      async (scope) => {
        const { enterpriseId, p1 } = await setup(`matrix-${scope}`);
        const actor = rep(scope);
        await activate(enterpriseId, actor, scope);
        const want = expected[scope];

        const list = await as(actor.accessToken).get(listUrl(enterpriseId));
        expect(list.status).toBe(want.list);
        expect(list.body).toHaveLength(2);

        expect(
          (await as(actor.accessToken).get(oneUrl(enterpriseId, p1))).status,
        ).toBe(want.get);

        const create = await as(actor.accessToken)
          .post(listUrl(enterpriseId))
          .send(ctx.projectPayload('rep-create'));
        expect(create.status).toBe(want.create);
        if (create.status === 201) {
          ctx.projectIds.push(create.body.id);
        } else {
          expect(create.body.error.code).toBe('FORBIDDEN_SCOPE');
        }

        const update = await as(actor.accessToken)
          .put(oneUrl(enterpriseId, p1))
          .send({ employmentCount: 77 });
        expect(update.status).toBe(want.update);
        if (update.status !== 200) {
          expect(update.body.error.code).toBe('FORBIDDEN_SCOPE');
        }

        // Denied writes changed nothing.
        const row = await ctx.prisma.project.findUniqueOrThrow({
          where: { id: p1 },
        });
        expect(row.employmentCount).toBe(want.update === 200 ? 77 : 40);
        const created = await ctx.prisma.project.count({
          where: { enterpriseId },
        });
        expect(created).toBe(want.create === 201 ? 3 : 2);
      },
    );

    it('the owner has full access to the same operations', async () => {
      const { enterpriseId, p1 } = await setup('owner-all');
      await as(owner.accessToken).get(listUrl(enterpriseId)).expect(200);
      await as(owner.accessToken).get(oneUrl(enterpriseId, p1)).expect(200);
      await as(owner.accessToken)
        .put(oneUrl(enterpriseId, p1))
        .send({ employmentCount: 12 })
        .expect(200);
      const created = await ctx.createProjectVia(
        owner.accessToken,
        enterpriseId,
        'owner-new',
      );
      expect(created.body.enterpriseId).toBe(enterpriseId);
    });

    it('a denied VIEW_ONLY write leaves no audit trail and no partial change', async () => {
      const { enterpriseId, p1 } = await setup('denied-audit');
      await activate(enterpriseId, repView, 'VIEW_ONLY');
      await as(repView.accessToken)
        .put(oneUrl(enterpriseId, p1))
        .send({ name: 'Renamed By Viewer' })
        .expect(403);
      expect(await projectAudit(p1, 'PROJECT_UPDATED')).toHaveLength(0);
      const row = await ctx.prisma.project.findUniqueOrThrow({
        where: { id: p1 },
      });
      expect(row.name).not.toBe('Renamed By Viewer');
    });
  });

  // -------------------------------------------------------------------------
  describe('FULL representative writes are attributed to the representative (FRD §20.5)', () => {
    it('creating a project as a representative: project belongs to the enterprise, audit names the representative and the enterprise', async () => {
      const { enterpriseId } = await setup('full-create');
      await activate(enterpriseId, repFull, 'FULL');

      const res = await as(repFull.accessToken)
        .post(listUrl(enterpriseId))
        .send(ctx.projectPayload('by-rep'))
        .expect(201);
      ctx.projectIds.push(res.body.id);
      expect(res.body.enterpriseId).toBe(enterpriseId);

      // The owner sees it exactly as if they had created it.
      const ownersView = await as(owner.accessToken)
        .get(oneUrl(enterpriseId, res.body.id))
        .expect(200);
      expect(ownersView.body.name).toBe(res.body.name);

      const rows = await projectAudit(res.body.id, 'PROJECT_CREATED');
      expect(rows).toHaveLength(1);
      expect(rows[0].userId).toBe(repFull.user.id);
      expect(rows[0].afterState).toMatchObject({
        enterpriseId,
        actingAs: 'REPRESENTATIVE',
      });
    });

    it('updating as a representative is audited with the representative as actor and the previous values', async () => {
      const { enterpriseId, p1 } = await setup('full-update');
      await activate(enterpriseId, repFull, 'FULL');

      await as(repFull.accessToken)
        .put(oneUrl(enterpriseId, p1))
        .send({ employmentCount: 90 })
        .expect(200);
      const rows = await projectAudit(p1, 'PROJECT_UPDATED');
      expect(rows).toHaveLength(1);
      expect(rows[0].userId).toBe(repFull.user.id);
      expect(rows[0].beforeState).toEqual({ employmentCount: 40 });
      expect(rows[0].afterState).toEqual({
        employmentCount: 90,
        enterpriseId,
        actingAs: 'REPRESENTATIVE',
      });
    });

    it('a representative’s body cannot redirect the project to another enterprise or owner', async () => {
      const { enterpriseId } = await setup('full-redirect');
      const foreign = await setup('full-redirect-foreign', owner2);
      await activate(enterpriseId, repFull, 'FULL');

      for (const extra of [
        { enterpriseId: foreign.enterpriseId },
        { ownerUserId: repFull.user.id },
      ]) {
        await as(repFull.accessToken)
          .post(listUrl(enterpriseId))
          .send(ctx.projectPayload('redirect', extra))
          .expect(400);
      }
      expect(
        await ctx.prisma.project.count({
          where: { enterpriseId: foreign.enterpriseId },
        }),
      ).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  describe('non-live authorisations grant no project access', () => {
    const expectNoAccess = async (
      actor: Actor,
      enterpriseId: string,
      p1: string,
    ) => {
      await as(actor.accessToken).get(listUrl(enterpriseId)).expect(404);
      await as(actor.accessToken).get(oneUrl(enterpriseId, p1)).expect(404);
      await as(actor.accessToken)
        .post(listUrl(enterpriseId))
        .send(ctx.projectPayload('nope'))
        .expect(404);
      await as(actor.accessToken)
        .put(oneUrl(enterpriseId, p1))
        .send({ employmentCount: 1 })
        .expect(404);
      expect(await ctx.prisma.project.count({ where: { enterpriseId } })).toBe(
        2,
      );
      const row = await ctx.prisma.project.findUniqueOrThrow({
        where: { id: p1 },
      });
      expect(row.employmentCount).toBe(40);
    };

    it('PENDING (not yet accepted)', async () => {
      const { enterpriseId, p1 } = await setup('pending');
      await grant(enterpriseId, {
        emailOrMobile: repFull.user.email,
        scope: 'FULL',
      }).expect(201);
      await expectNoAccess(repFull, enterpriseId, p1);
    });

    it('REVOKED — immediately, with the same still-valid access token', async () => {
      const { enterpriseId, p1 } = await setup('revoked');
      const authId = await activate(enterpriseId, repFull, 'FULL');
      await as(repFull.accessToken).get(oneUrl(enterpriseId, p1)).expect(200);

      await as(owner.accessToken)
        .del(`/enterprises/${enterpriseId}/representatives/${authId}`)
        .expect(200);
      await expectNoAccess(repFull, enterpriseId, p1);
    });

    it('EXPIRED — access ends the moment the expiry passes', async () => {
      const { enterpriseId, p1 } = await setup('expired');
      const authId = await activate(enterpriseId, repFull, 'FULL', {
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      });
      await as(repFull.accessToken)
        .put(oneUrl(enterpriseId, p1))
        .send({ employmentCount: 41 })
        .expect(200);

      await ctx.prisma.enterpriseRepresentative.update({
        where: { id: authId },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      await as(repFull.accessToken).get(listUrl(enterpriseId)).expect(404);
      await as(repFull.accessToken).get(oneUrl(enterpriseId, p1)).expect(404);
      await as(repFull.accessToken)
        .post(listUrl(enterpriseId))
        .send(ctx.projectPayload('late'))
        .expect(404);
      await as(repFull.accessToken)
        .put(oneUrl(enterpriseId, p1))
        .send({ employmentCount: 42 })
        .expect(404);
      const row = await ctx.prisma.project.findUniqueOrThrow({
        where: { id: p1 },
      });
      expect(row.employmentCount).toBe(41);
    });

    it('a stranger with no authorisation at all', async () => {
      const { enterpriseId, p1 } = await setup('stranger');
      await expectNoAccess(stranger, enterpriseId, p1);
    });
  });

  // -------------------------------------------------------------------------
  describe('scope changes take effect on the very next request', () => {
    it('reducing FULL to VIEW_ONLY removes write access immediately but keeps read access', async () => {
      const { enterpriseId, p1 } = await setup('downgrade');
      const authId = await activate(enterpriseId, repFull, 'FULL');
      await as(repFull.accessToken)
        .put(oneUrl(enterpriseId, p1))
        .send({ employmentCount: 50 })
        .expect(200);

      await as(owner.accessToken)
        .patch(`/enterprises/${enterpriseId}/representatives/${authId}`)
        .send({ scope: 'VIEW_ONLY' })
        .expect(200);
      await as(repFull.accessToken)
        .put(oneUrl(enterpriseId, p1))
        .send({ employmentCount: 60 })
        .expect(403);
      await as(repFull.accessToken)
        .post(listUrl(enterpriseId))
        .send(ctx.projectPayload('after'))
        .expect(403);
      await as(repFull.accessToken).get(oneUrl(enterpriseId, p1)).expect(200);
    });

    it('raising VIEW_ONLY to FULL does nothing until the representative accepts again', async () => {
      const { enterpriseId, p1 } = await setup('upgrade');
      const authId = await activate(enterpriseId, repView, 'VIEW_ONLY');
      await as(owner.accessToken)
        .patch(`/enterprises/${enterpriseId}/representatives/${authId}`)
        .send({ scope: 'FULL' })
        .expect(200);

      // Re-consent pending: no access at all — the upgrade is not usable.
      await as(repView.accessToken)
        .put(oneUrl(enterpriseId, p1))
        .send({ employmentCount: 61 })
        .expect(404);
      await accept(authId, repView).expect(200);
      await as(repView.accessToken)
        .put(oneUrl(enterpriseId, p1))
        .send({ employmentCount: 61 })
        .expect(200);
    });
  });

  // -------------------------------------------------------------------------
  describe('project-restricted representatives', () => {
    it('a FULL representative restricted to one project sees and edits only that project, and cannot create new ones', async () => {
      const { enterpriseId, p1, p2 } = await setup('restricted-full');
      const foreign = await setup('restricted-foreign', owner2);
      await activate(enterpriseId, repRestricted, 'FULL', { projectIds: [p1] });

      // List is filtered to the authorised project.
      const list = await as(repRestricted.accessToken)
        .get(listUrl(enterpriseId))
        .expect(200);
      expect(list.body.map((p: { id: string }) => p.id)).toEqual([p1]);

      await as(repRestricted.accessToken)
        .get(oneUrl(enterpriseId, p1))
        .expect(200);
      await as(repRestricted.accessToken)
        .put(oneUrl(enterpriseId, p1))
        .send({ employmentCount: 88 })
        .expect(200);

      // Every other project — a sibling, another enterprise's, or one that does not
      // exist — gets the same 403, so nothing about existence leaks.
      const sibling = await as(repRestricted.accessToken)
        .get(oneUrl(enterpriseId, p2))
        .expect(403);
      const foreignProject = await as(repRestricted.accessToken)
        .get(oneUrl(enterpriseId, foreign.p1))
        .expect(403);
      const missing = await as(repRestricted.accessToken)
        .get(oneUrl(enterpriseId, randomUUID()))
        .expect(403);
      expect(sibling.body.error.code).toBe('FORBIDDEN_SCOPE');
      expect(foreignProject.body).toEqual(sibling.body);
      expect(missing.body).toEqual(sibling.body);
      await as(repRestricted.accessToken)
        .get(oneUrl(enterpriseId, 'not-a-uuid'))
        .expect(403);

      await as(repRestricted.accessToken)
        .put(oneUrl(enterpriseId, p2))
        .send({ employmentCount: 99 })
        .expect(403);
      await as(repRestricted.accessToken)
        .post(listUrl(enterpriseId))
        .send(ctx.projectPayload('new'))
        .expect(403);

      const siblingRow = await ctx.prisma.project.findUniqueOrThrow({
        where: { id: p2 },
      });
      expect(siblingRow.employmentCount).toBe(40);
      expect(await ctx.prisma.project.count({ where: { enterpriseId } })).toBe(
        2,
      );

      // The owner is never restricted.
      expect(
        (await as(owner.accessToken).get(listUrl(enterpriseId)).expect(200))
          .body,
      ).toHaveLength(2);
    });

    it('a VIEW_ONLY representative restricted to a project reads only that one and writes nothing', async () => {
      const { enterpriseId, p1, p2 } = await setup('restricted-view');
      await activate(enterpriseId, repView, 'VIEW_ONLY', { projectIds: [p2] });

      const list = await as(repView.accessToken)
        .get(listUrl(enterpriseId))
        .expect(200);
      expect(list.body.map((p: { id: string }) => p.id)).toEqual([p2]);
      await as(repView.accessToken).get(oneUrl(enterpriseId, p2)).expect(200);
      await as(repView.accessToken).get(oneUrl(enterpriseId, p1)).expect(403);
      await as(repView.accessToken)
        .put(oneUrl(enterpriseId, p2))
        .send({ employmentCount: 5 })
        .expect(403);
    });

    it('widening the project list needs re-acceptance; narrowing applies immediately', async () => {
      const { enterpriseId, p1, p2 } = await setup('restricted-widen');
      const authId = await activate(enterpriseId, repRestricted, 'FULL', {
        projectIds: [p1],
      });
      const url = `/enterprises/${enterpriseId}/representatives/${authId}`;

      await as(owner.accessToken)
        .patch(url)
        .send({ projectIds: [p1, p2] })
        .expect(200);
      await as(repRestricted.accessToken)
        .get(oneUrl(enterpriseId, p2))
        .expect(404); // PENDING again
      await accept(authId, repRestricted).expect(200);
      await as(repRestricted.accessToken)
        .get(oneUrl(enterpriseId, p2))
        .expect(200);

      await as(owner.accessToken)
        .patch(url)
        .send({ projectIds: [p1] })
        .expect(200);
      await as(repRestricted.accessToken)
        .get(oneUrl(enterpriseId, p2))
        .expect(403);
      await as(repRestricted.accessToken)
        .get(oneUrl(enterpriseId, p1))
        .expect(200);
    });

    it('restricting an authorisation to another enterprise’s project is refused when granting', async () => {
      const { enterpriseId } = await setup('restricted-grant');
      const foreign = await setup('restricted-grant-foreign', owner2);
      const res = await grant(enterpriseId, {
        emailOrMobile: repRestricted.user.email,
        scope: 'FULL',
        projectIds: [foreign.p1],
      }).expect(400);
      expect(res.body.error.code).toBe('INVALID_PROJECT_SCOPE');
    });
  });

  // -------------------------------------------------------------------------
  describe('cross-enterprise attempts', () => {
    it('a representative of one enterprise cannot reach another enterprise’s projects by any route', async () => {
      const mine = await setup('cross-mine');
      const theirs = await setup('cross-theirs', owner2);
      await activate(mine.enterpriseId, repFull, 'FULL');

      await as(repFull.accessToken)
        .get(listUrl(theirs.enterpriseId))
        .expect(404);
      await as(repFull.accessToken)
        .get(oneUrl(theirs.enterpriseId, theirs.p1))
        .expect(404);
      await as(repFull.accessToken)
        .post(listUrl(theirs.enterpriseId))
        .send(ctx.projectPayload('x'))
        .expect(404);
      await as(repFull.accessToken)
        .put(oneUrl(theirs.enterpriseId, theirs.p1))
        .send({ employmentCount: 1 })
        .expect(404);

      // Their project id smuggled under MY enterprise's URL is also just "not found".
      await as(repFull.accessToken)
        .get(oneUrl(mine.enterpriseId, theirs.p1))
        .expect(404);
      await as(repFull.accessToken)
        .put(oneUrl(mine.enterpriseId, theirs.p1))
        .send({ employmentCount: 1 })
        .expect(404);

      const row = await ctx.prisma.project.findUniqueOrThrow({
        where: { id: theirs.p1 },
      });
      expect(row).toMatchObject({
        employmentCount: 40,
        enterpriseId: theirs.enterpriseId,
      });
      expect(
        await ctx.prisma.project.count({
          where: { enterpriseId: theirs.enterpriseId },
        }),
      ).toBe(2);
    });

    it('the same person can be a FULL representative of one enterprise and only a stranger to another', async () => {
      const a = await setup('dual-a');
      const b = await setup('dual-b', owner2);
      await activate(a.enterpriseId, repFull, 'FULL');
      await as(repFull.accessToken)
        .put(oneUrl(a.enterpriseId, a.p1))
        .send({ employmentCount: 3 })
        .expect(200);
      await as(repFull.accessToken)
        .put(oneUrl(b.enterpriseId, b.p1))
        .send({ employmentCount: 3 })
        .expect(404);
    });
  });

  // -------------------------------------------------------------------------
  describe('no self-escalation, and Step 4/5 boundaries still hold', () => {
    it('a FULL representative cannot change the enterprise profile, manage representatives, or change their own scope', async () => {
      const { enterpriseId } = await setup('escalate');
      const authId = await activate(enterpriseId, repFull, 'FULL');

      await as(repFull.accessToken)
        .put(`/enterprises/${enterpriseId}`)
        .send({ name: 'Taken Over Ltd' })
        .expect(403);
      await grant(
        enterpriseId,
        { emailOrMobile: stranger.user.email, scope: 'FULL' },
        repFull,
      ).expect(403);
      await as(repFull.accessToken)
        .get(`/enterprises/${enterpriseId}/representatives`)
        .expect(403);
      await as(repFull.accessToken)
        .patch(`/enterprises/${enterpriseId}/representatives/${authId}`)
        .send({ projectIds: [] })
        .expect(403);
      await as(repFull.accessToken)
        .del(`/enterprises/${enterpriseId}/representatives/${authId}`)
        .expect(403);

      const enterprise = await ctx.prisma.enterprise.findUniqueOrThrow({
        where: { id: enterpriseId },
      });
      expect(enterprise.name).not.toBe('Taken Over Ltd');
      await as(stranger.accessToken).get(oneUrl(enterpriseId, 'x')).expect(404);
    });

    it('a VIEW_ONLY representative cannot raise their scope to gain project write access', async () => {
      const { enterpriseId, p1 } = await setup('escalate-view');
      const authId = await activate(enterpriseId, repView, 'VIEW_ONLY');
      await as(repView.accessToken)
        .patch(`/enterprises/${enterpriseId}/representatives/${authId}`)
        .send({ scope: 'FULL' })
        .expect(403);
      await accept(authId, repView).send({ scope: 'FULL' }).expect(409);
      await as(repView.accessToken)
        .put(oneUrl(enterpriseId, p1))
        .send({ employmentCount: 2 })
        .expect(403);
    });

    it('a staff-only officer (MFA-verified) cannot use project endpoints even with a representative authorisation', async () => {
      const { enterpriseId, p1 } = await setup('officer');
      const officer = await ctx.registerWithRole(
        'pa-officer',
        'SCRUTINY_OFFICER',
      );
      const granted = await grant(enterpriseId, {
        emailOrMobile: officer.email,
        scope: 'FULL',
      }).expect(201);
      const { accessToken } = await ctx.fullMfaSession(officer);
      await as(accessToken)
        .post(`/representative-authorisations/${granted.body.id}/accept`)
        .expect(200);
      // Remove APPLICANT so the account is staff-only.
      await ctx.prisma.userRole.deleteMany({
        where: { userId: officer.id, role: { code: 'APPLICANT' } },
      });

      const denied = await as(accessToken)
        .get(oneUrl(enterpriseId, p1))
        .expect(403);
      expect(denied.body.error.code).toBe('INSUFFICIENT_ROLE');
      await as(accessToken)
        .put(oneUrl(enterpriseId, p1))
        .send({ employmentCount: 9 })
        .expect(403);
    });

    it('unauthenticated requests are rejected before any project logic', async () => {
      const { enterpriseId, p1 } = await setup('unauth');
      await request(ctx.http)
        .get(`${API}${listUrl(enterpriseId)}`)
        .expect(401);
      await request(ctx.http)
        .get(`${API}${oneUrl(enterpriseId, p1)}`)
        .expect(401);
      await request(ctx.http)
        .post(`${API}${listUrl(enterpriseId)}`)
        .send(ctx.projectPayload('x'))
        .expect(401);
      await request(ctx.http)
        .put(`${API}${oneUrl(enterpriseId, p1)}`)
        .send({ employmentCount: 1 })
        .expect(401);
    });
  });
});
