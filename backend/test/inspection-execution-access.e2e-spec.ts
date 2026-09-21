import st from 'supertest';
import { E2eContext, createE2eContext } from './support/e2e-helpers';
import { jpegBytes } from './support/document-fixtures';
import {
  addChecklistItems,
  future,
  markScrutinyFinished,
} from './support/inspection-helpers';
import {
  Actor,
  OfficerWorld,
  as,
  buildOfficerWorld,
} from './support/officer-world';

jest.setTimeout(600_000);

/**
 * Who may EXECUTE an inspection and who may READ its results, over real HTTP ->
 * Nest -> Prisma -> PostgreSQL: the assigned Inspector alone writes; officer
 * roles read what they can already see; everyone else — another inspector,
 * another department, a Scrutiny Officer, an applicant of this or any other
 * enterprise — is refused, and nothing changes when they try.
 */
describe('Inspection execution access e2e — who may act, who may read', () => {
  let ctx: E2eContext;
  let w: OfficerWorld;
  let inspectorA2: Actor;
  let inspectorB: Actor;
  let items: Array<{ id: string; itemText: string }>;
  let counter = 0;

  const api = (a: { accessToken: string }) => as(ctx, a.accessToken);
  const appPath = (id: string) => `/officer/applications/${id}`;
  const insp = (id: string, suffix = '') => `/inspections/${id}${suffix}`;
  const errorCode = (res: { body: { error?: { code?: string } } }) =>
    res.body.error?.code;
  const dbInspection = (id: string) =>
    ctx.prisma.inspection.findUniqueOrThrow({ where: { id } });

  interface Made {
    applicationId: string;
    projectId: string;
    inspectionId: string;
  }
  /** Under scrutiny by soA1, inspection scheduled for `inspector`. */
  const inspection = async (inspector: Actor = w.inspectorA): Promise<Made> => {
    counter += 1;
    const s = await ctx.submittedApplication(
      w.owner.accessToken,
      w.enterpriseId,
      w.approvalA,
      `iea-${counter}`,
    );
    await api(w.adminA)
      .post(`${appPath(s.applicationId)}/assignment`)
      .send({ officerUserId: w.soA1.user.id })
      .expect(201);
    await api(w.soA1)
      .post(`${appPath(s.applicationId)}/start-scrutiny`)
      .expect(200);
    const res = await api(w.soA1)
      .post(`${appPath(s.applicationId)}/inspections`)
      .send({
        inspectorUserId: inspector.user.id,
        siteAddress: 'Plot 12',
        scheduledAt: future(3),
      })
      .expect(201);
    return {
      applicationId: s.applicationId,
      projectId: s.projectId,
      inspectionId: res.body.id,
    };
  };
  const evidence = (id: string, actor: Actor = w.inspectorA) =>
    api(actor)
      .post(insp(id, '/evidence'))
      .attach('file', jpegBytes(`iea-ev-${(counter += 1)}`), {
        filename: 'site.jpg',
        contentType: 'image/jpeg',
      });
  const result = (
    id: string,
    actor: Actor = w.inspectorA,
    itemId = items[0].id,
  ) =>
    api(actor).post(insp(id, '/results')).send({
      checklistItemId: itemId,
      response: 'Checked.',
      finding: 'COMPLIANT',
    });

  const writes: Array<
    [string, (id: string) => (a: Actor) => ReturnType<typeof evidence>]
  > = [
    ['confirm', (id) => (a) => api(a).post(insp(id, '/confirm'))],
    [
      'reschedule',
      (id) => (a) =>
        api(a)
          .post(insp(id, '/reschedule'))
          .send({ scheduledAt: future(9), reason: 'Hijack' }),
    ],
    ['record a result', (id) => (a) => result(id, a)],
    ['attach evidence', (id) => (a) => evidence(id, a)],
    [
      'submit the report',
      (id) => (a) =>
        api(a)
          .post(insp(id, '/report'))
          .send({ overallFinding: 'COMPLIANT', summary: 'Hijack' }),
    ],
  ];

  beforeAll(async () => {
    ctx = await createE2eContext();
    w = await buildOfficerWorld(ctx, 'ea');
    [inspectorA2, inspectorB] = await Promise.all([
      ctx.officerSession('ea-ins2', 'INSPECTOR', w.deptA.id),
      ctx.officerSession('ea-insb', 'INSPECTOR', w.deptB.id),
    ]);
    items = await addChecklistItems(ctx.prisma, w.approvalA, [
      'Fire exits clear',
      'Fire alarm tested',
    ]);
  });

  afterAll(async () => {
    await ctx.cleanup();
    await ctx.app.close();
  });

  // -------------------------------------------------------------------------
  describe('every inspector action is the assigned Inspector’s alone — and nothing changes when anyone else tries', () => {
    it.each(writes)('%s', async (_name, build) => {
      const s = await inspection();
      const before = await dbInspection(s.inspectionId);
      const call = build(s.inspectionId);

      // Another Inspector of the same department, and an Inspector of another
      // department: the inspection does not exist for them.
      for (const actor of [inspectorA2, inspectorB]) {
        const res = await call(actor);
        expect(res.status).toBe(404);
        expect(errorCode(res)).toBe('NOT_FOUND');
      }
      // Every other role: refused at the route, before any lookup.
      for (const actor of [
        w.soA1,
        w.soA2,
        w.soB,
        w.adminA,
        w.adminB,
        w.aaA,
        w.sysAdmin,
        w.leadership,
        w.owner,
        w.owner2,
      ]) {
        const res = await call(actor);
        expect(res.status).toBe(403);
        expect(errorCode(res)).toBe('INSUFFICIENT_ROLE');
      }
      expect(
        (await st(ctx.http).post(`/api/v1${insp(s.inspectionId, '/confirm')}`))
          .status,
      ).toBe(401);

      const after = await dbInspection(s.inspectionId);
      expect(after).toEqual(before);
      expect(
        await ctx.prisma.inspectionReport.count({
          where: { inspectionId: s.inspectionId },
        }),
      ).toBe(0);
      expect(
        await ctx.prisma.inspectionEvidence.count({
          where: { inspectionId: s.inspectionId },
        }),
      ).toBe(0);
      expect(
        await ctx.prisma.inspectionReportSummary.count({
          where: { inspectionId: s.inspectionId },
        }),
      ).toBe(0);
      for (const actor of [inspectorA2, inspectorB, w.soA1, w.owner]) {
        expect(
          await ctx.prisma.document.count({
            where: { uploadedBy: actor.user.id },
          }),
        ).toBe(0);
      }
      const trail = await ctx.prisma.auditLog.findMany({
        where: { entityId: s.applicationId, userId: { not: null } },
      });
      expect(
        trail.filter((e) =>
          [
            'INSPECTION_CONFIRMED',
            'INSPECTION_RESULT_RECORDED',
            'INSPECTION_EVIDENCE_ATTACHED',
            'INSPECTION_REPORT_SUBMITTED',
            'INSPECTION_COMPLETED',
          ].includes(e.action),
        ),
      ).toEqual([]);
      expect(
        trail.filter((e) => e.action === 'INSPECTION_RESCHEDULED'),
      ).toEqual([]);
    });

    it('the assigned Inspector, by contrast, can do each of them (control)', async () => {
      const s = await inspection();
      await api(w.inspectorA)
        .post(insp(s.inspectionId, '/confirm'))
        .expect(200);
      await result(s.inspectionId).expect(201);
      await evidence(s.inspectionId).expect(201);
    });

    it('an unknown inspection is a 404 and a malformed id a 400, for the Inspector too', async () => {
      const ghost = '00000000-0000-4000-8000-0000000000aa';
      for (const [, build] of writes) {
        expect((await build(ghost)(w.inspectorA)).status).toBe(404);
        expect((await build('not-a-uuid')(w.inspectorA)).status).toBe(400);
      }
    });

    it('a Scrutiny Officer has no inspector powers, and an Inspector has no officer or scrutiny powers', async () => {
      const s = await inspection();
      // The officer who requested the inspection cannot confirm, record or submit.
      for (const [, build] of writes) {
        expect((await build(s.inspectionId)(w.soA1)).status).toBe(403);
      }
      // The Inspector cannot use the officer's inspection routes or scrutiny.
      const asInspector = api(w.inspectorA);
      const officerRoutes = [
        await asInspector
          .post(`${appPath(s.applicationId)}/inspections`)
          .send({ inspectorUserId: w.inspectorA.user.id, siteAddress: 'x' }),
        await asInspector
          .put(`${appPath(s.applicationId)}/inspections/${s.inspectionId}`)
          .send({ siteAddress: 'x' }),
        await asInspector.get(`${appPath(s.applicationId)}/inspections`),
        await asInspector.get(appPath(s.applicationId)),
        await asInspector.post(`${appPath(s.applicationId)}/start-scrutiny`),
        await asInspector
          .post(`${appPath(s.applicationId)}/recommendation`)
          .send({ outcome: 'APPROVE', reason: 'x' }),
      ];
      for (const res of officerRoutes) {
        expect(res.status).toBe(403);
        expect(errorCode(res)).toBe('INSUFFICIENT_ROLE');
      }
    });
  });

  // -------------------------------------------------------------------------
  describe('reading the report and the evidence', () => {
    let s: Made;
    let evidenceId: string;

    beforeAll(async () => {
      s = await inspection();
      evidenceId = (await evidence(s.inspectionId).expect(201)).body.id;
      await result(s.inspectionId).expect(201);
    });

    const roles: Array<[string, () => Actor, number]> = [
      ['the assigned Inspector', () => w.inspectorA, 200],
      [
        'the Scrutiny Officer the application is assigned to',
        () => w.soA1,
        200,
      ],
      ['the department’s administrator', () => w.adminA, 200],
      ['another Inspector of the department', () => inspectorA2, 404],
      ['an Inspector of another department', () => inspectorB, 404],
      [
        'a Scrutiny Officer the application is not assigned to',
        () => w.soA2,
        404,
      ],
      ['another department’s officer', () => w.soB, 404],
      ['another department’s administrator', () => w.adminB, 404],
      [
        'the Approving Authority before a recommendation exists',
        () => w.aaA,
        404,
      ],
      ['a system administrator', () => w.sysAdmin, 403],
      ['a leadership user', () => w.leadership, 403],
      ['the applicant who owns the application', () => w.owner, 403],
      ['another enterprise’s applicant', () => w.owner2, 403],
    ];

    it.each(roles)('the report, as %s -> %i', async (_who, pick, status) => {
      const res = await api(pick()).get(insp(s.inspectionId, '/report'));
      expect(res.status).toBe(status);
      if (status === 200) {
        expect(res.body.inspectionId).toBe(s.inspectionId);
        expect(res.body.evidence).toHaveLength(1);
        expect(res.body.checklist).toHaveLength(2);
      }
    });

    it.each(roles)(
      'the evidence file, as %s -> %i',
      async (_who, pick, status) => {
        const res = await api(pick()).get(
          insp(s.inspectionId, `/evidence/${evidenceId}/download`),
        );
        expect(res.status).toBe(status);
      },
    );

    it('is 401 without a token, 404 for unknown ids, 400 for malformed ones', async () => {
      expect(
        (await st(ctx.http).get(`/api/v1${insp(s.inspectionId, '/report')}`))
          .status,
      ).toBe(401);
      expect(
        (
          await api(w.inspectorA).get(
            insp('00000000-0000-4000-8000-0000000000aa', '/report'),
          )
        ).status,
      ).toBe(404);
      expect(
        (await api(w.inspectorA).get(insp('nope', '/report'))).status,
      ).toBe(400);
      expect(
        (
          await api(w.inspectorA).get(
            insp(
              s.inspectionId,
              '/evidence/00000000-0000-4000-8000-0000000000bb/download',
            ),
          )
        ).status,
      ).toBe(404);
      expect(
        (
          await api(w.inspectorA).get(
            insp(s.inspectionId, '/evidence/nope/download'),
          )
        ).status,
      ).toBe(400);
    });

    it('what an Inspector sees is the report and evidence — never storage internals, other people’s data or the officer’s notes', async () => {
      const res = await api(w.inspectorA)
        .get(insp(s.inspectionId, '/report'))
        .expect(200);
      expect(JSON.stringify(res.body)).not.toMatch(
        /filePath|storage|checksum|documents\/20|password|token|secret|formData|observation|@example\.test/i,
      );
    });

    it('evidence is found only THROUGH its own inspection: another inspection’s evidence id is a 404 even for someone who may see both', async () => {
      const other = await inspection();
      const res = await api(w.inspectorA).get(
        insp(other.inspectionId, `/evidence/${evidenceId}/download`),
      );
      expect(res.status).toBe(404);
    });

    it('the Approving Authority can read once the recommendation is with them, and still cannot act', async () => {
      const r = await inspection();
      const ev = await evidence(r.inspectionId).expect(201);
      // Since Step 11C the recommendation is refused while an inspection is open;
      // set the finished-scrutiny state directly.
      await markScrutinyFinished(ctx.prisma, r.applicationId);
      await api(w.aaA).get(insp(r.inspectionId, '/report')).expect(200);
      await api(w.aaA)
        .get(insp(r.inspectionId, `/evidence/${ev.body.id}/download`))
        .expect(200);
      const write = await api(w.aaA).post(insp(r.inspectionId, '/confirm'));
      expect(write.status).toBe(403);
      // Still not the applications under scrutiny.
      await api(w.aaA).get(insp(s.inspectionId, '/report')).expect(404);
    });
  });

  // -------------------------------------------------------------------------
  describe('a reassigned inspector loses access, and the new one gains it', () => {
    it('the previous inspector is refused everything at once; the record they made stays and the new inspector continues it', async () => {
      const s = await inspection();
      await api(w.inspectorA)
        .post(insp(s.inspectionId, '/confirm'))
        .expect(200);
      const ev = await evidence(s.inspectionId).expect(201);
      await result(s.inspectionId).expect(201);

      const swap = await api(w.soA1)
        .put(`${appPath(s.applicationId)}/inspections/${s.inspectionId}`)
        .send({
          inspectorUserId: inspectorA2.user.id,
          reason: 'Original inspector unavailable',
        })
        .expect(200);
      expect(swap.body.confirmedAt).toBeNull();

      // The old inspector: every write, read and download is a 404 now.
      for (const [, build] of writes) {
        expect((await build(s.inspectionId)(w.inspectorA)).status).toBe(404);
      }
      expect((await api(w.inspectorA).get(insp(s.inspectionId))).status).toBe(
        404,
      );
      expect(
        (await api(w.inspectorA).get(insp(s.inspectionId, '/report'))).status,
      ).toBe(404);
      expect(
        (
          await api(w.inspectorA).get(
            insp(s.inspectionId, `/evidence/${ev.body.id}/download`),
          )
        ).status,
      ).toBe(404);
      const list = await api(w.inspectorA)
        .get('/inspections?pageSize=100')
        .expect(200);
      expect(list.body.items.map((i: { id: string }) => i.id)).not.toContain(
        s.inspectionId,
      );

      // The new inspector sees the whole record so far, and carries on.
      const view = await api(inspectorA2)
        .get(insp(s.inspectionId, '/report'))
        .expect(200);
      expect(view.body.evidence).toHaveLength(1);
      expect(view.body.checklist[0].current.recordedByUserId).toBe(
        w.inspectorA.user.id,
      );
      await api(inspectorA2)
        .get(insp(s.inspectionId, `/evidence/${ev.body.id}/download`))
        .expect(200);
      await api(inspectorA2).post(insp(s.inspectionId, '/confirm')).expect(200);
      const second = await result(
        s.inspectionId,
        inspectorA2,
        items[1].id,
      ).expect(201);
      expect(second.body.recordedByUserId).toBe(inspectorA2.user.id);
      await result(s.inspectionId, inspectorA2, items[0].id).expect(201);
      await api(inspectorA2)
        .post(insp(s.inspectionId, '/report'))
        .send({
          overallFinding: 'COMPLIANT',
          summary: 'Completed by the replacement inspector.',
        })
        .expect(201);
      const summary =
        await ctx.prisma.inspectionReportSummary.findUniqueOrThrow({
          where: { inspectionId: s.inspectionId },
        });
      expect(summary.submittedByUserId).toBe(inspectorA2.user.id);
      // Nothing the first inspector did was rewritten.
      const history = await ctx.prisma.inspectionReport.findMany({
        where: { inspectionId: s.inspectionId },
        orderBy: { recordedAt: 'asc' },
      });
      expect(history.map((r) => r.recordedByUserId)).toEqual([
        w.inspectorA.user.id,
        inspectorA2.user.id,
        inspectorA2.user.id,
      ]);
    });

    it('an Inspector who loses the role, or holds it only in another department, loses access', async () => {
      const temp = await ctx.officerSession('ea-temp', 'INSPECTOR', w.deptA.id);
      const s = await inspection(temp);
      await api(temp).post(insp(s.inspectionId, '/confirm')).expect(200);

      await ctx.prisma.userRole.deleteMany({ where: { userId: temp.user.id } });
      const gone = await api(temp)
        .post(insp(s.inspectionId, '/reschedule'))
        .send({ scheduledAt: future(8), reason: 'r' });
      expect(gone.status).toBe(403);
      expect(
        (await api(temp).get(insp(s.inspectionId, '/report'))).status,
      ).toBe(403);

      await ctx.users.assignRole({
        userId: temp.user.id,
        roleCode: 'INSPECTOR',
        departmentId: w.deptB.id,
        assignedByUserId: null,
        ipAddress: '127.0.0.1',
      });
      for (const [, build] of writes) {
        expect((await build(s.inspectionId)(temp)).status).toBe(404);
      }
      expect(
        (await api(temp).get(insp(s.inspectionId, '/report'))).status,
      ).toBe(404);
    });
  });

  // -------------------------------------------------------------------------
  describe('across applications, enterprises and departments', () => {
    it('evidence is not part of the applicant’s documents: neither its owner, nor another enterprise, can reach it', async () => {
      const s = await inspection();
      const ev = await evidence(s.inspectionId).expect(201);
      const base = `/enterprises/${w.enterpriseId}/projects/${s.projectId}/applications/${s.applicationId}/documents`;
      const list = await api(w.owner).get(base).expect(200);
      expect(JSON.stringify(list.body)).not.toContain(ev.body.documentId);
      expect(
        (await api(w.owner).get(`${base}/${ev.body.documentId}`)).status,
      ).toBe(404);
      expect(
        (await api(w.owner).get(`${base}/${ev.body.documentId}/download`))
          .status,
      ).toBe(404);
      // Another enterprise's owner has no relationship to any of it.
      const foreign = `/enterprises/${w.enterprise2Id}/projects/${s.projectId}/applications/${s.applicationId}/documents`;
      expect((await api(w.owner2).get(foreign)).status).toBe(404);
      expect(
        (await api(w.owner2).get(`${foreign}/${ev.body.documentId}/download`))
          .status,
      ).toBe(404);
      // The officer's own document routes do not serve it either.
      expect(
        (
          await api(w.soA1).get(
            `${appPath(s.applicationId)}/documents/${ev.body.documentId}/download`,
          )
        ).status,
      ).toBe(404);
    });

    it('a result can never cite another inspection’s evidence, even when the same inspector holds both', async () => {
      const a = await inspection();
      const b = await inspection();
      const evA = await evidence(a.inspectionId).expect(201);
      const res = await api(w.inspectorA)
        .post(insp(b.inspectionId, '/results'))
        .send({
          checklistItemId: items[0].id,
          response: 'x',
          finding: 'COMPLIANT',
          evidenceId: evA.body.id,
        });
      expect(res.status).toBe(422);
      expect(errorCode(res)).toBe('EVIDENCE_NOT_USABLE');
      // A Inspector of the same department who is not assigned to `a` cannot cite it at all.
      const c = await inspection(inspectorA2);
      const cross = await api(inspectorA2)
        .post(insp(c.inspectionId, '/results'))
        .send({
          checklistItemId: items[0].id,
          response: 'x',
          finding: 'COMPLIANT',
          evidenceId: evA.body.id,
        });
      expect(cross.status).toBe(422);
      expect(
        await ctx.prisma.inspectionReport.count({
          where: { inspectionId: { in: [b.inspectionId, c.inspectionId] } },
        }),
      ).toBe(0);
    });

    it('another department’s inspection is invisible to a department-A inspector by every route and id', async () => {
      const inB = await ctx.submittedApplication(
        w.owner.accessToken,
        w.enterpriseId,
        w.approvalB,
        'iea-b',
      );
      await api(w.adminB)
        .post(`${appPath(inB.applicationId)}/assignment`)
        .send({ officerUserId: w.soB.user.id })
        .expect(201);
      await api(w.soB)
        .post(`${appPath(inB.applicationId)}/start-scrutiny`)
        .expect(200);
      const created = await api(w.soB)
        .post(`${appPath(inB.applicationId)}/inspections`)
        .send({
          inspectorUserId: inspectorB.user.id,
          siteAddress: 'Plot B',
          scheduledAt: future(3),
        })
        .expect(201);
      const id = created.body.id as string;
      for (const actor of [w.inspectorA, inspectorA2]) {
        for (const [, build] of writes) {
          expect((await build(id)(actor)).status).toBe(404);
        }
        expect((await api(actor).get(insp(id, '/report'))).status).toBe(404);
      }
      // The department-B inspector can work it — proving the id is fine and the wall is the department.
      await api(inspectorB).post(insp(id, '/confirm')).expect(200);
      // And a department-B inspector cannot touch department A's.
      const inA = await inspection();
      expect(
        (await api(inspectorB).post(insp(inA.inspectionId, '/confirm'))).status,
      ).toBe(404);
    });

    it('a client cannot steer to another application or inspector through the body: only what the inspector decides is accepted', async () => {
      const s = await inspection();
      const other = await inspection();
      for (const body of [
        {
          checklistItemId: items[0].id,
          response: 'x',
          finding: 'COMPLIANT',
          inspectionId: other.inspectionId,
        },
        {
          checklistItemId: items[0].id,
          response: 'x',
          finding: 'COMPLIANT',
          recordedByUserId: inspectorA2.user.id,
        },
        {
          checklistItemId: items[0].id,
          response: 'x',
          finding: 'COMPLIANT',
          departmentId: w.deptB.id,
        },
      ]) {
        expect(
          (
            await api(w.inspectorA)
              .post(insp(s.inspectionId, '/results'))
              .send(body)
          ).status,
        ).toBe(400);
      }
      expect(
        await ctx.prisma.inspectionReport.count({
          where: { inspectionId: { in: [s.inspectionId, other.inspectionId] } },
        }),
      ).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  describe('the scrutiny record', () => {
    it('the inspection story appears in the application history, in plain language, without the details', async () => {
      const s = await inspection();
      await api(w.inspectorA)
        .post(insp(s.inspectionId, '/confirm'))
        .expect(200);
      await evidence(s.inspectionId).expect(201);
      await result(s.inspectionId, w.inspectorA, items[0].id).expect(201);
      await result(s.inspectionId, w.inspectorA, items[1].id).expect(201);
      await api(w.inspectorA)
        .post(insp(s.inspectionId, '/report'))
        .send({
          overallFinding: 'COMPLIANT',
          summary: 'Secret-observation-text',
        })
        .expect(201);
      const history = await api(w.adminA)
        .get(`${appPath(s.applicationId)}/history`)
        .expect(200);
      const story = history.body
        .filter((h: { action: string }) => h.action.startsWith('INSPECTION_'))
        .map((h: { summary: string }) => h.summary);
      expect(story).toEqual([
        'Inspection requested and scheduled',
        'Inspector confirmed the inspection visit',
        'Inspection evidence attached',
        'Inspection checklist result recorded',
        'Inspection checklist result recorded',
        'Inspection report submitted (COMPLIANT)',
        'Inspection completed',
      ]);
      expect(JSON.stringify(history.body)).not.toContain(
        'Secret-observation-text',
      );
      // The submitted report is part of the record the officer reads.
      const report = await api(w.soA1)
        .get(insp(s.inspectionId, '/report'))
        .expect(200);
      expect(report.body.report).toMatchObject({
        overallFinding: 'COMPLIANT',
        summary: 'Secret-observation-text',
      });
      expect(
        (await api(w.soA1).get(insp(s.inspectionId)).expect(200)).body.status,
      ).toBe('COMPLETED');
    });

    it('the applicant’s own view of the application reveals nothing about the inspection, its results, evidence or report', async () => {
      const s = await inspection();
      const ev = await evidence(s.inspectionId).expect(201);
      await result(s.inspectionId, w.inspectorA, items[0].id).expect(201);
      const res = await api(w.owner)
        .get(
          `/enterprises/${w.enterpriseId}/projects/${s.projectId}/applications/${s.applicationId}`,
        )
        .expect(200);
      const text = JSON.stringify(res.body);
      for (const secret of [
        s.inspectionId,
        ev.body.id,
        ev.body.documentId,
        w.inspectorA.user.id,
        'Checked.',
      ]) {
        expect(text).not.toContain(secret);
      }
      expect(res.body.applicantStatus).toBe('UNDER_SCRUTINY');
    });
  });
});
