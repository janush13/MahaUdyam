import { NotFoundException } from '@nestjs/common';
import { NotificationsService } from './notifications.service';

const UUID = '3f2b8c1e-9d4a-4b6f-8a1e-2c7d5e9f0a11';
const visible = { userId: 'me', channel: 'IN_APP' };
const created = new Date('2026-09-25T10:00:00.000Z');

const row = (over: Record<string, unknown> = {}) => ({
  id: UUID,
  userId: 'me',
  eventType: 'QUERY_RAISED',
  channel: 'IN_APP',
  audience: 'APPLICANT',
  title: 'T',
  message: 'M',
  payload: { roundNumber: 1 },
  status: 'SENT',
  attemptCount: 0,
  createdAt: created,
  sentAt: created,
  readAt: null,
  dedupeKey: 'k',
  nextAttemptAt: null,
  failureReason: null,
  enterpriseId: 'e',
  projectId: 'p',
  applicationId: 'a',
  ...over,
});

function build(
  opts: {
    found?: ReturnType<typeof row> | null;
    reread?: ReturnType<typeof row>;
    claimed?: number;
    total?: number;
    unread?: number;
    rows?: ReturnType<typeof row>[];
  } = {},
) {
  const findFirst = jest.fn();
  findFirst.mockResolvedValueOnce('found' in opts ? opts.found : row());
  findFirst.mockResolvedValue(
    opts.reread ?? row({ readAt: created, status: 'READ' }),
  );
  const count = jest
    .fn()
    .mockResolvedValueOnce(opts.total ?? 0)
    .mockResolvedValueOnce(opts.unread ?? 0);
  const prisma = {
    notification: {
      findFirst,
      findMany: jest.fn().mockResolvedValue(opts.rows ?? []),
      count,
      updateMany: jest.fn().mockResolvedValue({ count: opts.claimed ?? 1 }),
    },
  };
  const access = { visibleWhere: jest.fn().mockResolvedValue(visible) };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  return {
    service: new NotificationsService(
      prisma as never,
      access as never,
      audit as never,
    ),
    prisma,
    access,
    audit,
  };
}

describe('NotificationsService.list', () => {
  it('starts from the caller’s visibility, newest first, with paging and both counts', async () => {
    const b = build({ total: 41, unread: 7, rows: [row()] });
    const out = await b.service.list('me', { page: 2, pageSize: 10 });
    const args = b.prisma.notification.findMany.mock.calls[0][0];
    expect(args.where).toEqual({ AND: [visible, {}] });
    expect(args.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
    expect(args.skip).toBe(10);
    expect(args.take).toBe(10);
    expect(out).toMatchObject({ page: 2, pageSize: 10, total: 41, unread: 7 });
    expect(out.items[0]).toEqual({
      id: UUID,
      eventType: 'QUERY_RAISED',
      title: 'T',
      message: 'M',
      read: false,
      readAt: null,
      createdAt: created,
      enterpriseId: 'e',
      projectId: 'p',
      applicationId: 'a',
      payload: { roundNumber: 1 },
    });
  });

  it('never exposes delivery internals or the dedupe key', async () => {
    const b = build({ rows: [row()] });
    const out = await b.service.list('me', {});
    for (const key of [
      'userId',
      'channel',
      'audience',
      'status',
      'attemptCount',
      'dedupeKey',
      'failureReason',
      'nextAttemptAt',
    ]) {
      expect(out.items[0]).not.toHaveProperty(key);
    }
  });

  it('filters unread / read by the read marker, on top of visibility', async () => {
    const unread = build();
    await unread.service.list('me', { unread: true });
    expect(unread.prisma.notification.findMany.mock.calls[0][0].where).toEqual({
      AND: [visible, { readAt: null }],
    });
    const read = build();
    await read.service.list('me', { unread: false });
    expect(read.prisma.notification.findMany.mock.calls[0][0].where).toEqual({
      AND: [visible, { readAt: { not: null } }],
    });
  });

  it('the unread count is over everything visible, whatever the list filter', async () => {
    const b = build({ unread: 3 });
    await b.service.list('me', { unread: false });
    expect(b.prisma.notification.count.mock.calls[1][0].where).toEqual({
      AND: [visible, { readAt: null }],
    });
  });
});

describe('NotificationsService.unreadCount / get', () => {
  it('counts only visible, unread rows', async () => {
    const b = build({ total: 5 });
    await expect(b.service.unreadCount('me')).resolves.toEqual({ unread: 5 });
    expect(b.prisma.notification.count.mock.calls[0][0].where).toEqual({
      AND: [visible, { readAt: null }],
    });
  });

  it('a single read is scoped by visibility AND id; anything else is a 404', async () => {
    const b = build();
    await b.service.get('me', UUID);
    expect(b.prisma.notification.findFirst.mock.calls[0][0].where).toEqual({
      AND: [visible, { id: UUID }],
    });
    await expect(
      build({ found: null }).service.get('me', UUID),
    ).rejects.toBeInstanceOf(NotFoundException);
    const bad = build();
    await expect(bad.service.get('me', 'not-a-uuid')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(bad.prisma.notification.findFirst).not.toHaveBeenCalled();
  });
});

describe('NotificationsService.markRead', () => {
  it('marks read with a conditional update, audits once without the message', async () => {
    const b = build();
    const out = await b.service.markRead('me', ['APPLICANT'], UUID, '1.2.3.4');
    expect(b.prisma.notification.updateMany).toHaveBeenCalledWith({
      where: { id: UUID, userId: 'me', readAt: null },
      data: { readAt: expect.any(Date), status: 'READ' },
    });
    expect(b.audit.record).toHaveBeenCalledTimes(1);
    expect(b.audit.record.mock.calls[0][0]).toMatchObject({
      userId: 'me',
      roleAtTime: 'APPLICANT',
      action: 'NOTIFICATION_READ',
      entityType: 'Notification',
      entityId: UUID,
      afterState: { eventType: 'QUERY_RAISED', applicationId: 'a' },
      ipAddress: '1.2.3.4',
    });
    expect(JSON.stringify(b.audit.record.mock.calls)).not.toContain('"M"');
    expect(out.read).toBe(true);
  });

  it('is idempotent: an already-read notification changes and audits nothing', async () => {
    const b = build({ found: row({ readAt: created, status: 'READ' }) });
    const out = await b.service.markRead('me', ['APPLICANT'], UUID, 'ip');
    expect(out.read).toBe(true);
    expect(b.prisma.notification.updateMany).not.toHaveBeenCalled();
    expect(b.audit.record).not.toHaveBeenCalled();
  });

  it('a racing second request that loses the update is not audited again', async () => {
    const b = build({ claimed: 0 });
    await b.service.markRead('me', ['APPLICANT'], UUID, 'ip');
    expect(b.audit.record).not.toHaveBeenCalled();
  });

  it('cannot mark another user’s (or an invisible) notification: 404, nothing written', async () => {
    const b = build({ found: null });
    await expect(
      b.service.markRead('me', ['APPLICANT'], UUID, 'ip'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(b.prisma.notification.updateMany).not.toHaveBeenCalled();
    expect(b.audit.record).not.toHaveBeenCalled();
  });
});
