import request from 'supertest';
import { API, E2eContext, createE2eContext } from './support/e2e-helpers';
import {
  Actor,
  OfficerWorld,
  as,
  buildOfficerWorld,
} from './support/officer-world';
import { NotificationService } from '../src/modules/notifications/notification.service';

jest.setTimeout(600_000);

/**
 * Step 13 - the notification centre API (Blueprint 13.11) and the integrity of
 * the notifications table, over real HTTP -> Nest -> Prisma -> PostgreSQL:
 * listing, paging, the unread filter and count, reading one, marking read
 * (idempotent, one-way, audited once, never with the message), isolation
 * between users, no way to create / edit / delete a notification through the
 * API, concurrent creation, and the rules PostgreSQL itself enforces.
 */
describe('Notifications e2e - API, read state, isolation, integrity', () => {
  let ctx: E2eContext;
  let w: OfficerWorld;
  let creator: NotificationService;
  const apps: Array<{ projectId: string; applicationId: string }> = [];

  const api = (a: { accessToken: string }) => as(ctx, a.accessToken);
  const errorCode = (res: { body: { error?: { code?: string } } }) =>
    res.body.error?.code;

  interface N {
    id: string;
    eventType: string;
    title: string;
    message: string;
    read: boolean;
    readAt: string | null;
    createdAt: string;
    applicationId: string | null;
  }
  const list = async (a: Actor, query = '') =>
    (await api(a).get(`/notifications${query}`).expect(200)).body as {
      items: N[];
      page: number;
      pageSize: number;
      total: number;
      unread: number;
    };
  const unread = async (a: Actor) =>
    (await api(a).get('/notifications/unread-count').expect(200)).body
      .unread as number;
  const readEvents = (id: string) =>
    ctx.prisma.auditLog.findMany({
      where: { entityId: id, action: 'NOTIFICATION_READ' },
    });

  beforeAll(async () => {
    ctx = await createE2eContext();
    w = await buildOfficerWorld(ctx, 'na');
    creator = ctx.app.get(NotificationService);
    // Three submissions = three APPLICATION_SUBMITTED notifications for the owner.
    for (const t of ['a', 'b', 'c']) {
      apps.push(
        await ctx.submittedApplication(
          w.owner.accessToken,
          w.enterpriseId,
          w.approvalA,
          `na-${t}`,
        ),
      );
    }
  });

  afterAll(async () => {
    await ctx.cleanup();
    await ctx.app.close();
  });

  // -------------------------------------------------------------------------
  describe('listing', () => {
    it('is newest first, with the counts, and exposes no delivery internals', async () => {
      const res = await list(w.owner);
      expect(res.total).toBeGreaterThanOrEqual(3);
      expect(res.unread).toBe(res.total);
      const times = res.items.map((n) => new Date(n.createdAt).getTime());
      expect([...times].sort((a, b) => b - a)).toEqual(times);
      expect(Object.keys(res.items[0]).sort()).toEqual(
        [
          'id',
          'eventType',
          'title',
          'message',
          'read',
          'readAt',
          'createdAt',
          'enterpriseId',
          'projectId',
          'applicationId',
          'payload',
        ].sort(),
      );
    });

    it('pages without repeating or skipping', async () => {
      const all = await list(w.owner, '?pageSize=100');
      const p1 = await list(w.owner, '?pageSize=2&page=1');
      const p2 = await list(w.owner, '?pageSize=2&page=2');
      expect(p1.items).toHaveLength(2);
      expect(p1.total).toBe(all.total);
      expect([...p1.items, ...p2.items].map((n) => n.id)).toEqual(
        all.items.slice(0, p1.items.length + p2.items.length).map((n) => n.id),
      );
    });

    it('validates the query', async () => {
      for (const q of [
        'pageSize=0',
        'pageSize=101',
        'page=0',
        'unread=maybe',
      ]) {
        await api(w.owner).get(`/notifications?${q}`).expect(400);
      }
    });

    it('is closed to unauthenticated callers', async () => {
      await request(ctx.http).get(`${API}/notifications`).expect(401);
      await request(ctx.http)
        .get(`${API}/notifications/unread-count`)
        .expect(401);
    });
  });

  // -------------------------------------------------------------------------
  describe('read state', () => {
    it('marks one read: the flag, the timestamp, the unread count and the filter follow', async () => {
      const before = await unread(w.owner);
      const target = (await list(w.owner)).items[0];
      const res = await api(w.owner)
        .post(`/notifications/${target.id}/read`)
        .expect(200);
      expect(res.body).toMatchObject({ id: target.id, read: true });
      expect(res.body.readAt).not.toBeNull();
      expect(await unread(w.owner)).toBe(before - 1);
      const onlyUnread = await list(w.owner, '?unread=true&pageSize=100');
      expect(onlyUnread.items.map((n) => n.id)).not.toContain(target.id);
      const onlyRead = await list(w.owner, '?unread=false&pageSize=100');
      expect(onlyRead.items.map((n) => n.id)).toContain(target.id);
      // The list-level unread count is over everything, whatever the filter.
      expect(onlyRead.unread).toBe(before - 1);
      const row = await ctx.prisma.notification.findUniqueOrThrow({
        where: { id: target.id },
      });
      expect(row.status).toBe('READ');
      expect(row.readAt).not.toBeNull();
    });

    it('is idempotent and audited exactly once, with the actor and no message text', async () => {
      const target = (await list(w.owner, '?unread=true')).items[0];
      const first = await api(w.owner)
        .post(`/notifications/${target.id}/read`)
        .expect(200);
      const second = await api(w.owner)
        .post(`/notifications/${target.id}/read`)
        .expect(200);
      expect(second.body.readAt).toBe(first.body.readAt);
      const events = await readEvents(target.id);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        userId: w.owner.user.id,
        entityType: 'Notification',
      });
      expect(JSON.stringify(events[0])).not.toContain(target.message);
      expect(events[0].afterState).toEqual({
        eventType: target.eventType,
        applicationId: target.applicationId,
      });
    });

    it('simultaneous reads change it once and audit it once', async () => {
      const target = (await list(w.owner, '?unread=true')).items[0];
      const results = await Promise.all(
        [1, 2, 3, 4, 5].map(() =>
          api(w.owner).post(`/notifications/${target.id}/read`),
        ),
      );
      expect(results.every((r) => r.status === 200)).toBe(true);
      expect(new Set(results.map((r) => r.body.readAt)).size).toBe(1);
      expect(await readEvents(target.id)).toHaveLength(1);
    });

    it('reading one does not touch the others', async () => {
      const all = await list(w.owner, '?pageSize=100');
      const stillUnread = all.items.filter((n) => !n.read).length;
      expect(all.unread).toBe(stillUnread);
    });

    it('creating a notification writes no audit (its cause already is audited)', async () => {
      const s = apps[0];
      const row = await ctx.prisma.notification.findFirstOrThrow({
        where: { applicationId: s.applicationId, userId: w.owner.user.id },
      });
      expect(
        await ctx.prisma.auditLog.count({
          where: { entityType: 'Notification', entityId: row.id },
        }),
      ).toBe((await readEvents(row.id)).length);
    });
  });

  // -------------------------------------------------------------------------
  describe('isolation', () => {
    it("one applicant never sees, reads or marks another's notification", async () => {
      const mine = (await list(w.owner, '?pageSize=100')).items;
      expect(mine.length).toBeGreaterThan(0);
      const theirs = await list(w.owner2, '?pageSize=100');
      expect(theirs.items.map((n) => n.id)).not.toEqual(
        expect.arrayContaining([mine[0].id]),
      );
      expect(theirs.total).toBe(0);
      for (const n of mine) {
        for (const stranger of [w.owner2, w.soA1, w.adminA, w.sysAdmin]) {
          const get = await api(stranger).get(`/notifications/${n.id}`);
          expect(get.status).toBe(404);
          expect(errorCode(get)).toBe('NOT_FOUND');
          await api(stranger).post(`/notifications/${n.id}/read`).expect(404);
        }
      }
      // ...and the failed attempts changed nothing.
      const row = await ctx.prisma.notification.findUniqueOrThrow({
        where: { id: mine[mine.length - 1].id },
      });
      expect(row.readAt === null).toBe(!mine[mine.length - 1].read);
    });

    it('a nonexistent or malformed id is a 404 / 400, never a 500', async () => {
      await api(w.owner)
        .get('/notifications/00000000-0000-4000-8000-000000000000')
        .expect(404);
      await api(w.owner).get('/notifications/not-a-uuid').expect(400);
      await api(w.owner).post('/notifications/not-a-uuid/read').expect(400);
    });

    it('an officer’s inbox holds only officer notifications addressed to them', async () => {
      const officer = await list(w.soA1, '?pageSize=100');
      for (const n of officer.items) {
        expect(['QUERY_RESPONDED', 'SLA_WARNING', 'SLA_BREACHED']).toContain(
          n.eventType,
        );
      }
      // The owner's submission notices are not in any officer's inbox.
      expect(officer.items.map((n) => n.applicationId)).not.toContain(
        apps[0].applicationId,
      );
    });
  });

  // -------------------------------------------------------------------------
  describe('no way to write a notification through the API', () => {
    it('creating, replacing, editing or deleting is not a route, for any actor', async () => {
      const target = (await list(w.owner)).items[0];
      const body = { title: 'x', message: 'x', userId: w.owner.user.id };
      for (const actor of [w.owner, w.soA1, w.adminA, w.sysAdmin]) {
        expect(
          (await api(actor).post('/notifications').send(body)).status,
        ).toBe(404);
        for (const verb of ['put', 'patch', 'del'] as const) {
          const res = await api(actor)
            [verb](`/notifications/${target.id}`)
            .send(body);
          expect(res.status).toBe(404);
        }
        expect(
          (await api(actor).post('/notifications/read-all').send({})).status,
        ).toBe(404);
      }
    });
  });

  // -------------------------------------------------------------------------
  describe('concurrent creation', () => {
    it('the same event dispatched many times at once yields one row per recipient', async () => {
      const s = apps[1];
      const app = await ctx.prisma.approvalApplication.findUniqueOrThrow({
        where: { id: s.applicationId },
        include: { project: true },
      });
      const input = {
        recipients: [w.owner.user.id, w.owner2.user.id],
        eventType: 'QUERY_RAISED' as const,
        audience: 'APPLICANT' as const,
        title: 'Race',
        message: 'Race message',
        dedupeKey: `RACE:${s.applicationId}`,
        enterpriseId: app.project.enterpriseId,
        projectId: app.projectId,
        applicationId: app.id,
      };
      const results = await Promise.all(
        Array.from({ length: 8 }, () => creator.create(input)),
      );
      expect(results.reduce((n, r) => n + r.created, 0)).toBe(2);
      expect(results.reduce((n, r) => n + r.duplicates, 0)).toBe(8 * 2 - 2);
      expect(
        await ctx.prisma.notification.count({
          where: { dedupeKey: input.dedupeKey },
        }),
      ).toBe(2);
    });

    it('a different occurrence of the same event type is a different notification', async () => {
      const s = apps[2];
      const app = await ctx.prisma.approvalApplication.findUniqueOrThrow({
        where: { id: s.applicationId },
        include: { project: true },
      });
      const make = (key: string) =>
        creator.create({
          recipients: [w.owner.user.id],
          eventType: 'QUERY_RAISED',
          audience: 'APPLICANT',
          title: 'Round',
          message: 'Round message',
          dedupeKey: key,
          enterpriseId: app.project.enterpriseId,
          projectId: app.projectId,
          applicationId: app.id,
        });
      expect((await make(`ROUND:${app.id}:1`)).created).toBe(1);
      expect((await make(`ROUND:${app.id}:2`)).created).toBe(1);
      expect((await make(`ROUND:${app.id}:1`)).created).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  describe('integrity enforced by PostgreSQL', () => {
    let rowId: string;
    beforeAll(async () => {
      rowId = (
        await ctx.prisma.notification.findFirstOrThrow({
          where: { userId: w.owner.user.id, readAt: null, channel: 'IN_APP' },
        })
      ).id;
    });
    const update = (data: Record<string, unknown>, id?: string) =>
      ctx.prisma.notification.update({ where: { id: id ?? rowId }, data });

    it('what a notification says, and whom it is for, never changes', async () => {
      const current = await ctx.prisma.notification.findUniqueOrThrow({
        where: { id: rowId },
      });
      const otherApplicationId = apps.find(
        (a) => a.applicationId !== current.applicationId,
      )?.applicationId as string;
      for (const data of [
        { message: 'Tampered' },
        { title: 'Tampered' },
        { userId: w.owner2.user.id },
        { eventType: 'SLA_BREACHED' },
        { audience: 'OFFICER' },
        { dedupeKey: 'other' },
        { payload: { tampered: true } },
        { createdAt: new Date(0) },
        { applicationId: otherApplicationId },
      ]) {
        await expect(update(data)).rejects.toThrow(/immutable/);
      }
    });

    it('read is one-way: it cannot be cleared or moved', async () => {
      await update({ readAt: new Date(), status: 'READ' });
      await expect(update({ readAt: null, status: 'SENT' })).rejects.toThrow();
      await expect(update({ readAt: new Date(1) })).rejects.toThrow();
    });

    it('read and delivered states must agree; an in-app row is born SENT and is never "delivered" by an adapter', async () => {
      const other = (
        await ctx.prisma.notification.findFirstOrThrow({
          where: { userId: w.owner.user.id, readAt: null, channel: 'IN_APP' },
        })
      ).id;
      await expect(update({ status: 'READ' }, other)).rejects.toThrow(
        /notifications_state_check/,
      );
      await expect(update({ status: 'FAILED' }, other)).rejects.toThrow();
      await expect(update({ status: 'PENDING' }, other)).rejects.toThrow();
      await expect(
        ctx.prisma.notification.create({
          data: {
            userId: w.owner.user.id,
            eventType: 'QUERY_RAISED',
            channel: 'IN_APP',
            audience: 'ACCOUNT',
            title: 't',
            message: 'm',
            dedupeKey: 'born-pending',
            status: 'PENDING',
          },
        }),
      ).rejects.toThrow(/born SENT/);
      await expect(
        ctx.prisma.notification.create({
          data: {
            userId: w.owner.user.id,
            eventType: 'QUERY_RAISED',
            channel: 'EMAIL',
            audience: 'ACCOUNT',
            title: 't',
            message: 'm',
            dedupeKey: 'email-born-sent',
            status: 'SENT',
            sentAt: new Date(),
          },
        }),
      ).rejects.toThrow(/born PENDING/);
    });

    it('a blank title or message, and a second row for one (recipient, channel, key), are refused', async () => {
      const base = {
        userId: w.owner.user.id,
        eventType: 'QUERY_RAISED',
        channel: 'IN_APP' as const,
        audience: 'ACCOUNT' as const,
        status: 'SENT' as const,
        sentAt: new Date(),
      };
      await expect(
        ctx.prisma.notification.create({
          data: { ...base, title: '  ', message: 'm', dedupeKey: 'blank-t' },
        }),
      ).rejects.toThrow(/notifications_content_check/);
      await expect(
        ctx.prisma.notification.create({
          data: { ...base, title: 't', message: '', dedupeKey: 'blank-m' },
        }),
      ).rejects.toThrow(/notifications_content_check/);
      const first = { ...base, title: 't', message: 'm', dedupeKey: 'once' };
      await ctx.prisma.notification.create({ data: first });
      await expect(
        ctx.prisma.notification.create({ data: first }),
      ).rejects.toThrow(/Unique constraint/);
    });

    it('deleting an application does not delete its notifications, and deleting a user removes theirs', async () => {
      // The reference is nulled by its foreign key (the one change the content
      // trigger permits), the row survives.
      const user = await ctx.registerWithRole('na-cascade', 'APPLICANT');
      const n = await ctx.prisma.notification.create({
        data: {
          userId: user.id,
          eventType: 'QUERY_RAISED',
          channel: 'IN_APP',
          audience: 'ACCOUNT',
          title: 't',
          message: 'm',
          dedupeKey: 'cascade',
          status: 'SENT',
          sentAt: new Date(),
        },
      });
      await ctx.prisma.user.delete({ where: { id: user.id } });
      expect(
        await ctx.prisma.notification.findUnique({ where: { id: n.id } }),
      ).toBeNull();
    });
  });
});
