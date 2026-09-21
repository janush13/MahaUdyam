import { promises as fs } from 'node:fs';
import { E2eContext, createE2eContext } from './support/e2e-helpers';
import {
  eicarPdf,
  exeBytes,
  jpegBytes,
  pdfBytes,
  pngBytes,
} from './support/document-fixtures';
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
 * Inspection execution over real HTTP -> Nest -> Prisma -> PostgreSQL: the
 * assigned inspector confirms / reschedules the visit, records checklist
 * results and findings, attaches evidence (through the Step 9 document
 * pipeline) and submits the report, which completes the inspection. Who may do
 * any of it, and who may read it, is in inspection-execution-access.e2e-spec.ts.
 */
describe('Inspection execution e2e — confirm, reschedule, results, evidence, report', () => {
  let ctx: E2eContext;
  let w: OfficerWorld;
  let inspectorA2: Actor;
  let items: Array<{ id: string; itemText: string; sequenceOrder: number }>;
  let otherApprovalItem: { id: string };
  let noChecklistApproval: string;
  let counter = 0;

  const api = (a: { accessToken: string }) => as(ctx, a.accessToken);
  const appPath = (id: string) => `/officer/applications/${id}`;
  const insp = (id: string, suffix = '') => `/inspections/${id}${suffix}`;
  const errorCode = (res: { body: { error?: { code?: string } } }) =>
    res.body.error?.code;
  const dbInspection = (id: string) =>
    ctx.prisma.inspection.findUniqueOrThrow({ where: { id } });
  const dbApp = (id: string) =>
    ctx.prisma.approvalApplication.findUniqueOrThrow({ where: { id } });
  const events = (applicationId: string, action?: string) =>
    ctx.prisma.auditLog.findMany({
      where: { entityId: applicationId, ...(action ? { action } : {}) },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

  /** An application under scrutiny by soA1, with an inspection for inspectorA
   * (scheduled in 3 days unless `pending`). */
  const inspection = async (
    opts: { pending?: boolean; approval?: string; tag?: string } = {},
  ) => {
    counter += 1;
    const s = await ctx.submittedApplication(
      w.owner.accessToken,
      w.enterpriseId,
      opts.approval ?? w.approvalA,
      `${opts.tag ?? 'ie'}-${counter}`,
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
        inspectorUserId: w.inspectorA.user.id,
        siteAddress: 'Plot 12, MIDC Industrial Area',
        ...(opts.pending ? {} : { scheduledAt: future(3) }),
      })
      .expect(201);
    return { ...s, inspectionId: res.body.id as string };
  };
  const result = (
    inspectionId: string,
    itemId: string,
    body: Record<string, unknown> = {},
    actor: Actor = w.inspectorA,
  ) =>
    api(actor)
      .post(insp(inspectionId, '/results'))
      .send({
        checklistItemId: itemId,
        response: 'Checked on site.',
        finding: 'COMPLIANT',
        ...body,
      });
  const answerAll = async (inspectionId: string, finding = 'COMPLIANT') => {
    for (const item of items) {
      await result(inspectionId, item.id, { finding }).expect(201);
    }
  };
  const evidence = (
    inspectionId: string,
    opts: {
      data?: Buffer;
      filename?: string;
      type?: string;
      fields?: Record<string, string>;
      actor?: Actor;
    } = {},
  ) => {
    let req = api(opts.actor ?? w.inspectorA)
      .post(insp(inspectionId, '/evidence'))
      .attach('file', opts.data ?? jpegBytes(`ev${(counter += 1)}`), {
        filename: opts.filename ?? 'site.jpg',
        contentType: opts.type ?? 'image/jpeg',
      });
    for (const [k, v] of Object.entries(opts.fields ?? {})) {
      req = req.field(k, v);
    }
    return req;
  };
  const report = (
    inspectionId: string,
    body: Record<string, unknown> = {},
    actor: Actor = w.inspectorA,
  ) =>
    api(actor)
      .post(insp(inspectionId, '/report'))
      .send({
        overallFinding: 'COMPLIANT',
        summary: 'Premises inspected; all in order.',
        ...body,
      });
  const docsBy = (userId: string) =>
    ctx.prisma.document.count({ where: { uploadedBy: userId } });

  beforeAll(async () => {
    ctx = await createE2eContext();
    w = await buildOfficerWorld(ctx, 'ie');
    inspectorA2 = await ctx.officerSession('ie-ins2', 'INSPECTOR', w.deptA.id);
    items = await addChecklistItems(ctx.prisma, w.approvalA, [
      'Fire exits clear',
      'Fire alarm tested',
      'Extinguishers in date',
    ]);
    const other = await ctx.createStartableApproval(
      w.owner.user.id,
      'ie-other',
      {
        departmentId: w.deptA.id,
      },
    );
    [otherApprovalItem] = await addChecklistItems(
      ctx.prisma,
      other.approvalTypeId,
      ['Another approval’s item'],
    );
    noChecklistApproval = (
      await ctx.createStartableApproval(w.owner.user.id, 'ie-nochk', {
        departmentId: w.deptA.id,
      })
    ).approvalTypeId;
  });

  afterAll(async () => {
    await ctx.cleanup();
    await ctx.app.close();
  });

  // -------------------------------------------------------------------------
  describe('confirming the visit', () => {
    it('records the confirmation as DATA: no status changes, the application is untouched', async () => {
      const s = await inspection();
      const appBefore = await dbApp(s.applicationId);
      const res = await api(w.inspectorA)
        .post(insp(s.inspectionId, '/confirm'))
        .expect(200);
      expect(res.body).toMatchObject({
        id: s.inspectionId,
        status: 'SCHEDULED',
        assignedBy: null,
      });
      expect(new Date(res.body.confirmedAt).getTime()).toBeLessThanOrEqual(
        Date.now(),
      );
      const row = await dbInspection(s.inspectionId);
      expect(row).toMatchObject({
        status: 'SCHEDULED',
        confirmedByUserId: w.inspectorA.user.id,
      });
      expect(row.confirmedAt).not.toBeNull();
      const appAfter = await dbApp(s.applicationId);
      expect(appAfter.internalState).toBe('UNDER_SCRUTINY');
      expect(appAfter.updatedAt).toEqual(appBefore.updatedAt);
    });

    it('is audited with the inspector’s role, department, enterprise, project, application, inspection and rule version', async () => {
      const s = await inspection();
      await api(w.inspectorA)
        .post(insp(s.inspectionId, '/confirm'))
        .expect(200);
      const [event] = await events(s.applicationId, 'INSPECTION_CONFIRMED');
      expect(event).toMatchObject({
        userId: w.inspectorA.user.id,
        roleAtTime: 'INSPECTOR',
        entityType: 'ApprovalApplication',
        entityId: s.applicationId,
      });
      expect(event.afterState).toMatchObject({
        inspectionId: s.inspectionId,
        applicationId: s.applicationId,
        projectId: s.projectId,
        enterpriseId: w.enterpriseId,
        departmentId: w.deptA.id,
        actingAs: 'INSPECTOR',
      });
      expect(event.ruleVersionUsed).toEqual(expect.any(String));
      expect(event.ipAddress).toEqual(expect.any(String));
    });

    it('cannot be confirmed twice, and not before the department has scheduled it', async () => {
      const s = await inspection();
      await api(w.inspectorA)
        .post(insp(s.inspectionId, '/confirm'))
        .expect(200);
      const again = await api(w.inspectorA).post(
        insp(s.inspectionId, '/confirm'),
      );
      expect(again.status).toBe(409);
      expect(errorCode(again)).toBe('INSPECTION_ALREADY_CONFIRMED');
      expect(
        await events(s.applicationId, 'INSPECTION_CONFIRMED'),
      ).toHaveLength(1);

      const pending = await inspection({ pending: true });
      const res = await api(w.inspectorA).post(
        insp(pending.inspectionId, '/confirm'),
      );
      expect(res.status).toBe(409);
      expect(errorCode(res)).toBe('INSPECTION_NOT_SCHEDULED');
      expect((await dbInspection(pending.inspectionId)).confirmedAt).toBeNull();
    });

    it('a confirmation belongs to one date and one inspector: the officer changing either withdraws it', async () => {
      const s = await inspection();
      await api(w.inspectorA)
        .post(insp(s.inspectionId, '/confirm'))
        .expect(200);
      // The officer moves the date.
      const moved = await api(w.soA1)
        .put(`${appPath(s.applicationId)}/inspections/${s.inspectionId}`)
        .send({ scheduledAt: future(5) })
        .expect(200);
      expect(moved.body.confirmedAt).toBeNull();
      expect((await dbInspection(s.inspectionId)).confirmedByUserId).toBeNull();
      // Confirm again, then the officer changes only the SITE: still confirmed.
      await api(w.inspectorA)
        .post(insp(s.inspectionId, '/confirm'))
        .expect(200);
      await api(w.soA1)
        .put(`${appPath(s.applicationId)}/inspections/${s.inspectionId}`)
        .send({ siteAddress: 'Plot 99' })
        .expect(200);
      expect((await dbInspection(s.inspectionId)).confirmedAt).not.toBeNull();
      // A different inspector: the confirmation is not theirs.
      const reassigned = await api(w.soA1)
        .put(`${appPath(s.applicationId)}/inspections/${s.inspectionId}`)
        .send({ inspectorUserId: inspectorA2.user.id, reason: 'Swap' })
        .expect(200);
      expect(reassigned.body.confirmedAt).toBeNull();
      await api(inspectorA2).post(insp(s.inspectionId, '/confirm')).expect(200);
    });
  });

  // -------------------------------------------------------------------------
  describe('rescheduling the visit', () => {
    it('moves a scheduled visit, withdraws the confirmation, and audits the reason and the before state', async () => {
      const s = await inspection();
      await api(w.inspectorA)
        .post(insp(s.inspectionId, '/confirm'))
        .expect(200);
      const before = await dbInspection(s.inspectionId);
      const res = await api(w.inspectorA)
        .post(insp(s.inspectionId, '/reschedule'))
        .send({
          scheduledAt: '2099-11-05T09:00:00+05:30',
          reason: 'Site closed for maintenance',
        })
        .expect(200);
      expect(res.body.status).toBe('SCHEDULED');
      expect(res.body.confirmedAt).toBeNull();
      expect(new Date(res.body.scheduledAt).toISOString()).toBe(
        '2099-11-05T03:30:00.000Z',
      );
      const [event] = await events(s.applicationId, 'INSPECTION_RESCHEDULED');
      expect(event).toMatchObject({
        userId: w.inspectorA.user.id,
        roleAtTime: 'INSPECTOR',
      });
      expect(event.afterState).toMatchObject({
        reason: 'Site closed for maintenance',
        rescheduledBy: 'INSPECTOR',
        inspectionId: s.inspectionId,
      });
      expect((event.beforeState as { scheduledAt: string }).scheduledAt).toBe(
        before.scheduledAt?.toISOString(),
      );
      // Same assignment: the inspector reschedules, nobody is reassigned.
      expect((await dbInspection(s.inspectionId)).inspectorId).toBe(
        w.inspectorA.user.id,
      );
      expect((await dbApp(s.applicationId)).internalState).toBe(
        'UNDER_SCRUTINY',
      );
    });

    it.each([
      ['no body', {}],
      ['no reason', { scheduledAt: '2099-11-05T09:00:00Z' }],
      [
        'a blank reason',
        { scheduledAt: '2099-11-05T09:00:00Z', reason: '   ' },
      ],
      ['no offset', { scheduledAt: '2099-11-05T09:00:00', reason: 'r' }],
      ['a date only', { scheduledAt: '2099-11-05', reason: 'r' }],
      ['the past', { scheduledAt: '2020-01-01T00:00:00Z', reason: 'r' }],
      [
        'a status',
        {
          scheduledAt: '2099-11-05T09:00:00Z',
          reason: 'r',
          status: 'COMPLETED',
        },
      ],
      [
        'another inspector',
        {
          scheduledAt: '2099-11-05T09:00:00Z',
          reason: 'r',
          inspectorUserId: '00000000-0000-4000-8000-000000000001',
        },
      ],
    ])('rejects %s (400) and changes nothing', async (_name, body) => {
      const s = await inspection();
      const before = await dbInspection(s.inspectionId);
      const res = await api(w.inspectorA)
        .post(insp(s.inspectionId, '/reschedule'))
        .send(body);
      expect(res.status).toBe(400);
      expect(errorCode(res)).toBe('VALIDATION_ERROR');
      expect((await dbInspection(s.inspectionId)).scheduledAt).toEqual(
        before.scheduledAt,
      );
      expect(
        await events(s.applicationId, 'INSPECTION_RESCHEDULED'),
      ).toHaveLength(0);
    });

    it('refuses the date it already has, and a visit the department has not scheduled', async () => {
      const s = await inspection();
      const current = (await dbInspection(s.inspectionId)).scheduledAt as Date;
      const same = await api(w.inspectorA)
        .post(insp(s.inspectionId, '/reschedule'))
        .send({ scheduledAt: current.toISOString(), reason: 'r' });
      expect(same.status).toBe(400);
      const pending = await inspection({ pending: true });
      const res = await api(w.inspectorA)
        .post(insp(pending.inspectionId, '/reschedule'))
        .send({ scheduledAt: future(4), reason: 'r' });
      expect(res.status).toBe(409);
      expect(errorCode(res)).toBe('INSPECTION_NOT_SCHEDULED');
      expect((await dbInspection(pending.inspectionId)).status).toBe('PENDING');
    });
  });

  // -------------------------------------------------------------------------
  describe('checklist results and findings', () => {
    it('records a result against an item of the department’s checklist, as the inspector, with a snapshot of the item wording', async () => {
      const s = await inspection();
      const res = await result(s.inspectionId, items[0].id, {
        response: 'Both exits unobstructed.',
        finding: 'COMPLIANT',
        notes: 'Photographed.',
      }).expect(201);
      expect(res.body).toMatchObject({
        checklistItemId: items[0].id,
        itemText: 'Fire exits clear',
        response: 'Both exits unobstructed.',
        finding: 'COMPLIANT',
        notes: 'Photographed.',
        evidenceId: null,
        recordedByUserId: w.inspectorA.user.id,
      });
      const [row] = await ctx.prisma.inspectionReport.findMany({
        where: { inspectionId: s.inspectionId },
      });
      expect(row).toMatchObject({
        id: res.body.id,
        itemText: 'Fire exits clear',
        recordedByUserId: w.inspectorA.user.id,
        evidenceDocumentId: null,
      });
      // The application is untouched by recording findings.
      expect((await dbApp(s.applicationId)).internalState).toBe(
        'UNDER_SCRUTINY',
      );
    });

    it('is append-only: recording an item again is a correction, and the earlier answer stays on the record', async () => {
      const s = await inspection();
      const first = await result(s.inspectionId, items[0].id, {
        response: 'Blocked',
        finding: 'NON_COMPLIANT',
      }).expect(201);
      const second = await result(s.inspectionId, items[0].id, {
        response: 'Cleared during visit',
        finding: 'COMPLIANT',
      }).expect(201);
      expect(second.body.id).not.toBe(first.body.id);
      const view = await api(w.inspectorA)
        .get(insp(s.inspectionId, '/report'))
        .expect(200);
      const item = view.body.checklist.find(
        (c: { id: string }) => c.id === items[0].id,
      );
      expect(item.current).toMatchObject({
        id: second.body.id,
        finding: 'COMPLIANT',
      });
      expect(item.earlier).toHaveLength(1);
      expect(item.earlier[0]).toMatchObject({
        id: first.body.id,
        response: 'Blocked',
        finding: 'NON_COMPLIANT',
      });
      // ...and PostgreSQL refuses to edit history.
      await expect(
        ctx.prisma.inspectionReport.update({
          where: { id: first.body.id },
          data: { response: 'Rewritten' },
        }),
      ).rejects.toThrow();
      const events2 = await events(
        s.applicationId,
        'INSPECTION_RESULT_RECORDED',
      );
      expect(events2).toHaveLength(2);
      expect(events2[1].afterState).toMatchObject({
        supersedesResultId: first.body.id,
        finding: 'COMPLIANT',
      });
    });

    it('a later change to the checklist wording cannot rewrite what was answered', async () => {
      const s = await inspection();
      const res = await result(s.inspectionId, items[1].id).expect(201);
      await ctx.prisma.inspectionChecklist.update({
        where: { id: items[1].id },
        data: { itemText: 'Fire alarm tested (revised)' },
      });
      try {
        const view = await api(w.inspectorA)
          .get(insp(s.inspectionId, '/report'))
          .expect(200);
        const item = view.body.checklist.find(
          (c: { id: string }) => c.id === items[1].id,
        );
        expect(item.text).toBe('Fire alarm tested (revised)');
        expect(item.current.itemText).toBe('Fire alarm tested');
        expect(item.current.id).toBe(res.body.id);
      } finally {
        await ctx.prisma.inspectionChecklist.update({
          where: { id: items[1].id },
          data: { itemText: 'Fire alarm tested' },
        });
      }
    });

    it('only an item of THIS approval’s checklist (422), never another approval’s or an unknown one', async () => {
      const s = await inspection();
      for (const id of [
        otherApprovalItem.id,
        '00000000-0000-4000-8000-000000000abc',
      ]) {
        const res = await result(s.inspectionId, id);
        expect(res.status).toBe(422);
        expect(errorCode(res)).toBe('INVALID_CHECKLIST_ITEM');
      }
      expect(
        await ctx.prisma.inspectionReport.count({
          where: { inspectionId: s.inspectionId },
        }),
      ).toBe(0);
    });

    it.each([
      ['no body', {}],
      ['a blank response', { response: '  ' }],
      ['a response over 2000 characters', { response: 'x'.repeat(2001) }],
      ['an unknown finding', { finding: 'PASS' }],
      [
        'the re-inspection outcome the requirements leave open',
        { finding: 'RE_INSPECTION_REQUIRED' },
      ],
      ['an evidence id that is not a UUID', { evidenceId: 'photo-1' }],
      [
        'a recorder',
        { recordedByUserId: '00000000-0000-4000-8000-000000000001' },
      ],
      ['a timestamp', { recordedAt: '2020-01-01T00:00:00Z' }],
      [
        'an inspection id',
        { inspectionId: '00000000-0000-4000-8000-000000000001' },
      ],
      ['a rewritten item text', { itemText: 'Anything' }],
    ])('rejects %s (400)', async (name, body) => {
      const s = await inspection();
      const res =
        name === 'no body'
          ? await api(w.inspectorA)
              .post(insp(s.inspectionId, '/results'))
              .send({})
          : await result(s.inspectionId, items[0].id, body);
      expect(res.status).toBe(400);
      expect(errorCode(res)).toBe('VALIDATION_ERROR');
      expect(
        await ctx.prisma.inspectionReport.count({
          where: { inspectionId: s.inspectionId },
        }),
      ).toBe(0);
    });

    it('not before the visit is scheduled', async () => {
      const pending = await inspection({ pending: true });
      const res = await result(pending.inspectionId, items[0].id);
      expect(res.status).toBe(409);
      expect(errorCode(res)).toBe('INSPECTION_NOT_SCHEDULED');
      expect(
        await ctx.prisma.inspectionReport.count({
          where: { inspectionId: pending.inspectionId },
        }),
      ).toBe(0);
    });

    it('two simultaneous results for one item are both kept, in a definite order (the later one is current)', async () => {
      const s = await inspection();
      const responses = await Promise.all([
        result(s.inspectionId, items[0].id, { response: 'First answer' }),
        result(s.inspectionId, items[0].id, { response: 'Second answer' }),
      ]);
      expect(responses.map((r) => r.status)).toEqual([201, 201]);
      expect(
        await ctx.prisma.inspectionReport.count({
          where: { inspectionId: s.inspectionId },
        }),
      ).toBe(2);
      const view = await api(w.inspectorA)
        .get(insp(s.inspectionId, '/report'))
        .expect(200);
      const item = view.body.checklist.find(
        (c: { id: string }) => c.id === items[0].id,
      );
      expect(item.earlier).toHaveLength(1);
      expect(item.current.id).not.toBe(item.earlier[0].id);
    });
  });

  // -------------------------------------------------------------------------
  describe('evidence', () => {
    it('attaches a photo through the Step 9 pipeline: an ordinary, scanned document owned by the project, uploaded by the inspector', async () => {
      const s = await inspection();
      const data = jpegBytes('evidence-1');
      const res = await evidence(s.inspectionId, {
        data,
        filename: 'north-exit.jpg',
        fields: {
          caption: 'North fire exit',
          capturedAt: '2026-01-02T10:00:00+05:30',
        },
      }).expect(201);
      expect(res.body).toMatchObject({
        documentVersion: 1,
        originalFilename: 'north-exit.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: data.length,
        caption: 'North fire exit',
        attachedByUserId: w.inspectorA.user.id,
        scan: { state: 'CLEAN' },
        downloadable: true,
      });
      expect(new Date(res.body.capturedAt).toISOString()).toBe(
        '2026-01-02T04:30:00.000Z',
      );
      expect(JSON.stringify(res.body)).not.toMatch(
        /filePath|storage|checksum|documents\//i,
      );

      const row = await ctx.prisma.inspectionEvidence.findUniqueOrThrow({
        where: { id: res.body.id },
        include: { document: { include: { applicationDocuments: true } } },
      });
      expect(row).toMatchObject({
        inspectionId: s.inspectionId,
        uploadedByUserId: w.inspectorA.user.id,
      });
      expect(row.document).toMatchObject({
        id: res.body.documentId,
        ownerType: 'PROJECT',
        ownerId: s.projectId,
        uploadedBy: w.inspectorA.user.id,
        status: 'VALIDATION_PENDING',
        version: 1,
        documentRequirementId: null,
      });
      expect(row.document.scannedAt).not.toBeNull();
      expect(row.document.scannerName).toEqual(expect.any(String));
      // Reachable only through its inspection: not in the applicant's document list.
      expect(row.document.applicationDocuments).toEqual([]);
      const stored = await fs
        .stat(`${process.cwd()}/storage/${row.document.filePath}`)
        .catch(() => null);
      expect(stored?.size).toBe(data.length);
    });

    it('accepts PDF and PNG too, and refuses what is not a real photo / document', async () => {
      const s = await inspection();
      await evidence(s.inspectionId, {
        data: pdfBytes('e-pdf'),
        filename: 'report.pdf',
        type: 'application/pdf',
      }).expect(201);
      await evidence(s.inspectionId, {
        data: pngBytes('e-png'),
        filename: 'site.png',
        type: 'image/png',
      }).expect(201);
      const before = await docsBy(w.inspectorA.user.id);
      const exe = await evidence(s.inspectionId, {
        data: exeBytes(),
        filename: 'tool.exe',
        type: 'application/octet-stream',
      });
      expect([415, 422]).toContain(exe.status);
      const wrongType = await evidence(s.inspectionId, {
        data: pdfBytes('e-lie'),
        filename: 'photo.jpg',
        type: 'image/jpeg',
      });
      expect(wrongType.status).toBe(422);
      expect(errorCode(wrongType)).toBe('MIME_TYPE_MISMATCH');
      const empty = await evidence(s.inspectionId, {
        data: Buffer.alloc(0),
        filename: 'empty.jpg',
      });
      expect(empty.status).toBe(400);
      expect(await docsBy(w.inspectorA.user.id)).toBe(before);
    });

    it('needs a file', async () => {
      const s = await inspection();
      const res = await api(w.inspectorA)
        .post(insp(s.inspectionId, '/evidence'))
        .field('caption', 'no file');
      expect(res.status).toBe(400);
      expect(errorCode(res)).toBe('FILE_REQUIRED');
    });

    it('an infected file is rejected and never stored — audited against the application under the inspector’s role', async () => {
      const s = await inspection();
      const before = await docsBy(w.inspectorA.user.id);
      const res = await evidence(s.inspectionId, {
        data: eicarPdf(),
        filename: 'scan.pdf',
        type: 'application/pdf',
      });
      expect(res.status).toBe(422);
      expect(errorCode(res)).toBe('MALWARE_DETECTED');
      expect(await docsBy(w.inspectorA.user.id)).toBe(before);
      expect(
        await ctx.prisma.inspectionEvidence.count({
          where: { inspectionId: s.inspectionId },
        }),
      ).toBe(0);
      const [event] = await events(s.applicationId, 'DOCUMENT_SCAN_REJECTED');
      expect(event).toMatchObject({
        userId: w.inspectorA.user.id,
        roleAtTime: 'INSPECTOR',
      });
      expect(event.afterState).toMatchObject({
        inspectionId: s.inspectionId,
        stored: false,
      });
    });

    it.each([
      ['a capture time in the future', { capturedAt: '2099-01-01T00:00:00Z' }],
      ['a capture time with no offset', { capturedAt: '2026-01-01T10:00:00' }],
      ['a location (latitude)', { latitude: '19.07' }],
      ['a location (longitude)', { longitude: '72.87' }],
      [
        'a raw document id',
        { documentId: '00000000-0000-4000-8000-000000000001' },
      ],
      ['an owner', { ownerId: '00000000-0000-4000-8000-000000000001' }],
      ['a scan state', { scannedAt: '2026-01-01T00:00:00Z' }],
      ['a caption over 500 characters', { caption: 'x'.repeat(501) }],
    ])('rejects %s (400) and stores nothing', async (_name, fields) => {
      const s = await inspection();
      const before = await docsBy(w.inspectorA.user.id);
      const res = await evidence(s.inspectionId, {
        fields: fields as Record<string, string>,
      });
      expect(res.status).toBe(400);
      expect(errorCode(res)).toBe('VALIDATION_ERROR');
      expect(await docsBy(w.inspectorA.user.id)).toBe(before);
    });

    it('is refused BEFORE anything is scanned or stored when the visit is not scheduled, or already reported', async () => {
      const pending = await inspection({ pending: true });
      const before = await docsBy(w.inspectorA.user.id);
      const res = await evidence(pending.inspectionId);
      expect(res.status).toBe(409);
      expect(errorCode(res)).toBe('INSPECTION_NOT_SCHEDULED');
      const done = await inspection({ approval: noChecklistApproval });
      await report(done.inspectionId).expect(201);
      const late = await evidence(done.inspectionId);
      expect(late.status).toBe(409);
      expect(errorCode(late)).toBe('INSPECTION_NOT_MODIFIABLE');
      expect(await docsBy(w.inspectorA.user.id)).toBe(before);
    });

    it('records the upload audit trail: scan, upload, and the inspection event, all as the inspector', async () => {
      const s = await inspection();
      const res = await evidence(s.inspectionId).expect(201);
      const docEvents = await ctx.prisma.auditLog.findMany({
        where: { entityId: res.body.documentId },
      });
      expect(docEvents.map((e) => e.action).sort()).toEqual([
        'DOCUMENT_SCAN_COMPLETED',
        'DOCUMENT_UPLOADED',
      ]);
      for (const e of docEvents) {
        expect(e).toMatchObject({
          userId: w.inspectorA.user.id,
          roleAtTime: 'INSPECTOR',
        });
        expect(e.afterState).toMatchObject({
          inspectionId: s.inspectionId,
          departmentId: w.deptA.id,
        });
      }
      const [attached] = await events(
        s.applicationId,
        'INSPECTION_EVIDENCE_ATTACHED',
      );
      expect(attached).toMatchObject({
        userId: w.inspectorA.user.id,
        roleAtTime: 'INSPECTOR',
      });
      expect(attached.afterState).toMatchObject({
        evidenceId: res.body.id,
        documentId: res.body.documentId,
        documentVersion: 1,
        inspectionId: s.inspectionId,
        projectId: s.projectId,
        enterpriseId: w.enterpriseId,
      });
      expect(JSON.stringify(attached)).not.toMatch(
        /filePath|documents\/20|checksum/i,
      );
    });

    it('a result can cite this inspection’s evidence — and only scanned, usable evidence of THIS inspection', async () => {
      const s = await inspection();
      const other = await inspection();
      const mine = await evidence(s.inspectionId).expect(201);
      const theirs = await evidence(other.inspectionId).expect(201);

      const ok = await result(s.inspectionId, items[0].id, {
        evidenceId: mine.body.id,
      }).expect(201);
      expect(ok.body.evidenceId).toBe(mine.body.id);
      const row = await ctx.prisma.inspectionReport.findUniqueOrThrow({
        where: { id: ok.body.id },
      });
      expect(row.evidenceDocumentId).toBe(mine.body.documentId);

      // Evidence of another inspection, an unknown id.
      for (const evidenceId of [
        theirs.body.id,
        '00000000-0000-4000-8000-000000000abc',
      ]) {
        const res = await result(s.inspectionId, items[1].id, { evidenceId });
        expect(res.status).toBe(422);
        expect(errorCode(res)).toBe('EVIDENCE_NOT_USABLE');
      }
      // A document that has since been rejected is no longer usable evidence.
      await ctx.prisma.document.update({
        where: { id: theirs.body.documentId },
        data: { status: 'REJECTED' },
      });
      const rejected = await result(other.inspectionId, items[0].id, {
        evidenceId: theirs.body.id,
      });
      expect(rejected.status).toBe(422);
      expect(errorCode(rejected)).toBe('EVIDENCE_NOT_USABLE');
      expect(
        await ctx.prisma.inspectionReport.count({
          where: { inspectionId: other.inspectionId },
        }),
      ).toBe(0);
    });

    it('a rejected evidence file is no longer served', async () => {
      const s = await inspection();
      const ev = await evidence(s.inspectionId).expect(201);
      await api(w.inspectorA)
        .get(insp(s.inspectionId, `/evidence/${ev.body.id}/download`))
        .expect(200);
      await ctx.prisma.document.update({
        where: { id: ev.body.documentId },
        data: { status: 'REJECTED' },
      });
      const res = await api(w.inspectorA).get(
        insp(s.inspectionId, `/evidence/${ev.body.id}/download`),
      );
      expect(res.status).toBe(409);
      expect(errorCode(res)).toBe('DOCUMENT_NOT_AVAILABLE');
    });

    it('serves the exact bytes, as an attachment, and audits the download with the caller’s role', async () => {
      const s = await inspection();
      const data = jpegBytes('download-me');
      const ev = await evidence(s.inspectionId, {
        data,
        filename: 'exit.jpg',
      }).expect(201);
      const res = await api(w.inspectorA)
        .get(insp(s.inspectionId, `/evidence/${ev.body.id}/download`))
        .buffer(true)
        .parse((r, cb) => {
          const chunks: Buffer[] = [];
          r.on('data', (c: Buffer) => chunks.push(c));
          r.on('end', () => cb(null, Buffer.concat(chunks)));
        })
        .expect(200);
      expect(Buffer.compare(res.body as Buffer, data)).toBe(0);
      expect(res.headers['content-type']).toMatch(/image\/jpeg/);
      expect(res.headers['content-disposition']).toMatch(/attachment/);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      const [event] = await ctx.prisma.auditLog.findMany({
        where: { entityId: ev.body.documentId, action: 'DOCUMENT_DOWNLOADED' },
      });
      expect(event).toMatchObject({
        userId: w.inspectorA.user.id,
        roleAtTime: 'INSPECTOR',
      });
      expect(event.afterState).toMatchObject({
        inspectionId: s.inspectionId,
        evidenceId: ev.body.id,
      });
      // A department administrator downloads it under their own role.
      await api(w.adminA)
        .get(insp(s.inspectionId, `/evidence/${ev.body.id}/download`))
        .expect(200);
      const events2 = await ctx.prisma.auditLog.findMany({
        where: { entityId: ev.body.documentId, action: 'DOCUMENT_DOWNLOADED' },
        orderBy: { createdAt: 'asc' },
      });
      expect(events2.map((e) => e.roleAtTime)).toEqual([
        'INSPECTOR',
        'DEPT_ADMIN',
      ]);
    });
  });

  // -------------------------------------------------------------------------
  describe('submitting the report completes the inspection', () => {
    it('runs the whole flow: confirm, results with evidence, report — SCHEDULED -> COMPLETED, application untouched', async () => {
      const s = await inspection();
      const appBefore = await dbApp(s.applicationId);
      await api(w.inspectorA)
        .post(insp(s.inspectionId, '/confirm'))
        .expect(200);
      const ev = await evidence(s.inspectionId, {
        fields: { caption: 'Exit' },
      }).expect(201);
      await result(s.inspectionId, items[0].id, {
        evidenceId: ev.body.id,
      }).expect(201);
      await result(s.inspectionId, items[1].id, {
        finding: 'CONDITIONAL',
        notes: 'Retest in a week',
      }).expect(201);
      await result(s.inspectionId, items[2].id, {
        finding: 'NON_COMPLIANT',
        response: 'Expired',
      }).expect(201);

      const res = await report(s.inspectionId, {
        overallFinding: 'NON_COMPLIANT',
        summary: 'One extinguisher out of date.',
        correctiveAction: 'Replace the extinguisher and retest the alarm.',
      }).expect(201);
      expect(res.body.inspection).toMatchObject({
        id: s.inspectionId,
        status: 'COMPLETED',
        assignedBy: null,
      });
      expect(res.body.report).toMatchObject({
        overallFinding: 'NON_COMPLIANT',
        summary: 'One extinguisher out of date.',
        correctiveAction: 'Replace the extinguisher and retest the alarm.',
        submittedByUserId: w.inspectorA.user.id,
      });
      const row = await dbInspection(s.inspectionId);
      expect(row.status).toBe('COMPLETED');
      const summary =
        await ctx.prisma.inspectionReportSummary.findUniqueOrThrow({
          where: { inspectionId: s.inspectionId },
        });
      expect(summary.submittedByUserId).toBe(w.inspectorA.user.id);
      // The application's own state is exactly as it was.
      const appAfter = await dbApp(s.applicationId);
      expect(appAfter.internalState).toBe('UNDER_SCRUTINY');
      expect(appAfter.applicantStatus).toBe(appBefore.applicantStatus);
      expect(appAfter.updatedAt).toEqual(appBefore.updatedAt);

      const view = await api(w.inspectorA)
        .get(insp(s.inspectionId, '/report'))
        .expect(200);
      expect(view.body.status).toBe('COMPLETED');
      expect(view.body.report).toMatchObject({
        overallFinding: 'NON_COMPLIANT',
      });
      expect(
        view.body.checklist.map(
          (c: { current: { finding: string } }) => c.current.finding,
        ),
      ).toEqual(['COMPLIANT', 'CONDITIONAL', 'NON_COMPLIANT']);
      expect(view.body.evidence).toHaveLength(1);
    });

    it('audits the report and the completion, in that order, with counts and the before / after status', async () => {
      const s = await inspection();
      await evidence(s.inspectionId).expect(201);
      await answerAll(s.inspectionId);
      await report(s.inspectionId, {
        overallFinding: 'CONDITIONAL',
        summary: 'Minor points.',
      }).expect(201);
      const trail = (await events(s.applicationId)).filter(
        (e) =>
          e.action === 'INSPECTION_REPORT_SUBMITTED' ||
          e.action === 'INSPECTION_COMPLETED',
      );
      expect(trail.map((e) => e.action)).toEqual([
        'INSPECTION_REPORT_SUBMITTED',
        'INSPECTION_COMPLETED',
      ]);
      expect(trail[0].afterState).toMatchObject({
        overallFinding: 'CONDITIONAL',
        checklistResults: 3,
        evidenceCount: 1,
        correctiveActionRecorded: false,
        inspectionId: s.inspectionId,
        departmentId: w.deptA.id,
        projectId: s.projectId,
      });
      expect(trail[1].beforeState).toEqual({ status: 'SCHEDULED' });
      expect(trail[1].afterState).toMatchObject({
        status: 'COMPLETED',
        inspectionId: s.inspectionId,
      });
      for (const e of trail) {
        expect(e).toMatchObject({
          userId: w.inspectorA.user.id,
          roleAtTime: 'INSPECTOR',
          entityId: s.applicationId,
        });
        expect(e.ruleVersionUsed).toEqual(expect.any(String));
      }
      const all = await events(s.applicationId);
      expect(JSON.stringify(all)).not.toMatch(
        /password|token|secret|filePath|checksum/i,
      );
    });

    it('every checklist item needs a result first (422 CHECKLIST_INCOMPLETE naming what is missing); nothing is written', async () => {
      const s = await inspection();
      await result(s.inspectionId, items[0].id).expect(201);
      const res = await report(s.inspectionId);
      expect(res.status).toBe(422);
      expect(errorCode(res)).toBe('CHECKLIST_INCOMPLETE');
      expect(res.body.error.fields.checklist).toEqual([
        'No result recorded for: Fire alarm tested',
        'No result recorded for: Extinguishers in date',
      ]);
      expect((await dbInspection(s.inspectionId)).status).toBe('SCHEDULED');
      expect(
        await ctx.prisma.inspectionReportSummary.count({
          where: { inspectionId: s.inspectionId },
        }),
      ).toBe(0);
      expect(
        await events(s.applicationId, 'INSPECTION_REPORT_SUBMITTED'),
      ).toHaveLength(0);
      // A corrected answer counts once it exists.
      await result(s.inspectionId, items[1].id).expect(201);
      await result(s.inspectionId, items[2].id).expect(201);
      await report(s.inspectionId).expect(201);
    });

    it('a department with no checklist configured can still receive a report', async () => {
      const s = await inspection({ approval: noChecklistApproval });
      const view = await api(w.inspectorA)
        .get(insp(s.inspectionId, '/report'))
        .expect(200);
      expect(view.body.checklist).toEqual([]);
      await report(s.inspectionId).expect(201);
      expect((await dbInspection(s.inspectionId)).status).toBe('COMPLETED');
    });

    it('a NON_COMPLIANT finding needs a corrective-action recommendation; COMPLIANT and CONDITIONAL do not', async () => {
      const s = await inspection({ approval: noChecklistApproval });
      const res = await report(s.inspectionId, {
        overallFinding: 'NON_COMPLIANT',
      });
      expect(res.status).toBe(400);
      expect(errorCode(res)).toBe('VALIDATION_ERROR');
      expect(JSON.stringify(res.body)).toContain('correctiveAction');
      expect((await dbInspection(s.inspectionId)).status).toBe('SCHEDULED');
      await report(s.inspectionId, { overallFinding: 'CONDITIONAL' }).expect(
        201,
      );
    });

    it.each([
      ['no body', {}],
      ['no summary', { summary: undefined }],
      ['a blank summary', { summary: '   ' }],
      [
        'an unknown overall finding',
        { overallFinding: 'RE_INSPECTION_REQUIRED' },
      ],
      ['a status', { status: 'COMPLETED' }],
      ['a completion flag', { completed: true }],
      ['an outcome', { outcome: 'APPROVED' }],
      [
        'a submitter',
        { submittedByUserId: '00000000-0000-4000-8000-000000000001' },
      ],
    ])('rejects %s (400) and completes nothing', async (name, body) => {
      const s = await inspection({ approval: noChecklistApproval });
      const res =
        name === 'no body'
          ? await api(w.inspectorA)
              .post(insp(s.inspectionId, '/report'))
              .send({})
          : await report(s.inspectionId, body);
      expect(res.status).toBe(400);
      expect((await dbInspection(s.inspectionId)).status).toBe('SCHEDULED');
      expect(
        await ctx.prisma.inspectionReportSummary.count({
          where: { inspectionId: s.inspectionId },
        }),
      ).toBe(0);
    });

    it('not before the visit is scheduled', async () => {
      const pending = await inspection({
        pending: true,
        approval: noChecklistApproval,
      });
      const res = await report(pending.inspectionId);
      expect(res.status).toBe(409);
      expect(errorCode(res)).toBe('INSPECTION_NOT_SCHEDULED');
    });

    it('a completed inspection is final: no second report, and nothing more can be recorded, confirmed, rescheduled or changed', async () => {
      const s = await inspection({ approval: noChecklistApproval });
      await report(s.inspectionId).expect(201);
      const attempts = [
        await report(s.inspectionId),
        await api(w.inspectorA).post(insp(s.inspectionId, '/confirm')),
        await api(w.inspectorA)
          .post(insp(s.inspectionId, '/reschedule'))
          .send({ scheduledAt: future(9), reason: 'r' }),
        await result(s.inspectionId, items[0].id),
        await evidence(s.inspectionId),
        // The department's own edits are refused too.
        await api(w.soA1)
          .put(`${appPath(s.applicationId)}/inspections/${s.inspectionId}`)
          .send({ siteAddress: 'Changed after the fact' }),
      ];
      for (const res of attempts) {
        expect(res.status).toBe(409);
        expect(errorCode(res)).toBe('INSPECTION_NOT_MODIFIABLE');
      }
      expect(
        await ctx.prisma.inspectionReportSummary.count({
          where: { inspectionId: s.inspectionId },
        }),
      ).toBe(1);
      expect((await dbInspection(s.inspectionId)).siteAddress).not.toBe(
        'Changed after the fact',
      );
    });

    it('completing does not stop the department: the officer still scrutinises and can recommend, and a new inspection may follow', async () => {
      const s = await inspection({ approval: noChecklistApproval });
      await report(s.inspectionId).expect(201);
      // A finished inspection does not block a further one (re-inspection).
      await api(w.soA1)
        .post(`${appPath(s.applicationId)}/inspections`)
        .send({
          inspectorUserId: w.inspectorA.user.id,
          siteAddress: 'Second visit',
        })
        .expect(201);
      await api(w.soA1)
        .post(`${appPath(s.applicationId)}/observations`)
        .send({ body: 'Inspection report reviewed.' })
        .expect(201);
      const detail = await api(w.soA1)
        .get(appPath(s.applicationId))
        .expect(200);
      expect(detail.body.internalState).toBe('UNDER_SCRUTINY');
    });

    it('once scrutiny has finished (recommendation made) the inspector can read but not act', async () => {
      const s = await inspection();
      // Since Step 11C the recommendation is refused while an inspection is open;
      // set the finished-scrutiny state directly.
      await markScrutinyFinished(ctx.prisma, s.applicationId);
      const attempts = [
        await api(w.inspectorA).post(insp(s.inspectionId, '/confirm')),
        await result(s.inspectionId, items[0].id),
        await evidence(s.inspectionId),
        await report(s.inspectionId),
      ];
      for (const res of attempts) {
        expect(res.status).toBe(409);
        expect(errorCode(res)).toBe('INSPECTION_NOT_MODIFIABLE');
      }
      await api(w.inspectorA).get(insp(s.inspectionId)).expect(200);
      await api(w.inspectorA).get(insp(s.inspectionId, '/report')).expect(200);
    });
  });

  // -------------------------------------------------------------------------
  describe('concurrent transition attempts', () => {
    it('three simultaneous report submissions: exactly one completes the inspection', async () => {
      const s = await inspection({ approval: noChecklistApproval });
      const results = await Promise.all(
        [1, 2, 3].map((n) =>
          report(s.inspectionId, { summary: `Report ${n}` }),
        ),
      );
      expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409]);
      for (const r of results.filter((x) => x.status === 409)) {
        expect(errorCode(r)).toBe('INSPECTION_NOT_MODIFIABLE');
      }
      expect(
        await ctx.prisma.inspectionReportSummary.count({
          where: { inspectionId: s.inspectionId },
        }),
      ).toBe(1);
      expect(
        await events(s.applicationId, 'INSPECTION_COMPLETED'),
      ).toHaveLength(1);
      expect(
        await events(s.applicationId, 'INSPECTION_REPORT_SUBMITTED'),
      ).toHaveLength(1);
    });

    it('two simultaneous confirmations: exactly one wins', async () => {
      const s = await inspection();
      const results = await Promise.all([
        api(w.inspectorA).post(insp(s.inspectionId, '/confirm')),
        api(w.inspectorA).post(insp(s.inspectionId, '/confirm')),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(
        await events(s.applicationId, 'INSPECTION_CONFIRMED'),
      ).toHaveLength(1);
    });

    it('a report racing a reassignment by the officer: exactly one order wins, and the record is coherent either way', async () => {
      const s = await inspection({ approval: noChecklistApproval });
      const [rep, swap] = await Promise.all([
        report(s.inspectionId),
        api(w.soA1)
          .put(`${appPath(s.applicationId)}/inspections/${s.inspectionId}`)
          .send({ inspectorUserId: inspectorA2.user.id, reason: 'Race' }),
      ]);
      const row = await dbInspection(s.inspectionId);
      if (rep.status === 201) {
        // The report landed first: the department's change is refused.
        expect(swap.status).toBe(409);
        expect(row).toMatchObject({
          status: 'COMPLETED',
          inspectorId: w.inspectorA.user.id,
        });
      } else {
        // The reassignment landed first: the old inspector has lost access.
        expect(swap.status).toBe(200);
        expect(rep.status).toBe(404);
        expect(row).toMatchObject({
          status: 'SCHEDULED',
          inspectorId: inspectorA2.user.id,
        });
        expect(
          await ctx.prisma.inspectionReportSummary.count({
            where: { inspectionId: s.inspectionId },
          }),
        ).toBe(0);
      }
    });

    it('evidence racing the report: no half-recorded state — an upload either counts or leaves no document behind', async () => {
      const s = await inspection({ approval: noChecklistApproval });
      const before = await docsBy(w.inspectorA.user.id);
      const [up, rep] = await Promise.all([
        evidence(s.inspectionId),
        report(s.inspectionId),
      ]);
      expect(rep.status).toBe(201);
      const evidenceCount = await ctx.prisma.inspectionEvidence.count({
        where: { inspectionId: s.inspectionId },
      });
      expect(evidenceCount).toBe(up.status === 201 ? 1 : 0);
      expect(await docsBy(w.inspectorA.user.id)).toBe(before + evidenceCount);
      if (up.status !== 201) {
        expect(up.status).toBe(409);
      }
    });

    it('a result racing the report: the report never completes with a result missing that it counted', async () => {
      const s = await inspection();
      await result(s.inspectionId, items[0].id).expect(201);
      await result(s.inspectionId, items[1].id).expect(201);
      const [res, rep] = await Promise.all([
        result(s.inspectionId, items[2].id),
        report(s.inspectionId),
      ]);
      if (rep.status === 201) {
        // The third answer beat the report, or the report would have been refused.
        expect(
          await ctx.prisma.inspectionReport.count({
            where: {
              inspectionId: s.inspectionId,
              checklistItemId: items[2].id,
            },
          }),
        ).toBe(1);
        expect(res.status).toBe(201);
      } else {
        expect(rep.status).toBe(422);
        expect(res.status).toBe(201);
        expect((await dbInspection(s.inspectionId)).status).toBe('SCHEDULED');
      }
    });
  });

  // -------------------------------------------------------------------------
  describe('enforced by PostgreSQL itself, not only by service code', () => {
    const summaryData = (inspectionId: string, by: string, over = {}) => ({
      inspectionId,
      overallFinding: 'COMPLIANT' as const,
      summary: 'Direct.',
      submittedByUserId: by,
      ...over,
    });

    it('a report cannot be written for an inspection that is not scheduled, by anyone but its inspector, or with the checklist incomplete', async () => {
      const pending = await inspection({
        pending: true,
        approval: noChecklistApproval,
      });
      await expect(
        ctx.prisma.inspectionReportSummary.create({
          data: summaryData(pending.inspectionId, w.inspectorA.user.id),
        }),
      ).rejects.toThrow();
      const s = await inspection({ approval: noChecklistApproval });
      await expect(
        ctx.prisma.inspectionReportSummary.create({
          data: summaryData(s.inspectionId, inspectorA2.user.id),
        }),
      ).rejects.toThrow();
      const withChecklist = await inspection();
      await expect(
        ctx.prisma.inspectionReportSummary.create({
          data: summaryData(withChecklist.inspectionId, w.inspectorA.user.id),
        }),
      ).rejects.toThrow();
    });

    it('a report is written once and never edited; non-compliant needs a corrective action; blank text is refused', async () => {
      const s = await inspection({ approval: noChecklistApproval });
      await expect(
        ctx.prisma.inspectionReportSummary.create({
          data: summaryData(s.inspectionId, w.inspectorA.user.id, {
            overallFinding: 'NON_COMPLIANT',
          }),
        }),
      ).rejects.toThrow();
      await expect(
        ctx.prisma.inspectionReportSummary.create({
          data: summaryData(s.inspectionId, w.inspectorA.user.id, {
            summary: '  ',
          }),
        }),
      ).rejects.toThrow();
      await report(s.inspectionId).expect(201);
      const written =
        await ctx.prisma.inspectionReportSummary.findUniqueOrThrow({
          where: { inspectionId: s.inspectionId },
        });
      await expect(
        ctx.prisma.inspectionReportSummary.update({
          where: { id: written.id },
          data: { summary: 'Rewritten' },
        }),
      ).rejects.toThrow();
      await expect(
        ctx.prisma.inspectionReportSummary.create({
          data: summaryData(s.inspectionId, w.inspectorA.user.id),
        }),
      ).rejects.toThrow();
    });

    it('results: only while scheduled, only by the inspector, only for this approval’s items, never blank, never edited', async () => {
      const s = await inspection();
      const base = {
        inspectionId: s.inspectionId,
        checklistItemId: items[0].id,
        itemText: 'Fire exits clear',
        response: 'ok',
        finding: 'COMPLIANT' as const,
        recordedByUserId: w.inspectorA.user.id,
      };
      await expect(
        ctx.prisma.inspectionReport.create({
          data: { ...base, recordedByUserId: inspectorA2.user.id },
        }),
      ).rejects.toThrow();
      await expect(
        ctx.prisma.inspectionReport.create({
          data: { ...base, checklistItemId: otherApprovalItem.id },
        }),
      ).rejects.toThrow();
      await expect(
        ctx.prisma.inspectionReport.create({
          data: { ...base, response: '  ' },
        }),
      ).rejects.toThrow();
      await expect(
        ctx.prisma.inspectionReport.create({ data: { ...base, itemText: '' } }),
      ).rejects.toThrow();
      const pending = await inspection({ pending: true });
      await expect(
        ctx.prisma.inspectionReport.create({
          data: { ...base, inspectionId: pending.inspectionId },
        }),
      ).rejects.toThrow();
      const ok = await ctx.prisma.inspectionReport.create({ data: base });
      await expect(
        ctx.prisma.inspectionReport.update({
          where: { id: ok.id },
          data: { finding: 'NON_COMPLIANT' },
        }),
      ).rejects.toThrow();
    });

    it('evidence: only a scanned, usable document of the same project, once, for a scheduled inspection, by its inspector; never edited', async () => {
      const s = await inspection();
      const other = await inspection();
      const good = await evidence(s.inspectionId).expect(201);
      // A document can be evidence of ONE inspection only.
      await expect(
        ctx.prisma.inspectionEvidence.create({
          data: {
            inspectionId: other.inspectionId,
            documentId: good.body.documentId,
            uploadedByUserId: w.inspectorA.user.id,
          },
        }),
      ).rejects.toThrow();
      const doc = (over: Record<string, unknown>) =>
        ctx.prisma.document.create({
          data: {
            ownerType: 'PROJECT',
            ownerId: s.projectId,
            filePath: `documents/e2e/${Date.now()}-${(counter += 1)}`,
            checksum: 'x',
            originalFilename: 'x.jpg',
            mimeType: 'image/jpeg',
            sizeBytes: 1,
            status: 'VALIDATION_PENDING',
            scannedAt: new Date(),
            uploadedBy: w.inspectorA.user.id,
            ...over,
          },
        });
      const link = (documentId: string, over: Record<string, unknown> = {}) =>
        ctx.prisma.inspectionEvidence.create({
          data: {
            inspectionId: s.inspectionId,
            documentId,
            uploadedByUserId: w.inspectorA.user.id,
            ...over,
          },
        });
      await expect(link((await doc({ scannedAt: null })).id)).rejects.toThrow();
      await expect(
        link((await doc({ status: 'REJECTED' })).id),
      ).rejects.toThrow();
      await expect(
        link((await doc({ ownerId: other.projectId })).id),
      ).rejects.toThrow();
      await expect(
        link((await doc({})).id, { uploadedByUserId: inspectorA2.user.id }),
      ).rejects.toThrow();
      await expect(
        link((await doc({})).id, { caption: '  ' }),
      ).rejects.toThrow();
      const pending = await inspection({ pending: true });
      await expect(
        ctx.prisma.inspectionEvidence.create({
          data: {
            inspectionId: pending.inspectionId,
            documentId: (await doc({})).id,
            uploadedByUserId: w.inspectorA.user.id,
          },
        }),
      ).rejects.toThrow();
      await expect(
        ctx.prisma.inspectionEvidence.update({
          where: { id: good.body.id },
          data: { caption: 'Edited' },
        }),
      ).rejects.toThrow();
    });

    it('a confirmation cannot survive a change of date or inspector, and needs a date', async () => {
      const s = await inspection();
      await api(w.inspectorA)
        .post(insp(s.inspectionId, '/confirm'))
        .expect(200);
      await expect(
        ctx.prisma.inspection.update({
          where: { id: s.inspectionId },
          data: { scheduledAt: new Date(Date.now() + 9e9) },
        }),
      ).rejects.toThrow();
      await expect(
        ctx.prisma.inspection.update({
          where: { id: s.inspectionId },
          data: { inspectorId: inspectorA2.user.id },
        }),
      ).rejects.toThrow();
      const pending = await inspection({ pending: true });
      await expect(
        ctx.prisma.inspection.update({
          where: { id: pending.inspectionId },
          data: {
            confirmedAt: new Date(),
            confirmedByUserId: w.inspectorA.user.id,
          },
        }),
      ).rejects.toThrow();
    });

    it('the lifecycle allows only defined transitions: never PENDING -> COMPLETED, never a birth as COMPLETED', async () => {
      const pending = await inspection({ pending: true });
      await expect(
        ctx.prisma.inspection.update({
          where: { id: pending.inspectionId },
          data: { status: 'COMPLETED' },
        }),
      ).rejects.toThrow();
      const s = await inspection({ approval: noChecklistApproval });
      await expect(
        ctx.prisma.inspection.create({
          data: {
            applicationId: s.applicationId,
            inspectorId: w.inspectorA.user.id,
            siteAddress: 'x',
            status: 'COMPLETED',
            createdByUserId: w.soA1.user.id,
            assignedByUserId: w.soA1.user.id,
          },
        }),
      ).rejects.toThrow();
    });

    it('checklist items, results and evidence cannot be orphaned by deleting what they point at', async () => {
      const s = await inspection();
      const ev = await evidence(s.inspectionId).expect(201);
      await result(s.inspectionId, items[0].id, {
        evidenceId: ev.body.id,
      }).expect(201);
      await expect(
        ctx.prisma.inspectionChecklist.delete({ where: { id: items[0].id } }),
      ).rejects.toThrow();
      await expect(
        ctx.prisma.document.delete({ where: { id: ev.body.documentId } }),
      ).rejects.toThrow();
      await expect(
        ctx.prisma.inspection.delete({ where: { id: s.inspectionId } }),
      ).rejects.toThrow();
    });
  });
});
