import { E2eContext, createE2eContext } from './support/e2e-helpers';
import {
  Actor,
  OfficerWorld,
  as,
  buildOfficerWorld,
} from './support/officer-world';
import {
  addScrutinyStage,
  backdateClock,
  clockOf,
} from './support/sla-helpers';
import { SlaSweepService } from '../src/modules/sla/sla-sweep.service';

jest.setTimeout(600_000);

/**
 * Step 13 - SLA notifications (Blueprint 23.3): "a NotificationModule event at
 * two configurable thresholds ... both to the assigned officer and their
 * Department Admin". The warning threshold is CONFIGURED (there is no default),
 * the breach is the existing one, and neither adds a second calculation: the
 * sweep and the pause / completion paths that already record a breach are the
 * only sources. Repeating a sweep never repeats a notification.
 */
describe('Notifications e2e - SLA warning and breach', () => {
  let ctx: E2eContext;
  let w: OfficerWorld;
  let sweep: SlaSweepService;
  let approvalP: string;

  const api = (a: { accessToken: string }) => as(ctx, a.accessToken);
  // Only this suite's applications: parallel suites run their own sweeps, and a
  // global sweep here would breach their fixtures (and theirs, ours).
  const mine = new Set<string>();
  const sweepMine = () =>
    sweep.sweep(new Date(), { applicationIds: [...mine] });
  const warnMine = () => sweep.warn(new Date(), { applicationIds: [...mine] });
  const officerApp = (id: string) => `/officer/applications/${id}`;
  const appBase = (s: Sub) =>
    `/enterprises/${w.enterpriseId}/projects/${s.projectId}/applications/${s.applicationId}`;

  interface Sub {
    projectId: string;
    applicationId: string;
  }
  interface N {
    id: string;
    eventType: string;
    message: string;
    applicationId: string | null;
    payload: Record<string, unknown> | null;
  }
  const inbox = async (a: Actor): Promise<N[]> =>
    (await api(a).get('/notifications?pageSize=100').expect(200)).body.items;
  const of = async (a: Actor, type: string, applicationId: string) =>
    (await inbox(a)).filter(
      (n) => n.eventType === type && n.applicationId === applicationId,
    );

  const underScrutiny = async (tag: string, assign = true): Promise<Sub> => {
    const s = await ctx.submittedApplication(
      w.owner.accessToken,
      w.enterpriseId,
      approvalP,
      `ns-${tag}`,
    );
    mine.add(s.applicationId);
    if (assign) {
      await api(w.adminA)
        .post(`${officerApp(s.applicationId)}/assignment`)
        .send({ officerUserId: w.soA1.user.id })
        .expect(201);
      await api(w.soA1)
        .post(`${officerApp(s.applicationId)}/start-scrutiny`)
        .expect(200);
    }
    return s;
  };
  /** Deadline passed a day ago. */
  const late = async (tag: string, assign = true) => {
    const s = await underScrutiny(tag, assign);
    await backdateClock(ctx.prisma, s.applicationId, { pauseOnQuery: true });
    return s;
  };
  /** 100 h into a 110 h window: ~91% elapsed, deadline still ahead. */
  const nearDeadline = async (tag: string, assign = true) => {
    const s = await underScrutiny(tag, assign);
    await backdateClock(ctx.prisma, s.applicationId, {
      startedHoursAgo: 100,
      dueHoursAgo: -10,
      pauseOnQuery: true,
    });
    return s;
  };
  const recommend = (s: Sub) =>
    api(w.soA1)
      .post(`${officerApp(s.applicationId)}/recommendation`)
      .send({ outcome: 'APPROVE', reason: 'In order.' });

  const everyoneElse = () => [
    w.soA2,
    w.soB,
    w.adminB,
    w.aaA,
    w.inspectorA,
    w.sysAdmin,
    w.leadership,
    w.owner,
    w.owner2,
  ];

  beforeAll(async () => {
    // Configured, not defaulted: 80 is the blueprint's own "e.g." (23.3).
    process.env.SLA_WARNING_THRESHOLD_PERCENT = '80';
    ctx = await createE2eContext();
    w = await buildOfficerWorld(ctx, 'ns');
    sweep = ctx.app.get(SlaSweepService);
    const { approvalTypeId } = await ctx.createStartableApproval(
      w.owner.user.id,
      'ns-p',
      { departmentId: w.deptA.id },
    );
    approvalP = approvalTypeId;
    await addScrutinyStage(ctx.prisma, approvalP, w.deptA.id, {
      slaDays: 3,
      pauseOnQuery: true,
    });
  });

  afterAll(async () => {
    await ctx.cleanup();
    await ctx.app.close();
  });

  // -------------------------------------------------------------------------
  describe('breach', () => {
    it('the sweep tells the assigned officer and the department administrator - and nobody else', async () => {
      const s = await late('breach-1');
      await sweepMine();

      const clock = await clockOf(ctx.prisma, s.applicationId);
      expect(clock?.breachedAt).not.toBeNull();
      for (const a of [w.soA1, w.adminA]) {
        const got = await of(a, 'SLA_BREACHED', s.applicationId);
        expect(got).toHaveLength(1);
        expect(got[0].payload).toMatchObject({ dueAt: expect.any(String) });
        expect(got[0].message).toContain((clock?.dueAt as Date).toISOString());
      }
      // Another officer of the department, the other department's staff, the
      // approving authority, and every applicant-side or platform role.
      for (const a of everyoneElse()) {
        expect(await of(a, 'SLA_BREACHED', s.applicationId)).toEqual([]);
      }
    });

    it('a repeated sweep records and notifies nothing new (idempotent)', async () => {
      const s = await late('breach-idem');
      await sweepMine();
      const before = await ctx.prisma.notification.count({
        where: { applicationId: s.applicationId, eventType: 'SLA_BREACHED' },
      });
      expect(before).toBe(2); // the assignee and the administrator
      const again = await sweepMine();
      expect(again.breached).toBe(0);
      await sweepMine();
      expect(
        await ctx.prisma.notification.count({
          where: { applicationId: s.applicationId, eventType: 'SLA_BREACHED' },
        }),
      ).toBe(before);
    });

    it('sweeps racing each other notify each officer exactly once', async () => {
      const apps = await Promise.all(
        ['a', 'b', 'c'].map((t) => late(`breach-race-${t}`)),
      );
      await Promise.all([sweepMine(), sweepMine(), sweepMine()]);
      for (const s of apps) {
        for (const a of [w.soA1, w.adminA]) {
          expect(await of(a, 'SLA_BREACHED', s.applicationId)).toHaveLength(1);
        }
      }
    });

    it('a breach found by the completion (no sweep first) is told once, and a later sweep adds nothing', async () => {
      const s = await late('breach-completion');
      await recommend(s).expect(201);
      for (const a of [w.soA1, w.adminA]) {
        expect(await of(a, 'SLA_BREACHED', s.applicationId)).toHaveLength(1);
      }
      await sweepMine();
      expect(await of(w.soA1, 'SLA_BREACHED', s.applicationId)).toHaveLength(1);
    });

    it('a breach found by a query pausing the clock is told once', async () => {
      const s = await late('breach-pause');
      const q = await api(w.soA1)
        .post(`${officerApp(s.applicationId)}/queries`)
        .send({ question: 'Please clarify.' })
        .expect(201);
      for (const a of [w.soA1, w.adminA]) {
        expect(await of(a, 'SLA_BREACHED', s.applicationId)).toHaveLength(1);
      }
      await sweepMine();
      await api(w.owner)
        .post(`${appBase(s)}/queries/${q.body.id}/respond`)
        .send({ responseText: 'Clarified.' })
        .expect(200);
      await sweepMine();
      expect(await of(w.soA1, 'SLA_BREACHED', s.applicationId)).toHaveLength(1);
    });

    it('a sweep racing the completion notifies exactly once, whichever wins', async () => {
      const s = await late('breach-race-complete');
      const [, rec] = await Promise.all([sweepMine(), recommend(s)]);
      expect(rec.status).toBe(201);
      for (const a of [w.soA1, w.adminA]) {
        expect(await of(a, 'SLA_BREACHED', s.applicationId)).toHaveLength(1);
      }
    });

    it('an unassigned application is told to its department administrator only', async () => {
      const s = await late('breach-unassigned', false);
      await sweepMine();
      expect(await of(w.adminA, 'SLA_BREACHED', s.applicationId)).toHaveLength(
        1,
      );
      for (const a of [w.soA1, w.soA2, ...everyoneElse()]) {
        expect(await of(a, 'SLA_BREACHED', s.applicationId)).toEqual([]);
      }
    });

    it('the applicant is never told about the SLA (officer-facing, FRD 25.2)', async () => {
      const s = await late('breach-applicant');
      await sweepMine();
      expect(await of(w.owner, 'SLA_BREACHED', s.applicationId)).toEqual([]);
      expect(await of(w.owner, 'SLA_WARNING', s.applicationId)).toEqual([]);
      expect(
        await ctx.prisma.notification.count({
          where: { userId: w.owner.user.id, audience: 'OFFICER' },
        }),
      ).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  describe('warning (the configured threshold)', () => {
    it('tells the assigned officer and the administrator once a clock reaches the threshold', async () => {
      const s = await nearDeadline('warn-1');
      await warnMine();
      for (const a of [w.soA1, w.adminA]) {
        const got = await of(a, 'SLA_WARNING', s.applicationId);
        expect(got).toHaveLength(1);
        expect(got[0].message).toMatch(/9\d% of its configured timeline/);
        expect(got[0].payload).toMatchObject({
          percentElapsed: expect.any(Number),
        });
      }
      for (const a of everyoneElse()) {
        expect(await of(a, 'SLA_WARNING', s.applicationId)).toEqual([]);
      }
      // The clock itself is untouched: a warning is not a breach.
      const clock = await clockOf(ctx.prisma, s.applicationId);
      expect(clock?.breachedAt).toBeNull();
      expect(clock?.status).toBe('RUNNING');
    });

    it('is idempotent: running it again, or racing it, never repeats the warning', async () => {
      const s = await nearDeadline('warn-idem');
      await Promise.all([warnMine(), warnMine(), warnMine()]);
      await warnMine();
      for (const a of [w.soA1, w.adminA]) {
        expect(await of(a, 'SLA_WARNING', s.applicationId)).toHaveLength(1);
      }
    });

    it('does not warn a clock below the threshold, a paused one, or one already breached', async () => {
      const fresh = await underScrutiny('warn-fresh'); // ~0% elapsed
      const paused = await nearDeadline('warn-paused');
      await api(w.soA1)
        .post(`${officerApp(paused.applicationId)}/queries`)
        .send({ question: 'Please clarify.' })
        .expect(201);
      const breached = await late('warn-breached');
      await sweepMine(); // records the breach
      await warnMine();
      for (const s of [fresh, paused, breached]) {
        expect(await of(w.soA1, 'SLA_WARNING', s.applicationId)).toEqual([]);
        expect(await of(w.adminA, 'SLA_WARNING', s.applicationId)).toEqual([]);
      }
    });

    it('a warning and the breach that follows are two different notifications', async () => {
      const s = await nearDeadline('warn-then-breach');
      await warnMine();
      expect(await of(w.soA1, 'SLA_WARNING', s.applicationId)).toHaveLength(1);
      // Time passes: the deadline is now behind us.
      await backdateClock(ctx.prisma, s.applicationId, {});
      await sweepMine();
      expect(await of(w.soA1, 'SLA_BREACHED', s.applicationId)).toHaveLength(1);
      expect(await of(w.soA1, 'SLA_WARNING', s.applicationId)).toHaveLength(1);
    });

    it('a stage with no timeline configured is never warned about', async () => {
      const { approvalTypeId } = await ctx.createStartableApproval(
        w.owner.user.id,
        'ns-u',
        { departmentId: w.deptA.id },
      );
      await addScrutinyStage(ctx.prisma, approvalTypeId, w.deptA.id, {});
      const s = await ctx.submittedApplication(
        w.owner.accessToken,
        w.enterpriseId,
        approvalTypeId,
        'ns-unconfigured',
      );
      mine.add(s.applicationId);
      await warnMine();
      await sweepMine();
      expect(
        await ctx.prisma.notification.count({
          where: { applicationId: s.applicationId, audience: 'OFFICER' },
        }),
      ).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  describe('officer visibility follows the assignment', () => {
    it('after a reassignment the former assignee no longer reads the notification; the administrator still does', async () => {
      const s = await late('reassign');
      await sweepMine();
      const before = await of(w.soA1, 'SLA_BREACHED', s.applicationId);
      expect(before).toHaveLength(1);
      const unreadBefore = (
        await api(w.soA1).get('/notifications/unread-count').expect(200)
      ).body.unread;

      await api(w.adminA)
        .put(`${officerApp(s.applicationId)}/assignment`)
        .send({
          officerUserId: w.soA2.user.id,
          reason: 'Officer one is on leave.',
        })
        .expect(200);

      // soA1 lost the application (ASSIGNED_TO_ME visibility): so its
      // notification is no longer readable, by list or by id.
      expect(await of(w.soA1, 'SLA_BREACHED', s.applicationId)).toEqual([]);
      await api(w.soA1).get(`/notifications/${before[0].id}`).expect(404);
      await api(w.soA1).post(`/notifications/${before[0].id}/read`).expect(404);
      expect(
        (await api(w.soA1).get('/notifications/unread-count').expect(200)).body
          .unread,
      ).toBeLessThan(unreadBefore);
      // The administrator's is unaffected; the new assignee was not told
      // retroactively (the breach happened before they held it).
      expect(await of(w.adminA, 'SLA_BREACHED', s.applicationId)).toHaveLength(
        1,
      );
      expect(await of(w.soA2, 'SLA_BREACHED', s.applicationId)).toEqual([]);
    });

    it('another department’s administrator can never read it, even by id', async () => {
      const s = await late('cross-dept');
      await sweepMine();
      const mine = await ctx.prisma.notification.findFirstOrThrow({
        where: {
          applicationId: s.applicationId,
          userId: w.adminA.user.id,
          eventType: 'SLA_BREACHED',
        },
      });
      for (const a of [w.adminB, w.soB, w.soA2, w.aaA, w.owner]) {
        await api(a).get(`/notifications/${mine.id}`).expect(404);
        await api(a).post(`/notifications/${mine.id}/read`).expect(404);
      }
      // And the row is still unread for its owner.
      expect(
        (
          await ctx.prisma.notification.findUniqueOrThrow({
            where: { id: mine.id },
          })
        ).readAt,
      ).toBeNull();
    });
  });
});
