import request from 'supertest';
import { API, E2eContext, createE2eContext } from './support/e2e-helpers';
import {
  Actor,
  OfficerWorld,
  as,
  buildOfficerWorld,
} from './support/officer-world';
import {
  approved,
  decide,
  errorCode,
  issueCertificate,
  officerApp,
  recommended,
} from './support/decision-helpers';

jest.setTimeout(600_000);

/**
 * Step 15 - who may decide, issue and read: authorization over real HTTP.
 * Only the Approving Authority of the application's OWN department decides and
 * certifies; everyone else - scrutiny officers, department administrators,
 * inspectors, technical administrators, leadership, applicants, another
 * department's authority, the unauthenticated - cannot. The applicant side is
 * the existing enterprise / project / representative model.
 */
describe('Decision authorization e2e', () => {
  let ctx: E2eContext;
  let w: OfficerWorld;
  let aaB: Actor;
  let aaA2: Actor;
  let repView: Actor;
  let stranger: Actor;

  const dbApp = (id: string) =>
    ctx.prisma.approvalApplication.findUniqueOrThrow({ where: { id } });
  const decisionCount = (applicationId: string) =>
    ctx.prisma.approvalDecision.count({ where: { applicationId } });
  const viewPath = (
    enterpriseId: string,
    s: { projectId: string; applicationId: string },
    suffix = 'decision',
  ) =>
    `/enterprises/${enterpriseId}/projects/${s.projectId}/applications/${s.applicationId}/${suffix}`;

  /** A recommended application of department B, over the real flow. */
  const recommendedB = async (tag: string) => {
    const s = await ctx.submittedApplication(
      w.owner.accessToken,
      w.enterpriseId,
      w.approvalB,
      tag,
    );
    await as(ctx, w.adminB.accessToken)
      .post(`${officerApp(s.applicationId)}/assignment`)
      .send({ officerUserId: w.soB.user.id })
      .expect(201);
    await as(ctx, w.soB.accessToken)
      .post(`${officerApp(s.applicationId)}/start-scrutiny`)
      .expect(200);
    await as(ctx, w.soB.accessToken)
      .post(`${officerApp(s.applicationId)}/recommendation`)
      .send({ outcome: 'APPROVE', reason: 'Department B recommends.' })
      .expect(201);
    return s;
  };

  beforeAll(async () => {
    ctx = await createE2eContext();
    w = await buildOfficerWorld(ctx, 'da');
    [aaB, aaA2, repView, stranger] = await Promise.all([
      ctx.officerSession('da-aab', 'APPROVING_AUTHORITY', w.deptB.id),
      ctx.officerSession('da-aa2', 'APPROVING_AUTHORITY', w.deptA.id),
      ctx.applicantSession('da-repview'),
      ctx.applicantSession('da-stranger'),
    ]);
    const granted = await as(ctx, w.owner.accessToken)
      .post(`/enterprises/${w.enterpriseId}/representatives`)
      .send({ emailOrMobile: repView.user.email, scope: 'VIEW_ONLY' })
      .expect(201);
    await as(ctx, repView.accessToken)
      .post(`/representative-authorisations/${granted.body.id}/accept`)
      .expect(200);
  });

  afterAll(async () => {
    await ctx.cleanup();
    await ctx.app.close();
  });

  // -------------------------------------------------------------------------
  describe('who may decide', () => {
    it('the Approving Authority of the application’s own department can', async () => {
      const s = await recommended(ctx, w, 'ok');
      await decide(ctx, w.aaA, s.applicationId).expect(201);
      expect((await dbApp(s.applicationId)).internalState).toBe('APPROVED');
    });

    it('a second Approving Authority of the same department can too (department scope, not personal ownership)', async () => {
      const s = await recommended(ctx, w, 'ok2');
      await decide(ctx, aaA2, s.applicationId).expect(201);
      expect((await decisionOfBy(s.applicationId)).decidedByUserId).toBe(
        aaA2.user.id,
      );
    });

    const decisionOfBy = (applicationId: string) =>
      ctx.prisma.approvalDecision.findUniqueOrThrow({
        where: { applicationId },
      });

    it.each([
      ['a Scrutiny Officer (recommend only)', () => w.soA1],
      ['a Department Administrator (never decides)', () => w.adminA],
      ['an Inspector', () => w.inspectorA],
      ['a System Administrator (technical only)', () => w.sysAdmin],
      ['Leadership', () => w.leadership],
      ['the applicant themselves', () => w.owner],
      ['another department’s Scrutiny Officer', () => w.soB],
    ])('%s cannot: 403, nothing changes', async (_who, actor) => {
      const s = await recommended(
        ctx,
        w,
        `no-${_who.slice(0, 8).replace(/\W+/g, '-')}`,
      );
      const res = await decide(ctx, actor(), s.applicationId).expect(403);
      expect(['INSUFFICIENT_ROLE', 'INSUFFICIENT_PERMISSION']).toContain(
        errorCode(res),
      );
      expect(await decisionCount(s.applicationId)).toBe(0);
      expect((await dbApp(s.applicationId)).internalState).toBe(
        'RECOMMENDED_FOR_APPROVAL',
      );
    });

    it('an unauthenticated caller cannot: 401', async () => {
      const s = await recommended(ctx, w, 'unauth');
      await request(ctx.http)
        .post(`${API}${officerApp(s.applicationId)}/decision`)
        .send({ outcome: 'APPROVE', reason: 'x' })
        .expect(401);
      expect(await decisionCount(s.applicationId)).toBe(0);
    });

    it('another department’s Approving Authority cannot: the application does not exist for them (404), whatever they send', async () => {
      const s = await recommended(ctx, w, 'crossdept');
      await decide(ctx, aaB, s.applicationId).expect(404);
      await decide(ctx, aaB, s.applicationId, {
        outcome: 'APPROVE',
        reason: 'x',
        departmentId: w.deptB.id,
      }).expect(400);
      expect(await decisionCount(s.applicationId)).toBe(0);
    });

    it('department B’s authority decides department B’s application - and A’s cannot', async () => {
      const s = await recommendedB('deptB');
      await decide(ctx, w.aaA, s.applicationId).expect(404);
      expect(await decisionCount(s.applicationId)).toBe(0);
      const res = await decide(ctx, aaB, s.applicationId).expect(201);
      expect(res.body.decision.decidedByUserId).toBe(aaB.user.id);
      expect((await decisionOfBy(s.applicationId)).departmentId).toBe(
        w.deptB.id,
      );
    });

    it('the technical administrator is refused even when both a business role and the admin role exist on other accounts (the route lists APPROVING_AUTHORITY only)', async () => {
      const s = await recommended(ctx, w, 'sysadmin');
      await decide(ctx, w.sysAdmin, s.applicationId).expect(403);
      await request(ctx.http)
        .post(`${API}${officerApp(s.applicationId)}/certificate`)
        .set('Authorization', `Bearer ${w.sysAdmin.accessToken}`)
        .expect(403);
    });
  });

  // -------------------------------------------------------------------------
  describe('who may issue a certificate', () => {
    it.each([
      ['a Scrutiny Officer', () => w.soA1],
      ['a Department Administrator', () => w.adminA],
      ['an Inspector', () => w.inspectorA],
      ['a System Administrator', () => w.sysAdmin],
      ['the applicant', () => w.owner],
    ])(
      '%s cannot (403), and the application stays APPROVED',
      async (_who, actor) => {
        const s = await approved(
          ctx,
          w,
          `ci-${_who.slice(2, 8).replace(/\W+/g, '-')}`,
        );
        await issueCertificate(ctx, actor(), s.applicationId).expect(403);
        expect((await dbApp(s.applicationId)).internalState).toBe('APPROVED');
        expect(
          await ctx.prisma.approvalCertificate.count({
            where: { applicationId: s.applicationId },
          }),
        ).toBe(0);
      },
    );

    it('another department’s Approving Authority gets 404, not a certificate', async () => {
      const s = await approved(ctx, w, 'ci-cross');
      await issueCertificate(ctx, aaB, s.applicationId).expect(404);
      expect((await dbApp(s.applicationId)).internalState).toBe('APPROVED');
    });

    it('the certificate is downloadable by officers who can see the application, and no one outside its department', async () => {
      const s = await approved(ctx, w, 'ci-dl');
      await issueCertificate(ctx, w.aaA, s.applicationId).expect(201);
      const path = `${officerApp(s.applicationId)}/certificate/download`;
      for (const actor of [w.aaA, w.adminA, w.soA1]) {
        await as(ctx, actor.accessToken).get(path).expect(200);
      }
      for (const actor of [w.soB, w.adminB, aaB]) {
        await as(ctx, actor.accessToken).get(path).expect(404);
      }
      for (const actor of [w.inspectorA, w.sysAdmin, w.leadership, w.owner]) {
        await as(ctx, actor.accessToken).get(path).expect(403);
      }
      await request(ctx.http).get(`${API}${path}`).expect(401);
    });
  });

  // -------------------------------------------------------------------------
  describe('the applicant side (enterprise, project, representative)', () => {
    it('the owner and a view-only representative read the decision; another enterprise, a stranger and a wrong project get 404 / 403', async () => {
      const s = await approved(ctx, w, 'ap-read');
      const path = viewPath(w.enterpriseId, s);
      const owner = await as(ctx, w.owner.accessToken).get(path).expect(200);
      expect(owner.body.decision.outcome).toBe('APPROVE');
      const rep = await as(ctx, repView.accessToken).get(path).expect(200);
      expect(rep.body).toEqual(owner.body);

      // The other enterprise's owner asks through their own enterprise: the
      // application is not theirs.
      await as(ctx, w.owner2.accessToken)
        .get(viewPath(w.enterprise2Id, s))
        .expect(404);
      // ...and through the real one: no relationship.
      await as(ctx, w.owner2.accessToken).get(path).expect(404);
      await as(ctx, stranger.accessToken).get(path).expect(404);
      // A project of another enterprise / a random project id.
      await as(ctx, w.owner.accessToken)
        .get(
          viewPath(w.enterpriseId, {
            projectId: '00000000-0000-4000-8000-000000000000',
            applicationId: s.applicationId,
          }),
        )
        .expect(404);
      await request(ctx.http).get(`${API}${path}`).expect(401);
    });

    it('officers have no relationship to the enterprise, so the applicant routes do not exist for them (404, like every other applicant route)', async () => {
      const s = await approved(ctx, w, 'ap-role');
      const path = viewPath(w.enterpriseId, s);
      for (const officer of [w.aaA, w.soA1, w.adminA, w.sysAdmin]) {
        await as(ctx, officer.accessToken).get(path).expect(404);
      }
    });

    it('the applicant view carries no internal decision data: no recommendation, no officer, no observation, no audit', async () => {
      const s = await recommended(ctx, w, 'ap-hide', {
        reason: 'SECRET-RECOMMENDATION-REASON',
      });
      await decide(ctx, w.aaA, s.applicationId, {
        outcome: 'APPROVE',
        reason: 'Public decision reason.',
      }).expect(201);
      await issueCertificate(ctx, w.aaA, s.applicationId, {
        fields: { certificateNumber: 'PUB/1' },
      }).expect(201);
      const body = (
        await as(ctx, w.owner.accessToken)
          .get(viewPath(w.enterpriseId, s))
          .expect(200)
      ).body;
      const json = JSON.stringify(body);
      expect(body.decision.reason).toBe('Public decision reason.');
      expect(body.certificate).toMatchObject({
        certificateNumber: 'PUB/1',
        version: 1,
        applicationId: s.applicationId,
        enterpriseId: w.enterpriseId,
        projectId: s.projectId,
      });
      for (const hidden of [
        'SECRET-RECOMMENDATION-REASON',
        w.aaA.user.id,
        w.soA1.user.id,
        'issuedBy',
        'decisionId',
        'recommend',
        'observation',
        'filePath',
        'checksum',
        'storage',
      ]) {
        expect(json.toLowerCase()).not.toContain(hidden.toLowerCase());
      }
    });

    it('applicant certificate download: owner and view-only representative yes; other enterprise / stranger no; none before issuance', async () => {
      const s = await approved(ctx, w, 'ap-dl');
      const path = viewPath(w.enterpriseId, s, 'certificate/download');
      await as(ctx, w.owner.accessToken).get(path).expect(404); // none yet
      await issueCertificate(ctx, w.aaA, s.applicationId).expect(201);
      await as(ctx, w.owner.accessToken).get(path).expect(200);
      await as(ctx, repView.accessToken).get(path).expect(200);
      await as(ctx, w.owner2.accessToken).get(path).expect(404);
      await as(ctx, stranger.accessToken).get(path).expect(404);
      await request(ctx.http).get(`${API}${path}`).expect(401);
    });
  });
});
