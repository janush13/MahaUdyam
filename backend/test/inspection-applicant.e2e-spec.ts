import request from 'supertest';
import { API, E2eContext, createE2eContext } from './support/e2e-helpers';
import { future } from './support/inspection-helpers';
import {
  Actor,
  OfficerWorld,
  as,
  buildOfficerWorld,
} from './support/officer-world';

jest.setTimeout(600_000);

/**
 * Step 11C — the applicant's read-only view of their application's
 * inspections (FRD 24.1; Blueprint 13.7 "Applicant(own)"), over real
 * HTTP -> Nest -> Prisma -> PostgreSQL:
 *
 *   GET /enterprises/:e/projects/:p/applications/:a/inspections
 *   GET /enterprises/:e/projects/:p/applications/:a/inspections/:inspectionId
 *
 * Covered: what the applicant sees at each stage, what they never see,
 * enterprise / project / representative access, reassignment, history, and
 * that Steps 10-11B permissions are unchanged.
 */
describe('Inspection applicant view e2e (Step 11C)', () => {
  let ctx: E2eContext;
  let w: OfficerWorld;
  let inspectorA2: Actor;
  let rep: Actor;
  let strangerRep: Actor;

  const api = (a: { accessToken: string }) => as(ctx, a.accessToken);
  const officerApp = (id: string) => `/officer/applications/${id}`;
  const errorCode = (res: { body: { error?: { code?: string } } }) =>
    res.body.error?.code;

  interface Scenario {
    projectId: string;
    applicationId: string;
  }
  const viewPath = (s: Scenario, tail = '', enterpriseId = w.enterpriseId) =>
    `/enterprises/${enterpriseId}/projects/${s.projectId}/applications/${s.applicationId}/inspections${tail}`;

  /** An application under scrutiny by soA1 (department A, no inspection
   * requirement configured). */
  const underScrutiny = async (
    tag: string,
    over: { projectId?: string } = {},
  ): Promise<Scenario> => {
    const s = await ctx.submittedApplication(
      w.owner.accessToken,
      w.enterpriseId,
      w.approvalA,
      `iap-${tag}`,
      over,
    );
    await api(w.adminA)
      .post(`${officerApp(s.applicationId)}/assignment`)
      .send({ officerUserId: w.soA1.user.id })
      .expect(201);
    await api(w.soA1)
      .post(`${officerApp(s.applicationId)}/start-scrutiny`)
      .expect(200);
    return s;
  };

  const requestInspection = async (
    s: Scenario,
    body: Record<string, unknown> = {},
  ): Promise<string> =>
    (
      await api(w.soA1)
        .post(`${officerApp(s.applicationId)}/inspections`)
        .send({
          inspectorUserId: w.inspectorA.user.id,
          siteAddress: 'Plot 12, MIDC Industrial Area',
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
        summary: 'INTERNAL-SUMMARY-TEXT the inspector wrote for the department',
        ...over,
      });

  const grant = async (
    enterpriseId: string,
    who: Actor,
    body: Record<string, unknown>,
  ) => {
    const granted = await api(w.owner)
      .post(`/enterprises/${enterpriseId}/representatives`)
      .send({ emailOrMobile: who.user.email, ...body })
      .expect(201);
    await api(who)
      .post(`/representative-authorisations/${granted.body.id}/accept`)
      .expect(200);
  };

  beforeAll(async () => {
    ctx = await createE2eContext();
    w = await buildOfficerWorld(ctx, 'iap');
    [inspectorA2, rep, strangerRep] = await Promise.all([
      ctx.officerSession('iap-ins2', 'INSPECTOR', w.deptA.id),
      ctx.applicantSession('iap-rep'),
      ctx.applicantSession('iap-stranger'),
    ]);
  });

  afterAll(async () => {
    await ctx.cleanup();
    await ctx.app.close();
  });

  // -------------------------------------------------------------------------
  describe('what the applicant sees, stage by stage', () => {
    it('before any inspection: the requirement is reported, the list is empty', async () => {
      const s = await underScrutiny('none');
      const res = await api(w.owner).get(viewPath(s)).expect(200);
      expect(res.body).toEqual({
        applicationId: s.applicationId,
        inspectionRequired: false,
        inspections: [],
      });
    });

    it('PENDING (requested, no date), then SCHEDULED, then confirmed, then COMPLETED with the outcome — live', async () => {
      const s = await underScrutiny('lifecycle');
      const id = await requestInspection(s);

      const pending = await api(w.owner)
        .get(viewPath(s, `/${id}`))
        .expect(200);
      expect(pending.body).toMatchObject({
        id,
        status: 'PENDING',
        scheduledAt: null,
        scheduleConfirmedAt: null,
        siteAddress: 'Plot 12, MIDC Industrial Area',
        outcome: null,
      });

      const when = future(3);
      await api(w.soA1)
        .put(`${officerApp(s.applicationId)}/inspections/${id}`)
        .send({ scheduledAt: when })
        .expect(200);
      const scheduled = await api(w.owner)
        .get(viewPath(s, `/${id}`))
        .expect(200);
      expect(scheduled.body.status).toBe('SCHEDULED');
      expect(new Date(scheduled.body.scheduledAt).toISOString()).toBe(
        new Date(when).toISOString(),
      );
      expect(scheduled.body.scheduleConfirmedAt).toBeNull();
      expect(scheduled.body.outcome).toBeNull();

      await api(w.inspectorA).post(`/inspections/${id}/confirm`).expect(200);
      const confirmed = await api(w.owner)
        .get(viewPath(s, `/${id}`))
        .expect(200);
      expect(confirmed.body.scheduleConfirmedAt).not.toBeNull();

      await complete(id, {
        overallFinding: 'NON_COMPLIANT',
        correctiveAction: 'Install a second fire exit.',
      }).expect(201);
      const done = await api(w.owner)
        .get(viewPath(s, `/${id}`))
        .expect(200);
      expect(done.body.status).toBe('COMPLETED');
      expect(done.body.outcome).toEqual({
        overallFinding: 'NON_COMPLIANT',
        correctiveAction: 'Install a second fire exit.',
        recordedAt: expect.any(String),
      });

      // The list agrees with the detail.
      const list = await api(w.owner).get(viewPath(s)).expect(200);
      expect(list.body.inspections).toEqual([done.body]);
    });

    it('a COMPLIANT outcome has no corrective action', async () => {
      const s = await underScrutiny('compliant');
      const id = await requestInspection(s, { scheduledAt: future(2) });
      await complete(id).expect(201);
      const res = await api(w.owner)
        .get(viewPath(s, `/${id}`))
        .expect(200);
      expect(res.body.outcome).toMatchObject({
        overallFinding: 'COMPLIANT',
        correctiveAction: null,
      });
    });

    it('a cancelled inspection is shown as CANCELLED with no outcome', async () => {
      const s = await underScrutiny('cancelled');
      const id = await requestInspection(s);
      await ctx.prisma.inspection.update({
        where: { id },
        data: { status: 'CANCELLED' },
      });
      const res = await api(w.owner)
        .get(viewPath(s, `/${id}`))
        .expect(200);
      expect(res.body).toMatchObject({ status: 'CANCELLED', outcome: null });
    });

    it('the applicant-facing APPLICATION status is untouched by any inspection step', async () => {
      const s = await underScrutiny('appstate');
      const id = await requestInspection(s, { scheduledAt: future(2) });
      await complete(id).expect(201);
      const status = await api(w.owner)
        .get(
          `/enterprises/${w.enterpriseId}/projects/${s.projectId}/applications/${s.applicationId}/status`,
        )
        .expect(200);
      expect(status.body.applicantStatus).toBe('UNDER_SCRUTINY');
      const row = await ctx.prisma.approvalApplication.findUniqueOrThrow({
        where: { id: s.applicationId },
      });
      expect(row.internalState).toBe('UNDER_SCRUTINY');
    });
  });

  // -------------------------------------------------------------------------
  describe('what the applicant never sees', () => {
    it('no inspector, assignment, officer notes, checklist results, evidence or report text — before or after completion', async () => {
      const s = await underScrutiny('hidden');
      await api(w.soA1)
        .post(`${officerApp(s.applicationId)}/observations`)
        .send({ body: 'INTERNAL-OBSERVATION-TEXT not for the applicant' })
        .expect(201);
      const id = await requestInspection(s, { scheduledAt: future(2) });
      const before = await api(w.owner).get(viewPath(s)).expect(200);
      await complete(id, {
        overallFinding: 'CONDITIONAL',
        correctiveAction: 'Fix the alarm panel.',
      }).expect(201);
      const after = await api(w.owner).get(viewPath(s)).expect(200);
      const detail = await api(w.owner)
        .get(viewPath(s, `/${id}`))
        .expect(200);

      for (const body of [before.body, after.body, detail.body]) {
        const text = JSON.stringify(body);
        expect(text).not.toContain('INTERNAL-OBSERVATION-TEXT');
        expect(text).not.toContain('INTERNAL-SUMMARY-TEXT');
        expect(text).not.toContain(w.inspectorA.user.id);
        expect(text).not.toContain(w.inspectorA.user.email);
        expect(text).not.toContain(w.soA1.user.id);
        for (const key of [
          'inspector',
          'inspectorId',
          'assignedBy',
          'assignedAt',
          'checklist',
          'evidence',
          'summary',
          'submittedByUserId',
          'geoConsentGiven',
          'storageKey',
          'filePath',
        ]) {
          expect(text).not.toContain(`"${key}"`);
        }
      }
      // Exactly the documented fields.
      expect(Object.keys(detail.body).sort()).toEqual(
        [
          'createdAt',
          'id',
          'outcome',
          'scheduleConfirmedAt',
          'scheduledAt',
          'siteAddress',
          'status',
          'updatedAt',
        ].sort(),
      );
      expect(Object.keys(detail.body.outcome).sort()).toEqual(
        ['correctiveAction', 'overallFinding', 'recordedAt'].sort(),
      );
    });

    it('evidence attached by the inspector is not reachable through the applicant routes', async () => {
      const s = await underScrutiny('evidence');
      const id = await requestInspection(s, { scheduledAt: future(2) });
      // Inspector routes are closed to the applicant.
      for (const path of [
        `/inspections/${id}`,
        `/inspections/${id}/report`,
        `/inspections/${id}/evidence/00000000-0000-4000-8000-000000000000/download`,
      ]) {
        const res = await api(w.owner).get(path);
        expect(res.status).toBe(403);
        expect(errorCode(res)).toBe('INSUFFICIENT_ROLE');
      }
    });
  });

  // -------------------------------------------------------------------------
  describe('whose inspection: enterprise, project and representative access', () => {
    let s: Scenario;
    let inspectionId: string;

    beforeAll(async () => {
      s = await underScrutiny('access');
      inspectionId = await requestInspection(s, { scheduledAt: future(2) });
    });

    it('unauthenticated: 401', async () => {
      const res = await request(ctx.http).get(`${API}${viewPath(s)}`);
      expect(res.status).toBe(401);
    });

    it('another applicant with their OWN enterprise cannot reach it by id substitution: 404', async () => {
      // Their enterprise id, this enterprise's project / application.
      const cross = await api(w.owner2).get(
        viewPath(s, `/${inspectionId}`, w.enterprise2Id),
      );
      expect(cross.status).toBe(404);
      // This enterprise's id, without any relationship to it.
      const foreign = await api(w.owner2).get(viewPath(s));
      expect(foreign.status).toBe(404);
      const foreignOne = await api(w.owner2).get(
        viewPath(s, `/${inspectionId}`),
      );
      expect(foreignOne.status).toBe(404);
      expect(JSON.stringify(foreign.body)).not.toContain(inspectionId);
    });

    it('right enterprise, wrong project: 404', async () => {
      const other = await underScrutiny('other-project');
      const res = await api(w.owner).get(
        `/enterprises/${w.enterpriseId}/projects/${other.projectId}/applications/${s.applicationId}/inspections`,
      );
      expect(res.status).toBe(404);
    });

    it('an inspection of ANOTHER application is not reachable through this one: 404', async () => {
      const other = await underScrutiny('other-app');
      const otherInspection = await requestInspection(other);
      const res = await api(w.owner).get(viewPath(s, `/${otherInspection}`));
      expect(res.status).toBe(404);
      await api(w.owner)
        .get(viewPath(other, `/${otherInspection}`))
        .expect(200);
    });

    it('nonexistent and malformed ids: 404 / 400', async () => {
      const missing = await api(w.owner).get(
        viewPath(s, '/00000000-0000-4000-8000-000000000000'),
      );
      expect(missing.status).toBe(404);
      expect((await api(w.owner).get(viewPath(s, '/not-a-uuid'))).status).toBe(
        400,
      );
    });

    it('a representative with VIEW_ONLY scope can read it; one with no authorisation cannot', async () => {
      expect((await api(rep).get(viewPath(s))).status).toBe(404);
      await grant(w.enterpriseId, rep, { scope: 'VIEW_ONLY' });
      const res = await api(rep).get(viewPath(s)).expect(200);
      expect(res.body.inspections.map((i: { id: string }) => i.id)).toEqual([
        inspectionId,
      ]);
      await api(rep)
        .get(viewPath(s, `/${inspectionId}`))
        .expect(200);
      expect((await api(strangerRep).get(viewPath(s))).status).toBe(404);
    });

    it('a representative restricted to ANOTHER project is refused this one', async () => {
      const restrictedTo = await underScrutiny('restricted-to');
      await grant(w.enterpriseId, strangerRep, {
        scope: 'FULL',
        projectIds: [restrictedTo.projectId],
      });
      const res = await api(strangerRep).get(viewPath(s));
      expect(res.status).toBe(403);
      expect(errorCode(res)).toBe('FORBIDDEN_SCOPE');
      await api(strangerRep).get(viewPath(restrictedTo)).expect(200);
    });

    it('officers, inspectors and admins have no relationship to the enterprise, so the applicant routes show them nothing: 404', async () => {
      // Their accounts also hold the default Applicant role; what protects the
      // enterprise's data is the enterprise relationship, not the role alone.
      for (const actor of [w.soA1, w.inspectorA, w.adminA, w.aaA, w.sysAdmin]) {
        for (const path of [viewPath(s), viewPath(s, `/${inspectionId}`)]) {
          const res = await api(actor).get(path);
          expect(res.status).toBe(404);
          expect(JSON.stringify(res.body)).not.toContain(inspectionId);
        }
      }
    });

    it('the applicant view is read-only: there is no write route', async () => {
      const path = viewPath(s, `/${inspectionId}`);
      for (const res of [
        await api(w.owner).post(viewPath(s)),
        await api(w.owner).put(path),
        await api(w.owner).patch(path),
        await api(w.owner).del(path),
        await api(w.owner).post(`${path}/confirm`),
      ]) {
        expect(res.status).toBe(404);
      }
      const row = await ctx.prisma.inspection.findUniqueOrThrow({
        where: { id: inspectionId },
      });
      expect(row.status).toBe('SCHEDULED');
      expect(row.confirmedAt).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  describe('reassignment and history', () => {
    it('reassigning the inspector changes nothing the applicant sees; the previous inspector loses access, the new one gains it', async () => {
      const s = await underScrutiny('reassign');
      const id = await requestInspection(s, { scheduledAt: future(2) });
      const before = (
        await api(w.owner)
          .get(viewPath(s, `/${id}`))
          .expect(200)
      ).body;

      await api(w.inspectorA).get(`/inspections/${id}`).expect(200);
      await api(w.soA1)
        .put(`${officerApp(s.applicationId)}/inspections/${id}`)
        .send({
          inspectorUserId: inspectorA2.user.id,
          reason: 'Workload rebalancing',
        })
        .expect(200);

      const after = (
        await api(w.owner)
          .get(viewPath(s, `/${id}`))
          .expect(200)
      ).body;
      // Same inspection, same schedule; only the (withdrawn) confirmation and
      // the modification time may move.
      expect(after).toMatchObject({
        id,
        status: 'SCHEDULED',
        scheduledAt: before.scheduledAt,
        siteAddress: before.siteAddress,
      });
      expect(JSON.stringify(after)).not.toContain(inspectorA2.user.id);

      // The Step 11A/11B access rules are unchanged.
      expect((await api(w.inspectorA).get(`/inspections/${id}`)).status).toBe(
        404,
      );
      expect((await complete(id, {}, w.inspectorA)).status).toBe(404);
      await api(inspectorA2).get(`/inspections/${id}`).expect(200);
      await complete(id, {}, inspectorA2).expect(201);
      expect(
        (
          await api(w.owner)
            .get(viewPath(s, `/${id}`))
            .expect(200)
        ).body.status,
      ).toBe('COMPLETED');
    });

    it('a finished inspection stays visible after the inspector is reassigned on a later one; earlier inspections are never removed', async () => {
      const s = await underScrutiny('history');
      const first = await requestInspection(s, { scheduledAt: future(2) });
      await complete(first, {
        overallFinding: 'NON_COMPLIANT',
        correctiveAction: 'Repair the drainage.',
      }).expect(201);
      // A follow-up visit with a different inspector.
      const second = await requestInspection(s, {
        inspectorUserId: inspectorA2.user.id,
        scheduledAt: future(9),
      });

      const res = await api(w.owner).get(viewPath(s)).expect(200);
      expect(res.body.inspections.map((i: { id: string }) => i.id)).toEqual([
        first,
        second,
      ]);
      expect(res.body.inspections[0]).toMatchObject({
        status: 'COMPLETED',
        outcome: {
          overallFinding: 'NON_COMPLIANT',
          correctiveAction: 'Repair the drainage.',
        },
      });
      expect(res.body.inspections[1]).toMatchObject({
        status: 'SCHEDULED',
        outcome: null,
      });
      // The database still holds the first report exactly as submitted.
      const report = await ctx.prisma.inspectionReportSummary.findUniqueOrThrow(
        { where: { inspectionId: first } },
      );
      expect(report.correctiveAction).toBe('Repair the drainage.');
    });
  });

  // -------------------------------------------------------------------------
  describe('Steps 10–11B are unchanged for officers and inspectors', () => {
    it('the officer and inspector routes behave as before, and the applicant application view carries no inspection data', async () => {
      const s = await underScrutiny('regression');
      const id = await requestInspection(s, { scheduledAt: future(2) });
      await api(w.soA1)
        .get(`${officerApp(s.applicationId)}/inspections`)
        .expect(200);
      await api(w.inspectorA).get(`/inspections/${id}`).expect(200);
      await api(w.inspectorA).post(`/inspections/${id}/confirm`).expect(200);
      // A Scrutiny Officer still cannot act as the inspector.
      const denied = await api(w.soA1).post(`/inspections/${id}/confirm`);
      expect(denied.status).toBe(403);
      expect(errorCode(denied)).toBe('INSUFFICIENT_ROLE');

      const app = await api(w.owner)
        .get(
          `/enterprises/${w.enterpriseId}/projects/${s.projectId}/applications/${s.applicationId}`,
        )
        .expect(200);
      expect(JSON.stringify(app.body)).not.toContain(id);
    });
  });
});
