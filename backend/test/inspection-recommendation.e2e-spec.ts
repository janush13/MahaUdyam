import { E2eContext, createE2eContext } from './support/e2e-helpers';
import { addInspectionStage, future } from './support/inspection-helpers';
import {
  Actor,
  OfficerWorld,
  as,
  buildOfficerWorld,
} from './support/officer-world';

jest.setTimeout(600_000);

/**
 * Step 11C — inspection before recommendation, over real HTTP -> Nest ->
 * Prisma -> PostgreSQL (TRD 3.3 "scrutiny triggers inspection before
 * recommendation"; TRD 10.1 requirement "driven by the ApprovalType's workflow
 * definition").
 *
 *   approvalA  (department A): NO inspection stage  -> inspection optional
 *   approvalR  (department A): workflow has an INSPECTION stage -> required
 *
 * The rule under test: a recommendation is refused (409) while an inspection is
 * open (INSPECTION_OPEN), and — for a required approval — until one has been
 * completed (INSPECTION_REQUIRED). The inspection's OUTCOME never decides it.
 */
describe('Inspection before recommendation e2e (Step 11C)', () => {
  let ctx: E2eContext;
  let w: OfficerWorld;
  let approvalR: string;
  let inspectorA2: Actor;

  const api = (a: { accessToken: string }) => as(ctx, a.accessToken);
  const appPath = (id: string) => `/officer/applications/${id}`;
  const errorCode = (res: { body: { error?: { code?: string } } }) =>
    res.body.error?.code;

  const underScrutiny = async (approval: string, tag: string) => {
    const s = await ctx.submittedApplication(
      w.owner.accessToken,
      w.enterpriseId,
      approval,
      `irc-${tag}`,
    );
    await api(w.adminA)
      .post(`${appPath(s.applicationId)}/assignment`)
      .send({ officerUserId: w.soA1.user.id })
      .expect(201);
    await api(w.soA1)
      .post(`${appPath(s.applicationId)}/start-scrutiny`)
      .expect(200);
    return s;
  };

  const request = async (
    applicationId: string,
    body: Record<string, unknown> = {},
  ): Promise<string> =>
    (
      await api(w.soA1)
        .post(`${appPath(applicationId)}/inspections`)
        .send({
          inspectorUserId: w.inspectorA.user.id,
          siteAddress: 'Plot 12, MIDC Industrial Area',
          scheduledAt: future(2),
          ...body,
        })
        .expect(201)
    ).body.id as string;

  const complete = (
    inspectionId: string,
    over: Record<string, unknown> = {},
    inspector: Actor = w.inspectorA,
  ) =>
    api(inspector)
      .post(`/inspections/${inspectionId}/report`)
      .send({
        overallFinding: 'COMPLIANT',
        summary: 'Site inspected.',
        ...over,
      });

  const recommend = (
    applicationId: string,
    outcome: 'APPROVE' | 'REJECT' = 'APPROVE',
  ) =>
    api(w.soA1)
      .post(`${appPath(applicationId)}/recommendation`)
      .send({ outcome, reason: 'Recorded reason for the recommendation.' });

  const state = async (applicationId: string) =>
    (
      await ctx.prisma.approvalApplication.findUniqueOrThrow({
        where: { id: applicationId },
      })
    ).internalState;
  const recommendationCount = (applicationId: string) =>
    ctx.prisma.scrutinyRecommendation.count({ where: { applicationId } });
  const auditCount = (applicationId: string, action: string) =>
    ctx.prisma.auditLog.count({ where: { entityId: applicationId, action } });
  const detail = async (applicationId: string) =>
    (await api(w.soA1).get(appPath(applicationId)).expect(200)).body;

  beforeAll(async () => {
    ctx = await createE2eContext();
    w = await buildOfficerWorld(ctx, 'irc');
    approvalR = (
      await ctx.createStartableApproval(w.owner.user.id, 'irc-req', {
        departmentId: w.deptA.id,
      })
    ).approvalTypeId;
    await addInspectionStage(ctx.prisma, approvalR, w.deptA.id);
    inspectorA2 = await ctx.officerSession('irc-ins2', 'INSPECTOR', w.deptA.id);
  });

  afterAll(async () => {
    await ctx.cleanup();
    await ctx.app.close();
  });

  // -------------------------------------------------------------------------
  describe('an approval whose workflow does not require an inspection', () => {
    it('recommends exactly as before when no inspection was requested', async () => {
      const s = await underScrutiny(w.approvalA, 'opt-none');
      await recommend(s.applicationId).expect(201);
      expect(await state(s.applicationId)).toBe('RECOMMENDED_FOR_APPROVAL');
    });

    it('is refused with INSPECTION_OPEN while a requested inspection is still pending or scheduled', async () => {
      const pending = await underScrutiny(w.approvalA, 'opt-pending');
      await request(pending.applicationId, { scheduledAt: undefined });
      const scheduled = await underScrutiny(w.approvalA, 'opt-sched');
      await request(scheduled.applicationId);

      for (const s of [pending, scheduled]) {
        const res = await recommend(s.applicationId);
        expect(res.status).toBe(409);
        expect(errorCode(res)).toBe('INSPECTION_OPEN');
        expect(await state(s.applicationId)).toBe('UNDER_SCRUTINY');
        expect(await recommendationCount(s.applicationId)).toBe(0);
      }
    });

    it('is allowed once that inspection is completed — even with a NON_COMPLIANT outcome (the outcome does not decide)', async () => {
      const s = await underScrutiny(w.approvalA, 'opt-done');
      const id = await request(s.applicationId);
      await complete(id, {
        overallFinding: 'NON_COMPLIANT',
        correctiveAction: 'Fix the wiring.',
      }).expect(201);
      // Both recommendations are the officer's to make.
      await recommend(s.applicationId, 'APPROVE').expect(201);
      expect(await state(s.applicationId)).toBe('RECOMMENDED_FOR_APPROVAL');
    });

    it('a cancelled inspection is neither open nor completed: it does not block an optional inspection', async () => {
      const s = await underScrutiny(w.approvalA, 'opt-cancelled');
      const id = await request(s.applicationId);
      await ctx.prisma.inspection.update({
        where: { id },
        data: { status: 'CANCELLED' },
      });
      await recommend(s.applicationId).expect(201);
    });
  });

  // -------------------------------------------------------------------------
  describe('an approval whose workflow requires an inspection', () => {
    it('is refused with INSPECTION_REQUIRED until one is completed — for APPROVE and for REJECT — and nothing is written', async () => {
      const s = await underScrutiny(approvalR, 'req-none');
      const changesBefore = await auditCount(
        s.applicationId,
        'APPLICATION_STATUS_CHANGED',
      );
      for (const outcome of ['APPROVE', 'REJECT'] as const) {
        const res = await recommend(s.applicationId, outcome);
        expect(res.status).toBe(409);
        expect(errorCode(res)).toBe('INSPECTION_REQUIRED');
        expect(res.body.error.message).toEqual(expect.any(String));
      }
      expect(await state(s.applicationId)).toBe('UNDER_SCRUTINY');
      expect(await recommendationCount(s.applicationId)).toBe(0);
      // A refused attempt is not a recommendation and leaves no such record.
      expect(
        await auditCount(s.applicationId, 'SCRUTINY_RECOMMENDATION_RECORDED'),
      ).toBe(0);
      // ...and no state change beyond what had already happened.
      expect(
        await auditCount(s.applicationId, 'APPLICATION_STATUS_CHANGED'),
      ).toBe(changesBefore);
    });

    it('open inspection -> INSPECTION_OPEN; completed -> allowed; the state then moves through the existing transition only', async () => {
      const s = await underScrutiny(approvalR, 'req-flow');
      const id = await request(s.applicationId);
      const open = await recommend(s.applicationId);
      expect(open.status).toBe(409);
      expect(errorCode(open)).toBe('INSPECTION_OPEN');

      await complete(id).expect(201);
      // Completing the inspection did not itself move the application.
      expect(await state(s.applicationId)).toBe('UNDER_SCRUTINY');

      await recommend(s.applicationId, 'REJECT').expect(201);
      expect(await state(s.applicationId)).toBe('RECOMMENDED_FOR_APPROVAL');
      expect(await recommendationCount(s.applicationId)).toBe(1);
      expect(
        await auditCount(s.applicationId, 'SCRUTINY_RECOMMENDATION_RECORDED'),
      ).toBe(1);
    });

    it('a cancelled inspection does not satisfy the requirement', async () => {
      const s = await underScrutiny(approvalR, 'req-cancelled');
      const id = await request(s.applicationId);
      await ctx.prisma.inspection.update({
        where: { id },
        data: { status: 'CANCELLED' },
      });
      const res = await recommend(s.applicationId);
      expect(res.status).toBe(409);
      expect(errorCode(res)).toBe('INSPECTION_REQUIRED');
    });

    it('a follow-up inspection after a completed one blocks again until it too is completed', async () => {
      const s = await underScrutiny(approvalR, 'req-reinspect');
      const first = await request(s.applicationId);
      await complete(first, {
        overallFinding: 'NON_COMPLIANT',
        correctiveAction: 'Repair, then we will return.',
      }).expect(201);
      const second = await request(s.applicationId, {
        inspectorUserId: inspectorA2.user.id,
      });
      const blocked = await recommend(s.applicationId);
      expect(blocked.status).toBe(409);
      expect(errorCode(blocked)).toBe('INSPECTION_OPEN');
      await complete(second, {}, inspectorA2).expect(201);
      await recommend(s.applicationId).expect(201);
    });

    it('a reassigned inspector can no longer complete it; the new one can, and that unblocks the recommendation', async () => {
      const s = await underScrutiny(approvalR, 'req-reassign');
      const id = await request(s.applicationId);
      await api(w.soA1)
        .put(`${appPath(s.applicationId)}/inspections/${id}`)
        .send({
          inspectorUserId: inspectorA2.user.id,
          reason: 'Workload rebalancing',
        })
        .expect(200);
      expect((await complete(id)).status).toBe(404);
      expect(errorCode(await recommend(s.applicationId))).toBe(
        'INSPECTION_OPEN',
      );
      await complete(id, {}, inspectorA2).expect(201);
      await recommend(s.applicationId).expect(201);
    });

    it('the state machine still comes first: a recommendation from another state is INVALID_STATE_TRANSITION', async () => {
      const s = await underScrutiny(approvalR, 'req-state');
      await api(w.soA1)
        .post(`${appPath(s.applicationId)}/queries`)
        .send({ question: 'Please clarify the layout.' })
        .expect(201);
      const res = await recommend(s.applicationId);
      expect(res.status).toBe(409);
      expect(errorCode(res)).toBe('INVALID_STATE_TRANSITION');
    });
  });

  // -------------------------------------------------------------------------
  describe('the outcome reaches the scrutiny flow', () => {
    it('the officer detail separates the configured requirement from what actually happened', async () => {
      const s = await underScrutiny(approvalR, 'detail');
      expect((await detail(s.applicationId)).inspection).toEqual({
        required: true,
        open: 0,
        completed: 0,
        recommendationBlockedBy: 'INSPECTION_REQUIRED',
        outcomes: [],
      });

      const id = await request(s.applicationId);
      expect((await detail(s.applicationId)).inspection).toMatchObject({
        required: true,
        open: 1,
        completed: 0,
        recommendationBlockedBy: 'INSPECTION_OPEN',
        outcomes: [],
      });

      await complete(id, {
        overallFinding: 'CONDITIONAL',
        summary: 'Mostly in order; conditions attached.',
        correctiveAction: 'Label the exits.',
      }).expect(201);
      const done = (await detail(s.applicationId)).inspection;
      expect(done).toMatchObject({
        required: true,
        open: 0,
        completed: 1,
        recommendationBlockedBy: null,
      });
      expect(done.outcomes).toEqual([
        {
          inspectionId: id,
          scheduledAt: expect.any(String),
          overallFinding: 'CONDITIONAL',
          summary: 'Mostly in order; conditions attached.',
          correctiveAction: 'Label the exits.',
          submittedAt: expect.any(String),
          submittedByUserId: w.inspectorA.user.id,
        },
      ]);
    });

    it('an approval that does not require one reports required=false and is not blocked', async () => {
      const s = await underScrutiny(w.approvalA, 'detail-opt');
      expect((await detail(s.applicationId)).inspection).toEqual({
        required: false,
        open: 0,
        completed: 0,
        recommendationBlockedBy: null,
        outcomes: [],
      });
    });

    it('the Approving Authority sees the outcomes once the recommendation is with them; the full report stays readable', async () => {
      const s = await underScrutiny(approvalR, 'aa');
      const id = await request(s.applicationId);
      await complete(id, {
        overallFinding: 'NON_COMPLIANT',
        correctiveAction: 'Replace the extinguishers.',
      }).expect(201);
      await recommend(s.applicationId).expect(201);
      const seen = (await api(w.aaA).get(appPath(s.applicationId)).expect(200))
        .body;
      expect(seen.inspection.outcomes).toHaveLength(1);
      expect(seen.inspection.outcomes[0]).toMatchObject({
        inspectionId: id,
        overallFinding: 'NON_COMPLIANT',
      });
      await api(w.aaA).get(`/inspections/${id}/report`).expect(200);
    });

    it('the completed report is immutable history: a later inspection never rewrites it', async () => {
      const s = await underScrutiny(approvalR, 'immutable');
      const first = await request(s.applicationId);
      await complete(first, {
        overallFinding: 'NON_COMPLIANT',
        correctiveAction: 'First finding.',
      }).expect(201);
      const second = await request(s.applicationId);
      await complete(second, { overallFinding: 'COMPLIANT' }).expect(201);
      const outcomes = (await detail(s.applicationId)).inspection.outcomes;
      expect(
        outcomes.map((o: { inspectionId: string }) => o.inspectionId),
      ).toEqual([first, second]);
      expect(outcomes[0].overallFinding).toBe('NON_COMPLIANT');
      // A second report for the same inspection is refused, not merged.
      expect((await complete(first)).status).toBe(409);
    });
  });

  // -------------------------------------------------------------------------
  describe('concurrency (the application row lock)', () => {
    it('completion vs recommendation, raced: the recommendation never succeeds while the inspection is open, and the end state is consistent', async () => {
      for (let round = 0; round < 4; round++) {
        const s = await underScrutiny(w.approvalA, `race-cr-${round}`);
        const id = await request(s.applicationId);
        const [report, rec] = await Promise.all([
          complete(id),
          recommend(s.applicationId),
        ]);
        // The inspector's report always lands; the recommendation is either
        // refused (it ran first, inspection still open) or accepted (it ran
        // after the completion) — never accepted against an open inspection.
        expect(report.status).toBe(201);
        expect([201, 409]).toContain(rec.status);
        const inspection = await ctx.prisma.inspection.findUniqueOrThrow({
          where: { id },
        });
        expect(inspection.status).toBe('COMPLETED');
        if (rec.status === 201) {
          expect(await state(s.applicationId)).toBe('RECOMMENDED_FOR_APPROVAL');
          expect(await recommendationCount(s.applicationId)).toBe(1);
        } else {
          expect(errorCode(rec)).toBe('INSPECTION_OPEN');
          expect(await state(s.applicationId)).toBe('UNDER_SCRUTINY');
          expect(await recommendationCount(s.applicationId)).toBe(0);
          // The retry, now that the inspection is completed, succeeds.
          await recommend(s.applicationId).expect(201);
        }
      }
    });

    it('a new inspection request vs a recommendation, raced: never a recommended application with an open inspection', async () => {
      for (let round = 0; round < 4; round++) {
        const s = await underScrutiny(w.approvalA, `race-rq-${round}`);
        const [created, rec] = await Promise.all([
          api(w.soA1)
            .post(`${appPath(s.applicationId)}/inspections`)
            .send({
              inspectorUserId: w.inspectorA.user.id,
              siteAddress: 'Plot 12',
              scheduledAt: future(2),
            }),
          recommend(s.applicationId),
        ]);
        expect([201, 409]).toContain(created.status);
        expect([201, 409]).toContain(rec.status);
        const open = await ctx.prisma.inspection.count({
          where: {
            applicationId: s.applicationId,
            status: { in: ['PENDING', 'SCHEDULED'] },
          },
        });
        const st = await state(s.applicationId);
        // The invariant the lock guarantees.
        expect(st === 'RECOMMENDED_FOR_APPROVAL' && open > 0).toBe(false);
        expect(rec.status === 201).toBe(st === 'RECOMMENDED_FOR_APPROVAL');
        if (rec.status === 409 && created.status === 201) {
          expect(errorCode(rec)).toBe('INSPECTION_OPEN');
        }
        if (created.status === 409) {
          // The recommendation won; the request met a finished scrutiny.
          expect(rec.status).toBe(201);
        }
      }
    });

    it('two simultaneous recommendations after a completed required inspection: exactly one wins', async () => {
      const s = await underScrutiny(approvalR, 'race-rr');
      const id = await request(s.applicationId);
      await complete(id).expect(201);
      const results = await Promise.all([
        recommend(s.applicationId),
        recommend(s.applicationId),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(await recommendationCount(s.applicationId)).toBe(1);
    });
  });
});
