import {
  BadRequestException,
  ConflictException,
  HttpException,
  InternalServerErrorException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { DocumentsService } from '../documents/documents.service';
import { ScrutinySupport } from '../officer/scrutiny-support.service';
import { InspectionAccessService } from './inspection-access.service';
import {
  InspectionExecutionService,
  parseCaptureTime,
} from './inspection-execution.service';

const USER = '00000000-0000-4000-8000-0000000000b2';
const OTHER = '00000000-0000-4000-8000-0000000000c3';
const INSP = '33333333-3333-4333-8333-333333333333';
const APP = '11111111-1111-4111-8111-111111111111';
const ITEM = '55555555-5555-4555-8555-555555555555';
const EVID = '66666666-6666-4666-8666-666666666666';
const FUTURE = new Date(Date.now() + 86_400_000);
const FUTURE_ISO = new Date(Date.now() + 2 * 86_400_000).toISOString();

const inspectionRow = (over: Record<string, unknown> = {}) => ({
  id: INSP,
  applicationId: APP,
  inspectorId: USER,
  status: 'SCHEDULED',
  scheduledAt: FUTURE,
  confirmedAt: null,
  confirmedByUserId: null,
  siteAddress: 'Plot 4',
  assignedAt: new Date(),
  createdAt: new Date(),
  updatedAt: new Date(),
  application: {
    referenceNumber: 'APP-1',
    approvalType: {
      id: 'at',
      name: 'Approval',
      department: { id: 'dept', name: 'Dept' },
    },
    project: { id: 'proj', name: 'Project' },
  },
  inspector: { id: USER, name: 'Inspector' },
  assignedBy: { id: OTHER, name: 'Officer' },
  ...over,
});

interface Options {
  scoped?: boolean;
  state?: string;
  inspection?: Record<string, unknown> | null;
  item?: object | null;
  evidence?: object | null;
  previousResult?: object | null;
  items?: Array<{ id: string; itemText: string }>;
  results?: Array<{ id: string; checklistItemId: string; recordedAt: Date }>;
  evidenceCount?: number;
  txError?: Error;
  screenError?: Error;
}

function build(o: Options = {}) {
  const current = o.inspection === undefined ? inspectionRow() : o.inspection;
  const tx = {
    inspection: {
      findUnique: jest.fn().mockResolvedValue(current),
      update: jest
        .fn()
        .mockImplementation(({ data }) =>
          Promise.resolve(inspectionRow({ ...(current ?? {}), ...data })),
        ),
    },
    inspectionChecklist: {
      findFirst: jest
        .fn()
        .mockResolvedValue(
          o.item === undefined
            ? { id: ITEM, itemText: 'Fire exits clear' }
            : o.item,
        ),
      findMany: jest
        .fn()
        .mockResolvedValue(
          o.items ?? [{ id: ITEM, itemText: 'Fire exits clear' }],
        ),
    },
    inspectionEvidence: {
      findFirst: jest.fn().mockResolvedValue(
        o.evidence === undefined
          ? {
              id: EVID,
              documentId: 'doc-1',
              document: { status: 'VALIDATION_PENDING', scannedAt: new Date() },
            }
          : o.evidence,
      ),
      create: jest.fn().mockResolvedValue({
        id: EVID,
        documentId: 'doc-1',
        capturedAt: null,
        caption: null,
        createdAt: new Date(),
        uploadedByUserId: USER,
      }),
      count: jest.fn().mockResolvedValue(o.evidenceCount ?? 0),
    },
    inspectionReport: {
      findFirst: jest.fn().mockResolvedValue(o.previousResult ?? null),
      findMany: jest
        .fn()
        .mockResolvedValue(
          o.results ?? [
            { id: 'r1', checklistItemId: ITEM, recordedAt: new Date() },
          ],
        ),
      create: jest.fn().mockImplementation(({ data }) =>
        Promise.resolve({
          id: 'result-1',
          notes: null,
          recordedAt: new Date(),
          ...data,
        }),
      ),
    },
    inspectionReportSummary: {
      create: jest
        .fn()
        .mockImplementation(({ data }) =>
          Promise.resolve({ id: 'rep-1', submittedAt: new Date(), ...data }),
        ),
    },
  };
  const prisma = {
    inspection: {
      findFirst: jest.fn().mockResolvedValue(
        o.scoped === false
          ? null
          : {
              id: INSP,
              applicationId: APP,
              application: {
                projectId: 'proj',
                approvalTypeId: 'at',
                discoveryContext: null,
                approvalType: { departmentId: 'dept' },
                project: { enterpriseId: 'ent' },
              },
            },
      ),
      findUnique: jest.fn().mockResolvedValue(
        current && {
          status: (current as { status: string }).status,
          inspectorId: (current as { inspectorId: string }).inspectorId,
          application: { internalState: o.state ?? 'UNDER_SCRUTINY' },
        },
      ),
    },
    $transaction: jest.fn((fn: (t: unknown) => unknown) =>
      o.txError ? Promise.reject(o.txError) : fn(tx),
    ),
  } as unknown as PrismaService;
  const record = jest.fn();
  const audit = { record } as unknown as AuditService;
  const access = {
    scopes: jest.fn().mockResolvedValue({
      officer: { id: { in: [] } },
      inspector: { marker: 1 },
    }),
  } as unknown as InspectionAccessService;
  const lock = jest
    .fn()
    .mockResolvedValue({ internalState: o.state ?? 'UNDER_SCRUTINY' });
  const support = { lock } as unknown as ScrutinySupport;
  const stored = {
    documentId: 'doc-1',
    key: 'documents/2026/k',
    checksum: 'sum',
    filename: 'a.jpg',
    mime: 'image/jpeg',
    size: 10,
    scan: { verdict: 'CLEAN', scannerName: 'DEV' },
  };
  const documents = {
    screenAndStore: o.screenError
      ? jest.fn().mockRejectedValue(o.screenError)
      : jest.fn().mockResolvedValue(stored),
    createEvidenceDocument: jest.fn().mockResolvedValue({
      id: 'doc-1',
      version: 1,
      originalFilename: 'a.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 10,
      status: 'VALIDATION_PENDING',
      scannedAt: new Date(),
    }),
    auditEvidenceStored: jest.fn(),
    discardStoredObject: jest.fn(),
  } as unknown as DocumentsService;
  const notifications = {
    inspectionRescheduled: jest.fn().mockResolvedValue(undefined),
  };
  const service = new InspectionExecutionService(
    prisma,
    audit,
    access,
    support,
    documents,
    notifications as never,
  );
  return {
    service,
    tx,
    prisma,
    record,
    access,
    lock,
    documents,
    stored,
    notifications,
  };
}

const file = {
  originalname: 'a.jpg',
  mimetype: 'image/jpeg',
  size: 10,
  buffer: Buffer.from('x'),
};

describe('InspectionExecutionService', () => {
  describe('who may act (resolve)', () => {
    it('is a 404 for a malformed id, and never touches the database', async () => {
      const { service, prisma } = build();
      await expect(service.confirm(USER, 'nope', 'ip')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.inspection.findFirst).not.toHaveBeenCalled();
    });

    it('is a 404 when the caller is not this inspection’s Inspector in the department (any other inspector, another department, an officer)', async () => {
      const { service, tx } = build({ scoped: false });
      await expect(service.confirm(USER, INSP, 'ip')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(tx.inspection.update).not.toHaveBeenCalled();
    });

    it('resolves the department, project and enterprise from the inspection, never from the request', async () => {
      const { service, prisma, access } = build();
      await service.confirm(USER, INSP, 'ip');
      const where = (prisma.inspection.findFirst as jest.Mock).mock.calls[0][0]
        .where;
      expect(access.scopes).toHaveBeenCalledWith(USER);
      expect(where).toEqual({ AND: [{ id: INSP }, { marker: 1 }] });
    });

    it('locks the application row, and a REASSIGNED inspector loses access even mid-request', async () => {
      const { service, lock, tx } = build({
        inspection: inspectionRow({ inspectorId: OTHER }),
      });
      await expect(service.confirm(USER, INSP, 'ip')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(lock).toHaveBeenCalledTimes(1);
      expect(tx.inspection.update).not.toHaveBeenCalled();
    });

    it.each(['COMPLETED', 'CANCELLED'])(
      'refuses a %s inspection (409 INSPECTION_NOT_MODIFIABLE)',
      async (status) => {
        const { service } = build({ inspection: inspectionRow({ status }) });
        await expect(service.confirm(USER, INSP, 'ip')).rejects.toMatchObject({
          response: { code: 'INSPECTION_NOT_MODIFIABLE' },
        });
      },
    );

    it.each(['SUBMITTED', 'RECOMMENDED_FOR_APPROVAL', 'APPROVED'])(
      'refuses once scrutiny is not under way (application %s)',
      async (state) => {
        const { service } = build({ state });
        await expect(service.confirm(USER, INSP, 'ip')).rejects.toMatchObject({
          response: { code: 'INSPECTION_NOT_MODIFIABLE' },
        });
      },
    );

    it('a PENDING inspection has no schedule: 409 INSPECTION_NOT_SCHEDULED for every action', async () => {
      const pending = inspectionRow({ status: 'PENDING', scheduledAt: null });
      for (const act of [
        (s: InspectionExecutionService) => s.confirm(USER, INSP, 'ip'),
        (s: InspectionExecutionService) =>
          s.reschedule(
            USER,
            INSP,
            { scheduledAt: FUTURE_ISO, reason: 'r' },
            'ip',
          ),
        (s: InspectionExecutionService) =>
          s.recordResult(
            USER,
            INSP,
            { checklistItemId: ITEM, response: 'x', finding: 'COMPLIANT' },
            'ip',
          ),
        (s: InspectionExecutionService) =>
          s.submitReport(
            USER,
            INSP,
            { overallFinding: 'COMPLIANT', summary: 's' },
            'ip',
          ),
      ]) {
        const { service } = build({ inspection: pending });
        await expect(act(service)).rejects.toMatchObject({
          response: { code: 'INSPECTION_NOT_SCHEDULED' },
        });
      }
    });
  });

  describe('confirm', () => {
    it('records who and when as data — no status changes — and audits with the inspector’s context', async () => {
      const { service, tx, record } = build();
      const dto = await service.confirm(USER, INSP, '10.0.0.1');
      const data = tx.inspection.update.mock.calls[0][0].data;
      expect(data).toEqual({
        confirmedAt: expect.any(Date),
        confirmedByUserId: USER,
      });
      expect(data).not.toHaveProperty('status');
      expect(dto.confirmedAt).toBeInstanceOf(Date);
      expect(dto.assignedBy).toBeNull();
      expect(record).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: USER,
          roleAtTime: 'INSPECTOR',
          action: 'INSPECTION_CONFIRMED',
          entityType: 'ApprovalApplication',
          entityId: APP,
          ipAddress: '10.0.0.1',
          afterState: expect.objectContaining({
            inspectionId: INSP,
            applicationId: APP,
            projectId: 'proj',
            enterpriseId: 'ent',
            departmentId: 'dept',
            actingAs: 'INSPECTOR',
          }),
        }),
      );
    });

    it('is a 409 INSPECTION_ALREADY_CONFIRMED the second time', async () => {
      const { service } = build({
        inspection: inspectionRow({ confirmedAt: new Date() }),
      });
      await expect(service.confirm(USER, INSP, 'ip')).rejects.toMatchObject({
        response: { code: 'INSPECTION_ALREADY_CONFIRMED' },
      });
    });
  });

  describe('reschedule', () => {
    it('moves the schedule, withdraws the confirmation, and audits before / after with the reason', async () => {
      const { service, tx, record } = build({
        inspection: inspectionRow({ confirmedAt: new Date() }),
      });
      await service.reschedule(
        USER,
        INSP,
        { scheduledAt: FUTURE_ISO, reason: 'Site closed' },
        'ip',
      );
      expect(tx.inspection.update.mock.calls[0][0].data).toEqual({
        scheduledAt: new Date(FUTURE_ISO),
        confirmedAt: null,
        confirmedByUserId: null,
      });
      const event = record.mock.calls[0][0];
      expect(event.action).toBe('INSPECTION_RESCHEDULED');
      expect(event.roleAtTime).toBe('INSPECTOR');
      expect(event.afterState).toMatchObject({
        reason: 'Site closed',
        rescheduledBy: 'INSPECTOR',
      });
      expect(event.beforeState).toMatchObject({ scheduledAt: FUTURE });
    });

    it('rejects a past date before touching the database, and a date that changes nothing', async () => {
      const past = build();
      await expect(
        past.service.reschedule(
          USER,
          INSP,
          { scheduledAt: '2020-01-01T00:00:00Z', reason: 'r' },
          'ip',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(past.prisma.$transaction).not.toHaveBeenCalled();
      const same = build();
      await expect(
        same.service.reschedule(
          USER,
          INSP,
          { scheduledAt: FUTURE.toISOString(), reason: 'r' },
          'ip',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('recordResult', () => {
    const dto = {
      checklistItemId: ITEM,
      response: 'Clear',
      finding: 'COMPLIANT' as const,
    };

    it('appends a result with the item’s wording as it is now, the inspector as recorder, and no client-set identity', async () => {
      const { service, tx } = build();
      const res = await service.recordResult(USER, INSP, dto, 'ip');
      expect(tx.inspectionReport.create.mock.calls[0][0].data).toEqual({
        inspectionId: INSP,
        checklistItemId: ITEM,
        itemText: 'Fire exits clear',
        response: 'Clear',
        finding: 'COMPLIANT',
        notes: null,
        evidenceDocumentId: null,
        recordedByUserId: USER,
      });
      expect(res).toMatchObject({
        itemText: 'Fire exits clear',
        evidenceId: null,
      });
    });

    it('looks the item up within THIS approval’s checklist only (422 otherwise)', async () => {
      const { service, tx } = build({ item: null });
      await expect(
        service.recordResult(USER, INSP, dto, 'ip'),
      ).rejects.toMatchObject({ response: { code: 'INVALID_CHECKLIST_ITEM' } });
      expect(tx.inspectionChecklist.findFirst.mock.calls[0][0].where).toEqual({
        id: ITEM,
        approvalTypeId: 'at',
      });
      expect(tx.inspectionReport.create).not.toHaveBeenCalled();
    });

    it('cites evidence only if it belongs to THIS inspection and is scanned and usable', async () => {
      const ok = build();
      const res = await ok.service.recordResult(
        USER,
        INSP,
        { ...dto, evidenceId: EVID },
        'ip',
      );
      expect(ok.tx.inspectionEvidence.findFirst.mock.calls[0][0].where).toEqual(
        {
          id: EVID,
          inspectionId: INSP,
        },
      );
      expect(ok.tx.inspectionReport.create.mock.calls[0][0].data).toMatchObject(
        {
          evidenceDocumentId: 'doc-1',
        },
      );
      expect(res.evidenceId).toBe(EVID);

      for (const evidence of [
        null,
        {
          id: EVID,
          documentId: 'd',
          document: { status: 'VALIDATION_PENDING', scannedAt: null },
        },
        {
          id: EVID,
          documentId: 'd',
          document: { status: 'REJECTED', scannedAt: new Date() },
        },
        {
          id: EVID,
          documentId: 'd',
          document: { status: 'EXPIRED', scannedAt: new Date() },
        },
      ]) {
        const bad = build({ evidence });
        await expect(
          bad.service.recordResult(
            USER,
            INSP,
            { ...dto, evidenceId: EVID },
            'ip',
          ),
        ).rejects.toMatchObject({ response: { code: 'EVIDENCE_NOT_USABLE' } });
        expect(bad.tx.inspectionReport.create).not.toHaveBeenCalled();
      }
    });

    it('audits the finding and which earlier result a correction supersedes', async () => {
      const { service, record } = build({ previousResult: { id: 'older' } });
      await service.recordResult(
        USER,
        INSP,
        { ...dto, finding: 'NON_COMPLIANT' },
        'ip',
      );
      expect(record.mock.calls[0][0]).toMatchObject({
        action: 'INSPECTION_RESULT_RECORDED',
        roleAtTime: 'INSPECTOR',
        afterState: {
          finding: 'NON_COMPLIANT',
          checklistItemId: ITEM,
          supersedesResultId: 'older',
          inspectionId: INSP,
        },
      });
    });
  });

  describe('attachEvidence', () => {
    it('uses the shared Step 9 pipeline with the inspector as the audit actor, records it in one transaction, then audits', async () => {
      const { service, documents, tx, record } = build();
      const dto = await service.attachEvidence(
        USER,
        INSP,
        file,
        { caption: 'Exit' },
        'ip',
      );
      const [passedFile, requirement, target] = (
        documents.screenAndStore as jest.Mock
      ).mock.calls[0];
      expect(passedFile).toBe(file);
      expect(requirement).toBeNull();
      expect(target).toMatchObject({
        actorUserId: USER,
        roleAtTime: 'INSPECTOR',
        app: { id: APP },
        context: { inspectionId: INSP, departmentId: 'dept' },
      });
      // The document is owned by the application's PROJECT and uploaded by the inspector.
      expect(documents.createEvidenceDocument).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({ documentId: 'doc-1' }),
        'proj',
        USER,
      );
      expect(tx.inspectionEvidence.create.mock.calls[0][0].data).toEqual({
        inspectionId: INSP,
        documentId: 'doc-1',
        uploadedByUserId: USER,
        capturedAt: null,
        caption: 'Exit',
      });
      expect(documents.auditEvidenceStored).toHaveBeenCalledTimes(1);
      expect(record.mock.calls[0][0]).toMatchObject({
        action: 'INSPECTION_EVIDENCE_ATTACHED',
        roleAtTime: 'INSPECTOR',
      });
      expect(dto).toMatchObject({ documentId: 'doc-1', downloadable: true });
      expect(JSON.stringify(dto)).not.toMatch(/filePath|storage|checksum|key/i);
    });

    it('refuses BEFORE scanning or storing when the inspection cannot take evidence', async () => {
      for (const o of [
        { inspection: inspectionRow({ status: 'PENDING', scheduledAt: null }) },
        { inspection: inspectionRow({ status: 'COMPLETED' }) },
        { inspection: inspectionRow({ inspectorId: OTHER }) },
        { state: 'RECOMMENDED_FOR_APPROVAL' },
      ]) {
        const { service, documents } = build(o);
        await expect(
          service.attachEvidence(USER, INSP, file, {}, 'ip'),
        ).rejects.toBeInstanceOf(HttpException);
        expect(documents.screenAndStore).not.toHaveBeenCalled();
      }
    });

    it('rejects a capture time in the future, but tolerates small clock drift', async () => {
      const { service, documents } = build();
      await expect(
        service.attachEvidence(
          USER,
          INSP,
          file,
          { capturedAt: new Date(Date.now() + 3_600_000).toISOString() },
          'ip',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(documents.screenAndStore).not.toHaveBeenCalled();
      expect(
        parseCaptureTime(
          new Date(Date.now() + 60_000).toISOString(),
          new Date(),
        ),
      ).toBeInstanceOf(Date);
    });

    it('a rejected file (infected, invalid, unscannable) is never recorded', async () => {
      const err = new UnprocessableEntityException({
        code: 'MALWARE_DETECTED',
        message: 'x',
      });
      const { service, tx, documents } = build({ screenError: err });
      await expect(
        service.attachEvidence(USER, INSP, file, {}, 'ip'),
      ).rejects.toBe(err);
      expect(tx.inspectionEvidence.create).not.toHaveBeenCalled();
      expect(documents.createEvidenceDocument).not.toHaveBeenCalled();
    });

    it('removes the stored object if the database step fails, and never leaks its detail', async () => {
      const { service, documents } = build({
        txError: new Error(
          'duplicate key value violates unique constraint "documents_file_path_key" (documents/2026/k)',
        ),
      });
      const error = await service
        .attachEvidence(USER, INSP, file, {}, 'ip')
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(InternalServerErrorException);
      expect(
        JSON.stringify((error as InternalServerErrorException).getResponse()),
      ).not.toMatch(/documents\/2026\/k|unique constraint/);
      expect(documents.discardStoredObject).toHaveBeenCalledWith(
        'documents/2026/k',
      );
    });

    it('passes a controlled outcome (e.g. reassigned mid-upload) through, and still removes the file', async () => {
      const { service, documents } = build({
        txError: new ConflictException({
          code: 'INSPECTION_NOT_MODIFIABLE',
          message: 'm',
        }),
      });
      await expect(
        service.attachEvidence(USER, INSP, file, {}, 'ip'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(documents.discardStoredObject).toHaveBeenCalledTimes(1);
    });
  });

  describe('submitReport (the only transition: SCHEDULED -> COMPLETED)', () => {
    const dto = {
      overallFinding: 'COMPLIANT' as const,
      summary: 'All in order',
    };

    it('writes the report, then completes the inspection, atomically, and audits both', async () => {
      const { service, tx, record } = build({ evidenceCount: 2 });
      const res = await service.submitReport(USER, INSP, dto, 'ip');
      expect(tx.inspectionReportSummary.create.mock.calls[0][0].data).toEqual({
        inspectionId: INSP,
        overallFinding: 'COMPLIANT',
        summary: 'All in order',
        correctiveAction: null,
        submittedByUserId: USER,
      });
      expect(tx.inspection.update.mock.calls[0][0].data).toEqual({
        status: 'COMPLETED',
      });
      expect(res.inspection.status).toBe('COMPLETED');
      expect(res.report).toMatchObject({
        overallFinding: 'COMPLIANT',
        submittedByUserId: USER,
      });
      expect(record.mock.calls.map((c) => c[0].action)).toEqual([
        'INSPECTION_REPORT_SUBMITTED',
        'INSPECTION_COMPLETED',
      ]);
      expect(record.mock.calls[0][0].afterState).toMatchObject({
        overallFinding: 'COMPLIANT',
        checklistResults: 1,
        evidenceCount: 2,
      });
      expect(record.mock.calls[1][0].beforeState).toEqual({
        status: 'SCHEDULED',
      });
      expect(record.mock.calls[1][0].afterState).toMatchObject({
        status: 'COMPLETED',
      });
    });

    it('a NON_COMPLIANT report needs a corrective-action recommendation, and nothing is written without one', async () => {
      const { service, tx } = build();
      await expect(
        service.submitReport(
          USER,
          INSP,
          { overallFinding: 'NON_COMPLIANT', summary: 's' },
          'ip',
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(tx.inspectionReportSummary.create).not.toHaveBeenCalled();
      const ok = build();
      await ok.service.submitReport(
        USER,
        INSP,
        {
          overallFinding: 'NON_COMPLIANT',
          summary: 's',
          correctiveAction: 'Clear the exit',
        },
        'ip',
      );
      expect(
        ok.tx.inspectionReportSummary.create.mock.calls[0][0].data
          .correctiveAction,
      ).toBe('Clear the exit');
    });

    it('is a 422 CHECKLIST_INCOMPLETE naming the unanswered items, and nothing is written', async () => {
      const { service, tx, record } = build({
        items: [
          { id: ITEM, itemText: 'Fire exits clear' },
          { id: 'item-2', itemText: 'Alarm tested' },
        ],
      });
      const failure = service.submitReport(USER, INSP, dto, 'ip');
      await expect(failure).rejects.toMatchObject({
        response: {
          code: 'CHECKLIST_INCOMPLETE',
          fields: { checklist: ['No result recorded for: Alarm tested'] },
        },
      });
      expect(tx.inspectionReportSummary.create).not.toHaveBeenCalled();
      expect(tx.inspection.update).not.toHaveBeenCalled();
      expect(record).not.toHaveBeenCalled();
    });

    it('a department with no checklist configured can still submit a report', async () => {
      const { service } = build({ items: [], results: [] });
      await expect(
        service.submitReport(USER, INSP, dto, 'ip'),
      ).resolves.toBeDefined();
    });

    it('a corrected result satisfies its checklist item (the latest counts)', async () => {
      const { service } = build({
        results: [
          { id: 'r1', checklistItemId: ITEM, recordedAt: new Date(1) },
          { id: 'r2', checklistItemId: ITEM, recordedAt: new Date(2) },
        ],
      });
      await expect(
        service.submitReport(USER, INSP, dto, 'ip'),
      ).resolves.toBeDefined();
    });
  });
});

describe('InspectionExecutionService.reschedule: notifying the applicant (FRD 26.1)', () => {
  it('tells the applicant side of the new date, after the change is made', async () => {
    const { service, notifications } = build({
      inspection: inspectionRow({ confirmedAt: new Date() }),
    });
    await service.reschedule(
      USER,
      INSP,
      { scheduledAt: FUTURE_ISO, reason: 'Site closed' },
      'ip',
    );
    expect(notifications.inspectionRescheduled).toHaveBeenCalledWith(
      APP,
      INSP,
      new Date(FUTURE_ISO),
      expect.any(Date),
    );
  });

  it('a refused reschedule (past date) notifies nobody', async () => {
    const { service, notifications } = build();
    await expect(
      service.reschedule(
        USER,
        INSP,
        { scheduledAt: '2020-01-01T00:00:00Z', reason: 'x' },
        'ip',
      ),
    ).rejects.toBeDefined();
    expect(notifications.inspectionRescheduled).not.toHaveBeenCalled();
  });
});
