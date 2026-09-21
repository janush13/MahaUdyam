import { ConflictException, HttpException } from '@nestjs/common';
import { AuditActions } from '../../infrastructure/audit/audit-actions.constant';
import { CertificateService, certificateBlock } from './certificate.service';

const USER = 'user-aa';
const APP = 'app-1';

function build(
  opts: {
    earlyState?: string;
    lockedState?: string;
    decision?: unknown;
    events?: unknown[];
    txFails?: Error;
  } = {},
) {
  const events = opts.events ?? [
    {
      action: 'COMPLIANCE_OBLIGATION_CREATED',
      applicationId: APP,
      details: {},
    },
  ];
  const document = { id: 'doc-1', version: 1 };
  const certificateRow = {
    id: 'cert-1',
    applicationId: APP,
    version: 1,
    decisionId: 'dec-1',
    certificateNumber: 'DEPT/1',
    documentId: 'doc-1',
    issuedByUserId: USER,
    issuedAt: new Date(),
    department: { id: 'dept-1', code: 'D', name: 'Dept' },
    application: { projectId: 'proj-1', project: { enterpriseId: 'ent-1' } },
    document: {
      originalFilename: 'c.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 10,
      checksum: 'abc',
      status: 'VALIDATION_PENDING',
      scannedAt: new Date(),
    },
  };
  const tx = {
    approvalApplication: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    approvalDecision: {
      findUnique: jest
        .fn()
        .mockResolvedValue(
          'decision' in opts
            ? opts.decision
            : { id: 'dec-1', outcome: 'APPROVE' },
        ),
    },
    approvalCertificate: {
      create: jest.fn().mockResolvedValue({ id: 'cert-1' }),
      findUniqueOrThrow: jest.fn().mockResolvedValue(certificateRow),
    },
  };
  const order: string[] = [];
  const support = {
    run: jest.fn(
      (_ctx: unknown, fn: (tx: unknown, l: unknown) => Promise<unknown>) => {
        if (opts.txFails) {
          return Promise.reject(opts.txFails);
        }
        return fn(tx, { internalState: opts.lockedState ?? 'APPROVED' });
      },
    ),
    contextOf: jest.fn().mockReturnValue({ applicationId: APP }),
    recordOfficerEvent: jest.fn().mockResolvedValue(undefined),
  };
  const documents = {
    screenAndStore: jest
      .fn()
      .mockResolvedValue({ key: 'k', documentId: 'doc-1' }),
    createCertificateDocument: jest.fn().mockImplementation(() => {
      order.push('document');
      return Promise.resolve(document);
    }),
    auditEvidenceStored: jest.fn().mockResolvedValue(undefined),
    discardStoredObject: jest.fn().mockResolvedValue(undefined),
  };
  const compliance = {
    ensureOccurrences: jest.fn().mockImplementation(() => {
      order.push('compliance');
      return Promise.resolve(events);
    }),
    record: jest.fn().mockResolvedValue(undefined),
  };
  const access = {
    resolveApplication: jest.fn().mockResolvedValue({
      app: {
        id: APP,
        projectId: 'proj-1',
        internalState: opts.earlyState ?? 'APPROVED',
      },
      departmentId: 'dept-1',
      actingRole: 'APPROVING_AUTHORITY',
    }),
  };
  const service = new CertificateService(
    access as never,
    support as never,
    documents as never,
    compliance as never,
  );
  return { service, tx, support, documents, compliance, access, order };
}

const FILE = {
  originalname: 'c.pdf',
  mimetype: 'application/pdf',
  size: 1,
  buffer: Buffer.from('x'),
};

describe('certificateBlock', () => {
  it('admits only APPROVED; an issued certificate is "already issued"; everything else is "not allowed"', () => {
    expect(certificateBlock('APPROVED')).toBeNull();
    for (const s of ['CERTIFICATE_ISSUED', 'ACTIVE'] as const) {
      expect(
        (certificateBlock(s) as HttpException).getResponse(),
      ).toMatchObject({
        code: 'CERTIFICATE_ALREADY_ISSUED',
      });
    }
    for (const s of [
      'RECOMMENDED_FOR_APPROVAL',
      'REJECTED',
      'UNDER_SCRUTINY',
      'SUBMITTED',
    ] as const) {
      expect(
        (certificateBlock(s) as HttpException).getResponse(),
      ).toMatchObject({
        code: 'CERTIFICATE_NOT_ALLOWED',
      });
    }
  });
});

describe('CertificateService.issue', () => {
  it('is authorised as ISSUE_CERTIFICATE of the application’s own department', async () => {
    const b = build();
    await b.service.issue(USER, APP, FILE, {}, 'ip');
    expect(b.access.resolveApplication).toHaveBeenCalledWith(
      USER,
      APP,
      'ISSUE_CERTIFICATE',
    );
  });

  it('issues: APPROVED -> CERTIFICATE_ISSUED -> ACTIVE in one transaction, and creates the compliance occurrences with the issuance instant', async () => {
    const b = build();
    const updates: unknown[] = [];
    (b.tx as Record<string, unknown>).approvalApplication = {
      updateMany: jest.fn().mockImplementation((args) => {
        updates.push(args);
        return Promise.resolve({ count: 1 });
      }),
    };
    const result = await b.service.issue(
      USER,
      APP,
      FILE,
      { certificateNumber: 'DEPT/1' },
      'ip',
    );
    expect(b.support.run).toHaveBeenCalledTimes(1);
    expect(updates).toMatchObject([
      {
        where: { id: APP, internalState: 'APPROVED' },
        data: { internalState: 'CERTIFICATE_ISSUED' },
      },
      {
        where: { id: APP, internalState: 'CERTIFICATE_ISSUED' },
        data: { internalState: 'ACTIVE', applicantStatus: 'APPROVED' },
      },
    ]);
    const created = b.tx.approvalCertificate.create.mock.calls[0][0].data;
    expect(created).toMatchObject({
      applicationId: APP,
      version: 1,
      decisionId: 'dec-1',
      departmentId: 'dept-1',
      certificateNumber: 'DEPT/1',
      documentId: 'doc-1',
      issuedByUserId: USER,
    });
    // ONE instant: the certificate, and the compliance period it starts.
    expect(b.compliance.ensureOccurrences.mock.calls[0][2]).toEqual(
      created.issuedAt,
    );
    expect(b.compliance.ensureOccurrences.mock.calls[0][0]).toBe(b.tx);
    expect(result).toMatchObject({
      internalState: 'ACTIVE',
      applicantStatus: 'APPROVED',
      activatedAt: created.issuedAt,
      complianceObligationsCreated: 1,
      certificate: { id: 'cert-1', certificateNumber: 'DEPT/1' },
    });
  });

  it('the number is optional and never generated: none given, none stored', async () => {
    const b = build();
    (b.tx as Record<string, unknown>).approvalApplication = {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    };
    await b.service.issue(USER, APP, FILE, {}, 'ip');
    expect(
      b.tx.approvalCertificate.create.mock.calls[0][0].data.certificateNumber,
    ).toBeNull();
  });

  it('audits the certificate, both status changes (before/after) and the compliance events, after the commit', async () => {
    const b = build();
    (b.tx as Record<string, unknown>).approvalApplication = {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    };
    await b.service.issue(USER, APP, FILE, {}, 'ip');
    const calls = b.support.recordOfficerEvent.mock.calls;
    expect(calls.map((c) => c[1])).toEqual([
      AuditActions.APPLICATION_CERTIFICATE_ISSUED,
      AuditActions.APPLICATION_STATUS_CHANGED,
      AuditActions.APPLICATION_STATUS_CHANGED,
    ]);
    expect(calls[1][2]).toMatchObject({
      internalState: 'CERTIFICATE_ISSUED',
      performedBy: 'APPROVING_AUTHORITY',
    });
    expect(calls[2][2]).toMatchObject({
      internalState: 'ACTIVE',
      performedBy: 'SYSTEM',
    });
    expect(calls[2][4]).toMatchObject({ internalState: 'CERTIFICATE_ISSUED' });
    expect(b.documents.auditEvidenceStored).toHaveBeenCalledTimes(1);
    expect(b.compliance.record).toHaveBeenCalledWith(
      expect.any(Array),
      { userId: USER, roleAtTime: 'APPROVING_AUTHORITY', ipAddress: 'ip' },
      expect.objectContaining({ triggeredBy: 'CERTIFICATE_ISSUED' }),
    );
  });

  it.each(['RECOMMENDED_FOR_APPROVAL', 'REJECTED', 'UNDER_SCRUTINY'])(
    'refuses %s before scanning or storing anything',
    async (earlyState) => {
      const b = build({ earlyState });
      await expect(
        b.service.issue(USER, APP, FILE, {}, 'ip'),
      ).rejects.toMatchObject({
        response: { code: 'CERTIFICATE_NOT_ALLOWED' },
      });
      expect(b.documents.screenAndStore).not.toHaveBeenCalled();
    },
  );

  it.each(['CERTIFICATE_ISSUED', 'ACTIVE'])(
    'a certificate already issued (%s) is CERTIFICATE_ALREADY_ISSUED',
    async (earlyState) => {
      const b = build({ earlyState });
      await expect(
        b.service.issue(USER, APP, FILE, {}, 'ip'),
      ).rejects.toMatchObject({
        response: { code: 'CERTIFICATE_ALREADY_ISSUED' },
      });
      expect(b.documents.screenAndStore).not.toHaveBeenCalled();
    },
  );

  it('a race lost under the lock discards the stored file and issues nothing', async () => {
    const b = build({ lockedState: 'ACTIVE' });
    await expect(
      b.service.issue(USER, APP, FILE, {}, 'ip'),
    ).rejects.toMatchObject({
      response: { code: 'CERTIFICATE_ALREADY_ISSUED' },
    });
    expect(b.documents.discardStoredObject).toHaveBeenCalledWith('k');
    expect(b.tx.approvalCertificate.create).not.toHaveBeenCalled();
    expect(b.compliance.ensureOccurrences).not.toHaveBeenCalled();
    expect(b.support.recordOfficerEvent).not.toHaveBeenCalled();
  });

  it('refuses a certificate when the decision on record is not an approval', async () => {
    const b = build({ decision: { id: 'dec-1', outcome: 'REJECT' } });
    await expect(
      b.service.issue(USER, APP, FILE, {}, 'ip'),
    ).rejects.toMatchObject({
      response: { code: 'CERTIFICATE_NOT_ALLOWED' },
    });
    expect(b.documents.discardStoredObject).toHaveBeenCalledWith('k');
  });

  it('an unexpected failure discards the file and surfaces a generic 500 with no internals', async () => {
    const b = build({ txFails: new Error('secret sql detail') });
    const err = await b.service
      .issue(USER, APP, FILE, {}, 'ip')
      .catch((e) => e);
    expect(b.documents.discardStoredObject).toHaveBeenCalledWith('k');
    expect(err).toBeInstanceOf(HttpException);
    expect(JSON.stringify(err.getResponse())).not.toContain('secret');
    expect(err.getStatus()).toBe(500);
    expect(b.support.recordOfficerEvent).not.toHaveBeenCalled();
  });

  it('a rejected upload (screening fails) never opens the transaction', async () => {
    const b = build();
    b.documents.screenAndStore.mockRejectedValue(new ConflictException('nope'));
    await expect(
      b.service.issue(USER, APP, FILE, {}, 'ip'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(b.support.run).not.toHaveBeenCalled();
  });
});
