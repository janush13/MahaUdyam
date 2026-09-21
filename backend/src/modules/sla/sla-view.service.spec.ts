import { NotFoundException } from '@nestjs/common';
import { EnterpriseAccess } from '../enterprises/interfaces/enterprise-access.interface';
import { TIMELINE_NOT_CONFIGURED } from './dto/sla-response.dto';
import { SlaViewService } from './sla-view.service';

const ENT = '11111111-1111-4111-8111-111111111111';
const PROJ = '22222222-2222-4222-8222-222222222222';
const APP = '33333333-3333-4333-8333-333333333333';
const H = 3_600_000;
const submitted = new Date('2026-09-21T04:30:00.000Z');
const at = (hours: number) => new Date(submitted.getTime() + hours * H);
const access = {
  enterprise: { id: ENT },
  relation: 'OWNER',
} as EnterpriseAccess;

const clock = (over: Record<string, unknown> = {}) => ({
  id: 'clock',
  applicationId: APP,
  status: 'RUNNING',
  startedAt: submitted,
  slaDays: 3,
  pauseOnQuery: true,
  originalDueAt: at(72),
  dueAt: at(72),
  pausedAt: null,
  completedAt: null,
  breachedAt: null,
  applicationStage: {
    workflowStage: {
      id: 'st',
      name: 'Document scrutiny',
      stageType: 'SCRUTINY',
    },
  },
  pauses: [],
  ...over,
});

function build(
  opts: { app?: unknown; clock?: unknown; warning?: number | null } = {},
) {
  const prisma = {
    approvalApplication: {
      findFirst: jest
        .fn()
        .mockResolvedValue(
          'app' in opts ? opts.app : { id: APP, submittedAt: submitted },
        ),
    },
    slaInstance: {
      findFirst: jest
        .fn()
        .mockResolvedValue('clock' in opts ? opts.clock : clock()),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
  };
  const calendar = {
    settings: { warningThresholdPercent: opts.warning ?? null },
  };
  const officers = {
    resolveApplication: jest.fn().mockResolvedValue({
      app: { id: APP, referenceNumber: 'APP-2026-000001' },
    }),
    grantsFor: jest
      .fn()
      .mockResolvedValue([{ role: 'DEPT_ADMIN', departmentId: 'd' }]),
    visibilityWhere: jest.fn().mockReturnValue({ VISIBLE: true }),
  };
  return {
    service: new SlaViewService(
      prisma as never,
      calendar as never,
      officers as never,
    ),
    prisma,
    officers,
  };
}

describe('SlaViewService.forApplicant (FRD 25.1)', () => {
  it('scopes the application by id AND project AND the authorised enterprise', async () => {
    const { service, prisma } = build();
    await service.forApplicant(access, PROJ, APP, at(1));
    expect(prisma.approvalApplication.findFirst.mock.calls[0][0].where).toEqual(
      {
        id: APP,
        projectId: PROJ,
        project: { enterpriseId: ENT },
      },
    );
  });

  it('shows the expected timeline only where one is configured, plus elapsed time and stage', async () => {
    const { service } = build();
    const dto = await service.forApplicant(access, PROJ, APP, at(30));
    expect(dto).toEqual({
      applicationId: APP,
      submittedAt: submitted,
      currentStage: { id: 'st', name: 'Document scrutiny', type: 'SCRUTINY' },
      status: 'RUNNING',
      timelineConfigured: true,
      timelineMessage: null,
      expectedBy: at(72),
      waitingForApplicant: false,
      elapsedSinceSubmissionMs: 30 * H,
    });
  });

  it('otherwise says "Timeline not yet configured" and gives no date (FRD 25.3)', async () => {
    const { service } = build({
      clock: clock({
        status: 'NOT_CONFIGURED',
        slaDays: null,
        originalDueAt: null,
        dueAt: null,
      }),
    });
    const dto = await service.forApplicant(access, PROJ, APP, at(30));
    expect(dto).toMatchObject({
      status: 'NOT_CONFIGURED',
      timelineConfigured: false,
      timelineMessage: TIMELINE_NOT_CONFIGURED,
      expectedBy: null,
    });
  });

  it('an application with no clock is NOT_TRACKED, still with elapsed time and the same message', async () => {
    const { service } = build({ clock: null });
    const dto = await service.forApplicant(access, PROJ, APP, at(5));
    expect(dto).toMatchObject({
      status: 'NOT_TRACKED',
      currentStage: null,
      timelineConfigured: false,
      timelineMessage: TIMELINE_NOT_CONFIGURED,
      elapsedSinceSubmissionMs: 5 * H,
    });
  });

  it('a draft is NOT_TRACKED with no elapsed time', async () => {
    const { service } = build({
      app: { id: APP, submittedAt: null },
      clock: null,
    });
    const dto = await service.forApplicant(access, PROJ, APP, at(5));
    expect(dto.status).toBe('NOT_TRACKED');
    expect(dto.elapsedSinceSubmissionMs).toBeNull();
  });

  it('a paused clock reads "waiting for applicant" and never leaks breach or pause internals', async () => {
    const { service } = build({
      clock: clock({ status: 'PAUSED', pausedAt: at(10), breachedAt: at(80) }),
    });
    const dto = await service.forApplicant(access, PROJ, APP, at(200));
    expect(dto.waitingForApplicant).toBe(true);
    const keys = Object.keys(dto);
    for (const forbidden of [
      'breached',
      'breachedAt',
      'warning',
      'pauses',
      'slaDays',
      'dueAt',
    ]) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it('an application outside the enterprise / project is a 404 and no clock is read', async () => {
    const { service, prisma } = build({ app: null });
    await expect(
      service.forApplicant(access, PROJ, APP),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.slaInstance.findFirst).not.toHaveBeenCalled();
  });
});

describe('SlaViewService.forOfficer (FRD 25.2)', () => {
  it('reports breach, remaining time and every pause period, derived from the stored clock', async () => {
    const { service } = build({
      clock: clock({
        dueAt: at(96),
        pauses: [
          {
            id: 'p1',
            reason: 'QUERY_AWAITING_APPLICANT',
            queryId: 'q1',
            pausedAt: at(10),
            resumedAt: at(34),
          },
        ],
      }),
    });
    const dto = await service.forOfficer('u', APP, at(100));
    expect(dto).toMatchObject({
      applicationReference: 'APP-2026-000001',
      status: 'RUNNING',
      configured: true,
      slaDays: 3,
      originalDueAt: at(72),
      dueAt: at(96),
      remainingMs: -4 * H,
      breached: true,
      totalPausedMs: 24 * H,
      elapsedMs: 76 * H,
    });
    expect(dto.pauses).toEqual([
      {
        id: 'p1',
        reason: 'QUERY_AWAITING_APPLICANT',
        queryId: 'q1',
        pausedAt: at(10),
        resumedAt: at(34),
        durationMs: 24 * H,
      },
    ]);
  });

  it('reports the warning only against a configured threshold', async () => {
    const off = build({ warning: null });
    expect((await off.service.forOfficer('u', APP, at(60))).warning).toBe(
      false,
    );
    const on = build({ warning: 80 });
    expect((await on.service.forOfficer('u', APP, at(60))).warning).toBe(true);
  });

  it('uses the officer visibility rules to decide who may see the application', async () => {
    const { service, officers } = build();
    await service.forOfficer('officer-1', APP);
    expect(officers.resolveApplication).toHaveBeenCalledWith(
      'officer-1',
      APP,
      'VIEW',
    );
  });

  it('an application with no clock is "Timeline not yet configured", not an error', async () => {
    const { service } = build({ clock: null });
    const dto = await service.forOfficer('u', APP);
    expect(dto).toMatchObject({
      stage: null,
      configured: false,
      breached: false,
      timelineMessage: TIMELINE_NOT_CONFIGURED,
      pauses: [],
    });
  });
});

describe('SlaViewService.listForOfficer', () => {
  it('is restricted to the applications the caller can already see, most urgent first', async () => {
    const { service, prisma, officers } = build();
    await service.listForOfficer('officer-1', {}, at(1));
    const args = prisma.slaInstance.findMany.mock.calls[0][0];
    expect(officers.visibilityWhere).toHaveBeenCalledWith(
      'officer-1',
      expect.any(Array),
    );
    expect(args.where.application).toEqual({ VISIBLE: true });
    expect(args.orderBy[0]).toEqual({ dueAt: { sort: 'asc', nulls: 'last' } });
  });

  it('filters breached clocks as recorded OR running past their deadline, and the reverse', async () => {
    const { service, prisma } = build();
    await service.listForOfficer('u', { breached: true }, at(1));
    expect(prisma.slaInstance.findMany.mock.calls[0][0].where.OR).toEqual([
      { breachedAt: { not: null } },
      { status: 'RUNNING', dueAt: { lt: at(1) } },
    ]);
    await service.listForOfficer('u', { breached: false }, at(1));
    const where = prisma.slaInstance.findMany.mock.calls[1][0].where;
    expect(where.breachedAt).toBeNull();
    expect(where.NOT).toEqual({ status: 'RUNNING', dueAt: { lt: at(1) } });
  });
});
