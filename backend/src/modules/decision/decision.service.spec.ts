import { ConflictException } from '@nestjs/common';
import { AuditActions } from '../../infrastructure/audit/audit-actions.constant';
import {
  DecisionService,
  applyDecisionTransition,
  decisionTransitionFor,
} from './decision.service';

const USER = 'user-aa';
const APP = 'app-1';
const NOW = new Date('2026-10-01T10:00:00Z');

function build(
  opts: {
    state?: string;
    facts?: { required: boolean; groups: Array<[string, number]> };
    recommendation?: unknown;
  } = {},
) {
  const facts = opts.facts ?? { required: false, groups: [] };
  const recommendation =
    'recommendation' in opts
      ? opts.recommendation
      : {
          id: 'rec-1',
          outcome: 'APPROVE',
          reason: 'fine',
          createdAt: NOW,
        };
  const tx = {
    approvalApplication: {
      findUnique: jest.fn().mockResolvedValue({
        workflow: { stages: facts.required ? [{ id: 's' }] : [] },
      }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    inspection: {
      groupBy: jest
        .fn()
        .mockResolvedValue(
          facts.groups.map(([status, n]) => ({ status, _count: { _all: n } })),
        ),
    },
    scrutinyRecommendation: {
      findFirst: jest.fn().mockResolvedValue(recommendation),
      create: jest.fn(),
      update: jest.fn(),
    },
    approvalDecision: {
      create: jest.fn().mockImplementation(({ data }) =>
        Promise.resolve({
          id: 'dec-1',
          ...data,
          recommendation: {
            outcome: (recommendation as { outcome: string })?.outcome,
          },
        }),
      ),
    },
  };
  const support = {
    run: jest.fn((_ctx: unknown, fn: (tx: unknown, l: unknown) => unknown) =>
      fn(tx, { internalState: opts.state ?? 'RECOMMENDED_FOR_APPROVAL' }),
    ),
    recordOfficerEvent: jest.fn().mockResolvedValue(undefined),
  };
  const access = {
    resolveApplication: jest.fn().mockResolvedValue({
      app: { id: APP },
      departmentId: 'dept-1',
      actingRole: 'APPROVING_AUTHORITY',
    }),
  };
  const notifications = {
    approvalIssued: jest.fn().mockResolvedValue(undefined),
    applicationRejected: jest.fn().mockResolvedValue(undefined),
  };
  const service = new DecisionService(
    access as never,
    support as never,
    notifications as never,
  );
  return { service, tx, support, access, notifications };
}

describe('DecisionService.decide', () => {
  it('is authorised as the DECIDE capability of the application’s own department, before anything else', async () => {
    const b = build();
    await b.service.decide(
      USER,
      APP,
      { outcome: 'APPROVE', reason: 'ok' },
      'ip',
    );
    expect(b.access.resolveApplication).toHaveBeenCalledWith(
      USER,
      APP,
      'DECIDE',
    );
  });

  it('approves: records the decision, moves RECOMMENDED -> APPROVED with the reason and decision time, and notifies once', async () => {
    const b = build();
    const result = await b.service.decide(
      USER,
      APP,
      { outcome: 'APPROVE', reason: 'Meets the department’s rule' },
      'ip',
    );
    const create = b.tx.approvalDecision.create.mock.calls[0][0].data;
    expect(create).toMatchObject({
      applicationId: APP,
      departmentId: 'dept-1',
      recommendationId: 'rec-1',
      outcome: 'APPROVE',
      reason: 'Meets the department’s rule',
      decidedByUserId: USER,
    });
    const update = b.tx.approvalApplication.updateMany.mock.calls[0][0];
    expect(update.where).toEqual({
      id: APP,
      internalState: 'RECOMMENDED_FOR_APPROVAL',
    });
    expect(update.data).toMatchObject({
      internalState: 'APPROVED',
      applicantStatus: 'APPROVED',
      decisionReason: 'Meets the department’s rule',
    });
    // The instant recorded on the decision is the instant on the application.
    expect(update.data.decidedAt).toEqual(create.decidedAt);
    expect(result).toMatchObject({
      internalState: 'APPROVED',
      applicantStatus: 'APPROVED',
      decision: { outcome: 'APPROVE', isStatutoryDecision: true },
    });
    expect(b.notifications.approvalIssued).toHaveBeenCalledWith(APP, 'dec-1');
    expect(b.notifications.applicationRejected).not.toHaveBeenCalled();
  });

  it('rejects: RECOMMENDED -> REJECTED, and notifies the rejection only', async () => {
    const b = build();
    const result = await b.service.decide(
      USER,
      APP,
      { outcome: 'REJECT', reason: 'Not eligible' },
      'ip',
    );
    expect(
      b.tx.approvalApplication.updateMany.mock.calls[0][0].data,
    ).toMatchObject({
      internalState: 'REJECTED',
      applicantStatus: 'REJECTED',
    });
    expect(result.decision).toMatchObject({
      outcome: 'REJECT',
      // The recommendation said APPROVE: the authority may differ.
      recommendedOutcome: 'APPROVE',
      differsFromRecommendation: true,
    });
    expect(b.notifications.applicationRejected).toHaveBeenCalledWith(
      APP,
      'dec-1',
    );
    expect(b.notifications.approvalIssued).not.toHaveBeenCalled();
  });

  it('only READS the recommendation: it never creates or edits one', async () => {
    const b = build();
    await b.service.decide(
      USER,
      APP,
      { outcome: 'APPROVE', reason: 'x' },
      'ip',
    );
    expect(b.tx.scrutinyRecommendation.findFirst).toHaveBeenCalledTimes(1);
    expect(b.tx.scrutinyRecommendation.create).not.toHaveBeenCalled();
    expect(b.tx.scrutinyRecommendation.update).not.toHaveBeenCalled();
    expect(
      b.tx.scrutinyRecommendation.findFirst.mock.calls[0][0].orderBy,
    ).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
  });

  it('audits the decision (with the recommendation answered, flagged as NOT recommendation-only) and the before/after status', async () => {
    const b = build();
    await b.service.decide(
      USER,
      APP,
      { outcome: 'APPROVE', reason: 'x' },
      'ip',
    );
    const calls = b.support.recordOfficerEvent.mock.calls;
    expect(calls[0][1]).toBe(AuditActions.APPLICATION_DECISION_RECORDED);
    expect(calls[0][2]).toMatchObject({
      decisionId: 'dec-1',
      outcome: 'APPROVE',
      reason: 'x',
      recommendationId: 'rec-1',
      recommendedOutcome: 'APPROVE',
      differsFromRecommendation: false,
      isRecommendationOnly: false,
    });
    expect(calls[1][1]).toBe(AuditActions.APPLICATION_STATUS_CHANGED);
    expect(calls[1][2]).toMatchObject({ internalState: 'APPROVED' });
    expect(calls[1][4]).toMatchObject({
      internalState: 'RECOMMENDED_FOR_APPROVAL',
    });
  });

  it.each([
    'SUBMITTED',
    'UNDER_SCRUTINY',
    'QUERY_RAISED',
    'APPLICANT_RESPONDED',
    'DRAFT',
  ])(
    'refuses to decide from %s with INVALID_STATE_TRANSITION, writing nothing',
    async (state) => {
      const b = build({ state });
      await expect(
        b.service.decide(USER, APP, { outcome: 'APPROVE', reason: 'x' }, 'ip'),
      ).rejects.toMatchObject({
        response: { code: 'INVALID_STATE_TRANSITION' },
      });
      expect(b.tx.approvalDecision.create).not.toHaveBeenCalled();
      expect(b.notifications.approvalIssued).not.toHaveBeenCalled();
    },
  );

  it.each(['APPROVED', 'REJECTED', 'CERTIFICATE_ISSUED', 'ACTIVE'])(
    'a second decision from %s is DECISION_ALREADY_RECORDED (a duplicate or a lost race)',
    async (state) => {
      const b = build({ state });
      await expect(
        b.service.decide(USER, APP, { outcome: 'REJECT', reason: 'x' }, 'ip'),
      ).rejects.toMatchObject({
        response: { code: 'DECISION_ALREADY_RECORDED' },
      });
      expect(b.tx.approvalDecision.create).not.toHaveBeenCalled();
      expect(b.notifications.applicationRejected).not.toHaveBeenCalled();
    },
  );

  it('refuses while an inspection is open, or required and not completed (the gate still holds)', async () => {
    const open = build({
      facts: { required: false, groups: [['SCHEDULED', 1]] },
    });
    await expect(
      open.service.decide(USER, APP, { outcome: 'APPROVE', reason: 'x' }, 'ip'),
    ).rejects.toMatchObject({ response: { code: 'INSPECTION_OPEN' } });
    const required = build({ facts: { required: true, groups: [] } });
    await expect(
      required.service.decide(
        USER,
        APP,
        { outcome: 'APPROVE', reason: 'x' },
        'ip',
      ),
    ).rejects.toMatchObject({ response: { code: 'INSPECTION_REQUIRED' } });
    expect(open.tx.approvalDecision.create).not.toHaveBeenCalled();
    expect(required.tx.approvalDecision.create).not.toHaveBeenCalled();
  });

  it('a completed required inspection does not block, whatever its outcome (no approval criterion is invented)', async () => {
    const b = build({
      facts: { required: true, groups: [['COMPLETED', 1]] },
    });
    await expect(
      b.service.decide(USER, APP, { outcome: 'APPROVE', reason: 'x' }, 'ip'),
    ).resolves.toMatchObject({ internalState: 'APPROVED' });
  });

  it('refuses with RECOMMENDATION_NOT_FOUND when no recommendation is on record', async () => {
    const b = build({ recommendation: null });
    await expect(
      b.service.decide(USER, APP, { outcome: 'APPROVE', reason: 'x' }, 'ip'),
    ).rejects.toMatchObject({
      response: { code: 'RECOMMENDATION_NOT_FOUND' },
    });
    expect(b.tx.approvalDecision.create).not.toHaveBeenCalled();
  });

  it('a state change that loses a race (guarded update matches nothing) is a 409, not a silent success', async () => {
    const b = build();
    b.tx.approvalApplication.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      b.service.decide(USER, APP, { outcome: 'APPROVE', reason: 'x' }, 'ip'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(b.notifications.approvalIssued).not.toHaveBeenCalled();
  });

  it('does not audit or notify when authorisation fails', async () => {
    const b = build();
    b.access.resolveApplication.mockRejectedValue(new Error('403'));
    await expect(
      b.service.decide(USER, APP, { outcome: 'APPROVE', reason: 'x' }, 'ip'),
    ).rejects.toThrow('403');
    expect(b.support.run).not.toHaveBeenCalled();
    expect(b.support.recordOfficerEvent).not.toHaveBeenCalled();
    expect(b.notifications.approvalIssued).not.toHaveBeenCalled();
  });
});

describe('decisionTransitionFor / applyDecisionTransition', () => {
  it('names the transition an action performs, or 409s', () => {
    expect(
      decisionTransitionFor('APPROVE', 'RECOMMENDED_FOR_APPROVAL').to,
    ).toBe('APPROVED');
    expect(() =>
      decisionTransitionFor('ISSUE_CERTIFICATE', 'SUBMITTED'),
    ).toThrow(ConflictException);
  });

  it('applies a transition as a guarded update that moves the applicant status with it', async () => {
    const tx = {
      approvalApplication: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    await applyDecisionTransition(
      tx as never,
      APP,
      decisionTransitionFor('ISSUE_CERTIFICATE', 'APPROVED'),
    );
    expect(tx.approvalApplication.updateMany.mock.calls[0][0]).toMatchObject({
      where: { id: APP, internalState: 'APPROVED' },
      data: {
        internalState: 'CERTIFICATE_ISSUED',
        applicantStatus: 'APPROVED',
      },
    });
  });
});
