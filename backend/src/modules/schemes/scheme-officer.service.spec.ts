import { ConflictException, NotFoundException } from '@nestjs/common';
import { AuditActions } from '../../infrastructure/audit/audit-actions.constant';
import { SchemeOfficerService } from './scheme-officer.service';

const USER = 'officer-1';
const APP = '00000000-0000-4000-8000-0000000000a1';
const NOW_ROW = new Date('2026-10-01T10:00:00Z');

function application(status: string) {
  return {
    id: APP,
    schemeId: 'scheme-1',
    projectId: 'proj-1',
    status,
    referenceNumber: 'SCH-2026-000001',
    submittedAt: NOW_ROW,
    decidedAt: null,
    decisionReason: null,
    decidedByUserId: null,
    disbursedAt: null,
    createdByUserId: 'applicant-1',
    catalogueSnapshot: {
      recommendation: {
        status: 'RECOMMENDED',
        rule: { id: 'rule-1', version: 3 },
      },
    },
    createdAt: NOW_ROW,
    updatedAt: NOW_ROW,
    scheme: {
      id: 'scheme-1',
      name: 'Test Scheme',
      benefitType: null,
      departmentId: 'dept-1',
      department: { id: 'dept-1', code: 'D1', name: 'Dept' },
    },
    project: {
      id: 'proj-1',
      name: 'Project',
      referenceNumber: 'PRJ-1',
      enterpriseId: 'ent-1',
      enterprise: { id: 'ent-1', name: 'Enterprise', referenceNumber: 'ENT-1' },
    },
    history: [],
  };
}

function build(
  opts: {
    status?: string;
    locked?: string | null;
    mandatory?: Array<{ id: string; name: string }>;
    satisfied?: string[];
    updated?: number;
    officer?: boolean;
  } = {},
) {
  const status = opts.status ?? 'UNDER_REVIEW';
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    schemeApplication: {
      findUnique: jest
        .fn()
        .mockResolvedValue(
          opts.locked === null ? null : { status: opts.locked ?? status },
        ),
      updateMany: jest.fn().mockResolvedValue({ count: opts.updated ?? 1 }),
    },
    schemeApplicationStatusHistory: {
      create: jest.fn().mockResolvedValue({ id: 'hist-1' }),
    },
    schemeDocumentRequirement: {
      findMany: jest.fn().mockResolvedValue(opts.mandatory ?? []),
    },
    schemeApplicationDocument: {
      findMany: jest.fn().mockResolvedValue(
        (opts.satisfied ?? []).map((id) => ({
          schemeDocumentRequirementId: id,
        })),
      ),
    },
  };
  const prisma = {
    schemeApplication: {
      findUnique: jest.fn().mockResolvedValue(application(status)),
      findUniqueOrThrow: jest.fn().mockResolvedValue(application('APPROVED')),
    },
    $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const access = {
    resolveApplicationDepartment: jest
      .fn()
      .mockResolvedValue(
        opts.officer === false
          ? null
          : { userId: USER, actingRole: 'SCHEME_OFFICER' },
      ),
    maintainedDepartments: jest.fn().mockResolvedValue(['dept-1']),
  };
  const notifications = {
    schemeApplicationStatusUpdated: jest.fn().mockResolvedValue(undefined),
  };
  const service = new SchemeOfficerService(
    prisma as never,
    audit as never,
    access as never,
    notifications as never,
  );
  return { service, tx, prisma, audit, access, notifications };
}

describe('SchemeOfficerService: authorisation', () => {
  it('a caller who is not a Scheme Officer of the scheme’s department gets the same 404 as for a nonexistent application, before anything is written', async () => {
    const b = build({ officer: false });
    await expect(
      b.service.decide(USER, APP, { outcome: 'APPROVE', reason: 'x' }, 'ip'),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(b.service.startReview(USER, APP, 'ip')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(b.service.get(USER, APP)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(b.prisma.$transaction).not.toHaveBeenCalled();
    expect(b.audit.record).not.toHaveBeenCalled();
    expect(
      b.notifications.schemeApplicationStatusUpdated,
    ).not.toHaveBeenCalled();
  });

  it('derives the department from the application’s scheme - never from the caller', async () => {
    const b = build();
    await b.service.get(USER, APP);
    expect(b.access.resolveApplicationDepartment).toHaveBeenCalledWith(
      USER,
      'dept-1',
    );
  });

  it('a malformed id is a 404 without a lookup', async () => {
    const b = build();
    await expect(b.service.get(USER, 'nope')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(b.prisma.schemeApplication.findUnique).not.toHaveBeenCalled();
  });

  it('the queue is limited to the departments the caller is a Scheme Officer of', async () => {
    const b = build();
    (b.prisma.schemeApplication as Record<string, unknown>).count = jest
      .fn()
      .mockResolvedValue(0);
    (b.prisma.schemeApplication as Record<string, unknown>).findMany = jest
      .fn()
      .mockResolvedValue([]);
    await b.service.list(USER, {});
    const where = (
      b.prisma.schemeApplication as unknown as { findMany: jest.Mock }
    ).findMany.mock.calls[0][0].where;
    expect(where.scheme).toEqual({ departmentId: { in: ['dept-1'] } });
  });
});

describe('SchemeOfficerService: the documented transitions', () => {
  it('START_REVIEW: Applied -> Under Review, as a guarded update, with a history row and no decision fields', async () => {
    const b = build({ status: 'APPLIED' });
    await b.service.startReview(USER, APP, 'ip');
    const update = b.tx.schemeApplication.updateMany.mock.calls[0][0];
    expect(update.where).toEqual({ id: APP, status: 'APPLIED' });
    expect(update.data).toMatchObject({ status: 'UNDER_REVIEW' });
    expect(update.data).not.toHaveProperty('decisionReason');
    expect(update.data).not.toHaveProperty('decidedByUserId');
    expect(update.data).not.toHaveProperty('disbursedAt');
    expect(
      b.tx.schemeApplicationStatusHistory.create.mock.calls[0][0].data,
    ).toEqual({
      schemeApplicationId: APP,
      fromStatus: 'APPLIED',
      toStatus: 'UNDER_REVIEW',
      actorUserId: USER,
      actorRole: 'SCHEME_OFFICER',
      reason: null,
    });
  });

  it('locks the application row before reading its state, and does both in one transaction', async () => {
    const b = build({ status: 'APPLIED' });
    await b.service.startReview(USER, APP, 'ip');
    expect(b.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(b.tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      b.tx.schemeApplication.findUnique.mock.invocationCallOrder[0],
    );
    expect(String(b.tx.$queryRaw.mock.calls[0][0])).toContain('FOR UPDATE');
  });

  it('APPROVE: Under Review -> Approved, recording who, when and the reason (with mandatory evidence present)', async () => {
    const b = build({
      mandatory: [{ id: 'req-1', name: 'Proof' }],
      satisfied: ['req-1'],
    });
    await b.service.decide(
      USER,
      APP,
      { outcome: 'APPROVE', reason: 'Because' },
      'ip',
    );
    const update = b.tx.schemeApplication.updateMany.mock.calls[0][0];
    expect(update.where).toEqual({ id: APP, status: 'UNDER_REVIEW' });
    expect(update.data).toMatchObject({
      status: 'APPROVED',
      decidedByUserId: USER,
      decisionReason: 'Because',
    });
    expect(update.data.decidedAt).toBeInstanceOf(Date);
    expect(
      b.tx.schemeApplicationStatusHistory.create.mock.calls[0][0].data,
    ).toMatchObject({
      fromStatus: 'UNDER_REVIEW',
      toStatus: 'APPROVED',
      reason: 'Because',
    });
  });

  it('APPROVE is refused, with nothing written, while a mandatory document has no usable evidence - naming the document', async () => {
    const b = build({
      mandatory: [
        { id: 'req-1', name: 'Proof A' },
        { id: 'req-2', name: 'Proof B' },
      ],
      satisfied: ['req-1'],
    });
    const error = await b.service
      .decide(USER, APP, { outcome: 'APPROVE', reason: 'Because' }, 'ip')
      .catch((e: ConflictException) => e);
    expect(error).toBeInstanceOf(ConflictException);
    const body = (error as ConflictException).getResponse() as {
      code: string;
      message: string;
    };
    expect(body.code).toBe('SCHEME_EVIDENCE_INCOMPLETE');
    expect(body.message).toContain('Proof B');
    expect(body.message).not.toContain('Proof A');
    expect(b.tx.schemeApplication.updateMany).not.toHaveBeenCalled();
    expect(b.tx.schemeApplicationStatusHistory.create).not.toHaveBeenCalled();
    expect(b.audit.record).not.toHaveBeenCalled();
    expect(
      b.notifications.schemeApplicationStatusUpdated,
    ).not.toHaveBeenCalled();
  });

  it('APPROVE with no mandatory requirement configured needs no evidence', async () => {
    const b = build({ mandatory: [] });
    await b.service.decide(
      USER,
      APP,
      { outcome: 'APPROVE', reason: 'Because' },
      'ip',
    );
    expect(b.tx.schemeApplication.updateMany).toHaveBeenCalled();
  });

  it('only MANDATORY requirements are asked for', async () => {
    const b = build();
    await b.service.decide(
      USER,
      APP,
      { outcome: 'APPROVE', reason: 'Because' },
      'ip',
    );
    expect(
      b.tx.schemeDocumentRequirement.findMany.mock.calls[0][0].where,
    ).toEqual({
      schemeId: 'scheme-1',
      isMandatory: true,
    });
  });

  it('REJECT: never blocked by evidence, and records the reason', async () => {
    const b = build({
      mandatory: [{ id: 'req-1', name: 'Proof' }],
      satisfied: [],
    });
    await b.service.decide(
      USER,
      APP,
      { outcome: 'REJECT', reason: 'No' },
      'ip',
    );
    expect(b.tx.schemeDocumentRequirement.findMany).not.toHaveBeenCalled();
    expect(
      b.tx.schemeApplication.updateMany.mock.calls[0][0].data,
    ).toMatchObject({
      status: 'REJECTED',
      decisionReason: 'No',
      decidedByUserId: USER,
    });
  });

  it('DISBURSE: Approved -> Disbursed, a timestamp only - no decision fields, no amount', async () => {
    const b = build({ status: 'APPROVED' });
    await b.service.disburse(USER, APP, 'ip');
    const data = b.tx.schemeApplication.updateMany.mock.calls[0][0].data;
    expect(data).toMatchObject({ status: 'DISBURSED' });
    expect(data.disbursedAt).toBeInstanceOf(Date);
    expect(Object.keys(data).sort()).toEqual([
      'disbursedAt',
      'status',
      'updatedAt',
    ]);
  });

  it('refuses every action from a status it does not leave, under the lock, with nothing written', async () => {
    const cases: Array<[string, () => Promise<unknown>]> = [];
    for (const status of [
      'APPLIED',
      'UNDER_REVIEW',
      'APPROVED',
      'REJECTED',
      'DISBURSED',
    ]) {
      const legal: Record<string, string[]> = {
        APPLIED: ['start'],
        UNDER_REVIEW: ['approve', 'reject'],
        APPROVED: ['disburse'],
        REJECTED: [],
        DISBURSED: [],
      };
      for (const action of ['start', 'approve', 'reject', 'disburse']) {
        if (legal[status].includes(action)) {
          continue;
        }
        cases.push([
          `${action} from ${status}`,
          async () => {
            const b = build({ status });
            const call =
              action === 'start'
                ? b.service.startReview(USER, APP, 'ip')
                : action === 'disburse'
                  ? b.service.disburse(USER, APP, 'ip')
                  : b.service.decide(
                      USER,
                      APP,
                      {
                        outcome: action === 'approve' ? 'APPROVE' : 'REJECT',
                        reason: 'x',
                      },
                      'ip',
                    );
            await expect(call).rejects.toMatchObject({
              response: { code: 'INVALID_STATE_TRANSITION' },
            });
            expect(b.tx.schemeApplication.updateMany).not.toHaveBeenCalled();
            expect(
              b.tx.schemeApplicationStatusHistory.create,
            ).not.toHaveBeenCalled();
            expect(b.audit.record).not.toHaveBeenCalled();
            expect(
              b.notifications.schemeApplicationStatusUpdated,
            ).not.toHaveBeenCalled();
          },
        ]);
      }
    }
    // 4 actions x 5 statuses, minus the 4 documented transitions
    expect(cases.length).toBe(4 * 5 - 4);
    for (const [, run] of cases) {
      await run();
    }
  });

  it('re-checks the status under the lock: a state that changed since it was read is the transition error, not a silent success', async () => {
    const b = build({ status: 'APPLIED', locked: 'UNDER_REVIEW' });
    await expect(b.service.startReview(USER, APP, 'ip')).rejects.toMatchObject({
      response: { code: 'INVALID_STATE_TRANSITION' },
    });
  });

  it('a guarded update that matches nothing is a conflict, and writes nothing else', async () => {
    const b = build({ status: 'APPLIED', updated: 0 });
    await expect(b.service.startReview(USER, APP, 'ip')).rejects.toMatchObject({
      response: { code: 'CONFLICT' },
    });
    expect(b.tx.schemeApplicationStatusHistory.create).not.toHaveBeenCalled();
    expect(b.audit.record).not.toHaveBeenCalled();
  });

  it('an application deleted under the lock is a 404', async () => {
    const b = build({ locked: null });
    await expect(b.service.startReview(USER, APP, 'ip')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('SchemeOfficerService: audit and notification (after the commit)', () => {
  it('audits the status change with before / after, actor, role, and every reference - and the rule version used', async () => {
    const b = build({ status: 'APPLIED' });
    await b.service.startReview(USER, APP, 'ip-1');
    expect(b.audit.record).toHaveBeenCalledTimes(1);
    expect(b.audit.record.mock.calls[0][0]).toMatchObject({
      userId: USER,
      roleAtTime: 'SCHEME_OFFICER',
      action: AuditActions.SCHEME_APPLICATION_STATUS_CHANGED,
      entityType: 'SchemeApplication',
      entityId: APP,
      beforeState: { status: 'APPLIED' },
      afterState: {
        action: 'START_REVIEW',
        status: 'UNDER_REVIEW',
        enterpriseId: 'ent-1',
        projectId: 'proj-1',
        schemeId: 'scheme-1',
        departmentId: 'dept-1',
        schemeApplicationId: APP,
        referenceNumber: 'SCH-2026-000001',
        actingAs: 'SCHEME_OFFICER',
        historyId: 'hist-1',
      },
      ipAddress: 'ip-1',
      ruleVersionUsed: 'rule-1@v3',
    });
  });

  it('a decision is audited twice: the status change and the decision itself, with the reason and the recommendation it did not depend on', async () => {
    const b = build();
    await b.service.decide(
      USER,
      APP,
      { outcome: 'REJECT', reason: 'Because' },
      'ip',
    );
    const actions = b.audit.record.mock.calls.map((c) => c[0].action);
    expect(actions).toEqual([
      AuditActions.SCHEME_APPLICATION_STATUS_CHANGED,
      AuditActions.SCHEME_APPLICATION_DECISION_RECORDED,
    ]);
    expect(b.audit.record.mock.calls[1][0].afterState).toMatchObject({
      outcome: 'REJECT',
      reason: 'Because',
      recommendationStatus: 'RECOMMENDED',
      isRecommendationOnly: false,
    });
  });

  it('a non-decision transition writes no decision audit', async () => {
    const b = build({ status: 'APPROVED' });
    await b.service.disburse(USER, APP, 'ip');
    expect(b.audit.record.mock.calls.map((c) => c[0].action)).toEqual([
      AuditActions.SCHEME_APPLICATION_STATUS_CHANGED,
    ]);
  });

  it('notifies once per transition, keyed by its history row, only after the transaction committed', async () => {
    const b = build({ status: 'APPLIED' });
    await b.service.startReview(USER, APP, 'ip');
    expect(
      b.notifications.schemeApplicationStatusUpdated,
    ).toHaveBeenCalledTimes(1);
    expect(b.notifications.schemeApplicationStatusUpdated).toHaveBeenCalledWith(
      APP,
      'hist-1',
    );
    expect(b.prisma.$transaction.mock.invocationCallOrder[0]).toBeLessThan(
      b.audit.record.mock.invocationCallOrder[0],
    );
    expect(b.audit.record.mock.invocationCallOrder[0]).toBeLessThan(
      b.notifications.schemeApplicationStatusUpdated.mock
        .invocationCallOrder[0],
    );
  });

  it('returns the officer’s view of the updated application, including the next actions', async () => {
    const b = build({ status: 'APPLIED' });
    const res = await b.service.startReview(USER, APP, 'ip');
    expect(res).toMatchObject({
      id: APP,
      status: 'APPROVED',
      availableActions: ['DISBURSE'],
    });
    expect(res.projectInputs).toMatchObject({ enterprise_type: undefined });
  });
});
