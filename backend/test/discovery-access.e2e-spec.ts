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
 * Who may run and read approval discovery, through the EXISTING
 * EnterpriseAccessGuard — no second authorisation system. Real HTTP -> Nest ->
 * Prisma -> PostgreSQL.
 *
 *   run  (POST discover-approvals) : owner, or a live PREPARE_SUBMIT / FULL
 *                                    representative (DISCOVERY_RUN_LEVEL)
 *   read (GET discoveries[/:id])   : owner, or any live representative scope
 *   PENDING / REVOKED / expired / stranger : nothing (404)
 *   project-restricted representatives     : only their listed projects
 */
describe('Approval discovery e2e — authorisation, representative scopes and project restrictions', () => {
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
    patch: (p: string) =>
      request(ctx.http)
        .patch(`${API}${p}`)
        .set('Authorization', `Bearer ${token}`),
    del: (p: string) =>
      request(ctx.http)
        .delete(`${API}${p}`)
        .set('Authorization', `Bearer ${token}`),
  });

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
  ) => {
    const granted = await grant(enterpriseId, {
      emailOrMobile: rep.user.email,
      scope,
      ...extra,
    }).expect(201);
    await accept(granted.body.id, rep).expect(200);
    return granted.body.id as string;
  };

  const runUrl = (e: string, p: string) =>
    `/enterprises/${e}/projects/${p}/discover-approvals`;
  const listUrl = (e: string, p: string) =>
    `/enterprises/${e}/projects/${p}/discoveries`;
  const oneUrl = (e: string, p: string, s: string) =>
    `/enterprises/${e}/projects/${p}/discoveries/${s}`;
  const snapshots = (projectId: string) =>
    ctx.prisma.discoverySnapshot.count({ where: { projectId } });
  /** An owner-run snapshot to read back. */
  const ownerRun = async (e: string, p: string) =>
    (await as(owner.accessToken).post(runUrl(e, p)).expect(201)).body
      .snapshotId as string;

  beforeAll(async () => {
    ctx = await createE2eContext();
    [owner, owner2, repFull, repPrepare, repView, repRestricted, stranger] =
      await Promise.all([
        ctx.applicantSession('da-owner'),
        ctx.applicantSession('da-owner2'),
        ctx.applicantSession('da-full'),
        ctx.applicantSession('da-prepare'),
        ctx.applicantSession('da-view'),
        ctx.applicantSession('da-restricted'),
        ctx.applicantSession('da-stranger'),
      ]);
    // One matching rule so results have real content for every caller.
    const dept = await ctx.createDepartment('access');
    const type = await ctx.createApprovalType(dept.id, 'Access');
    await ctx.publishRule(owner.user.id, type, {
      field: 'hazardous_flag',
      op: 'in',
      value: [true, false],
    });
  });

  afterAll(async () => {
    await ctx.cleanup();
    await ctx.app.close();
  });

  // -------------------------------------------------------------------------
  describe('scope × operation', () => {
    const actorFor = (scope: Scope) =>
      ({ VIEW_ONLY: repView, PREPARE_SUBMIT: repPrepare, FULL: repFull })[
        scope
      ];
    const expected: Record<Scope, { run: number; list: number; get: number }> =
      {
        VIEW_ONLY: { run: 403, list: 200, get: 200 },
        PREPARE_SUBMIT: { run: 201, list: 200, get: 200 },
        FULL: { run: 201, list: 200, get: 200 },
      };

    it.each(['VIEW_ONLY', 'PREPARE_SUBMIT', 'FULL'] as Scope[])(
      'a %s representative can do exactly what that scope allows',
      async (scope) => {
        const { enterpriseId, p1 } = await setup(`matrix-${scope}`);
        const actor = actorFor(scope);
        await activate(enterpriseId, actor, scope);
        const existing = await ownerRun(enterpriseId, p1);
        const want = expected[scope];
        const before = await snapshots(p1);

        const run = await as(actor.accessToken).post(runUrl(enterpriseId, p1));
        expect(run.status).toBe(want.run);
        if (want.run === 403) {
          expect(run.body.error.code).toBe('FORBIDDEN_SCOPE');
          expect(await snapshots(p1)).toBe(before); // a denied run persists nothing
        } else {
          expect(run.body.snapshotId).toBeDefined();
          expect(await snapshots(p1)).toBe(before + 1);
        }

        const list = await as(actor.accessToken).get(listUrl(enterpriseId, p1));
        expect(list.status).toBe(want.list);
        expect(list.body.map((s: { id: string }) => s.id)).toContain(existing);

        const one = await as(actor.accessToken).get(
          oneUrl(enterpriseId, p1, existing),
        );
        expect(one.status).toBe(want.get);
        expect(one.body.reproducible).toBe(true);
        expect(one.body.snapshotId).toBe(existing);
      },
    );

    it('a representative’s run is attributed to the representative in the audit trail (FRD §20.5)', async () => {
      const { enterpriseId, p1 } = await setup('rep-audit');
      await activate(enterpriseId, repPrepare, 'PREPARE_SUBMIT');
      const res = await as(repPrepare.accessToken)
        .post(runUrl(enterpriseId, p1))
        .expect(201);

      const rows = await ctx.prisma.auditLog.findMany({
        where: { entityId: res.body.snapshotId, action: 'DISCOVERY_RUN' },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0].userId).toBe(repPrepare.user.id);
      expect(rows[0].afterState).toMatchObject({
        enterpriseId,
        projectId: p1,
        actingAs: 'REPRESENTATIVE',
      });
      const snap = await ctx.prisma.discoverySnapshot.findUniqueOrThrow({
        where: { id: res.body.snapshotId },
      });
      expect(snap.createdByUserId).toBe(repPrepare.user.id);
    });

    it('a representative sees the same result content as the owner would for the same snapshot', async () => {
      const { enterpriseId, p1 } = await setup('same-content');
      await activate(enterpriseId, repView, 'VIEW_ONLY');
      const id = await ownerRun(enterpriseId, p1);
      const asOwner = (
        await as(owner.accessToken)
          .get(oneUrl(enterpriseId, p1, id))
          .expect(200)
      ).body;
      const asRep = (
        await as(repView.accessToken)
          .get(oneUrl(enterpriseId, p1, id))
          .expect(200)
      ).body;
      expect(asRep).toEqual(asOwner);
    });
  });

  // -------------------------------------------------------------------------
  describe('non-live authorisations and strangers: no access at all', () => {
    const expectNoAccess = async (
      actor: Actor,
      enterpriseId: string,
      p1: string,
      existing: string,
    ) => {
      const before = await snapshots(p1);
      await as(actor.accessToken).post(runUrl(enterpriseId, p1)).expect(404);
      await as(actor.accessToken).get(listUrl(enterpriseId, p1)).expect(404);
      await as(actor.accessToken)
        .get(oneUrl(enterpriseId, p1, existing))
        .expect(404);
      expect(await snapshots(p1)).toBe(before);
    };

    it('PENDING (not yet accepted)', async () => {
      const { enterpriseId, p1 } = await setup('pending');
      const existing = await ownerRun(enterpriseId, p1);
      await grant(enterpriseId, {
        emailOrMobile: repFull.user.email,
        scope: 'FULL',
      }).expect(201);
      await expectNoAccess(repFull, enterpriseId, p1, existing);
    });

    it('REVOKED — immediately, with the same still-valid access token', async () => {
      const { enterpriseId, p1 } = await setup('revoked');
      const existing = await ownerRun(enterpriseId, p1);
      const authId = await activate(enterpriseId, repFull, 'FULL');
      await as(repFull.accessToken).post(runUrl(enterpriseId, p1)).expect(201);

      await as(owner.accessToken)
        .del(`/enterprises/${enterpriseId}/representatives/${authId}`)
        .expect(200);
      await expectNoAccess(repFull, enterpriseId, p1, existing);
    });

    it('EXPIRED — access ends the moment the expiry passes', async () => {
      const { enterpriseId, p1 } = await setup('expired');
      const existing = await ownerRun(enterpriseId, p1);
      const authId = await activate(enterpriseId, repFull, 'FULL', {
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      });
      await as(repFull.accessToken)
        .get(oneUrl(enterpriseId, p1, existing))
        .expect(200);

      await ctx.prisma.enterpriseRepresentative.update({
        where: { id: authId },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      await expectNoAccess(repFull, enterpriseId, p1, existing);
    });

    it('a stranger with no authorisation', async () => {
      const { enterpriseId, p1 } = await setup('stranger');
      await expectNoAccess(
        stranger,
        enterpriseId,
        p1,
        await ownerRun(enterpriseId, p1),
      );
    });

    it('unauthenticated requests are rejected before any discovery logic', async () => {
      const { enterpriseId, p1 } = await setup('unauth');
      const existing = await ownerRun(enterpriseId, p1);
      const before = await snapshots(p1);
      await request(ctx.http)
        .post(`${API}${runUrl(enterpriseId, p1)}`)
        .expect(401);
      await request(ctx.http)
        .get(`${API}${listUrl(enterpriseId, p1)}`)
        .expect(401);
      await request(ctx.http)
        .get(`${API}${oneUrl(enterpriseId, p1, existing)}`)
        .expect(401);
      expect(await snapshots(p1)).toBe(before);
    });

    it('a staff-only officer (MFA-verified) cannot use discovery even with a representative authorisation (Step 4 RBAC)', async () => {
      const { enterpriseId, p1 } = await setup('officer');
      const officer = await ctx.registerWithRole(
        'da-officer',
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
      await ctx.prisma.userRole.deleteMany({
        where: { userId: officer.id, role: { code: 'APPLICANT' } },
      });

      const before = await snapshots(p1);
      const res = await as(accessToken)
        .post(runUrl(enterpriseId, p1))
        .expect(403);
      expect(res.body.error.code).toBe('INSUFFICIENT_ROLE');
      await as(accessToken).get(listUrl(enterpriseId, p1)).expect(403);
      expect(await snapshots(p1)).toBe(before);
    });
  });

  // -------------------------------------------------------------------------
  describe('scope changes take effect on the very next request', () => {
    it('reducing PREPARE_SUBMIT to VIEW_ONLY stops running discovery immediately but keeps reading', async () => {
      const { enterpriseId, p1 } = await setup('downgrade');
      const authId = await activate(enterpriseId, repPrepare, 'PREPARE_SUBMIT');
      await as(repPrepare.accessToken)
        .post(runUrl(enterpriseId, p1))
        .expect(201);

      await as(owner.accessToken)
        .patch(`/enterprises/${enterpriseId}/representatives/${authId}`)
        .send({ scope: 'VIEW_ONLY' })
        .expect(200);
      await as(repPrepare.accessToken)
        .post(runUrl(enterpriseId, p1))
        .expect(403);
      await as(repPrepare.accessToken)
        .get(listUrl(enterpriseId, p1))
        .expect(200);
    });

    it('raising VIEW_ONLY to PREPARE_SUBMIT does nothing until the representative accepts again', async () => {
      const { enterpriseId, p1 } = await setup('upgrade');
      const authId = await activate(enterpriseId, repView, 'VIEW_ONLY');
      await as(owner.accessToken)
        .patch(`/enterprises/${enterpriseId}/representatives/${authId}`)
        .send({ scope: 'PREPARE_SUBMIT' })
        .expect(200);
      await as(repView.accessToken).post(runUrl(enterpriseId, p1)).expect(404); // PENDING: no access at all
      await accept(authId, repView).expect(200);
      await as(repView.accessToken).post(runUrl(enterpriseId, p1)).expect(201);
    });
  });

  // -------------------------------------------------------------------------
  describe('project-restricted representatives', () => {
    it('may run and read discovery only for their listed project', async () => {
      const { enterpriseId, p1, p2 } = await setup('restricted');
      const foreign = await setup('restricted-foreign', owner2);
      await activate(enterpriseId, repRestricted, 'PREPARE_SUBMIT', {
        projectIds: [p1],
      });
      const ownerSnapshotOfP2 = await ownerRun(enterpriseId, p2);
      const before = await snapshots(p2);

      // Allowed for p1.
      const run = await as(repRestricted.accessToken)
        .post(runUrl(enterpriseId, p1))
        .expect(201);
      await as(repRestricted.accessToken)
        .get(listUrl(enterpriseId, p1))
        .expect(200);
      await as(repRestricted.accessToken)
        .get(oneUrl(enterpriseId, p1, run.body.snapshotId))
        .expect(200);

      // Denied for a sibling, another enterprise's project, and a nonexistent one —
      // all the same 403, so nothing about existence leaks.
      const sibling = await as(repRestricted.accessToken)
        .post(runUrl(enterpriseId, p2))
        .expect(403);
      const alien = await as(repRestricted.accessToken)
        .post(runUrl(enterpriseId, foreign.p1))
        .expect(403);
      const missing = await as(repRestricted.accessToken)
        .post(runUrl(enterpriseId, randomUUID()))
        .expect(403);
      expect(sibling.body.error.code).toBe('FORBIDDEN_SCOPE');
      expect(alien.body).toEqual(sibling.body);
      expect(missing.body).toEqual(sibling.body);

      await as(repRestricted.accessToken)
        .get(listUrl(enterpriseId, p2))
        .expect(403);
      await as(repRestricted.accessToken)
        .get(oneUrl(enterpriseId, p2, ownerSnapshotOfP2))
        .expect(403);
      expect(await snapshots(p2)).toBe(before); // nothing was created for the sibling
    });

    it('a snapshot of one project can never be read through another project’s URL', async () => {
      const { enterpriseId, p1, p2 } = await setup('cross-project');
      await activate(enterpriseId, repRestricted, 'FULL', { projectIds: [p1] });
      const snapshotOfP2 = await ownerRun(enterpriseId, p2);

      // Even the owner: the snapshot belongs to p2, so under p1 it does not exist.
      await as(owner.accessToken)
        .get(oneUrl(enterpriseId, p1, snapshotOfP2))
        .expect(404);
      // The restricted representative is authorised for p1 only, so p1's URL with
      // p2's snapshot id is the sharpest probe available to them.
      await as(repRestricted.accessToken)
        .get(oneUrl(enterpriseId, p1, snapshotOfP2))
        .expect(404);
    });

    it('a VIEW_ONLY representative restricted to a project can read its results but not run discovery', async () => {
      const { enterpriseId, p1 } = await setup('restricted-view');
      await activate(enterpriseId, repView, 'VIEW_ONLY', { projectIds: [p1] });
      const id = await ownerRun(enterpriseId, p1);
      await as(repView.accessToken)
        .get(oneUrl(enterpriseId, p1, id))
        .expect(200);
      await as(repView.accessToken).post(runUrl(enterpriseId, p1)).expect(403);
    });
  });

  // -------------------------------------------------------------------------
  describe('cross-enterprise attempts', () => {
    it('a representative of one enterprise cannot reach another enterprise’s projects or snapshots by any route', async () => {
      const mine = await setup('cross-mine');
      const theirs = await setup('cross-theirs', owner2);
      await activate(mine.enterpriseId, repFull, 'FULL');
      const theirSnapshot = (
        await as(owner2.accessToken)
          .post(runUrl(theirs.enterpriseId, theirs.p1))
          .expect(201)
      ).body.snapshotId;
      const before = await snapshots(theirs.p1);

      // Their enterprise: no relationship at all.
      await as(repFull.accessToken)
        .post(runUrl(theirs.enterpriseId, theirs.p1))
        .expect(404);
      await as(repFull.accessToken)
        .get(listUrl(theirs.enterpriseId, theirs.p1))
        .expect(404);
      await as(repFull.accessToken)
        .get(oneUrl(theirs.enterpriseId, theirs.p1, theirSnapshot))
        .expect(404);
      // Their project (or snapshot) smuggled under MY enterprise's URL.
      await as(repFull.accessToken)
        .post(runUrl(mine.enterpriseId, theirs.p1))
        .expect(404);
      await as(repFull.accessToken)
        .get(listUrl(mine.enterpriseId, theirs.p1))
        .expect(404);
      await as(repFull.accessToken)
        .get(oneUrl(mine.enterpriseId, mine.p1, theirSnapshot))
        .expect(404);

      expect(await snapshots(theirs.p1)).toBe(before);
    });

    it('even the owner of two enterprises cannot run discovery on one enterprise’s project through the other’s URL', async () => {
      const a = await setup('two-a');
      const b = await setup('two-b');
      const before = await snapshots(b.p1);
      await as(owner.accessToken)
        .post(runUrl(a.enterpriseId, b.p1))
        .expect(404);
      expect(await snapshots(b.p1)).toBe(before);
    });

    it('a stranger’s snapshot id cannot be read even when guessed under one’s own project', async () => {
      const mine = await setup('guess-mine', owner2);
      const theirs = await setup('guess-theirs');
      const theirSnapshot = await ownerRun(theirs.enterpriseId, theirs.p1);
      await as(owner2.accessToken)
        .get(oneUrl(mine.enterpriseId, mine.p1, theirSnapshot))
        .expect(404);
    });
  });

  // -------------------------------------------------------------------------
  describe('no self-escalation, and Step 4–6 boundaries still hold', () => {
    it('a VIEW_ONLY representative cannot raise their own scope to gain the ability to run discovery', async () => {
      const { enterpriseId, p1 } = await setup('escalate');
      const authId = await activate(enterpriseId, repView, 'VIEW_ONLY');
      await as(repView.accessToken)
        .patch(`/enterprises/${enterpriseId}/representatives/${authId}`)
        .send({ scope: 'FULL' })
        .expect(403);
      await accept(authId, repView).send({ scope: 'FULL' }).expect(409);
      await as(repView.accessToken).post(runUrl(enterpriseId, p1)).expect(403);
    });

    it('discovery does not widen what representatives can do to projects: a PREPARE_SUBMIT representative still cannot edit one', async () => {
      const { enterpriseId, p1 } = await setup('no-edit');
      await activate(enterpriseId, repPrepare, 'PREPARE_SUBMIT');
      await as(repPrepare.accessToken)
        .post(runUrl(enterpriseId, p1))
        .expect(201);
      await request(ctx.http)
        .put(`${API}/enterprises/${enterpriseId}/projects/${p1}`)
        .set('Authorization', `Bearer ${repPrepare.accessToken}`)
        .send({ employmentCount: 1 })
        .expect(403);
    });
  });
});
