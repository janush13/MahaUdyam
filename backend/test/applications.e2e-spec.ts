import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { API, E2eContext, createE2eContext } from './support/e2e-helpers';

jest.setTimeout(300_000);

interface Actor {
  user: { id: string; email: string; mobile: string };
  accessToken: string;
}

/**
 * The application lifecycle over real HTTP -> Nest -> Prisma -> PostgreSQL:
 * creation from a stored discovery snapshot, validation, editing a draft,
 * pre-submission validation, submission, the two-layer status model, the
 * discovery linkage and its historical immutability, and the audit trail.
 * Authorisation by scope / project restriction is in
 * application-access.e2e-spec.ts.
 */
describe('Applications e2e — lifecycle, discovery linkage and history', () => {
  let ctx: E2eContext;
  let owner: Actor;
  let enterpriseId: string;

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
  const me = () => as(owner.accessToken);

  const appsUrl = (p: string) =>
    `/enterprises/${enterpriseId}/projects/${p}/applications`;
  const appUrl = (p: string, a: string) => `${appsUrl(p)}/${a}`;

  /** A fresh project + a fresh startable approval + a stored discovery snapshot. */
  const scenario = async (tag: string) => {
    const project = await ctx.createProjectVia(
      owner.accessToken,
      enterpriseId,
      tag,
    );
    const approval = await ctx.createStartableApproval(owner.user.id, tag);
    const snapshotId = await ctx.discover(
      owner.accessToken,
      enterpriseId,
      project.id,
    );
    return { projectId: project.id, snapshotId, ...approval };
  };

  const create = (
    projectId: string,
    approvalTypeId: string,
    discoverySnapshotId: string,
    extra: Record<string, unknown> = {},
  ) =>
    me()
      .post(appsUrl(projectId))
      .send({ approvalTypeId, discoverySnapshotId, ...extra });

  const startDraft = async (
    tag: string,
    extra: Record<string, unknown> = {},
  ) => {
    const s = await scenario(tag);
    const res = await create(
      s.projectId,
      s.approvalTypeId,
      s.snapshotId,
      extra,
    ).expect(201);
    return { ...s, applicationId: res.body.id as string, body: res.body };
  };

  const dbApp = (id: string) =>
    ctx.prisma.approvalApplication.findUniqueOrThrow({ where: { id } });

  const submit = (projectId: string, applicationId: string) =>
    me()
      .post(`${appUrl(projectId, applicationId)}/submit`)
      .send({ declarationAccepted: true });

  beforeAll(async () => {
    ctx = await createE2eContext();
    owner = await ctx.applicantSession('app-owner');
    enterpriseId = (await ctx.createEnterprise(owner.accessToken, 'app')).id;
  });

  afterAll(async () => {
    await ctx.cleanup();
    await ctx.app.close();
  });

  // -------------------------------------------------------------------------
  describe('creation', () => {
    it('creates a DRAFT linked to the project, approval type, workflow and discovery snapshot', async () => {
      const s = await scenario('create');
      const res = await create(s.projectId, s.approvalTypeId, s.snapshotId, {
        formData: { proposedCapacity: '500 units per month', workers: 12 },
      }).expect(201);

      expect(res.body).toMatchObject({
        referenceNumber: null,
        enterpriseId,
        projectId: s.projectId,
        applicantStatus: 'READY_TO_SUBMIT',
        editable: true,
        formData: { proposedCapacity: '500 units per month', workers: 12 },
        submittedAt: null,
        createdByUserId: owner.user.id,
        submittedByUserId: null,
        approvalType: { id: s.approvalTypeId },
      });
      expect(res.body.projectReferenceNumber).toMatch(/^PRJ-\d{4}-\d{6}$/);

      const row = await dbApp(res.body.id);
      expect(row).toMatchObject({
        projectId: s.projectId,
        approvalTypeId: s.approvalTypeId,
        internalState: 'DRAFT',
        applicantStatus: 'READY_TO_SUBMIT',
        discoverySnapshotId: s.snapshotId,
        createdByUserId: owner.user.id,
      });
      const workflow = await ctx.prisma.workflow.findFirstOrThrow({
        where: { approvalTypeId: s.approvalTypeId },
      });
      expect(row.workflowId).toBe(workflow.id);
    });

    it('never exposes the internal state or workflow — only the applicant-facing status', async () => {
      const d = await startDraft('layers');
      expect(d.body).not.toHaveProperty('internalState');
      expect(d.body).not.toHaveProperty('workflowId');
      expect(d.body.applicantStatus).toBe('READY_TO_SUBMIT');
      expect((await dbApp(d.applicationId)).internalState).toBe('DRAFT');
    });

    it('records which rule/discovery context it was created from, and labels it a recommendation', async () => {
      const d = await startDraft('context');
      const snapshot = await ctx.prisma.discoverySnapshot.findUniqueOrThrow({
        where: { id: d.snapshotId },
      });
      expect(d.body.discovery).toMatchObject({
        snapshotId: d.snapshotId,
        snapshotEvaluatedAt: snapshot.evaluatedAt.toISOString(),
        engineVersion: snapshot.engineVersion,
        recommendationLabel: 'POTENTIALLY_APPLICABLE',
        rule: { id: d.ruleId, version: 1, sourceReference: 'E2E TEST FIXTURE' },
        department: { id: d.departmentId },
      });
      expect(d.body.discovery.explanation).toMatch(/^Shown because:/);
      expect(d.body.discovery.note).toMatch(/not a statutory determination/i);
    });

    it('rejects a missing/invalid body with the standard error envelope', async () => {
      const s = await scenario('badbody');
      for (const body of [
        {},
        { approvalTypeId: s.approvalTypeId },
        { discoverySnapshotId: s.snapshotId },
        { approvalTypeId: 'nope', discoverySnapshotId: s.snapshotId },
        { approvalTypeId: s.approvalTypeId, discoverySnapshotId: 'nope' },
      ]) {
        const res = await me()
          .post(appsUrl(s.projectId))
          .send(body)
          .expect(400);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
        expect(res.body.error.fields).toBeDefined();
      }
    });

    it.each([
      'enterpriseId',
      'projectId',
      'ownerUserId',
      'workflowId',
      'status',
      'internalState',
      'applicantStatus',
      'referenceNumber',
      'createdByUserId',
    ])(
      'refuses the client-supplied field %s (no duplicated ownership, no client status)',
      async (field) => {
        const s = await scenario(`extra-${field}`);
        const res = await create(s.projectId, s.approvalTypeId, s.snapshotId, {
          [field]: randomUUID(),
        }).expect(400);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
        expect(
          await ctx.prisma.approvalApplication.count({
            where: { projectId: s.projectId },
          }),
        ).toBe(0);
      },
    );

    it('rejects malformed approval-specific details with field errors', async () => {
      const s = await scenario('badform');
      const res = await create(s.projectId, s.approvalTypeId, s.snapshotId, {
        formData: { enterpriseId: 'x', nested: { a: 1 }, ok: 'fine' },
      }).expect(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(Object.keys(res.body.error.fields).sort()).toEqual([
        'formData.enterpriseId',
        'formData.nested',
      ]);
    });

    it('404s for a discovery snapshot that does not exist or belongs to another project', async () => {
      const s = await scenario('nosnap');
      const other = await scenario('othersnap');
      await create(s.projectId, s.approvalTypeId, randomUUID()).expect(404);
      // Another project's real snapshot is indistinguishable from a missing one.
      const res = await create(
        s.projectId,
        s.approvalTypeId,
        other.snapshotId,
      ).expect(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('422s when the approval was not applicable in the cited discovery result', async () => {
      const s = await scenario('notapplicable');
      // A rule that does not match this (non-hazardous) project.
      const dept = await ctx.createDepartment('na');
      const type = await ctx.createApprovalType(dept.id, 'NotApplicable');
      await ctx.publishRule(owner.user.id, type, {
        field: 'hazardous_flag',
        op: 'equals',
        value: true,
      });
      await ctx.createWorkflow(type);
      const snapshotId = await ctx.discover(
        owner.accessToken,
        enterpriseId,
        s.projectId,
      );
      const res = await create(s.projectId, type, snapshotId).expect(422);
      expect(res.body.error.code).toBe('APPROVAL_NOT_IN_DISCOVERY');
      expect(
        await ctx.prisma.approvalApplication.count({
          where: { projectId: s.projectId },
        }),
      ).toBe(0);
    });

    it('422s for an approval type that is not in discovery at all', async () => {
      const s = await scenario('unknowntype');
      const res = await create(s.projectId, randomUUID(), s.snapshotId).expect(
        422,
      );
      expect(res.body.error.code).toBe('APPROVAL_NOT_IN_DISCOVERY');
    });

    it('409s when the approval type has been deactivated since discovery', async () => {
      const s = await scenario('inactive');
      await ctx.prisma.approvalType.update({
        where: { id: s.approvalTypeId },
        data: { isActive: false },
      });
      const res = await create(
        s.projectId,
        s.approvalTypeId,
        s.snapshotId,
      ).expect(409);
      expect(res.body.error.code).toBe('APPROVAL_TYPE_INACTIVE');
    });

    it('409s when no workflow is configured for the approval (nothing is invented)', async () => {
      const project = await ctx.createProjectVia(
        owner.accessToken,
        enterpriseId,
        'noworkflow',
      );
      const approval = await ctx.createStartableApproval(
        owner.user.id,
        'noworkflow',
        { withWorkflow: false },
      );
      const snapshotId = await ctx.discover(
        owner.accessToken,
        enterpriseId,
        project.id,
      );
      const res = await create(
        project.id,
        approval.approvalTypeId,
        snapshotId,
      ).expect(409);
      expect(res.body.error.code).toBe('WORKFLOW_NOT_CONFIGURED');
    });

    it('pins the highest ACTIVE workflow version', async () => {
      const project = await ctx.createProjectVia(
        owner.accessToken,
        enterpriseId,
        'wfpin',
      );
      const approval = await ctx.createStartableApproval(
        owner.user.id,
        'wfpin',
        {
          withWorkflow: false,
        },
      );
      const v1 = await ctx.createWorkflow(approval.approvalTypeId, {
        version: 1,
      });
      const v2 = await ctx.createWorkflow(approval.approvalTypeId, {
        version: 2,
      });
      await ctx.createWorkflow(approval.approvalTypeId, {
        version: 3,
        isActive: false,
      });
      const snapshotId = await ctx.discover(
        owner.accessToken,
        enterpriseId,
        project.id,
      );
      const res = await create(
        project.id,
        approval.approvalTypeId,
        snapshotId,
      ).expect(201);
      const row = await dbApp(res.body.id);
      expect(row.workflowId).toBe(v2.id);
      expect(row.workflowId).not.toBe(v1.id);
    });

    it('allows only ONE live application per approval per project, even when raced', async () => {
      const s = await scenario('dup');
      const results = await Promise.all([
        create(s.projectId, s.approvalTypeId, s.snapshotId),
        create(s.projectId, s.approvalTypeId, s.snapshotId),
        create(s.projectId, s.approvalTypeId, s.snapshotId),
      ]);
      const codes = results.map((r) => r.status).sort();
      expect(codes).toEqual([201, 409, 409]);
      const conflict = results.find((r) => r.status === 409)!;
      expect(conflict.body.error.code).toBe('APPLICATION_ALREADY_EXISTS');
      expect(
        await ctx.prisma.approvalApplication.count({
          where: { projectId: s.projectId },
        }),
      ).toBe(1);
    });

    it('allows a new application for the approval once the previous one is terminal', async () => {
      const d = await startDraft('afterterminal');
      await create(d.projectId, d.approvalTypeId, d.snapshotId).expect(409);
      // Cancellation is an administrative action of a later step; simulate its
      // effect directly to prove the rule only blocks LIVE applications.
      await ctx.prisma.approvalApplication.update({
        where: { id: d.applicationId },
        data: { internalState: 'CANCELLED' },
      });
      await create(d.projectId, d.approvalTypeId, d.snapshotId).expect(201);
    });

    it('two different approvals of one project are independent applications (no merged outcome)', async () => {
      const project = await ctx.createProjectVia(
        owner.accessToken,
        enterpriseId,
        'multi',
      );
      const a = await ctx.createStartableApproval(owner.user.id, 'multi-a');
      const b = await ctx.createStartableApproval(owner.user.id, 'multi-b');
      const snapshotId = await ctx.discover(
        owner.accessToken,
        enterpriseId,
        project.id,
      );
      const appA = await create(
        project.id,
        a.approvalTypeId,
        snapshotId,
      ).expect(201);
      const appB = await create(
        project.id,
        b.approvalTypeId,
        snapshotId,
      ).expect(201);
      expect(appA.body.id).not.toBe(appB.body.id);
      await submit(project.id, appA.body.id).expect(200);
      const statusB = await me()
        .get(`${appUrl(project.id, appB.body.id)}/status`)
        .expect(200);
      expect(statusB.body.applicantStatus).toBe('READY_TO_SUBMIT');
    });
  });

  // -------------------------------------------------------------------------
  describe('reading and listing', () => {
    it('gets one application, its status, and lists it (project and enterprise level)', async () => {
      const d = await startDraft('read');
      const got = await me()
        .get(appUrl(d.projectId, d.applicationId))
        .expect(200);
      expect(got.body.id).toBe(d.applicationId);

      const status = await me()
        .get(`${appUrl(d.projectId, d.applicationId)}/status`)
        .expect(200);
      expect(status.body).toMatchObject({
        id: d.applicationId,
        referenceNumber: null,
        applicantStatus: 'READY_TO_SUBMIT',
        editable: true,
        submittedAt: null,
      });

      const list = await me().get(appsUrl(d.projectId)).expect(200);
      expect(list.body.map((a: { id: string }) => a.id)).toContain(
        d.applicationId,
      );
      const all = await me()
        .get(`/enterprises/${enterpriseId}/applications`)
        .expect(200);
      expect(all.body.map((a: { id: string }) => a.id)).toContain(
        d.applicationId,
      );
    });

    it('filters lists by approval, status and (enterprise-wide) project', async () => {
      const d = await startDraft('filter');
      const byType = await me()
        .get(`${appsUrl(d.projectId)}?approvalTypeId=${d.approvalTypeId}`)
        .expect(200);
      expect(byType.body).toHaveLength(1);
      const otherType = await me()
        .get(`${appsUrl(d.projectId)}?approvalTypeId=${randomUUID()}`)
        .expect(200);
      expect(otherType.body).toEqual([]);
      const byStatus = await me()
        .get(`${appsUrl(d.projectId)}?applicantStatus=SUBMITTED`)
        .expect(200);
      expect(byStatus.body).toEqual([]);
      const ready = await me()
        .get(`${appsUrl(d.projectId)}?applicantStatus=READY_TO_SUBMIT`)
        .expect(200);
      expect(ready.body).toHaveLength(1);
      const byProject = await me()
        .get(
          `/enterprises/${enterpriseId}/applications?projectId=${d.projectId}`,
        )
        .expect(200);
      expect(byProject.body.map((a: { id: string }) => a.id)).toEqual([
        d.applicationId,
      ]);
      await me()
        .get(`${appsUrl(d.projectId)}?applicantStatus=NOPE`)
        .expect(400);
      await me()
        .get(`${appsUrl(d.projectId)}?unknownFilter=x`)
        .expect(400);
    });

    it('404s for an unknown application id and a wrong project for a real one', async () => {
      const d = await startDraft('read404');
      const other = await ctx.createProjectVia(
        owner.accessToken,
        enterpriseId,
        'read404b',
      );
      await me().get(appUrl(d.projectId, randomUUID())).expect(404);
      await me().get(appUrl(other.id, d.applicationId)).expect(404);
      await me().get(appUrl(d.projectId, 'not-a-uuid')).expect(400);
    });
  });

  // -------------------------------------------------------------------------
  describe('editing a draft', () => {
    it('saves approval-specific details and keeps the status derived, not client-set', async () => {
      const d = await startDraft('edit');
      const res = await me()
        .put(`${appUrl(d.projectId, d.applicationId)}/draft`)
        .send({ formData: { proposedCapacity: '900', usesBoiler: true } })
        .expect(200);
      expect(res.body.formData).toEqual({
        proposedCapacity: '900',
        usesBoiler: true,
      });
      expect(res.body.editable).toBe(true);
      expect((await dbApp(d.applicationId)).formData).toEqual({
        proposedCapacity: '900',
        usesBoiler: true,
      });

      // PUT replaces the set.
      const replaced = await me()
        .put(`${appUrl(d.projectId, d.applicationId)}/draft`)
        .send({ formData: { only: 'this' } })
        .expect(200);
      expect(replaced.body.formData).toEqual({ only: 'this' });
    });

    it('saving identical details is a no-op (no audit entry)', async () => {
      const d = await startDraft('noop', { formData: { a: 'same' } });
      await me()
        .put(`${appUrl(d.projectId, d.applicationId)}/draft`)
        .send({ formData: { a: 'same' } })
        .expect(200);
      const events = await ctx.prisma.auditLog.findMany({
        where: { entityId: d.applicationId, action: 'APPLICATION_UPDATED' },
      });
      expect(events).toHaveLength(0);
    });

    it('rejects invalid details and leaves the draft untouched', async () => {
      const d = await startDraft('badedit', { formData: { a: 'keep' } });
      for (const formData of [
        { status: 'APPROVED' },
        { projectId: randomUUID() },
        { n: { nested: true } },
        { 'Bad Key': 1 },
      ]) {
        const res = await me()
          .put(`${appUrl(d.projectId, d.applicationId)}/draft`)
          .send({ formData })
          .expect(400);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
      }
      expect((await dbApp(d.applicationId)).formData).toEqual({ a: 'keep' });
    });

    it.each([
      'status',
      'applicantStatus',
      'internalState',
      'projectId',
      'enterpriseId',
      'approvalTypeId',
      'discoverySnapshotId',
    ])('cannot change %s through the draft endpoint', async (field) => {
      const d = await startDraft(`fld-${field}`);
      const before = await dbApp(d.applicationId);
      await me()
        .put(`${appUrl(d.projectId, d.applicationId)}/draft`)
        .send({ formData: {}, [field]: randomUUID() })
        .expect(400);
      const after = await dbApp(d.applicationId);
      expect(after.internalState).toBe(before.internalState);
      expect(after.projectId).toBe(before.projectId);
      expect(after.discoverySnapshotId).toBe(before.discoverySnapshotId);
    });
  });

  // -------------------------------------------------------------------------
  describe('no arbitrary status changes', () => {
    it('offers no route that writes a status (PATCH/PUT/POST/DELETE on the application and on /status)', async () => {
      const d = await startDraft('nostatus');
      const base = appUrl(d.projectId, d.applicationId);
      for (const call of [
        () => me().patch(base).send({ status: 'APPROVED' }),
        () => me().put(base).send({ status: 'APPROVED' }),
        () => me().patch(`${base}/status`).send({ status: 'APPROVED' }),
        () => me().put(`${base}/status`).send({ status: 'APPROVED' }),
        () => me().post(`${base}/status`).send({ status: 'APPROVED' }),
        () => me().post(`${base}/approve`).send({}),
        () => me().post(`${base}/transition`).send({ to: 'APPROVED' }),
        () => me().del(base),
      ]) {
        const res = await call();
        expect(res.status).toBe(404);
      }
      const row = await dbApp(d.applicationId);
      expect(row.internalState).toBe('DRAFT');
      expect(row.applicantStatus).toBe('READY_TO_SUBMIT');
    });

    it('the submit endpoint ignores/rejects any status the client tries to smuggle in', async () => {
      const d = await startDraft('smuggle');
      const res = await me()
        .post(`${appUrl(d.projectId, d.applicationId)}/submit`)
        .send({ declarationAccepted: true, internalState: 'APPROVED' })
        .expect(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect((await dbApp(d.applicationId)).internalState).toBe('DRAFT');
    });

    it('a decision state is unreachable: after submit the application is only ever SUBMITTED', async () => {
      const d = await startDraft('nodecision');
      await submit(d.projectId, d.applicationId).expect(200);
      const row = await dbApp(d.applicationId);
      expect(row.internalState).toBe('SUBMITTED');
      expect(row.decidedAt).toBeNull();
      expect(row.decisionReason).toBeNull();
      expect(row.riskBand).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  describe('pre-submission validation', () => {
    it('is ready when the department has configured nothing mandatory, and carries the disclaimer', async () => {
      const d = await startDraft('prevalid');
      const res = await me()
        .post(`${appUrl(d.projectId, d.applicationId)}/pre-validate`)
        .expect(200);
      expect(res.body).toMatchObject({
        errors: [],
        warnings: [],
        missingDocuments: [],
        readyForSubmission: true,
        disclaimer:
          'Passing these checks confirms your application is complete for submission. It does not guarantee approval by the relevant department, which will conduct its own review.',
      });
    });

    it('reports configured mandatory documents as missing and blocks; attaching them clears it', async () => {
      const d = await startDraft('mandatory');
      const requirement = await ctx.prisma.documentRequirement.create({
        data: {
          approvalTypeId: d.approvalTypeId,
          name: 'E2E identity proof',
          isMandatory: true,
        },
      });
      await ctx.prisma.documentRequirement.create({
        data: {
          approvalTypeId: d.approvalTypeId,
          name: 'E2E optional extra',
          isMandatory: false,
        },
      });

      const blocked = await me()
        .post(`${appUrl(d.projectId, d.applicationId)}/pre-validate`)
        .expect(200);
      expect(blocked.body.readyForSubmission).toBe(false);
      expect(blocked.body.missingDocuments).toEqual([
        { requirementId: requirement.id, name: 'E2E identity proof' },
      ]);

      // Submission is blocked by the same rule, with the standard envelope.
      const before = await dbApp(d.applicationId);
      const submitted = await submit(d.projectId, d.applicationId).expect(422);
      expect(submitted.body.error.code).toBe('VALIDATION_FAILED');
      expect(submitted.body.error.fields.documents).toEqual([
        'Missing mandatory document: E2E identity proof',
      ]);
      const after = await dbApp(d.applicationId);
      expect(after.internalState).toBe('DRAFT');
      expect(after.referenceNumber).toBeNull();
      expect(after.updatedAt).toEqual(before.updatedAt);

      // A REJECTED document does not satisfy the requirement...
      const doc = await ctx.prisma.document.create({
        data: {
          ownerType: 'PROJECT',
          ownerId: d.projectId,
          documentRequirementId: requirement.id,
          filePath: `e2e/${ctx.runId}/none`,
          checksum: 'e2e',
          originalFilename: 'id.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 1,
          status: 'REJECTED',
          scannedAt: new Date(),
          scannerName: 'E2E_FIXTURE',
          uploadedBy: owner.user.id,
        },
      });
      await ctx.prisma.applicationDocument.create({
        data: { applicationId: d.applicationId, documentId: doc.id },
      });
      const stillBlocked = await me()
        .post(`${appUrl(d.projectId, d.applicationId)}/pre-validate`)
        .expect(200);
      expect(stillBlocked.body.readyForSubmission).toBe(false);

      // ...a usable one does.
      await ctx.prisma.document.update({
        where: { id: doc.id },
        data: { status: 'VALIDATION_PENDING' },
      });
      const ready = await me()
        .post(`${appUrl(d.projectId, d.applicationId)}/pre-validate`)
        .expect(200);
      expect(ready.body).toMatchObject({
        readyForSubmission: true,
        missingDocuments: [],
      });
      await submit(d.projectId, d.applicationId).expect(200);
    });

    it('derives the applicant status (Draft vs Ready to Submit) from validation at create and on every draft save', async () => {
      const s = await scenario('derive');
      await ctx.prisma.documentRequirement.create({
        data: {
          approvalTypeId: s.approvalTypeId,
          name: 'E2E required doc',
          isMandatory: true,
        },
      });
      const created = await create(
        s.projectId,
        s.approvalTypeId,
        s.snapshotId,
      ).expect(201);
      expect(created.body.applicantStatus).toBe('DRAFT');

      const saved = await me()
        .put(`${appUrl(s.projectId, created.body.id)}/draft`)
        .send({ formData: { a: 1 } })
        .expect(200);
      expect(saved.body.applicantStatus).toBe('DRAFT');
      expect((await dbApp(created.body.id)).internalState).toBe('DRAFT');
    });

    it('pre-validation changes nothing and is not audited', async () => {
      const d = await startDraft('prevalid-pure');
      const before = await dbApp(d.applicationId);
      const events = () =>
        ctx.prisma.auditLog.count({ where: { entityId: d.applicationId } });
      const auditBefore = await events();
      await me()
        .post(`${appUrl(d.projectId, d.applicationId)}/pre-validate`)
        .expect(200);
      const after = await dbApp(d.applicationId);
      expect(after.updatedAt).toEqual(before.updatedAt);
      expect(await events()).toBe(auditBefore);
    });
  });

  // -------------------------------------------------------------------------
  describe('submission', () => {
    it('requires the declaration', async () => {
      const d = await startDraft('decl');
      const url = `${appUrl(d.projectId, d.applicationId)}/submit`;
      for (const body of [
        {},
        { declarationAccepted: false },
        { declarationAccepted: 'true' },
      ]) {
        const res = await me().post(url).send(body).expect(400);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
      }
      expect((await dbApp(d.applicationId)).internalState).toBe('DRAFT');
    });

    it('performs DRAFT -> SUBMITTED, generates the permanent reference number and records the submission', async () => {
      const d = await startDraft('submit', { formData: { a: 'declared' } });
      const res = await submit(d.projectId, d.applicationId).expect(200);

      expect(res.body).toMatchObject({
        id: d.applicationId,
        applicantStatus: 'SUBMITTED',
        editable: false,
        submittedByUserId: owner.user.id,
        formData: { a: 'declared' },
      });
      expect(res.body.referenceNumber).toMatch(/^APP-\d{4}-\d{6}$/);
      expect(new Date(res.body.submittedAt).getTime()).toBeGreaterThan(0);
      expect(res.body.declarationAcceptedAt).toBe(res.body.submittedAt);

      const row = await dbApp(d.applicationId);
      expect(row).toMatchObject({
        internalState: 'SUBMITTED',
        applicantStatus: 'SUBMITTED',
        referenceNumber: res.body.referenceNumber,
        submittedByUserId: owner.user.id,
      });

      const status = await me()
        .get(`${appUrl(d.projectId, d.applicationId)}/status`)
        .expect(200);
      expect(status.body).toMatchObject({
        applicantStatus: 'SUBMITTED',
        editable: false,
        referenceNumber: res.body.referenceNumber,
      });
    });

    it('gives every application a distinct reference number', async () => {
      const a = await startDraft('refA');
      const b = await startDraft('refB');
      const [ra, rb] = await Promise.all([
        submit(a.projectId, a.applicationId).expect(200),
        submit(b.projectId, b.applicationId).expect(200),
      ]);
      expect(ra.body.referenceNumber).not.toBe(rb.body.referenceNumber);
    });

    it('is read-only afterwards: edit, re-submit and pre-validate are all ALREADY_SUBMITTED', async () => {
      const d = await startDraft('readonly', { formData: { a: 'v1' } });
      const submitted = await submit(d.projectId, d.applicationId).expect(200);
      const base = appUrl(d.projectId, d.applicationId);

      for (const res of [
        await me()
          .put(`${base}/draft`)
          .send({ formData: { a: 'v2' } }),
        await submit(d.projectId, d.applicationId),
        await me().post(`${base}/pre-validate`),
      ]) {
        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe('ALREADY_SUBMITTED');
      }
      const row = await dbApp(d.applicationId);
      expect(row.formData).toEqual({ a: 'v1' });
      expect(row.referenceNumber).toBe(submitted.body.referenceNumber);
    });

    it('a submission racing another submission succeeds exactly once', async () => {
      const d = await startDraft('race');
      const results = await Promise.all([
        submit(d.projectId, d.applicationId),
        submit(d.projectId, d.applicationId),
        submit(d.projectId, d.applicationId),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409]);
      for (const r of results.filter((x) => x.status === 409)) {
        expect(['ALREADY_SUBMITTED', 'CONFLICT']).toContain(r.body.error.code);
      }
      const events = await ctx.prisma.auditLog.findMany({
        where: { entityId: d.applicationId, action: 'APPLICATION_SUBMITTED' },
      });
      expect(events).toHaveLength(1);
    });

    it('an edit racing a submission can never change what was submitted', async () => {
      // Either side may win the race; the invariant is that what ends up
      // SUBMITTED is exactly what was validated, never a later unvalidated edit.
      for (let i = 0; i < 3; i++) {
        const d = await startDraft(`editrace-${i}`, {
          formData: { a: 'original' },
        });
        const [sub, edit] = await Promise.all([
          submit(d.projectId, d.applicationId),
          me()
            .put(`${appUrl(d.projectId, d.applicationId)}/draft`)
            .send({ formData: { a: 'sneaky' } }),
        ]);
        const row = await dbApp(d.applicationId);

        if (sub.status === 200) {
          // Submission won: the edit either landed first and was then submitted
          // as validated, or was refused as ALREADY_SUBMITTED. Stored data
          // always equals what the response says was submitted.
          expect(row.internalState).toBe('SUBMITTED');
          expect(row.formData).toEqual(sub.body.formData);
          if (edit.status === 409) {
            expect(edit.body.error.code).toBe('ALREADY_SUBMITTED');
            expect(row.formData).toEqual({ a: 'original' });
          }
        } else {
          // The edit won: the submission is refused (never applied to data it
          // did not validate) and the application is still an editable draft.
          expect(sub.status).toBe(409);
          expect(['CONFLICT', 'ALREADY_SUBMITTED']).toContain(
            sub.body.error.code,
          );
          expect(edit.status).toBe(200);
          expect(row.internalState).toBe('DRAFT');
          expect(row.referenceNumber).toBeNull();
          expect(row.formData).toEqual({ a: 'sneaky' });
        }
      }
    });

    it('cannot submit a non-draft that was never submitted (undefined transition)', async () => {
      const d = await startDraft('cancelled');
      await ctx.prisma.approvalApplication.update({
        where: { id: d.applicationId },
        data: { internalState: 'CANCELLED' },
      });
      const res = await submit(d.projectId, d.applicationId).expect(409);
      expect(res.body.error.code).toBe('INVALID_STATE_TRANSITION');
    });
  });

  // -------------------------------------------------------------------------
  describe('discovery snapshot linkage and historical immutability', () => {
    it('a later rule change never rewrites an existing application or its snapshot', async () => {
      const d = await startDraft('history');
      const original = (
        await me().get(appUrl(d.projectId, d.applicationId)).expect(200)
      ).body;
      expect(original.discovery.rule).toMatchObject({
        id: d.ruleId,
        version: 1,
      });

      // Publish rule v2 that no longer matches this project.
      const v2 = await ctx.publishRule(owner.user.id, d.approvalTypeId, {
        field: 'hazardous_flag',
        op: 'equals',
        value: true,
      });
      expect(v2.version).toBe(2);

      // Re-running discovery now excludes the approval...
      const newSnapshot = await ctx.discover(
        owner.accessToken,
        enterpriseId,
        d.projectId,
      );
      const rerun = await me()
        .get(
          `/enterprises/${enterpriseId}/projects/${d.projectId}/discoveries/${newSnapshot}`,
        )
        .expect(200);
      expect(
        rerun.body.applicable.map(
          (a: { approvalType: { id: string } }) => a.approvalType.id,
        ),
      ).not.toContain(d.approvalTypeId);

      // ...and a NEW application can't be started from it...
      await ctx.prisma.approvalApplication.update({
        where: { id: d.applicationId },
        data: { internalState: 'CANCELLED' },
      });
      const blocked = await create(
        d.projectId,
        d.approvalTypeId,
        newSnapshot,
      ).expect(422);
      expect(blocked.body.error.code).toBe('APPROVAL_NOT_IN_DISCOVERY');

      // ...but the existing application still answers with the ORIGINAL context.
      const later = (
        await me().get(appUrl(d.projectId, d.applicationId)).expect(200)
      ).body;
      expect(later.discovery).toEqual(original.discovery);
      expect(later.discovery.rule.version).toBe(1);
      expect(later.discovery.snapshotId).toBe(d.snapshotId);

      // The original snapshot itself is unchanged and still reproducible.
      const oldSnapshot = await me()
        .get(
          `/enterprises/${enterpriseId}/projects/${d.projectId}/discoveries/${d.snapshotId}`,
        )
        .expect(200);
      expect(oldSnapshot.body.reproducible).toBe(true);
      expect(
        oldSnapshot.body.applicable.map(
          (a: { approvalType: { id: string } }) => a.approvalType.id,
        ),
      ).toContain(d.approvalTypeId);
    });

    it('a submitted application keeps the context it was created from', async () => {
      const d = await startDraft('history-submitted');
      await ctx.publishRule(owner.user.id, d.approvalTypeId, {
        field: 'hazardous_flag',
        op: 'in',
        value: [true, false],
      });
      const submitted = await submit(d.projectId, d.applicationId).expect(200);
      expect(submitted.body.discovery.rule).toMatchObject({
        id: d.ruleId,
        version: 1,
      });
    });

    it('answers "which rule was used" from the application row and from the snapshot it links to', async () => {
      const d = await startDraft('answer');
      const row = await dbApp(d.applicationId);
      const snapshot = await ctx.prisma.discoverySnapshot.findUniqueOrThrow({
        where: { id: row.discoverySnapshotId! },
      });
      const used = snapshot.ruleVersionsUsed as Array<{
        ruleId: string;
        version: number;
      }>;
      const ctxRule = (
        row.discoveryContext as { rule: { id: string; version: number } }
      ).rule;
      expect(used).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            ruleId: ctxRule.id,
            version: ctxRule.version,
          }),
        ]),
      );
      expect(snapshot.matchedApprovalTypeIds).toContain(d.approvalTypeId);
    });

    describe('enforced by PostgreSQL itself, not only by service code', () => {
      it('the project, approval type, workflow, snapshot, context and author of an application can never change', async () => {
        const d = await startDraft('db-immutable');
        const other = await startDraft('db-immutable-other');
        const attempts: Array<Record<string, unknown>> = [
          { projectId: other.projectId },
          { approvalTypeId: other.approvalTypeId },
          { discoverySnapshotId: other.snapshotId },
          { discoveryContext: { tampered: true } },
          { createdByUserId: (await ctx.applicantSession('db-other')).user.id },
          { createdAt: new Date(0) },
          { workflowId: (await dbApp(other.applicationId)).workflowId },
        ];
        for (const data of attempts) {
          await expect(
            ctx.prisma.approvalApplication.update({
              where: { id: d.applicationId },
              data: data as never,
            }),
          ).rejects.toThrow(/are immutable/);
        }
        const row = await dbApp(d.applicationId);
        expect(row.projectId).toBe(d.projectId);
        expect(row.discoverySnapshotId).toBe(d.snapshotId);
      });

      it('a reference number / submission record is permanent once set, and cannot exist without a submission', async () => {
        const d = await startDraft('db-permanent');
        // A reference number on a never-submitted application violates the CHECK.
        await expect(
          ctx.prisma.approvalApplication.update({
            where: { id: d.applicationId },
            data: { referenceNumber: 'APP-FAKE-000001' },
          }),
        ).rejects.toThrow(/reference_requires_submission/);

        const submitted = await submit(d.projectId, d.applicationId).expect(
          200,
        );
        for (const data of [
          { referenceNumber: 'APP-FAKE-000002' },
          { submittedAt: new Date(0) },
          { submittedByUserId: null },
          { declarationAcceptedAt: null },
        ]) {
          await expect(
            ctx.prisma.approvalApplication.update({
              where: { id: d.applicationId },
              data: data as never,
            }),
          ).rejects.toThrow(/permanent once set/);
        }
        expect((await dbApp(d.applicationId)).referenceNumber).toBe(
          submitted.body.referenceNumber,
        );
      });

      it('a snapshot an application relies on can be neither edited nor deleted', async () => {
        const d = await startDraft('db-snapshot');
        await expect(
          ctx.prisma.discoverySnapshot.update({
            where: { id: d.snapshotId },
            data: { result: { tampered: true } },
          }),
        ).rejects.toThrow(/immutable historical records/);
        await expect(
          ctx.prisma.discoverySnapshot.delete({ where: { id: d.snapshotId } }),
        ).rejects.toThrow(/foreign key|violates|constraint/i); // FK RESTRICT
        expect(
          await ctx.prisma.discoverySnapshot.count({
            where: { id: d.snapshotId },
          }),
        ).toBe(1);
      });

      it('a published rule version an application points to cannot be rewritten', async () => {
        const d = await startDraft('db-rule');
        await expect(
          ctx.prisma.approvalRule.update({
            where: { id: d.ruleId },
            data: {
              conditions: {
                field: 'hazardous_flag',
                op: 'equals',
                value: true,
              },
            },
          }),
        ).rejects.toThrow(/rule version is immutable/);
      });
    });
  });

  // -------------------------------------------------------------------------
  describe('audit trail', () => {
    const eventsFor = (id: string) =>
      ctx.prisma.auditLog.findMany({
        where: { entityId: id },
        orderBy: { createdAt: 'asc' },
      });

    it('records creation, update, status change and submission with actor, context and rule version', async () => {
      const d = await startDraft('audit');
      await me()
        .put(`${appUrl(d.projectId, d.applicationId)}/draft`)
        .send({ formData: { a: 'x' } })
        .expect(200);
      await submit(d.projectId, d.applicationId).expect(200);

      const events = await eventsFor(d.applicationId);
      expect(events.map((e) => e.action).sort()).toEqual([
        'APPLICATION_CREATED',
        'APPLICATION_STATUS_CHANGED',
        'APPLICATION_SUBMITTED',
        'APPLICATION_UPDATED',
      ]);

      for (const e of events) {
        expect(e.userId).toBe(owner.user.id);
        expect(e.roleAtTime).toBe('APPLICANT');
        expect(e.entityType).toBe('ApprovalApplication');
        expect(e.ruleVersionUsed).toBe(`${d.ruleId}@v1`);
        expect(e.afterState).toMatchObject({
          enterpriseId,
          projectId: d.projectId,
          actingAs: 'OWNER',
          representativeScope: null,
        });
      }
      const byAction = Object.fromEntries(events.map((e) => [e.action, e]));
      expect(byAction.APPLICATION_CREATED.afterState).toMatchObject({
        approvalTypeId: d.approvalTypeId,
        discoverySnapshotId: d.snapshotId,
        ruleId: d.ruleId,
        ruleVersion: 1,
        internalState: 'DRAFT',
      });
      expect(byAction.APPLICATION_STATUS_CHANGED.beforeState).toMatchObject({
        internalState: 'DRAFT',
      });
      expect(byAction.APPLICATION_STATUS_CHANGED.afterState).toMatchObject({
        internalState: 'SUBMITTED',
        applicantStatus: 'SUBMITTED',
        action: 'SUBMIT',
      });
      expect(byAction.APPLICATION_SUBMITTED.afterState).toMatchObject({
        discoverySnapshotId: d.snapshotId,
        declarationAccepted: true,
      });
    });

    it('records nothing for requests that were refused', async () => {
      const d = await startDraft('audit-refused');
      const count = async () => (await eventsFor(d.applicationId)).length;
      const before = await count();
      await me()
        .put(`${appUrl(d.projectId, d.applicationId)}/draft`)
        .send({ formData: { status: 'x' } })
        .expect(400);
      await me()
        .post(`${appUrl(d.projectId, d.applicationId)}/submit`)
        .send({ declarationAccepted: false })
        .expect(400);
      expect(await count()).toBe(before);
    });
  });

  // -------------------------------------------------------------------------
  describe('regression: Steps 4–7 alongside applications', () => {
    it('health, projects, discovery and applications all work together', async () => {
      await request(ctx.http).get(`${API}/health`).expect(200);
      await request(ctx.http).get(`${API}/health/db`).expect(200);
      const d = await startDraft('regress');
      await me()
        .get(`/enterprises/${enterpriseId}/projects/${d.projectId}`)
        .expect(200);
      const discoveries = await me()
        .get(`/enterprises/${enterpriseId}/projects/${d.projectId}/discoveries`)
        .expect(200);
      expect(discoveries.body.map((s: { id: string }) => s.id)).toContain(
        d.snapshotId,
      );
      await me().get(`/enterprises/${enterpriseId}`).expect(200);
    });

    it('unauthenticated requests never reach the application logic', async () => {
      const d = await startDraft('unauth');
      const base = `${API}${appUrl(d.projectId, d.applicationId)}`;
      await request(ctx.http).get(base).expect(401);
      await request(ctx.http)
        .post(`${API}${appsUrl(d.projectId)}`)
        .send({})
        .expect(401);
      await request(ctx.http)
        .put(`${base}/draft`)
        .send({ formData: {} })
        .expect(401);
      await request(ctx.http).post(`${base}/submit`).send({}).expect(401);
      expect((await dbApp(d.applicationId)).internalState).toBe('DRAFT');
    });
  });
});
