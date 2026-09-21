import request from 'supertest';
import { API, E2eContext, createE2eContext } from './support/e2e-helpers';
import {
  activate,
  backdateDue,
  istDate,
  recordsOf,
} from './support/compliance-helpers';
import { eicarPdf, exeBytes, pdfBytes } from './support/document-fixtures';
import {
  Actor,
  OfficerWorld,
  as,
  buildOfficerWorld,
} from './support/officer-world';
import { ComplianceSyncService } from '../src/modules/compliance/compliance-sync.service';
import { addDaysYmd } from '../src/modules/compliance/compliance-dates';

jest.setTimeout(600_000);

/**
 * Step 14 - fulfilling an obligation with evidence, over real HTTP -> Nest ->
 * Prisma -> PostgreSQL, through Step 9's ONE document pipeline (validation,
 * hash, malware scan - fail closed, server-generated storage key). The evidence
 * is an ordinary document owned by the PROJECT, reachable only through its
 * obligation; downloads use the same checked path as every document.
 */
describe('Compliance e2e - fulfilment and evidence', () => {
  let ctx: E2eContext;
  let w: OfficerWorld;
  let sync: ComplianceSyncService;
  let evidenceType: string; // requires a supporting document
  let plainType: string; // requires none
  const mine = new Set<string>();

  const api = (a: { accessToken: string }) => as(ctx, a.accessToken);
  const errorCode = (res: { body: { error?: { code?: string } } }) =>
    res.body.error?.code;
  const run = (now: Date = new Date()) =>
    sync.run(now, { applicationIds: [...mine] });

  interface Sub {
    projectId: string;
    applicationId: string;
  }
  const appBase = (s: Sub) =>
    `/enterprises/${w.enterpriseId}/projects/${s.projectId}/applications/${s.applicationId}`;
  const officerApp = (id: string) => `/officer/applications/${id}`;

  const configure = (
    approvalTypeId: string,
    body: Record<string, unknown> = {},
  ) =>
    api(w.adminA)
      .post('/admin/compliance/requirements')
      .send({
        approvalTypeId,
        description: 'File the return',
        frequency: 'ONE_TIME',
        ...body,
      })
      .expect(201);

  /** An ACTIVE application, assigned to soA1, with its occurrence created. */
  const obligation = async (
    approvalTypeId: string,
    tag: string,
  ): Promise<Sub & { recordId: string }> => {
    const s = await ctx.submittedApplication(
      w.owner.accessToken,
      w.enterpriseId,
      approvalTypeId,
      `cf-${tag}`,
    );
    mine.add(s.applicationId);
    await api(w.adminA)
      .post(`${officerApp(s.applicationId)}/assignment`)
      .send({ officerUserId: w.soA1.user.id })
      .expect(201);
    await activate(ctx.prisma, s.applicationId);
    await run();
    const [rec] = await recordsOf(ctx.prisma, s.applicationId);
    return { ...s, recordId: rec.id };
  };

  const fulfilUrl = (s: Sub & { recordId: string }) =>
    `${appBase(s)}/compliance/${s.recordId}/fulfil`;
  const upload = (
    actor: Actor,
    s: Sub & { recordId: string },
    file: Buffer | null,
    filename = 'return.pdf',
    contentType = 'application/pdf',
  ) => {
    const req = api(actor).post(fulfilUrl(s));
    return file === null
      ? req
      : req.attach('file', file, { filename, contentType });
  };
  const recordOf = (id: string) =>
    ctx.prisma.complianceRecord.findUniqueOrThrow({ where: { id } });
  const projectDocs = (projectId: string) =>
    ctx.prisma.document.findMany({ where: { ownerId: projectId } });
  const events = (entityId: string, action: string) =>
    ctx.prisma.auditLog.findMany({
      where: { entityId, action },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

  beforeAll(async () => {
    ctx = await createE2eContext();
    w = await buildOfficerWorld(ctx, 'cf');
    sync = ctx.app.get(ComplianceSyncService);
    evidenceType = (
      await ctx.createStartableApproval(w.owner.user.id, 'cf-ev', {
        departmentId: w.deptA.id,
      })
    ).approvalTypeId;
    await configure(evidenceType, {
      evidenceRequired: true,
      firstDueAfterDays: 10,
      applicantAction: 'Upload the signed return',
    });
    plainType = (
      await ctx.createStartableApproval(w.owner.user.id, 'cf-plain', {
        departmentId: w.deptA.id,
      })
    ).approvalTypeId;
    await configure(plainType, {
      evidenceRequired: false,
      firstDueAfterDays: 0,
    });
  });

  afterAll(async () => {
    await ctx.cleanup();
    await ctx.app.close();
  });

  // -------------------------------------------------------------------------
  describe('evidence is required where the obligation says so', () => {
    it('no file: refused before anything is scanned or stored, and the obligation is untouched', async () => {
      const s = await obligation(evidenceType, 'nofile');
      const before = (await projectDocs(s.projectId)).length;
      const res = await upload(w.owner, s, null).expect(400);
      expect(errorCode(res)).toBe('COMPLIANCE_EVIDENCE_REQUIRED');
      expect((await recordOf(s.recordId)).status).toBe('UPCOMING');
      expect((await projectDocs(s.projectId)).length).toBe(before);
      expect(await events(s.applicationId, 'COMPLIANCE_FULFILLED')).toEqual([]);
    });

    it('a valid PDF fulfils it: the evidence is a project-owned, scanned document; nothing is exposed but its metadata', async () => {
      const s = await obligation(evidenceType, 'pdf');
      const bytes = pdfBytes('cf-pdf');
      const res = await upload(w.owner, s, bytes).expect(200);
      expect(res.body).toMatchObject({
        id: s.recordId,
        status: 'FULFILLED',
        evidenceRequired: true,
        fulfilledLate: false,
        evidence: {
          filename: 'return.pdf',
          mimeType: 'application/pdf',
          sizeBytes: bytes.length,
          version: 1,
        },
      });
      expect(res.body.fulfilledAt).not.toBeNull();
      expect(JSON.stringify(res.body)).not.toMatch(
        /filePath|checksum|storage/i,
      );

      const rec = await recordOf(s.recordId);
      expect(rec).toMatchObject({
        status: 'FULFILLED',
        fulfilledByUserId: w.owner.user.id,
      });
      const doc = await ctx.prisma.document.findUniqueOrThrow({
        where: { id: rec.fulfilledDocumentId as string },
      });
      expect(doc).toMatchObject({
        ownerType: 'PROJECT',
        ownerId: s.projectId,
        uploadedBy: w.owner.user.id,
        status: 'VALIDATION_PENDING',
        documentRequirementId: null,
        version: 1,
      });
      // Scanned by the configured scanner before it was ever recorded.
      expect(doc.scannedAt).not.toBeNull();
      expect(doc.scannerName).toBeTruthy();
    });

    it('is audited: the fulfilment against the application, and the document upload and scan through the documents audit', async () => {
      const s = await obligation(evidenceType, 'audit');
      await upload(w.owner, s, pdfBytes('cf-audit')).expect(200);
      const rec = await recordOf(s.recordId);
      const [done] = await events(s.applicationId, 'COMPLIANCE_FULFILLED');
      expect(done).toMatchObject({
        userId: w.owner.user.id,
        roleAtTime: 'APPLICANT',
      });
      expect(done.beforeState).toMatchObject({ status: 'UPCOMING' });
      expect(done.afterState).toMatchObject({
        complianceRecordId: s.recordId,
        occurrenceNumber: 1,
        requirementVersion: 1,
        status: 'FULFILLED',
        late: false,
        documentId: rec.fulfilledDocumentId,
        enterpriseId: w.enterpriseId,
        actingAs: 'OWNER',
      });
      expect(
        await events(
          rec.fulfilledDocumentId as string,
          'DOCUMENT_SCAN_COMPLETED',
        ),
      ).toHaveLength(1);
      expect(
        await events(rec.fulfilledDocumentId as string, 'DOCUMENT_UPLOADED'),
      ).toHaveLength(1);
    });

    it('the evidence is never in the application’s own document list', async () => {
      const s = await obligation(evidenceType, 'unlisted');
      await upload(w.owner, s, pdfBytes('cf-unlisted')).expect(200);
      const docId = (await recordOf(s.recordId)).fulfilledDocumentId as string;
      const list = await api(w.owner)
        .get(`${appBase(s)}/documents`)
        .expect(200);
      expect(JSON.stringify(list.body)).not.toContain(docId);
    });

    it('permanent: a second fulfilment is a 409 that stores nothing and changes nothing', async () => {
      const s = await obligation(evidenceType, 'twice');
      await upload(w.owner, s, pdfBytes('cf-twice-1')).expect(200);
      const first = await recordOf(s.recordId);
      const docs = (await projectDocs(s.projectId)).length;
      const again = await upload(w.owner, s, pdfBytes('cf-twice-2')).expect(
        409,
      );
      expect(errorCode(again)).toBe('COMPLIANCE_ALREADY_FULFILLED');
      const after = await recordOf(s.recordId);
      expect(after.fulfilledDocumentId).toBe(first.fulfilledDocumentId);
      expect(after.fulfilledAt?.getTime()).toBe(first.fulfilledAt?.getTime());
      expect((await projectDocs(s.projectId)).length).toBe(docs);
      // The date job never touches it.
      await run(new Date(Date.now() + 40 * 86_400_000));
      expect((await recordOf(s.recordId)).status).toBe('FULFILLED');
    });

    it('simultaneous fulfilments: exactly one wins, one document is kept', async () => {
      const s = await obligation(evidenceType, 'race');
      const results = await Promise.all(
        [1, 2, 3].map((n) => upload(w.owner, s, pdfBytes(`cf-race-${n}`))),
      );
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      expect(results.filter((r) => r.status === 409)).toHaveLength(2);
      expect(await projectDocs(s.projectId)).toHaveLength(1);
      expect(
        await events(s.applicationId, 'COMPLIANCE_FULFILLED'),
      ).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  describe('the same validation and scanning as every document', () => {
    it('a file with malware, an executable, an empty file or the wrong type is refused, and nothing is stored or fulfilled', async () => {
      const s = await obligation(evidenceType, 'bad');
      const docs = (await projectDocs(s.projectId)).length;
      const malware = await upload(w.owner, s, eicarPdf()).expect(422);
      expect(errorCode(malware)).toBe('MALWARE_DETECTED');
      const exe = await upload(w.owner, s, exeBytes(), 'run.pdf');
      expect([415, 422]).toContain(exe.status);
      const empty = await upload(w.owner, s, Buffer.alloc(0));
      expect(empty.status).toBeGreaterThanOrEqual(400);
      const liar = await upload(
        w.owner,
        s,
        pdfBytes('cf-liar'),
        'doc.png',
        'image/png',
      );
      expect(liar.status).toBeGreaterThanOrEqual(400);
      expect((await recordOf(s.recordId)).status).toBe('UPCOMING');
      expect((await projectDocs(s.projectId)).length).toBe(docs);
      // ...and a good file still works afterwards.
      await upload(w.owner, s, pdfBytes('cf-bad-then-good')).expect(200);
    });
  });

  // -------------------------------------------------------------------------
  describe('an obligation that needs no evidence', () => {
    it('is fulfilled without a file: no document, no scan', async () => {
      const s = await obligation(plainType, 'plain');
      const res = await upload(w.owner, s, null).expect(200);
      expect(res.body).toMatchObject({
        status: 'FULFILLED',
        evidenceRequired: false,
        evidence: null,
      });
      expect((await recordOf(s.recordId)).fulfilledDocumentId).toBeNull();
      expect(await projectDocs(s.projectId)).toEqual([]);
    });

    it('may still carry a supporting file if the applicant offers one', async () => {
      const s = await obligation(plainType, 'plain-file');
      const res = await upload(w.owner, s, pdfBytes('cf-plain-file')).expect(
        200,
      );
      expect(res.body.evidence).toMatchObject({ filename: 'return.pdf' });
    });

    it('early, late and on the day are all allowed; lateness is a fact of the two dates', async () => {
      // Early: due in 10 days, fulfilled today.
      const early = await obligation(evidenceType, 'early');
      const e = await upload(w.owner, early, pdfBytes('cf-early')).expect(200);
      expect(e.body).toMatchObject({
        fulfilledLate: false,
        status: 'FULFILLED',
      });

      // Late: the due date is moved back (a database-level test aid), the job
      // makes it OVERDUE, and the applicant fulfils it anyway.
      const late = await obligation(evidenceType, 'late');
      await backdateDue(ctx.prisma, late.recordId, addDaysYmd(istDate(), -3));
      await run();
      expect((await recordOf(late.recordId)).status).toBe('OVERDUE');
      const l = await upload(w.owner, late, pdfBytes('cf-late')).expect(200);
      expect(l.body).toMatchObject({
        fulfilledLate: true,
        status: 'FULFILLED',
      });
      const [event] = await events(late.applicationId, 'COMPLIANCE_FULFILLED');
      expect(event.beforeState).toMatchObject({ status: 'OVERDUE' });
      expect(event.afterState).toMatchObject({ late: true });
    });
  });

  // -------------------------------------------------------------------------
  describe('downloading the evidence', () => {
    let s: Sub & { recordId: string };
    let bytes: Buffer;
    const evidence = (path: string, actor?: Actor) => {
      const req = request(ctx.http).get(`${API}${path}`);
      return actor
        ? req.set('Authorization', `Bearer ${actor.accessToken}`)
        : req;
    };
    beforeAll(async () => {
      s = await obligation(evidenceType, 'download');
      bytes = pdfBytes('cf-download');
      await upload(w.owner, s, bytes).expect(200);
    });

    it('the applicant gets the exact bytes, as an attachment, never cached, through the audited download path', async () => {
      const res = await evidence(
        `${appBase(s)}/compliance/${s.recordId}/evidence`,
        w.owner,
      )
        .buffer(true)
        .parse((r, cb) => {
          const chunks: Buffer[] = [];
          r.on('data', (c: Buffer) => chunks.push(c));
          r.on('end', () => cb(null, Buffer.concat(chunks)));
        })
        .expect(200);
      expect((res.body as Buffer).equals(bytes)).toBe(true);
      expect(res.headers['content-disposition']).toMatch(/^attachment/);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['cache-control']).toMatch(/no-store/);
      const docId = (await recordOf(s.recordId)).fulfilledDocumentId as string;
      const downloads = await events(docId, 'DOCUMENT_DOWNLOADED');
      expect(downloads.at(-1)).toMatchObject({
        userId: w.owner.user.id,
        roleAtTime: 'APPLICANT',
      });
    });

    it('officers who can see the application can read it, audited under the role they act in', async () => {
      const docId = (await recordOf(s.recordId)).fulfilledDocumentId as string;
      for (const [actor, role] of [
        [w.soA1, 'SCRUTINY_OFFICER'],
        [w.adminA, 'DEPT_ADMIN'],
      ] as const) {
        const res = await evidence(
          `${officerApp(s.applicationId)}/compliance/${s.recordId}/evidence`,
          actor,
        ).expect(200);
        expect(res.headers['content-disposition']).toMatch(/^attachment/);
        expect(
          (await events(docId, 'DOCUMENT_DOWNLOADED')).at(-1),
        ).toMatchObject({
          userId: actor.user.id,
          roleAtTime: role,
        });
      }
    });

    it('everyone else gets nothing: another enterprise, another department, an unassigned officer, other roles, no session', async () => {
      const applicantPath = `${appBase(s)}/compliance/${s.recordId}/evidence`;
      const officerPath = `${officerApp(s.applicationId)}/compliance/${s.recordId}/evidence`;
      for (const a of [w.owner2, w.soA1, w.adminA, w.sysAdmin, w.leadership]) {
        const res = await evidence(applicantPath, a);
        expect([403, 404]).toContain(res.status);
      }
      for (const a of [w.soA2, w.soB, w.adminB, w.aaA]) {
        expect((await evidence(officerPath, a)).status).toBe(404);
      }
      for (const a of [
        w.owner,
        w.owner2,
        w.inspectorA,
        w.sysAdmin,
        w.leadership,
      ]) {
        expect((await evidence(officerPath, a)).status).toBe(403);
      }
      await evidence(applicantPath).expect(401);
      await evidence(officerPath).expect(401);
    });

    it('an obligation with no evidence, or a malformed id, is a 404, never a file', async () => {
      const plain = await obligation(plainType, 'download-none');
      await upload(w.owner, plain, null).expect(200);
      await evidence(
        `${appBase(plain)}/compliance/${plain.recordId}/evidence`,
        w.owner,
      ).expect(404);
      await evidence(
        `${appBase(s)}/compliance/00000000-0000-4000-8000-000000000000/evidence`,
        w.owner,
      ).expect(404);
      await evidence(
        `${appBase(s)}/compliance/not-a-uuid/evidence`,
        w.owner,
      ).expect(400);
    });
  });

  // -------------------------------------------------------------------------
  describe('who may fulfil (the enterprise access every application write uses)', () => {
    let repPrepare: Actor;
    let repView: Actor;
    let repOther: Actor;
    let repRevoked: Actor;
    let P1: string;
    let P2: string;

    const grant = async (
      rep: Actor,
      scope: string,
      extra: Record<string, unknown> = {},
    ) => {
      const res = await api(w.owner)
        .post(`/enterprises/${w.enterpriseId}/representatives`)
        .send({ emailOrMobile: rep.user.email, scope, ...extra })
        .expect(201);
      await api(rep)
        .post(`/representative-authorisations/${res.body.id}/accept`)
        .expect(200);
      return res.body.id as string;
    };

    beforeAll(async () => {
      [repPrepare, repView, repOther, repRevoked] = await Promise.all(
        ['prep', 'view', 'other', 'revoked'].map((t) =>
          ctx.applicantSession(`cf-rep-${t}`),
        ),
      );
      P1 = (
        await ctx.createProjectVia(w.owner.accessToken, w.enterpriseId, 'cf-p1')
      ).id;
      P2 = (
        await ctx.createProjectVia(w.owner.accessToken, w.enterpriseId, 'cf-p2')
      ).id;
      await grant(repPrepare, 'PREPARE_SUBMIT');
      await grant(repView, 'VIEW_ONLY');
      await grant(repOther, 'PREPARE_SUBMIT', { projectIds: [P2] });
      const revoked = await grant(repRevoked, 'FULL');
      await api(w.owner)
        .del(`/enterprises/${w.enterpriseId}/representatives/${revoked}`)
        .expect(200);
    });

    const onProject = async (tag: string, projectId: string) => {
      const s = await ctx.submittedApplication(
        w.owner.accessToken,
        w.enterpriseId,
        evidenceType,
        `cf-${tag}`,
        { projectId },
      );
      mine.add(s.applicationId);
      await activate(ctx.prisma, s.applicationId);
      await run();
      const [rec] = await recordsOf(ctx.prisma, s.applicationId);
      return { ...s, recordId: rec.id };
    };

    it('a representative who may prepare and submit can fulfil - audited as acting for the enterprise; a view-only one, one restricted to another project and a revoked one cannot', async () => {
      const s = await onProject('rep', P1);
      for (const [actor, statuses] of [
        [repView, [403]],
        [repOther, [403, 404]],
        [repRevoked, [404]],
        [w.owner2, [403, 404]],
      ] as const) {
        const res = await upload(
          actor,
          s,
          pdfBytes(`cf-rep-no-${actor.user.id}`),
        );
        expect(statuses as readonly number[]).toContain(res.status);
      }
      expect((await recordOf(s.recordId)).status).toBe('UPCOMING');

      const ok = await upload(repPrepare, s, pdfBytes('cf-rep-yes')).expect(
        200,
      );
      expect(ok.body.status).toBe('FULFILLED');
      expect((await recordOf(s.recordId)).fulfilledByUserId).toBe(
        repPrepare.user.id,
      );
      const [event] = await events(s.applicationId, 'COMPLIANCE_FULFILLED');
      expect(event.userId).toBe(repPrepare.user.id);
      expect(event.afterState).toMatchObject({
        actingAs: 'REPRESENTATIVE',
        representativeScope: 'PREPARE_SUBMIT',
        enterpriseId: w.enterpriseId,
      });
    });

    it('a project-restricted representative can fulfil obligations of THEIR project only', async () => {
      const own = await onProject('rep-own', P2);
      await upload(repOther, own, pdfBytes('cf-other-own')).expect(200);
    });

    it('an obligation is reachable only through its own application, project and enterprise', async () => {
      const a = await obligation(evidenceType, 'cross-a');
      const b = await obligation(evidenceType, 'cross-b');
      // a's record through b's URL, and vice versa.
      const crossed = { ...b, recordId: a.recordId };
      await upload(w.owner, crossed, pdfBytes('cf-cross')).expect(404);
      // Another enterprise's applicant, naming their own enterprise.
      const res = await api(w.owner2)
        .post(
          `/enterprises/${w.enterprise2Id}/projects/${a.projectId}/applications/${a.applicationId}/compliance/${a.recordId}/fulfil`,
        )
        .attach('file', pdfBytes('cf-cross-2'), {
          filename: 'r.pdf',
          contentType: 'application/pdf',
        });
      expect([403, 404]).toContain(res.status);
      expect((await recordOf(a.recordId)).status).toBe('UPCOMING');
      expect((await recordOf(b.recordId)).status).toBe('UPCOMING');
    });

    it('officers and every non-applicant role cannot fulfil; nor can an unauthenticated caller', async () => {
      const s = await obligation(evidenceType, 'roles');
      for (const actor of [w.soA1, w.adminA, w.aaA, w.sysAdmin, w.leadership]) {
        const res = await upload(
          actor,
          s,
          pdfBytes(`cf-role-${actor.user.id}`),
        );
        expect([403, 404]).toContain(res.status);
      }
      await request(ctx.http)
        .post(`${API}${fulfilUrl(s)}`)
        .expect(401);
      expect((await recordOf(s.recordId)).status).toBe('UPCOMING');
    });
  });
});
