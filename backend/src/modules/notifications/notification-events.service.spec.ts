import { Logger } from '@nestjs/common';
import { NotificationEventsService } from './notification-events.service';

const APP = {
  id: 'app-1',
  referenceNumber: 'APP-2026-000042',
  projectId: 'proj-1',
  project: { enterpriseId: 'ent-1' },
  approvalType: { name: 'Factory Licence', departmentId: 'dept-1' },
};
const refs = {
  enterpriseId: 'ent-1',
  projectId: 'proj-1',
  applicationId: 'app-1',
};

function build(
  opts: {
    app?: unknown;
    query?: unknown;
    auth?: unknown;
    createError?: Error;
  } = {},
) {
  const prisma = {
    approvalApplication: {
      findUnique: jest.fn().mockResolvedValue('app' in opts ? opts.app : APP),
    },
    applicationQuery: {
      findFirst: jest
        .fn()
        .mockResolvedValue(
          'query' in opts
            ? opts.query
            : { roundNumber: 2, raisedByUserId: 'officer-1' },
        ),
    },
    enterpriseRepresentative: {
      findUnique: jest.fn().mockResolvedValue(
        'auth' in opts
          ? opts.auth
          : {
              enterpriseId: 'ent-1',
              representativeUserId: 'rep-1',
              scope: 'FULL',
              enterprise: { name: 'Acme Works' },
            },
      ),
    },
  };
  const recipients = {
    applicantSide: jest.fn().mockResolvedValue(['owner', 'rep']),
    officerSide: jest.fn().mockResolvedValue(['so', 'admin']),
    active: jest
      .fn()
      .mockImplementation((ids: string[]) => Promise.resolve(ids)),
  };
  const notifications = {
    create: jest
      .fn()
      .mockImplementation(() =>
        opts.createError
          ? Promise.reject(opts.createError)
          : Promise.resolve({ created: 1, duplicates: 0 }),
      ),
  };
  const service = new NotificationEventsService(
    prisma as never,
    recipients as never,
    notifications as never,
  );
  return { service, prisma, recipients, notifications };
}

const created = (b: ReturnType<typeof build>) =>
  b.notifications.create.mock.calls[0][0];

describe('NotificationEventsService', () => {
  it('APPLICATION_SUBMITTED: the applicant side, referencing the application, keyed by it', async () => {
    const b = build();
    await b.service.applicationSubmitted('app-1');
    expect(b.recipients.applicantSide).toHaveBeenCalledWith('proj-1');
    expect(created(b)).toMatchObject({
      recipients: ['owner', 'rep'],
      eventType: 'APPLICATION_SUBMITTED',
      audience: 'APPLICANT',
      dedupeKey: 'APPLICATION_SUBMITTED:app-1',
      ...refs,
    });
    expect(created(b).message).toContain('APP-2026-000042');
  });

  it('APPROVAL_ISSUED / APPLICATION_REJECTED: the applicant side, once per decision; the reason is never copied in', async () => {
    for (const [method, type] of [
      ['approvalIssued', 'APPROVAL_ISSUED'],
      ['applicationRejected', 'APPLICATION_REJECTED'],
    ] as const) {
      const b = build();
      await b.service[method]('app-1', 'dec-1');
      expect(b.recipients.applicantSide).toHaveBeenCalledWith('proj-1');
      expect(created(b)).toMatchObject({
        recipients: ['owner', 'rep'],
        eventType: type,
        audience: 'APPLICANT',
        dedupeKey: `${type}:dec-1`,
        payload: { referenceNumber: 'APP-2026-000042', decisionId: 'dec-1' },
        ...refs,
      });
      expect(created(b).payload).not.toHaveProperty('reason');
      expect(Object.keys(created(b).payload).sort()).toEqual([
        'decisionId',
        'referenceNumber',
      ]);
    }
  });

  it('a decision notification failure is swallowed (it can never fail the decision)', async () => {
    const b = build({ createError: new Error('boom') });
    const spy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    await expect(
      b.service.approvalIssued('app-1', 'dec-1'),
    ).resolves.toBeUndefined();
    spy.mockRestore();
  });

  it('QUERY_RAISED: the applicant side, per query; the text of the question is never read', async () => {
    const b = build();
    await b.service.queryRaised('app-1', 'q-1');
    expect(created(b)).toMatchObject({
      eventType: 'QUERY_RAISED',
      audience: 'APPLICANT',
      dedupeKey: 'QUERY_RAISED:q-1',
      payload: { referenceNumber: 'APP-2026-000042', roundNumber: 2 },
    });
    // Only the round number is selected: no question, no response text.
    expect(b.prisma.applicationQuery.findFirst.mock.calls[0][0].select).toEqual(
      {
        roundNumber: true,
      },
    );
  });

  it('QUERY_RESPONDED: only the officer who raised the query, as an officer notification', async () => {
    const b = build();
    await b.service.queryResponded('app-1', 'q-1');
    expect(b.recipients.active).toHaveBeenCalledWith(['officer-1']);
    expect(created(b)).toMatchObject({
      recipients: ['officer-1'],
      eventType: 'QUERY_RESPONDED',
      audience: 'OFFICER',
      dedupeKey: 'QUERY_RESPONDED:q-1',
      ...refs,
    });
    expect(b.recipients.applicantSide).not.toHaveBeenCalled();
    expect(b.prisma.applicationQuery.findFirst.mock.calls[0][0].select).toEqual(
      {
        roundNumber: true,
        raisedByUserId: true,
      },
    );
  });

  it('INSPECTION_SCHEDULED / RESCHEDULED: the applicant side with the date, keyed per inspection / per change; no inspector, no site', async () => {
    const at = new Date('2026-10-05T04:30:00.000Z');
    const changed = new Date('2026-09-25T10:00:00.000Z');
    const s = build();
    await s.service.inspectionScheduled('app-1', 'insp-1', at);
    expect(created(s)).toMatchObject({
      eventType: 'INSPECTION_SCHEDULED',
      audience: 'APPLICANT',
      dedupeKey: 'INSPECTION_SCHEDULED:insp-1',
      payload: { scheduledAt: at },
    });
    const r = build();
    await r.service.inspectionRescheduled('app-1', 'insp-1', at, changed);
    expect(created(r)).toMatchObject({
      eventType: 'INSPECTION_RESCHEDULED',
      dedupeKey: `INSPECTION_RESCHEDULED:insp-1:${changed.getTime()}`,
    });
    for (const b of [s, r]) {
      expect(JSON.stringify(created(b))).not.toMatch(/inspector|site/i);
      expect(b.prisma).not.toHaveProperty('inspection');
    }
  });

  it('two reschedules of one inspection have different keys, so both notify', async () => {
    const at = new Date('2026-10-05T04:30:00.000Z');
    const a = build();
    const b = build();
    await a.service.inspectionRescheduled('app-1', 'i', at, new Date(1000));
    await b.service.inspectionRescheduled('app-1', 'i', at, new Date(2000));
    expect(created(a).dedupeKey).not.toBe(created(b).dedupeKey);
  });

  it('SLA_BREACHED / SLA_WARNING: the officer side of the application’s department, keyed per clock', async () => {
    const due = new Date('2026-10-01T10:00:00.000Z');
    const br = build();
    await br.service.slaBreached('app-1', 'clock-1', due);
    expect(br.recipients.officerSide).toHaveBeenCalledWith('app-1', 'dept-1');
    expect(created(br)).toMatchObject({
      recipients: ['so', 'admin'],
      eventType: 'SLA_BREACHED',
      audience: 'OFFICER',
      dedupeKey: 'SLA_BREACHED:clock-1',
      ...refs,
    });
    const wa = build();
    await wa.service.slaWarning('app-1', 'clock-1', due, 84.7);
    expect(created(wa)).toMatchObject({
      eventType: 'SLA_WARNING',
      audience: 'OFFICER',
      dedupeKey: 'SLA_WARNING:clock-1',
      payload: { dueAt: due, percentElapsed: 84 },
    });
    // A warning and a breach of one clock are different notifications.
    expect(created(wa).dedupeKey).not.toBe(created(br).dedupeKey);
  });

  it('never tells the applicant about the SLA (FRD 25.2 keeps it officer-facing)', async () => {
    const b = build();
    await b.service.slaBreached('app-1', 'c', new Date());
    await b.service.slaWarning('app-1', 'c', new Date(), 90);
    expect(b.recipients.applicantSide).not.toHaveBeenCalled();
  });

  it('REPRESENTATIVE_AUTHORISATION_REQUESTED: only the invited representative, an account-level notice naming the enterprise', async () => {
    const at = new Date('2026-09-25T10:00:00.000Z');
    const b = build();
    await b.service.representativeAuthorisationRequested('auth-1', at);
    expect(b.recipients.active).toHaveBeenCalledWith(['rep-1']);
    expect(created(b)).toMatchObject({
      recipients: ['rep-1'],
      eventType: 'REPRESENTATIVE_AUTHORISATION_REQUESTED',
      audience: 'ACCOUNT',
      enterpriseId: 'ent-1',
      dedupeKey: `REPRESENTATIVE_AUTHORISATION_REQUESTED:auth-1:${at.getTime()}`,
    });
    expect(created(b).message).toContain('Acme Works');
    expect(created(b).applicationId).toBeUndefined();
  });

  it('does nothing for an application, query or authorisation that no longer exists', async () => {
    const noApp = build({ app: null });
    await noApp.service.applicationSubmitted('gone');
    await noApp.service.slaBreached('gone', 'c', new Date());
    const noQuery = build({ query: null });
    await noQuery.service.queryRaised('app-1', 'gone');
    await noQuery.service.queryResponded('app-1', 'gone');
    const noAuth = build({ auth: null });
    await noAuth.service.representativeAuthorisationRequested(
      'gone',
      new Date(),
    );
    for (const b of [noApp, noQuery, noAuth]) {
      expect(b.notifications.create).not.toHaveBeenCalled();
    }
  });

  it('never fails the transition that called it: an error is logged by class only and swallowed', async () => {
    const error = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const b = build({
      createError: Object.assign(new Error('secret-value in SQL'), {
        name: 'PrismaClientKnownRequestError',
      }),
    });
    await expect(
      b.service.applicationSubmitted('app-1'),
    ).resolves.toBeUndefined();
    const logged = String(error.mock.calls[0][0]);
    expect(logged).toContain('APPLICATION_SUBMITTED');
    expect(logged).toContain('PrismaClientKnownRequestError');
    expect(logged).not.toContain('secret-value');
    error.mockRestore();
  });
});

describe('NotificationEventsService: compliance deadline approaching (FRD 26.1)', () => {
  it('tells the applicant side, per obligation, keyed by the record, with the due date and no requirement text', async () => {
    const b = build();
    await b.service.complianceDeadlineApproaching(
      'app-1',
      'rec-1',
      '2026-10-10',
    );
    expect(b.recipients.applicantSide).toHaveBeenCalledWith('proj-1');
    expect(created(b)).toMatchObject({
      recipients: ['owner', 'rep'],
      eventType: 'COMPLIANCE_DEADLINE_APPROACHING',
      audience: 'APPLICANT',
      dedupeKey: 'COMPLIANCE_DEADLINE_APPROACHING:rec-1',
      payload: {
        referenceNumber: 'APP-2026-000042',
        dueDate: '2026-10-10',
        complianceRecordId: 'rec-1',
      },
      ...refs,
    });
    expect(created(b).message).toContain('2026-10-10');
    expect(created(b).message).toContain('APP-2026-000042');
  });

  it('two occurrences of one obligation are two notifications (different records, different keys)', async () => {
    const a = build();
    const c = build();
    await a.service.complianceDeadlineApproaching(
      'app-1',
      'rec-1',
      '2026-10-10',
    );
    await c.service.complianceDeadlineApproaching(
      'app-1',
      'rec-2',
      '2026-11-10',
    );
    expect(created(a).dedupeKey).not.toBe(created(c).dedupeKey);
  });

  it('is never officer-facing, and does nothing for an application that no longer exists', async () => {
    const b = build();
    await b.service.complianceDeadlineApproaching(
      'app-1',
      'rec-1',
      '2026-10-10',
    );
    expect(b.recipients.officerSide).not.toHaveBeenCalled();
    const gone = build({ app: null });
    await gone.service.complianceDeadlineApproaching(
      'gone',
      'rec-1',
      '2026-10-10',
    );
    expect(gone.notifications.create).not.toHaveBeenCalled();
  });
});

describe('NotificationEventsService: scheme application status update', () => {
  const HISTORY = {
    toStatus: 'APPROVED',
    schemeApplication: {
      id: 'sa-1',
      referenceNumber: 'SCH-2026-000007',
      projectId: 'proj-1',
      project: { enterpriseId: 'ent-1' },
      scheme: { id: 'scheme-1', name: 'Test Scheme' },
    },
  };

  function buildScheme(history: unknown = HISTORY, createError?: Error) {
    const prisma = {
      schemeApplicationStatusHistory: {
        findFirst: jest.fn().mockResolvedValue(history),
      },
    };
    const recipients = {
      applicantSide: jest.fn().mockResolvedValue(['owner', 'rep']),
    };
    const notifications = {
      create: jest
        .fn()
        .mockImplementation(() =>
          createError
            ? Promise.reject(createError)
            : Promise.resolve({ created: 1, duplicates: 0 }),
        ),
    };
    const service = new NotificationEventsService(
      prisma as never,
      recipients as never,
      notifications as never,
    );
    return { service, prisma, recipients, notifications };
  }

  it('notifies the applicant side of the project once per status change, keyed by the history row', async () => {
    const b = buildScheme();
    await b.service.schemeApplicationStatusUpdated('sa-1', 'hist-1');
    expect(
      b.prisma.schemeApplicationStatusHistory.findFirst,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'hist-1', schemeApplicationId: 'sa-1' },
      }),
    );
    expect(b.recipients.applicantSide).toHaveBeenCalledWith('proj-1');
    const call = b.notifications.create.mock.calls[0][0];
    expect(call).toMatchObject({
      recipients: ['owner', 'rep'],
      eventType: 'SCHEME_APPLICATION_STATUS_UPDATE',
      audience: 'APPLICANT',
      dedupeKey: 'SCHEME_APPLICATION_STATUS_UPDATE:hist-1',
      enterpriseId: 'ent-1',
      projectId: 'proj-1',
    });
    // a scheme application is not an approval application
    expect(call.applicationId).toBeUndefined();
    expect(call.message).toContain('SCH-2026-000007');
    expect(call.message).toContain('is now approved');
    expect(call.payload).toEqual({
      referenceNumber: 'SCH-2026-000007',
      schemeApplicationId: 'sa-1',
      schemeId: 'scheme-1',
      status: 'APPROVED',
    });
  });

  it('does nothing for a status change that does not belong to that application', async () => {
    const b = buildScheme(null);
    await b.service.schemeApplicationStatusUpdated('sa-1', 'hist-x');
    expect(b.notifications.create).not.toHaveBeenCalled();
  });

  it('can never fail the transition: a delivery problem is logged (class only) and swallowed', async () => {
    const error = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const b = buildScheme(HISTORY, new Error('secret SQL detail'));
    await expect(
      b.service.schemeApplicationStatusUpdated('sa-1', 'hist-1'),
    ).resolves.toBeUndefined();
    const logged = error.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).toContain('SCHEME_APPLICATION_STATUS_UPDATE');
    expect(logged).not.toContain('secret SQL detail');
    error.mockRestore();
  });
});
