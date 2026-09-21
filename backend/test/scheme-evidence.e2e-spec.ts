import request from 'supertest';
import { API, E2eContext, createE2eContext } from './support/e2e-helpers';
import {
  eicarPdf,
  exeBytes,
  jpegBytes,
  pdfBytes,
  pngBytes,
} from './support/document-fixtures';
import { Actor, as } from './support/officer-world';
import {
  PublishedScheme,
  SchemeWorld,
  applyFor,
  buildSchemeWorld,
  publishScheme,
  schemeApplicationBase,
  uploadEvidence,
} from './support/scheme-world';

jest.setTimeout(600_000);

const OFFICER = '/scheme-officer/scheme-applications';

/**
 * Step 16 - supporting EVIDENCE for a scheme application, through the platform's
 * one document pipeline (validation by real content, malware scan - fail closed,
 * server-generated storage, non-destructive versions, integrity-checked
 * download), scoped through the application, and reviewed by the Scheme Officer -
 * over real HTTP -> Nest -> Prisma -> PostgreSQL. Every scheme and requirement is
 * a labelled test fixture.
 */
describe('Schemes e2e - evidence (documents) for a scheme application', () => {
  let ctx: E2eContext;
  let w: SchemeWorld;
  let P2: string;
  let scheme: PublishedScheme; // M (mandatory, PDF only), O (optional)
  let other: PublishedScheme; // has its own requirement
  let M: string;
  let O: string;
  let OTHER_REQ: string;
  let repView: Actor;
  let repP2: Actor; // PREPARE_SUBMIT, restricted to P2
  let counter = 0;

  const api = (a: { accessToken: string }) => as(ctx, a.accessToken);
  const errorCode = (res: { body: { error?: { code?: string } } }) =>
    res.body.error?.code;

  const applyOn = async (projectId: string, s: PublishedScheme = scheme) =>
    (
      await applyFor(
        ctx,
        w.owner.accessToken,
        w.enterpriseId,
        projectId,
        s.id,
      ).expect(201)
    ).body.id as string;
  /** A fresh application on its own project. */
  const fresh = async (s: PublishedScheme = scheme) => {
    counter += 1;
    const p = await ctx.createProjectVia(
      w.owner.accessToken,
      w.enterpriseId,
      `se-${counter}`,
    );
    return { projectId: p.id, id: await applyOn(p.id, s) };
  };
  const base = (
    a: { projectId: string; id: string },
    enterpriseId = w.enterpriseId,
  ) => schemeApplicationBase(enterpriseId, a.projectId, a.id);
  const upload = (
    a: { projectId: string; id: string },
    options: Parameters<typeof uploadEvidence>[5] = {},
    actor: Actor = w.owner,
  ) =>
    uploadEvidence(
      ctx,
      actor.accessToken,
      w.enterpriseId,
      a.projectId,
      a.id,
      options,
    );
  const forRequirement = (id: string, extra: Record<string, unknown> = {}) => ({
    fields: { documentRequirementId: id },
    ...extra,
  });
  const officerAct = (id: string, action: string, body?: object) =>
    api(w.soA)
      .post(`${OFFICER}/${id}/${action}`)
      .send(body ?? {});
  const getBytes = (call: request.Test) =>
    call.buffer(true).parse((response, cb) => {
      const chunks: Buffer[] = [];
      response.on('data', (c: Buffer) => chunks.push(c));
      response.on('end', () => cb(null, Buffer.concat(chunks)));
    });
  const audits = (entityId: string, action?: string) =>
    ctx.prisma.auditLog.findMany({
      where: { entityId, ...(action ? { action } : {}) },
      orderBy: { createdAt: 'asc' },
    });

  beforeAll(async () => {
    ctx = await createE2eContext();
    w = await buildSchemeWorld(ctx, 'se');
    P2 = (
      await ctx.createProjectVia(w.owner.accessToken, w.enterpriseId, 'se-p2')
    ).id;
    [repView, repP2] = await Promise.all(
      ['view', 'p2'].map((t) => ctx.applicantSession(`se-rep-${t}`)),
    );
    for (const [rep, scope, extra] of [
      [repView, 'VIEW_ONLY', {}],
      [repP2, 'PREPARE_SUBMIT', { projectIds: [P2] }],
    ] as Array<[Actor, string, Record<string, unknown>]>) {
      const res = await api(w.owner)
        .post(`/enterprises/${w.enterpriseId}/representatives`)
        .send({ emailOrMobile: rep.user.email, scope, ...extra })
        .expect(201);
      await api(rep)
        .post(`/representative-authorisations/${res.body.id}/accept`)
        .expect(200);
    }
    scheme = await publishScheme(ctx, w, {
      requirements: [
        {
          name: 'Mandatory proof',
          isMandatory: true,
          description: 'Plain words',
          allowedMimeTypes: ['application/pdf'],
        },
        { name: 'Optional proof', isMandatory: false },
      ],
    });
    [M, O] = scheme.requirementIds;
    other = await publishScheme(ctx, w, {
      requirements: [{ name: 'Other scheme proof', isMandatory: true }],
    });
    [OTHER_REQ] = other.requirementIds;
  });

  afterAll(async () => {
    await ctx.cleanup();
    await ctx.app.close();
  });

  describe('what the scheme requires', () => {
    it('lists the requirements with whether each is satisfied - nothing is assumed', async () => {
      const a = await fresh();
      const res = await api(w.owner)
        .get(`${base(a)}/document-requirements`)
        .expect(200);
      expect(res.body).toEqual([
        expect.objectContaining({
          id: M,
          name: 'Mandatory proof',
          isMandatory: true,
          satisfied: false,
          currentDocument: null,
          allowedMimeTypes: ['application/pdf'],
        }),
        expect.objectContaining({
          id: O,
          name: 'Optional proof',
          isMandatory: false,
          satisfied: false,
          currentDocument: null,
        }),
      ]);
      // a scheme with none configured shows none (never an invented requirement)
      const bare = await publishScheme(ctx, w, {});
      const b = await fresh(bare);
      expect(
        (
          await api(w.owner)
            .get(`${base(b)}/document-requirements`)
            .expect(200)
        ).body,
      ).toEqual([]);
    });
  });

  describe('uploading (the platform’s one pipeline)', () => {
    let a: { projectId: string; id: string };
    let m1: { id: string; body: Record<string, unknown> };

    beforeAll(async () => {
      a = await fresh();
    });

    it('stores a valid file against a requirement of THIS scheme, owned by the project, scanned and awaiting review', async () => {
      const bytes = pdfBytes('m1');
      const res = await upload(a, forRequirement(M, { file: bytes })).expect(
        201,
      );
      m1 = { id: res.body.id, body: res.body };
      expect(res.body).toMatchObject({
        schemeApplicationId: a.id,
        version: 1,
        isCurrent: true,
        previousVersionId: null,
        requirement: { id: M, name: 'Mandatory proof', isMandatory: true },
        status: 'VALIDATION_PENDING',
        mimeType: 'application/pdf',
        sizeBytes: bytes.length,
        downloadable: true,
        review: null,
        uploadedByUserId: w.owner.user.id,
        scan: { state: 'CLEAN' },
      });
      expect(res.body.scan.scanner).toEqual(expect.any(String));
      // no storage path or checksum ever reaches the client
      for (const secret of ['filePath', 'checksum', 'file_path']) {
        expect(res.body).not.toHaveProperty(secret);
      }
      const row = await ctx.prisma.document.findUniqueOrThrow({
        where: { id: res.body.id },
      });
      expect(row).toMatchObject({
        ownerType: 'PROJECT',
        ownerId: a.projectId,
        documentRequirementId: null, // an approval requirement: never a scheme one
        uploadedBy: w.owner.user.id,
        status: 'VALIDATION_PENDING',
      });
      expect(row.scannedAt).not.toBeNull();
      expect(row.filePath).not.toContain(row.originalFilename);
      const link = await ctx.prisma.schemeApplicationDocument.findMany({
        where: { documentId: row.id },
      });
      expect(link).toEqual([
        {
          schemeApplicationId: a.id,
          documentId: row.id,
          schemeDocumentRequirementId: M,
        },
      ]);
    });

    it('marks the requirement satisfied, and shows the current document against it', async () => {
      const res = await api(w.owner)
        .get(`${base(a)}/document-requirements`)
        .expect(200);
      const m = res.body.find((r: { id: string }) => r.id === M);
      expect(m).toMatchObject({
        satisfied: true,
        currentDocument: {
          id: m1.id,
          version: 1,
          status: 'VALIDATION_PENDING',
        },
      });
      expect(res.body.find((r: { id: string }) => r.id === O).satisfied).toBe(
        false,
      );
    });

    it('is not attached to any approval application, and appears in no approval document list', async () => {
      expect(
        await ctx.prisma.applicationDocument.count({
          where: { documentId: m1.id },
        }),
      ).toBe(0);
    });

    it('refuses a second document for a requirement (replace instead), one of another scheme, and a malformed id', async () => {
      const dup = await upload(
        a,
        forRequirement(M, { file: pdfBytes() }),
      ).expect(409);
      expect(errorCode(dup)).toBe('REQUIREMENT_ALREADY_HAS_DOCUMENT');
      const mismatch = await upload(
        a,
        forRequirement(OTHER_REQ, { file: pdfBytes() }),
      ).expect(422);
      expect(errorCode(mismatch)).toBe('DOCUMENT_REQUIREMENT_MISMATCH');
      await upload(
        a,
        forRequirement('not-a-uuid', { file: pdfBytes() }),
      ).expect(400);
      await upload(
        a,
        forRequirement('00000000-0000-4000-8000-000000000000', {
          file: pdfBytes(),
        }),
      ).expect(422);
    });

    it('accepts a supporting document tied to no requirement, and an optional requirement’s', async () => {
      const free = await upload(a, {
        file: pngBytes('free'),
        filename: 'photo.png',
        contentType: 'image/png',
      }).expect(201);
      expect(free.body.requirement).toBeNull();
      const opt = await upload(
        a,
        forRequirement(O, {
          file: jpegBytes('opt'),
          filename: 'x.jpg',
          contentType: 'image/jpeg',
        }),
      ).expect(201);
      expect(opt.body.requirement).toMatchObject({ id: O, isMandatory: false });
      const expiry = await upload(a, {
        file: pdfBytes(),
        fields: { expiryDate: '2099-12-31' },
      }).expect(201);
      expect(expiry.body.expiryDate).toBe('2099-12-31');
      await upload(a, {
        file: pdfBytes(),
        fields: { expiryDate: '2099-02-31' },
      }).expect(400);
      await upload(a, {
        file: pdfBytes(),
        fields: { expiryDate: 'soon' },
      }).expect(400);
    });

    it('applies the requirement’s limits: content type and size', async () => {
      const b = await fresh();
      // M accepts PDF only
      const png = await upload(
        b,
        forRequirement(M, {
          file: pngBytes(),
          filename: 'x.png',
          contentType: 'image/png',
        }),
      ).expect(415);
      expect(errorCode(png)).toBe('UNSUPPORTED_TYPE');
      // a requirement with a tiny size limit
      const tiny = await publishScheme(ctx, w, {
        requirements: [{ name: 'Tiny', isMandatory: false, maxSizeBytes: 60 }],
      });
      const c = await fresh(tiny);
      const big = await upload(
        c,
        forRequirement(tiny.requirementIds[0], { file: pdfBytes() }),
      ).expect(413);
      expect(errorCode(big)).toBe('FILE_TOO_LARGE');
    });

    it('rejects what is not a genuine document, and stores nothing', async () => {
      const b = await fresh();
      const before = await ctx.prisma.document.count({
        where: { uploadedBy: w.owner.user.id },
      });
      const cases: Array<
        [Parameters<typeof uploadEvidence>[5], number, string]
      > = [
        [{ file: null }, 400, 'FILE_REQUIRED'],
        [{ file: Buffer.alloc(0) }, 400, 'FILE_EMPTY'],
        [{ file: exeBytes(), filename: 'setup.pdf' }, 415, 'UNSUPPORTED_TYPE'],
        [
          {
            file: pngBytes(),
            filename: 'x.pdf',
            contentType: 'application/pdf',
          },
          422,
          'MIME_TYPE_MISMATCH',
        ],
        [{ file: eicarPdf() }, 422, 'MALWARE_DETECTED'],
      ];
      for (const [options, status, code] of cases) {
        const res = await upload(b, options);
        expect([res.status, errorCode(res)]).toEqual([status, code]);
      }
      expect(
        await ctx.prisma.document.count({
          where: { uploadedBy: w.owner.user.id },
        }),
      ).toBe(before);
      expect(
        await ctx.prisma.schemeApplicationDocument.count({
          where: { schemeApplicationId: b.id },
        }),
      ).toBe(0);
      // the rejection is audited against the SCHEME application
      const [event] = await audits(b.id, 'DOCUMENT_SCAN_REJECTED');
      expect(event).toMatchObject({
        userId: w.owner.user.id,
        roleAtTime: 'APPLICANT',
        entityType: 'SchemeApplication',
      });
      expect(event.afterState).toMatchObject({
        enterpriseId: w.enterpriseId,
        projectId: b.projectId,
        schemeApplicationId: b.id,
        stored: false,
      });
    });

    it('takes no owner, uploader, status, scan state, version or path from the client', async () => {
      const b = await fresh();
      for (const forbidden of [
        { ownerId: w.owner2.user.id },
        { uploadedBy: w.owner2.user.id },
        { status: 'VERIFIED' },
        { scannedAt: '2020-01-01' },
        { version: '9' },
        { filePath: '/etc/passwd' },
        { schemeApplicationId: a.id },
      ]) {
        const res = await upload(b, {
          file: pdfBytes(),
          fields: forbidden as unknown as Record<string, string>,
        });
        expect(res.status).toBe(400);
      }
      expect(
        await ctx.prisma.schemeApplicationDocument.count({
          where: { schemeApplicationId: b.id },
        }),
      ).toBe(0);
    });

    it('audits the upload with the scheme application, requirement, actor and role', async () => {
      const uploaded = await audits(m1.id, 'DOCUMENT_UPLOADED');
      expect(uploaded).toHaveLength(1);
      expect(uploaded[0]).toMatchObject({
        userId: w.owner.user.id,
        roleAtTime: 'APPLICANT',
        entityType: 'Document',
      });
      expect(uploaded[0].afterState).toMatchObject({
        enterpriseId: w.enterpriseId,
        projectId: a.projectId,
        schemeApplicationId: a.id,
        schemeId: scheme.id,
        documentId: m1.id,
        version: 1,
        actingAs: 'OWNER',
        schemeRequirementId: M,
      });
      for (const action of [
        'DOCUMENT_SCAN_COMPLETED',
        'DOCUMENT_ASSOCIATED',
        'DOCUMENT_REQUIREMENT_SATISFIED',
      ]) {
        expect(await audits(m1.id, action)).toHaveLength(1);
      }
    });
  });

  describe('replacing (non-destructive versions)', () => {
    it('adds a new version that names its predecessor, inherits the requirement, and keeps the old one retrievable', async () => {
      const a = await fresh();
      const v1 = await upload(
        a,
        forRequirement(M, { file: pdfBytes('one') }),
      ).expect(201);
      const v2 = await upload(a, {
        path: `documents/${v1.body.id}/replace`,
        file: pdfBytes('two'),
      }).expect(201);
      expect(v2.body).toMatchObject({
        version: 2,
        isCurrent: true,
        previousVersionId: v1.body.id,
        lineageId: v1.body.lineageId,
        requirement: { id: M },
      });
      const current = await api(w.owner)
        .get(`${base(a)}/documents`)
        .expect(200);
      expect(current.body.map((d: { id: string }) => d.id)).toEqual([
        v2.body.id,
      ]);
      const history = await api(w.owner)
        .get(`${base(a)}/documents?includeHistory=true`)
        .expect(200);
      expect(
        history.body.map((d: { id: string; isCurrent: boolean }) => [
          d.id,
          d.isCurrent,
        ]),
      ).toEqual([
        [v1.body.id, false],
        [v2.body.id, true],
      ]);
      // the requirement is answered by the CURRENT version only
      const reqs = await api(w.owner)
        .get(`${base(a)}/document-requirements`)
        .expect(200);
      expect(
        reqs.body.find((r: { id: string }) => r.id === M).currentDocument,
      ).toMatchObject({ id: v2.body.id, version: 2 });
      // only the current version can be replaced
      const stale = await upload(a, {
        path: `documents/${v1.body.id}/replace`,
        file: pdfBytes('three'),
      }).expect(409);
      expect(errorCode(stale)).toBe('DOCUMENT_NOT_CURRENT');
      // the old version is still downloadable, byte for byte
      const first = pdfBytes('one');
      const old = await getBytes(
        api(w.owner).get(`${base(a)}/documents/${v1.body.id}/download`),
      ).expect(200);
      expect(old.body).toEqual(first);
      // and audited
      const [replaced] = await audits(v2.body.id, 'DOCUMENT_REPLACED');
      expect(replaced.afterState).toMatchObject({
        previousDocumentId: v1.body.id,
        previousVersion: 1,
        schemeApplicationId: a.id,
      });
      expect(replaced.beforeState).toMatchObject({
        documentId: v1.body.id,
        version: 1,
      });
    });

    it('racing replacements of one version produce exactly one new version', async () => {
      const a = await fresh();
      const v1 = await upload(
        a,
        forRequirement(M, { file: pdfBytes('race') }),
      ).expect(201);
      const results = await Promise.all(
        [1, 2].map((n) =>
          upload(a, {
            path: `documents/${v1.body.id}/replace`,
            file: pdfBytes(`race-${n}`),
          }),
        ),
      );
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      const rows = await ctx.prisma.document.findMany({
        where: { lineageId: v1.body.lineageId },
      });
      expect(rows.map((r) => r.version).sort()).toEqual([1, 2]);
    });
  });

  describe('retrieval: only through the application, only for those who may see it', () => {
    let a: { projectId: string; id: string };
    let b: { projectId: string; id: string };
    let docA: string;
    let docB: string;

    beforeAll(async () => {
      a = await fresh();
      b = await fresh();
      docA = (
        await upload(a, forRequirement(M, { file: pdfBytes('doc-a') })).expect(
          201,
        )
      ).body.id;
      docB = (
        await upload(b, forRequirement(M, { file: pdfBytes('doc-b') })).expect(
          201,
        )
      ).body.id;
    });

    it('serves the applicant their file, byte for byte, as an attachment with safe headers', async () => {
      const res = await getBytes(
        api(w.owner).get(`${base(a)}/documents/${docA}/download`),
      ).expect(200);
      expect(res.body).toEqual(pdfBytes('doc-a'));
      expect(res.headers['content-type']).toContain('application/pdf');
      expect(res.headers['content-disposition']).toContain('attachment');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['cache-control']).toMatch(/no-store|private/);
      const [event] = await audits(docA, 'DOCUMENT_DOWNLOADED');
      expect(event).toMatchObject({
        userId: w.owner.user.id,
        roleAtTime: 'APPLICANT',
      });
      expect(event.afterState).toMatchObject({
        schemeApplicationId: a.id,
        projectId: a.projectId,
        enterpriseId: w.enterpriseId,
      });
    });

    it('a document id of another application is the same 404 as a nonexistent one', async () => {
      await api(w.owner)
        .get(`${base(a)}/documents/${docB}/download`)
        .expect(404);
      await api(w.owner)
        .get(`${base(b)}/documents/${docA}/download`)
        .expect(404);
      await api(w.owner)
        .get(
          `${base(a)}/documents/00000000-0000-4000-8000-000000000000/download`,
        )
        .expect(404);
      await upload(a, {
        path: `documents/${docB}/replace`,
        file: pdfBytes(),
      }).expect(404);
      // (review is only possible under review; another application's document is still a 404)
      await officerAct(a.id, 'start-review').expect(200);
      await api(w.soA)
        .post(`${OFFICER}/${a.id}/documents/${docB}/review`)
        .send({ verdict: 'VERIFIED' })
        .expect(404);
    });

    it('View Only representatives can read and download but not upload; a project-restricted one only for their project', async () => {
      await api(repView)
        .get(`${base(a)}/documents`)
        .expect(200);
      await getBytes(
        api(repView).get(`${base(a)}/documents/${docA}/download`),
      ).expect(200);
      const denied = await upload(
        a,
        forRequirement(O, { file: pdfBytes() }),
        repView,
      ).expect(403);
      expect(errorCode(denied)).toBe('FORBIDDEN_SCOPE');
      const outside = await api(repP2)
        .get(`${base(a)}/documents`)
        .expect(403);
      expect(errorCode(outside)).toBe('FORBIDDEN_SCOPE');
      const p2app = { projectId: P2, id: await applyOn(P2) };
      const ok = await upload(
        p2app,
        forRequirement(M, { file: pdfBytes() }),
        repP2,
      ).expect(201);
      expect(ok.body.uploadedByUserId).toBe(repP2.user.id);
      const [event] = await audits(ok.body.id, 'DOCUMENT_UPLOADED');
      expect(event.afterState).toMatchObject({
        actingAs: 'REPRESENTATIVE',
        representativeScope: 'PREPARE_SUBMIT',
      });
    });

    it('another enterprise, a stranger and the unauthenticated cannot list, download or upload', async () => {
      for (const actor of [w.owner2]) {
        await api(actor)
          .get(`${base(a)}/documents`)
          .expect(404);
        await api(actor)
          .get(`${base(a)}/documents/${docA}/download`)
          .expect(404);
        await api(actor)
          .get(`${base(a)}/document-requirements`)
          .expect(404);
        await upload(a, forRequirement(O, { file: pdfBytes() }), actor).expect(
          404,
        );
      }
      await request(ctx.http)
        .get(`${API}${base(a)}/documents`)
        .expect(401);
      await request(ctx.http)
        .get(`${API}${base(a)}/documents/${docA}/download`)
        .expect(401);
    });

    it('the department’s Scheme Officer reads and downloads it; another department’s and every other role cannot', async () => {
      const list = await api(w.soA)
        .get(`${OFFICER}/${a.id}/documents`)
        .expect(200);
      expect(list.body.map((d: { id: string }) => d.id)).toEqual([docA]);
      const file = await getBytes(
        api(w.soA).get(`${OFFICER}/${a.id}/documents/${docA}/download`),
      ).expect(200);
      expect(file.body).toEqual(pdfBytes('doc-a'));
      const [event] = (await audits(docA, 'DOCUMENT_DOWNLOADED')).slice(-1);
      expect(event).toMatchObject({
        userId: w.soA.user.id,
        roleAtTime: 'SCHEME_OFFICER',
      });
      expect(event.afterState).toMatchObject({
        schemeApplicationId: a.id,
        departmentId: w.deptA.id,
        actingAs: 'SCHEME_OFFICER',
      });

      await api(w.soB).get(`${OFFICER}/${a.id}/documents`).expect(404);
      await api(w.soB)
        .get(`${OFFICER}/${a.id}/documents/${docA}/download`)
        .expect(404);
      for (const actor of [w.adminA, w.scrutinyA, w.sysAdmin, w.owner]) {
        await api(actor).get(`${OFFICER}/${a.id}/documents`).expect(403);
        await api(actor)
          .get(`${OFFICER}/${a.id}/documents/${docA}/download`)
          .expect(403);
      }
    });

    it('a document that fails its integrity check is never served', async () => {
      const c = await fresh();
      const id = (
        await upload(c, forRequirement(M, { file: pdfBytes('tamper') })).expect(
          201,
        )
      ).body.id;
      await ctx.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`UPDATE documents SET status = 'REJECTED' WHERE id = ${id}::uuid`;
      });
      const res = await api(w.owner)
        .get(`${base(c)}/documents/${id}/download`)
        .expect(409);
      expect(errorCode(res)).toBe('DOCUMENT_NOT_AVAILABLE');
    });
  });

  describe('Scheme Officer review, and the approval gate (FRD 34 "verify supporting documents")', () => {
    let a: { projectId: string; id: string };
    let rejected: string;
    let accepted: string;

    beforeAll(async () => {
      a = await fresh();
      rejected = (
        await upload(
          a,
          forRequirement(M, { file: pdfBytes('to-reject') }),
        ).expect(201)
      ).body.id;
    });

    it('evidence can be reviewed only while the application is UNDER REVIEW', async () => {
      const early = await api(w.soA)
        .post(`${OFFICER}/${a.id}/documents/${rejected}/review`)
        .send({ verdict: 'VERIFIED' })
        .expect(409);
      expect(errorCode(early)).toBe('DOCUMENT_NOT_REVIEWABLE');
      await officerAct(a.id, 'start-review').expect(200);
    });

    it('a rejection needs a reason; verdicts are only VERIFIED or REJECTED; nothing else is accepted', async () => {
      for (const bad of [
        { verdict: 'REJECTED' },
        { verdict: 'REJECTED', notes: '  ' },
        { verdict: 'MAYBE' },
        { verdict: 'REJECTED', notes: 'x', validUntil: '2099-01-01' },
        { verdict: 'VERIFIED', validUntil: '2099-02-31' },
        { verdict: 'VERIFIED', status: 'VERIFIED' },
      ]) {
        await api(w.soA)
          .post(`${OFFICER}/${a.id}/documents/${rejected}/review`)
          .send(bad)
          .expect(400);
      }
    });

    it('rejects a document with a reason the applicant sees; a rejected document no longer satisfies the requirement', async () => {
      const res = await api(w.soA)
        .post(`${OFFICER}/${a.id}/documents/${rejected}/review`)
        .send({ verdict: 'REJECTED', notes: 'The scan is unreadable' })
        .expect(200);
      expect(res.body).toMatchObject({
        id: rejected,
        status: 'REJECTED',
        downloadable: false,
        review: {
          verdict: 'REJECTED',
          reason: 'The scan is unreadable',
          notes: 'The scan is unreadable',
          reviewedByUserId: w.soA.user.id,
        },
      });
      const applicantView = await api(w.owner)
        .get(`${base(a)}/documents`)
        .expect(200);
      expect(applicantView.body[0].review).toMatchObject({
        verdict: 'REJECTED',
        reason: 'The scan is unreadable',
      });
      expect(applicantView.body[0].review).not.toHaveProperty(
        'reviewedByUserId',
      );
      expect(applicantView.body[0].review).not.toHaveProperty('notes');
      const reqs = await api(w.owner)
        .get(`${base(a)}/document-requirements`)
        .expect(200);
      expect(reqs.body.find((r: { id: string }) => r.id === M).satisfied).toBe(
        false,
      );
      const [event] = await audits(rejected, 'DOCUMENT_REJECTED_BY_OFFICER');
      expect(event).toMatchObject({
        userId: w.soA.user.id,
        roleAtTime: 'SCHEME_OFFICER',
        entityType: 'Document',
      });
      expect(event.afterState).toMatchObject({
        schemeApplicationId: a.id,
        schemeId: scheme.id,
        departmentId: w.deptA.id,
        verdict: 'REJECTED',
      });
      // reviewed once
      const again = await api(w.soA)
        .post(`${OFFICER}/${a.id}/documents/${rejected}/review`)
        .send({ verdict: 'VERIFIED' })
        .expect(409);
      expect(errorCode(again)).toBe('DOCUMENT_NOT_REVIEWABLE');
    });

    it('cannot approve while a mandatory document has no usable evidence - naming it - but the optional one never blocks', async () => {
      const res = await officerAct(a.id, 'decision', {
        outcome: 'APPROVE',
        reason: 'Approve anyway',
      }).expect(409);
      expect(errorCode(res)).toBe('SCHEME_EVIDENCE_INCOMPLETE');
      expect(res.body.error.message).toContain('Mandatory proof');
      expect(res.body.error.message).not.toContain('Optional proof');
      expect(
        (
          await ctx.prisma.schemeApplication.findUniqueOrThrow({
            where: { id: a.id },
          })
        ).status,
      ).toBe('UNDER_REVIEW');
    });

    it('the applicant replaces the rejected document while it is under review; the officer verifies the new version', async () => {
      const v2 = await upload(a, {
        path: `documents/${rejected}/replace`,
        file: pdfBytes('replacement'),
      }).expect(201);
      accepted = v2.body.id;
      expect(v2.body).toMatchObject({
        version: 2,
        isCurrent: true,
        requirement: { id: M },
      });
      // the superseded, rejected version cannot be reviewed again
      await api(w.soA)
        .post(`${OFFICER}/${a.id}/documents/${rejected}/review`)
        .send({ verdict: 'VERIFIED' })
        .expect(409);
      const verified = await api(w.soA)
        .post(`${OFFICER}/${a.id}/documents/${accepted}/review`)
        .send({
          verdict: 'VERIFIED',
          notes: 'Internal note',
          validUntil: '2099-06-30',
        })
        .expect(200);
      expect(verified.body).toMatchObject({
        status: 'VERIFIED',
        review: { verdict: 'VERIFIED', reason: null, notes: 'Internal note' },
      });
      // verification notes are internal to the officer
      const applicantView = await api(w.owner)
        .get(`${base(a)}/documents`)
        .expect(200);
      expect(applicantView.body[0].review).toMatchObject({
        verdict: 'VERIFIED',
        reason: null,
      });
      expect(JSON.stringify(applicantView.body)).not.toContain('Internal note');
      expect(await audits(accepted, 'DOCUMENT_VERIFIED')).toHaveLength(1);
    });

    it('approves once every mandatory requirement is satisfied', async () => {
      const res = await officerAct(a.id, 'decision', {
        outcome: 'APPROVE',
        reason: 'Evidence complete',
      }).expect(200);
      expect(res.body.status).toBe('APPROVED');
    });

    it('closes the evidence once decided: no upload, replacement or review', async () => {
      const upl = await upload(
        a,
        forRequirement(O, { file: pdfBytes() }),
      ).expect(409);
      expect(errorCode(upl)).toBe('SCHEME_EVIDENCE_LOCKED');
      const rep = await upload(a, {
        path: `documents/${accepted}/replace`,
        file: pdfBytes(),
      }).expect(409);
      expect(errorCode(rep)).toBe('SCHEME_EVIDENCE_LOCKED');
      const rev = await api(w.soA)
        .post(`${OFFICER}/${a.id}/documents/${accepted}/review`)
        .send({ verdict: 'REJECTED', notes: 'Too late' })
        .expect(409);
      expect(errorCode(rev)).toBe('DOCUMENT_NOT_REVIEWABLE');
      // reading and downloading still work
      await getBytes(
        api(w.owner).get(`${base(a)}/documents/${accepted}/download`),
      ).expect(200);
      const view = await api(w.owner).get(base(a)).expect(200);
      expect(view.body.evidenceEditable).toBe(false);
    });

    it('a rejection is never blocked by missing evidence', async () => {
      const b = await fresh();
      await officerAct(b.id, 'start-review').expect(200);
      const res = await officerAct(b.id, 'decision', {
        outcome: 'REJECT',
        reason: 'No evidence provided',
      }).expect(200);
      expect(res.body.status).toBe('REJECTED');
    });

    it('evidence may be added while the application is only APPLIED, before any review starts', async () => {
      const b = await fresh();
      await upload(b, forRequirement(M, { file: pdfBytes('early') })).expect(
        201,
      );
      // ...and the officer sees it once they start
      await officerAct(b.id, 'start-review').expect(200);
      const list = await api(w.soA)
        .get(`${OFFICER}/${b.id}/documents`)
        .expect(200);
      expect(list.body).toHaveLength(1);
      const reqs = await api(w.soA)
        .get(`${OFFICER}/${b.id}/document-requirements`)
        .expect(200);
      expect(reqs.body.find((r: { id: string }) => r.id === M).satisfied).toBe(
        true,
      );
    });
  });

  describe('the requirement, once used, is part of the record', () => {
    it('cannot be removed once evidence exists (and a published scheme is frozen anyway)', async () => {
      const s = await publishScheme(ctx, w, {
        requirements: [
          { name: 'Used', isMandatory: false },
          { name: 'Unused', isMandatory: false },
        ],
      });
      const a = await fresh(s);
      await upload(
        a,
        forRequirement(s.requirementIds[0], { file: pdfBytes('used') }),
      ).expect(201);
      const frozen = await api(w.soA)
        .del(
          `/scheme-officer/schemes/${s.id}/document-requirements/${s.requirementIds[1]}`,
        )
        .expect(409);
      expect(errorCode(frozen)).toBe('SCHEME_NOT_EDITABLE');
      await api(w.soA)
        .post(`/scheme-officer/schemes/${s.id}/unpublish`)
        .expect(200);
      const inUse = await api(w.soA)
        .del(
          `/scheme-officer/schemes/${s.id}/document-requirements/${s.requirementIds[0]}`,
        )
        .expect(409);
      expect(errorCode(inUse)).toBe('SCHEME_REQUIREMENT_IN_USE');
      await api(w.soA)
        .del(
          `/scheme-officer/schemes/${s.id}/document-requirements/${s.requirementIds[1]}`,
        )
        .expect(204);
    });

    it('PostgreSQL refuses to attach evidence to the wrong application or requirement', async () => {
      const a = await fresh();
      const b = await fresh(other);
      const doc = (
        await upload(a, forRequirement(M, { file: pdfBytes('sql') })).expect(
          201,
        )
      ).body.id;
      const otherProject = await ctx.createProjectVia(
        w.owner.accessToken,
        w.enterpriseId,
        'se-sql',
      );
      // a document of one project cannot be linked to another project's application
      await expect(
        ctx.prisma
          .$executeRaw`INSERT INTO scheme_application_documents (scheme_application_id, document_id) VALUES (${b.id}::uuid, ${doc}::uuid)`,
      ).rejects.toThrow();
      // a requirement of another scheme cannot be answered
      const own = (await upload(b, { file: pdfBytes('own') }).expect(201)).body
        .id;
      await expect(
        ctx.prisma
          .$executeRaw`INSERT INTO scheme_application_documents (scheme_application_id, document_id, scheme_document_requirement_id) VALUES (${b.id}::uuid, ${own}::uuid, ${M}::uuid)`,
      ).rejects.toThrow();
      // and a link is never re-pointed
      await expect(
        ctx.prisma
          .$executeRaw`UPDATE scheme_application_documents SET scheme_document_requirement_id = ${O}::uuid WHERE document_id = ${doc}::uuid`,
      ).rejects.toThrow();
      expect(otherProject.id).toBeDefined();
    });
  });
});
