import {
  E2eContext,
  captureOutput,
  createE2eContext,
} from './support/e2e-helpers';
import { OfficerWorld, as, buildOfficerWorld } from './support/officer-world';
import {
  EMAIL_ADAPTER,
  EmailAdapter,
  SMS_ADAPTER,
  SmsAdapter,
} from '../src/modules/notifications/delivery/channel-adapters';
import { NotificationDeliveryService } from '../src/modules/notifications/delivery/notification-delivery.service';
import { NotificationService } from '../src/modules/notifications/notification.service';

jest.setTimeout(600_000);

/**
 * Step 13 - the optional EMAIL / SMS mirrors (Blueprint 24 / 25.2), with the
 * platform configured to mirror both. Only the mock providers exist: they log
 * a clearly marked simulated line and claim no real delivery. The in-app
 * notification is written independently and is never affected by a mirror's
 * failure; failures are retried with exponential backoff up to the configured
 * maximum, then left FAILED and audited.
 */
describe('Notifications e2e - EMAIL / SMS mirrors and retry', () => {
  let ctx: E2eContext;
  let w: OfficerWorld;
  let email: EmailAdapter;
  let sms: SmsAdapter;
  let delivery: NotificationDeliveryService;
  let creator: NotificationService;

  const api = (a: { accessToken: string }) => as(ctx, a.accessToken);

  const submit = (tag: string) =>
    ctx.submittedApplication(
      w.owner.accessToken,
      w.enterpriseId,
      w.approvalA,
      `nc-${tag}`,
    );
  const rows = (applicationId: string, userId = w.owner.user.id) =>
    ctx.prisma.notification.findMany({
      where: { applicationId, userId },
      orderBy: { channel: 'asc' },
    });
  const byChannel = async (applicationId: string, channel: string) =>
    (await rows(applicationId)).find((r) => r.channel === channel);
  /** Waits (bounded) for the fire-and-forget delivery to settle. */
  const until = async <T>(
    read: () => Promise<T>,
    done: (v: T) => boolean,
  ): Promise<T> => {
    for (let i = 0; i < 100; i++) {
      const v = await read();
      if (done(v)) {
        return v;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error('timed out waiting for delivery');
  };
  const minutes = (n: number) => new Date(Date.now() + n * 60_000);

  beforeAll(async () => {
    process.env.NOTIFICATION_EXTRA_CHANNELS = 'EMAIL,SMS';
    ctx = await createE2eContext({ verboseLogs: true });
    w = await buildOfficerWorld(ctx, 'nc');
    email = ctx.app.get(EMAIL_ADAPTER, { strict: false });
    sms = ctx.app.get(SMS_ADAPTER, { strict: false });
    delivery = ctx.app.get(NotificationDeliveryService, { strict: false });
    creator = ctx.app.get(NotificationService, { strict: false });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await ctx.cleanup();
    await ctx.app.close();
  });

  it('an event is written in-app AND mirrored to email and SMS, which are delivered through the adapters', async () => {
    const s = await submit('mirror');
    const settled = await until(
      () => rows(s.applicationId),
      (r) => r.length === 3 && r.every((n) => n.status !== 'PENDING'),
    );
    const inApp = settled.find((r) => r.channel === 'IN_APP');
    expect(inApp).toMatchObject({ status: 'SENT', attemptCount: 0 });
    for (const channel of ['EMAIL', 'SMS']) {
      const row = settled.find((r) => r.channel === channel);
      expect(row).toMatchObject({
        status: 'SENT',
        attemptCount: 1,
        failureReason: null,
        nextAttemptAt: null,
      });
      expect(row?.sentAt).not.toBeNull();
      // Same event, same content, one dedupe key across channels.
      expect(row?.dedupeKey).toBe(inApp?.dedupeKey);
      expect(row?.message).toBe(inApp?.message);
    }
  });

  it('the notification centre lists the in-app row only, and the mirrors are not readable', async () => {
    const s = await submit('centre');
    await until(
      () => rows(s.applicationId),
      (r) => r.length === 3,
    );
    const list = (
      await api(w.owner).get('/notifications?pageSize=100').expect(200)
    ).body;
    const mine = list.items.filter(
      (n: { applicationId: string }) => n.applicationId === s.applicationId,
    );
    expect(mine).toHaveLength(1);
    const mirror = await byChannel(s.applicationId, 'EMAIL');
    await api(w.owner).get(`/notifications/${mirror?.id}`).expect(404);
    await api(w.owner).post(`/notifications/${mirror?.id}/read`).expect(404);
  });

  it('the simulated providers say so in the log and never log the address, the number or the message', async () => {
    const output = captureOutput();
    let captured = '';
    try {
      const s = await submit('logs');
      await until(
        () => rows(s.applicationId),
        (r) => r.length === 3 && r.every((n) => n.status === 'SENT'),
      );
    } finally {
      captured = output.stop();
    }
    expect(captured).toContain('[SIMULATED EMAIL]');
    expect(captured).toContain('[SIMULATED SMS]');
    expect(captured).not.toContain(w.owner.user.email);
    expect(captured).not.toContain(w.owner.user.mobile);
    expect(captured).not.toContain('has been submitted to the department');
  });

  it('a failing mirror never affects the in-app notification, is retried with backoff, and ends FAILED and audited', async () => {
    const send = jest
      .spyOn(email, 'send')
      .mockRejectedValue(new Error('smtp exploded with owner@secret.test'));
    const s = await submit('fail');

    // The first attempt fails; the in-app row and the SMS mirror are unaffected.
    const failed = await until(
      () => byChannel(s.applicationId, 'EMAIL'),
      (r) => r?.status === 'FAILED',
    );
    expect(failed).toMatchObject({
      attemptCount: 1,
      failureReason: 'DELIVERY_ERROR',
    });
    expect(failed?.nextAttemptAt).not.toBeNull();
    expect(JSON.stringify(failed)).not.toContain('smtp exploded');
    expect((await byChannel(s.applicationId, 'IN_APP'))?.status).toBe('SENT');
    await until(
      () => byChannel(s.applicationId, 'SMS'),
      (r) => r?.status === 'SENT',
    );
    const inbox = (
      await api(w.owner).get('/notifications?pageSize=100').expect(200)
    ).body.items;
    expect(
      inbox.filter(
        (n: { applicationId: string }) => n.applicationId === s.applicationId,
      ),
    ).toHaveLength(1);

    // Not yet due: a run now does nothing to it.
    const calls = send.mock.calls.length;
    await delivery.retryDue(new Date());
    expect(send.mock.calls.length).toBe(calls);

    // Retry 2 (after the first backoff), then retry 3 (after the doubled one).
    await delivery.retryDue(minutes(2));
    const second = await byChannel(s.applicationId, 'EMAIL');
    expect(second).toMatchObject({ status: 'FAILED', attemptCount: 2 });
    expect(second?.nextAttemptAt).not.toBeNull();
    expect(
      (second?.nextAttemptAt as Date).getTime() -
        (failed?.nextAttemptAt as Date).getTime(),
    ).toBeGreaterThan(0);
    await delivery.retryDue(minutes(30));
    const final = await byChannel(s.applicationId, 'EMAIL');
    expect(final).toMatchObject({
      status: 'FAILED',
      attemptCount: 3,
      nextAttemptAt: null,
    });

    // Exhausted: never attempted again, and audited exactly once, by the system,
    // with identifiers and counts only.
    const before = send.mock.calls.length;
    await delivery.retryDue(minutes(600));
    expect(send.mock.calls.length).toBe(before);
    const audits = await ctx.prisma.auditLog.findMany({
      where: { entityId: final?.id, action: 'NOTIFICATION_DELIVERY_FAILED' },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ userId: null, roleAtTime: 'SYSTEM' });
    expect(audits[0].afterState).toMatchObject({
      channel: 'EMAIL',
      attempts: 3,
      applicationId: s.applicationId,
    });
    expect(JSON.stringify(audits[0])).not.toMatch(/secret\.test|submitted/);
    // The in-app row is still there, unread and readable.
    expect((await byChannel(s.applicationId, 'IN_APP'))?.readAt).toBeNull();
  });

  it('a mirror that fails once and then recovers is delivered by the retry', async () => {
    jest.spyOn(sms, 'send').mockRejectedValueOnce(new Error('gateway down'));
    const s = await submit('recover');
    await until(
      () => byChannel(s.applicationId, 'SMS'),
      (r) => r?.status === 'FAILED',
    );
    await delivery.retryDue(minutes(2));
    expect(await byChannel(s.applicationId, 'SMS')).toMatchObject({
      status: 'SENT',
      attemptCount: 2,
      failureReason: null,
      nextAttemptAt: null,
    });
  });

  it('concurrent dispatch of one event, and concurrent retry runs, deliver each mirror exactly once', async () => {
    const send = jest.spyOn(email, 'send');
    const s = await submit('once');
    await until(
      () => byChannel(s.applicationId, 'EMAIL'),
      (r) => r?.status === 'SENT',
    );
    const app = await ctx.prisma.approvalApplication.findUniqueOrThrow({
      where: { id: s.applicationId },
      include: { project: true },
    });
    send.mockClear();
    const key = `ONCE:${s.applicationId}`;
    const input = {
      recipients: [w.owner.user.id],
      eventType: 'QUERY_RAISED' as const,
      audience: 'APPLICANT' as const,
      title: 'Once',
      message: 'Once message',
      dedupeKey: key,
      enterpriseId: app.project.enterpriseId,
      projectId: app.projectId,
      applicationId: app.id,
    };
    const results = await Promise.all(
      Array.from({ length: 6 }, () => creator.create(input)),
    );
    expect(results.reduce((n, r) => n + r.created, 0)).toBe(3);
    await Promise.all([
      delivery.retryDue(minutes(1)),
      delivery.retryDue(minutes(1)),
      delivery.retryDue(minutes(1)),
    ]);
    const settled = await until(
      () => ctx.prisma.notification.findMany({ where: { dedupeKey: key } }),
      (r) => r.length === 3 && r.every((n) => n.status !== 'PENDING'),
    );
    expect(settled.every((n) => n.status === 'SENT')).toBe(true);
    expect(
      settled.every((n) => n.channel === 'IN_APP' || n.attemptCount === 1),
    ).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
  });
});
