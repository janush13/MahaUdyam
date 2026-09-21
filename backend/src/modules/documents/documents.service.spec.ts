import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  HttpException,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import {
  eicarPdf,
  exeBytes,
  jpegBytes,
  pdfBytes,
  pngBytes,
} from '../../../test/support/document-fixtures';
import { ErrorCodes } from '../../common/constants/error-codes.constant';
import { AuditActions } from '../../infrastructure/audit/audit-actions.constant';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  StorageObjectExistsError,
  StorageService,
} from '../../infrastructure/storage/storage.interface';
import { InvalidStorageKeyError } from '../../infrastructure/storage/storage-path.util';
import { ApplicationsService } from '../applications/applications.service';
import { EnterpriseAccess } from '../enterprises/interfaces/enterprise-access.interface';
import { DocumentsService, UploadedFileLike } from './documents.service';
import {
  MalwareScanner,
  ScannerUnavailableError,
} from './malware-scanner.interface';

const ENTERPRISE = '00000000-0000-4000-8000-0000000000c3';
const PROJECT = '00000000-0000-4000-8000-0000000000e5';
const APP = '40000000-0000-4000-8000-000000000001';
const TYPE = '10000000-0000-4000-8000-000000000001';
const ACTOR = '00000000-0000-4000-8000-0000000000a1';
const REQ = '50000000-0000-4000-8000-000000000001';
const DOC1 = '60000000-0000-4000-8000-000000000001';
const LINEAGE = '70000000-0000-4000-8000-000000000001';
const MB = 1024 * 1024;

const ownerAccess = {
  relation: 'OWNER',
  enterprise: { id: ENTERPRISE },
  scopedProjectIds: [],
} as unknown as EnterpriseAccess;
const repAccess = {
  relation: 'REPRESENTATIVE',
  scope: 'PREPARE_SUBMIT',
  enterprise: { id: ENTERPRISE },
  scopedProjectIds: [],
} as unknown as EnterpriseAccess;

const sha256 = (data: Buffer) =>
  createHash('sha256').update(data).digest('hex');

const file = (
  data: Buffer,
  name = 'document.pdf',
  mimetype = 'application/pdf',
): UploadedFileLike => ({
  originalname: name,
  mimetype,
  size: data.length,
  buffer: data,
});

const docRow = (over: Record<string, unknown> = {}) => ({
  id: DOC1,
  ownerType: 'PROJECT',
  ownerId: PROJECT,
  documentRequirementId: null,
  filePath: 'documents/2026/abc',
  checksum: 'sum',
  originalFilename: 'first.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 100,
  status: 'VALIDATION_PENDING',
  expiryDate: null,
  version: 1,
  replacedDocumentId: null,
  lineageId: LINEAGE,
  scannedAt: new Date('2026-09-19T10:00:00.000Z'),
  scannerName: 'DEV_MOCK_EICAR',
  uploadedBy: ACTOR,
  createdAt: new Date('2026-09-19T10:00:00.000Z'),
  updatedAt: new Date('2026-09-19T10:00:00.000Z'),
  documentRequirement: null,
  replacements: [],
  ...over,
});

const requirementRow = (over: Record<string, unknown> = {}) => ({
  id: REQ,
  approvalTypeId: TYPE,
  name: 'Identity proof',
  isMandatory: true,
  isReusable: false,
  maxSizeBytes: null,
  allowedMimeTypes: [] as string[],
  description: null,
  ...over,
});

type Opts = {
  appState?: string;
  requirement?: object | null;
  linked?: object | null;
  predecessorRequirement?: object | null;
  txFreshState?: string | null;
  txExistingForRequirement?: object | null;
  txReplacedExists?: object | null;
  txError?: Error;
  putError?: Error;
  scanResult?: object;
  scanError?: Error;
  getResult?: Buffer | Error;
  docs?: object[];
  requirements?: object[];
  satisfiedLinks?: object[];
  heads?: object[];
};

function build(opts: Opts = {}) {
  const calls: string[] = [];
  const tx = {
    $queryRaw: jest.fn().mockImplementation(() => {
      calls.push('lock');
      return Promise.resolve([]);
    }),
    approvalApplication: {
      findUnique: jest
        .fn()
        .mockResolvedValue(
          opts.txFreshState === null
            ? null
            : { internalState: opts.txFreshState ?? 'DRAFT' },
        ),
    },
    document: {
      findFirst: jest.fn().mockResolvedValue(opts.txReplacedExists ?? null),
      create: jest.fn().mockImplementation(({ data }) => {
        calls.push('create');
        return Promise.resolve(
          docRow({
            ...data,
            replacements: [],
            documentRequirement: data.documentRequirementId
              ? {
                  id: data.documentRequirementId,
                  name: 'Identity proof',
                  isMandatory: true,
                }
              : null,
          }),
        );
      }),
    },
    applicationDocument: {
      findFirst: jest
        .fn()
        .mockResolvedValue(opts.txExistingForRequirement ?? null),
      create: jest.fn().mockImplementation(() => {
        calls.push('link');
        return Promise.resolve({});
      }),
    },
  };
  const prisma = {
    documentRequirement: {
      findFirst: jest
        .fn()
        .mockResolvedValue('requirement' in opts ? opts.requirement : null),
      findUnique: jest
        .fn()
        .mockResolvedValue(opts.predecessorRequirement ?? null),
      findMany: jest.fn().mockResolvedValue(opts.requirements ?? []),
    },
    document: {
      findFirst: jest
        .fn()
        .mockResolvedValue('linked' in opts ? opts.linked : docRow()),
      findMany: jest.fn().mockResolvedValue(opts.docs ?? [docRow()]),
    },
    applicationDocument: {
      findMany: jest
        .fn()
        .mockImplementation((args: any) =>
          Promise.resolve(
            args.select?.document?.select?.version
              ? (opts.heads ?? [])
              : (opts.satisfiedLinks ?? []),
          ),
        ),
    },
    $transaction: jest.fn().mockImplementation((fn) => {
      if (opts.txError) {
        return Promise.reject(opts.txError);
      }
      return fn(tx);
    }),
  };
  const applications = {
    findApplication: jest.fn().mockResolvedValue({
      id: APP,
      projectId: PROJECT,
      approvalTypeId: TYPE,
      internalState: opts.appState ?? 'DRAFT',
    }),
    syncDraftStatus: jest.fn().mockImplementation(() => {
      calls.push('sync');
      return Promise.resolve();
    }),
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const config = { get: jest.fn().mockReturnValue(10 * MB) };
  const storage = {
    put: jest.fn().mockImplementation((key: string) => {
      calls.push('put');
      return opts.putError
        ? Promise.reject(opts.putError)
        : Promise.resolve({ key, size: 1 });
    }),
    get: jest.fn().mockImplementation(() => {
      const r = opts.getResult ?? pdfBytes();
      return r instanceof Error ? Promise.reject(r) : Promise.resolve(r);
    }),
    delete: jest.fn().mockImplementation(() => {
      calls.push('delete');
      return Promise.resolve();
    }),
    exists: jest.fn().mockResolvedValue(true),
  };
  const scanner = {
    name: 'DEV_MOCK_EICAR',
    scan: jest.fn().mockImplementation(() => {
      calls.push('scan');
      return opts.scanError
        ? Promise.reject(opts.scanError)
        : Promise.resolve(
            opts.scanResult ?? {
              verdict: 'CLEAN',
              scannerName: 'DEV_MOCK_EICAR',
            },
          );
    }),
  };
  const service = new DocumentsService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    applications as unknown as ApplicationsService,
    config as unknown as ConfigService<never, true>,
    storage as unknown as StorageService,
    scanner as unknown as MalwareScanner,
  );
  return { service, prisma, tx, applications, audit, storage, scanner, calls };
}

async function thrown(promise: Promise<unknown>): Promise<any> {
  try {
    await promise;
  } catch (e) {
    return e;
  }
  throw new Error('expected the call to throw');
}

const upload = (
  s: ReturnType<typeof build>,
  f: UploadedFileLike | undefined,
  dto: { documentRequirementId?: string; expiryDate?: string } = {},
  access: EnterpriseAccess = ownerAccess,
) => s.service.upload(access, PROJECT, APP, ACTOR, f, dto, '1.2.3.4');
const replace = (
  s: ReturnType<typeof build>,
  f: UploadedFileLike | undefined,
  dto: { expiryDate?: string } = {},
  access: EnterpriseAccess = ownerAccess,
) => s.service.replace(access, PROJECT, APP, DOC1, ACTOR, f, dto, '1.2.3.4');

describe('DocumentsService', () => {
  // -----------------------------------------------------------------------
  describe('upload — pipeline', () => {
    it('validates, scans, THEN stores, THEN records (in that order), and refreshes the draft status inside the transaction', async () => {
      const s = build();
      await upload(s, file(pdfBytes()));
      expect(s.calls).toEqual([
        'scan',
        'put',
        'lock',
        'create',
        'link',
        'sync',
      ]);
      expect(s.applications.syncDraftStatus).toHaveBeenCalledWith(s.tx, APP);
    });

    it('derives ownership from the resolved application — never from the client', async () => {
      const s = build();
      const bytes = pdfBytes();
      await upload(s, file(bytes, 'plan.pdf'));
      expect(s.applications.findApplication).toHaveBeenCalledWith(
        ownerAccess,
        PROJECT,
        APP,
      );
      const data = s.tx.document.create.mock.calls[0][0].data;
      expect(data).toMatchObject({
        ownerType: 'PROJECT',
        ownerId: PROJECT,
        documentRequirementId: null,
        originalFilename: 'plan.pdf',
        mimeType: 'application/pdf',
        sizeBytes: bytes.length,
        checksum: sha256(bytes),
        status: 'VALIDATION_PENDING',
        version: 1,
        replacedDocumentId: null,
        scannerName: 'DEV_MOCK_EICAR',
        uploadedBy: ACTOR,
      });
      expect(data.scannedAt).toBeInstanceOf(Date);
      // v1 starts its own chain: the database assigns the lineage.
      expect(data).not.toHaveProperty('lineageId');
      expect(s.tx.applicationDocument.create).toHaveBeenCalledWith({
        data: { applicationId: APP, documentId: data.id },
      });
    });

    it('stores under a generated key that has nothing to do with the filename, without overwriting', async () => {
      const s = build();
      await upload(s, file(pdfBytes(), 'secret-name.pdf'));
      const [key, buffer, options] = s.storage.put.mock.calls[0];
      expect(key).toMatch(/^documents\/\d{4}\/[0-9a-f-]{36}$/);
      expect(key).not.toContain('secret');
      expect(buffer).toBeInstanceOf(Buffer);
      expect(options).toEqual({ overwrite: false });
      expect(s.tx.document.create.mock.calls[0][0].data.filePath).toBe(key);
    });

    it('generates a different key every time', async () => {
      const s = build();
      await upload(s, file(pdfBytes()));
      await upload(s, file(pdfBytes()));
      const keys = s.storage.put.mock.calls.map((c) => c[0]);
      expect(new Set(keys).size).toBe(2);
    });

    it('records the DETECTED type, not the declared one', async () => {
      const s = build();
      await upload(s, file(pngBytes(), 'p.png', 'application/octet-stream'));
      expect(s.tx.document.create.mock.calls[0][0].data.mimeType).toBe(
        'image/png',
      );
    });

    it('recovers a UTF-8 filename that the multipart parser decoded as latin1', async () => {
      const s = build();
      const wire = Buffer.from('आधार.pdf', 'utf8').toString('latin1');
      await upload(s, file(pdfBytes(), wire));
      expect(s.tx.document.create.mock.calls[0][0].data.originalFilename).toBe(
        'आधार.pdf',
      );
    });

    it('scans exactly the bytes that are stored', async () => {
      const s = build();
      const bytes = pdfBytes();
      await upload(s, file(bytes, 'x.pdf'));
      expect(s.scanner.scan).toHaveBeenCalledWith(bytes, { filename: 'x.pdf' });
      expect(s.storage.put.mock.calls[0][1]).toBe(bytes);
    });

    it('audits scan, upload and association with actor, enterprise, project, application and acting relationship', async () => {
      const s = build();
      await upload(s, file(pdfBytes()), {}, repAccess);
      const events = s.audit.record.mock.calls.map((c) => c[0]);
      expect(events.map((e) => e.action)).toEqual([
        AuditActions.DOCUMENT_SCAN_COMPLETED,
        AuditActions.DOCUMENT_UPLOADED,
        AuditActions.DOCUMENT_ASSOCIATED,
      ]);
      for (const e of events) {
        expect(e).toMatchObject({
          userId: ACTOR,
          roleAtTime: 'APPLICANT',
          entityType: 'Document',
          ipAddress: '1.2.3.4',
        });
        expect(e.afterState).toMatchObject({
          enterpriseId: ENTERPRISE,
          projectId: PROJECT,
          applicationId: APP,
          actingAs: 'REPRESENTATIVE',
          representativeScope: 'PREPARE_SUBMIT',
          version: 1,
        });
      }
      // No storage key and no file content in the audit trail.
      const key = s.storage.put.mock.calls[0][0] as string;
      expect(JSON.stringify(events)).not.toContain(key);
    });

    it('records the requirement as satisfied when the upload is for one', async () => {
      const s = build({ requirement: requirementRow() });
      await upload(s, file(pdfBytes()), { documentRequirementId: REQ });
      expect(s.prisma.documentRequirement.findFirst).toHaveBeenCalledWith({
        where: { id: REQ, approvalTypeId: TYPE },
      });
      expect(
        s.tx.document.create.mock.calls[0][0].data.documentRequirementId,
      ).toBe(REQ);
      expect(s.audit.record.mock.calls.map((c) => c[0].action)).toContain(
        AuditActions.DOCUMENT_REQUIREMENT_SATISFIED,
      );
    });

    it('does not claim a requirement was satisfied when there is none', async () => {
      const s = build();
      await upload(s, file(pdfBytes()));
      expect(s.audit.record.mock.calls.map((c) => c[0].action)).not.toContain(
        AuditActions.DOCUMENT_REQUIREMENT_SATISFIED,
      );
    });

    it('never returns storage internals in the response', async () => {
      const s = build();
      const res = await upload(s, file(pdfBytes()));
      const text = JSON.stringify(res);
      expect(res).not.toHaveProperty('filePath');
      expect(res).not.toHaveProperty('checksum');
      expect(text).not.toContain('documents/2026');
      expect(res).toMatchObject({
        applicationId: APP,
        version: 1,
        isCurrent: true,
        scan: { state: 'CLEAN', scanner: 'DEV_MOCK_EICAR' },
        downloadable: true,
      });
    });
  });

  // -----------------------------------------------------------------------
  describe('upload — refusals happen before anything is scanned or stored', () => {
    const expectUntouched = (s: ReturnType<typeof build>) => {
      expect(s.scanner.scan).not.toHaveBeenCalled();
      expect(s.storage.put).not.toHaveBeenCalled();
      expect(s.prisma.$transaction).not.toHaveBeenCalled();
      expect(s.audit.record).not.toHaveBeenCalled();
    };

    it('needs a file', async () => {
      const s = build();
      const e = await thrown(upload(s, undefined));
      expect(e).toBeInstanceOf(BadRequestException);
      expect(e.getResponse().code).toBe(ErrorCodes.FILE_REQUIRED);
      expectUntouched(s);
    });

    it('needs the file to be an in-memory buffer', async () => {
      const s = build();
      const e = await thrown(
        upload(s, {
          originalname: 'a.pdf',
          mimetype: 'application/pdf',
          size: 3,
        } as never),
      );
      expect(e.getResponse().code).toBe(ErrorCodes.FILE_REQUIRED);
      expectUntouched(s);
    });

    it.each([
      [
        'an executable',
        exeBytes(),
        'a.pdf',
        'application/pdf',
        415,
        'UNSUPPORTED_TYPE',
      ],
      [
        'an empty file',
        Buffer.alloc(0),
        'a.pdf',
        'application/pdf',
        400,
        'FILE_EMPTY',
      ],
      [
        'a wrong extension',
        pdfBytes(),
        'a.png',
        'image/png',
        422,
        'MIME_TYPE_MISMATCH',
      ],
      [
        'a wrong declared type',
        pdfBytes(),
        'a.pdf',
        'image/png',
        422,
        'MIME_TYPE_MISMATCH',
      ],
      [
        'a truncated PDF',
        Buffer.from('%PDF-1.4 cut'),
        'a.pdf',
        'application/pdf',
        422,
        'CORRUPT_FILE',
      ],
      [
        'a traversal name',
        pdfBytes(),
        '../a.pdf',
        'application/pdf',
        422,
        'INVALID_FILENAME',
      ],
      [
        'a double extension',
        pdfBytes(),
        'a.exe.pdf',
        'application/pdf',
        422,
        'INVALID_FILENAME',
      ],
    ])('rejects %s', async (_l, bytes, name, type, status, code) => {
      const s = build();
      const e = await thrown(upload(s, file(bytes, name, type)));
      expect(e).toBeInstanceOf(HttpException);
      expect(e.getStatus()).toBe(status);
      expect(e.getResponse().code).toBe(
        ErrorCodes[code as keyof typeof ErrorCodes],
      );
      expectUntouched(s);
    });

    it('rejects a file over the platform ceiling', async () => {
      const s = build();
      const big = Buffer.concat([pdfBytes(), Buffer.alloc(10 * MB, 0x20)]);
      const e = await thrown(upload(s, file(big)));
      expect(e.getStatus()).toBe(413);
      expect(e.getResponse().code).toBe(ErrorCodes.FILE_TOO_LARGE);
      expectUntouched(s);
    });

    it('applies a requirement’s LOWER size limit and narrower type list', async () => {
      const limited = requirementRow({
        maxSizeBytes: 1000,
        allowedMimeTypes: ['application/pdf'],
      });
      const big = Buffer.concat([pdfBytes(), Buffer.alloc(2000, 0x20)]);
      const tooBig = build({ requirement: limited });
      const e1 = await thrown(
        upload(tooBig, file(big), { documentRequirementId: REQ }),
      );
      expect(e1.getStatus()).toBe(413);
      expectUntouched(tooBig);

      const wrongType = build({ requirement: limited });
      const e2 = await thrown(
        upload(wrongType, file(jpegBytes(), 'p.jpg', 'image/jpeg'), {
          documentRequirementId: REQ,
        }),
      );
      expect(e2.getStatus()).toBe(415);
      expectUntouched(wrongType);

      const ok = build({ requirement: limited });
      await upload(ok, file(pdfBytes()), { documentRequirementId: REQ });
      expect(ok.storage.put).toHaveBeenCalled();
    });

    it('rejects a requirement that is not this approval’s (or does not exist)', async () => {
      const s = build({ requirement: null });
      const e = await thrown(
        upload(s, file(pdfBytes()), { documentRequirementId: REQ }),
      );
      expect(e).toBeInstanceOf(UnprocessableEntityException);
      expect(e.getResponse().code).toBe(
        ErrorCodes.DOCUMENT_REQUIREMENT_MISMATCH,
      );
      expectUntouched(s);
    });

    it.each(['2026-02-30', '2026-13-01', '2026-00-10', '2026-1-1'])(
      'rejects the impossible expiry date %s',
      async (expiryDate) => {
        const s = build();
        const e = await thrown(upload(s, file(pdfBytes()), { expiryDate }));
        expect(e).toBeInstanceOf(BadRequestException);
        expectUntouched(s);
      },
    );

    it('stores a valid expiry date at UTC midnight, and none by default', async () => {
      const s = build();
      await upload(s, file(pdfBytes()), { expiryDate: '2027-03-31' });
      expect(s.tx.document.create.mock.calls[0][0].data.expiryDate).toEqual(
        new Date('2027-03-31T00:00:00.000Z'),
      );
      const t = build();
      await upload(t, file(pdfBytes()));
      expect(t.tx.document.create.mock.calls[0][0].data.expiryDate).toBeNull();
    });

    it.each(['SUBMITTED', 'UNDER_SCRUTINY', 'CANCELLED'])(
      'refuses documents on a %s application',
      async (appState) => {
        const s = build({ appState });
        const e = await thrown(upload(s, file(pdfBytes())));
        expect(e).toBeInstanceOf(ConflictException);
        expect(e.getResponse().code).toBe(ErrorCodes.ALREADY_SUBMITTED);
        expectUntouched(s);
      },
    );

    it('resolves the application through the authorised chain before anything else', async () => {
      const s = build();
      s.applications.findApplication.mockRejectedValueOnce(
        new NotFoundException({
          code: 'NOT_FOUND',
          message: 'Application not found.',
        }),
      );
      const e = await thrown(upload(s, file(pdfBytes())));
      expect(e).toBeInstanceOf(NotFoundException);
      expect(s.prisma.documentRequirement.findFirst).not.toHaveBeenCalled();
      expectUntouched(s);
    });
  });

  // -----------------------------------------------------------------------
  describe('upload — the scanning boundary fails closed', () => {
    it('rejects an infected file: 422, nothing stored, audited against the application', async () => {
      const s = build({
        scanResult: {
          verdict: 'INFECTED',
          signature: 'EICAR-Test-File',
          scannerName: 'DEV_MOCK_EICAR',
        },
      });
      const e = await thrown(
        upload(s, file(eicarPdf(), 'bad.pdf'), {}, repAccess),
      );
      expect(e).toBeInstanceOf(UnprocessableEntityException);
      expect(e.getResponse().code).toBe(ErrorCodes.MALWARE_DETECTED);
      expect(s.storage.put).not.toHaveBeenCalled();
      expect(s.prisma.$transaction).not.toHaveBeenCalled();
      const [event] = s.audit.record.mock.calls.map((c) => c[0]);
      expect(event).toMatchObject({
        userId: ACTOR,
        action: AuditActions.DOCUMENT_SCAN_REJECTED,
        entityType: 'ApprovalApplication',
        entityId: APP,
      });
      expect(event.afterState).toMatchObject({
        stored: false,
        originalFilename: 'bad.pdf',
        signature: 'EICAR-Test-File',
        scanner: 'DEV_MOCK_EICAR',
        actingAs: 'REPRESENTATIVE',
        projectId: PROJECT,
      });
    });

    it.each([
      ['a scanner outage', new ScannerUnavailableError()],
      ['an unexpected scanner crash', new Error('ECONNRESET')],
    ])('treats %s as a failure, never as clean', async (_l, scanError) => {
      const s = build({ scanError });
      const e = await thrown(upload(s, file(pdfBytes())));
      expect(e).toBeInstanceOf(ServiceUnavailableException);
      expect(e.getResponse().code).toBe(ErrorCodes.SCANNER_UNAVAILABLE);
      expect(JSON.stringify(e.getResponse())).not.toContain('ECONNRESET');
      expect(s.storage.put).not.toHaveBeenCalled();
      expect(s.prisma.$transaction).not.toHaveBeenCalled();
      expect(s.audit.record.mock.calls[0][0].action).toBe(
        AuditActions.DOCUMENT_SCAN_FAILED,
      );
    });

    it.each([
      ['an unrecognised verdict', { verdict: 'MAYBE', scannerName: 'X' }],
      ['a missing verdict', { scannerName: 'X' }],
      ['a lower-case verdict', { verdict: 'clean', scannerName: 'X' }],
    ])('treats %s as a scanner malfunction', async (_l, scanResult) => {
      const s = build({ scanResult });
      const e = await thrown(upload(s, file(pdfBytes())));
      expect(e.getResponse().code).toBe(ErrorCodes.SCANNER_UNAVAILABLE);
      expect(s.storage.put).not.toHaveBeenCalled();
      expect(s.audit.record.mock.calls[0][0].action).toBe(
        AuditActions.DOCUMENT_SCAN_FAILED,
      );
    });

    it('records which scanner cleared the file', async () => {
      const s = build({
        scanResult: { verdict: 'CLEAN', scannerName: 'FUTURE_CLAMAV' },
      });
      await upload(s, file(pdfBytes()));
      expect(s.tx.document.create.mock.calls[0][0].data.scannerName).toBe(
        'FUTURE_CLAMAV',
      );
      const scanEvent = s.audit.record.mock.calls
        .map((c) => c[0])
        .find((e) => e.action === AuditActions.DOCUMENT_SCAN_COMPLETED);
      expect(scanEvent.afterState).toMatchObject({
        scanner: 'FUTURE_CLAMAV',
        verdict: 'CLEAN',
      });
    });
  });

  // -----------------------------------------------------------------------
  describe('upload — storage and database failures leave nothing behind', () => {
    it('reports a storage failure as 503 with no detail, and records nothing', async () => {
      const s = build({ putError: new Error('EACCES: /var/secret/store') });
      const e = await thrown(upload(s, file(pdfBytes())));
      expect(e).toBeInstanceOf(ServiceUnavailableException);
      expect(e.getResponse().code).toBe(ErrorCodes.STORAGE_UNAVAILABLE);
      expect(JSON.stringify(e.getResponse())).not.toMatch(/EACCES|secret/);
      expect(s.prisma.$transaction).not.toHaveBeenCalled();
      expect(s.calls).not.toContain('delete'); // nothing was stored to remove
      expect(s.audit.record).not.toHaveBeenCalled();
    });

    it('treats a key collision as a storage failure (never a silent replace)', async () => {
      const s = build({ putError: new StorageObjectExistsError() });
      const e = await thrown(upload(s, file(pdfBytes())));
      expect(e.getResponse().code).toBe(ErrorCodes.STORAGE_UNAVAILABLE);
      expect(s.prisma.$transaction).not.toHaveBeenCalled();
    });

    it('removes the stored object again if the database step fails', async () => {
      const s = build({ txError: new Error('connection lost') });
      const e = await thrown(upload(s, file(pdfBytes())));
      expect(e).toBeInstanceOf(InternalServerErrorException);
      expect(e.getResponse().code).toBe(ErrorCodes.INTERNAL_ERROR);
      const key = s.storage.put.mock.calls[0][0];
      expect(s.storage.delete).toHaveBeenCalledWith(key);
      expect(s.audit.record).not.toHaveBeenCalled();
    });

    it('never lets an unexpected database error’s detail (keys, values) leave the service', async () => {
      const s = build({
        txError: new Error(
          'Invalid create() invocation: filePath: documents/2026/secret-key',
        ),
      });
      const e = await thrown(upload(s, file(pdfBytes())));
      expect(JSON.stringify(e.getResponse())).not.toMatch(
        /secret-key|filePath|invocation/,
      );
      expect(e.message).not.toMatch(/secret-key|filePath|invocation/);
      expect(e.stack).not.toMatch(/secret-key|filePath|invocation/);
    });

    it('passes a controlled (HTTP) outcome from the transaction through unchanged', async () => {
      const s = build({ txFreshState: 'SUBMITTED' });
      const e = await thrown(upload(s, file(pdfBytes())));
      expect(e).toBeInstanceOf(ConflictException);
      expect(e.getResponse().code).toBe(ErrorCodes.ALREADY_SUBMITTED);
    });

    it('still reports the original error when the cleanup itself fails', async () => {
      const s = build({ txError: new Error('connection lost') });
      s.storage.delete.mockRejectedValueOnce(new Error('disk gone'));
      const e = await thrown(upload(s, file(pdfBytes())));
      expect(e).toBeInstanceOf(InternalServerErrorException);
      expect(e.getResponse().code).toBe(ErrorCodes.INTERNAL_ERROR);
    });

    it('locks the application row, then re-checks it is STILL a draft', async () => {
      const s = build({ txFreshState: 'SUBMITTED' });
      const e = await thrown(upload(s, file(pdfBytes())));
      expect(s.calls).toEqual(
        expect.arrayContaining(['put', 'lock', 'delete']),
      );
      expect(e.getResponse().code).toBe(ErrorCodes.ALREADY_SUBMITTED);
      expect(s.tx.document.create).not.toHaveBeenCalled();
      expect(s.storage.delete).toHaveBeenCalledWith(
        s.storage.put.mock.calls[0][0],
      );
    });

    it('treats an application that vanished mid-flight as not editable', async () => {
      const s = build({ txFreshState: null });
      const e = await thrown(upload(s, file(pdfBytes())));
      expect(e.getResponse().code).toBe(ErrorCodes.ALREADY_SUBMITTED);
    });

    it('a requirement holds one chain: a second first-upload is refused and its object discarded', async () => {
      const s = build({
        requirement: requirementRow(),
        txExistingForRequirement: { documentId: DOC1 },
      });
      const e = await thrown(
        upload(s, file(pdfBytes()), { documentRequirementId: REQ }),
      );
      expect(e).toBeInstanceOf(ConflictException);
      expect(e.getResponse().code).toBe(
        ErrorCodes.REQUIREMENT_ALREADY_HAS_DOCUMENT,
      );
      expect(s.tx.document.create).not.toHaveBeenCalled();
      expect(s.storage.delete).toHaveBeenCalledWith(
        s.storage.put.mock.calls[0][0],
      );
      expect(s.audit.record).not.toHaveBeenCalled();
    });

    it('maps a unique-constraint race to a controlled conflict, discarding the object', async () => {
      const s = build({
        txError: new Prisma.PrismaClientKnownRequestError('dup', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      });
      const e = await thrown(upload(s, file(pdfBytes())));
      expect(e).toBeInstanceOf(ConflictException);
      expect(e.getResponse().code).toBe(ErrorCodes.CONFLICT);
      expect(s.storage.delete).toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  describe('replace', () => {
    const predecessor = (over: Record<string, unknown> = {}) =>
      docRow({
        documentRequirementId: REQ,
        documentRequirement: {
          id: REQ,
          name: 'Identity proof',
          isMandatory: true,
        },
        version: 2,
        replacedDocumentId: '60000000-0000-4000-8000-000000000000',
        ...over,
      });

    it('creates the NEXT version in the same chain, inheriting owner and requirement', async () => {
      const s = build({
        linked: predecessor(),
        predecessorRequirement: requirementRow(),
      });
      const res = await replace(s, file(pdfBytes(), 'new.pdf'));
      const data = s.tx.document.create.mock.calls[0][0].data;
      expect(data).toMatchObject({
        ownerType: 'PROJECT',
        ownerId: PROJECT,
        documentRequirementId: REQ,
        version: 3,
        replacedDocumentId: DOC1,
        lineageId: LINEAGE,
        originalFilename: 'new.pdf',
        uploadedBy: ACTOR,
      });
      expect(res.version).toBe(3);
      expect(res.previousVersionId).toBe(DOC1);
      // The predecessor is never touched.
      expect(s.tx.document).not.toHaveProperty('update');
      expect(s.tx.document).not.toHaveProperty('delete');
    });

    it('finds the predecessor only THROUGH this application', async () => {
      const s = build({ linked: predecessor() });
      await replace(s, file(pdfBytes()));
      expect(s.prisma.document.findFirst.mock.calls[0][0].where).toEqual({
        id: DOC1,
        applicationDocuments: { some: { applicationId: APP } },
      });
    });

    it('404s when the document is not on this application, before scanning or storing', async () => {
      const s = build({ linked: null });
      const e = await thrown(replace(s, file(pdfBytes())));
      expect(e).toBeInstanceOf(NotFoundException);
      expect(s.scanner.scan).not.toHaveBeenCalled();
      expect(s.storage.put).not.toHaveBeenCalled();
    });

    it('refuses to replace a version that has already been replaced', async () => {
      const s = build({
        linked: predecessor({ replacements: [{ id: 'newer' }] }),
      });
      const e = await thrown(replace(s, file(pdfBytes())));
      expect(e).toBeInstanceOf(ConflictException);
      expect(e.getResponse().code).toBe(ErrorCodes.DOCUMENT_NOT_CURRENT);
      expect(s.scanner.scan).not.toHaveBeenCalled();
      expect(s.storage.put).not.toHaveBeenCalled();
    });

    it('re-checks inside the transaction that nothing replaced it meanwhile, and discards the object', async () => {
      const s = build({
        linked: predecessor(),
        txReplacedExists: { id: 'racing-winner' },
      });
      const e = await thrown(replace(s, file(pdfBytes())));
      expect(e.getResponse().code).toBe(ErrorCodes.DOCUMENT_NOT_CURRENT);
      expect(s.tx.document.create).not.toHaveBeenCalled();
      expect(s.storage.delete).toHaveBeenCalledWith(
        s.storage.put.mock.calls[0][0],
      );
      expect(s.audit.record).not.toHaveBeenCalled();
    });

    it('maps the (lineage, version) unique violation of a lost race to DOCUMENT_NOT_CURRENT', async () => {
      const s = build({
        linked: predecessor(),
        txError: new Prisma.PrismaClientKnownRequestError('dup', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      });
      const e = await thrown(replace(s, file(pdfBytes())));
      expect(e.getResponse().code).toBe(ErrorCodes.DOCUMENT_NOT_CURRENT);
      expect(s.storage.delete).toHaveBeenCalled();
    });

    it('is scanned and validated like an upload (a refused replacement changes nothing)', async () => {
      const bad = build({ linked: predecessor() });
      await thrown(replace(bad, file(exeBytes(), 'a.pdf')));
      const infected = build({
        linked: predecessor(),
        scanResult: { verdict: 'INFECTED', scannerName: 'X' },
      });
      const e = await thrown(replace(infected, file(eicarPdf())));
      expect(e.getResponse().code).toBe(ErrorCodes.MALWARE_DETECTED);
      for (const s of [bad, infected]) {
        expect(s.storage.put).not.toHaveBeenCalled();
        expect(s.prisma.$transaction).not.toHaveBeenCalled();
      }
    });

    it('uses the predecessor’s requirement limits', async () => {
      const s = build({
        linked: predecessor(),
        predecessorRequirement: requirementRow({
          allowedMimeTypes: ['application/pdf'],
        }),
      });
      const e = await thrown(
        replace(s, file(pngBytes(), 'p.png', 'image/png')),
      );
      expect(e.getStatus()).toBe(415);
    });

    it('refuses on a submitted application', async () => {
      const s = build({ appState: 'SUBMITTED', linked: predecessor() });
      const e = await thrown(replace(s, file(pdfBytes())));
      expect(e.getResponse().code).toBe(ErrorCodes.ALREADY_SUBMITTED);
      expect(s.scanner.scan).not.toHaveBeenCalled();
    });

    it('audits the replacement with the previous version, and the requirement being satisfied again', async () => {
      const s = build({ linked: predecessor() });
      await replace(s, file(pdfBytes()), {}, repAccess);
      const events = s.audit.record.mock.calls.map((c) => c[0]);
      expect(events.map((e) => e.action)).toEqual([
        AuditActions.DOCUMENT_SCAN_COMPLETED,
        AuditActions.DOCUMENT_UPLOADED,
        AuditActions.DOCUMENT_ASSOCIATED,
        AuditActions.DOCUMENT_REPLACED,
        AuditActions.DOCUMENT_REQUIREMENT_SATISFIED,
      ]);
      const replaced = events.find(
        (e) => e.action === AuditActions.DOCUMENT_REPLACED,
      );
      expect(replaced.beforeState).toMatchObject({
        documentId: DOC1,
        version: 2,
        status: 'VALIDATION_PENDING',
      });
      expect(replaced.afterState).toMatchObject({
        previousDocumentId: DOC1,
        previousVersion: 2,
        version: 3,
        actingAs: 'REPRESENTATIVE',
      });
    });
  });

  // -----------------------------------------------------------------------
  describe('list / get / versions', () => {
    it('lists documents attached to THIS application, current versions by default', async () => {
      const s = build();
      await s.service.list(ownerAccess, PROJECT, APP, false);
      expect(s.prisma.document.findMany.mock.calls[0][0].where).toEqual({
        applicationDocuments: { some: { applicationId: APP } },
        replacements: { none: {} },
      });
    });

    it('lists every version when history is requested', async () => {
      const s = build();
      await s.service.list(ownerAccess, PROJECT, APP, true);
      expect(s.prisma.document.findMany.mock.calls[0][0].where).toEqual({
        applicationDocuments: { some: { applicationId: APP } },
      });
    });

    it('resolves the application through the authorised chain first', async () => {
      const s = build();
      await s.service.list(repAccess, PROJECT, APP, false);
      expect(s.applications.findApplication).toHaveBeenCalledWith(
        repAccess,
        PROJECT,
        APP,
      );
    });

    it('shows a version’s place in its chain', async () => {
      const s = build({
        linked: docRow({
          version: 2,
          replacedDocumentId: 'prev',
          replacements: [{ id: 'next' }],
        }),
      });
      const res = await s.service.get(ownerAccess, PROJECT, APP, DOC1);
      expect(res).toMatchObject({
        version: 2,
        isCurrent: false,
        previousVersionId: 'prev',
        replacedByVersionId: 'next',
      });
    });

    it('reports an unscanned or rejected document as not downloadable', async () => {
      for (const over of [
        { scannedAt: null },
        { status: 'REJECTED' },
        { status: 'SCAN_PENDING' },
      ]) {
        const s = build({ linked: docRow(over) });
        const res = await s.service.get(ownerAccess, PROJECT, APP, DOC1);
        expect(res.downloadable).toBe(false);
      }
      const clean = build({ linked: docRow({ scannedAt: null }) });
      expect(
        (await clean.service.get(ownerAccess, PROJECT, APP, DOC1)).scan.state,
      ).toBe('NOT_SCANNED');
    });

    it('404s uniformly for a document not on the application', async () => {
      const s = build({ linked: null });
      const e = await thrown(s.service.get(ownerAccess, PROJECT, APP, DOC1));
      expect(e).toBeInstanceOf(NotFoundException);
      expect(e.getResponse()).toEqual({
        code: 'NOT_FOUND',
        message: 'Document not found.',
      });
    });

    it('returns the whole chain of a document, scoped to the application', async () => {
      const s = build({
        linked: docRow(),
        docs: [docRow(), docRow({ version: 2 })],
      });
      const res = await s.service.versions(ownerAccess, PROJECT, APP, DOC1);
      expect(res).toHaveLength(2);
      expect(s.prisma.document.findMany.mock.calls[0][0]).toMatchObject({
        where: {
          lineageId: LINEAGE,
          applicationDocuments: { some: { applicationId: APP } },
        },
        orderBy: { version: 'asc' },
      });
    });
  });

  // -----------------------------------------------------------------------
  describe('requirements', () => {
    it('returns nothing when no requirement is configured (nothing fabricated)', async () => {
      const s = build({ requirements: [] });
      await expect(
        s.service.requirements(ownerAccess, PROJECT, APP),
      ).resolves.toEqual([]);
      expect(s.prisma.applicationDocument.findMany).not.toHaveBeenCalled();
    });

    it('reports effective limits and satisfaction per requirement', async () => {
      const s = build({
        requirements: [
          requirementRow({
            id: 'r1',
            name: 'A',
            maxSizeBytes: 500,
            allowedMimeTypes: ['application/pdf'],
          }),
          requirementRow({
            id: 'r2',
            name: 'B',
            isMandatory: false,
            maxSizeBytes: 999 * MB,
          }),
        ],
        satisfiedLinks: [{ document: { documentRequirementId: 'r1' } }],
        heads: [
          {
            document: {
              id: 'd1',
              version: 2,
              status: 'VERIFIED',
              documentRequirementId: 'r1',
            },
          },
        ],
      });
      const res = await s.service.requirements(ownerAccess, PROJECT, APP);
      expect(res).toEqual([
        {
          id: 'r1',
          name: 'A',
          description: null,
          isMandatory: true,
          acceptedMimeTypes: ['application/pdf'],
          maxSizeBytes: 500,
          satisfied: true,
          currentDocument: { id: 'd1', version: 2, status: 'VERIFIED' },
        },
        {
          id: 'r2',
          name: 'B',
          description: null,
          isMandatory: false,
          acceptedMimeTypes: ['application/pdf', 'image/jpeg', 'image/png'],
          maxSizeBytes: 10 * MB,
          satisfied: false,
          currentDocument: null,
        },
      ]);
    });

    it('lists only the requirements of THIS application’s approval', async () => {
      const s = build({ requirements: [requirementRow()] });
      await s.service.requirements(ownerAccess, PROJECT, APP);
      expect(
        s.prisma.documentRequirement.findMany.mock.calls[0][0].where,
      ).toEqual({
        approvalTypeId: TYPE,
      });
    });
  });

  // -----------------------------------------------------------------------
  describe('download', () => {
    const download = (s: ReturnType<typeof build>, access = ownerAccess) =>
      s.service.download(access, PROJECT, APP, DOC1, ACTOR, '9.9.9.9');

    it('serves the bytes after checking the integrity hash, and audits the access', async () => {
      const bytes = pdfBytes('serve-me');
      const s = build({
        getResult: bytes,
        linked: docRow({
          checksum: sha256(bytes),
          originalFilename: 'plan.pdf',
        }),
      });
      const res = await download(s, repAccess);
      expect(res).toEqual({
        data: bytes,
        filename: 'plan.pdf',
        mimeType: 'application/pdf',
      });
      expect(s.storage.get).toHaveBeenCalledWith('documents/2026/abc');
      expect(s.audit.record).toHaveBeenCalledTimes(1);
      const event = s.audit.record.mock.calls[0][0];
      expect(event).toMatchObject({
        userId: ACTOR,
        action: AuditActions.DOCUMENT_DOWNLOADED,
        entityType: 'Document',
        entityId: DOC1,
        ipAddress: '9.9.9.9',
      });
      expect(event.afterState).toMatchObject({
        enterpriseId: ENTERPRISE,
        projectId: PROJECT,
        applicationId: APP,
        documentId: DOC1,
        version: 1,
        actingAs: 'REPRESENTATIVE',
      });
      expect(JSON.stringify(event)).not.toContain('documents/2026/abc');
    });

    it.each([
      ['a rejected document', { status: 'REJECTED' }],
      ['a never-scanned document', { scannedAt: null }],
      ['a scan-pending document', { status: 'SCAN_PENDING', scannedAt: null }],
      [
        'an uploaded-but-unscanned document',
        { status: 'UPLOADED', scannedAt: null },
      ],
    ])('never reads storage for %s', async (_l, over) => {
      const s = build({ linked: docRow(over) });
      const e = await thrown(download(s));
      expect(e).toBeInstanceOf(ConflictException);
      expect(e.getResponse().code).toBe(ErrorCodes.DOCUMENT_NOT_AVAILABLE);
      expect(s.storage.get).not.toHaveBeenCalled();
      expect(s.audit.record).not.toHaveBeenCalled();
    });

    it.each(['VALIDATION_PENDING', 'VERIFIED', 'EXPIRED'])(
      'serves a scanned %s document (history stays retrievable)',
      async (status) => {
        const bytes = pdfBytes();
        const s = build({
          getResult: bytes,
          linked: docRow({ status, checksum: sha256(bytes) }),
        });
        await expect(download(s)).resolves.toMatchObject({ data: bytes });
      },
    );

    it('refuses bytes that no longer match the stored checksum, without echoing them', async () => {
      const s = build({
        getResult: Buffer.from('tampered content'),
        linked: docRow({ checksum: sha256(pdfBytes()) }),
      });
      const e = await thrown(download(s));
      expect(e).toBeInstanceOf(InternalServerErrorException);
      expect(e.getResponse().code).toBe(ErrorCodes.DOCUMENT_INTEGRITY_ERROR);
      expect(JSON.stringify(e.getResponse())).not.toMatch(
        /tampered|documents\//,
      );
      expect(s.audit.record).not.toHaveBeenCalled();
    });

    it.each([
      [
        'a missing object',
        Object.assign(new Error('ENOENT: /srv/storage/x'), { code: 'ENOENT' }),
      ],
      ['a traversal key', new InvalidStorageKeyError('../../etc/passwd')],
    ])(
      'reports %s as a controlled integrity error with no path detail',
      async (_l, getResult) => {
        const s = build({
          getResult,
          linked: docRow({ filePath: '../../etc/passwd' }),
        });
        const e = await thrown(download(s));
        expect(e.getResponse().code).toBe(ErrorCodes.DOCUMENT_INTEGRITY_ERROR);
        expect(JSON.stringify(e.getResponse())).not.toMatch(
          /ENOENT|etc|passwd|srv/,
        );
      },
    );

    it('404s for a document that is not on the application, without touching storage', async () => {
      const s = build({ linked: null });
      const e = await thrown(download(s));
      expect(e).toBeInstanceOf(NotFoundException);
      expect(s.storage.get).not.toHaveBeenCalled();
    });

    it('takes the storage key only from the database row — never from the request', async () => {
      const bytes = pdfBytes();
      const s = build({
        getResult: bytes,
        linked: docRow({
          filePath: 'documents/2026/from-row',
          checksum: sha256(bytes),
        }),
      });
      await download(s);
      expect(s.storage.get).toHaveBeenCalledTimes(1);
      expect(s.storage.get).toHaveBeenCalledWith('documents/2026/from-row');
    });
  });
});
