import { E2eContext, createE2eContext } from './support/e2e-helpers';
import { OfficerWorld, as, buildOfficerWorld } from './support/officer-world';
import {
  addInspectionStage,
  markScrutinyFinished,
} from './support/inspection-helpers';
import {
  decide,
  errorCode,
  officerApp,
  recommended,
} from './support/decision-helpers';

jest.setTimeout(600_000);

/**
 * Step 15 - the Approving Authority's decision over real HTTP -> Nest -> Prisma
 * -> PostgreSQL: the documented recommendation -> decision transition (APPROVE /
 * REJECT), its prerequisites, the integrity of the recommendation it consumes,
 * the resulting state, audit, what the applicant sees, and the database's own
 * refusal of an illegal decision.
 */
describe('Decision e2e - recommendation to statutory decision', () => {
  let ctx: E2eContext;
  let w: OfficerWorld;

  const aa = () => as(ctx, w.aaA.accessToken);
  const dbApp = (id: string) =>
    ctx.prisma.approvalApplication.findUniqueOrThrow({ where: { id } });
  const decisionOf = (applicationId: string) =>
    ctx.prisma.approvalDecision.findUnique({ where: { applicationId } });
  const events = (entityId: string, action: string) =>
    ctx.prisma.auditLog.findMany({
      where: { entityId, action },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  const applicantView = (s: { projectId: string; applicationId: string }) =>
    as(ctx, w.owner.accessToken).get(
      `/enterprises/${w.enterpriseId}/projects/${s.projectId}/applications/${s.applicationId}/decision`,
    );

  beforeAll(async () => {
    ctx = await createE2eContext();
    w = await buildOfficerWorld(ctx, 'dc');
  });

  afterAll(async () => {
    await ctx.cleanup();
    await ctx.app.close();
  });

  // -------------------------------------------------------------------------
  describe('approve', () => {
    it('RECOMMENDED_FOR_APPROVAL -> APPROVED: records the decision, keeps the recommendation, and does not yet issue a certificate or activate', async () => {
      const s = await recommended(ctx, w, 'ap1', {
        reason: 'Scrutiny finds the file complete.',
      });
      const before = await ctx.prisma.scrutinyRecommendation.findMany({
        where: { applicationId: s.applicationId },
      });
      expect(before).toHaveLength(1);

      const res = await decide(ctx, w.aaA, s.applicationId, {
        outcome: 'APPROVE',
        reason: 'Approved: requirements satisfied.',
      }).expect(201);
      expect(res.body).toMatchObject({
        applicationId: s.applicationId,
        internalState: 'APPROVED',
        applicantStatus: 'APPROVED',
        decision: {
          outcome: 'APPROVE',
          reason: 'Approved: requirements satisfied.',
          decidedByUserId: w.aaA.user.id,
          recommendationId: before[0].id,
          recommendedOutcome: 'APPROVE',
          differsFromRecommendation: false,
          isStatutoryDecision: true,
        },
      });

      const app = await dbApp(s.applicationId);
      expect(app).toMatchObject({
        internalState: 'APPROVED',
        applicantStatus: 'APPROVED',
        decisionReason: 'Approved: requirements satisfied.',
      });
      // The application's decision time IS the decision record's time.
      const decision = await decisionOf(s.applicationId);
      expect(app.decidedAt?.getTime()).toBe(decision?.decidedAt.getTime());
      expect(decision).toMatchObject({
        departmentId: w.deptA.id,
        decidedByUserId: w.aaA.user.id,
        recommendationId: before[0].id,
      });
      // Not certified, not active, no compliance yet.
      expect(
        await ctx.prisma.approvalCertificate.count({
          where: { applicationId: s.applicationId },
        }),
      ).toBe(0);
      expect(
        await ctx.prisma.complianceRecord.count({
          where: { applicationId: s.applicationId },
        }),
      ).toBe(0);

      // The recommendation is exactly as the scrutiny officer left it.
      const after = await ctx.prisma.scrutinyRecommendation.findMany({
        where: { applicationId: s.applicationId },
      });
      expect(after).toEqual(before);
    });

    it('the decision may differ from the recommendation (advice is not a decision), and says so', async () => {
      const s = await recommended(ctx, w, 'ap2', {
        outcome: 'REJECT',
        reason: 'Scrutiny doubts the capacity figure.',
      });
      const res = await decide(ctx, w.aaA, s.applicationId).expect(201);
      expect(res.body.decision).toMatchObject({
        outcome: 'APPROVE',
        recommendedOutcome: 'REJECT',
        differsFromRecommendation: true,
      });
      expect((await dbApp(s.applicationId)).internalState).toBe('APPROVED');
    });
  });

  // -------------------------------------------------------------------------
  describe('reject', () => {
    it('RECOMMENDED_FOR_APPROVAL -> REJECTED with the recorded reason; terminal here (no certificate, no activation)', async () => {
      const s = await recommended(ctx, w, 'rj1', { outcome: 'REJECT' });
      const res = await decide(ctx, w.aaA, s.applicationId, {
        outcome: 'REJECT',
        reason: 'Rejected: the department is not satisfied.',
      }).expect(201);
      expect(res.body).toMatchObject({
        internalState: 'REJECTED',
        applicantStatus: 'REJECTED',
        decision: { outcome: 'REJECT', differsFromRecommendation: false },
      });
      expect(await dbApp(s.applicationId)).toMatchObject({
        internalState: 'REJECTED',
        applicantStatus: 'REJECTED',
        decisionReason: 'Rejected: the department is not satisfied.',
      });
      expect((await dbApp(s.applicationId)).decidedAt).not.toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  describe('prerequisites', () => {
    it('an application that has not been recommended is not on the authority’s desk at all (404), and nothing changes', async () => {
      const submitted = await ctx.submittedApplication(
        w.owner.accessToken,
        w.enterpriseId,
        w.approvalA,
        'pre-sub',
      );
      await decide(ctx, w.aaA, submitted.applicationId).expect(404);
      await as(ctx, w.adminA.accessToken)
        .post(`${officerApp(submitted.applicationId)}/assignment`)
        .send({ officerUserId: w.soA1.user.id })
        .expect(201);
      await as(ctx, w.soA1.accessToken)
        .post(`${officerApp(submitted.applicationId)}/start-scrutiny`)
        .expect(200);
      await decide(ctx, w.aaA, submitted.applicationId).expect(404);
      expect((await dbApp(submitted.applicationId)).internalState).toBe(
        'UNDER_SCRUTINY',
      );
      expect(await decisionOf(submitted.applicationId)).toBeNull();
    });

    it('a draft, and an id that does not exist, are the same 404', async () => {
      await decide(ctx, w.aaA, '00000000-0000-4000-8000-000000000000').expect(
        404,
      );
      await aa()
        .post(`${officerApp('not-a-uuid')}/decision`)
        .send({ outcome: 'APPROVE', reason: 'x' })
        .expect(400);
    });

    it('needs a recommendation on record: a finished scrutiny with none is refused (409 RECOMMENDATION_NOT_FOUND)', async () => {
      const s = await ctx.submittedApplication(
        w.owner.accessToken,
        w.enterpriseId,
        w.approvalA,
        'pre-norec',
      );
      await markScrutinyFinished(ctx.prisma, s.applicationId);
      const res = await decide(ctx, w.aaA, s.applicationId).expect(409);
      expect(errorCode(res)).toBe('RECOMMENDATION_NOT_FOUND');
      expect((await dbApp(s.applicationId)).internalState).toBe(
        'RECOMMENDED_FOR_APPROVAL',
      );
      expect(await decisionOf(s.applicationId)).toBeNull();
    });

    it('the inspection gate still holds at decision time: a required inspection that was never completed blocks (409 INSPECTION_REQUIRED)', async () => {
      const approvalR = (
        await ctx.createStartableApproval(w.owner.user.id, 'dc-req', {
          departmentId: w.deptA.id,
        })
      ).approvalTypeId;
      await addInspectionStage(ctx.prisma, approvalR, w.deptA.id);
      const s = await ctx.submittedApplication(
        w.owner.accessToken,
        w.enterpriseId,
        approvalR,
        'pre-insp',
      );
      await ctx.prisma.scrutinyRecommendation.create({
        data: {
          applicationId: s.applicationId,
          departmentId: w.deptA.id,
          outcome: 'APPROVE',
          reason: 'Fixture recommendation (no inspection was completed).',
          recommendedByUserId: w.soA1.user.id,
        },
      });
      await markScrutinyFinished(ctx.prisma, s.applicationId);
      const res = await decide(ctx, w.aaA, s.applicationId).expect(409);
      expect(errorCode(res)).toBe('INSPECTION_REQUIRED');
      expect(await decisionOf(s.applicationId)).toBeNull();
      expect((await dbApp(s.applicationId)).internalState).toBe(
        'RECOMMENDED_FOR_APPROVAL',
      );
    });

    it('a decision is made once: a repeat or a contrary decision is 409 DECISION_ALREADY_RECORDED and changes nothing', async () => {
      const s = await recommended(ctx, w, 'pre-twice');
      await decide(ctx, w.aaA, s.applicationId).expect(201);
      const first = await decisionOf(s.applicationId);
      for (const outcome of ['APPROVE', 'REJECT']) {
        const res = await decide(ctx, w.aaA, s.applicationId, {
          outcome,
          reason: 'second attempt',
        }).expect(409);
        expect(errorCode(res)).toBe('DECISION_ALREADY_RECORDED');
      }
      expect(await decisionOf(s.applicationId)).toEqual(first);
      expect((await dbApp(s.applicationId)).internalState).toBe('APPROVED');
      expect(
        await ctx.prisma.approvalDecision.count({
          where: { applicationId: s.applicationId },
        }),
      ).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  describe('the request (no arbitrary status, no recommendation through the decision)', () => {
    it.each([
      ['no body', {}],
      ['no reason', { outcome: 'APPROVE' }],
      ['a blank reason', { outcome: 'APPROVE', reason: '   ' }],
      ['no outcome', { reason: 'x' }],
      ['a state name as the outcome', { outcome: 'APPROVED', reason: 'x' }],
      ['an unknown outcome', { outcome: 'RETURN', reason: 'x' }],
      [
        'a smuggled status',
        { outcome: 'APPROVE', reason: 'x', internalState: 'APPROVED' },
      ],
      [
        'a smuggled applicant status',
        { outcome: 'APPROVE', reason: 'x', applicantStatus: 'APPROVED' },
      ],
      [
        'a recommendation of its own',
        {
          outcome: 'APPROVE',
          reason: 'x',
          recommendation: { outcome: 'APPROVE', reason: 'made up' },
        },
      ],
      [
        'a recommendation id',
        {
          outcome: 'APPROVE',
          reason: 'x',
          recommendationId: '00000000-0000-4000-8000-000000000000',
        },
      ],
      [
        'a department',
        {
          outcome: 'APPROVE',
          reason: 'x',
          departmentId: '00000000-0000-4000-8000-000000000000',
        },
      ],
      [
        'a decider or a time',
        {
          outcome: 'APPROVE',
          reason: 'x',
          decidedByUserId: '00000000-0000-4000-8000-000000000000',
          decidedAt: '2020-01-01T00:00:00Z',
        },
      ],
    ])('refuses %s (400) and writes nothing', async (_label, body) => {
      const s = await recommended(ctx, w, `rq-${_label.replace(/\W+/g, '-')}`);
      const res = await aa()
        .post(`${officerApp(s.applicationId)}/decision`)
        .send(body)
        .expect(400);
      expect(errorCode(res)).toBe('VALIDATION_ERROR');
      expect(await decisionOf(s.applicationId)).toBeNull();
      expect((await dbApp(s.applicationId)).internalState).toBe(
        'RECOMMENDED_FOR_APPROVAL',
      );
    });

    it('no route takes a status: PATCH / PUT / status / transition on the application are all 404', async () => {
      const s = await recommended(ctx, w, 'rq-routes');
      const base = officerApp(s.applicationId);
      for (const call of [
        () => aa().patch(base).send({ status: 'APPROVED' }),
        () => aa().put(base).send({ status: 'APPROVED' }),
        () => aa().patch(`${base}/status`).send({ status: 'APPROVED' }),
        () => aa().post(`${base}/status`).send({ status: 'APPROVED' }),
        () => aa().post(`${base}/approve`).send({}),
        () => aa().post(`${base}/reject`).send({}),
        () => aa().post(`${base}/transition`).send({ to: 'APPROVED' }),
        () => aa().patch(`${base}/decision`).send({ outcome: 'APPROVE' }),
        () => aa().put(`${base}/decision`).send({ outcome: 'APPROVE' }),
        () => aa().del(`${base}/decision`),
      ]) {
        expect((await call()).status).toBe(404);
      }
      expect((await dbApp(s.applicationId)).internalState).toBe(
        'RECOMMENDED_FOR_APPROVAL',
      );
    });
  });

  // -------------------------------------------------------------------------
  describe('recommendation integrity', () => {
    it('recommendation and decision stay two records: the officer view lists both, the recommendation is still "only a recommendation"', async () => {
      const s = await recommended(ctx, w, 'ri1', {
        outcome: 'REJECT',
        reason: 'Advice: reject.',
      });
      await decide(ctx, w.aaA, s.applicationId, {
        outcome: 'APPROVE',
        reason: 'Decision: approve.',
      }).expect(201);
      const detail = (
        await as(ctx, w.soA1.accessToken)
          .get(officerApp(s.applicationId))
          .expect(200)
      ).body;
      expect(detail.recommendations).toHaveLength(1);
      expect(detail.recommendations[0]).toMatchObject({
        outcome: 'REJECT',
        reason: 'Advice: reject.',
        isRecommendationOnly: true,
      });
      expect(detail.decision).toMatchObject({
        outcome: 'APPROVE',
        reason: 'Decision: approve.',
        isStatutoryDecision: true,
        recommendationId: detail.recommendations[0].id,
      });
      expect(detail.certificate).toBeNull();
    });

    it('a scrutiny officer cannot create or alter a recommendation once the decision is made (409), and the decision endpoint is not theirs (403)', async () => {
      const s = await recommended(ctx, w, 'ri2');
      await decide(ctx, w.aaA, s.applicationId).expect(201);
      const so = as(ctx, w.soA1.accessToken);
      const res = await so
        .post(`${officerApp(s.applicationId)}/recommendation`)
        .send({ outcome: 'REJECT', reason: 'changed my mind' })
        .expect(409);
      expect(errorCode(res)).toBe('INVALID_STATE_TRANSITION');
      await so
        .post(`${officerApp(s.applicationId)}/decision`)
        .send({ outcome: 'REJECT', reason: 'x' })
        .expect(403);
      expect(
        await ctx.prisma.scrutinyRecommendation.count({
          where: { applicationId: s.applicationId },
        }),
      ).toBe(1);
    });

    it('the database refuses to edit the recommendation a decision answers', async () => {
      const s = await recommended(ctx, w, 'ri3');
      await decide(ctx, w.aaA, s.applicationId).expect(201);
      await expect(
        ctx.prisma.scrutinyRecommendation.updateMany({
          where: { applicationId: s.applicationId },
          data: { outcome: 'REJECT' },
        }),
      ).rejects.toThrow(/append-only/);
    });
  });

  // -------------------------------------------------------------------------
  describe('audit', () => {
    it('records the decision with actor, role, department and the recommendation answered, and the before/after status', async () => {
      const s = await recommended(ctx, w, 'au1', { outcome: 'REJECT' });
      await decide(ctx, w.aaA, s.applicationId, {
        outcome: 'APPROVE',
        reason: 'Audited reason.',
      }).expect(201);
      const decision = await decisionOf(s.applicationId);
      const [event] = await events(
        s.applicationId,
        'APPLICATION_DECISION_RECORDED',
      );
      expect(event).toMatchObject({
        userId: w.aaA.user.id,
        roleAtTime: 'APPROVING_AUTHORITY',
        entityType: 'ApprovalApplication',
      });
      expect(event.afterState).toMatchObject({
        applicationId: s.applicationId,
        departmentId: w.deptA.id,
        enterpriseId: w.enterpriseId,
        projectId: s.projectId,
        decisionId: decision?.id,
        outcome: 'APPROVE',
        reason: 'Audited reason.',
        recommendationId: decision?.recommendationId,
        recommendedOutcome: 'REJECT',
        differsFromRecommendation: true,
        isRecommendationOnly: false,
      });
      const changes = await events(
        s.applicationId,
        'APPLICATION_STATUS_CHANGED',
      );
      const last = changes[changes.length - 1];
      expect(last.userId).toBe(w.aaA.user.id);
      expect(last.beforeState).toMatchObject({
        internalState: 'RECOMMENDED_FOR_APPROVAL',
      });
      expect(last.afterState).toMatchObject({
        internalState: 'APPROVED',
        action: 'APPROVE',
      });
    });

    it('a refused decision leaves no decision event', async () => {
      const s = await recommended(ctx, w, 'au2');
      await aa()
        .post(`${officerApp(s.applicationId)}/decision`)
        .send({ outcome: 'APPROVE' })
        .expect(400);
      expect(
        await events(s.applicationId, 'APPLICATION_DECISION_RECORDED'),
      ).toHaveLength(0);
    });

    it('the officer history shows the decision in plain language, in order, and no reason text', async () => {
      const s = await recommended(ctx, w, 'au3');
      await decide(ctx, w.aaA, s.applicationId, {
        outcome: 'REJECT',
        reason: 'History-hidden reason text',
      }).expect(201);
      const history = (
        await as(ctx, w.adminA.accessToken)
          .get(`${officerApp(s.applicationId)}/history`)
          .expect(200)
      ).body as Array<{ action: string; summary: string; to: string | null }>;
      const at = history.findIndex(
        (h) => h.action === 'APPLICATION_DECISION_RECORDED',
      );
      expect(at).toBeGreaterThan(-1);
      expect(history[at].summary).toMatch(/Decision recorded.*REJECT/);
      expect(history.some((h) => h.to === 'REJECTED')).toBe(true);
      expect(JSON.stringify(history)).not.toContain('History-hidden');
    });

    it('offers the authority its next act by state, and nothing once the certificate is issued', async () => {
      const s = await recommended(ctx, w, 'au4');
      const at = async () =>
        (await aa().get(officerApp(s.applicationId)).expect(200)).body;
      expect((await at()).availableActions).toEqual(['DECIDE']);
      await decide(ctx, w.aaA, s.applicationId).expect(201);
      expect((await at()).availableActions).toEqual(['ISSUE_CERTIFICATE']);
    });
  });

  // -------------------------------------------------------------------------
  describe('what the applicant sees', () => {
    it('nothing decided yet: decision and certificate are null, status is Awaiting Decision', async () => {
      const s = await recommended(ctx, w, 'av1');
      const res = await applicantView(s).expect(200);
      expect(res.body).toMatchObject({
        applicationId: s.applicationId,
        referenceNumber: s.referenceNumber,
        applicantStatus: 'AWAITING_DECISION',
        decision: null,
        certificate: null,
      });
    });

    it('after a decision: the outcome, the recorded reason, when, which department - and nothing internal', async () => {
      const s = await recommended(ctx, w, 'av2', {
        outcome: 'REJECT',
        reason: 'INTERNAL-RECOMMENDATION-TEXT',
      });
      await decide(ctx, w.aaA, s.applicationId, {
        outcome: 'REJECT',
        reason: 'The reason the applicant reads.',
      }).expect(201);
      const res = await applicantView(s).expect(200);
      expect(res.body).toMatchObject({
        applicantStatus: 'REJECTED',
        decision: {
          outcome: 'REJECT',
          reason: 'The reason the applicant reads.',
          department: { id: w.deptA.id, code: w.deptA.code },
        },
        certificate: null,
      });
      expect(res.body.decision.decidedAt).toBeTruthy();
      expect(res.body.notice).toMatch(
        /not decided or promised by this platform/,
      );
      const json = JSON.stringify(res.body);
      for (const secret of [
        'INTERNAL-RECOMMENDATION-TEXT',
        w.aaA.user.id,
        w.soA1.user.id,
        'recommendation',
        'decidedBy',
        'differsFromRecommendation',
      ]) {
        expect(json).not.toContain(secret);
      }
      // The ordinary status view moves with it.
      const status = await as(ctx, w.owner.accessToken)
        .get(
          `/enterprises/${w.enterpriseId}/projects/${s.projectId}/applications/${s.applicationId}/status`,
        )
        .expect(200);
      expect(status.body.applicantStatus).toBe('REJECTED');
    });
  });

  // -------------------------------------------------------------------------
  describe('database integrity (PostgreSQL refuses what the service would never do)', () => {
    it('a decision row is append-only', async () => {
      const s = await recommended(ctx, w, 'db1');
      await decide(ctx, w.aaA, s.applicationId).expect(201);
      await expect(
        ctx.prisma.approvalDecision.update({
          where: { applicationId: s.applicationId },
          data: { outcome: 'REJECT' },
        }),
      ).rejects.toThrow(/append-only/);
      await expect(
        ctx.prisma.approvalDecision.update({
          where: { applicationId: s.applicationId },
          data: { reason: 'rewritten' },
        }),
      ).rejects.toThrow(/append-only/);
    });

    it('the decision recorded on the application is permanent once set', async () => {
      const s = await recommended(ctx, w, 'db2');
      await decide(ctx, w.aaA, s.applicationId).expect(201);
      await expect(
        ctx.prisma.approvalApplication.update({
          where: { id: s.applicationId },
          data: { decisionReason: 'rewritten' },
        }),
      ).rejects.toThrow(/permanent once set/);
      await expect(
        ctx.prisma.approvalApplication.update({
          where: { id: s.applicationId },
          data: { decidedAt: new Date(0) },
        }),
      ).rejects.toThrow(/permanent once set/);
    });

    it('an application cannot be moved to APPROVED or REJECTED without the matching decision', async () => {
      const s = await recommended(ctx, w, 'db3');
      for (const internalState of ['APPROVED', 'REJECTED'] as const) {
        await expect(
          ctx.prisma.approvalApplication.update({
            where: { id: s.applicationId },
            data: { internalState },
          }),
        ).rejects.toThrow(/requires a recommended application/);
      }
      // ...nor an approving decision used to justify a rejection.
      await decide(ctx, w.aaA, s.applicationId).expect(201);
      const other = await recommended(ctx, w, 'db3b');
      await expect(
        ctx.prisma.approvalApplication.update({
          where: { id: other.applicationId },
          data: { internalState: 'CERTIFICATE_ISSUED' },
        }),
      ).rejects.toThrow(/CERTIFICATE_ISSUED requires/);
    });

    it('a decision cannot be inserted for an application that is not recommended, in another department, or answering another application’s recommendation', async () => {
      const s = await recommended(ctx, w, 'db4');
      const underScrutiny = await ctx.submittedApplication(
        w.owner.accessToken,
        w.enterpriseId,
        w.approvalA,
        'db4b',
      );
      const rec = await ctx.prisma.scrutinyRecommendation.findFirstOrThrow({
        where: { applicationId: s.applicationId },
      });
      const base = {
        outcome: 'APPROVE' as const,
        reason: 'x',
        decidedByUserId: w.aaA.user.id,
      };
      await expect(
        ctx.prisma.approvalDecision.create({
          data: {
            ...base,
            applicationId: underScrutiny.applicationId,
            departmentId: w.deptA.id,
            recommendationId: rec.id,
          },
        }),
      ).rejects.toThrow(/only for a recommended application/);
      await expect(
        ctx.prisma.approvalDecision.create({
          data: {
            ...base,
            applicationId: s.applicationId,
            departmentId: w.deptB.id,
            recommendationId: rec.id,
          },
        }),
      ).rejects.toThrow(/own department/);
      const otherRec = await recommended(ctx, w, 'db4c');
      const otherRecRow =
        await ctx.prisma.scrutinyRecommendation.findFirstOrThrow({
          where: { applicationId: otherRec.applicationId },
        });
      await expect(
        ctx.prisma.approvalDecision.create({
          data: {
            ...base,
            applicationId: s.applicationId,
            departmentId: w.deptA.id,
            recommendationId: otherRecRow.id,
          },
        }),
      ).rejects.toThrow(/belongs to another application/);
      await expect(
        ctx.prisma.approvalDecision.create({
          data: {
            ...base,
            reason: '  ',
            applicationId: s.applicationId,
            departmentId: w.deptA.id,
            recommendationId: rec.id,
          },
        }),
      ).rejects.toThrow();
      expect(await decisionOf(s.applicationId)).toBeNull();
    });
  });
});
