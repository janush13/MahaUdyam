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
 * Who may do what with an application, through the EXISTING
 * EnterpriseAccessGuard — no second authorisation system. Real HTTP -> Nest
 * -> Prisma -> PostgreSQL.
 *
 *   read   (GET …/applications[/:id[/status]])            : owner, or any live
 *                                                            representative scope
 *   write  (create, PUT …/draft, pre-validate, submit)    : owner, or a live
 *                                                            PREPARE_SUBMIT / FULL representative
 *   PENDING / REVOKED / expired / stranger                : nothing (404)
 *   project-restricted representatives                    : only their listed projects
 */
describe('Applications e2e — authorisation, representative scopes and project restrictions', () => {
  let ctx: E2eContext;
  let owner: Actor;
  let owner2: Actor;
  let repFull: Actor;
  let repPrepare: Actor;
  let repView: Actor;
  let repRestricted: Actor;
  let stranger: Actor;
  let approvalA: string;
  let approvalB: string;

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

  const appsUrl = (e: string, p: string) =>
    `/enterprises/${e}/projects/${p}/applications`;
  const appUrl = (e: string, p: string, a: string) => `${appsUrl(e, p)}/${a}`;
  const enterpriseAppsUrl = (e: string) => `/enterprises/${e}/applications`;

  /** An owner-created DRAFT (approval A) plus a stored snapshot to start more from. */
  const ownerDraft = async (
    enterpriseId: string,
    projectId: string,
    approvalTypeId = approvalA,
  ) => {
    const snapshotId = await ctx.discover(
      owner.accessToken,
      enterpriseId,
      projectId,
    );
    const res = await as(owner.accessToken)
      .post(appsUrl(enterpriseId, projectId))
      .send({ approvalTypeId, discoverySnapshotId: snapshotId })
      .expect(201);
    return { snapshotId, applicationId: res.body.id as string };
  };
  const dbApp = (id: string) =>
    ctx.prisma.approvalApplication.findUniqueOrThrow({ where: { id } });
  const appCount = (projectId: string) =>
    ctx.prisma.approvalApplication.count({ where: { projectId } });
  const auditCount = (entityId: string) =>
    ctx.prisma.auditLog.count({ where: { entityId } });

  beforeAll(async () => {
    ctx = await createE2eContext();
    [owner, owner2, repFull, repPrepare, repView, repRestricted, stranger] =
      await Promise.all([
        ctx.applicantSession('aa-owner'),
        ctx.applicantSession('aa-owner2'),
        ctx.applicantSession('aa-full'),
        ctx.applicantSession('aa-prepare'),
        ctx.applicantSession('aa-view'),
        ctx.applicantSession('aa-restricted'),
        ctx.applicantSession('aa-stranger'),
      ]);
    approvalA = (await ctx.createStartableApproval(owner.user.id, 'aa-a'))
      .approvalTypeId;
    approvalB = (await ctx.createStartableApproval(owner.user.id, 'aa-b'))
      .approvalTypeId;
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
    const expected: Record<
      Scope,
      {
        create: number;
        list: number;
        get: number;
        status: number;
        update: number;
        prevalidate: number;
        submit: number;
      }
    > = {
      VIEW_ONLY: {
        create: 403,
        list: 200,
        get: 200,
        status: 200,
        update: 403,
        prevalidate: 403,
        submit: 403,
      },
      PREPARE_SUBMIT: {
        create: 201,
        list: 200,
        get: 200,
        status: 200,
        update: 200,
        prevalidate: 200,
        submit: 200,
      },
      FULL: {
        create: 201,
        list: 200,
        get: 200,
        status: 200,
        update: 200,
        prevalidate: 200,
        submit: 200,
      },
    };

    it.each(['VIEW_ONLY', 'PREPARE_SUBMIT', 'FULL'] as Scope[])(
      'a %s representative can do exactly what that scope allows',
      async (scope) => {
        const { enterpriseId, p1 } = await setup(`matrix-${scope}`);
        const actor = actorFor(scope);
        await activate(enterpriseId, actor, scope);
        const { snapshotId, applicationId } = await ownerDraft(
          enterpriseId,
          p1,
        );
        const want = expected[scope];
        const rep = as(actor.accessToken);

        // create (approval B, so it does not collide with the owner's draft)
        const before = await appCount(p1);
        const created = await rep
          .post(appsUrl(enterpriseId, p1))
          .send({ approvalTypeId: approvalB, discoverySnapshotId: snapshotId });
        expect(created.status).toBe(want.create);
        if (want.create === 403) {
          expect(created.body.error.code).toBe('FORBIDDEN_SCOPE');
          expect(await appCount(p1)).toBe(before); // a denied create persists nothing
        } else {
          expect(created.body.createdByUserId).toBe(actor.user.id);
          expect(await appCount(p1)).toBe(before + 1);
        }

        // reads
        const list = await rep.get(appsUrl(enterpriseId, p1));
        expect(list.status).toBe(want.list);
        expect(list.body.map((a: { id: string }) => a.id)).toContain(
          applicationId,
        );
        const entList = await rep.get(enterpriseAppsUrl(enterpriseId));
        expect(entList.status).toBe(want.list);
        expect(entList.body.map((a: { id: string }) => a.id)).toContain(
          applicationId,
        );
        const one = await rep.get(appUrl(enterpriseId, p1, applicationId));
        expect(one.status).toBe(want.get);
        expect(one.body.id).toBe(applicationId);
        const status = await rep.get(
          `${appUrl(enterpriseId, p1, applicationId)}/status`,
        );
        expect(status.status).toBe(want.status);

        // update draft
        const events = await auditCount(applicationId);
        const update = await rep
          .put(`${appUrl(enterpriseId, p1, applicationId)}/draft`)
          .send({ formData: { by: scope } });
        expect(update.status).toBe(want.update);
        if (want.update === 403) {
          expect(update.body.error.code).toBe('FORBIDDEN_SCOPE');
          expect((await dbApp(applicationId)).formData).toEqual({});
          expect(await auditCount(applicationId)).toBe(events);
        } else {
          expect((await dbApp(applicationId)).formData).toEqual({ by: scope });
        }

        // pre-validate
        const pre = await rep.post(
          `${appUrl(enterpriseId, p1, applicationId)}/pre-validate`,
        );
        expect(pre.status).toBe(want.prevalidate);

        // submit
        const sub = await rep
          .post(`${appUrl(enterpriseId, p1, applicationId)}/submit`)
          .send({ declarationAccepted: true });
        expect(sub.status).toBe(want.submit);
        const row = await dbApp(applicationId);
        if (want.submit === 403) {
          expect(sub.body.error.code).toBe('FORBIDDEN_SCOPE');
          expect(row.internalState).toBe('DRAFT');
          expect(row.referenceNumber).toBeNull();
        } else {
          expect(row.internalState).toBe('SUBMITTED');
          expect(row.submittedByUserId).toBe(actor.user.id);
        }
      },
    );

    it('the owner can do everything, including submitting a draft a representative prepared', async () => {
      const { enterpriseId, p1 } = await setup('owner-all');
      await activate(enterpriseId, repPrepare, 'PREPARE_SUBMIT');
      const { snapshotId } = await ownerDraft(enterpriseId, p1);
      const repApp = await as(repPrepare.accessToken)
        .post(appsUrl(enterpriseId, p1))
        .send({ approvalTypeId: approvalB, discoverySnapshotId: snapshotId })
        .expect(201);
      const submitted = await as(owner.accessToken)
        .post(`${appUrl(enterpriseId, p1, repApp.body.id)}/submit`)
        .send({ declarationAccepted: true })
        .expect(200);
      expect(submitted.body.createdByUserId).toBe(repPrepare.user.id);
      expect(submitted.body.submittedByUserId).toBe(owner.user.id);
    });
  });

  // -------------------------------------------------------------------------
  describe('audit attributes representative actions to the representative (FRD §20.5)', () => {
    it('create, update and submit by a PREPARE_SUBMIT representative are logged with their identity and the enterprise', async () => {
      const { enterpriseId, p1 } = await setup('rep-audit');
      await activate(enterpriseId, repPrepare, 'PREPARE_SUBMIT');
      const snapshotId = await ctx.discover(
        owner.accessToken,
        enterpriseId,
        p1,
      );
      const rep = as(repPrepare.accessToken);
      const created = await rep
        .post(appsUrl(enterpriseId, p1))
        .send({ approvalTypeId: approvalA, discoverySnapshotId: snapshotId })
        .expect(201);
      const id = created.body.id as string;
      await rep
        .put(`${appUrl(enterpriseId, p1, id)}/draft`)
        .send({ formData: { a: 1 } })
        .expect(200);
      await rep
        .post(`${appUrl(enterpriseId, p1, id)}/submit`)
        .send({ declarationAccepted: true })
        .expect(200);

      const events = await ctx.prisma.auditLog.findMany({
        where: { entityId: id },
      });
      expect(events.map((e) => e.action).sort()).toEqual([
        'APPLICATION_CREATED',
        'APPLICATION_STATUS_CHANGED',
        'APPLICATION_SUBMITTED',
        'APPLICATION_UPDATED',
      ]);
      for (const e of events) {
        expect(e.userId).toBe(repPrepare.user.id);
        expect(e.afterState).toMatchObject({
          enterpriseId,
          projectId: p1,
          actingAs: 'REPRESENTATIVE',
          representativeScope: 'PREPARE_SUBMIT',
        });
        expect(e.ruleVersionUsed).toMatch(/@v1$/);
      }
    });
  });

  // -------------------------------------------------------------------------
  describe('non-live authorisations and strangers: no access at all', () => {
    const expectNoAccess = async (
      actor: Actor,
      enterpriseId: string,
      p1: string,
      applicationId: string,
      snapshotId: string,
    ) => {
      const a = as(actor.accessToken);
      const base = appUrl(enterpriseId, p1, applicationId);
      const before = await dbApp(applicationId);
      const count = await appCount(p1);
      const events = await auditCount(applicationId);

      const responses = [
        await a.get(appsUrl(enterpriseId, p1)),
        await a.get(enterpriseAppsUrl(enterpriseId)),
        await a.get(base),
        await a.get(`${base}/status`),
        await a
          .post(appsUrl(enterpriseId, p1))
          .send({ approvalTypeId: approvalB, discoverySnapshotId: snapshotId }),
        await a.put(`${base}/draft`).send({ formData: { x: 1 } }),
        await a.post(`${base}/pre-validate`),
        await a.post(`${base}/submit`).send({ declarationAccepted: true }),
      ];
      for (const res of responses) {
        expect(res.status).toBe(404);
        expect(res.body.error.code).toBe('NOT_FOUND');
      }
      // Identical bodies: nothing about the enterprise's existence leaks.
      expect(new Set(responses.map((r) => r.body.error.message)).size).toBe(1);

      const after = await dbApp(applicationId);
      expect(after.internalState).toBe(before.internalState);
      expect(after.formData).toEqual(before.formData);
      expect(after.updatedAt).toEqual(before.updatedAt);
      expect(await appCount(p1)).toBe(count);
      expect(await auditCount(applicationId)).toBe(events);
    };

    it('PENDING (not yet accepted)', async () => {
      const { enterpriseId, p1 } = await setup('pending');
      const d = await ownerDraft(enterpriseId, p1);
      await grant(enterpriseId, {
        emailOrMobile: repFull.user.email,
        scope: 'FULL',
      }).expect(201);
      await expectNoAccess(
        repFull,
        enterpriseId,
        p1,
        d.applicationId,
        d.snapshotId,
      );
    });

    it('REVOKED — immediately, with the same still-valid access token; drafts are preserved', async () => {
      const { enterpriseId, p1 } = await setup('revoked');
      const owned = await ownerDraft(enterpriseId, p1);
      const authId = await activate(enterpriseId, repFull, 'FULL');
      const repApp = await as(repFull.accessToken)
        .post(appsUrl(enterpriseId, p1))
        .send({
          approvalTypeId: approvalB,
          discoverySnapshotId: owned.snapshotId,
        })
        .expect(201);

      await as(owner.accessToken)
        .del(`/enterprises/${enterpriseId}/representatives/${authId}`)
        .expect(200);
      await expectNoAccess(
        repFull,
        enterpriseId,
        p1,
        repApp.body.id,
        owned.snapshotId,
      );

      // FRD §20.4: the representative's in-progress draft is preserved, and the
      // owner can still see and finish it.
      const kept = await as(owner.accessToken)
        .get(appUrl(enterpriseId, p1, repApp.body.id))
        .expect(200);
      expect(kept.body.createdByUserId).toBe(repFull.user.id);
      expect(kept.body.editable).toBe(true);
      await as(owner.accessToken)
        .post(`${appUrl(enterpriseId, p1, repApp.body.id)}/submit`)
        .send({ declarationAccepted: true })
        .expect(200);
    });

    it('EXPIRED — access ends the moment the expiry passes', async () => {
      const { enterpriseId, p1 } = await setup('expired');
      const d = await ownerDraft(enterpriseId, p1);
      const authId = await activate(enterpriseId, repFull, 'FULL', {
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      });
      await as(repFull.accessToken)
        .get(appUrl(enterpriseId, p1, d.applicationId))
        .expect(200);

      await ctx.prisma.enterpriseRepresentative.update({
        where: { id: authId },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      await expectNoAccess(
        repFull,
        enterpriseId,
        p1,
        d.applicationId,
        d.snapshotId,
      );
    });

    it('a stranger with no authorisation', async () => {
      const { enterpriseId, p1 } = await setup('stranger');
      const d = await ownerDraft(enterpriseId, p1);
      await expectNoAccess(
        stranger,
        enterpriseId,
        p1,
        d.applicationId,
        d.snapshotId,
      );
    });

    it('unauthenticated requests are rejected before any application logic', async () => {
      const { enterpriseId, p1 } = await setup('unauth');
      const d = await ownerDraft(enterpriseId, p1);
      const base = `${API}${appUrl(enterpriseId, p1, d.applicationId)}`;
      await request(ctx.http)
        .get(`${API}${appsUrl(enterpriseId, p1)}`)
        .expect(401);
      await request(ctx.http).get(base).expect(401);
      await request(ctx.http)
        .put(`${base}/draft`)
        .send({ formData: {} })
        .expect(401);
      await request(ctx.http).post(`${base}/pre-validate`).expect(401);
      await request(ctx.http).post(`${base}/submit`).send({}).expect(401);
      expect((await dbApp(d.applicationId)).internalState).toBe('DRAFT');
    });

    it('a staff-only officer (MFA-verified) cannot use applications even with a representative authorisation (Step 4 RBAC)', async () => {
      const { enterpriseId, p1 } = await setup('officer');
      const d = await ownerDraft(enterpriseId, p1);
      const officer = await ctx.registerWithRole(
        'aa-officer',
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

      const res = await as(accessToken)
        .get(appUrl(enterpriseId, p1, d.applicationId))
        .expect(403);
      expect(res.body.error.code).toBe('INSUFFICIENT_ROLE');
      await as(accessToken)
        .post(`${appUrl(enterpriseId, p1, d.applicationId)}/submit`)
        .send({ declarationAccepted: true })
        .expect(403);
      expect((await dbApp(d.applicationId)).internalState).toBe('DRAFT');
    });
  });

  // -------------------------------------------------------------------------
  describe('scope changes take effect on the very next request', () => {
    it('reducing PREPARE_SUBMIT to VIEW_ONLY stops writing immediately but keeps reading', async () => {
      const { enterpriseId, p1 } = await setup('downgrade');
      const authId = await activate(enterpriseId, repPrepare, 'PREPARE_SUBMIT');
      const d = await ownerDraft(enterpriseId, p1);
      const base = appUrl(enterpriseId, p1, d.applicationId);
      await as(repPrepare.accessToken)
        .put(`${base}/draft`)
        .send({ formData: { a: 1 } })
        .expect(200);

      await as(owner.accessToken)
        .patch(`/enterprises/${enterpriseId}/representatives/${authId}`)
        .send({ scope: 'VIEW_ONLY' })
        .expect(200);
      await as(repPrepare.accessToken)
        .put(`${base}/draft`)
        .send({ formData: { a: 2 } })
        .expect(403);
      await as(repPrepare.accessToken)
        .post(`${base}/submit`)
        .send({ declarationAccepted: true })
        .expect(403);
      await as(repPrepare.accessToken).get(base).expect(200);
      expect((await dbApp(d.applicationId)).formData).toEqual({ a: 1 });
    });

    it('raising VIEW_ONLY to PREPARE_SUBMIT does nothing until the representative accepts again', async () => {
      const { enterpriseId, p1 } = await setup('upgrade');
      const authId = await activate(enterpriseId, repView, 'VIEW_ONLY');
      const d = await ownerDraft(enterpriseId, p1);
      const base = appUrl(enterpriseId, p1, d.applicationId);
      await as(owner.accessToken)
        .patch(`/enterprises/${enterpriseId}/representatives/${authId}`)
        .send({ scope: 'PREPARE_SUBMIT' })
        .expect(200);
      await as(repView.accessToken).get(base).expect(404); // PENDING: no access at all
      await accept(authId, repView).expect(200);
      await as(repView.accessToken)
        .put(`${base}/draft`)
        .send({ formData: { ok: true } })
        .expect(200);
    });
  });

  // -------------------------------------------------------------------------
  describe('project-restricted representatives', () => {
    it('may act only on their listed project; every other project is the same 403', async () => {
      const { enterpriseId, p1, p2 } = await setup('restricted');
      const foreign = await setup('restricted-foreign', owner2);
      await activate(enterpriseId, repRestricted, 'PREPARE_SUBMIT', {
        projectIds: [p1],
      });
      const d1 = await ownerDraft(enterpriseId, p1);
      const d2 = await ownerDraft(enterpriseId, p2);
      const rep = as(repRestricted.accessToken);

      // Allowed on p1: create, read, edit, validate, submit.
      const created = await rep
        .post(appsUrl(enterpriseId, p1))
        .send({ approvalTypeId: approvalB, discoverySnapshotId: d1.snapshotId })
        .expect(201);
      await rep.get(appsUrl(enterpriseId, p1)).expect(200);
      await rep.get(appUrl(enterpriseId, p1, d1.applicationId)).expect(200);
      await rep
        .put(`${appUrl(enterpriseId, p1, d1.applicationId)}/draft`)
        .send({ formData: { a: 1 } })
        .expect(200);
      await rep
        .post(`${appUrl(enterpriseId, p1, d1.applicationId)}/pre-validate`)
        .expect(200);
      await rep
        .post(`${appUrl(enterpriseId, p1, created.body.id)}/submit`)
        .send({ declarationAccepted: true })
        .expect(200);

      // Denied on a sibling project, another enterprise's project, and a
      // nonexistent one — all the same 403, so nothing about existence leaks.
      const before2 = await appCount(p2);
      const probe = async (project: string, enterprise = enterpriseId) => [
        await rep.get(appsUrl(enterprise, project)),
        await rep.post(appsUrl(enterprise, project)).send({
          approvalTypeId: approvalB,
          discoverySnapshotId: d2.snapshotId,
        }),
        await rep.get(appUrl(enterprise, project, d2.applicationId)),
        await rep
          .put(`${appUrl(enterprise, project, d2.applicationId)}/draft`)
          .send({ formData: { hack: 1 } }),
        await rep.post(
          `${appUrl(enterprise, project, d2.applicationId)}/pre-validate`,
        ),
        await rep
          .post(`${appUrl(enterprise, project, d2.applicationId)}/submit`)
          .send({ declarationAccepted: true }),
      ];
      const sibling = await probe(p2);
      const missing = await probe(randomUUID());
      for (const res of [...sibling, ...missing]) {
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('FORBIDDEN_SCOPE');
      }
      expect(missing.map((r) => r.body)).toEqual(sibling.map((r) => r.body));
      // A project of ANOTHER enterprise, addressed through this enterprise.
      for (const res of await probe(foreign.p1)) {
        expect(res.status).toBe(403);
      }

      // Nothing was created or changed on p2.
      expect(await appCount(p2)).toBe(before2);
      const row2 = await dbApp(d2.applicationId);
      expect(row2.internalState).toBe('DRAFT');
      expect(row2.formData).toEqual({});
    });

    it('the enterprise-wide list contains only applications of their projects', async () => {
      const { enterpriseId, p1, p2 } = await setup('restricted-list');
      await activate(enterpriseId, repRestricted, 'VIEW_ONLY', {
        projectIds: [p1],
      });
      const d1 = await ownerDraft(enterpriseId, p1);
      const d2 = await ownerDraft(enterpriseId, p2);
      const rep = as(repRestricted.accessToken);

      const all = await rep.get(enterpriseAppsUrl(enterpriseId)).expect(200);
      const ids = all.body.map((a: { id: string }) => a.id);
      expect(ids).toContain(d1.applicationId);
      expect(ids).not.toContain(d2.applicationId);

      // Filtering to a project outside their list yields nothing (not the data).
      const filtered = await rep
        .get(`${enterpriseAppsUrl(enterpriseId)}?projectId=${p2}`)
        .expect(200);
      expect(filtered.body).toEqual([]);
      const inside = await rep
        .get(`${enterpriseAppsUrl(enterpriseId)}?projectId=${p1}`)
        .expect(200);
      expect(inside.body.map((a: { id: string }) => a.id)).toEqual([
        d1.applicationId,
      ]);

      // The owner still sees both.
      const ownerIds = (
        await as(owner.accessToken)
          .get(enterpriseAppsUrl(enterpriseId))
          .expect(200)
      ).body.map((a: { id: string }) => a.id);
      expect(ownerIds).toEqual(
        expect.arrayContaining([d1.applicationId, d2.applicationId]),
      );
    });

    it('an application of one project can never be reached through another project’s URL', async () => {
      const { enterpriseId, p1, p2 } = await setup('cross-project');
      await activate(enterpriseId, repRestricted, 'FULL', { projectIds: [p1] });
      const d2 = await ownerDraft(enterpriseId, p2);

      // Even the owner: the application belongs to p2, so under p1 it does not exist.
      const viaP1 = appUrl(enterpriseId, p1, d2.applicationId);
      await as(owner.accessToken).get(viaP1).expect(404);
      await as(owner.accessToken)
        .put(`${viaP1}/draft`)
        .send({ formData: { a: 1 } })
        .expect(404);
      await as(owner.accessToken)
        .post(`${viaP1}/submit`)
        .send({ declarationAccepted: true })
        .expect(404);
      // The restricted representative is authorised for p1 only, so p1's URL with
      // p2's application id is the sharpest probe available to them.
      await as(repRestricted.accessToken).get(viaP1).expect(404);
      await as(repRestricted.accessToken)
        .post(`${viaP1}/submit`)
        .send({ declarationAccepted: true })
        .expect(404);
      expect((await dbApp(d2.applicationId)).internalState).toBe('DRAFT');
    });

    it('a snapshot of a project the representative may not use cannot be cited to start an application', async () => {
      const { enterpriseId, p1, p2 } = await setup('cross-snapshot');
      await activate(enterpriseId, repRestricted, 'FULL', { projectIds: [p1] });
      const snapshotOfP2 = await ctx.discover(
        owner.accessToken,
        enterpriseId,
        p2,
      );
      const before = await appCount(p1);
      const res = await as(repRestricted.accessToken)
        .post(appsUrl(enterpriseId, p1))
        .send({ approvalTypeId: approvalA, discoverySnapshotId: snapshotOfP2 })
        .expect(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
      expect(await appCount(p1)).toBe(before);
    });

    it('an unrestricted representative reaches every project of the enterprise', async () => {
      const { enterpriseId, p1, p2 } = await setup('unrestricted');
      await activate(enterpriseId, repFull, 'FULL');
      const d1 = await ownerDraft(enterpriseId, p1);
      const d2 = await ownerDraft(enterpriseId, p2);
      await as(repFull.accessToken)
        .get(appUrl(enterpriseId, p1, d1.applicationId))
        .expect(200);
      await as(repFull.accessToken)
        .get(appUrl(enterpriseId, p2, d2.applicationId))
        .expect(200);
    });
  });

  // -------------------------------------------------------------------------
  describe('cross-enterprise isolation', () => {
    it('another enterprise’s owner sees nothing of this enterprise’s applications', async () => {
      const mine = await setup('iso-mine');
      const theirs = await setup('iso-theirs', owner2);
      const d = await ownerDraft(mine.enterpriseId, mine.p1);
      const o2 = as(owner2.accessToken);
      const base = appUrl(mine.enterpriseId, mine.p1, d.applicationId);

      // Through my enterprise's URL: no relationship at all -> 404.
      for (const res of [
        await o2.get(appsUrl(mine.enterpriseId, mine.p1)),
        await o2.get(enterpriseAppsUrl(mine.enterpriseId)),
        await o2.get(base),
        await o2.get(`${base}/status`),
        await o2.put(`${base}/draft`).send({ formData: { a: 1 } }),
        await o2.post(`${base}/pre-validate`),
        await o2.post(`${base}/submit`).send({ declarationAccepted: true }),
      ]) {
        expect(res.status).toBe(404);
      }

      // Through THEIR enterprise + project with MY application / snapshot ids.
      const theirBase = (a: string) =>
        appUrl(theirs.enterpriseId, theirs.p1, a);
      await o2.get(theirBase(d.applicationId)).expect(404);
      await o2
        .post(`${theirBase(d.applicationId)}/submit`)
        .send({ declarationAccepted: true })
        .expect(404);
      await o2
        .post(appsUrl(theirs.enterpriseId, theirs.p1))
        .send({ approvalTypeId: approvalA, discoverySnapshotId: d.snapshotId })
        .expect(404);
      // My project id under THEIR enterprise URL.
      await o2.get(appsUrl(theirs.enterpriseId, mine.p1)).expect(404);

      expect((await dbApp(d.applicationId)).internalState).toBe('DRAFT');
      // Their own enterprise-wide list contains none of mine.
      const theirs2 = await o2
        .get(enterpriseAppsUrl(theirs.enterpriseId))
        .expect(200);
      expect(theirs2.body.map((a: { id: string }) => a.id)).not.toContain(
        d.applicationId,
      );
    });

    it('a representative of one enterprise has no reach into another', async () => {
      const a = await setup('iso-rep-a');
      const b = await setup('iso-rep-b', owner2);
      await activate(a.enterpriseId, repFull, 'FULL');
      const dB = await (async () => {
        const snapshotId = await ctx.discover(
          owner2.accessToken,
          b.enterpriseId,
          b.p1,
        );
        const res = await as(owner2.accessToken)
          .post(appsUrl(b.enterpriseId, b.p1))
          .send({ approvalTypeId: approvalA, discoverySnapshotId: snapshotId })
          .expect(201);
        return { snapshotId, applicationId: res.body.id as string };
      })();

      const rep = as(repFull.accessToken);
      await rep.get(appUrl(b.enterpriseId, b.p1, dB.applicationId)).expect(404);
      await rep
        .post(`${appUrl(b.enterpriseId, b.p1, dB.applicationId)}/submit`)
        .send({ declarationAccepted: true })
        .expect(404);
      // ...and through THEIR enterprise, with B's ids.
      await rep.get(appUrl(a.enterpriseId, a.p1, dB.applicationId)).expect(404);
      expect((await dbApp(dB.applicationId)).internalState).toBe('DRAFT');
    });
  });
});
