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
import { NotificationEventsService } from '../src/modules/notifications/notification-events.service';

jest.setTimeout(600_000);

const OFFICER = '/scheme-officer/scheme-applications';

/**
 * Step 16 - the Scheme Officer's workflow: the documented status flow (Applied ->
 * Under Review -> Approved / Rejected -> Disbursed) as explicit actions, who may
 * take them, the audit trail and the applicant's notifications - over real HTTP
 * -> Nest -> Prisma -> PostgreSQL. Every scheme is a labelled test fixture.
 */
describe('Schemes e2e - Scheme Officer workflow, audit and notifications', () => {
  let ctx: E2eContext;
  let w: SchemeWorld;
  let P2: string;
  let scheme: PublishedScheme;
  let schemeB: PublishedScheme; // department B's
  let repFull: Actor;
  let repView: Actor;
  let repP2: Actor; // restricted to P2
  let repPending: Actor;
  let repRevoked: Actor;
  let counter = 0;

  const api = (a: { accessToken: string }) => as(ctx, a.accessToken);
  const errorCode = (res: { body: { error?: { code?: string } } }) =>
    res.body.error?.code;

  /** A fresh APPLIED application of `s` on its own project (so applications never
   * collide on the one-live-application rule). */
  const applied = async (s: PublishedScheme = scheme, tag = 'a') => {
    counter += 1;
    const project = await ctx.createProjectVia(
      w.owner.accessToken,
      w.enterpriseId,
      `so-${tag}-${counter}`,
    );
    const res = await applyFor(
      ctx,
      w.owner.accessToken,
      w.enterpriseId,
      project.id,
      s.id,
    ).expect(201);
    return {
      id: res.body.id as string,
      projectId: project.id,
      referenceNumber: res.body.referenceNumber as string,
    };
  };
  const act = (a: Actor, id: string, action: string, body?: object) =>
    api(a)
      .post(`${OFFICER}/${id}/${action}`)
      .send(body ?? {});
  const decide = (a: Actor, id: string, outcome: string, reason?: string) =>
    act(a, id, 'decision', {
      outcome,
      ...(reason === undefined ? {} : { reason }),
    });
  const status = async (id: string) =>
    (await ctx.prisma.schemeApplication.findUniqueOrThrow({ where: { id } }))
      .status;
  const audits = (entityId: string, action?: string) =>
    ctx.prisma.auditLog.findMany({
      where: { entityId, ...(action ? { action } : {}) },
      orderBy: { createdAt: 'asc' },
    });

  interface N {
    eventType: string;
    title: string;
    message: string;
    applicationId: string | null;
    projectId: string | null;
    enterpriseId: string | null;
    payload: Record<string, unknown> | null;
  }
  const updates = async (a: Actor, applicationId?: string): Promise<N[]> =>
    (
      (await api(a).get('/notifications?pageSize=100').expect(200)).body
        .items as N[]
    ).filter(
      (n) =>
        n.eventType === 'SCHEME_APPLICATION_STATUS_UPDATE' &&
        (applicationId === undefined ||
          n.payload?.schemeApplicationId === applicationId),
    );

  const grant = async (
    rep: Actor,
    scope: string,
    extra: Record<string, unknown> = {},
    accept = true,
  ): Promise<string> => {
    const res = await api(w.owner)
      .post(`/enterprises/${w.enterpriseId}/representatives`)
      .send({ emailOrMobile: rep.user.email, scope, ...extra })
      .expect(201);
    if (accept) {
      await api(rep)
        .post(`/representative-authorisations/${res.body.id}/accept`)
        .expect(200);
    }
    return res.body.id;
  };

  beforeAll(async () => {
    ctx = await createE2eContext();
    w = await buildSchemeWorld(ctx, 'so');
    P2 = (
      await ctx.createProjectVia(w.owner.accessToken, w.enterpriseId, 'so-p2')
    ).id;
    [repFull, repView, repP2, repPending, repRevoked] = await Promise.all(
      ['full', 'view', 'p2', 'pending', 'revoked'].map((t) =>
        ctx.applicantSession(`so-rep-${t}`),
      ),
    );
    await grant(repFull, 'FULL');
    await grant(repView, 'VIEW_ONLY');
    await grant(repP2, 'PREPARE_SUBMIT', { projectIds: [P2] });
    await grant(repPending, 'FULL', {}, false);
    const revokedId = await grant(repRevoked, 'FULL');
    await api(w.owner)
      .del(`/enterprises/${w.enterpriseId}/representatives/${revokedId}`)
      .expect(200);
    scheme = await publishScheme(ctx, w, {});
    schemeB = await publishScheme(ctx, w, { department: 'B' });
  });

  afterAll(async () => {
    await ctx.cleanup();
    await ctx.app.close();
  });

  describe('the documented flow, as explicit actions', () => {
    let a: Awaited<ReturnType<typeof applied>>;

    beforeAll(async () => {
      a = await applied(scheme, 'flow');
    });

    it('refuses every action that is not the next step: no deciding before review, no skipping, no disbursing early', async () => {
      for (const attempt of [
        decide(w.soA, a.id, 'APPROVE', 'Too early'),
        decide(w.soA, a.id, 'REJECT', 'Too early'),
        act(w.soA, a.id, 'disburse'),
      ]) {
        const res = await attempt.expect(409);
        expect(errorCode(res)).toBe('INVALID_STATE_TRANSITION');
      }
      expect(await status(a.id)).toBe('APPLIED');
    });

    it('starts the review: Applied -> Under Review', async () => {
      const res = await act(w.soA, a.id, 'start-review').expect(200);
      expect(res.body).toMatchObject({
        id: a.id,
        status: 'UNDER_REVIEW',
        availableActions: ['APPROVE', 'REJECT'],
        decisionReason: null,
        decidedAt: null,
      });
      expect(
        res.body.timeline.map((t: { toStatus: string }) => t.toStatus),
      ).toEqual(['APPLIED', 'UNDER_REVIEW']);
      const again = await act(w.soA, a.id, 'start-review').expect(409);
      expect(errorCode(again)).toBe('INVALID_STATE_TRANSITION');
    });

    it('a decision needs an outcome from the documented pair and a reason, and takes nothing else from the client', async () => {
      for (const bad of [
        {},
        { outcome: 'APPROVE' },
        { outcome: 'APPROVE', reason: '   ' },
        { outcome: 'REJECT', reason: '' },
        { outcome: 'MAYBE', reason: 'x' },
        { outcome: 'APPROVE', reason: 'ok', status: 'DISBURSED' },
        { outcome: 'APPROVE', reason: 'ok', decidedByUserId: w.owner.user.id },
        { outcome: 'APPROVE', reason: 'ok', amount: 100000 },
        { outcome: 'APPROVE', reason: 'x'.repeat(2001) },
      ]) {
        const res = await act(w.soA, a.id, 'decision', bad).expect(400);
        expect(errorCode(res)).toBe('VALIDATION_ERROR');
      }
      expect(await status(a.id)).toBe('UNDER_REVIEW');
    });

    it('approves with a reason: Under Review -> Approved, recording who and when', async () => {
      const res = await decide(
        w.soA,
        a.id,
        'APPROVE',
        'Reason for the approval',
      ).expect(200);
      expect(res.body).toMatchObject({
        status: 'APPROVED',
        decisionReason: 'Reason for the approval',
        decidedByUserId: w.soA.user.id,
        disbursedAt: null,
        availableActions: ['DISBURSE'],
      });
      expect(res.body.decidedAt).toEqual(expect.any(String));
      // a decision is made once
      for (const again of [
        decide(w.soA, a.id, 'APPROVE', 'Twice'),
        decide(w.soA, a.id, 'REJECT', 'Changed my mind'),
        act(w.soA, a.id, 'start-review'),
      ]) {
        expect(errorCode(await again.expect(409))).toBe(
          'INVALID_STATE_TRANSITION',
        );
      }
    });

    it('records disbursement as a status marker only, and is then the end of the line', async () => {
      const res = await act(w.soA, a.id, 'disburse').expect(200);
      expect(res.body).toMatchObject({
        status: 'DISBURSED',
        availableActions: [],
        decisionReason: 'Reason for the approval',
      });
      expect(res.body.disbursedAt).toEqual(expect.any(String));
      // no amount, payment or bank detail exists in the application record (the
      // project's own investment_amount input is the applicant's data, not a benefit)
      const recordKeys = Object.keys(res.body).filter(
        (key) => key !== 'projectInputs',
      );
      expect(recordKeys.join(' ')).not.toMatch(/amount|payment|bank|account/i);
      for (const again of [
        act(w.soA, a.id, 'disburse'),
        act(w.soA, a.id, 'start-review'),
        decide(w.soA, a.id, 'REJECT', 'Too late'),
      ]) {
        await again.expect(409);
      }
      expect(await status(a.id)).toBe('DISBURSED');
    });

    it('keeps a complete history: every change, who made it in which role, and the reason on the decision', async () => {
      const res = await api(w.soA).get(`${OFFICER}/${a.id}`).expect(200);
      expect(
        res.body.timeline.map(
          (t: { fromStatus: string | null; toStatus: string }) => [
            t.fromStatus,
            t.toStatus,
          ],
        ),
      ).toEqual([
        [null, 'APPLIED'],
        ['APPLIED', 'UNDER_REVIEW'],
        ['UNDER_REVIEW', 'APPROVED'],
        ['APPROVED', 'DISBURSED'],
      ]);
      expect(
        res.body.timeline.map((t: { actorRole: string }) => t.actorRole),
      ).toEqual([
        'APPLICANT',
        'SCHEME_OFFICER',
        'SCHEME_OFFICER',
        'SCHEME_OFFICER',
      ]);
      expect(res.body.timeline[0].actorUserId).toBe(w.owner.user.id);
      expect(res.body.timeline[2]).toMatchObject({
        actorUserId: w.soA.user.id,
        reason: 'Reason for the approval',
      });
      const rows = await ctx.prisma.schemeApplicationStatusHistory.count({
        where: { schemeApplicationId: a.id },
      });
      expect(rows).toBe(4);
    });

    it('shows the applicant the same flow and the decision reason - without naming any officer', async () => {
      const res = await api(w.owner)
        .get(schemeApplicationBase(w.enterpriseId, a.projectId, a.id))
        .expect(200);
      expect(res.body).toMatchObject({
        status: 'DISBURSED',
        decisionReason: 'Reason for the approval',
        evidenceEditable: false,
      });
      expect(
        res.body.timeline.map((t: { toStatus: string }) => t.toStatus),
      ).toEqual(['APPLIED', 'UNDER_REVIEW', 'APPROVED', 'DISBURSED']);
      // the reason belongs to the decision entry only
      expect(
        res.body.timeline.map((t: { reason: string | null }) => t.reason),
      ).toEqual([null, null, 'Reason for the approval', null]);
      expect(JSON.stringify(res.body)).not.toContain(w.soA.user.id);
      expect(JSON.stringify(res.body)).not.toContain('actorRole');
    });

    it('a rejection is final, needs no evidence, and does not stop the applicant applying again', async () => {
      const r = await applied(scheme, 'reject');
      await act(w.soA, r.id, 'start-review').expect(200);
      const res = await decide(
        w.soA,
        r.id,
        'REJECT',
        'Reason for the rejection',
      ).expect(200);
      expect(res.body).toMatchObject({
        status: 'REJECTED',
        decisionReason: 'Reason for the rejection',
        availableActions: [],
      });
      for (const attempt of [
        act(w.soA, r.id, 'disburse'),
        act(w.soA, r.id, 'start-review'),
        decide(w.soA, r.id, 'APPROVE', 'Reversal'),
      ]) {
        await attempt.expect(409);
      }
      // a rejected application is no longer live, so the project may apply afresh
      const again = await applyFor(
        ctx,
        w.owner.accessToken,
        w.enterpriseId,
        r.projectId,
        scheme.id,
      ).expect(201);
      expect(again.body.id).not.toBe(r.id);
      expect(again.body.status).toBe('APPLIED');
    });

    it('PostgreSQL refuses to record a decision without a reason, whatever the application does', async () => {
      const r = await applied(scheme, 'sql');
      await act(w.soA, r.id, 'start-review').expect(200);
      await expect(
        ctx.prisma
          .$executeRaw`UPDATE scheme_applications SET status = 'APPROVED', decided_at = now(), decided_by_user_id = ${w.soA.user.id}::uuid, decision_reason = '  ' WHERE id = ${r.id}::uuid`,
      ).rejects.toThrow();
      await expect(
        ctx.prisma
          .$executeRaw`UPDATE scheme_applications SET status = 'APPROVED', decided_at = now(), decision_reason = 'x' WHERE id = ${r.id}::uuid`,
      ).rejects.toThrow();
      expect(await status(r.id)).toBe('UNDER_REVIEW');
    });
  });

  describe('who may act (department-scoped Scheme Officers only)', () => {
    let a: Awaited<ReturnType<typeof applied>>;

    beforeAll(async () => {
      a = await applied(scheme, 'access');
    });

    it("another department's Scheme Officer sees nothing and can do nothing: the same 404 as a nonexistent application", async () => {
      await api(w.soB).get(`${OFFICER}/${a.id}`).expect(404);
      await act(w.soB, a.id, 'start-review').expect(404);
      await decide(w.soB, a.id, 'REJECT', 'x').expect(404);
      await act(w.soB, a.id, 'disburse').expect(404);
      await api(w.soB).get(`${OFFICER}/${a.id}/documents`).expect(404);
      await api(w.soB)
        .get(`${OFFICER}/${a.id}/document-requirements`)
        .expect(404);
      await api(w.soB)
        .get(`${OFFICER}/00000000-0000-4000-8000-000000000000`)
        .expect(404);
      expect(await status(a.id)).toBe('APPLIED');
    });

    it("the queue is the officer's own departments' applications only", async () => {
      const bApp = await applied(schemeB, 'b');
      const mine = await api(w.soA).get(`${OFFICER}?pageSize=100`).expect(200);
      const ids = mine.body.items.map((i: { id: string }) => i.id);
      expect(ids).toContain(a.id);
      expect(ids).not.toContain(bApp.id);
      const theirs = await api(w.soB)
        .get(`${OFFICER}?pageSize=100`)
        .expect(200);
      const theirIds = theirs.body.items.map((i: { id: string }) => i.id);
      expect(theirIds).toContain(bApp.id);
      expect(theirIds).not.toContain(a.id);
      // and the other department's officer cannot act on it
      await act(w.soA, bApp.id, 'start-review').expect(404);
    });

    it('every Scheme Officer of the department sees and works the department’s applications (no assignment concept is defined)', async () => {
      await api(w.soA2).get(`${OFFICER}/${a.id}`).expect(200);
      const res = await act(w.soA2, a.id, 'start-review').expect(200);
      expect(res.body.status).toBe('UNDER_REVIEW');
      const changes = await audits(a.id, 'SCHEME_APPLICATION_STATUS_CHANGED');
      expect(changes[changes.length - 1].userId).toBe(w.soA2.user.id);
    });

    it('the queue can be filtered, searched and paged', async () => {
      const byStatus = await api(w.soA)
        .get(`${OFFICER}?status=UNDER_REVIEW&pageSize=100`)
        .expect(200);
      expect(
        byStatus.body.items.every(
          (i: { status: string }) => i.status === 'UNDER_REVIEW',
        ),
      ).toBe(true);
      const byRef = await api(w.soA)
        .get(`${OFFICER}?q=${encodeURIComponent(a.referenceNumber)}`)
        .expect(200);
      expect(byRef.body.items.map((i: { id: string }) => i.id)).toEqual([a.id]);
      const enterpriseName = (
        await ctx.prisma.enterprise.findUniqueOrThrow({
          where: { id: w.enterpriseId },
        })
      ).name;
      const byName = await api(w.soA)
        .get(
          `${OFFICER}?q=${encodeURIComponent(enterpriseName.toLowerCase())}&pageSize=1`,
        )
        .expect(200);
      expect(byName.body.items).toHaveLength(1);
      expect(byName.body.total).toBeGreaterThan(1);
      const bySchemeOfB = await api(w.soA)
        .get(`${OFFICER}?schemeId=${schemeB.id}`)
        .expect(200);
      expect(bySchemeOfB.body.items).toEqual([]);
      await api(w.soA).get(`${OFFICER}?status=NOPE`).expect(400);
      await api(w.soA).get(`${OFFICER}?pageSize=1000`).expect(400);
    });

    it('shows the officer the project the recommendation was made on, and what the system suggested (advice only)', async () => {
      const res = await api(w.soA).get(`${OFFICER}/${a.id}`).expect(200);
      expect(res.body).toMatchObject({
        id: a.id,
        appliedByUserId: w.owner.user.id,
        enterprise: { id: w.enterpriseId },
        project: { id: a.projectId },
        scheme: { id: scheme.id, department: { id: w.deptA.id } },
        recommendation: { status: 'RECOMMENDED', rule: { id: scheme.ruleId } },
      });
      expect(res.body.projectInputs).toMatchObject({
        district: 'Pune',
        enterprise_size_band: 'small',
        sector_code: '25910',
      });
    });

    it('no other role has a route: department administrator, scrutiny officer, system administrator, applicant, unauthenticated', async () => {
      for (const actor of [
        w.adminA,
        w.scrutinyA,
        w.sysAdmin,
        w.owner,
        w.legal,
      ]) {
        const list = await api(actor).get(OFFICER).expect(403);
        expect(errorCode(list)).toBe('INSUFFICIENT_ROLE');
        await api(actor).get(`${OFFICER}/${a.id}`).expect(403);
        await act(actor, a.id, 'start-review').expect(403);
        await decide(actor, a.id, 'APPROVE', 'x').expect(403);
        await act(actor, a.id, 'disburse').expect(403);
        await api(actor).get(`${OFFICER}/${a.id}/documents`).expect(403);
      }
      await request(ctx.http).get(`${API}${OFFICER}`).expect(401);
      await request(ctx.http)
        .post(`${API}${OFFICER}/${a.id}/decision`)
        .send({ outcome: 'APPROVE', reason: 'x' })
        .expect(401);
    });

    it('offers no way to write a status, and a malformed id is a 400', async () => {
      const base = `${OFFICER}/${a.id}`;
      for (const call of [
        api(w.soA).put(base).send({ status: 'APPROVED' }),
        api(w.soA).patch(base).send({ status: 'APPROVED' }),
        api(w.soA).post(`${base}/status`).send({ status: 'APPROVED' }),
        api(w.soA).del(base),
      ]) {
        expect((await call).status).toBe(404);
      }
      await api(w.soA).get(`${OFFICER}/nope`).expect(400);
    });
  });

  describe('races', () => {
    it('two officers starting the review together produce exactly one transition', async () => {
      const r = await applied(scheme, 'race1');
      const results = await Promise.all([
        act(w.soA, r.id, 'start-review'),
        act(w.soA2, r.id, 'start-review'),
      ]);
      expect(results.map((x) => x.status).sort()).toEqual([200, 409]);
      expect(
        await ctx.prisma.schemeApplicationStatusHistory.count({
          where: { schemeApplicationId: r.id, toStatus: 'UNDER_REVIEW' },
        }),
      ).toBe(1);
    });

    it('an approval racing a rejection yields exactly one decision', async () => {
      const r = await applied(scheme, 'race2');
      await act(w.soA, r.id, 'start-review').expect(200);
      const results = await Promise.all([
        decide(w.soA, r.id, 'APPROVE', 'Approve'),
        decide(w.soA2, r.id, 'REJECT', 'Reject'),
      ]);
      expect(results.map((x) => x.status).sort()).toEqual([200, 409]);
      expect(
        await ctx.prisma.schemeApplicationStatusHistory.count({
          where: {
            schemeApplicationId: r.id,
            toStatus: { in: ['APPROVED', 'REJECTED'] },
          },
        }),
      ).toBe(1);
      const row = await ctx.prisma.schemeApplication.findUniqueOrThrow({
        where: { id: r.id },
      });
      expect(['APPROVED', 'REJECTED']).toContain(row.status);
      expect(row.decisionReason).toBe(
        row.status === 'APPROVED' ? 'Approve' : 'Reject',
      );
    });
  });

  describe('audit (actor, role, enterprise, project, scheme and application on every change)', () => {
    it('records each transition with before / after, and the decision with its reason and what the system had suggested', async () => {
      const r = await applied(scheme, 'audit');
      await act(w.soA, r.id, 'start-review').expect(200);
      await decide(w.soA, r.id, 'APPROVE', 'Audited reason').expect(200);
      await act(w.soA, r.id, 'disburse').expect(200);

      const changes = await audits(r.id, 'SCHEME_APPLICATION_STATUS_CHANGED');
      expect(
        changes.map((c) => [
          (c.beforeState as { status: string }).status,
          (c.afterState as { status: string }).status,
        ]),
      ).toEqual([
        ['APPLIED', 'UNDER_REVIEW'],
        ['UNDER_REVIEW', 'APPROVED'],
        ['APPROVED', 'DISBURSED'],
      ]);
      for (const c of changes) {
        expect(c).toMatchObject({
          userId: w.soA.user.id,
          roleAtTime: 'SCHEME_OFFICER',
          entityType: 'SchemeApplication',
          ruleVersionUsed: `${scheme.ruleId}@v1`,
        });
        expect(c.afterState).toMatchObject({
          enterpriseId: w.enterpriseId,
          projectId: r.projectId,
          schemeId: scheme.id,
          departmentId: w.deptA.id,
          schemeApplicationId: r.id,
          referenceNumber: r.referenceNumber,
          actingAs: 'SCHEME_OFFICER',
          historyId: expect.any(String),
        });
      }
      expect(
        changes.map((c) => (c.afterState as { action: string }).action),
      ).toEqual(['START_REVIEW', 'APPROVE', 'DISBURSE']);
      const [decision] = await audits(
        r.id,
        'SCHEME_APPLICATION_DECISION_RECORDED',
      );
      expect(decision).toMatchObject({
        userId: w.soA.user.id,
        roleAtTime: 'SCHEME_OFFICER',
      });
      expect(decision.afterState).toMatchObject({
        outcome: 'APPROVE',
        reason: 'Audited reason',
        recommendationStatus: 'RECOMMENDED',
        isRecommendationOnly: false,
        schemeId: scheme.id,
      });
      // exactly one decision record, and none for the other transitions
      expect(
        await audits(r.id, 'SCHEME_APPLICATION_DECISION_RECORDED'),
      ).toHaveLength(1);
      expect(await audits(r.id, 'SCHEME_APPLICATION_CREATED')).toHaveLength(1);
    });

    it('a rejected action leaves no trace: no history, no audit, no notification', async () => {
      const r = await applied(scheme, 'noaudit');
      const before = (await audits(r.id)).length;
      await decide(w.soA, r.id, 'APPROVE', 'Too early').expect(409);
      await act(w.soB, r.id, 'start-review').expect(404);
      expect((await audits(r.id)).length).toBe(before);
      expect(
        await ctx.prisma.schemeApplicationStatusHistory.count({
          where: { schemeApplicationId: r.id },
        }),
      ).toBe(1);
      expect(await updates(w.owner, r.id)).toEqual([]);
    });
  });

  describe('notifications (FRD 26.1 "scheme application status update")', () => {
    let a: Awaited<ReturnType<typeof applied>>;
    const SECRET_REASON = 'Confidential wording of the reason';

    beforeAll(async () => {
      a = await applied(scheme, 'notify');
      await act(w.soA, a.id, 'start-review').expect(200);
      await decide(w.soA, a.id, 'REJECT', SECRET_REASON).expect(200);
    });

    it('notifies the applicant side once per status change, scoped to the enterprise and project', async () => {
      const mine = await updates(w.owner, a.id);
      expect(mine.map((n) => n.payload?.status).sort()).toEqual([
        'REJECTED',
        'UNDER_REVIEW',
      ]);
      for (const n of mine) {
        expect(n).toMatchObject({
          title: 'Scheme application status updated',
          enterpriseId: w.enterpriseId,
          projectId: a.projectId,
          applicationId: null,
        });
        expect(n.payload).toMatchObject({
          referenceNumber: a.referenceNumber,
          schemeApplicationId: a.id,
          schemeId: scheme.id,
        });
        expect(n.message).toContain(a.referenceNumber);
        expect(n.message).toContain(scheme.name);
      }
      const rejected = mine.find((n) => n.payload?.status === 'REJECTED')!;
      expect(rejected.message).toContain('is now rejected');
      expect(
        mine.find((n) => n.payload?.status === 'UNDER_REVIEW')!.message,
      ).toContain('is now under review');
    });

    it('never puts the decision reason (or an officer’s identity) in the message or payload', async () => {
      for (const n of await updates(w.owner, a.id)) {
        const text = JSON.stringify(n);
        expect(text).not.toContain(SECRET_REASON);
        expect(text).not.toContain(w.soA.user.id);
        expect(text).not.toMatch(/reason/i);
      }
    });

    it('reaches representatives who can currently see the project, and nobody else', async () => {
      expect(await updates(repFull, a.id)).toHaveLength(2);
      expect(await updates(repView, a.id)).toHaveLength(2);
      // restricted to another project, offered-but-unaccepted, revoked, another enterprise
      for (const other of [repP2, repPending, repRevoked, w.owner2]) {
        expect(await updates(other, a.id)).toEqual([]);
      }
      // officers are not recipients of the applicant's update
      for (const officer of [w.soA, w.soA2, w.adminA]) {
        expect(await updates(officer, a.id)).toEqual([]);
      }
    });

    it('a restricted representative is notified for their own project', async () => {
      // repP2 is limited to P2, so use P2 for its own application
      const own = await applyFor(
        ctx,
        w.owner.accessToken,
        w.enterpriseId,
        P2,
        scheme.id,
      ).expect(201);
      await act(w.soA, own.body.id, 'start-review').expect(200);
      expect(await updates(repP2, own.body.id)).toHaveLength(1);
      expect(await updates(repFull, own.body.id)).toHaveLength(1);
    });

    it('is idempotent: dispatching the same status change again creates nothing', async () => {
      const history = await ctx.prisma.schemeApplicationStatusHistory.findMany({
        where: { schemeApplicationId: a.id, toStatus: 'REJECTED' },
      });
      expect(history).toHaveLength(1);
      const before = await ctx.prisma.notification.count({
        where: {
          userId: w.owner.user.id,
          eventType: 'SCHEME_APPLICATION_STATUS_UPDATE',
        },
      });
      await ctx.app
        .get(NotificationEventsService)
        .schemeApplicationStatusUpdated(a.id, history[0].id);
      await ctx.app
        .get(NotificationEventsService)
        .schemeApplicationStatusUpdated(a.id, history[0].id);
      expect(
        await ctx.prisma.notification.count({
          where: {
            userId: w.owner.user.id,
            eventType: 'SCHEME_APPLICATION_STATUS_UPDATE',
          },
        }),
      ).toBe(before);
    });

    it('a notification for an unknown status change is ignored, never an error', async () => {
      await expect(
        ctx.app
          .get(NotificationEventsService)
          .schemeApplicationStatusUpdated(
            a.id,
            '00000000-0000-4000-8000-000000000000',
          ),
      ).resolves.toBeUndefined();
    });

    it('a notification stops being readable once the representative loses access', async () => {
      // repRevoked was revoked before the event: it has none. repFull keeps its own.
      expect((await updates(repFull, a.id)).length).toBe(2);
      const list = await api(repRevoked)
        .get('/notifications?pageSize=100')
        .expect(200);
      expect(
        list.body.items.filter(
          (n: N) => n.eventType === 'SCHEME_APPLICATION_STATUS_UPDATE',
        ),
      ).toEqual([]);
    });
  });
});
