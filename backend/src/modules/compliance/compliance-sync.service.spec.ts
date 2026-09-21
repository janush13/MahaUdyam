import { Logger } from '@nestjs/common';
import { ComplianceSyncService } from './compliance-sync.service';

const now = new Date('2026-10-10T06:00:00.000Z');

function build(
  opts: {
    pages?: string[][];
    created?: Record<string, number>;
    due?: Array<{ applicationId: string; recordId: string; dueDate: string }>;
    enabled?: boolean;
  } = {},
) {
  const pages = [...(opts.pages ?? [['a', 'b']]), []];
  const prisma = {
    $transaction: jest.fn().mockImplementation((fn) => fn({ tx: true })),
  };
  const lifecycle = {
    activeApplicationsAfter: jest
      .fn()
      .mockImplementation(() => Promise.resolve(pages.shift() ?? [])),
    ensureOccurrences: jest.fn().mockImplementation((_tx, id: string) =>
      Promise.resolve(
        Array.from({ length: opts.created?.[id] ?? 1 }, (_, i) => ({
          action: 'COMPLIANCE_OBLIGATION_CREATED',
          applicationId: id,
          details: { i },
        })),
      ),
    ),
    advanceStatuses: jest.fn().mockResolvedValue({
      events: [
        {
          action: 'COMPLIANCE_STATUS_CHANGED',
          applicationId: 'a',
          details: {},
        },
      ],
      becameDue: opts.due ?? [],
    }),
    record: jest.fn().mockResolvedValue(undefined),
  };
  const notifications = {
    complianceDeadlineApproaching: jest.fn().mockResolvedValue(undefined),
  };
  const config = {
    get: jest.fn().mockReturnValue({ syncEnabled: opts.enabled ?? true }),
  };
  return {
    service: new ComplianceSyncService(
      prisma as never,
      lifecycle as never,
      notifications as never,
      config as never,
    ),
    prisma,
    lifecycle,
    notifications,
  };
}

describe('ComplianceSyncService.run', () => {
  it('gives each ACTIVE application its missing occurrences, one transaction each, and audits them as the system', async () => {
    const b = build();
    const result = await b.service.run(now);
    expect(b.prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(b.lifecycle.ensureOccurrences.mock.calls.map((c) => c[1])).toEqual([
      'a',
      'b',
    ]);
    expect(b.lifecycle.ensureOccurrences.mock.calls[0][2]).toBe(now);
    expect(result).toEqual({ created: 2, advanced: 1 });
    // Occurrence events are recorded per application, after its commit.
    expect(b.lifecycle.record.mock.calls[0][1]).toMatchObject({
      userId: null,
      roleAtTime: 'SYSTEM',
    });
  });

  it('pages through more than one batch without revisiting an application', async () => {
    const b = build({ pages: [['a', 'b'], ['c']] });
    await b.service.run(now);
    expect(
      b.lifecycle.activeApplicationsAfter.mock.calls.map((c) => c[0]),
    ).toEqual([undefined, 'b', 'c']);
    expect(b.lifecycle.ensureOccurrences).toHaveBeenCalledTimes(3);
  });

  it('advances statuses AFTER creating occurrences (a new record already past its date is moved in the same run)', async () => {
    const b = build();
    await b.service.run(now);
    expect(
      b.lifecycle.ensureOccurrences.mock.invocationCallOrder[1],
    ).toBeLessThan(b.lifecycle.advanceStatuses.mock.invocationCallOrder[0]);
  });

  it('tells the applicant side once per obligation that just became DUE, through the existing notification service', async () => {
    const b = build({
      due: [
        { applicationId: 'a', recordId: 'r1', dueDate: '2026-10-10' },
        { applicationId: 'b', recordId: 'r2', dueDate: '2026-10-11' },
      ],
    });
    await b.service.run(now);
    expect(b.notifications.complianceDeadlineApproaching.mock.calls).toEqual([
      ['a', 'r1', '2026-10-10'],
      ['b', 'r2', '2026-10-11'],
    ]);
  });

  it('notifies nobody when nothing became DUE (a re-run over the same state is a no-op)', async () => {
    const b = build({ pages: [[]], due: [] });
    await b.service.run(now);
    expect(
      b.notifications.complianceDeadlineApproaching,
    ).not.toHaveBeenCalled();
  });

  it('passes a scope to both the occurrence pass and the status pass', async () => {
    const b = build();
    const scope = { applicationIds: ['a'] };
    await b.service.run(now, scope);
    expect(b.lifecycle.activeApplicationsAfter.mock.calls[0][1]).toBe(scope);
    expect(b.lifecycle.advanceStatuses).toHaveBeenCalledWith(now, scope);
  });
});

describe('ComplianceSyncService.scheduled (the hourly cron)', () => {
  it('does nothing when the schedule is switched off', async () => {
    const b = build({ enabled: false });
    await b.service.scheduled();
    expect(b.lifecycle.activeApplicationsAfter).not.toHaveBeenCalled();
  });

  it('a failed run is logged by error class only and never thrown: the next hour retries', async () => {
    const error = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const b = build();
    b.lifecycle.activeApplicationsAfter.mockRejectedValue(
      Object.assign(new Error('secret SQL'), {
        name: 'PrismaClientKnownRequestError',
      }),
    );
    await expect(b.service.scheduled()).resolves.toBeUndefined();
    const logged = String(error.mock.calls[0][0]);
    expect(logged).toContain('PrismaClientKnownRequestError');
    expect(logged).not.toContain('secret SQL');
    error.mockRestore();
  });
});
