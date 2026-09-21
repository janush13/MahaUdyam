import { SlaSweepService } from './sla-sweep.service';

const now = new Date('2026-09-25T10:00:00.000Z');
const clock = (id: string) => ({
  id,
  applicationId: `app-${id}`,
  dueAt: new Date('2026-09-24T10:00:00.000Z'),
});

function build(
  opts: {
    batches?: Array<ReturnType<typeof clock>[]>;
    claimed?: (id: string) => boolean;
    enabled?: boolean;
  } = {},
) {
  const batches = [...(opts.batches ?? [[clock('a'), clock('b')]]), []];
  const prisma = {
    slaInstance: {
      findMany: jest
        .fn()
        .mockImplementation(() => Promise.resolve(batches.shift() ?? [])),
      updateMany: jest.fn().mockImplementation(({ where }) =>
        Promise.resolve({
          count: (opts.claimed ?? (() => true))(where.id) ? 1 : 0,
        }),
      ),
    },
    approvalApplication: {
      findUniqueOrThrow: jest.fn().mockResolvedValue({
        projectId: 'proj',
        approvalType: { departmentId: 'dept' },
      }),
    },
  };
  const lifecycle = { record: jest.fn().mockResolvedValue(undefined) };
  const calendar = { settings: { sweepEnabled: opts.enabled ?? true } };
  const notifications = { slaWarning: jest.fn().mockResolvedValue(undefined) };
  const service = new SlaSweepService(
    prisma as never,
    lifecycle as never,
    calendar as never,
    notifications as never,
  );
  return { service, prisma, lifecycle, notifications };
}

describe('SlaSweepService.sweep (breach detection, Blueprint 23.3)', () => {
  it('looks only at RUNNING, not-yet-breached clocks whose deadline has passed', async () => {
    const { service, prisma } = build();
    await service.sweep(now);
    expect(prisma.slaInstance.findMany.mock.calls[0][0].where).toEqual({
      status: 'RUNNING',
      breachedAt: null,
      dueAt: { lt: now },
    });
  });

  it('claims each clock with one conditional update and audits the breach as the system', async () => {
    const { service, prisma, lifecycle } = build();
    await expect(service.sweep(now)).resolves.toEqual({ breached: 2 });
    expect(prisma.slaInstance.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'a',
        status: 'RUNNING',
        breachedAt: null,
        dueAt: { lt: now },
      },
      data: { breachedAt: now },
    });
    expect(lifecycle.record).toHaveBeenCalledTimes(2);
    const [events, actor] = lifecycle.record.mock.calls[0];
    expect(events[0]).toMatchObject({
      action: 'SLA_BREACHED',
      applicationId: 'app-a',
      details: {
        slaInstanceId: 'a',
        projectId: 'proj',
        departmentId: 'dept',
        detectedBy: 'SWEEP',
        breachedAt: now,
      },
    });
    expect(actor).toEqual({
      userId: null,
      roleAtTime: 'SYSTEM',
      ipAddress: 'system',
    });
  });

  it('is idempotent: a clock another sweep (or a pause / completion) already claimed is neither counted nor audited again', async () => {
    const { service, lifecycle } = build({ claimed: (id) => id === 'a' });
    await expect(service.sweep(now)).resolves.toEqual({ breached: 1 });
    expect(lifecycle.record).toHaveBeenCalledTimes(1);
  });

  it('a second run over the same state finds nothing to do', async () => {
    const { service, lifecycle } = build({ batches: [] });
    await expect(service.sweep(now)).resolves.toEqual({ breached: 0 });
    expect(lifecycle.record).not.toHaveBeenCalled();
  });

  it('pages through more than one batch without revisiting a clock', async () => {
    const { service, prisma } = build({
      batches: [[clock('a')], [clock('b')]],
    });
    await expect(service.sweep(now)).resolves.toEqual({ breached: 2 });
    const second = prisma.slaInstance.findMany.mock.calls[1][0].where;
    expect(second.id).toEqual({ gt: 'a' });
  });
});

describe('SlaSweepService.scheduled (the hourly cron)', () => {
  it('does nothing when the schedule is switched off', async () => {
    const { service, prisma } = build({ enabled: false });
    await service.scheduled();
    expect(prisma.slaInstance.findMany).not.toHaveBeenCalled();
  });

  it('a failed run is logged, never thrown (the next sweep retries)', async () => {
    const { service, prisma } = build();
    prisma.slaInstance.findMany.mockRejectedValue(new Error('db down'));
    await expect(service.scheduled()).resolves.toBeUndefined();
  });
});

describe('SlaSweepService.warn (the configured warning threshold, Blueprint 23.3)', () => {
  const started = new Date('2026-09-20T10:00:00.000Z');
  const dueAt = new Date('2026-09-30T10:00:00.000Z'); // a 10-day window
  const running = (
    id: string,
    over: Record<string, unknown> = {},
  ): Record<string, unknown> => ({
    id,
    applicationId: `app-${id}`,
    status: 'RUNNING',
    startedAt: started,
    originalDueAt: dueAt,
    dueAt,
    pausedAt: null,
    completedAt: null,
    breachedAt: null,
    pauses: [],
    ...over,
  });
  const run = (
    clocks: Array<Record<string, unknown>>,
    threshold: number | null,
    at: Date,
  ) => {
    const b = build({ batches: [] });
    b.prisma.slaInstance.findMany
      .mockReset()
      .mockResolvedValueOnce(clocks)
      .mockResolvedValue([]);
    (b.service as unknown as { calendar: unknown }).calendar = {
      settings: { sweepEnabled: true, warningThresholdPercent: threshold },
    };
    return { ...b, result: b.service.warn(at) };
  };
  const day = (n: number) => new Date(started.getTime() + n * 86_400_000);

  it('does nothing at all when no threshold is configured: there is no default', async () => {
    const r = run([running('a')], null, day(9));
    await expect(r.result).resolves.toEqual({ atThreshold: 0 });
    expect(r.prisma.slaInstance.findMany).not.toHaveBeenCalled();
    expect(r.notifications.slaWarning).not.toHaveBeenCalled();
  });

  it('looks only at RUNNING, unbreached clocks that are not yet overdue', async () => {
    const r = run([], 80, day(9));
    await r.result;
    expect(r.prisma.slaInstance.findMany.mock.calls[0][0].where).toEqual({
      status: 'RUNNING',
      breachedAt: null,
      dueAt: { gte: day(9) },
    });
  });

  it('warns a clock at or past the threshold with the deadline and the percentage, using the shared clock arithmetic', async () => {
    const r = run([running('a')], 80, day(9)); // 9 of 10 days = 90%
    await expect(r.result).resolves.toEqual({ atThreshold: 1 });
    expect(r.notifications.slaWarning).toHaveBeenCalledWith(
      'app-a',
      'a',
      dueAt,
      expect.closeTo(90, 5),
    );
  });

  it('does not warn a clock below the threshold', async () => {
    const r = run([running('a')], 80, day(5)); // 50%
    await expect(r.result).resolves.toEqual({ atThreshold: 0 });
    expect(r.notifications.slaWarning).not.toHaveBeenCalled();
  });

  it('time spent paused does not count towards the threshold', async () => {
    // 9 days on the calendar, 6 of them paused: 30% actually elapsed.
    const r = run(
      [running('a', { pauses: [{ pausedAt: day(1), resumedAt: day(7) }] })],
      80,
      day(9),
    );
    await expect(r.result).resolves.toEqual({ atThreshold: 0 });
  });

  it('is idempotent by construction: it records nothing on the clock, and the dispatch is keyed per clock', async () => {
    const r = run([running('a')], 80, day(9));
    await r.result;
    expect(r.prisma.slaInstance.updateMany).not.toHaveBeenCalled();
    expect(r.lifecycle.record).not.toHaveBeenCalled();
  });
});

describe('SlaSweepService: an optional scope (a targeted run)', () => {
  it('sweep restricts the candidates to the given applications, and is unchanged without a scope', async () => {
    const scoped = build();
    await scoped.service.sweep(now, { applicationIds: ['app-a', 'app-b'] });
    expect(scoped.prisma.slaInstance.findMany.mock.calls[0][0].where).toEqual({
      status: 'RUNNING',
      breachedAt: null,
      dueAt: { lt: now },
      applicationId: { in: ['app-a', 'app-b'] },
    });
    const global = build();
    await global.service.sweep(now);
    expect(global.prisma.slaInstance.findMany.mock.calls[0][0].where).toEqual({
      status: 'RUNNING',
      breachedAt: null,
      dueAt: { lt: now },
    });
  });

  it('an empty scope matches nothing rather than everything', async () => {
    const b = build();
    await b.service.sweep(now, { applicationIds: [] });
    expect(
      b.prisma.slaInstance.findMany.mock.calls[0][0].where.applicationId,
    ).toEqual({ in: [] });
  });
});
