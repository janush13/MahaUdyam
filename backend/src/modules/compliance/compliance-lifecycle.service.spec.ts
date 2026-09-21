import { ymdToDate } from './compliance-dates';
import { ComplianceLifecycleService } from './compliance-lifecycle.service';

const APP = 'app-1';
const now = new Date('2026-10-10T06:00:00.000Z'); // 2026-10-10 in IST

const req = (over: Record<string, unknown> = {}) => ({
  id: 'req-1',
  version: 3,
  description: 'File the annual return',
  frequency: 'ONE_TIME',
  evidenceRequired: true,
  applicantAction: 'Upload the return',
  sourceReference: 'Notice 12(b)',
  dueWindowDays: 2,
  firstDueAfterDays: 30,
  isActive: true,
  createdAt: new Date(1),
  ...over,
});

function build(
  opts: {
    state?: string;
    requirements?: Array<ReturnType<typeof req>>;
    existing?: Record<
      string,
      Array<{ occurrenceNumber: number; dueDate: Date | null }>
    >;
  } = {},
) {
  const created: Array<Record<string, unknown>> = [];
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    approvalApplication: {
      findUnique: jest.fn().mockResolvedValue(
        opts.state === 'MISSING'
          ? null
          : {
              internalState: opts.state ?? 'ACTIVE',
              projectId: 'proj-1',
              approvalTypeId: 'type-1',
              approvalType: { departmentId: 'dept-1' },
              project: { enterpriseId: 'ent-1' },
            },
      ),
    },
    complianceRequirement: {
      findMany: jest.fn().mockResolvedValue(opts.requirements ?? [req()]),
    },
    complianceRecord: {
      findMany: jest
        .fn()
        .mockImplementation(({ where }) =>
          Promise.resolve(opts.existing?.[where.complianceRequirementId] ?? []),
        ),
      create: jest.fn().mockImplementation(({ data }) => {
        created.push(data);
        return Promise.resolve({ id: `rec-${created.length}`, ...data });
      }),
    },
  };
  const prisma = {
    complianceRecord: { findMany: jest.fn(), updateMany: jest.fn() },
    approvalApplication: { findMany: jest.fn() },
  };
  const calendar = { settings: { utcOffsetMinutes: 330 } };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const service = new ComplianceLifecycleService(
    prisma as never,
    calendar as never,
    audit as never,
  );
  return { service, tx, prisma, audit, created };
}

const ensure = (b: ReturnType<typeof build>) =>
  b.service.ensureOccurrences(b.tx as never, APP, now);

describe('ComplianceLifecycleService.ensureOccurrences', () => {
  it('creates occurrence 1 of an active requirement for an ACTIVE application, snapshotting the requirement', async () => {
    const b = build();
    const events = await ensure(b);
    expect(b.created).toEqual([
      {
        applicationId: APP,
        complianceRequirementId: 'req-1',
        occurrenceNumber: 1,
        dueDate: ymdToDate('2026-11-09'), // 2026-10-10 + 30 days
        requirementVersion: 3,
        description: 'File the annual return',
        frequency: 'ONE_TIME',
        evidenceRequired: true,
        applicantAction: 'Upload the return',
        sourceReference: 'Notice 12(b)',
        dueWindowDays: 2,
      },
    ]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: 'COMPLIANCE_OBLIGATION_CREATED',
      applicationId: APP,
      details: {
        complianceRecordId: 'rec-1',
        requirementVersion: 3,
        occurrenceNumber: 1,
        dueDate: '2026-11-09',
        enterpriseId: 'ent-1',
        projectId: 'proj-1',
        departmentId: 'dept-1',
      },
    });
  });

  it('locks the application row first, so racing runs serialise', async () => {
    const b = build();
    await ensure(b);
    expect(b.tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      b.tx.complianceRecord.create.mock.invocationCallOrder[0],
    );
  });

  it('with no configured first-due offset, the occurrence has NO due date: none is guessed', async () => {
    const b = build({ requirements: [req({ firstDueAfterDays: null })] });
    await ensure(b);
    expect(b.created[0].dueDate).toBeNull();
  });

  it('asks only for ACTIVE requirements of the application’s own approval type', async () => {
    const b = build();
    await ensure(b);
    expect(b.tx.complianceRequirement.findMany.mock.calls[0][0].where).toEqual({
      approvalTypeId: 'type-1',
      isActive: true,
    });
  });

  it('creates nothing when there is no requirement: an approval with none has no obligations', async () => {
    const b = build({ requirements: [] });
    expect(await ensure(b)).toEqual([]);
    expect(b.tx.complianceRecord.create).not.toHaveBeenCalled();
  });

  it.each([
    'SUBMITTED',
    'UNDER_SCRUTINY',
    'APPROVED',
    'RENEWAL_DUE',
    'EXPIRED',
    'REJECTED',
  ])(
    'creates nothing while the application is %s (compliance period = ACTIVE only)',
    async (state) => {
      const b = build({ state });
      expect(await ensure(b)).toEqual([]);
      expect(b.tx.complianceRequirement.findMany).not.toHaveBeenCalled();
    },
  );

  it('creates nothing for an application that does not exist', async () => {
    const b = build({ state: 'MISSING' });
    expect(await ensure(b)).toEqual([]);
  });

  it('is idempotent: an obligation that already has its occurrence gets no second one (one-time)', async () => {
    const b = build({
      existing: {
        'req-1': [{ occurrenceNumber: 1, dueDate: ymdToDate('2026-11-09') }],
      },
    });
    expect(await ensure(b)).toEqual([]);
    expect(b.tx.complianceRecord.create).not.toHaveBeenCalled();
  });
});

describe('ComplianceLifecycleService.ensureOccurrences: recurrence (each occurrence is its own record)', () => {
  const monthly = req({ frequency: 'MONTHLY', firstDueAfterDays: 0 });

  it('does not create the next occurrence while the latest one’s due date is still ahead', async () => {
    const b = build({
      requirements: [monthly],
      existing: {
        'req-1': [{ occurrenceNumber: 1, dueDate: ymdToDate('2026-10-11') }],
      },
    });
    expect(await ensure(b)).toEqual([]);
  });

  it('creates occurrence 2 once occurrence 1’s due date is reached, counted from the first due date', async () => {
    const b = build({
      requirements: [monthly],
      existing: {
        'req-1': [{ occurrenceNumber: 1, dueDate: ymdToDate('2026-10-10') }],
      },
    });
    const events = await ensure(b);
    expect(b.created).toHaveLength(1);
    expect(b.created[0]).toMatchObject({
      occurrenceNumber: 2,
      dueDate: ymdToDate('2026-11-10'),
    });
    expect(events[0].details).toMatchObject({
      occurrenceNumber: 2,
      dueDate: '2026-11-10',
    });
  });

  it('catches up occurrence by occurrence if the job was down, never overwriting one', async () => {
    const b = build({
      requirements: [monthly],
      existing: {
        'req-1': [{ occurrenceNumber: 1, dueDate: ymdToDate('2026-07-31') }],
      },
    });
    await ensure(b);
    // Due 31 Aug (n=2), 30 Sep (n=3), 31 Oct (n=4, still ahead => stops after it).
    expect(
      b.created.map((c) => [
        c.occurrenceNumber,
        (c.dueDate as Date).toISOString().slice(0, 10),
      ]),
    ).toEqual([
      [2, '2026-08-31'],
      [3, '2026-09-30'],
      [4, '2026-10-31'],
    ]);
  });

  it('an annual obligation recurs after twelve months', async () => {
    const b = build({
      requirements: [req({ frequency: 'ANNUAL', firstDueAfterDays: 0 })],
      existing: {
        'req-1': [{ occurrenceNumber: 1, dueDate: ymdToDate('2025-10-10') }],
      },
    });
    await ensure(b);
    expect(b.created[0]).toMatchObject({
      occurrenceNumber: 2,
      dueDate: ymdToDate('2026-10-10'),
    });
  });

  it('a recurrence with no first due date has nothing to count from: it does not recur', async () => {
    const b = build({
      requirements: [monthly],
      existing: { 'req-1': [{ occurrenceNumber: 1, dueDate: null }] },
    });
    expect(await ensure(b)).toEqual([]);
  });

  it('a one-time obligation never recurs, whatever the date', async () => {
    const b = build({
      requirements: [req({ frequency: 'ONE_TIME' })],
      existing: {
        'req-1': [{ occurrenceNumber: 1, dueDate: ymdToDate('2020-01-01') }],
      },
    });
    expect(await ensure(b)).toEqual([]);
  });

  it('a deactivated requirement creates no further occurrences (it is never even loaded)', async () => {
    const b = build({ requirements: [] });
    await ensure(b);
    expect(
      b.tx.complianceRequirement.findMany.mock.calls[0][0].where.isActive,
    ).toBe(true);
  });

  it('the new occurrence snapshots the requirement AS IT IS NOW (its new version), history untouched', async () => {
    const b = build({
      requirements: [
        req({
          frequency: 'MONTHLY',
          firstDueAfterDays: 0,
          version: 7,
          description: 'Reworded',
        }),
      ],
      existing: {
        'req-1': [{ occurrenceNumber: 1, dueDate: ymdToDate('2026-10-10') }],
      },
    });
    await ensure(b);
    expect(b.created[0]).toMatchObject({
      requirementVersion: 7,
      description: 'Reworded',
    });
    expect(b.tx.complianceRecord.create).toHaveBeenCalledTimes(1);
  });
});

describe('ComplianceLifecycleService.advanceStatuses', () => {
  const row = (over: Record<string, unknown> = {}) => ({
    id: 'rec-1',
    applicationId: APP,
    status: 'UPCOMING',
    dueDate: ymdToDate('2026-10-10'),
    dueWindowDays: 0,
    occurrenceNumber: 1,
    ...over,
  });
  const run = async (
    rows: Array<ReturnType<typeof row>>,
    claimed = true,
    at = now,
  ) => {
    const b = build();
    b.prisma.complianceRecord.findMany
      .mockResolvedValueOnce(rows)
      .mockResolvedValue([]);
    b.prisma.complianceRecord.updateMany.mockResolvedValue({
      count: claimed ? 1 : 0,
    });
    const result = await b.service.advanceStatuses(at);
    return { ...b, result };
  };

  it('looks only at unfulfilled records that have a due date', async () => {
    const { prisma } = await run([]);
    expect(prisma.complianceRecord.findMany.mock.calls[0][0].where).toEqual({
      status: { in: ['UPCOMING', 'DUE'] },
      dueDate: { not: null },
    });
  });

  it('moves UPCOMING to DUE on the due date, with one conditional update and an audit event, and reports it for notification', async () => {
    const { prisma, result } = await run([row()]);
    expect(prisma.complianceRecord.updateMany).toHaveBeenCalledWith({
      where: { id: 'rec-1', status: 'UPCOMING' },
      data: { status: 'DUE' },
    });
    expect(result.events).toEqual([
      expect.objectContaining({
        action: 'COMPLIANCE_STATUS_CHANGED',
        applicationId: APP,
        details: expect.objectContaining({
          from: 'UPCOMING',
          to: 'DUE',
          dueDate: '2026-10-10',
        }),
      }),
    ]);
    expect(result.becameDue).toEqual([
      { applicationId: APP, recordId: 'rec-1', dueDate: '2026-10-10' },
    ]);
  });

  it('opens DUE early by the record’s own snapshotted window', async () => {
    const { result } = await run([
      row({ dueDate: ymdToDate('2026-10-12'), dueWindowDays: 2 }),
    ]);
    expect(result.becameDue).toHaveLength(1);
    const { result: tooEarly } = await run([
      row({ dueDate: ymdToDate('2026-10-13'), dueWindowDays: 2 }),
    ]);
    expect(tooEarly.events).toEqual([]);
  });

  it('moves DUE to OVERDUE after the due date, and UPCOMING straight to OVERDUE if the job missed the window - neither is a "due" notification', async () => {
    const { result } = await run([
      row({ id: 'a', status: 'DUE', dueDate: ymdToDate('2026-10-09') }),
      row({ id: 'b', status: 'UPCOMING', dueDate: ymdToDate('2026-09-01') }),
    ]);
    expect(result.events.map((e) => e.details.to)).toEqual([
      'OVERDUE',
      'OVERDUE',
    ]);
    expect(result.becameDue).toEqual([]);
  });

  it('is idempotent: a record already where the date puts it is not touched', async () => {
    const { prisma, result } = await run([row({ status: 'DUE' })]);
    expect(prisma.complianceRecord.updateMany).not.toHaveBeenCalled();
    expect(result.events).toEqual([]);
  });

  it('never moves a status backwards (a clock that stepped back changes nothing)', async () => {
    const { prisma, result } = await run([
      row({ status: 'DUE', dueDate: ymdToDate('2026-12-31') }),
    ]);
    expect(prisma.complianceRecord.updateMany).not.toHaveBeenCalled();
    expect(result.events).toEqual([]);
  });

  it('a lost claim (a racing run or a fulfilment) is neither counted nor audited nor notified', async () => {
    const { result } = await run([row()], false);
    expect(result.events).toEqual([]);
    expect(result.becameDue).toEqual([]);
  });

  it('can be scoped to some applications', async () => {
    const b = build();
    b.prisma.complianceRecord.findMany.mockResolvedValue([]);
    await b.service.advanceStatuses(now, { applicationIds: ['a', 'b'] });
    expect(
      b.prisma.complianceRecord.findMany.mock.calls[0][0].where.applicationId,
    ).toEqual({
      in: ['a', 'b'],
    });
  });
});

describe('ComplianceLifecycleService.record (audit)', () => {
  it('writes each event against the application with the actor and context', async () => {
    const b = build();
    await b.service.record(
      [
        {
          action: 'COMPLIANCE_STATUS_CHANGED',
          applicationId: APP,
          details: { to: 'DUE' },
        },
      ],
      { userId: null, roleAtTime: 'SYSTEM', ipAddress: 'system' },
      { enterpriseId: 'ent-1' },
    );
    expect(b.audit.record).toHaveBeenCalledWith({
      userId: null,
      roleAtTime: 'SYSTEM',
      action: 'COMPLIANCE_STATUS_CHANGED',
      entityType: 'ApprovalApplication',
      entityId: APP,
      afterState: { enterpriseId: 'ent-1', to: 'DUE' },
      ipAddress: 'system',
    });
  });
});

describe('ComplianceLifecycleService.activeApplicationsAfter', () => {
  it('selects ACTIVE applications whose approval type has an active requirement, paged by id', async () => {
    const b = build();
    b.prisma.approvalApplication.findMany.mockResolvedValue([
      { id: 'x' },
      { id: 'y' },
    ]);
    expect(await b.service.activeApplicationsAfter('w')).toEqual(['x', 'y']);
    const args = b.prisma.approvalApplication.findMany.mock.calls[0][0];
    expect(args.where).toMatchObject({
      internalState: 'ACTIVE',
      approvalType: { complianceRequirements: { some: { isActive: true } } },
      id: { gt: 'w' },
    });
    expect(args.orderBy).toEqual({ id: 'asc' });
  });

  it('a scope narrows it to those applications, on every page', async () => {
    const b = build();
    b.prisma.approvalApplication.findMany.mockResolvedValue([]);
    await b.service.activeApplicationsAfter(undefined, {
      applicationIds: ['a'],
    });
    await b.service.activeApplicationsAfter('a', {
      applicationIds: ['a', 'b'],
    });
    expect(
      b.prisma.approvalApplication.findMany.mock.calls[0][0].where.id,
    ).toEqual({ in: ['a'] });
    expect(
      b.prisma.approvalApplication.findMany.mock.calls[1][0].where.id,
    ).toEqual({
      gt: 'a',
      in: ['a', 'b'],
    });
  });
});
