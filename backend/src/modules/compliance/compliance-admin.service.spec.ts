import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ComplianceAdminService } from './compliance-admin.service';

const REQ = '00000000-0000-4000-8000-0000000000d1';
const TYPE = '00000000-0000-4000-8000-0000000000e1';

const row = (over: Record<string, unknown> = {}) => ({
  id: REQ,
  approvalTypeId: TYPE,
  approvalType: { id: TYPE, name: 'Factory Licence', departmentId: 'dept-1' },
  description: 'File the return',
  frequency: 'ANNUAL',
  applicantAction: null,
  sourceReference: null,
  evidenceRequired: false,
  firstDueAfterDays: null,
  dueWindowDays: 0,
  version: 1,
  isActive: true,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  ...over,
});

function build(
  opts: {
    grants?: Array<{ role: string; departmentId: string }>;
    type?: { departmentId: string } | null;
    current?: ReturnType<typeof row> | null;
  } = {},
) {
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    complianceRequirement: {
      findUnique: jest
        .fn()
        .mockResolvedValue('current' in opts ? opts.current : row()),
      update: jest.fn().mockImplementation(({ data }) =>
        Promise.resolve(
          row({
            ...Object.fromEntries(
              Object.entries(data).filter(([k]) => k !== 'version'),
            ),
            version: 2,
          }),
        ),
      ),
    },
  };
  const prisma = {
    approvalType: {
      findUnique: jest
        .fn()
        .mockResolvedValue(
          'type' in opts ? opts.type : { departmentId: 'dept-1' },
        ),
    },
    complianceRequirement: {
      create: jest
        .fn()
        .mockImplementation(({ data }) => Promise.resolve(row(data))),
      findMany: jest.fn().mockResolvedValue([row()]),
    },
    $transaction: jest.fn().mockImplementation((fn) => fn(tx)),
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const officers = {
    grantsFor: jest
      .fn()
      .mockResolvedValue(
        opts.grants ?? [{ role: 'DEPT_ADMIN', departmentId: 'dept-1' }],
      ),
  };
  return {
    service: new ComplianceAdminService(
      prisma as never,
      audit as never,
      officers as never,
    ),
    prisma,
    tx,
    audit,
  };
}

describe('ComplianceAdminService.create', () => {
  it('creates a requirement for an approval type of the administrator’s own department, with NO default duration', async () => {
    const b = build();
    const out = await b.service.create(
      'admin',
      {
        approvalTypeId: TYPE,
        description: 'File the return',
        frequency: 'ANNUAL',
      },
      'ip',
    );
    expect(b.prisma.complianceRequirement.create.mock.calls[0][0].data).toEqual(
      {
        approvalTypeId: TYPE,
        description: 'File the return',
        frequency: 'ANNUAL',
        evidenceRequired: false,
        applicantAction: null,
        sourceReference: null,
        firstDueAfterDays: null, // "not yet configured": nothing is assumed
        dueWindowDays: 0,
      },
    );
    expect(out).toMatchObject({
      approvalTypeName: 'Factory Licence',
      version: 1,
      isActive: true,
    });
  });

  it('carries what the department supplies: source, evidence, action, first due offset and window', async () => {
    const b = build();
    await b.service.create(
      'admin',
      {
        approvalTypeId: TYPE,
        description: 'Return',
        frequency: 'MONTHLY',
        evidenceRequired: true,
        applicantAction: 'Upload it',
        sourceReference: 'Notice 4',
        firstDueAfterDays: 45,
        dueWindowDays: 7,
      },
      'ip',
    );
    expect(
      b.prisma.complianceRequirement.create.mock.calls[0][0].data,
    ).toMatchObject({
      evidenceRequired: true,
      applicantAction: 'Upload it',
      sourceReference: 'Notice 4',
      firstDueAfterDays: 45,
      dueWindowDays: 7,
    });
  });

  it('audits the creation with the actor and the full configuration', async () => {
    const b = build();
    await b.service.create(
      'admin',
      { approvalTypeId: TYPE, description: 'Return', frequency: 'ANNUAL' },
      '9.9.9.9',
    );
    expect(b.audit.record.mock.calls[0][0]).toMatchObject({
      userId: 'admin',
      roleAtTime: 'DEPT_ADMIN',
      action: 'COMPLIANCE_REQUIREMENT_CREATED',
      entityType: 'ComplianceRequirement',
      entityId: REQ,
      ipAddress: '9.9.9.9',
      afterState: expect.objectContaining({
        departmentId: 'dept-1',
        version: 1,
      }),
    });
  });

  it('an approval type of another department, a nonexistent one, or a caller who administers nothing are all the same 404 and write nothing', async () => {
    for (const b of [
      build({ type: { departmentId: 'dept-2' } }),
      build({ type: null }),
      build({ grants: [] }),
      build({ grants: [{ role: 'SCRUTINY_OFFICER', departmentId: 'dept-1' }] }),
    ]) {
      await expect(
        b.service.create(
          'u',
          { approvalTypeId: TYPE, description: 'x', frequency: 'ANNUAL' },
          'ip',
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(b.prisma.complianceRequirement.create).not.toHaveBeenCalled();
      expect(b.audit.record).not.toHaveBeenCalled();
    }
  });
});

describe('ComplianceAdminService.update', () => {
  it('applies a change in place under a row lock and bumps the version; history is not re-written', async () => {
    const b = build();
    const out = await b.service.update(
      'admin',
      REQ,
      { description: 'Reworded' },
      'ip',
    );
    expect(b.tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      b.tx.complianceRequirement.update.mock.invocationCallOrder[0],
    );
    expect(b.tx.complianceRequirement.update.mock.calls[0][0].data).toEqual({
      description: 'Reworded',
      version: { increment: 1 },
    });
    expect(out).toMatchObject({ version: 2, description: 'Reworded' });
  });

  it('audits before and after, and says it applies only to occurrences created afterwards', async () => {
    const b = build();
    await b.service.update(
      'admin',
      REQ,
      { frequency: 'MONTHLY', isActive: false },
      'ip',
    );
    expect(b.audit.record.mock.calls[0][0]).toMatchObject({
      action: 'COMPLIANCE_REQUIREMENT_UPDATED',
      entityId: REQ,
      beforeState: expect.objectContaining({
        frequency: 'ANNUAL',
        isActive: true,
        version: 1,
      }),
      afterState: expect.objectContaining({
        frequency: 'MONTHLY',
        isActive: false,
        version: 2,
        appliesTo: 'OCCURRENCES_CREATED_AFTER_THIS_CHANGE',
      }),
    });
  });

  it('can clear the optional fields back to "not configured" with null', async () => {
    const b = build({
      current: row({
        firstDueAfterDays: 30,
        sourceReference: 'Notice 4',
        applicantAction: 'Do it',
      }),
    });
    await b.service.update(
      'admin',
      REQ,
      { firstDueAfterDays: null, sourceReference: null, applicantAction: null },
      'ip',
    );
    expect(
      b.tx.complianceRequirement.update.mock.calls[0][0].data,
    ).toMatchObject({
      firstDueAfterDays: null,
      sourceReference: null,
      applicantAction: null,
    });
  });

  it('a request that changes nothing is a 400 and bumps no version', async () => {
    const b = build();
    await expect(
      b.service.update(
        'admin',
        REQ,
        { description: 'File the return', dueWindowDays: 0 },
        'ip',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(b.tx.complianceRequirement.update).not.toHaveBeenCalled();
    expect(b.audit.record).not.toHaveBeenCalled();
  });

  it('another department’s requirement, a nonexistent or malformed id: 404, nothing changed', async () => {
    const other = build({
      current: row({
        approvalType: { id: TYPE, name: 'X', departmentId: 'dept-9' },
      }),
    });
    await expect(
      other.service.update('admin', REQ, { description: 'x' }, 'ip'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(other.tx.complianceRequirement.update).not.toHaveBeenCalled();
    const gone = build({ current: null });
    await expect(
      gone.service.update('admin', REQ, { description: 'x' }, 'ip'),
    ).rejects.toBeInstanceOf(NotFoundException);
    const bad = build();
    await expect(
      bad.service.update('admin', 'nope', { description: 'x' }, 'ip'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(bad.prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('ComplianceAdminService.list', () => {
  it('lists only the requirements of departments the caller administers', async () => {
    const b = build({
      grants: [
        { role: 'DEPT_ADMIN', departmentId: 'dept-1' },
        { role: 'SCRUTINY_OFFICER', departmentId: 'dept-2' },
      ],
    });
    await b.service.list('admin', {});
    expect(
      b.prisma.complianceRequirement.findMany.mock.calls[0][0].where,
    ).toEqual({
      approvalType: { departmentId: { in: ['dept-1'] } },
    });
  });

  it('lists nothing (without a query) for someone who administers no department', async () => {
    const b = build({ grants: [] });
    expect(await b.service.list('u', {})).toEqual([]);
    expect(b.prisma.complianceRequirement.findMany).not.toHaveBeenCalled();
  });

  it('can be narrowed to an approval type', async () => {
    const b = build();
    await b.service.list('admin', { approvalTypeId: TYPE });
    expect(
      b.prisma.complianceRequirement.findMany.mock.calls[0][0].where,
    ).toMatchObject({
      approvalTypeId: TYPE,
    });
  });
});
