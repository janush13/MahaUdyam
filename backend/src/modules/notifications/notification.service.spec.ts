import { Prisma } from '@prisma/client';
import { NotificationService } from './notification.service';

const base = {
  recipients: ['u1', 'u2'],
  eventType: 'QUERY_RAISED' as const,
  audience: 'APPLICANT' as const,
  title: 'T',
  message: 'M',
  dedupeKey: 'QUERY_RAISED:q1',
  enterpriseId: 'e1',
  projectId: 'p1',
  applicationId: 'a1',
};
const now = new Date('2026-09-25T10:00:00.000Z');

function build(
  opts: {
    extra?: string[];
    existing?: (userId: string, channel: string) => boolean;
    createError?: (n: number) => unknown;
  } = {},
) {
  let n = 0;
  const prisma = {
    notification: {
      findUnique: jest
        .fn()
        .mockImplementation(({ where }) =>
          Promise.resolve(
            opts.existing?.(
              where.userId_channel_dedupeKey.userId,
              where.userId_channel_dedupeKey.channel,
            )
              ? { id: 'x' }
              : null,
          ),
        ),
      create: jest.fn().mockImplementation(() => {
        n += 1;
        const err = opts.createError?.(n);
        return err ? Promise.reject(err) : Promise.resolve({ id: `row-${n}` });
      }),
    },
  };
  const delivery = { deliverInBackground: jest.fn() };
  const config = {
    get: jest.fn().mockReturnValue({ extraChannels: opts.extra ?? [] }),
  };
  const service = new NotificationService(
    prisma as never,
    delivery as never,
    config as never,
  );
  return { service, prisma, delivery };
}

const p2002 = () =>
  new Prisma.PrismaClientKnownRequestError('dup', {
    code: 'P2002',
    clientVersion: 'test',
  });

describe('NotificationService.create', () => {
  it('writes one IN_APP row per recipient, born SENT: the row is the delivery', async () => {
    const { service, prisma, delivery } = build();
    await expect(service.create(base, now)).resolves.toEqual({
      created: 2,
      duplicates: 0,
    });
    const calls = prisma.notification.create.mock.calls.map((c) => c[0].data);
    expect(calls.map((d) => d.userId)).toEqual(['u1', 'u2']);
    for (const d of calls) {
      expect(d).toMatchObject({
        channel: 'IN_APP',
        status: 'SENT',
        sentAt: now,
        audience: 'APPLICANT',
        dedupeKey: 'QUERY_RAISED:q1',
        enterpriseId: 'e1',
        projectId: 'p1',
        applicationId: 'a1',
      });
    }
    expect(delivery.deliverInBackground).not.toHaveBeenCalled();
  });

  it('creates for each distinct recipient once, even if listed twice', async () => {
    const { service, prisma } = build();
    await service.create({ ...base, recipients: ['u1', 'u1', 'u1'] }, now);
    expect(prisma.notification.create).toHaveBeenCalledTimes(1);
  });

  it('does nothing without recipients', async () => {
    const { service, prisma } = build();
    await expect(
      service.create({ ...base, recipients: [] }, now),
    ).resolves.toEqual({ created: 0, duplicates: 0 });
    expect(prisma.notification.create).not.toHaveBeenCalled();
  });

  it('adds PENDING EMAIL / SMS mirrors when configured, and hands only those to delivery', async () => {
    const { service, prisma, delivery } = build({ extra: ['EMAIL', 'SMS'] });
    await service.create({ ...base, recipients: ['u1'] }, now);
    const data = prisma.notification.create.mock.calls.map((c) => c[0].data);
    expect(data.map((d) => [d.channel, d.status, d.sentAt])).toEqual([
      ['IN_APP', 'SENT', now],
      ['EMAIL', 'PENDING', null],
      ['SMS', 'PENDING', null],
    ]);
    expect(delivery.deliverInBackground.mock.calls).toEqual([
      ['row-2'],
      ['row-3'],
    ]);
  });

  it('is idempotent: an existing (recipient, channel, key) is a duplicate, not an insert', async () => {
    const { service, prisma } = build({ existing: (u) => u === 'u1' });
    await expect(service.create(base, now)).resolves.toEqual({
      created: 1,
      duplicates: 1,
    });
    expect(prisma.notification.create).toHaveBeenCalledTimes(1);
    expect(prisma.notification.create.mock.calls[0][0].data.userId).toBe('u2');
  });

  it('is race-safe: losing the unique-index race counts as a duplicate and does not throw', async () => {
    const { service, delivery } = build({
      extra: ['EMAIL'],
      createError: (n) => (n === 1 ? p2002() : undefined),
    });
    await expect(
      service.create({ ...base, recipients: ['u1'] }, now),
    ).resolves.toEqual({ created: 1, duplicates: 1 });
    // The loser's channel was not delivered twice; the winner's mirror was.
    expect(delivery.deliverInBackground).toHaveBeenCalledTimes(1);
  });

  it('lets any other failure surface (the event service swallows and logs it)', async () => {
    const { service } = build({ createError: () => new Error('db down') });
    await expect(service.create(base, now)).rejects.toThrow('db down');
  });

  it('never puts the key of one event on another: keys differ per occurrence', async () => {
    const { service, prisma } = build();
    await service.create({ ...base, recipients: ['u1'] }, now);
    await service.create(
      { ...base, recipients: ['u1'], dedupeKey: 'QUERY_RAISED:q2' },
      now,
    );
    const keys = prisma.notification.create.mock.calls.map(
      (c) => c[0].data.dedupeKey,
    );
    expect(new Set(keys).size).toBe(2);
  });
});
