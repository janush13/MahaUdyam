import { SlaLifecycleService } from './sla-lifecycle.service';
import { WorkingCalendar } from './working-days';

const APP = '33333333-3333-4333-8333-333333333333';
const STAGE = '44444444-4444-4444-8444-444444444444';
const APP_STAGE = '55555555-5555-4555-8555-555555555555';
const CLOCK = '66666666-6666-4666-8666-666666666666';
const QUERY = '77777777-7777-4777-8777-777777777777';
const DEPT = '88888888-8888-4888-8888-888888888888';
const PROJECT = '99999999-9999-4999-8999-999999999999';
const H = 3_600_000;
const t0 = new Date('2026-09-21T04:30:00.000Z'); // Monday 10:00 IST
const at = (hours: number) => new Date(t0.getTime() + hours * H);

const calendar: WorkingCalendar = {
  utcOffsetMinutes: 330,
  weekendDays: [0, 6],
  holidays: new Set<string>(),
};

const stageRow = (over: Record<string, unknown> = {}) => ({
  id: STAGE,
  name: 'Document scrutiny',
  departmentId: DEPT,
  slaDays: 3,
  slaPauseOnQuery: true,
  ...over,
});

const clockRow = (over: Record<string, unknown> = {}) => ({
  id: CLOCK,
  applicationId: APP,
  applicationStageId: APP_STAGE,
  status: 'RUNNING',
  startedAt: t0,
  slaDays: 3,
  pauseOnQuery: true,
  originalDueAt: at(72),
  dueAt: at(72),
  pausedAt: null,
  completedAt: null,
  breachedAt: null,
  ...over,
});

function build(
  opts: { stage?: unknown; clock?: unknown; pause?: unknown } = {},
) {
  const tx = {
    approvalApplication: {
      findUnique: jest.fn().mockResolvedValue({
        workflowId: 'wf',
        projectId: PROJECT,
        approvalType: { departmentId: DEPT },
      }),
      findUniqueOrThrow: jest.fn().mockResolvedValue({
        projectId: PROJECT,
        approvalType: { departmentId: DEPT },
      }),
    },
    workflowStage: {
      findFirst: jest
        .fn()
        .mockResolvedValue('stage' in opts ? opts.stage : stageRow()),
    },
    applicationStage: {
      create: jest.fn().mockResolvedValue({ id: APP_STAGE }),
      update: jest.fn().mockResolvedValue({}),
    },
    slaInstance: {
      create: jest
        .fn()
        .mockImplementation(({ data }) =>
          Promise.resolve({ id: CLOCK, ...data }),
        ),
      findFirst: jest
        .fn()
        .mockResolvedValue('clock' in opts ? opts.clock : clockRow()),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    slaPause: {
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
      findFirst: jest
        .fn()
        .mockResolvedValue('pause' in opts ? opts.pause : null),
    },
  };
  const calendars = {
    forDepartment: jest.fn().mockResolvedValue(calendar),
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const notifications = { slaBreached: jest.fn().mockResolvedValue(undefined) };
  const service = new SlaLifecycleService(
    calendars as never,
    audit as never,
    notifications as never,
  );
  return { service, tx, calendars, audit, notifications };
}

const start = (b: ReturnType<typeof build>) =>
  b.service.startAtSubmission(b.tx as never, APP, t0);

describe('SlaLifecycleService.startAtSubmission (TRD 12: the clock starts on submission)', () => {
  it('finds the workflow’s entry SCRUTINY stage of the application’s own department', async () => {
    const b = build();
    await start(b);
    expect(b.tx.workflowStage.findFirst).toHaveBeenCalledWith({
      where: {
        workflowId: 'wf',
        stageType: 'SCRUTINY',
        departmentId: DEPT,
        dependencies: { none: {} },
      },
      orderBy: [{ sequenceOrder: 'asc' }, { id: 'asc' }],
    });
  });

  it('starts a RUNNING clock: started now, due = now + sla_days working days, snapshotting the stage configuration', async () => {
    const b = build();
    const events = await start(b);
    // Monday 10:00 IST + 3 working days = Thursday 10:00 IST.
    const due = new Date('2026-09-24T04:30:00.000Z');
    expect(b.tx.applicationStage.create).toHaveBeenCalledWith({
      data: {
        applicationId: APP,
        workflowStageId: STAGE,
        status: 'ACTIVE',
        startedAt: t0,
      },
    });
    expect(b.tx.slaInstance.create).toHaveBeenCalledWith({
      data: {
        applicationId: APP,
        applicationStageId: APP_STAGE,
        status: 'RUNNING',
        startedAt: t0,
        slaDays: 3,
        pauseOnQuery: true,
        originalDueAt: due,
        dueAt: due,
      },
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: 'SLA_STARTED',
      applicationId: APP,
      details: {
        configured: true,
        slaDays: 3,
        dueAt: due,
        projectId: PROJECT,
        departmentId: DEPT,
        slaInstanceId: CLOCK,
      },
    });
  });

  it('uses the calendar of the stage’s department, from the start instant', async () => {
    const b = build();
    await start(b);
    expect(b.calendars.forDepartment).toHaveBeenCalledWith(b.tx, DEPT, t0);
  });

  it('a stage with no configured duration starts a NOT_CONFIGURED clock — nothing is guessed', async () => {
    const b = build({
      stage: stageRow({ slaDays: null, slaPauseOnQuery: false }),
    });
    const events = await start(b);
    expect(b.calendars.forDepartment).not.toHaveBeenCalled();
    expect(b.tx.slaInstance.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        status: 'NOT_CONFIGURED',
        slaDays: null,
        originalDueAt: null,
        dueAt: null,
      }),
    });
    expect(events[0].details).toMatchObject({ configured: false, dueAt: null });
  });

  it('a workflow with no such stage has no clock at all — nothing is created or audited', async () => {
    const b = build({ stage: null });
    await expect(start(b)).resolves.toEqual([]);
    expect(b.tx.applicationStage.create).not.toHaveBeenCalled();
    expect(b.tx.slaInstance.create).not.toHaveBeenCalled();
  });
});

describe('SlaLifecycleService.pauseForQuery', () => {
  it('pauses a running clock that is configured to pause, recording the period', async () => {
    const b = build();
    const events = await b.service.pauseForQuery(
      b.tx as never,
      APP,
      QUERY,
      at(5),
    );
    expect(b.tx.slaInstance.findFirst).toHaveBeenCalledWith({
      where: { applicationId: APP, status: 'RUNNING', pauseOnQuery: true },
    });
    expect(b.tx.slaPause.create).toHaveBeenCalledWith({
      data: {
        slaInstanceId: CLOCK,
        reason: 'QUERY_AWAITING_APPLICANT',
        queryId: QUERY,
        pausedAt: at(5),
      },
    });
    expect(b.tx.slaInstance.update).toHaveBeenCalledWith({
      where: { id: CLOCK },
      data: { status: 'PAUSED', pausedAt: at(5) },
    });
    expect(events.map((e) => e.action)).toEqual(['SLA_PAUSED']);
    expect(events[0].details).toMatchObject({ queryId: QUERY });
  });

  it('does nothing where there is nothing to pause (no clock, no timeline, or a stage that keeps running)', async () => {
    const b = build({ clock: null });
    await expect(
      b.service.pauseForQuery(b.tx as never, APP, QUERY, at(5)),
    ).resolves.toEqual([]);
    expect(b.tx.slaPause.create).not.toHaveBeenCalled();
    expect(b.tx.slaInstance.update).not.toHaveBeenCalled();
  });

  it('a deadline already passed is recorded as a breach when it pauses — a clock cannot pause its way out of one', async () => {
    const b = build();
    const events = await b.service.pauseForQuery(
      b.tx as never,
      APP,
      QUERY,
      at(80),
    );
    expect(b.tx.slaInstance.updateMany).toHaveBeenCalledWith({
      where: { id: CLOCK, breachedAt: null },
      data: { breachedAt: at(80) },
    });
    expect(events.map((e) => e.action)).toEqual(['SLA_BREACHED', 'SLA_PAUSED']);
    expect(events[0].details).toMatchObject({ detectedBy: 'PAUSE' });
  });

  it('if a sweep recorded that breach first, it is not recorded (or audited) twice', async () => {
    const b = build();
    b.tx.slaInstance.updateMany.mockResolvedValue({ count: 0 });
    const events = await b.service.pauseForQuery(
      b.tx as never,
      APP,
      QUERY,
      at(80),
    );
    expect(events.map((e) => e.action)).toEqual(['SLA_PAUSED']);
  });
});

describe('SlaLifecycleService.resumeForQuery (Blueprint 23.2: forward by the elapsed pause duration)', () => {
  const pausedClock = clockRow({ status: 'PAUSED', pausedAt: at(10) });
  const pause = () => ({
    id: 'pause-1',
    pausedAt: at(10),
    resumedAt: null,
    slaInstance: pausedClock,
  });

  it('resumes the clock and moves the deadline forward by exactly the paused time', async () => {
    const b = build({ pause: pause() });
    const events = await b.service.resumeForQuery(
      b.tx as never,
      APP,
      QUERY,
      at(34),
    );
    expect(b.tx.slaPause.update).toHaveBeenCalledWith({
      where: { id: 'pause-1' },
      data: { resumedAt: at(34) },
    });
    expect(b.tx.slaInstance.update).toHaveBeenCalledWith({
      where: { id: CLOCK },
      data: { status: 'RUNNING', pausedAt: null, dueAt: at(96) },
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: 'SLA_RESUMED',
      before: { dueAt: at(72) },
      details: { pausedMs: 24 * H, dueAt: at(96), queryId: QUERY },
    });
  });

  it('only resumes the pause that THIS query caused, on a paused clock of this application', async () => {
    const b = build({ pause: pause() });
    await b.service.resumeForQuery(b.tx as never, APP, QUERY, at(34));
    expect(b.tx.slaPause.findFirst).toHaveBeenCalledWith({
      where: {
        queryId: QUERY,
        resumedAt: null,
        slaInstance: { applicationId: APP, status: 'PAUSED' },
      },
      include: { slaInstance: true },
    });
  });

  it('a response with no pause in force (a stage that does not pause) changes nothing', async () => {
    const b = build({ pause: null });
    await expect(
      b.service.resumeForQuery(b.tx as never, APP, QUERY, at(34)),
    ).resolves.toEqual([]);
    expect(b.tx.slaInstance.update).not.toHaveBeenCalled();
  });
});

describe('SlaLifecycleService.completeScrutiny (Blueprint 23.2 "Completion")', () => {
  it('completes a running clock and its stage, within the timeline', async () => {
    const b = build();
    const events = await b.service.completeScrutiny(b.tx as never, APP, at(50));
    expect(b.tx.slaInstance.update).toHaveBeenCalledWith({
      where: { id: CLOCK },
      data: { status: 'COMPLETED', completedAt: at(50) },
    });
    expect(b.tx.applicationStage.update).toHaveBeenCalledWith({
      where: { id: APP_STAGE },
      data: { status: 'COMPLETED', completedAt: at(50) },
    });
    expect(events.map((e) => e.action)).toEqual(['SLA_COMPLETED']);
    expect(events[0].details).toMatchObject({ withinTimeline: true });
  });

  it('completing after the deadline records the breach, then the completion', async () => {
    const b = build();
    const events = await b.service.completeScrutiny(b.tx as never, APP, at(90));
    expect(events.map((e) => e.action)).toEqual([
      'SLA_BREACHED',
      'SLA_COMPLETED',
    ]);
    expect(events[0].details).toMatchObject({ detectedBy: 'COMPLETION' });
    expect(events[1].details).toMatchObject({ withinTimeline: false });
  });

  it('a late completion whose breach a sweep already recorded is still "not within the timeline", without a second breach', async () => {
    const b = build({ clock: clockRow({ breachedAt: at(80) }) });
    const events = await b.service.completeScrutiny(b.tx as never, APP, at(90));
    expect(events.map((e) => e.action)).toEqual(['SLA_COMPLETED']);
    expect(events[0].details).toMatchObject({ withinTimeline: false });
  });

  it('completes a NOT_CONFIGURED clock with no verdict on the timeline', async () => {
    const b = build({
      clock: clockRow({
        status: 'NOT_CONFIGURED',
        slaDays: null,
        originalDueAt: null,
        dueAt: null,
      }),
    });
    const events = await b.service.completeScrutiny(
      b.tx as never,
      APP,
      at(500),
    );
    expect(events.map((e) => e.action)).toEqual(['SLA_COMPLETED']);
    expect(events[0].details).toMatchObject({
      configured: false,
      withinTimeline: null,
    });
  });

  it('an application with no clock has nothing to complete', async () => {
    const b = build({ clock: null });
    await expect(
      b.service.completeScrutiny(b.tx as never, APP, at(1)),
    ).resolves.toEqual([]);
  });
});

describe('SlaLifecycleService.record (audit)', () => {
  it('writes each event against the application with the actor and its context', async () => {
    const b = build();
    await b.service.record(
      [
        {
          action: 'SLA_PAUSED',
          applicationId: APP,
          before: { dueAt: 'x' },
          details: { queryId: QUERY },
        },
      ],
      {
        userId: 'user-1',
        roleAtTime: 'SCRUTINY_OFFICER',
        ipAddress: '10.0.0.1',
        context: { departmentId: DEPT },
        ruleVersionUsed: 'r@v1',
      },
    );
    expect(b.audit.record).toHaveBeenCalledWith({
      userId: 'user-1',
      roleAtTime: 'SCRUTINY_OFFICER',
      action: 'SLA_PAUSED',
      entityType: 'ApprovalApplication',
      entityId: APP,
      beforeState: { dueAt: 'x' },
      afterState: { departmentId: DEPT, queryId: QUERY },
      ipAddress: '10.0.0.1',
      ruleVersionUsed: 'r@v1',
    });
  });

  it('audits nothing for no events', async () => {
    const b = build();
    await b.service.record([], {
      userId: null,
      roleAtTime: 'SYSTEM',
      ipAddress: 'system',
    });
    expect(b.audit.record).not.toHaveBeenCalled();
  });
});

describe('SlaLifecycleService.record: notifying officers of a breach (Blueprint 23.3)', () => {
  const actor = {
    userId: null,
    roleAtTime: 'SYSTEM',
    ipAddress: 'system',
  };
  const due = new Date('2026-09-24T10:00:00.000Z');

  it('tells the officers once per recorded breach, however it was found, after auditing it', async () => {
    const b = build();
    await b.service.record(
      [
        {
          action: 'SLA_BREACHED',
          applicationId: APP,
          details: {
            slaInstanceId: 'clock-1',
            dueAt: due,
            detectedBy: 'SWEEP',
          },
        },
      ],
      actor,
    );
    expect(b.notifications.slaBreached).toHaveBeenCalledTimes(1);
    expect(b.notifications.slaBreached).toHaveBeenCalledWith(
      APP,
      'clock-1',
      due,
    );
    expect(b.audit.record.mock.invocationCallOrder[0]).toBeLessThan(
      b.notifications.slaBreached.mock.invocationCallOrder[0],
    );
  });

  it('says nothing for events that are not breaches (start, pause, resume, completion)', async () => {
    const b = build();
    await b.service.record(
      ['SLA_STARTED', 'SLA_PAUSED', 'SLA_RESUMED', 'SLA_COMPLETED'].map(
        (action) => ({
          action: action as never,
          applicationId: APP,
          details: { slaInstanceId: 'clock-1', dueAt: due },
        }),
      ),
      actor,
    );
    expect(b.notifications.slaBreached).not.toHaveBeenCalled();
  });
});
