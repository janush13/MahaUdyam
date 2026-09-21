import { Prisma } from '@prisma/client';
import { SlaAdminService } from './sla-admin.service';

const USER = '00000000-0000-4000-8000-0000000000a1';
const DEPT_A = '11111111-1111-4111-8111-11111111111a';
const DEPT_B = '11111111-1111-4111-8111-11111111111b';
const STAGE = '22222222-2222-4222-8222-222222222222';
const HOLIDAY = '33333333-3333-4333-8333-333333333333';

const stageRow = (over: Record<string, unknown> = {}) => ({
  id: STAGE,
  name: 'Document scrutiny',
  stageType: 'SCRUTINY',
  sequenceOrder: 1,
  departmentId: DEPT_A,
  slaDays: null,
  slaPauseOnQuery: false,
  workflow: {
    id: 'wf',
    name: 'Workflow',
    version: 1,
    isActive: true,
    approvalType: { id: 'at', name: 'Approval' },
  },
  ...over,
});

function build(
  opts: {
    grants?: Array<{ role: string; departmentId: string }>;
    roles?: string[];
    stage?: unknown;
    holiday?: unknown;
    createError?: unknown;
  } = {},
) {
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    workflowStage: {
      findUnique: jest
        .fn()
        .mockResolvedValue('stage' in opts ? opts.stage : stageRow()),
      update: jest.fn().mockImplementation(({ data }) =>
        Promise.resolve(
          stageRow({
            slaDays: data.slaDays,
            slaPauseOnQuery: data.slaPauseOnQuery,
          }),
        ),
      ),
    },
  };
  const prisma = {
    $transaction: jest.fn().mockImplementation((fn) => fn(tx)),
    workflowStage: { findMany: jest.fn().mockResolvedValue([stageRow()]) },
    slaHoliday: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest
        .fn()
        .mockResolvedValue('holiday' in opts ? opts.holiday : null),
      create: jest.fn().mockImplementation(({ data }) => {
        if (opts.createError) {
          return Promise.reject(opts.createError);
        }
        return Promise.resolve({
          id: HOLIDAY,
          createdAt: new Date(),
          ...data,
        });
      }),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const officers = {
    grantsFor: jest
      .fn()
      .mockResolvedValue(
        opts.grants ?? [{ role: 'DEPT_ADMIN', departmentId: DEPT_A }],
      ),
  };
  const users = {
    getRoleAssignments: jest
      .fn()
      .mockResolvedValue(
        (opts.roles ?? ['DEPT_ADMIN']).map((roleCode) => ({ roleCode })),
      ),
  };
  const service = new SlaAdminService(
    prisma as never,
    audit as never,
    officers as never,
    users as never,
  );
  return { service, prisma, tx, audit };
}

const codeOf = (e: unknown) =>
  (
    (e as { getResponse: () => { code: string } }).getResponse() as {
      code: string;
    }
  ).code;
const statusOf = (e: unknown) => (e as { getStatus: () => number }).getStatus();

describe('SlaAdminService.updateStage (Blueprint 23.1: sla_days editable by a Department Admin)', () => {
  it('lists only the stages of departments the caller administers', async () => {
    const { service, prisma } = build({
      grants: [
        { role: 'DEPT_ADMIN', departmentId: DEPT_A },
        { role: 'SCRUTINY_OFFICER', departmentId: DEPT_B },
      ],
    });
    await service.listStages(USER);
    expect(prisma.workflowStage.findMany.mock.calls[0][0].where).toEqual({
      departmentId: { in: [DEPT_A] },
    });
  });

  it('a caller who administers no department sees none and queries nothing', async () => {
    const { service, prisma } = build({ grants: [] });
    await expect(service.listStages(USER)).resolves.toEqual([]);
    expect(prisma.workflowStage.findMany).not.toHaveBeenCalled();
  });

  it('sets the duration under a row lock and audits the before and after', async () => {
    const { service, tx, audit } = build();
    const result = await service.updateStage(
      USER,
      STAGE,
      { slaDays: 7 },
      '10.0.0.1',
    );
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.workflowStage.update).toHaveBeenCalledWith({
      where: { id: STAGE },
      data: { slaDays: 7, slaPauseOnQuery: false },
      include: expect.any(Object),
    });
    expect(result).toMatchObject({ slaDays: 7, pauseOnQuery: false });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER,
        roleAtTime: 'DEPT_ADMIN',
        action: 'SLA_CONFIGURATION_CHANGED',
        entityType: 'WorkflowStage',
        entityId: STAGE,
        beforeState: { slaDays: null, pauseOnQuery: false },
        afterState: expect.objectContaining({
          departmentId: DEPT_A,
          slaDays: 7,
          pauseOnQuery: false,
          appliesTo: 'APPLICATIONS_SUBMITTED_AFTER_THIS_CHANGE',
        }),
        ipAddress: '10.0.0.1',
      }),
    );
  });

  it('null returns a stage to "Timeline not yet configured"; pauseOnQuery changes alone', async () => {
    const configured = build({ stage: stageRow({ slaDays: 5 }) });
    await configured.service.updateStage(USER, STAGE, { slaDays: null }, 'ip');
    expect(configured.tx.workflowStage.update.mock.calls[0][0].data).toEqual({
      slaDays: null,
      slaPauseOnQuery: false,
    });
    const paused = build({ stage: stageRow({ slaDays: 5 }) });
    await paused.service.updateStage(USER, STAGE, { pauseOnQuery: true }, 'ip');
    expect(paused.tx.workflowStage.update.mock.calls[0][0].data).toEqual({
      slaDays: 5,
      slaPauseOnQuery: true,
    });
  });

  it('a stage of a department the caller does not administer is a 404 — and nothing is written or audited', async () => {
    const { service, tx, audit } = build({
      stage: stageRow({ departmentId: DEPT_B }),
    });
    const error = await service
      .updateStage(USER, STAGE, { slaDays: 3 }, 'ip')
      .catch((e: unknown) => e);
    expect(statusOf(error)).toBe(404);
    expect(tx.workflowStage.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('a Scrutiny Officer or Inspector grant confers no configuration rights', async () => {
    const { service } = build({
      grants: [{ role: 'SCRUTINY_OFFICER', departmentId: DEPT_A }],
    });
    const error = await service
      .updateStage(USER, STAGE, { slaDays: 3 }, 'ip')
      .catch((e: unknown) => e);
    expect(statusOf(error)).toBe(404);
  });

  it('refuses an empty request and a no-op change', async () => {
    const { service } = build({ stage: stageRow({ slaDays: 4 }) });
    expect(
      statusOf(
        await service
          .updateStage(USER, STAGE, {}, 'ip')
          .catch((e: unknown) => e),
      ),
    ).toBe(400);
    expect(
      statusOf(
        await service
          .updateStage(USER, STAGE, { slaDays: 4 }, 'ip')
          .catch((e: unknown) => e),
      ),
    ).toBe(400);
  });

  it('a malformed id is a 404', async () => {
    const { service } = build();
    expect(
      statusOf(
        await service
          .updateStage(USER, 'nope', { slaDays: 1 }, 'ip')
          .catch((e: unknown) => e),
      ),
    ).toBe(404);
  });
});

describe('SlaAdminService holidays (Blueprint 23.2 / 12.7; TRD 12)', () => {
  it('a Department Administrator adds to a department they administer', async () => {
    const { service, prisma, audit } = build();
    const result = await service.addHoliday(
      USER,
      {
        date: '2026-10-02',
        description: 'Gandhi Jayanti (fixture)',
        departmentId: DEPT_A,
      },
      'ip',
    );
    expect(prisma.slaHoliday.create.mock.calls[0][0].data).toMatchObject({
      departmentId: DEPT_A,
      holidayDate: new Date('2026-10-02T00:00:00.000Z'),
      createdByUserId: USER,
    });
    expect(result).toMatchObject({ date: '2026-10-02', departmentId: DEPT_A });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'SLA_HOLIDAY_ADDED',
        roleAtTime: 'DEPT_ADMIN',
        entityType: 'SlaHoliday',
      }),
    );
  });

  it('cannot add to another department, nor to the state-wide calendar', async () => {
    const { service, prisma } = build();
    const other = await service
      .addHoliday(
        USER,
        { date: '2026-10-02', description: 'x', departmentId: DEPT_B },
        'ip',
      )
      .catch((e: unknown) => e);
    expect(statusOf(other)).toBe(403);
    const statewide = await service
      .addHoliday(USER, { date: '2026-10-02', description: 'x' }, 'ip')
      .catch((e: unknown) => e);
    expect(statusOf(statewide)).toBe(400);
    expect(prisma.slaHoliday.create).not.toHaveBeenCalled();
  });

  it('a System Administrator maintains the state-wide calendar only', async () => {
    const { service, prisma, audit } = build({
      grants: [],
      roles: ['SYSTEM_ADMIN'],
    });
    await service.addHoliday(
      USER,
      { date: '2026-10-02', description: 'x' },
      'ip',
    );
    expect(
      prisma.slaHoliday.create.mock.calls[0][0].data.departmentId,
    ).toBeNull();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ roleAtTime: 'SYSTEM_ADMIN' }),
    );
    const dept = await service
      .addHoliday(
        USER,
        { date: '2026-10-03', description: 'x', departmentId: DEPT_A },
        'ip',
      )
      .catch((e: unknown) => e);
    expect(statusOf(dept)).toBe(403);
  });

  it('rejects a date that is not a real calendar date', async () => {
    const { service } = build();
    for (const date of ['2026-02-30', '2026-13-01', '2026-00-10']) {
      const error = await service
        .addHoliday(
          USER,
          { date, description: 'x', departmentId: DEPT_A },
          'ip',
        )
        .catch((e: unknown) => e);
      expect(statusOf(error)).toBe(400);
    }
  });

  it('a duplicate date is a 409 HOLIDAY_ALREADY_EXISTS', async () => {
    const { service } = build({
      createError: new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'x',
      }),
    });
    const error = await service
      .addHoliday(
        USER,
        { date: '2026-10-02', description: 'x', departmentId: DEPT_A },
        'ip',
      )
      .catch((e: unknown) => e);
    expect(statusOf(error)).toBe(409);
    expect(codeOf(error)).toBe('HOLIDAY_ALREADY_EXISTS');
  });

  it('removes only from a calendar the caller maintains, and audits it', async () => {
    const own = build({
      holiday: {
        id: HOLIDAY,
        departmentId: DEPT_A,
        holidayDate: new Date('2026-10-02T00:00:00.000Z'),
        description: 'x',
      },
    });
    await own.service.removeHoliday(USER, HOLIDAY, 'ip');
    expect(own.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'SLA_HOLIDAY_REMOVED',
        beforeState: expect.objectContaining({ date: '2026-10-02' }),
      }),
    );
    for (const departmentId of [DEPT_B, null]) {
      const other = build({
        holiday: {
          id: HOLIDAY,
          departmentId,
          holidayDate: new Date(),
          description: 'x',
        },
      });
      const error = await other.service
        .removeHoliday(USER, HOLIDAY, 'ip')
        .catch((e: unknown) => e);
      expect(statusOf(error)).toBe(404);
      expect(other.prisma.slaHoliday.deleteMany).not.toHaveBeenCalled();
    }
  });
});
