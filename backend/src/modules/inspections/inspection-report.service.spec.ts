import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { DocumentsService } from '../documents/documents.service';
import { OfficerAccessService } from '../officer/officer-access.service';
import { InspectionAccessService } from './inspection-access.service';
import { InspectionReportService } from './inspection-report.service';

const USER = '00000000-0000-4000-8000-0000000000b2';
const INSP = '33333333-3333-4333-8333-333333333333';
const EVID = '66666666-6666-4666-8666-666666666666';
const ITEM_A = '55555555-5555-4555-8555-55555555555a';
const ITEM_B = '55555555-5555-4555-8555-55555555555b';
const t = (n: number) => new Date(Date.UTC(2026, 9, 1, 0, 0, n));

const result = (id: string, item: string, seconds: number, over = {}) => ({
  id,
  checklistItemId: item,
  itemText: item === ITEM_A ? 'Fire exits clear' : 'Alarm tested',
  response: `response ${id}`,
  finding: 'COMPLIANT',
  notes: null,
  evidenceDocumentId: null,
  recordedByUserId: USER,
  recordedAt: t(seconds),
  ...over,
});

function build(view: 'OFFICER' | 'INSPECTOR' | null = 'INSPECTOR') {
  const prisma = {
    inspection: {
      findUnique: jest.fn().mockResolvedValue({
        id: INSP,
        status: 'SCHEDULED',
        application: { approvalTypeId: 'at' },
        reportSummary: null,
      }),
    },
    inspectionChecklist: {
      findMany: jest.fn().mockResolvedValue([
        { id: ITEM_A, itemText: 'Fire exits clear', sequenceOrder: 1 },
        { id: ITEM_B, itemText: 'Alarm tested', sequenceOrder: 2 },
      ]),
    },
    inspectionReport: {
      findMany: jest.fn().mockResolvedValue([
        result('a1', ITEM_A, 1),
        result('a2', ITEM_A, 3, {
          finding: 'NON_COMPLIANT',
          evidenceDocumentId: 'doc-1',
        }),
      ]),
    },
    inspectionEvidence: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: EVID,
          documentId: 'doc-1',
          capturedAt: null,
          caption: 'Exit',
          createdAt: t(2),
          uploadedByUserId: USER,
          document: {
            version: 1,
            originalFilename: 'exit.jpg',
            mimeType: 'image/jpeg',
            sizeBytes: 10,
            status: 'VALIDATION_PENDING',
            scannedAt: t(2),
            filePath: 'documents/2026/secret-key',
            checksum: 'abc',
          },
        },
      ]),
      findFirst: jest.fn(),
    },
  } as unknown as PrismaService;
  const access = {
    resolveView: jest.fn().mockResolvedValue(view),
  } as unknown as InspectionAccessService;
  const officers = {
    grantsFor: jest
      .fn()
      .mockResolvedValue([{ role: 'DEPT_ADMIN', departmentId: 'dept' }]),
  } as unknown as OfficerAccessService;
  const downloadDocument = jest.fn().mockResolvedValue({
    data: Buffer.from('x'),
    filename: 'f',
    mimeType: 'image/jpeg',
  });
  const documents = { downloadDocument } as unknown as DocumentsService;
  return {
    service: new InspectionReportService(prisma, access, officers, documents),
    prisma,
    access,
    downloadDocument,
  };
}

describe('InspectionReportService', () => {
  describe('getReport', () => {
    it('is a 404 for a malformed id, and for anyone with no view of the inspection', async () => {
      const { service, prisma } = build(null);
      await expect(service.getReport(USER, 'nope')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(service.getReport(USER, INSP)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.inspection.findUnique).not.toHaveBeenCalled();
    });

    it('shows each checklist item with its CURRENT result and every earlier one — nothing is hidden', async () => {
      const { service } = build();
      const view = await service.getReport(USER, INSP);
      const [a, b] = view.checklist;
      expect(a.text).toBe('Fire exits clear');
      expect(a.current?.id).toBe('a2');
      expect(a.current?.finding).toBe('NON_COMPLIANT');
      expect(a.earlier.map((r) => r.id)).toEqual(['a1']);
      // An unanswered item is shown as such.
      expect(b.current).toBeNull();
      expect(b.earlier).toEqual([]);
    });

    it('links a result to its evidence by the evidence id, not the document id', async () => {
      const { service } = build();
      const view = await service.getReport(USER, INSP);
      expect(view.checklist[0].current?.evidenceId).toBe(EVID);
      expect(view.checklist[0].earlier[0].evidenceId).toBeNull();
    });

    it('lists the evidence without any storage internals', async () => {
      const { service } = build();
      const view = await service.getReport(USER, INSP);
      expect(view.evidence).toHaveLength(1);
      expect(view.evidence[0]).toMatchObject({
        id: EVID,
        documentId: 'doc-1',
        originalFilename: 'exit.jpg',
        downloadable: true,
        scan: { state: 'CLEAN' },
      });
      expect(JSON.stringify(view)).not.toMatch(
        /secret-key|checksum|filePath|abc/,
      );
    });

    it('has no report until one is submitted', async () => {
      const { service } = build();
      expect((await service.getReport(USER, INSP)).report).toBeNull();
    });
  });

  describe('downloadEvidence', () => {
    const evidenceRow = {
      id: EVID,
      documentId: 'doc-1',
      document: { id: 'doc-1' },
      inspection: {
        applicationId: 'app',
        application: {
          projectId: 'proj',
          approvalType: { departmentId: 'dept' },
          project: { enterpriseId: 'ent' },
        },
      },
    };

    it('is a 404 for malformed ids, an out-of-scope caller, or evidence of another inspection', async () => {
      const denied = build(null);
      await expect(
        denied.service.downloadEvidence(USER, INSP, EVID, 'ip'),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        denied.service.downloadEvidence(USER, 'x', EVID, 'ip'),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        denied.service.downloadEvidence(USER, INSP, 'x', 'ip'),
      ).rejects.toBeInstanceOf(NotFoundException);
      const other = build();
      (
        other.prisma.inspectionEvidence.findFirst as jest.Mock
      ).mockResolvedValue(null);
      await expect(
        other.service.downloadEvidence(USER, INSP, EVID, 'ip'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(
        (other.prisma.inspectionEvidence.findFirst as jest.Mock).mock
          .calls[0][0].where,
      ).toEqual({ id: EVID, inspectionId: INSP });
    });

    it('serves through the document service with the caller’s own role and the inspection context', async () => {
      const inspector = build('INSPECTOR');
      (
        inspector.prisma.inspectionEvidence.findFirst as jest.Mock
      ).mockResolvedValue(evidenceRow);
      await inspector.service.downloadEvidence(USER, INSP, EVID, '10.0.0.1');
      expect(inspector.downloadDocument).toHaveBeenCalledWith(
        evidenceRow.document,
        { userId: USER, roleAtTime: 'INSPECTOR' },
        expect.objectContaining({
          inspectionId: INSP,
          evidenceId: EVID,
          applicationId: 'app',
          departmentId: 'dept',
          enterpriseId: 'ent',
        }),
        '10.0.0.1',
      );

      const officer = build('OFFICER');
      (
        officer.prisma.inspectionEvidence.findFirst as jest.Mock
      ).mockResolvedValue(evidenceRow);
      await officer.service.downloadEvidence(USER, INSP, EVID, 'ip');
      expect(officer.downloadDocument.mock.calls[0][1]).toEqual({
        userId: USER,
        roleAtTime: 'DEPT_ADMIN',
      });
    });
  });
});
