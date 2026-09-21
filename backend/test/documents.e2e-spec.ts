import { createHash, randomUUID } from 'node:crypto';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import request from 'supertest';
import {
  STORAGE_SERVICE,
  StorageObjectExistsError,
  StorageService,
} from '../src/infrastructure/storage/storage.interface';
import {
  MALWARE_SCANNER,
  MalwareScanner,
  ScannerUnavailableError,
} from '../src/modules/documents/malware-scanner.interface';
import { API, E2eContext, createE2eContext } from './support/e2e-helpers';
import {
  eicarPdf,
  exeBytes,
  jpegBytes,
  pdfBytes,
  pngBytes,
} from './support/document-fixtures';

jest.setTimeout(300_000);

interface Actor {
  user: { id: string; email: string; mobile: string };
  accessToken: string;
}

const sha256 = (data: Buffer) =>
  createHash('sha256').update(data).digest('hex');

/**
 * Document management over real HTTP -> Nest -> Prisma -> PostgreSQL ->
 * local storage: upload validation, scanning (fail closed), requirements,
 * non-destructive versioning, concurrency, historical correctness, download
 * and audit. Authorisation by scope / project restriction is in
 * document-access.e2e-spec.ts.
 */
describe('Documents e2e — upload, scanning, requirements, versioning, retrieval, audit', () => {
  let ctx: E2eContext;
  let owner: Actor;
  let enterpriseId: string;
  let storage: StorageService;
  let scanner: MalwareScanner;
  let putSpy: jest.SpyInstance;
  let deleteSpy: jest.SpyInstance;

  const me = () => ({
    get: (p: string) =>
      request(ctx.http)
        .get(`${API}${p}`)
        .set('Authorization', `Bearer ${owner.accessToken}`),
    post: (p: string) =>
      request(ctx.http)
        .post(`${API}${p}`)
        .set('Authorization', `Bearer ${owner.accessToken}`),
    put: (p: string) =>
      request(ctx.http)
        .put(`${API}${p}`)
        .set('Authorization', `Bearer ${owner.accessToken}`),
    patch: (p: string) =>
      request(ctx.http)
        .patch(`${API}${p}`)
        .set('Authorization', `Bearer ${owner.accessToken}`),
    del: (p: string) =>
      request(ctx.http)
        .delete(`${API}${p}`)
        .set('Authorization', `Bearer ${owner.accessToken}`),
  });

  interface Draft {
    projectId: string;
    applicationId: string;
    approvalTypeId: string;
    requirementId?: string;
  }
  const appBase = (d: Draft) =>
    `/enterprises/${enterpriseId}/projects/${d.projectId}/applications/${d.applicationId}`;
  const docsUrl = (d: Draft, suffix = '') => `${appBase(d)}/documents${suffix}`;

  /** A fresh project + approval + application, optionally with one configured
   * document requirement. */
  const draft = async (
    tag: string,
    requirement?: {
      isMandatory?: boolean;
      allowedMimeTypes?: string[];
      maxSizeBytes?: number | null;
    },
  ): Promise<Draft> => {
    const project = await ctx.createProjectVia(
      owner.accessToken,
      enterpriseId,
      tag,
    );
    const approval = await ctx.createStartableApproval(owner.user.id, tag);
    let requirementId: string | undefined;
    if (requirement) {
      // Configured BEFORE the application exists, so its derived status
      // already reflects the requirement.
      const r = await ctx.prisma.documentRequirement.create({
        data: {
          approvalTypeId: approval.approvalTypeId,
          name: `E2E requirement ${tag}`,
          isMandatory: requirement.isMandatory ?? true,
          allowedMimeTypes: requirement.allowedMimeTypes ?? [],
          maxSizeBytes: requirement.maxSizeBytes ?? null,
        },
      });
      requirementId = r.id;
    }
    const snapshotId = await ctx.discover(
      owner.accessToken,
      enterpriseId,
      project.id,
    );
    const created = await me()
      .post(`/enterprises/${enterpriseId}/projects/${project.id}/applications`)
      .send({
        approvalTypeId: approval.approvalTypeId,
        discoverySnapshotId: snapshotId,
      })
      .expect(201);
    return {
      projectId: project.id,
      applicationId: created.body.id,
      approvalTypeId: approval.approvalTypeId,
      requirementId,
    };
  };

  const upload = (
    d: Draft,
    file: Buffer | null,
    options: Parameters<E2eContext['uploadDocument']>[5] = {},
  ) =>
    ctx.uploadDocument(
      owner.accessToken,
      enterpriseId,
      d.projectId,
      d.applicationId,
      file,
      options,
    );
  const uploadFor = (
    d: Draft,
    file: Buffer,
    extra: Record<string, string> = {},
  ) =>
    upload(d, file, {
      fields: {
        ...(d.requirementId ? { documentRequirementId: d.requirementId } : {}),
        ...extra,
      },
    });
  const replace = (
    d: Draft,
    documentId: string,
    file: Buffer | null,
    options: Parameters<E2eContext['uploadDocument']>[5] = {},
  ) =>
    ctx.uploadDocument(
      owner.accessToken,
      enterpriseId,
      d.projectId,
      d.applicationId,
      file,
      { ...options, path: `documents/${documentId}/replace` },
    );

  const dbDoc = (id: string) =>
    ctx.prisma.document.findUniqueOrThrow({ where: { id } });
  const docCount = (d: Draft) =>
    ctx.prisma.applicationDocument.count({
      where: { applicationId: d.applicationId },
    });
  const dbApp = (id: string) =>
    ctx.prisma.approvalApplication.findUniqueOrThrow({ where: { id } });
  const submit = (d: Draft) =>
    me()
      .post(`${appBase(d)}/submit`)
      .send({ declarationAccepted: true });
  const events = (entityId: string) =>
    ctx.prisma.auditLog.findMany({
      where: { entityId },
      orderBy: { createdAt: 'asc' },
    });

  beforeAll(async () => {
    ctx = await createE2eContext();
    owner = await ctx.applicantSession('doc-owner');
    enterpriseId = (await ctx.createEnterprise(owner.accessToken, 'doc')).id;
    storage = ctx.app.get<StorageService>(STORAGE_SERVICE);
    scanner = ctx.app.get<MalwareScanner>(MALWARE_SCANNER);
  });

  beforeEach(() => {
    putSpy = jest.spyOn(storage, 'put');
    deleteSpy = jest.spyOn(storage, 'delete');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await ctx.cleanup();
    await ctx.app.close();
  });

  // -------------------------------------------------------------------------
  describe('upload', () => {
    it('stores a valid PDF: scanned, associated, owned by the project, no path exposed', async () => {
      const d = await draft('valid');
      const bytes = pdfBytes();
      const res = await upload(d, bytes, { filename: 'Site plan.pdf' }).expect(
        201,
      );

      expect(res.body).toMatchObject({
        applicationId: d.applicationId,
        version: 1,
        isCurrent: true,
        previousVersionId: null,
        replacedByVersionId: null,
        requirement: null,
        originalFilename: 'Site plan.pdf',
        mimeType: 'application/pdf',
        sizeBytes: bytes.length,
        status: 'VALIDATION_PENDING',
        expiryDate: null,
        scan: { state: 'CLEAN', scanner: 'DEV_MOCK_EICAR' },
        downloadable: true,
        uploadedByUserId: owner.user.id,
      });
      expect(res.body.scan.scannedAt).toEqual(expect.any(String));

      const row = await dbDoc(res.body.id);
      expect(row).toMatchObject({
        ownerType: 'PROJECT',
        ownerId: d.projectId,
        documentRequirementId: null,
        status: 'VALIDATION_PENDING',
        version: 1,
        replacedDocumentId: null,
        uploadedBy: owner.user.id,
        scannerName: 'DEV_MOCK_EICAR',
        checksum: sha256(bytes),
        mimeType: 'application/pdf',
      });
      expect(row.scannedAt).not.toBeNull();
      expect(row.lineageId).toBe(res.body.lineageId);

      // Stored under a server-generated key that has nothing to do with the name.
      expect(row.filePath).toMatch(/^documents\/\d{4}\/[0-9a-f-]{36}$/);
      expect(row.filePath.toLowerCase()).not.toContain('site');
      expect(await storage.get(row.filePath)).toEqual(bytes);
      expect(await docCount(d)).toBe(1);

      // The response never carries storage internals or the checksum.
      const serialised = JSON.stringify(res.body);
      expect(serialised).not.toContain(row.filePath);
      expect(res.body).not.toHaveProperty('filePath');
      expect(res.body).not.toHaveProperty('checksum');
      expect(res.body).not.toHaveProperty('storageKey');
      expect(serialised).not.toContain(row.checksum);
    });

    it('accepts PNG and JPEG, and records the DETECTED type even when the client says octet-stream', async () => {
      const d = await draft('types');
      const png = await upload(d, pngBytes(), {
        filename: 'photo.PNG',
        contentType: 'application/octet-stream',
      }).expect(201);
      expect(png.body.mimeType).toBe('image/png');
      const jpg = await upload(d, jpegBytes(), {
        filename: 'photo.jpeg',
        contentType: 'image/jpg',
      }).expect(201);
      expect(jpg.body.mimeType).toBe('image/jpeg');
    });

    it('keeps a non-ASCII original filename intact (metadata only)', async () => {
      const d = await draft('unicode');
      const res = await upload(d, pdfBytes(), {
        filename: 'आधार कार्ड.pdf',
      }).expect(201);
      expect(res.body.originalFilename).toBe('आधार कार्ड.pdf');
      expect((await dbDoc(res.body.id)).filePath).not.toContain('आधार');
    });

    it('records an expiry date when given, and never guesses one', async () => {
      const d = await draft('expiry');
      const withDate = await upload(d, pdfBytes(), {
        fields: { expiryDate: '2099-12-31' },
      }).expect(201);
      expect(withDate.body.expiryDate).toBe('2099-12-31');
      const without = await upload(d, pdfBytes()).expect(201);
      expect(without.body.expiryDate).toBeNull();
    });

    describe('file validation', () => {
      const rejected = async (
        d: Draft,
        file: Buffer | null,
        options: Parameters<E2eContext['uploadDocument']>[5],
        status: number,
        code: string,
      ) => {
        const before = await docCount(d);
        const res = await upload(d, file, options);
        expect(res.status).toBe(status);
        expect(res.body.error.code).toBe(code);
        expect(res.body.error.message).toEqual(expect.any(String));
        // Nothing scanned-and-kept: no object written, no row, no link.
        expect(putSpy).not.toHaveBeenCalled();
        expect(await docCount(d)).toBe(before);
        return res;
      };

      it('rejects an executable disguised as a PDF (content wins over name/type)', async () => {
        const d = await draft('exe');
        await rejected(
          d,
          exeBytes(),
          { filename: 'invoice.pdf', contentType: 'application/pdf' },
          415,
          'UNSUPPORTED_TYPE',
        );
      });

      it.each([
        ['plain text', Buffer.from('just some text\n'), 'notes.pdf'],
        [
          'an HTML page',
          Buffer.from('<html><script>alert(1)</script></html>'),
          'page.pdf',
        ],
        ['a ZIP archive', Buffer.from('PK\u0003\u0004rest'), 'bundle.pdf'],
      ])('rejects %s named .pdf', async (_l, bytes, filename) => {
        const d = await draft('nonsupported');
        await rejected(d, bytes, { filename }, 415, 'UNSUPPORTED_TYPE');
      });

      it('rejects an extension that does not match the content', async () => {
        const d = await draft('extmismatch');
        await rejected(
          d,
          pdfBytes(),
          { filename: 'scan.png', contentType: 'image/png' },
          422,
          'MIME_TYPE_MISMATCH',
        );
      });

      it('rejects a declared content type that contradicts the bytes', async () => {
        const d = await draft('declmismatch');
        await rejected(
          d,
          pdfBytes(),
          { filename: 'scan.pdf', contentType: 'image/png' },
          422,
          'MIME_TYPE_MISMATCH',
        );
      });

      it('rejects an empty file', async () => {
        const d = await draft('empty');
        await rejected(d, Buffer.alloc(0), {}, 400, 'FILE_EMPTY');
      });

      it.each([
        [
          'a truncated PDF',
          Buffer.from('%PDF-1.4\n1 0 obj\n<< /Broken'),
          'a.pdf',
          'application/pdf',
        ],
        ['a truncated PNG', pngBytes().subarray(0, 40), 'a.png', 'image/png'],
        [
          'a truncated JPEG',
          Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]),
          'a.jpg',
          'image/jpeg',
        ],
      ])('rejects %s as corrupt', async (_l, bytes, filename, contentType) => {
        const d = await draft('corrupt');
        await rejected(
          d,
          bytes,
          { filename, contentType },
          422,
          'CORRUPT_FILE',
        );
      });

      it('rejects a file over the platform ceiling (10 MiB) at the parser, as FILE_TOO_LARGE', async () => {
        const d = await draft('toolarge');
        const huge = Buffer.concat([
          pdfBytes(),
          Buffer.alloc(10 * 1024 * 1024 + 1024, 0x20),
        ]);
        const res = await upload(d, huge);
        expect(res.status).toBe(413);
        expect(res.body.error.code).toBe('FILE_TOO_LARGE');
        expect(putSpy).not.toHaveBeenCalled();
        expect(await docCount(d)).toBe(0);
      });

      it('accepts a file exactly at the ceiling', async () => {
        const d = await draft('atceiling');
        const head = pdfBytes();
        const atLimit = Buffer.concat([
          head,
          Buffer.alloc(10 * 1024 * 1024 - head.length, 0x20),
        ]);
        expect(atLimit.length).toBe(10 * 1024 * 1024);
        await upload(d, atLimit).expect(201);
      });

      it('rejects a request with no file part', async () => {
        const d = await draft('nofile');
        await rejected(d, null, {}, 400, 'FILE_REQUIRED');
      });

      it('rejects a file sent under the wrong field name', async () => {
        const d = await draft('wrongfield');
        const res = await request(ctx.http)
          .post(`${API}${docsUrl(d)}`)
          .set('Authorization', `Bearer ${owner.accessToken}`)
          .attach('attachment', pdfBytes(), 'a.pdf');
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('BAD_REQUEST');
        expect(putSpy).not.toHaveBeenCalled();
      });

      it('rejects a JSON body (not multipart) as a missing file', async () => {
        const d = await draft('jsonbody');
        const res = await me().post(docsUrl(d)).send({});
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('FILE_REQUIRED');
      });

      it('rejects more than one file', async () => {
        const d = await draft('twofiles');
        const res = await request(ctx.http)
          .post(`${API}${docsUrl(d)}`)
          .set('Authorization', `Bearer ${owner.accessToken}`)
          .attach('file', pdfBytes(), 'a.pdf')
          .attach('file', pdfBytes(), 'b.pdf');
        expect(res.status).toBe(400);
        expect(putSpy).not.toHaveBeenCalled();
        expect(await docCount(d)).toBe(0);
      });

      it.each([
        ['a relative traversal', '../../etc/passwd.pdf'],
        ['a backslash traversal', '..\\..\\windows\\system32\\x.pdf'],
        ['an absolute POSIX path', '/etc/passwd.pdf'],
        ['a Windows drive path', 'C:\\Windows\\evil.pdf'],
        ['a drive-relative name', 'C:evil.pdf'],
        ['a double extension', 'invoice.exe.pdf'],
        ['a script extension', 'run.sh.pdf'],
        ['a hidden name', '.pdf'],
        ['a trailing dot', 'report.pdf.'],
        ['a double dot', 'report..pdf'],
        ['no extension', 'report'],
        ['a reserved device name', 'NUL.pdf'],
        ['a control character', 'a\tb.pdf'],
        ['a bidirectional override', 'invoice\u202Efdp.pdf'],
        ['an over-long name', `${'a'.repeat(300)}.pdf`],
      ])('rejects an unsafe filename: %s', async (_l, filename) => {
        const d = await draft('unsafename');
        await rejected(
          d,
          pdfBytes(),
          { filename, raw: true },
          422,
          'INVALID_FILENAME',
        );
      });

      it('never lets a filename influence where the file is stored', async () => {
        const d = await draft('keyindep');
        const res = await upload(d, pdfBytes(), {
          filename: 'a.b.pdf',
        }).expect(201);
        const row = await dbDoc(res.body.id);
        expect(putSpy).toHaveBeenCalledWith(row.filePath, expect.any(Buffer), {
          overwrite: false,
        });
        expect(row.filePath).not.toMatch(/a\.b/);
      });
    });

    describe('metadata validation', () => {
      it.each([
        ['a non-uuid requirement id', { documentRequirementId: 'nope' }],
        ['a malformed expiry date', { expiryDate: '31-12-2026' }],
        ['an impossible expiry date', { expiryDate: '2026-02-30' }],
        ['an expiry with a time', { expiryDate: '2026-12-31T10:00:00Z' }],
      ])('rejects %s with field errors', async (_l, fields) => {
        const d = await draft('meta');
        const res = await upload(d, pdfBytes(), { fields });
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
        expect(putSpy).not.toHaveBeenCalled();
        expect(await docCount(d)).toBe(0);
      });

      it.each([
        'applicationId',
        'projectId',
        'enterpriseId',
        'ownerId',
        'ownerType',
        'uploadedBy',
        'status',
        'scanStatus',
        'scannedAt',
        'filePath',
        'storageKey',
        'checksum',
        'version',
        'lineageId',
        'mimeType',
      ])('refuses the client-supplied field %s', async (field) => {
        const d = await draft(`client-${field}`);
        const res = await upload(d, pdfBytes(), {
          fields: { [field]: randomUUID() },
        });
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
        expect(putSpy).not.toHaveBeenCalled();
        expect(await docCount(d)).toBe(0);
      });

      it('refuses a requirement that belongs to another approval, and one that does not exist', async () => {
        const d = await draft('req-mismatch');
        const other = await draft('req-other', { isMandatory: true });
        for (const documentRequirementId of [
          other.requirementId!,
          randomUUID(),
        ]) {
          const res = await upload(d, pdfBytes(), {
            fields: { documentRequirementId },
          }).expect(422);
          expect(res.body.error.code).toBe('DOCUMENT_REQUIREMENT_MISMATCH');
        }
        expect(putSpy).not.toHaveBeenCalled();
        expect(await docCount(d)).toBe(0);
      });
    });

    describe('scanning boundary', () => {
      it('rejects an infected file: 422, never stored, no row, audited on the application', async () => {
        const d = await draft('infected');
        const before = await dbApp(d.applicationId);
        const res = await upload(d, eicarPdf(), {
          filename: 'contract.pdf',
        }).expect(422);
        expect(res.body.error.code).toBe('MALWARE_DETECTED');
        expect(JSON.stringify(res.body)).not.toMatch(/EICAR/i);

        expect(putSpy).not.toHaveBeenCalled();
        expect(await docCount(d)).toBe(0);
        expect(
          await ctx.prisma.document.count({
            where: {
              uploadedBy: owner.user.id,
              originalFilename: 'contract.pdf',
            },
          }),
        ).toBe(0);
        const after = await dbApp(d.applicationId);
        expect(after.updatedAt).toEqual(before.updatedAt);

        const audit = (await events(d.applicationId)).filter(
          (e) => e.action === 'DOCUMENT_SCAN_REJECTED',
        );
        expect(audit).toHaveLength(1);
        expect(audit[0].afterState).toMatchObject({
          enterpriseId,
          projectId: d.projectId,
          applicationId: d.applicationId,
          actingAs: 'OWNER',
          originalFilename: 'contract.pdf',
          stored: false,
          scanner: 'DEV_MOCK_EICAR',
          signature: 'EICAR-Test-File',
        });
        expect(audit[0].userId).toBe(owner.user.id);
      });

      it('fails CLOSED when the scanner is unavailable: 503, nothing stored, audited', async () => {
        const d = await draft('scanner-down');
        jest
          .spyOn(scanner, 'scan')
          .mockRejectedValueOnce(new ScannerUnavailableError());
        const res = await upload(d, pdfBytes()).expect(503);
        expect(res.body.error.code).toBe('SCANNER_UNAVAILABLE');
        expect(putSpy).not.toHaveBeenCalled();
        expect(await docCount(d)).toBe(0);
        const audit = (await events(d.applicationId)).filter(
          (e) => e.action === 'DOCUMENT_SCAN_FAILED',
        );
        expect(audit).toHaveLength(1);
        expect(audit[0].afterState).toMatchObject({ stored: false });

        // ...and once the scanner is back, the same upload succeeds.
        await upload(d, pdfBytes()).expect(201);
      });

      it('treats a crashing scanner and an unrecognised verdict as failures, never as clean', async () => {
        const d = await draft('scanner-weird');
        jest
          .spyOn(scanner, 'scan')
          .mockRejectedValueOnce(new Error('socket hang up'));
        await upload(d, pdfBytes()).expect(503);
        jest.spyOn(scanner, 'scan').mockResolvedValueOnce({
          verdict: 'MAYBE' as never,
          scannerName: 'BROKEN',
        });
        const res = await upload(d, pdfBytes()).expect(503);
        expect(res.body.error.code).toBe('SCANNER_UNAVAILABLE');
        expect(putSpy).not.toHaveBeenCalled();
        expect(await docCount(d)).toBe(0);
      });

      it('runs the scan on the exact bytes that get stored, and records who scanned', async () => {
        const d = await draft('scan-args');
        const scanSpy = jest.spyOn(scanner, 'scan');
        const bytes = pdfBytes();
        const res = await upload(d, bytes, { filename: 'a.pdf' }).expect(201);
        expect(scanSpy).toHaveBeenCalledTimes(1);
        expect(scanSpy.mock.calls[0][0]).toEqual(bytes);
        expect(scanSpy.mock.calls[0][1]).toEqual({ filename: 'a.pdf' });
        const row = await dbDoc(res.body.id);
        expect(row.scannerName).toBe(scanner.name);
        expect(scanner.name).toBe('DEV_MOCK_EICAR');
        const clean = (await events(res.body.id)).filter(
          (e) => e.action === 'DOCUMENT_SCAN_COMPLETED',
        );
        expect(clean).toHaveLength(1);
        expect(clean[0].afterState).toMatchObject({
          scanner: 'DEV_MOCK_EICAR',
          verdict: 'CLEAN',
        });
      });

      it('a document that was never scanned, or was rejected, is inaccessible — and satisfies nothing', async () => {
        const d = await draft('unscanned', { isMandatory: true });
        const fixture = (
          status: 'SCAN_PENDING' | 'REJECTED' | 'UPLOADED',
          scanned: boolean,
        ) =>
          ctx.prisma.document.create({
            data: {
              ownerType: 'PROJECT',
              ownerId: d.projectId,
              documentRequirementId: d.requirementId,
              filePath: `documents/fixture/${randomUUID()}`,
              checksum: 'x',
              originalFilename: 'fixture.pdf',
              mimeType: 'application/pdf',
              sizeBytes: 1,
              status,
              scannedAt: scanned ? new Date() : null,
              uploadedBy: owner.user.id,
              applicationDocuments: {
                create: { applicationId: d.applicationId },
              },
            },
          });
        for (const [status, scanned] of [
          ['SCAN_PENDING', false],
          ['UPLOADED', false],
          ['REJECTED', true],
        ] as const) {
          const row = await fixture(status, scanned);
          const meta = await me()
            .get(docsUrl(d, `/${row.id}`))
            .expect(200);
          expect(meta.body.downloadable).toBe(false);
          const res = await me()
            .get(docsUrl(d, `/${row.id}/download`))
            .expect(409);
          expect(res.body.error.code).toBe('DOCUMENT_NOT_AVAILABLE');
          await ctx.prisma.applicationDocument.deleteMany({
            where: { documentId: row.id },
          });
          await ctx.prisma.document.delete({ where: { id: row.id } });
        }
        expect(
          await ctx.prisma.applicationDocument.count({
            where: { applicationId: d.applicationId },
          }),
        ).toBe(0);
      });
    });

    describe('storage boundary', () => {
      it('reports a storage failure as 503, with no row, no link and no leaked detail', async () => {
        const d = await draft('storage-down');
        putSpy.mockRejectedValueOnce(
          new Error('EACCES: permission denied, open /var/secret/x'),
        );
        const res = await upload(d, pdfBytes()).expect(503);
        expect(res.body.error.code).toBe('STORAGE_UNAVAILABLE');
        expect(JSON.stringify(res.body)).not.toMatch(/EACCES|secret|\/var/);
        expect(await docCount(d)).toBe(0);
        expect((await dbApp(d.applicationId)).internalState).toBe('DRAFT');
      });

      it('never overwrites: a key collision is a storage failure, not a silent replace', async () => {
        const d = await draft('collision');
        putSpy.mockRejectedValueOnce(new StorageObjectExistsError());
        const res = await upload(d, pdfBytes()).expect(503);
        expect(res.body.error.code).toBe('STORAGE_UNAVAILABLE');
        expect(await docCount(d)).toBe(0);
      });

      it('removes the stored object again when the database step fails (no orphans)', async () => {
        const d = await draft('db-fail');
        jest
          .spyOn(ctx.prisma, '$transaction')
          .mockRejectedValueOnce(new Error('connection lost'));
        const res = await upload(d, pdfBytes()).expect(500);
        expect(res.body.error.code).toBe('INTERNAL_ERROR');
        const key = putSpy.mock.calls[0][0] as string;
        expect(deleteSpy).toHaveBeenCalledWith(key);
        expect(await storage.exists(key)).toBe(false);
        expect(await docCount(d)).toBe(0);
      });

      it('writes with overwrite disabled (every upload uses a fresh generated key)', async () => {
        const d = await draft('nooverwrite');
        const a = await upload(d, pdfBytes()).expect(201);
        const b = await upload(d, pdfBytes()).expect(201);
        const keys = putSpy.mock.calls.map((c) => c[0] as string);
        expect(new Set(keys).size).toBe(2);
        for (const call of putSpy.mock.calls) {
          expect(call[2]).toEqual({ overwrite: false });
        }
        expect((await dbDoc(a.body.id)).filePath).not.toBe(
          (await dbDoc(b.body.id)).filePath,
        );
      });
    });
  });

  // -------------------------------------------------------------------------
  describe('document requirements', () => {
    it('lists NO requirements when nothing is configured, and never fabricates one', async () => {
      const d = await draft('no-config');
      const res = await me()
        .get(`${appBase(d)}/document-requirements`)
        .expect(200);
      expect(res.body).toEqual([]);
      const validation = await me()
        .post(`${appBase(d)}/pre-validate`)
        .expect(200);
      expect(validation.body).toMatchObject({
        missingDocuments: [],
        readyForSubmission: true,
      });
      // Submission needs no document at all.
      await submit(d).expect(200);
    });

    it('a configured mandatory requirement is unsatisfied, blocks, then is satisfied by an upload', async () => {
      const d = await draft('mandatory', { isMandatory: true });
      const optional = await ctx.prisma.documentRequirement.create({
        data: {
          approvalTypeId: d.approvalTypeId,
          name: 'E2E optional supporting',
          isMandatory: false,
        },
      });

      const before = await me()
        .get(`${appBase(d)}/document-requirements`)
        .expect(200);
      expect(before.body).toHaveLength(2);
      const mandatory = before.body.find(
        (r: { id: string }) => r.id === d.requirementId,
      );
      expect(mandatory).toMatchObject({
        isMandatory: true,
        satisfied: false,
        currentDocument: null,
        acceptedMimeTypes: ['application/pdf', 'image/jpeg', 'image/png'],
        maxSizeBytes: 10 * 1024 * 1024,
      });
      expect(
        before.body.find((r: { id: string }) => r.id === optional.id)
          .isMandatory,
      ).toBe(false);

      expect(
        (
          await me()
            .get(`${appBase(d)}`)
            .expect(200)
        ).body.applicantStatus,
      ).toBe('DRAFT');
      const blocked = await submit(d).expect(422);
      expect(blocked.body.error.fields.documents).toEqual([
        'Missing mandatory document: E2E requirement mandatory',
      ]);

      const res = await uploadFor(d, pdfBytes()).expect(201);
      expect(res.body.requirement).toMatchObject({
        id: d.requirementId,
        isMandatory: true,
      });
      const after = await me()
        .get(`${appBase(d)}/document-requirements`)
        .expect(200);
      expect(
        after.body.find((r: { id: string }) => r.id === d.requirementId),
      ).toMatchObject({
        satisfied: true,
        currentDocument: { id: res.body.id, version: 1 },
      });
      // The derived applicant status followed the document.
      expect(
        (
          await me()
            .get(`${appBase(d)}`)
            .expect(200)
        ).body.applicantStatus,
      ).toBe('READY_TO_SUBMIT');
      await submit(d).expect(200);
    });

    it('an optional requirement never blocks submission', async () => {
      const d = await draft('optional', { isMandatory: false });
      const validation = await me()
        .post(`${appBase(d)}/pre-validate`)
        .expect(200);
      expect(validation.body.readyForSubmission).toBe(true);
      await submit(d).expect(200);
    });

    it('a requirement holds ONE document chain: a second first-upload must replace instead', async () => {
      const d = await draft('one-per-req', { isMandatory: true });
      await uploadFor(d, pdfBytes()).expect(201);
      const res = await uploadFor(d, pdfBytes()).expect(409);
      expect(res.body.error.code).toBe('REQUIREMENT_ALREADY_HAS_DOCUMENT');
      expect(await docCount(d)).toBe(1);
    });

    it('two simultaneous uploads for the same requirement: exactly one wins, no orphaned object', async () => {
      const d = await draft('req-race', { isMandatory: true });
      const results = await Promise.all([
        uploadFor(d, pdfBytes()),
        uploadFor(d, pdfBytes()),
        uploadFor(d, pdfBytes()),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409]);
      for (const r of results.filter((x) => x.status === 409)) {
        expect(r.body.error.code).toBe('REQUIREMENT_ALREADY_HAS_DOCUMENT');
      }
      expect(await docCount(d)).toBe(1);

      // The losers' stored objects were discarded.
      const winner = await dbDoc(
        results.find((r) => r.status === 201)!.body.id,
      );
      const keys = putSpy.mock.calls.map((c) => c[0] as string);
      expect(keys).toHaveLength(3);
      for (const key of keys) {
        expect(await storage.exists(key)).toBe(key === winner.filePath);
      }
    });

    it('reports the requirement’s narrower type list and size limit (it can only narrow the platform’s)', async () => {
      const d = await draft('req-limits', {
        isMandatory: true,
        allowedMimeTypes: ['application/pdf'],
        maxSizeBytes: 1024,
      });
      const listing = await me()
        .get(`${appBase(d)}/document-requirements`)
        .expect(200);
      expect(listing.body[0]).toMatchObject({
        acceptedMimeTypes: ['application/pdf'],
        maxSizeBytes: 1024,
      });
    });

    it('rejects a type the requirement does not accept, and a file over the requirement’s limit', async () => {
      const d = await draft('req-limits2', {
        isMandatory: true,
        allowedMimeTypes: ['application/pdf'],
        maxSizeBytes: 1024,
      });
      const png = await upload(d, pngBytes(), {
        filename: 'photo.png',
        contentType: 'image/png',
        fields: { documentRequirementId: d.requirementId! },
      }).expect(415);
      expect(png.body.error.code).toBe('UNSUPPORTED_TYPE');

      const big = Buffer.concat([pdfBytes(), Buffer.alloc(2000, 0x20)]);
      const tooBig = await uploadFor(d, big).expect(413);
      expect(tooBig.body.error.code).toBe('FILE_TOO_LARGE');
      expect(putSpy).not.toHaveBeenCalled();
      expect(await docCount(d)).toBe(0);

      // Within both limits it is accepted.
      await uploadFor(d, pdfBytes()).expect(201);
    });

    it('an expired current document blocks submission and satisfies nothing until replaced', async () => {
      const d = await draft('expired', { isMandatory: true });
      const expired = await uploadFor(d, pdfBytes(), {
        expiryDate: '2020-01-01',
      }).expect(201);
      const validation = await me()
        .post(`${appBase(d)}/pre-validate`)
        .expect(200);
      expect(validation.body.readyForSubmission).toBe(false);
      expect(
        validation.body.errors.map((e: { code: string }) => e.code),
      ).toContain('DOCUMENT_EXPIRED');
      expect(validation.body.missingDocuments).toHaveLength(1);
      expect(
        (
          await me()
            .get(`${appBase(d)}/document-requirements`)
            .expect(200)
        ).body[0].satisfied,
      ).toBe(false);
      await submit(d).expect(422);

      await replace(d, expired.body.id, pdfBytes(), {
        fields: { expiryDate: '2099-01-01' },
      }).expect(201);
      const fixed = await me()
        .post(`${appBase(d)}/pre-validate`)
        .expect(200);
      expect(fixed.body.readyForSubmission).toBe(true);
      await submit(d).expect(200);
    });

    it('an officer-rejected current document must be replaced (Replacement Required)', async () => {
      const d = await draft('rejected', { isMandatory: true });
      const doc = await uploadFor(d, pdfBytes()).expect(201);
      // Verification/rejection belongs to a later step; simulate its effect.
      await ctx.prisma.document.update({
        where: { id: doc.body.id },
        data: { status: 'REJECTED' },
      });
      const validation = await me()
        .post(`${appBase(d)}/pre-validate`)
        .expect(200);
      expect(validation.body.readyForSubmission).toBe(false);
      expect(
        validation.body.errors.map((e: { code: string }) => e.code),
      ).toContain('DOCUMENT_REJECTED');
      const blocked = await me()
        .get(docsUrl(d, `/${doc.body.id}/download`))
        .expect(409);
      expect(blocked.body.error.code).toBe('DOCUMENT_NOT_AVAILABLE');

      await replace(d, doc.body.id, pdfBytes()).expect(201);
      expect(
        (
          await me()
            .post(`${appBase(d)}/pre-validate`)
            .expect(200)
        ).body.readyForSubmission,
      ).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  describe('versioning and replacement', () => {
    it('creates v1, then v2 and v3 as NEW rows chained to their predecessor; nothing is overwritten', async () => {
      const d = await draft('chain', { isMandatory: true });
      const bytes = [pdfBytes('one'), pdfBytes('two'), pdfBytes('three')];
      const v1 = await uploadFor(d, bytes[0], {
        expiryDate: '2098-01-01',
      }).expect(201);
      const v2 = await replace(d, v1.body.id, bytes[1], {
        filename: 'second.pdf',
      }).expect(201);
      const v3 = await replace(d, v2.body.id, bytes[2], {
        filename: 'third.pdf',
      }).expect(201);

      expect([v1, v2, v3].map((r) => r.body.version)).toEqual([1, 2, 3]);
      expect(v2.body).toMatchObject({
        previousVersionId: v1.body.id,
        lineageId: v1.body.lineageId,
        requirement: { id: d.requirementId },
        isCurrent: true,
        uploadedByUserId: owner.user.id,
        originalFilename: 'second.pdf',
        expiryDate: null, // not inherited from v1
      });
      expect(v3.body.previousVersionId).toBe(v2.body.id);
      expect(new Set([v1, v2, v3].map((r) => r.body.lineageId)).size).toBe(1);

      // Three distinct rows, three distinct stored objects, all intact.
      const rows = await Promise.all([v1, v2, v3].map((r) => dbDoc(r.body.id)));
      expect(new Set(rows.map((r) => r.filePath)).size).toBe(3);
      for (let i = 0; i < 3; i++) {
        expect(await storage.get(rows[i].filePath)).toEqual(bytes[i]);
        expect(rows[i].checksum).toBe(sha256(bytes[i]));
      }
      expect(rows.every((r) => r.ownerId === d.projectId)).toBe(true);
      expect(await docCount(d)).toBe(3);
    });

    it('lists only the current version by default, everything with includeHistory, and the chain oldest-first', async () => {
      const d = await draft('history-list');
      const v1 = await upload(d, pdfBytes()).expect(201);
      const v2 = await replace(d, v1.body.id, pdfBytes()).expect(201);
      const other = await upload(d, pdfBytes()).expect(201);

      const current = await me().get(docsUrl(d)).expect(200);
      expect(current.body.map((x: { id: string }) => x.id).sort()).toEqual(
        [v2.body.id, other.body.id].sort(),
      );
      const all = await me()
        .get(`${docsUrl(d)}?includeHistory=true`)
        .expect(200);
      expect(all.body).toHaveLength(3);
      const explicit = await me()
        .get(`${docsUrl(d)}?includeHistory=false`)
        .expect(200);
      expect(explicit.body).toHaveLength(2);
      await me()
        .get(`${docsUrl(d)}?includeHistory=maybe`)
        .expect(400);
      await me()
        .get(`${docsUrl(d)}?bogus=1`)
        .expect(400);

      const versions = await me()
        .get(docsUrl(d, `/${v2.body.id}/versions`))
        .expect(200);
      expect(versions.body.map((x: { version: number }) => x.version)).toEqual([
        1, 2,
      ]);
      expect(versions.body[0]).toMatchObject({
        id: v1.body.id,
        isCurrent: false,
        replacedByVersionId: v2.body.id,
      });
      expect(versions.body[1]).toMatchObject({
        id: v2.body.id,
        isCurrent: true,
        previousVersionId: v1.body.id,
        replacedByVersionId: null,
      });
      // The chain is the same whichever version you ask about.
      const fromV1 = await me()
        .get(docsUrl(d, `/${v1.body.id}/versions`))
        .expect(200);
      expect(fromV1.body.map((x: { id: string }) => x.id)).toEqual(
        versions.body.map((x: { id: string }) => x.id),
      );
    });

    it('the previous version stays retrievable, byte-for-byte, after replacement', async () => {
      const d = await draft('history-download');
      const first = pdfBytes('first-content');
      const v1 = await upload(d, first, { filename: 'first.pdf' }).expect(201);
      await replace(d, v1.body.id, pdfBytes('second-content')).expect(201);

      const res = await me()
        .get(docsUrl(d, `/${v1.body.id}/download`))
        .buffer(true)
        .parse((response, cb) => {
          const chunks: Buffer[] = [];
          response.on('data', (c: Buffer) => chunks.push(c));
          response.on('end', () => cb(null, Buffer.concat(chunks)));
        })
        .expect(200);
      expect(res.body).toEqual(first);
      const meta = await me()
        .get(docsUrl(d, `/${v1.body.id}`))
        .expect(200);
      expect(meta.body).toMatchObject({ isCurrent: false, downloadable: true });
    });

    it('only the CURRENT version can be replaced', async () => {
      const d = await draft('not-current');
      const v1 = await upload(d, pdfBytes()).expect(201);
      await replace(d, v1.body.id, pdfBytes()).expect(201);
      const before = await docCount(d);
      const res = await replace(d, v1.body.id, pdfBytes()).expect(409);
      expect(res.body.error.code).toBe('DOCUMENT_NOT_CURRENT');
      expect(await docCount(d)).toBe(before);
    });

    it('a replacement is validated and scanned exactly like an upload, and a failed one changes nothing', async () => {
      const d = await draft('replace-checks');
      const v1 = await upload(d, pdfBytes()).expect(201);
      putSpy.mockClear();

      await replace(d, v1.body.id, exeBytes(), { filename: 'x.pdf' }).expect(
        415,
      );
      await replace(d, v1.body.id, eicarPdf()).expect(422);
      await replace(d, v1.body.id, null).expect(400);
      await replace(d, v1.body.id, pdfBytes(), {
        filename: '../evil.pdf',
        raw: true,
      }).expect(422);
      jest
        .spyOn(scanner, 'scan')
        .mockRejectedValueOnce(new ScannerUnavailableError());
      await replace(d, v1.body.id, pdfBytes()).expect(503);

      expect(putSpy).not.toHaveBeenCalled();
      expect(await docCount(d)).toBe(1);
      const chain = await me()
        .get(docsUrl(d, `/${v1.body.id}/versions`))
        .expect(200);
      expect(chain.body).toHaveLength(1);
      expect(chain.body[0].isCurrent).toBe(true);
    });

    it('cannot replace a document that is not on this application (or does not exist)', async () => {
      const d = await draft('replace-404');
      const other = await draft('replace-404-other');
      const foreign = await upload(other, pdfBytes()).expect(201);
      for (const id of [randomUUID(), foreign.body.id]) {
        const res = await replace(d, id, pdfBytes()).expect(404);
        expect(res.body.error.code).toBe('NOT_FOUND');
      }
      expect(putSpy).not.toHaveBeenCalledTimes(2);
      expect(await docCount(other)).toBe(1);
    });

    it('two simultaneous replacements of the same version: exactly one v2, losers rolled back cleanly', async () => {
      const d = await draft('replace-race', { isMandatory: true });
      const v1 = await uploadFor(d, pdfBytes()).expect(201);
      putSpy.mockClear();

      const results = await Promise.all(
        [1, 2, 3, 4].map(() => replace(d, v1.body.id, pdfBytes())),
      );
      expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409, 409]);
      for (const r of results.filter((x) => x.status === 409)) {
        expect(r.body.error.code).toBe('DOCUMENT_NOT_CURRENT');
      }

      const chain = await ctx.prisma.document.findMany({
        where: { lineageId: v1.body.lineageId },
        orderBy: { version: 'asc' },
      });
      expect(chain.map((c) => c.version)).toEqual([1, 2]);
      expect(chain[1].replacedDocumentId).toBe(v1.body.id);

      // A request that arrives after the winner has committed is refused by the
      // pre-transaction check before it stores anything, so between 1 and 4
      // objects were written. Whatever was written, ONLY the winner's survives.
      const attempted = putSpy.mock.calls.map((c) => c[0] as string);
      expect(attempted.length).toBeGreaterThanOrEqual(1);
      expect(attempted.length).toBeLessThanOrEqual(4);
      expect(attempted).toContain(chain[1].filePath);
      for (const key of attempted) {
        expect(await storage.exists(key)).toBe(key === chain[1].filePath);
      }
      // The requirement is still satisfied, by v2.
      const req = await me()
        .get(`${appBase(d)}/document-requirements`)
        .expect(200);
      expect(req.body[0]).toMatchObject({
        satisfied: true,
        currentDocument: { id: chain[1].id, version: 2 },
      });
    });

    it('simultaneous uploads of unrelated documents all succeed, each in its own chain', async () => {
      const d = await draft('parallel-uploads');
      const results = await Promise.all(
        [1, 2, 3].map(() => upload(d, pdfBytes())),
      );
      expect(results.map((r) => r.status)).toEqual([201, 201, 201]);
      expect(new Set(results.map((r) => r.body.lineageId)).size).toBe(3);
      expect(results.every((r) => r.body.version === 1)).toBe(true);
      expect(await docCount(d)).toBe(3);
    });

    it('a replacement racing a submission never lands on a submitted application', async () => {
      const d = await draft('replace-vs-submit', { isMandatory: true });
      const v1 = await uploadFor(d, pdfBytes()).expect(201);
      const [sub, rep] = await Promise.all([
        submit(d),
        replace(d, v1.body.id, pdfBytes()),
      ]);
      const app = await dbApp(d.applicationId);
      const snapshot = app.submittedDocuments as Array<{
        documentId: string;
        version: number;
      }> | null;
      const chain = await ctx.prisma.document.findMany({
        where: { lineageId: v1.body.lineageId },
        orderBy: { version: 'asc' },
      });
      if (sub.status === 200) {
        // Submission won: the snapshot names exactly the version that was current
        // then, and a replacement that got in first is what it names; one that
        // lost was refused.
        expect(snapshot).toHaveLength(1);
        const head = chain[chain.length - 1];
        expect(snapshot![0]).toMatchObject({
          documentId: head.id,
          version: head.version,
        });
        if (rep.status !== 201) {
          expect([409]).toContain(rep.status);
          expect(chain).toHaveLength(1);
        }
      } else {
        // The replacement won the race; the submission was refused (never
        // applied to a document it did not see) and the draft is intact.
        expect(sub.status).toBe(409);
        expect(rep.status).toBe(201);
        expect(app.internalState).toBe('DRAFT');
        expect(snapshot).toBeNull();
      }
    });

    it('documents can no longer be uploaded or replaced once the application is submitted', async () => {
      const d = await draft('after-submit', { isMandatory: true });
      const v1 = await uploadFor(d, pdfBytes()).expect(201);
      await submit(d).expect(200);
      putSpy.mockClear();

      for (const res of [
        await upload(d, pdfBytes()),
        await replace(d, v1.body.id, pdfBytes()),
      ]) {
        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe('ALREADY_SUBMITTED');
      }
      expect(putSpy).not.toHaveBeenCalled();
      expect(await docCount(d)).toBe(1);
      // Reading and downloading still work.
      await me().get(docsUrl(d)).expect(200);
      await me()
        .get(docsUrl(d, `/${v1.body.id}/download`))
        .expect(200);
    });
  });

  // -------------------------------------------------------------------------
  describe('historical correctness', () => {
    it('a submission records which document versions were used, and later history cannot rewrite it', async () => {
      const d = await draft('historical', { isMandatory: true });
      const v1 = await uploadFor(d, pdfBytes('h1')).expect(201);
      const v2 = await replace(d, v1.body.id, pdfBytes('h2')).expect(201);
      const extra = await upload(d, pngBytes(), {
        filename: 'extra.png',
        contentType: 'image/png',
      }).expect(201);

      const submitted = await submit(d).expect(200);
      const app = await dbApp(d.applicationId);
      const snapshot = app.submittedDocuments as Array<Record<string, unknown>>;
      expect(snapshot).toHaveLength(2);
      const forRequirement = snapshot.find(
        (s) => s.requirementId === d.requirementId,
      )!;
      // The requirement was satisfied by v2 - not v1 - at submission.
      expect(forRequirement).toMatchObject({
        documentId: v2.body.id,
        version: 2,
        lineageId: v1.body.lineageId,
        originalFilename: 'document.pdf',
        mimeType: 'application/pdf',
        scannerName: 'DEV_MOCK_EICAR',
      });
      expect(forRequirement.checksum).toBe((await dbDoc(v2.body.id)).checksum);
      expect(
        snapshot.find((s) => s.documentId === extra.body.id),
      ).toMatchObject({
        version: 1,
        requirementId: null,
      });

      // The submission audit names the versions too.
      const submittedEvent = (await events(d.applicationId)).find(
        (e) => e.action === 'APPLICATION_SUBMITTED',
      )!;
      expect(
        (submittedEvent.afterState as { documents: unknown[] }).documents,
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            documentId: v2.body.id,
            version: 2,
            requirementId: d.requirementId,
          }),
        ]),
      );
      expect(submitted.body.applicantStatus).toBe('SUBMITTED');

      // The chain is still fully retrievable afterwards.
      const chain = await me()
        .get(docsUrl(d, `/${v2.body.id}/versions`))
        .expect(200);
      expect(chain.body.map((x: { version: number }) => x.version)).toEqual([
        1, 2,
      ]);

      // And the snapshot is frozen by PostgreSQL.
      await expect(
        ctx.prisma.approvalApplication.update({
          where: { id: d.applicationId },
          data: { submittedDocuments: [] },
        }),
      ).rejects.toThrow(/permanent once set/);
      expect((await dbApp(d.applicationId)).submittedDocuments).toEqual(
        snapshot,
      );
    });

    it('the requirement was satisfied by each version in turn, on the audit record', async () => {
      const d = await draft('satisfied-audit', { isMandatory: true });
      const v1 = await uploadFor(d, pdfBytes()).expect(201);
      const v2 = await replace(d, v1.body.id, pdfBytes()).expect(201);
      const satisfied = (
        await ctx.prisma.auditLog.findMany({
          where: {
            action: 'DOCUMENT_REQUIREMENT_SATISFIED',
            entityId: { in: [v1.body.id, v2.body.id] },
          },
        })
      ).map((e) => ({
        id: e.entityId,
        state: e.afterState as { version: number; requirementId: string },
      }));
      expect(satisfied).toHaveLength(2);
      for (const s of satisfied) {
        expect(s.state.requirementId).toBe(d.requirementId);
      }
      expect(satisfied.map((s) => s.state.version).sort()).toEqual([1, 2]);
    });

    it('an unsubmitted application has no document snapshot', async () => {
      const d = await draft('no-snapshot');
      await upload(d, pdfBytes()).expect(201);
      expect((await dbApp(d.applicationId)).submittedDocuments).toBeNull();
    });

    describe('enforced by PostgreSQL itself, not only by service code', () => {
      const uploadOne = async (tag: string) => {
        const d = await draft(tag, { isMandatory: true });
        const v1 = await uploadFor(d, pdfBytes()).expect(201);
        const v2 = await replace(d, v1.body.id, pdfBytes()).expect(201);
        return { d, v1: v1.body.id as string, v2: v2.body.id as string };
      };

      it.each([
        ['filePath', { filePath: 'documents/hijack' }],
        ['checksum', { checksum: 'deadbeef' }],
        ['originalFilename', { originalFilename: 'renamed.pdf' }],
        ['mimeType', { mimeType: 'image/png' }],
        ['sizeBytes', { sizeBytes: 1 }],
        ['version', { version: 9 }],
        ['lineageId', { lineageId: randomUUID() }],
        ['ownerId', { ownerId: randomUUID() }],
        ['ownerType', { ownerType: 'ENTERPRISE' as const }],
        ['uploadedBy', { uploadedBy: randomUUID() }],
        ['createdAt', { createdAt: new Date(0) }],
        ['scannedAt', { scannedAt: new Date(0) }],
        ['scannerName', { scannerName: 'FORGED' }],
        ['replacedDocumentId', { replacedDocumentId: null }],
      ])('a stored version’s %s can never change', async (_l, data) => {
        const { v1, v2 } = await uploadOne(`immutable-${_l}`);
        // v2 is the one row that HAS a predecessor to tamper with.
        const id = _l === 'replacedDocumentId' ? v2 : v1;
        const before = await dbDoc(id);
        await expect(
          ctx.prisma.document.update({ where: { id }, data: data as never }),
        ).rejects.toThrow(/document version is immutable/);
        expect(await dbDoc(id)).toEqual(before);
      });

      it('its requirement cannot be re-pointed, but status (a server-side transition) can change', async () => {
        const { d, v2 } = await uploadOne('immutable-req');
        const otherReq = await ctx.prisma.documentRequirement.create({
          data: {
            approvalTypeId: d.approvalTypeId,
            name: 'Other',
            isMandatory: false,
          },
        });
        await expect(
          ctx.prisma.document.update({
            where: { id: v2 },
            data: { documentRequirementId: otherReq.id },
          }),
        ).rejects.toThrow(/immutable/);
        await ctx.prisma.document.update({
          where: { id: v2 },
          data: { status: 'VERIFIED' },
        });
        expect((await dbDoc(v2)).status).toBe('VERIFIED');
      });

      it('an application association cannot be re-pointed', async () => {
        const { d, v1 } = await uploadOne('immutable-link');
        const other = await draft('immutable-link-other');
        await expect(
          ctx.prisma.applicationDocument.update({
            where: {
              applicationId_documentId: {
                applicationId: d.applicationId,
                documentId: v1,
              },
            },
            data: { applicationId: other.applicationId },
          }),
        ).rejects.toThrow(/immutable/);
      });

      it('a version chain must be coherent: no orphan v2, no v1 with a predecessor, no duplicate (lineage, version)', async () => {
        const { d, v1, v2 } = await uploadOne('chain-constraints');
        const base = await dbDoc(v1);
        const clone = (over: Record<string, unknown>) =>
          ctx.prisma.document.create({
            data: {
              ownerType: 'PROJECT',
              ownerId: d.projectId,
              filePath: `documents/fixture/${randomUUID()}`,
              checksum: 'x',
              originalFilename: 'x.pdf',
              mimeType: 'application/pdf',
              sizeBytes: 1,
              uploadedBy: owner.user.id,
              ...over,
            } as never,
          });
        await expect(clone({ version: 2 })).rejects.toThrow(
          /version_chain_check/,
        );
        await expect(
          clone({ version: 1, replacedDocumentId: v1 }),
        ).rejects.toThrow(/version_chain_check/);
        await expect(
          clone({
            version: 2,
            replacedDocumentId: v1,
            lineageId: base.lineageId,
          }),
        ).rejects.toThrow(/lineage_id_version|Unique/i);
        await expect(clone({ filePath: base.filePath })).rejects.toThrow(
          /file_path|Unique/i,
        );
        expect(
          await ctx.prisma.document.count({
            where: { lineageId: base.lineageId },
          }),
        ).toBe(2);
        expect(v2).toBeDefined();
      });

      it('a version that has been replaced cannot be deleted', async () => {
        const { v1 } = await uploadOne('no-delete');
        await expect(
          ctx.prisma.document.delete({ where: { id: v1 } }),
        ).rejects.toThrow(/foreign key|violates|constraint/i);
        expect(await ctx.prisma.document.count({ where: { id: v1 } })).toBe(1);
      });
    });
  });

  // -------------------------------------------------------------------------
  describe('retrieval', () => {
    const rawDownload = (url: string, token = owner.accessToken) =>
      request(ctx.http)
        .get(`${API}${url}`)
        .set('Authorization', `Bearer ${token}`)
        .buffer(true)
        .parse((response, cb) => {
          const chunks: Buffer[] = [];
          response.on('data', (c: Buffer) => chunks.push(c));
          response.on('end', () => cb(null, Buffer.concat(chunks)));
        });

    it('serves the exact bytes as an attachment with safe headers', async () => {
      const d = await draft('download');
      const bytes = pdfBytes('download-me');
      const up = await upload(d, bytes, { filename: 'Site plan.pdf' }).expect(
        201,
      );
      const res = await rawDownload(
        docsUrl(d, `/${up.body.id}/download`),
      ).expect(200);

      expect(res.body).toEqual(bytes);
      expect(res.headers['content-type']).toBe('application/pdf');
      expect(res.headers['content-length']).toBe(String(bytes.length));
      expect(res.headers['content-disposition']).toMatch(/^attachment;/);
      expect(res.headers['content-disposition']).toContain(
        'filename="Site plan.pdf"',
      );
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['cache-control']).toBe('private, no-store');
      const row = await dbDoc(up.body.id);
      for (const value of Object.values(res.headers)) {
        expect(String(value)).not.toContain(row.filePath);
      }
    });

    it('encodes a non-ASCII filename safely in the Content-Disposition header', async () => {
      const d = await draft('download-unicode');
      const up = await upload(d, pdfBytes(), { filename: 'आधार.pdf' }).expect(
        201,
      );
      const res = await rawDownload(
        docsUrl(d, `/${up.body.id}/download`),
      ).expect(200);
      const header = res.headers['content-disposition'] as string;
      expect(header).toContain(
        `filename*=UTF-8''${encodeURIComponent('आधार.pdf')}`,
      );
      expect(header).toMatch(/filename="_+\.pdf"/);
      expect(header).not.toMatch(/[\r\n]/);
    });

    it('a stored object that no longer matches its checksum is refused, not served', async () => {
      const d = await draft('tamper');
      const up = await upload(d, pdfBytes(), {}).expect(201);
      const row = await dbDoc(up.body.id);
      await storage.put(row.filePath, Buffer.from('tampered'), {
        overwrite: true,
      });
      const res = await me()
        .get(docsUrl(d, `/${up.body.id}/download`))
        .expect(500);
      expect(res.body.error.code).toBe('DOCUMENT_INTEGRITY_ERROR');
      expect(JSON.stringify(res.body)).not.toContain(row.filePath);
      expect(JSON.stringify(res.body)).not.toContain('tampered');
    });

    it('a missing stored object is a controlled error with no path detail', async () => {
      const d = await draft('missing-object');
      const up = await upload(d, pdfBytes(), {}).expect(201);
      const row = await dbDoc(up.body.id);
      await storage.delete(row.filePath);
      const res = await me()
        .get(docsUrl(d, `/${up.body.id}/download`))
        .expect(500);
      expect(res.body.error.code).toBe('DOCUMENT_INTEGRITY_ERROR');
      expect(JSON.stringify(res.body)).not.toMatch(
        /ENOENT|storage|documents\//,
      );
    });

    it('a row with a traversal storage key can never read outside the storage root', async () => {
      const d = await draft('bad-key');
      const canaryName = `canary-${ctx.runId}.txt`;
      const canaryPath = join(process.cwd(), canaryName);
      await writeFile(canaryPath, 'TOP-SECRET-CANARY');
      try {
        for (const key of [
          `../${canaryName}`,
          `documents/../../${canaryName}`,
          canaryPath,
          '..\\canary.txt',
          `documents/x\0/../../${canaryName}`,
        ]) {
          const row = await ctx.prisma.document
            .create({
              data: {
                ownerType: 'PROJECT',
                ownerId: d.projectId,
                filePath: key,
                checksum: sha256(Buffer.from('TOP-SECRET-CANARY')),
                originalFilename: 'evil.pdf',
                mimeType: 'application/pdf',
                sizeBytes: 17,
                status: 'VALIDATION_PENDING',
                scannedAt: new Date(),
                scannerName: 'FIXTURE',
                uploadedBy: owner.user.id,
                applicationDocuments: {
                  create: { applicationId: d.applicationId },
                },
              },
            })
            .catch(() => null);
          if (!row) {
            continue; // e.g. NUL bytes are not even storable in a text column
          }
          const res = await me().get(docsUrl(d, `/${row.id}/download`));
          expect(res.status).toBe(500);
          expect(res.body.error.code).toBe('DOCUMENT_INTEGRITY_ERROR');
          expect(JSON.stringify(res.body)).not.toContain('TOP-SECRET-CANARY');
          expect(JSON.stringify(res.body)).not.toContain(canaryName);
        }
      } finally {
        await rm(canaryPath, { force: true });
      }
    });

    it('answers 404 identically for a missing document, another application’s document and another project’s', async () => {
      const d = await draft('enum-a');
      const sameProjectOtherApp = await draft('enum-b');
      const foreign = await upload(sameProjectOtherApp, pdfBytes()).expect(201);
      const missing = randomUUID();

      const attempts = [
        docsUrl(d, `/${missing}`),
        docsUrl(d, `/${foreign.body.id}`),
        docsUrl(d, `/${missing}/download`),
        docsUrl(d, `/${foreign.body.id}/download`),
        docsUrl(d, `/${foreign.body.id}/versions`),
      ];
      const bodies = [];
      for (const url of attempts) {
        const res = await me().get(url).expect(404);
        bodies.push(res.body);
      }
      for (const b of bodies) {
        expect(b).toEqual(bodies[0]);
      }
      expect(bodies[0].error).toEqual({
        code: 'NOT_FOUND',
        message: 'Document not found.',
      });
    });

    it('rejects a malformed document id before any lookup', async () => {
      const d = await draft('bad-id');
      for (const id of ['not-a-uuid', '..%2F..%2Fetc%2Fpasswd', '%2e%2e']) {
        const res = await me().get(docsUrl(d, `/${id}/download`));
        expect([400, 404]).toContain(res.status);
      }
      const res = await me().get(docsUrl(d, '/not-a-uuid')).expect(400);
      expect(res.body.error.code).toBe('BAD_REQUEST');
    });

    it('offers no route that deletes a document or writes a status / scan state', async () => {
      const d = await draft('no-write-routes');
      const up = await upload(d, pdfBytes()).expect(201);
      const one = docsUrl(d, `/${up.body.id}`);
      for (const call of [
        () => me().del(one),
        () => me().patch(one).send({ status: 'VERIFIED' }),
        () => me().put(one).send({ status: 'VERIFIED' }),
        () => me().post(`${one}/status`).send({ status: 'VERIFIED' }),
        () => me().post(`${one}/scan`).send({ scanStatus: 'CLEAN' }),
        () => me().post(`${one}/verify`).send({}),
        () => me().patch(`${one}/download`).send({}),
        () => me().del(docsUrl(d)),
      ]) {
        expect((await call()).status).toBe(404);
      }
      expect((await dbDoc(up.body.id)).status).toBe('VALIDATION_PENDING');
      expect(await docCount(d)).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  describe('audit trail', () => {
    it('records the scan, upload, association and requirement events with actor and full context', async () => {
      const d = await draft('audit-upload', { isMandatory: true });
      const bytes = pdfBytes();
      const up = await uploadFor(d, bytes).expect(201);
      const row = await dbDoc(up.body.id);

      const log = await events(up.body.id);
      expect(log.map((e) => e.action).sort()).toEqual([
        'DOCUMENT_ASSOCIATED',
        'DOCUMENT_REQUIREMENT_SATISFIED',
        'DOCUMENT_SCAN_COMPLETED',
        'DOCUMENT_UPLOADED',
      ]);
      for (const e of log) {
        expect(e.userId).toBe(owner.user.id);
        expect(e.roleAtTime).toBe('APPLICANT');
        expect(e.entityType).toBe('Document');
        expect(e.afterState).toMatchObject({
          enterpriseId,
          projectId: d.projectId,
          applicationId: d.applicationId,
          documentId: up.body.id,
          version: 1,
          lineageId: up.body.lineageId,
          requirementId: d.requirementId,
          actingAs: 'OWNER',
          representativeScope: null,
        });
        // No storage path, file content or token ever reaches the audit trail.
        const text =
          JSON.stringify(e.afterState) + JSON.stringify(e.beforeState);
        expect(text).not.toContain(row.filePath);
        expect(text).not.toContain(bytes.toString('latin1').slice(0, 20));
        expect(text).not.toMatch(/token|password|secret/i);
      }
      const uploaded = log.find((e) => e.action === 'DOCUMENT_UPLOADED')!;
      expect(uploaded.afterState).toMatchObject({
        originalFilename: 'document.pdf',
        mimeType: 'application/pdf',
        sizeBytes: bytes.length,
        checksumSha256: sha256(bytes),
      });
    });

    it('records a replacement with the previous version, and only for real replacements', async () => {
      const d = await draft('audit-replace');
      const v1 = await upload(d, pdfBytes()).expect(201);
      const v2 = await replace(d, v1.body.id, pdfBytes()).expect(201);

      expect(
        (await events(v1.body.id)).some(
          (e) => e.action === 'DOCUMENT_REPLACED',
        ),
      ).toBe(false);
      const log = await events(v2.body.id);
      const replaced = log.find((e) => e.action === 'DOCUMENT_REPLACED')!;
      expect(replaced.userId).toBe(owner.user.id);
      expect(replaced.beforeState).toMatchObject({
        documentId: v1.body.id,
        version: 1,
      });
      expect(replaced.afterState).toMatchObject({
        documentId: v2.body.id,
        version: 2,
        previousDocumentId: v1.body.id,
        previousVersion: 1,
        applicationId: d.applicationId,
        actingAs: 'OWNER',
      });
      expect(log.map((e) => e.action)).toEqual(
        expect.arrayContaining([
          'DOCUMENT_SCAN_COMPLETED',
          'DOCUMENT_UPLOADED',
          'DOCUMENT_ASSOCIATED',
          'DOCUMENT_REPLACED',
        ]),
      );
    });

    it('audits downloads (who fetched which version), but not metadata reads or refused requests', async () => {
      const d = await draft('audit-download');
      const up = await upload(d, pdfBytes()).expect(201);
      const count = async () =>
        (await events(up.body.id)).filter(
          (e) => e.action === 'DOCUMENT_DOWNLOADED',
        ).length;

      await me().get(docsUrl(d)).expect(200);
      await me()
        .get(docsUrl(d, `/${up.body.id}`))
        .expect(200);
      await me()
        .get(docsUrl(d, `/${up.body.id}/versions`))
        .expect(200);
      expect(await count()).toBe(0);

      await me()
        .get(docsUrl(d, `/${up.body.id}/download`))
        .expect(200);
      expect(await count()).toBe(1);
      const event = (await events(up.body.id)).find(
        (e) => e.action === 'DOCUMENT_DOWNLOADED',
      )!;
      expect(event.userId).toBe(owner.user.id);
      expect(event.afterState).toMatchObject({
        enterpriseId,
        projectId: d.projectId,
        applicationId: d.applicationId,
        documentId: up.body.id,
        version: 1,
        actingAs: 'OWNER',
      });

      // A refused download (unavailable document) leaves no download event.
      await ctx.prisma.document.update({
        where: { id: up.body.id },
        data: { status: 'REJECTED' },
      });
      await me()
        .get(docsUrl(d, `/${up.body.id}/download`))
        .expect(409);
      expect(await count()).toBe(1);
    });

    it('writes nothing for uploads that fail validation', async () => {
      const d = await draft('audit-refused');
      const before = await ctx.prisma.auditLog.count({
        where: { userId: owner.user.id, entityType: 'Document' },
      });
      await upload(d, exeBytes(), { filename: 'a.pdf' }).expect(415);
      await upload(d, pdfBytes(), {
        filename: '../a.pdf',
        raw: true,
      }).expect(422);
      await upload(d, null).expect(400);
      expect(
        await ctx.prisma.auditLog.count({
          where: { userId: owner.user.id, entityType: 'Document' },
        }),
      ).toBe(before);
    });
  });

  // -------------------------------------------------------------------------
  describe('end-to-end flows and regression', () => {
    it('upload -> scan -> associate -> retrieve, then upload -> replace -> retrieve the historical version', async () => {
      const d = await draft('flow', { isMandatory: true });
      const first = pdfBytes('flow-1');
      const second = pdfBytes('flow-2');

      const v1 = await uploadFor(d, first).expect(201);
      expect(v1.body.scan.state).toBe('CLEAN');
      expect((await me().get(docsUrl(d)).expect(200)).body).toHaveLength(1);
      const dl1 = await me()
        .get(docsUrl(d, `/${v1.body.id}/download`))
        .buffer(true)
        .parse((r, cb) => {
          const c: Buffer[] = [];
          r.on('data', (x: Buffer) => c.push(x));
          r.on('end', () => cb(null, Buffer.concat(c)));
        })
        .expect(200);
      expect(dl1.body).toEqual(first);

      const v2 = await replace(d, v1.body.id, second).expect(201);
      const current = await me().get(docsUrl(d)).expect(200);
      expect(current.body.map((x: { id: string }) => x.id)).toEqual([
        v2.body.id,
      ]);
      const historical = await me()
        .get(docsUrl(d, `/${v1.body.id}/download`))
        .buffer(true)
        .parse((r, cb) => {
          const c: Buffer[] = [];
          r.on('data', (x: Buffer) => c.push(x));
          r.on('end', () => cb(null, Buffer.concat(c)));
        })
        .expect(200);
      expect(historical.body).toEqual(first);
      await submit(d).expect(200);
    });

    it('Steps 4–8 keep working alongside documents', async () => {
      await request(ctx.http).get(`${API}/health`).expect(200);
      await request(ctx.http).get(`${API}/health/db`).expect(200);
      const d = await draft('regress');
      await me()
        .get(`/enterprises/${enterpriseId}/projects/${d.projectId}`)
        .expect(200);
      await me()
        .get(`${appBase(d)}`)
        .expect(200);
      await me()
        .get(`${appBase(d)}/status`)
        .expect(200);
      await me().get(`/enterprises/${enterpriseId}/applications`).expect(200);
    });
  });
});
