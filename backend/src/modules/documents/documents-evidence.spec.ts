import { UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  eicarPdf,
  jpegBytes,
  pdfBytes,
} from '../../../test/support/document-fixtures';
import { AppConfig } from '../../config/configuration';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { StorageService } from '../../infrastructure/storage/storage.interface';
import { ApplicationsService } from '../applications/applications.service';
import { DevMockMalwareScanner } from './dev-mock-malware-scanner';
import {
  DocumentsService,
  ScanAuditTarget,
  UploadedFileLike,
} from './documents.service';

const APP = '40000000-0000-4000-8000-000000000001';
const USER = '00000000-0000-4000-8000-0000000000b2';
const PROJECT = '00000000-0000-4000-8000-0000000000e5';

const file = (
  data: Buffer,
  name = 'photo.jpg',
  mimetype = 'image/jpeg',
): UploadedFileLike => ({
  originalname: name,
  mimetype,
  size: data.length,
  buffer: data,
});

const target = (): ScanAuditTarget => ({
  app: { id: APP },
  actorUserId: USER,
  ipAddress: '10.0.0.1',
  roleAtTime: 'INSPECTOR',
  context: {
    inspectionId: 'insp-1',
    departmentId: 'dept',
    actingAs: 'INSPECTOR',
  },
});

function build() {
  const put = jest.fn().mockResolvedValue(undefined);
  const del = jest.fn().mockResolvedValue(undefined);
  const record = jest.fn().mockResolvedValue(undefined);
  const create = jest.fn().mockImplementation(({ data }) =>
    Promise.resolve({
      ...data,
      version: 1,
      lineageId: 'lin',
      createdAt: new Date(),
    }),
  );
  const service = new DocumentsService(
    { document: { create } } as unknown as PrismaService,
    { record } as unknown as AuditService,
    {} as ApplicationsService,
    { get: () => 10 * 1024 * 1024 } as unknown as ConfigService<
      AppConfig,
      true
    >,
    { put, delete: del, get: jest.fn() } as unknown as StorageService,
    new DevMockMalwareScanner(),
  );
  return { service, put, del, record, create };
}

describe('DocumentsService — the shared pipeline used for inspection evidence', () => {
  describe('screenAndStore', () => {
    it('validates, scans and stores a clean photo under a server-generated key, and returns what to record', async () => {
      const { service, put } = build();
      const data = jpegBytes('evidence');
      const stored = await service.screenAndStore(file(data), null, target());
      expect(put).toHaveBeenCalledTimes(1);
      const [key, bytes, options] = put.mock.calls[0];
      expect(key).toBe(stored.key);
      expect(key).not.toMatch(/photo|jpg/);
      expect(bytes).toBe(data);
      expect(options).toEqual({ overwrite: false });
      expect(stored).toMatchObject({
        filename: 'photo.jpg',
        mime: 'image/jpeg',
        size: data.length,
        scan: { verdict: 'CLEAN' },
      });
      expect(stored.checksum).toMatch(/^[0-9a-f]{64}$/);
    });

    it('an infected file is rejected, never stored, and audited under the INSPECTOR’s role and context', async () => {
      const { service, put, record } = build();
      await expect(
        service.screenAndStore(
          file(eicarPdf(), 'x.pdf', 'application/pdf'),
          null,
          target(),
        ),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
      expect(put).not.toHaveBeenCalled();
      const event = record.mock.calls[0][0];
      expect(event).toMatchObject({
        userId: USER,
        roleAtTime: 'INSPECTOR',
        action: 'DOCUMENT_SCAN_REJECTED',
        entityType: 'ApprovalApplication',
        entityId: APP,
        ipAddress: '10.0.0.1',
      });
      expect(event.afterState).toMatchObject({
        inspectionId: 'insp-1',
        stored: false,
      });
    });

    it('a missing file, or a type that is not really what it claims, is refused before the scanner runs', async () => {
      const { service, put } = build();
      await expect(
        service.screenAndStore(undefined, null, target()),
      ).rejects.toMatchObject({
        response: { code: 'FILE_REQUIRED' },
      });
      await expect(
        service.screenAndStore(
          file(pdfBytes(), 'photo.jpg', 'image/jpeg'),
          null,
          target(),
        ),
      ).rejects.toMatchObject({ response: { code: 'MIME_TYPE_MISMATCH' } });
      expect(put).not.toHaveBeenCalled();
    });
  });

  describe('createEvidenceDocument', () => {
    it('records the file as a PROJECT-owned, scanned, awaiting-review document uploaded by the inspector — never linked to the applicant’s document list', async () => {
      const { service, create } = build();
      const stored = await build().service.screenAndStore(
        file(jpegBytes('e2')),
        null,
        target(),
      );
      const tx = { document: { create } } as never;
      await service.createEvidenceDocument(tx, stored, PROJECT, USER);
      const data = create.mock.calls[0][0].data;
      expect(data).toMatchObject({
        id: stored.documentId,
        ownerType: 'PROJECT',
        ownerId: PROJECT,
        status: 'VALIDATION_PENDING',
        uploadedBy: USER,
        filePath: stored.key,
        checksum: stored.checksum,
        scannerName: 'DEV_MOCK_EICAR',
      });
      expect(data.scannedAt).toBeInstanceOf(Date);
      expect(data).not.toHaveProperty('documentRequirementId');
      // Only the document row is created: there is no application association.
      expect(Object.keys((tx as { document: object }).document)).toEqual([
        'create',
      ]);
    });
  });

  describe('auditEvidenceStored', () => {
    it('records the scan and the upload with the inspector’s role and the inspection context', async () => {
      const { service, record } = build();
      const stored = await service.screenAndStore(
        file(jpegBytes('e3')),
        null,
        target(),
      );
      await service.auditEvidenceStored(
        {
          id: stored.documentId,
          version: 1,
          lineageId: 'lin',
          originalFilename: 'photo.jpg',
          mimeType: 'image/jpeg',
          sizeBytes: 10,
        } as never,
        stored,
        { userId: USER, roleAtTime: 'INSPECTOR' },
        { inspectionId: 'insp-1' },
        '10.0.0.1',
      );
      const events = record.mock.calls.map((c) => c[0]);
      expect(events.map((e) => e.action)).toEqual([
        'DOCUMENT_SCAN_COMPLETED',
        'DOCUMENT_UPLOADED',
      ]);
      for (const e of events) {
        expect(e).toMatchObject({
          userId: USER,
          roleAtTime: 'INSPECTOR',
          entityType: 'Document',
        });
        expect(e.afterState).toMatchObject({
          inspectionId: 'insp-1',
          documentId: stored.documentId,
        });
      }
    });
  });

  describe('discardStoredObject', () => {
    it('removes the stored object, and never throws if that fails', async () => {
      const { service, del } = build();
      await service.discardStoredObject('documents/2026/k');
      expect(del).toHaveBeenCalledWith('documents/2026/k');
      del.mockRejectedValueOnce(new Error('disk'));
      await expect(
        service.discardStoredObject('documents/2026/k'),
      ).resolves.toBeUndefined();
    });
  });
});
