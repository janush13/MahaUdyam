import { Logger } from '@nestjs/common';
import {
  NotificationDeliveryService,
  nextAttemptDelayMs,
} from './notification-delivery.service';

const now = new Date('2026-09-25T10:00:00.000Z');
const settings = { maxAttempts: 3, retryBaseSeconds: 60 };

function row(over: Record<string, unknown> = {}) {
  return {
    id: 'n1',
    channel: 'EMAIL',
    status: 'PENDING',
    attemptCount: 0,
    nextAttemptAt: null,
    eventType: 'QUERY_RAISED',
    applicationId: 'app-1',
    title: 'Title',
    message: 'Body',
    user: { email: 'a@example.test', mobile: '+910000000000' },
    ...over,
  };
}

function build(
  opts: {
    row?: ReturnType<typeof row> | null;
    claimed?: boolean;
    emailFails?: boolean;
    smsFails?: boolean;
    due?: Array<{ id: string }>;
  } = {},
) {
  const prisma = {
    notification: {
      findUnique: jest.fn().mockResolvedValue('row' in opts ? opts.row : row()),
      updateMany: jest
        .fn()
        .mockResolvedValue({ count: opts.claimed === false ? 0 : 1 }),
      update: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue(opts.due ?? []),
    },
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const email = {
    send: jest
      .fn()
      .mockImplementation(() =>
        opts.emailFails
          ? Promise.reject(new Error('smtp down'))
          : Promise.resolve(),
      ),
  };
  const sms = {
    send: jest
      .fn()
      .mockImplementation(() =>
        opts.smsFails
          ? Promise.reject(new Error('gateway down'))
          : Promise.resolve(),
      ),
  };
  const config = { get: jest.fn().mockReturnValue(settings) };
  const service = new NotificationDeliveryService(
    prisma as never,
    audit as never,
    config as never,
    email as never,
    sms as never,
  );
  return { service, prisma, audit, email, sms };
}

describe('nextAttemptDelayMs', () => {
  it('doubles the configured base each attempt (exponential backoff)', () => {
    expect([1, 2, 3, 4].map((a) => nextAttemptDelayMs(a, 60))).toEqual([
      60_000, 120_000, 240_000, 480_000,
    ]);
  });
});

describe('NotificationDeliveryService.attempt', () => {
  it('claims the attempt with one conditional update, sends, and marks SENT', async () => {
    const b = build();
    await expect(b.service.attempt('n1', now)).resolves.toBe('SENT');
    expect(b.prisma.notification.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'n1',
        status: { in: ['PENDING', 'FAILED'] },
        attemptCount: 0,
      },
      data: { attemptCount: { increment: 1 }, nextAttemptAt: null },
    });
    expect(b.email.send).toHaveBeenCalledWith(
      'a@example.test',
      'Title',
      'Body',
    );
    expect(b.prisma.notification.update).toHaveBeenCalledWith({
      where: { id: 'n1' },
      data: { status: 'SENT', sentAt: now, failureReason: null },
    });
  });

  it('routes an SMS row to the SMS adapter, with the number and the message only', async () => {
    const b = build({ row: row({ channel: 'SMS' }) });
    await b.service.attempt('n1', now);
    expect(b.sms.send).toHaveBeenCalledWith('+910000000000', 'Body');
    expect(b.email.send).not.toHaveBeenCalled();
  });

  it('a lost claim means another attempt owns the row: nothing is sent', async () => {
    const b = build({ claimed: false });
    await expect(b.service.attempt('n1', now)).resolves.toBe('SKIPPED');
    expect(b.email.send).not.toHaveBeenCalled();
    expect(b.prisma.notification.update).not.toHaveBeenCalled();
  });

  it('never delivers an in-app row, a delivered row, an exhausted row or one not yet due', async () => {
    const skipped = [
      row({ channel: 'IN_APP', status: 'SENT' }),
      row({ status: 'SENT' }),
      row({ status: 'READ', channel: 'IN_APP' }),
      row({ status: 'FAILED', attemptCount: 3 }),
      row({
        status: 'FAILED',
        attemptCount: 1,
        nextAttemptAt: new Date(now.getTime() + 1),
      }),
    ];
    for (const r of skipped) {
      const b = build({ row: r });
      await expect(b.service.attempt('n1', now)).resolves.toBe('SKIPPED');
      expect(b.prisma.notification.updateMany).not.toHaveBeenCalled();
    }
    const gone = build({ row: null });
    await expect(gone.service.attempt('x', now)).resolves.toBe('SKIPPED');
  });

  it('a failure marks FAILED with a CODE only and schedules the retry with backoff', async () => {
    const b = build({ emailFails: true });
    await expect(b.service.attempt('n1', now)).resolves.toBe('FAILED');
    expect(b.prisma.notification.update).toHaveBeenCalledWith({
      where: { id: 'n1' },
      data: {
        status: 'FAILED',
        failureReason: 'DELIVERY_ERROR',
        nextAttemptAt: new Date(now.getTime() + 60_000),
      },
    });
    expect(
      JSON.stringify(b.prisma.notification.update.mock.calls),
    ).not.toContain('smtp down');
    expect(b.audit.record).not.toHaveBeenCalled();
  });

  it('the second failure backs off twice as long', async () => {
    const b = build({
      emailFails: true,
      row: row({ status: 'FAILED', attemptCount: 1 }),
    });
    await b.service.attempt('n1', now);
    expect(
      b.prisma.notification.update.mock.calls[0][0].data.nextAttemptAt,
    ).toEqual(new Date(now.getTime() + 120_000));
  });

  it('the last allowed failure is final: no further attempt is scheduled and it is audited once', async () => {
    const b = build({
      emailFails: true,
      row: row({ status: 'FAILED', attemptCount: 2 }),
    });
    await expect(b.service.attempt('n1', now)).resolves.toBe('FAILED');
    expect(b.prisma.notification.update.mock.calls[0][0].data).toMatchObject({
      status: 'FAILED',
      nextAttemptAt: null,
    });
    expect(b.audit.record).toHaveBeenCalledTimes(1);
    expect(b.audit.record.mock.calls[0][0]).toMatchObject({
      userId: null,
      roleAtTime: 'SYSTEM',
      action: 'NOTIFICATION_DELIVERY_FAILED',
      entityType: 'Notification',
      entityId: 'n1',
      afterState: {
        eventType: 'QUERY_RAISED',
        channel: 'EMAIL',
        attempts: 3,
        applicationId: 'app-1',
      },
    });
    // The audit carries identifiers and counts, never the message or address.
    const audited = JSON.stringify(b.audit.record.mock.calls);
    expect(audited).not.toContain('Body');
    expect(audited).not.toContain('a@example.test');
  });

  it('a failed retry that then succeeds ends SENT', async () => {
    const b = build({ row: row({ status: 'FAILED', attemptCount: 1 }) });
    await expect(b.service.attempt('n1', now)).resolves.toBe('SENT');
  });
});

describe('NotificationDeliveryService.retryDue / deliverInBackground', () => {
  it('asks only for mirror rows still owed a delivery, due, under the attempt cap', async () => {
    const b = build({ due: [{ id: 'n1' }, { id: 'n2' }] });
    await expect(b.service.retryDue(now)).resolves.toEqual({ attempted: 2 });
    expect(b.prisma.notification.findMany.mock.calls[0][0].where).toEqual({
      channel: { not: 'IN_APP' },
      status: { in: ['PENDING', 'FAILED'] },
      attemptCount: { lt: 3 },
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
    });
  });

  it('does not count a row another attempt already owns', async () => {
    const b = build({ due: [{ id: 'n1' }], claimed: false });
    await expect(b.service.retryDue(now)).resolves.toEqual({ attempted: 0 });
  });

  it('a background attempt can never throw into the request that started it', async () => {
    const error = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const b = build();
    b.prisma.notification.findUnique.mockRejectedValue(
      Object.assign(new Error('boom'), {
        name: 'PrismaClientKnownRequestError',
      }),
    );
    expect(() => b.service.deliverInBackground('n1')).not.toThrow();
    await new Promise((r) => setImmediate(r));
    expect(String(error.mock.calls[0][0])).toContain(
      'PrismaClientKnownRequestError',
    );
    error.mockRestore();
  });
});
