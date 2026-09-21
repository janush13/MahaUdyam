import { NotFoundException } from '@nestjs/common';
import { ComplianceViewService } from './compliance-view.service';
import {
  DUE_DATE_NOT_CONFIGURED,
  NO_OBLIGATIONS_NOTE,
} from './dto/compliance-response.dto';

const APP = '00000000-0000-4000-8000-0000000000a1';
const REC = '00000000-0000-4000-8000-0000000000b1';

const row = (over: Record<string, unknown> = {}) => ({
  id: REC,
  applicationId: APP,
  complianceRequirementId: 'req-1',
  occurrenceNumber: 1,
  description: 'File the return',
  frequency: 'ANNUAL',
  applicantAction: 'Upload it',
  sourceReference: 'Notice 4',
  requirementVersion: 2,
  dueDate: new Date('2026-10-10T00:00:00.000Z'),
  status: 'DUE',
  evidenceRequired: true,
  fulfilledAt: null,
  fulfilledDocument: null,
  createdAt: new Date(0),
  ...over,
});

const officerWhere = { id: { in: ['visible'] } };

function build(
  opts: {
    rows?: Array<ReturnType<typeof row>>;
    one?: ReturnType<typeof row> | null;
    withEvidence?: Record<string, unknown> | null;
    total?: number;
  } = {},
) {
  const prisma = {
    complianceRecord: {
      findMany: jest.fn().mockResolvedValue(opts.rows ?? [row()]),
      findFirst: jest
        .fn()
        .mockImplementation((args) =>
          Promise.resolve(
            args.include?.fulfilledDocument === true
              ? 'withEvidence' in opts
                ? opts.withEvidence
                : { id: REC, fulfilledDocument: null }
              : 'one' in opts
                ? opts.one
                : row(),
          ),
        ),
      count: jest.fn().mockResolvedValue(opts.total ?? 0),
    },
  };
  const officers = {
    grantsFor: jest
      .fn()
      .mockResolvedValue([{ role: 'DEPT_ADMIN', departmentId: 'd' }]),
    visibilityWhere: jest.fn().mockReturnValue(officerWhere),
    resolveApplication: jest.fn().mockResolvedValue({
      app: { id: APP, referenceNumber: 'APP-1' },
      departmentId: 'dept-1',
      actingRole: 'DEPT_ADMIN',
    }),
  };
  const applications = {
    findApplication: jest
      .fn()
      .mockResolvedValue({ id: APP, projectId: 'proj-1' }),
  };
  const documents = {
    downloadDocument: jest.fn().mockResolvedValue({
      data: Buffer.from('x'),
      filename: 'r.pdf',
      mimeType: 'application/pdf',
    }),
  };
  const calendar = { settings: { utcOffsetMinutes: 330 } };
  return {
    service: new ComplianceViewService(
      prisma as never,
      officers as never,
      applications as never,
      documents as never,
      calendar as never,
    ),
    prisma,
    officers,
    applications,
    documents,
  };
}

const access = (over: Record<string, unknown> = {}) =>
  ({
    enterprise: { id: 'ent-1' },
    relation: 'OWNER',
    scopedProjectIds: [],
    ...over,
  }) as never;

describe('ComplianceViewService: the applicant', () => {
  it('lists an application’s obligations, each occurrence its own item, from what was stored', async () => {
    const b = build({
      rows: [
        row(),
        row({
          id: 'r2',
          occurrenceNumber: 2,
          dueDate: new Date('2027-10-10T00:00:00.000Z'),
        }),
      ],
    });
    const out = await b.service.forApplication(access(), 'proj-1', APP);
    expect(b.applications.findApplication).toHaveBeenCalledWith(
      access(),
      'proj-1',
      APP,
    );
    expect(b.prisma.complianceRecord.findMany.mock.calls[0][0].where).toEqual({
      applicationId: APP,
    });
    expect(out.items.map((i) => [i.occurrenceNumber, i.dueDate])).toEqual([
      [1, '2026-10-10'],
      [2, '2027-10-10'],
    ]);
    expect(out.note).toBeNull();
    expect(out.items[0]).toMatchObject({
      description: 'File the return',
      requirementVersion: 2,
      status: 'DUE',
      evidenceRequired: true,
      applicantAction: 'Upload it',
      sourceReference: 'Notice 4',
    });
  });

  it('an approval with no configured obligations shows none, with the FRD 27.2 note', async () => {
    const b = build({ rows: [] });
    const out = await b.service.forApplication(access(), 'proj-1', APP);
    expect(out.items).toEqual([]);
    expect(out.note).toBe(NO_OBLIGATIONS_NOTE);
  });

  it('an obligation with no due date says so instead of guessing one', async () => {
    const b = build({ rows: [row({ dueDate: null, status: 'UPCOMING' })] });
    const [item] = (await b.service.forApplication(access(), 'proj-1', APP))
      .items;
    expect(item.dueDate).toBeNull();
    expect(item.dueDateMessage).toBe(DUE_DATE_NOT_CONFIGURED);
  });

  it('shows the evidence metadata, never a storage path', async () => {
    const b = build({
      rows: [
        row({
          status: 'FULFILLED',
          fulfilledAt: new Date('2026-10-09T06:00:00.000Z'),
          fulfilledDocument: {
            id: 'doc-1',
            originalFilename: 'r.pdf',
            mimeType: 'application/pdf',
            sizeBytes: 9,
            version: 1,
          },
        }),
      ],
    });
    const [item] = (await b.service.forApplication(access(), 'proj-1', APP))
      .items;
    expect(item.evidence).toEqual({
      documentId: 'doc-1',
      filename: 'r.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 9,
      version: 1,
    });
    expect(item.fulfilledLate).toBe(false);
    expect(JSON.stringify(item)).not.toMatch(/filePath|checksum/);
  });

  it('the enterprise list is scoped to the enterprise, and a project-restricted representative to their projects', async () => {
    const owner = build();
    await owner.service.forEnterprise(access(), {});
    expect(
      owner.prisma.complianceRecord.findMany.mock.calls[0][0].where,
    ).toEqual({
      application: { project: { enterpriseId: 'ent-1' } },
    });
    const rep = build();
    await rep.service.forEnterprise(
      access({ relation: 'REPRESENTATIVE', scopedProjectIds: ['p1', 'p2'] }),
      { status: 'OVERDUE' },
    );
    expect(rep.prisma.complianceRecord.findMany.mock.calls[0][0].where).toEqual(
      {
        application: {
          project: { enterpriseId: 'ent-1' },
          projectId: { in: ['p1', 'p2'] },
        },
        status: 'OVERDUE',
      },
    );
  });

  it('pages, earliest due date first with undated ones last', async () => {
    const b = build({ total: 60 });
    const out = await b.service.forEnterprise(access(), {
      page: 3,
      pageSize: 10,
    });
    const args = b.prisma.complianceRecord.findMany.mock.calls[0][0];
    expect(args.skip).toBe(20);
    expect(args.take).toBe(10);
    expect(args.orderBy[0]).toEqual({
      dueDate: { sort: 'asc', nulls: 'last' },
    });
    expect(out).toMatchObject({ page: 3, pageSize: 10, total: 60 });
  });

  it('one obligation is found only through its own application: another application’s, or a malformed id, is a 404', async () => {
    const b = build();
    await b.service.get(access(), 'proj-1', APP, REC);
    expect(b.prisma.complianceRecord.findFirst.mock.calls[0][0].where).toEqual({
      id: REC,
      applicationId: APP,
    });
    await expect(
      build({ one: null }).service.get(access(), 'proj-1', APP, REC),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      b.service.get(access(), 'proj-1', APP, 'nope'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('an application the caller cannot access stops everything', async () => {
    const b = build();
    b.applications.findApplication.mockRejectedValue(new NotFoundException());
    await expect(
      b.service.forApplication(access(), 'proj-1', APP),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(b.prisma.complianceRecord.findMany).not.toHaveBeenCalled();
  });
});

describe('ComplianceViewService: evidence download', () => {
  it('serves the evidence through Step 9’s one download path, audited as the applicant', async () => {
    const doc = { id: 'doc-1', filePath: 'k/1' };
    const b = build({ withEvidence: { id: REC, fulfilledDocument: doc } });
    const file = await b.service.evidenceForApplicant(
      access(),
      'proj-1',
      APP,
      REC,
      'user-1',
      'ip',
    );
    expect(b.documents.downloadDocument).toHaveBeenCalledWith(
      doc,
      { userId: 'user-1', roleAtTime: 'APPLICANT' },
      expect.objectContaining({
        enterpriseId: 'ent-1',
        applicationId: APP,
        complianceRecordId: REC,
      }),
      'ip',
    );
    expect(file.filename).toBe('r.pdf');
  });

  it('an obligation with no evidence, or one that is not this application’s, is a 404 and serves nothing', async () => {
    const none = build();
    await expect(
      none.service.evidenceForApplicant(
        access(),
        'proj-1',
        APP,
        REC,
        'u',
        'ip',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    const other = build({ withEvidence: null });
    await expect(
      other.service.evidenceForApplicant(
        access(),
        'proj-1',
        APP,
        REC,
        'u',
        'ip',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(none.documents.downloadDocument).not.toHaveBeenCalled();
    expect(other.documents.downloadDocument).not.toHaveBeenCalled();
  });
});

describe('ComplianceViewService: officers', () => {
  it('the dashboard is exactly the applications the role can already see (the workspace rule)', async () => {
    const b = build({
      rows: [
        row({
          application: {
            referenceNumber: 'APP-1',
            approvalType: { name: 'Factory Licence', departmentId: 'dept-1' },
          },
        }),
      ],
    });
    const out = await b.service.listForOfficer('officer-1', {
      status: 'OVERDUE',
    });
    expect(out.items[0]).toMatchObject({
      applicationReference: 'APP-1',
      approvalType: 'Factory Licence',
      departmentId: 'dept-1',
    });
    expect(b.officers.visibilityWhere).toHaveBeenCalledWith('officer-1', [
      { role: 'DEPT_ADMIN', departmentId: 'd' },
    ]);
    expect(b.prisma.complianceRecord.findMany.mock.calls[0][0].where).toEqual({
      application: officerWhere,
      status: 'OVERDUE',
    });
  });

  it('one application’s obligations resolve through the department / assignment scope (VIEW), else 404', async () => {
    const b = build();
    const out = await b.service.forOfficerApplication('officer-1', APP);
    expect(b.officers.resolveApplication).toHaveBeenCalledWith(
      'officer-1',
      APP,
      'VIEW',
    );
    expect(out).toMatchObject({
      applicationId: APP,
      applicationReference: 'APP-1',
    });
    const denied = build();
    denied.officers.resolveApplication.mockRejectedValue(
      new NotFoundException(),
    );
    await expect(
      denied.service.forOfficerApplication('officer-1', APP),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(denied.prisma.complianceRecord.findMany).not.toHaveBeenCalled();
  });

  it('officer evidence download is audited under the role the officer acts in, after the scope check', async () => {
    const doc = { id: 'doc-1' };
    const b = build({ withEvidence: { id: REC, fulfilledDocument: doc } });
    await b.service.evidenceForOfficer('officer-1', APP, REC, 'ip');
    expect(b.officers.resolveApplication).toHaveBeenCalledWith(
      'officer-1',
      APP,
      'VIEW',
    );
    expect(b.documents.downloadDocument.mock.calls[0][1]).toEqual({
      userId: 'officer-1',
      roleAtTime: 'DEPT_ADMIN',
    });
    const denied = build();
    denied.officers.resolveApplication.mockRejectedValue(
      new NotFoundException(),
    );
    await expect(
      denied.service.evidenceForOfficer('officer-1', APP, REC, 'ip'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(denied.documents.downloadDocument).not.toHaveBeenCalled();
  });
});
