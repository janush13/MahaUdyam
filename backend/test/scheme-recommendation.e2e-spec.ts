import request from 'supertest';
import { API, E2eContext, createE2eContext } from './support/e2e-helpers';
import { Actor, as } from './support/officer-world';
import {
  PublishedScheme,
  SchemeWorld,
  applyFor,
  buildSchemeWorld,
  publishScheme,
  schemeApplicationBase,
} from './support/scheme-world';

jest.setTimeout(600_000);

const FRD_NOTICE =
  'You may be eligible for this scheme based on your project details. This is not an official eligibility determination — apply to receive a decision from the administering department.';

/**
 * Step 16 - scheme RECOMMENDATION (deterministic, explainable, never a
 * determination) and the applicant's APPLICATION for a scheme, over real HTTP ->
 * Nest -> Prisma -> PostgreSQL. Every scheme and rule is a labelled test fixture.
 * (The database is shared with other suites' fixtures, so assertions look at THIS
 * suite's schemes by id, never at the whole list.)
 */
describe('Schemes e2e - recommendation and application', () => {
  let ctx: E2eContext;
  let w: SchemeWorld;
  let P1: string; // Pune, small, 25,000,000.5
  let P2: string; // Nagpur, medium
  let repView: Actor;
  let repFull: Actor;
  let repP2: Actor; // PREPARE_SUBMIT, restricted to P2
  let repPending: Actor;
  let sMatch: PublishedScheme;
  let sFirst: PublishedScheme;
  let sNoMatch: PublishedScheme;
  let sNoRule: PublishedScheme;
  let sDraft: PublishedScheme;
  let sInactive: PublishedScheme;
  let sClosed: PublishedScheme;
  let sRetired: PublishedScheme;
  let sFuture: PublishedScheme;

  const api = (a: { accessToken: string }) => as(ctx, a.accessToken);
  const errorCode = (res: { body: { error?: { code?: string } } }) =>
    res.body.error?.code;
  const recBase = (p: string, enterpriseId = w.enterpriseId) =>
    `/enterprises/${enterpriseId}/projects/${p}/scheme-recommendations`;
  const recs = async (p: string, actor: Actor = w.owner, query = '') =>
    (
      await api(actor)
        .get(`${recBase(p)}${query}`)
        .expect(200)
    ).body;
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const find = (body: any, s: PublishedScheme): any =>
    body.recommendations.find((r: any) => r.scheme.id === s.id);
  const ids = (body: any): string[] =>
    body.recommendations.map((r: any) => r.scheme.id);
  /* eslint-enable @typescript-eslint/no-explicit-any */

  const grant = async (
    rep: Actor,
    scope: string,
    extra: Record<string, unknown> = {},
    accept = true,
  ) => {
    const res = await api(w.owner)
      .post(`/enterprises/${w.enterpriseId}/representatives`)
      .send({ emailOrMobile: rep.user.email, scope, ...extra })
      .expect(201);
    if (accept) {
      await api(rep)
        .post(`/representative-authorisations/${res.body.id}/accept`)
        .expect(200);
    }
  };

  beforeAll(async () => {
    ctx = await createE2eContext();
    w = await buildSchemeWorld(ctx, 'sr');
    P1 = (
      await ctx.createProjectVia(w.owner.accessToken, w.enterpriseId, 'sr-p1')
    ).id;
    P2 = (
      await ctx.createProjectVia(w.owner.accessToken, w.enterpriseId, 'sr-p2', {
        district: 'Nagpur',
        enterpriseSizeBand: 'medium',
        investmentAmount: 900_000_000,
      })
    ).id;
    [repView, repFull, repP2, repPending] = await Promise.all(
      ['view', 'full', 'p2', 'pending'].map((t) =>
        ctx.applicantSession(`sr-rep-${t}`),
      ),
    );
    await grant(repView, 'VIEW_ONLY');
    await grant(repFull, 'FULL');
    await grant(repP2, 'PREPARE_SUBMIT', { projectIds: [P2] });
    await grant(repPending, 'FULL', {}, false);

    sMatch = await publishScheme(ctx, w, {
      rule: {
        all: [
          { field: 'district', op: 'equals', value: 'pune' },
          { field: 'enterprise_size_band', op: 'equals', value: 'small' },
        ],
      },
      ruleExtra: { priority: 20 },
      body: { benefitType: 'Type One' },
    });
    sFirst = await publishScheme(ctx, w, {
      department: 'B',
      rule: {
        field: 'investment_amount',
        op: 'between',
        value: [1_000_000, 50_000_000],
      },
      ruleExtra: { priority: 5 },
    });
    sNoMatch = await publishScheme(ctx, w, {
      rule: { field: 'district', op: 'equals', value: 'Nagpur' },
    });
    sNoRule = await publishScheme(ctx, w, { rule: null });
    sDraft = await publishScheme(ctx, w, { publish: false });
    sInactive = await publishScheme(ctx, w, {});
    await api(w.soA)
      .put(`/scheme-officer/schemes/${sInactive.id}/active`)
      .send({ isActive: false })
      .expect(200);
    sClosed = await publishScheme(ctx, w, {
      body: { applicationDeadline: '2000-01-01T00:00:00.000Z' },
    });
    // v1 matches everything, v2 RETIRES the rule: the scheme is then not
    // recommended - an older version is never used instead.
    sRetired = await publishScheme(ctx, w, { publish: false });
    await api(w.soA)
      .post(`/scheme-officer/schemes/${sRetired.id}/rules`)
      .send({
        conditions: { field: 'district', op: 'equals', value: 'Pune' },
        sourceReference: 'E2E TEST FIXTURE',
        isActive: false,
      })
      .expect(201);
    await api(w.adminA)
      .post(`/scheme-officer/schemes/${sRetired.id}/publish`)
      .expect(200);
    // a version that has not taken effect yet does not apply
    sFuture = await publishScheme(ctx, w, {
      ruleExtra: {
        effectiveFrom: new Date(Date.now() + 86_400_000).toISOString(),
      },
    });
  });

  afterAll(async () => {
    await ctx.cleanup();
    await ctx.app.close();
  });

  describe('the recommendation (FRD 29.3 / 29.4, TRD 15)', () => {
    it('suggests the published schemes whose rule holds, ranked by the department priority, each labelled a suggestion', async () => {
      const body = await recs(P1);
      const first = find(body, sFirst);
      const match = find(body, sMatch);
      expect(first).toBeDefined();
      expect(match).toBeDefined();
      expect(first!.label).toBe('MAY_BE_ELIGIBLE');
      expect(match!.label).toBe('MAY_BE_ELIGIBLE');
      // priority 5 before priority 20
      expect(first!.rank).toBeLessThan(match!.rank);
      expect(ids(body).indexOf(sFirst.id)).toBeLessThan(
        ids(body).indexOf(sMatch.id),
      );
      expect(body.recommendations.map((r: { rank: number }) => r.rank)).toEqual(
        body.recommendations.map((_: unknown, i: number) => i + 1),
      );
    });

    it('carries the FRD 29.4 wording on every item, and never states or implies eligibility', async () => {
      const body = await recs(P1);
      expect(body.recommendations.length).toBeGreaterThan(0);
      for (const r of body.recommendations) {
        expect(r.notice).toBe(FRD_NOTICE);
        expect(r.label).toBe('MAY_BE_ELIGIBLE');
        expect(r.explanation).toMatch(/^Suggested because:/);
      }
      expect(body.notice).toContain(
        'not an official eligibility determination',
      );
      expect(body.notice).toContain('never implies approval');
    });

    it('explains each suggestion: rule version, source and the condition-by-condition trace', async () => {
      const match = find(await recs(P1), sMatch)!;
      expect(match.rule).toMatchObject({
        id: sMatch.ruleId,
        version: 1,
        priority: 20,
        sourceReference: 'E2E TEST FIXTURE',
      });
      expect(match.explanation).toEqual(expect.stringContaining('district'));
      expect(match.trace).toMatchObject({ result: true });
      expect(JSON.stringify(match.trace)).toContain('Pune');
    });

    it('does not suggest a scheme whose rule does not hold for THIS project', async () => {
      const p1 = await recs(P1);
      expect(find(p1, sNoMatch)).toBeUndefined();
      // P2 (Nagpur, medium, 900M): the Nagpur scheme matches, the Pune / investment ones do not
      const p2 = await recs(P2);
      expect(find(p2, sNoMatch)).toBeDefined();
      expect(find(p2, sMatch)).toBeUndefined();
      expect(find(p2, sFirst)).toBeUndefined();
    });

    it('never suggests a scheme with no rule, a draft, an inactive scheme, a retired rule or one not yet in effect', async () => {
      const body = await recs(P1);
      for (const s of [sNoRule, sDraft, sInactive, sRetired, sFuture]) {
        expect(find(body, s)).toBeUndefined();
      }
    });

    it('still lists a scheme whose deadline has passed, flagged as no longer open', async () => {
      const closed = find(await recs(P1), sClosed)!;
      expect(closed).toBeDefined();
      expect(closed.scheme.applicationOpen).toBe(false);
      expect(closed.scheme.applicationDeadline).toBe(
        '2000-01-01T00:00:00.000Z',
      );
    });

    it('is deterministic: the same project gives the same list, and it changes nothing', async () => {
      const before = await ctx.prisma.schemeApplication.count({
        where: { projectId: P1 },
      });
      const a = await recs(P1);
      const b = await recs(P1);
      const strip = (x: typeof a) =>
        x.recommendations.map(
          (r: {
            scheme: { id: string };
            rank: number;
            explanation: string;
          }) => [r.scheme.id, r.rank, r.explanation],
        );
      expect(strip(b)).toEqual(strip(a));
      expect(
        await ctx.prisma.schemeApplication.count({ where: { projectId: P1 } }),
      ).toBe(before);
    });

    it('can be limited to the first N of the ranked list', async () => {
      const body = await recs(P1, w.owner, '?limit=1');
      expect(body.recommendations).toHaveLength(1);
      expect(body.recommendations[0].rank).toBe(1);
      await api(w.owner)
        .get(`${recBase(P1)}?limit=0`)
        .expect(400);
      await api(w.owner)
        .get(`${recBase(P1)}?limit=1000`)
        .expect(400);
    });

    it('shows the scheme as an applicant reads it - and none of the internal configuration', async () => {
      const match = find(await recs(P1), sMatch)!;
      expect(match.scheme).toMatchObject({
        id: sMatch.id,
        name: sMatch.name,
        benefitType: 'Type One',
        applicationOpen: true,
      });
      for (const internal of [
        'rules',
        'publishStatus',
        'createdByUserId',
        'version',
        'conditions',
      ]) {
        expect(match.scheme).not.toHaveProperty(internal);
      }
      expect(JSON.stringify(match)).not.toContain(w.soA.user.id);
    });
  });

  describe('who may see the recommendation (existing enterprise / project access)', () => {
    it('owner and representatives with any live scope; a project-restricted representative only for their projects', async () => {
      await api(w.owner).get(recBase(P1)).expect(200);
      await api(repView).get(recBase(P1)).expect(200);
      await api(repFull).get(recBase(P1)).expect(200);
      await api(repP2).get(recBase(P2)).expect(200);
      const denied = await api(repP2).get(recBase(P1)).expect(403);
      expect(errorCode(denied)).toBe('FORBIDDEN_SCOPE');
    });

    it("another enterprise's owner, an unaccepted representative and a stranger get a 404; the unauthenticated a 401", async () => {
      await api(w.owner2).get(recBase(P1)).expect(404);
      await api(repPending).get(recBase(P1)).expect(404);
      await request(ctx.http)
        .get(`${API}${recBase(P1)}`)
        .expect(401);
      // a project of ANOTHER enterprise cannot be reached through this one
      const other = await ctx.createProjectVia(
        w.owner2.accessToken,
        w.enterprise2Id,
        'sr-other',
      );
      await api(w.owner).get(recBase(other.id)).expect(404);
    });

    it('officers, including a Scheme Officer, have no relationship to the enterprise, so no way in (404)', async () => {
      for (const officer of [w.soA, w.adminA, w.scrutinyA, w.sysAdmin]) {
        await api(officer).get(recBase(P1)).expect(404);
      }
    });
  });

  describe('applying (FRD 29.4 / 29.5): a distinct step from the recommendation', () => {
    let appMatch: { id: string; referenceNumber: string };

    it('creates the application in the first documented status, with a reference number, timeline and the recommendation recorded', async () => {
      const res = await applyFor(
        ctx,
        w.owner.accessToken,
        w.enterpriseId,
        P1,
        sMatch.id,
      ).expect(201);
      appMatch = res.body;
      expect(res.body).toMatchObject({
        status: 'APPLIED',
        enterpriseId: w.enterpriseId,
        projectId: P1,
        scheme: {
          id: sMatch.id,
          name: sMatch.name,
          department: { id: w.deptA.id },
        },
        decidedAt: null,
        decisionReason: null,
        disbursedAt: null,
        evidenceEditable: true,
        recommendation: {
          status: 'RECOMMENDED',
          rule: { id: sMatch.ruleId, version: 1 },
          notice: FRD_NOTICE,
        },
      });
      expect(res.body.referenceNumber).toMatch(/^SCH-\d{4}-\d{6}$/);
      expect(res.body.submittedAt).toEqual(expect.any(String));
      expect(res.body.timeline).toEqual([
        expect.objectContaining({
          fromStatus: null,
          toStatus: 'APPLIED',
          reason: null,
        }),
      ]);
    });

    it('records what the system suggested - including "no rule" and "not suggested" - but a recommendation is not required to apply', async () => {
      const none = await applyFor(
        ctx,
        w.owner.accessToken,
        w.enterpriseId,
        P1,
        sNoRule.id,
      ).expect(201);
      expect(none.body.recommendation).toMatchObject({
        status: 'NO_RULE',
        rule: null,
        explanation: null,
      });
      const notSuggested = await applyFor(
        ctx,
        w.owner.accessToken,
        w.enterpriseId,
        P1,
        sNoMatch.id,
      ).expect(201);
      expect(notSuggested.body.recommendation).toMatchObject({
        status: 'NOT_RECOMMENDED',
        rule: { id: sNoMatch.ruleId },
      });
      expect(notSuggested.body.recommendation.explanation).toMatch(
        /^Not suggested because:/,
      );
      expect(notSuggested.body.status).toBe('APPLIED');
    });

    it('audits the application with actor, role, enterprise, project, scheme and the rule version used', async () => {
      const [event] = await ctx.prisma.auditLog.findMany({
        where: { entityId: appMatch.id, action: 'SCHEME_APPLICATION_CREATED' },
      });
      expect(event).toMatchObject({
        userId: w.owner.user.id,
        roleAtTime: 'APPLICANT',
        entityType: 'SchemeApplication',
        ruleVersionUsed: `${sMatch.ruleId}@v1`,
      });
      expect(event.afterState).toMatchObject({
        enterpriseId: w.enterpriseId,
        projectId: P1,
        schemeId: sMatch.id,
        departmentId: w.deptA.id,
        schemeApplicationId: appMatch.id,
        referenceNumber: appMatch.referenceNumber,
        status: 'APPLIED',
        recommendationStatus: 'RECOMMENDED',
        actingAs: 'OWNER',
      });
    });

    it('is one live application per scheme per project, even when raced', async () => {
      const dup = await applyFor(
        ctx,
        w.owner.accessToken,
        w.enterpriseId,
        P1,
        sMatch.id,
      ).expect(409);
      expect(errorCode(dup)).toBe('SCHEME_APPLICATION_ALREADY_EXISTS');
      // a different project may apply for the same scheme; concurrent duplicates yield exactly one
      const results = await Promise.all(
        [1, 2, 3].map(() =>
          applyFor(ctx, w.owner.accessToken, w.enterpriseId, P2, sMatch.id),
        ),
      );
      expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409]);
      const conflicts = results.filter((r) => r.status === 409);
      expect(
        conflicts.every(
          (r) => errorCode(r) === 'SCHEME_APPLICATION_ALREADY_EXISTS',
        ),
      ).toBe(true);
    });

    it('refuses a draft, an inactive or an unknown scheme (404) and one past its deadline (409)', async () => {
      await applyFor(
        ctx,
        w.owner.accessToken,
        w.enterpriseId,
        P1,
        sDraft.id,
      ).expect(404);
      await applyFor(
        ctx,
        w.owner.accessToken,
        w.enterpriseId,
        P1,
        sInactive.id,
      ).expect(404);
      await applyFor(
        ctx,
        w.owner.accessToken,
        w.enterpriseId,
        P1,
        '00000000-0000-4000-8000-000000000000',
      ).expect(404);
      await applyFor(
        ctx,
        w.owner.accessToken,
        w.enterpriseId,
        P1,
        'not-a-uuid',
      ).expect(400);
      const closed = await applyFor(
        ctx,
        w.owner.accessToken,
        w.enterpriseId,
        P1,
        sClosed.id,
      ).expect(409);
      expect(errorCode(closed)).toBe('SCHEME_APPLICATION_CLOSED');
    });

    it('takes no status, owner, enterprise or project from the client', async () => {
      const res = await applyFor(
        ctx,
        w.owner.accessToken,
        w.enterpriseId,
        P1,
        sFirst.id,
      )
        .send({
          status: 'APPROVED',
          createdByUserId: w.owner2.user.id,
          projectId: P2,
        })
        .expect(201);
      expect(res.body).toMatchObject({ status: 'APPLIED', projectId: P1 });
      const row = await ctx.prisma.schemeApplication.findUniqueOrThrow({
        where: { id: res.body.id },
      });
      expect(row.createdByUserId).toBe(w.owner.user.id);
    });

    it('a live application shows against the recommendation', async () => {
      const match = find(await recs(P1), sMatch)!;
      expect(match.existingApplication).toMatchObject({
        id: appMatch.id,
        referenceNumber: appMatch.referenceNumber,
        status: 'APPLIED',
      });
    });

    it('needs Prepare & Submit: a View Only representative cannot apply, a restricted one only for their project', async () => {
      const view = await applyFor(
        ctx,
        repView.accessToken,
        w.enterpriseId,
        P2,
        sFirst.id,
      ).expect(403);
      expect(errorCode(view)).toBe('FORBIDDEN_SCOPE');
      const wrongProject = await applyFor(
        ctx,
        repP2.accessToken,
        w.enterpriseId,
        P1,
        sNoRule.id,
      ).expect(403);
      expect(errorCode(wrongProject)).toBe('FORBIDDEN_SCOPE');
      const ok = await applyFor(
        ctx,
        repP2.accessToken,
        w.enterpriseId,
        P2,
        sNoRule.id,
      ).expect(201);
      expect(ok.body.status).toBe('APPLIED');
      const row = await ctx.prisma.schemeApplication.findUniqueOrThrow({
        where: { id: ok.body.id },
      });
      expect(row.createdByUserId).toBe(repP2.user.id);
      const [event] = await ctx.prisma.auditLog.findMany({
        where: { entityId: ok.body.id, action: 'SCHEME_APPLICATION_CREATED' },
      });
      expect(event.afterState).toMatchObject({
        actingAs: 'REPRESENTATIVE',
        representativeScope: 'PREPARE_SUBMIT',
      });
    });

    it('another enterprise, an unaccepted representative and a stranger cannot apply on this project', async () => {
      await applyFor(
        ctx,
        w.owner2.accessToken,
        w.enterpriseId,
        P1,
        sNoRule.id,
      ).expect(404);
      await applyFor(
        ctx,
        repPending.accessToken,
        w.enterpriseId,
        P1,
        sNoRule.id,
      ).expect(404);
      await request(ctx.http)
        .post(
          `${API}/enterprises/${w.enterpriseId}/projects/${P1}/schemes/${sNoRule.id}/apply`,
        )
        .expect(401);
      for (const officer of [w.soA, w.adminA, w.sysAdmin]) {
        await applyFor(
          ctx,
          officer.accessToken,
          w.enterpriseId,
          P1,
          sNoRule.id,
        ).expect(404);
      }
    });

    it('freezes what was applied on: later catalogue edits and rule changes never rewrite it', async () => {
      const before = await ctx.prisma.schemeApplication.findUniqueOrThrow({
        where: { id: appMatch.id },
      });
      await api(w.soA)
        .post(`/scheme-officer/schemes/${sMatch.id}/unpublish`)
        .expect(200);
      await api(w.soA)
        .put(`/scheme-officer/schemes/${sMatch.id}`)
        .send({ benefits: 'Rewritten after applications were made' })
        .expect(200);
      await api(w.soA)
        .post(`/scheme-officer/schemes/${sMatch.id}/rules`)
        .send({
          conditions: { field: 'district', op: 'equals', value: 'nowhere' },
          sourceReference: 'TBD',
        })
        .expect(201);
      await api(w.adminA)
        .post(`/scheme-officer/schemes/${sMatch.id}/publish`)
        .expect(200);

      const after = await ctx.prisma.schemeApplication.findUniqueOrThrow({
        where: { id: appMatch.id },
      });
      expect(after.catalogueSnapshot).toEqual(before.catalogueSnapshot);
      expect(after.catalogueSnapshot).toMatchObject({
        scheme: { name: sMatch.name, benefitType: 'Type One' },
        recommendation: {
          status: 'RECOMMENDED',
          rule: { id: sMatch.ruleId, version: 1 },
        },
      });
      const view = await api(w.owner)
        .get(schemeApplicationBase(w.enterpriseId, P1, appMatch.id))
        .expect(200);
      expect(view.body.recommendation).toMatchObject({
        status: 'RECOMMENDED',
        rule: { version: 1 },
      });
      // and the database refuses to change it, whatever the application does
      await expect(
        ctx.prisma
          .$executeRaw`UPDATE scheme_applications SET catalogue_snapshot = '{}'::jsonb WHERE id = ${appMatch.id}::uuid`,
      ).rejects.toThrow();
      // the new rule version now applies to NEW recommendations (highest effective version)
      expect(find(await recs(P1), sMatch)).toBeUndefined();
    });
  });

  describe('tracking (FRD 29.5)', () => {
    let mine: { id: string };

    beforeAll(async () => {
      mine = (
        await applyFor(
          ctx,
          w.owner.accessToken,
          w.enterpriseId,
          P2,
          sFirst.id,
        ).expect(201)
      ).body;
    });

    it('shows reference number, status, timeline and scheme - and no officer identity', async () => {
      const res = await api(w.owner)
        .get(schemeApplicationBase(w.enterpriseId, P2, mine.id))
        .expect(200);
      expect(res.body).toMatchObject({
        id: mine.id,
        status: 'APPLIED',
        projectId: P2,
      });
      expect(Object.keys(res.body.timeline[0]).sort()).toEqual([
        'at',
        'fromStatus',
        'reason',
        'toStatus',
      ]);
      for (const hidden of [
        'decidedByUserId',
        'appliedByUserId',
        'catalogueSnapshot',
        'actorUserId',
      ]) {
        expect(JSON.stringify(res.body)).not.toContain(hidden);
      }
    });

    it('lists an enterprise’s applications and a project’s, filtered by status', async () => {
      const all = await api(w.owner)
        .get(`/enterprises/${w.enterpriseId}/scheme-applications`)
        .expect(200);
      expect(all.body.map((a: { id: string }) => a.id)).toContain(mine.id);
      const forProject = await api(w.owner)
        .get(
          `/enterprises/${w.enterpriseId}/projects/${P2}/scheme-applications`,
        )
        .expect(200);
      expect(
        forProject.body.every((a: { projectId: string }) => a.projectId === P2),
      ).toBe(true);
      const none = await api(w.owner)
        .get(
          `/enterprises/${w.enterpriseId}/scheme-applications?status=DISBURSED`,
        )
        .expect(200);
      expect(none.body).toEqual([]);
      await api(w.owner)
        .get(`/enterprises/${w.enterpriseId}/scheme-applications?status=NOPE`)
        .expect(400);
    });

    it('a project-restricted representative sees only their projects’ applications', async () => {
      const own = await api(repP2)
        .get(`/enterprises/${w.enterpriseId}/scheme-applications`)
        .expect(200);
      expect(own.body.length).toBeGreaterThan(0);
      expect(
        own.body.every((a: { projectId: string }) => a.projectId === P2),
      ).toBe(true);
      const other = await api(repP2)
        .get(
          `/enterprises/${w.enterpriseId}/scheme-applications?projectId=${P1}`,
        )
        .expect(200);
      expect(other.body).toEqual([]);
      await api(repP2)
        .get(
          `/enterprises/${w.enterpriseId}/projects/${P1}/scheme-applications`,
        )
        .expect(403);
      await api(repP2)
        .get(schemeApplicationBase(w.enterpriseId, P1, appIdOf(mine)))
        .expect(403);
    });

    it('a View Only representative can read; another enterprise or a stranger cannot even tell it exists', async () => {
      await api(repView)
        .get(schemeApplicationBase(w.enterpriseId, P2, mine.id))
        .expect(200);
      await api(w.owner2)
        .get(schemeApplicationBase(w.enterpriseId, P2, mine.id))
        .expect(404);
      await api(repPending)
        .get(schemeApplicationBase(w.enterpriseId, P2, mine.id))
        .expect(404);
      // the right id through the wrong project / enterprise is a 404, like a nonexistent one
      await api(w.owner)
        .get(schemeApplicationBase(w.enterpriseId, P1, mine.id))
        .expect(404);
      await api(w.owner2)
        .get(schemeApplicationBase(w.enterprise2Id, P2, mine.id))
        .expect(404);
      await api(w.owner)
        .get(
          schemeApplicationBase(
            w.enterpriseId,
            P2,
            '00000000-0000-4000-8000-000000000000',
          ),
        )
        .expect(404);
      await api(w.owner)
        .get(schemeApplicationBase(w.enterpriseId, P2, 'nope'))
        .expect(400);
    });

    it('offers no way to write a status', async () => {
      const base = schemeApplicationBase(w.enterpriseId, P2, mine.id);
      for (const call of [
        api(w.owner).put(base).send({ status: 'APPROVED' }),
        api(w.owner).patch(base).send({ status: 'APPROVED' }),
        api(w.owner).post(`${base}/status`).send({ status: 'APPROVED' }),
        api(w.owner).post(`${base}/approve`).send({}),
        api(w.owner).del(base),
      ]) {
        expect((await call).status).toBe(404);
      }
      const row = await ctx.prisma.schemeApplication.findUniqueOrThrow({
        where: { id: mine.id },
      });
      expect(row.status).toBe('APPLIED');
    });

    it('PostgreSQL itself refuses any status change that is not a documented transition, and edits to history', async () => {
      // straight to APPROVED, skipping review
      await expect(
        ctx.prisma
          .$executeRaw`UPDATE scheme_applications SET status = 'APPROVED', decided_at = now(), decided_by_user_id = ${w.soA.user.id}::uuid, decision_reason = 'x' WHERE id = ${mine.id}::uuid`,
      ).rejects.toThrow();
      // a decision without a reason cannot even be written from UNDER_REVIEW
      await expect(
        ctx.prisma
          .$executeRaw`UPDATE scheme_applications SET status = 'DISBURSED', disbursed_at = now() WHERE id = ${mine.id}::uuid`,
      ).rejects.toThrow();
      await expect(
        ctx.prisma
          .$executeRaw`UPDATE scheme_application_status_history SET reason = 'x' WHERE scheme_application_id = ${mine.id}::uuid`,
      ).rejects.toThrow();
      await expect(
        ctx.prisma
          .$executeRaw`UPDATE scheme_applications SET reference_number = 'SCH-0000-000000' WHERE id = ${mine.id}::uuid`,
      ).rejects.toThrow();
      const row = await ctx.prisma.schemeApplication.findUniqueOrThrow({
        where: { id: mine.id },
      });
      expect(row.status).toBe('APPLIED');
    });
  });

  it('applying raises no notification (only status UPDATES do)', async () => {
    const inbox = await api(w.owner)
      .get('/notifications?pageSize=100')
      .expect(200);
    expect(
      inbox.body.items.filter(
        (n: { eventType: string }) =>
          n.eventType === 'SCHEME_APPLICATION_STATUS_UPDATE',
      ),
    ).toEqual([]);
  });
});

const appIdOf = (a: { id: string }) => a.id;
