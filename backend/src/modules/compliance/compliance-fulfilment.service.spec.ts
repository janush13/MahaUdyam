import {
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { ComplianceFulfilmentService } from './compliance-fulfilment.service';

const APP = '00000000-0000-4000-8000-0000000000a1';
const REC = '00000000-0000-4000-8000-0000000000b1';
const USER = '00000000-0000-4000-8000-0000000000c1';
const now = new Date('2026-10-12T06:00:00.000Z');

const access = {
  enterprise: { id: 'ent-1' },
  relation: 'OWNER',
  scope: undefined,
} as never;
const file = {
  originalname: 'return.pdf',
  mimetype: 'application/pdf',
  size: 10,
  buffer: Buffer.from('%PDF-1.4'),
};
const stored = {
  documentId: 'doc-1',
  key: 'k/1',
  checksum: 'sum',
  filename: 'return.pdf',
  mime: 'application/pdf',
  size: 10,
  scan: { scannerName: 'mock' },
};

const record = (over: Record<string, unknown> = {}) => ({
  id: REC,
  applicationId: APP,
  status: 'DUE',
  evidenceRequired: true,
  ...over,
});

function build(
  opts: {
    record?: Record<string, unknown> | null;
    freshStatus?: string;
    claimed?: number;
    dueDate?: Date | null;
    commitError?: Error;
  } = {},
) {
  const updated = {
    id: REC,
    applicationId: APP,
    complianceRequirementId: 'req-1',
    occurrenceNumber: 1,
    description: 'File the return',
    frequency: 'ONE_TIME',
    applicantAction: null,
    sourceReference: null,
    requirementVersion: 2,
    dueDate:
      'dueDate' in opts ? opts.dueDate : new Date('2026-10-10T00:00:00.000Z'),
    status: 'FULFILLED',
    evidenceRequired: true,
    fulfilledAt: now,
    fulfilledDocument: {
      id: 'doc-1',
      originalFilename: 'return.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 10,
      version: 1,
    },
    createdAt: new Date(0),
  };
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    complianceRecord: {
      findUnique: jest.fn().mockResolvedValue({
        status: opts.freshStatus ?? 'DUE',
        evidenceRequired: true,
      }),
      updateMany: jest.fn().mockResolvedValue({ count: opts.claimed ?? 1 }),
      findUniqueOrThrow: jest.fn().mockResolvedValue(updated),
    },
  };
  const prisma = {
    complianceRecord: {
      findFirst: jest
        .fn()
        .mockResolvedValue('record' in opts ? opts.record : record()),
    },
    $transaction: jest
      .fn()
      .mockImplementation((fn) =>
        opts.commitError ? Promise.reject(opts.commitError) : fn(tx),
      ),
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const applications = {
    findApplication: jest
      .fn()
      .mockResolvedValue({ id: APP, projectId: 'proj-1' }),
  };
  const documents = {
    screenAndStore: jest.fn().mockResolvedValue(stored),
    createEvidenceDocument: jest
      .fn()
      .mockResolvedValue({ id: 'doc-1', version: 1 }),
    auditEvidenceStored: jest.fn().mockResolvedValue(undefined),
    discardStoredObject: jest.fn().mockResolvedValue(undefined),
  };
  const calendar = { settings: { utcOffsetMinutes: 330 } };
  const service = new ComplianceFulfilmentService(
    prisma as never,
    audit as never,
    applications as never,
    documents as never,
    calendar as never,
  );
  return { service, prisma, tx, audit, applications, documents };
}

const fulfil = (
  b: ReturnType<typeof build>,
  f: unknown | null = file,
  recordId = REC,
) =>
  b.service.fulfil(
    access,
    'proj-1',
    APP,
    recordId,
    USER,
    (f ?? undefined) as never,
    'ip',
    now,
  );

describe('ComplianceFulfilmentService.fulfil', () => {
  it('authorises through the application lookup, then fulfils with the evidence in Step 9’s pipeline', async () => {
    const b = build();
    const out = await fulfil(b);
    expect(b.applications.findApplication).toHaveBeenCalledWith(
      access,
      'proj-1',
      APP,
    );
    // The ONE pipeline: validate / scan / store - nothing re-implemented here.
    expect(b.documents.screenAndStore).toHaveBeenCalledWith(file, null, {
      app: { id: APP },
      actorUserId: USER,
      ipAddress: 'ip',
      roleAtTime: 'APPLICANT',
      context: expect.objectContaining({
        enterpriseId: 'ent-1',
        applicationId: APP,
        actingAs: 'OWNER',
      }),
    });
    expect(b.documents.createEvidenceDocument).toHaveBeenCalledWith(
      b.tx,
      stored,
      'proj-1',
      USER,
    );
    expect(out).toMatchObject({
      id: REC,
      status: 'FULFILLED',
      fulfilledLate: true, // 2026-10-12 (IST) after a 2026-10-10 due date
      evidence: { documentId: 'doc-1', filename: 'return.pdf', version: 1 },
    });
  });

  it('fulfils with one conditional update under the record lock: status, time, actor and document together', async () => {
    const b = build();
    await fulfil(b);
    expect(b.tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      b.tx.complianceRecord.updateMany.mock.invocationCallOrder[0],
    );
    expect(b.tx.complianceRecord.updateMany).toHaveBeenCalledWith({
      where: { id: REC, status: { not: 'FULFILLED' } },
      data: {
        status: 'FULFILLED',
        fulfilledAt: now,
        fulfilledByUserId: USER,
        fulfilledDocumentId: 'doc-1',
      },
    });
  });

  it('audits the fulfilment against the application, and the evidence through the documents audit', async () => {
    const b = build();
    await fulfil(b);
    expect(b.audit.record).toHaveBeenCalledTimes(1);
    expect(b.audit.record.mock.calls[0][0]).toMatchObject({
      userId: USER,
      roleAtTime: 'APPLICANT',
      action: 'COMPLIANCE_FULFILLED',
      entityType: 'ApprovalApplication',
      entityId: APP,
      beforeState: { status: 'DUE' },
      afterState: expect.objectContaining({
        complianceRecordId: REC,
        occurrenceNumber: 1,
        requirementVersion: 2,
        dueDate: '2026-10-10',
        late: true,
        documentId: 'doc-1',
        documentVersion: 1,
      }),
    });
    expect(b.documents.auditEvidenceStored).toHaveBeenCalledTimes(1);
  });

  it('records on time vs late from the two stored dates; no due date means no verdict', async () => {
    const onTime = build({ dueDate: new Date('2026-10-12T00:00:00.000Z') });
    expect((await fulfil(onTime)).fulfilledLate).toBe(false);
    const undated = build({ dueDate: null });
    expect((await fulfil(undated)).fulfilledLate).toBeNull();
  });

  it('refuses BEFORE scanning or storing anything when required evidence is missing', async () => {
    const b = build();
    await expect(fulfil(b, null)).rejects.toMatchObject({
      response: { code: 'COMPLIANCE_EVIDENCE_REQUIRED' },
    });
    await expect(fulfil(b, null)).rejects.toBeInstanceOf(BadRequestException);
    expect(b.documents.screenAndStore).not.toHaveBeenCalled();
    expect(b.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('an obligation that needs no evidence can be fulfilled without a file (no document, no scan)', async () => {
    const b = build({ record: record({ evidenceRequired: false }) });
    await fulfil(b, null);
    expect(b.documents.screenAndStore).not.toHaveBeenCalled();
    expect(
      b.tx.complianceRecord.updateMany.mock.calls[0][0].data
        .fulfilledDocumentId,
    ).toBeNull();
    expect(b.documents.auditEvidenceStored).not.toHaveBeenCalled();
  });

  it('is permanent: an already-fulfilled obligation is a 409 that changes nothing and stores nothing', async () => {
    const b = build({ record: record({ status: 'FULFILLED' }) });
    await expect(fulfil(b)).rejects.toMatchObject({
      response: { code: 'COMPLIANCE_ALREADY_FULFILLED' },
    });
    expect(b.documents.screenAndStore).not.toHaveBeenCalled();
  });

  it('a racing fulfilment that wins first: the loser gets 409 and its stored object is discarded', async () => {
    const lostRow = build({ freshStatus: 'FULFILLED' });
    await expect(fulfil(lostRow)).rejects.toBeInstanceOf(ConflictException);
    expect(lostRow.documents.discardStoredObject).toHaveBeenCalledWith('k/1');
    expect(lostRow.audit.record).not.toHaveBeenCalled();

    const lostClaim = build({ claimed: 0 });
    await expect(fulfil(lostClaim)).rejects.toBeInstanceOf(ConflictException);
    expect(lostClaim.documents.discardStoredObject).toHaveBeenCalledWith('k/1');
  });

  it('a database failure discards the stored object and surfaces a generic 500 with no internals', async () => {
    const b = build({
      commitError: Object.assign(new Error('secret SQL k/1'), { name: 'X' }),
    });
    const error = await fulfil(b).catch((e) => e);
    expect(error).toBeInstanceOf(InternalServerErrorException);
    expect(JSON.stringify(error.getResponse())).not.toContain('secret');
    expect(b.documents.discardStoredObject).toHaveBeenCalledWith('k/1');
  });

  it('an obligation of another application, or a malformed id, is a 404 before anything is stored', async () => {
    const other = build({ record: null });
    await expect(fulfil(other)).rejects.toBeInstanceOf(NotFoundException);
    expect(
      other.prisma.complianceRecord.findFirst.mock.calls[0][0].where,
    ).toEqual({
      id: REC,
      applicationId: APP,
    });
    const bad = build();
    await expect(fulfil(bad, file, 'not-a-uuid')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(bad.prisma.complianceRecord.findFirst).not.toHaveBeenCalled();
    expect(other.documents.screenAndStore).not.toHaveBeenCalled();
  });

  it('an application the caller cannot access stops everything (the application lookup throws)', async () => {
    const b = build();
    b.applications.findApplication.mockRejectedValue(new NotFoundException());
    await expect(fulfil(b)).rejects.toBeInstanceOf(NotFoundException);
    expect(b.documents.screenAndStore).not.toHaveBeenCalled();
  });
});
