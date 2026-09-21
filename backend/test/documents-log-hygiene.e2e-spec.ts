import request from 'supertest';
import {
  STORAGE_SERVICE,
  StorageService,
} from '../src/infrastructure/storage/storage.interface';
import {
  MALWARE_SCANNER,
  MalwareScanner,
} from '../src/modules/documents/malware-scanner.interface';
import { API, E2eContext, createE2eContext } from './support/e2e-helpers';
import { eicarPdf, pdfBytes } from './support/document-fixtures';

jest.setTimeout(300_000);

/**
 * Log hygiene for the document flows. The application is started with the
 * REAL, production-verbosity logger (otherwise Nest's test logger prints only
 * errors and this test would pass vacuously), every byte written to stdout /
 * stderr is captured, and the whole document lifecycle - including every
 * failure path - is exercised. The output must never contain file content,
 * storage keys, tokens, passwords, or the internal detail of an error.
 */
describe('Documents e2e — nothing sensitive reaches the logs', () => {
  let ctx: E2eContext;
  let captured = '';
  let stdout: jest.SpyInstance;
  let stderr: jest.SpyInstance;

  const CONTENT_MARKER = 'LOG-HYGIENE-CONTENT-MARKER-4f9a1c';
  const INTERNAL_DETAIL = 'EACCES-permission-denied-/var/secret/internal-path';

  beforeAll(async () => {
    ctx = await createE2eContext({ verboseLogs: true });
  });

  afterAll(async () => {
    await ctx.cleanup();
    await ctx.app.close();
  });

  beforeEach(() => {
    captured = '';
    const capture = (chunk: unknown) => {
      captured += typeof chunk === 'string' ? chunk : String(chunk);
      return true;
    };
    stdout = jest
      .spyOn(process.stdout, 'write')
      .mockImplementation(capture as never);
    stderr = jest
      .spyOn(process.stderr, 'write')
      .mockImplementation(capture as never);
  });

  afterEach(() => {
    stdout.mockRestore();
    stderr.mockRestore();
    jest.restoreAllMocks();
  });

  it('logs no content, path, token, password or internal error detail across the whole lifecycle', async () => {
    const storage = ctx.app.get<StorageService>(STORAGE_SERVICE);
    const scanner = ctx.app.get<MalwareScanner>(MALWARE_SCANNER);

    const session = await ctx.applicantSession('log-owner');
    const enterprise = await ctx.createEnterprise(session.accessToken, 'log');
    const project = await ctx.createProjectVia(
      session.accessToken,
      enterprise.id,
      'log',
    );
    const approval = await ctx.createStartableApproval(session.user.id, 'log');
    const snapshotId = await ctx.discover(
      session.accessToken,
      enterprise.id,
      project.id,
    );
    const application = await request(ctx.http)
      .post(
        `${API}/enterprises/${enterprise.id}/projects/${project.id}/applications`,
      )
      .set('Authorization', `Bearer ${session.accessToken}`)
      .send({
        approvalTypeId: approval.approvalTypeId,
        discoverySnapshotId: snapshotId,
      })
      .expect(201);
    const upload = (file: Buffer | null, name = 'log.pdf') =>
      ctx.uploadDocument(
        session.accessToken,
        enterprise.id,
        project.id,
        application.body.id,
        file,
        { filename: name },
      );

    // Success, replacement, download.
    const content = pdfBytes(CONTENT_MARKER);
    const v1 = await upload(content).expect(201);
    const v2 = await ctx
      .uploadDocument(
        session.accessToken,
        enterprise.id,
        project.id,
        application.body.id,
        pdfBytes(`${CONTENT_MARKER}-v2`),
        { path: `documents/${v1.body.id}/replace` },
      )
      .expect(201);
    await request(ctx.http)
      .get(
        `${API}/enterprises/${enterprise.id}/projects/${project.id}/applications/${application.body.id}/documents/${v2.body.id}/download`,
      )
      .set('Authorization', `Bearer ${session.accessToken}`)
      .expect(200);

    // Every failure path, each carrying sensitive-looking detail.
    await upload(eicarPdf()).expect(422);
    await upload(pdfBytes(), '../../etc/passwd.pdf').catch(() => undefined);
    jest
      .spyOn(scanner, 'scan')
      .mockRejectedValueOnce(new Error(INTERNAL_DETAIL));
    await upload(pdfBytes(CONTENT_MARKER)).expect(503);
    jest
      .spyOn(storage, 'put')
      .mockRejectedValueOnce(new Error(INTERNAL_DETAIL));
    await upload(pdfBytes(CONTENT_MARKER)).expect(503);
    jest
      .spyOn(ctx.prisma, '$transaction')
      .mockRejectedValueOnce(new Error(INTERNAL_DETAIL));
    await upload(pdfBytes(CONTENT_MARKER)).expect(500);

    // Integrity failure on download (tampered object) and a missing object.
    const row = await ctx.prisma.document.findUniqueOrThrow({
      where: { id: v2.body.id },
    });
    await storage.put(row.filePath, Buffer.from('tampered-bytes'), {
      overwrite: true,
    });
    await request(ctx.http)
      .get(
        `${API}/enterprises/${enterprise.id}/projects/${project.id}/applications/${application.body.id}/documents/${v2.body.id}/download`,
      )
      .set('Authorization', `Bearer ${session.accessToken}`)
      .expect(500);
    await storage.delete(row.filePath);
    await request(ctx.http)
      .get(
        `${API}/enterprises/${enterprise.id}/projects/${project.id}/applications/${application.body.id}/documents/${v2.body.id}/download`,
      )
      .set('Authorization', `Bearer ${session.accessToken}`)
      .expect(500);

    const v1Row = await ctx.prisma.document.findUniqueOrThrow({
      where: { id: v1.body.id },
    });
    const output = captured;

    // The logger was really running (so silence is meaningful)...
    expect(output).toContain('AllExceptionsFilter');
    expect(output.length).toBeGreaterThan(500);
    // ...and it never printed any of the following.
    const secrets: Array<[string, string]> = [
      ['file content', CONTENT_MARKER],
      ['tampered content', 'tampered-bytes'],
      ['internal error detail', INTERNAL_DETAIL],
      ['internal path', '/var/secret'],
      ['the EICAR test string', 'EICAR-STANDARD-ANTIVIRUS-TEST-FILE'],
      ['a storage key (v1)', v1Row.filePath],
      ['a storage key (v2)', row.filePath],
      ['an access token', session.accessToken],
      ['the password', session.user.password],
      ['a traversal attempt path', 'etc/passwd'],
    ];
    for (const [label, secret] of secrets) {
      expect({ label, leaked: output.includes(secret) }).toEqual({
        label,
        leaked: false,
      });
    }
  });
});
