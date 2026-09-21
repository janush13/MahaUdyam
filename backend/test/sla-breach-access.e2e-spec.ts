import request from 'supertest';
import { API, E2eContext, createE2eContext } from './support/e2e-helpers';
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
 * Step 12 — breach detection and who may see / configure the SLA, over real
 * HTTP -> Nest -> Prisma -> PostgreSQL.
 *
 * Breach detection is deterministic (a RUNNING clock whose deadline has passed)
 * and idempotent (one conditional UPDATE claims each clock), whichever of the
 * sweep, a pause or the completion notices it first, and however many run at
 * once. A clock is dated in the past with `backdateClock` (a database INSERT;
 * nothing has to be waited for) and the sweep is driven directly.
 *
 * Only clocks of THIS suite are ever past their deadline, so a sweep here cannot
 * touch another suite's data.
 */
describe('SLA breach detection and access e2e (Step 12)', () => {
  let ctx: E2eContext;
  let w: OfficerWorld;
  let sweep: SlaSweepService;
  let approvalP: string;
  let approvalU: string;
  let approvalBStage: string;
  let stageP: string;
  let stageB: string;

  interface Sub {
    projectId: string;
    applicationId: string;
  }

  const api = (a: { accessToken: string }) => as(ctx, a.accessToken);
  // Only this suite's applications: parallel suites run their own sweeps, and a
  // global sweep here would breach their fixtures (and theirs, ours).
  const mine = new Set<string>();
  const sweepMine = () =>
    sweep.sweep(new Date(), { applicationIds: [...mine] });
  const officerApp = (id: string) => `/officer/applications/${id}`;
  const appBase = (s: Sub) =>
    `/enterprises/${w.enterpriseId}/projects/${s.projectId}/applications/${s.applicationId}`;
  const errorCode = (res: { body: { error?: { code?: string } } }) =>
    res.body.error?.code;

  const submit = async (approval: string, tag: string) => {
    const s = await ctx.submittedApplication(
      w.owner.accessToken,
      w.enterpriseId,
      approval,
      `sb-${tag}`,
    );
    mine.add(s.applicationId);
    return s;
  };
  const underScrutiny = async (approval: string, tag: string): Promise<Sub> => {
    const s = await submit(approval, tag);
    await api(w.adminA)
      .post(`${officerApp(s.applicationId)}/assignment`)
      .send({ officerUserId: w.soA1.user.id })
      .expect(201);
    await api(w.soA1)
      .post(`${officerApp(s.applicationId)}/start-scrutiny`)
      .expect(200);
    return s;
  };
  /** A running, assigned application whose deadline passed a day ago. */
  const lateClock = async (tag: string, approval = approvalP) => {
    const s = await underScrutiny(approval, tag);
    await backdateClock(ctx.prisma, s.applicationId, {
      pauseOnQuery: true,
    });
    return s;
  };
  const officerSla = (s: Sub, actor: Actor = w.soA1) =>
    api(actor).get(`${officerApp(s.applicationId)}/sla`);
  const recommend = (s: Sub) =>
    api(w.soA1)
      .post(`${officerApp(s.applicationId)}/recommendation`)
      .send({ outcome: 'APPROVE', reason: 'In order.' });
  const breaches = (applicationId: string) =>
    ctx.prisma.auditLog.findMany({
      where: { entityId: applicationId, action: 'SLA_BREACHED' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  const detectedBy = (log: { afterState: unknown }) =>
    (log.afterState as { detectedBy?: string }).detectedBy;

  beforeAll(async () => {
    ctx = await createE2eContext();
    w = await buildOfficerWorld(ctx, 'sb');
    sweep = ctx.app.get(SlaSweepService);
    const p = await ctx.createStartableApproval(w.owner.user.id, 'sb-p', {
      departmentId: w.deptA.id,
    });
    approvalP = p.approvalTypeId;
    stageP = (
      await addScrutinyStage(ctx.prisma, approvalP, w.deptA.id, {
        slaDays: 3,
        pauseOnQuery: true,
      })
    ).id;
    approvalU = (
      await ctx.createStartableApproval(w.owner.user.id, 'sb-u', {
        departmentId: w.deptA.id,
      })
    ).approvalTypeId;
    await addScrutinyStage(ctx.prisma, approvalU, w.deptA.id, {});
    approvalBStage = (
      await ctx.createStartableApproval(w.owner.user.id, 'sb-b', {
        departmentId: w.deptB.id,
      })
    ).approvalTypeId;
    stageB = (
      await addScrutinyStage(ctx.prisma, approvalBStage, w.deptB.id, {
        slaDays: 5,
      })
    ).id;
  });

  afterAll(async () => {
    await ctx.cleanup();
    await ctx.app.close();
  });

  // -------------------------------------------------------------------------
  describe('breach detection (the sweep)', () => {
    it('records a passed deadline once, audits it as the system, and shows it to officers only', async () => {
      const s = await lateClock('sweep-1');
      const before = await officerSla(s).expect(200);
      // Read-side derivation: past its deadline it already READS as breached...
      expect(before.body).toMatchObject({ breached: true, breachedAt: null });

      const result = await sweepMine();
      expect(result.breached).toBeGreaterThanOrEqual(1);

      const clock = await clockOf(ctx.prisma, s.applicationId);
      expect(clock?.breachedAt).not.toBeNull();
      expect(clock?.status).toBe('RUNNING');
      const logs = await breaches(s.applicationId);
      expect(logs).toHaveLength(1);
      expect(logs[0].userId).toBeNull();
      expect(logs[0].roleAtTime).toBe('SYSTEM');
      expect(detectedBy(logs[0])).toBe('SWEEP');
      expect(logs[0].afterState).toMatchObject({
        applicationId: s.applicationId,
        departmentId: w.deptA.id,
      });

      // ...and the officer view now carries the recorded breach.
      const after = await officerSla(s).expect(200);
      expect(after.body.breached).toBe(true);
      expect(after.body.breachedAt).toBe(clock?.breachedAt?.toISOString());

      // The applicant is shown no breach flag (FRD 25.1 lists none) and no
      // internals of the department's clock.
      const applicant = await api(w.owner)
        .get(`${appBase(s)}/sla`)
        .expect(200);
      for (const key of ['breached', 'breachedAt', 'warning', 'pauses']) {
        expect(applicant.body).not.toHaveProperty(key);
      }
    });

    it('is idempotent: a second sweep records nothing and audits nothing', async () => {
      const s = await lateClock('sweep-idem');
      await sweepMine();
      const first = await clockOf(ctx.prisma, s.applicationId);
      const again = await sweepMine();
      expect(again.breached).toBe(0);
      const second = await clockOf(ctx.prisma, s.applicationId);
      expect(second?.breachedAt?.getTime()).toBe(first?.breachedAt?.getTime());
      expect(await breaches(s.applicationId)).toHaveLength(1);
    });

    it('is race-safe: sweeps running at once record and audit each breach exactly once', async () => {
      const late = await Promise.all(
        ['a', 'b', 'c'].map((t) => lateClock(`sweep-race-${t}`)),
      );
      const totals = await Promise.all([sweepMine(), sweepMine(), sweepMine()]);
      expect(totals.reduce((n, t) => n + t.breached, 0)).toBe(3);
      for (const s of late) {
        expect(await breaches(s.applicationId)).toHaveLength(1);
        expect(
          (await clockOf(ctx.prisma, s.applicationId))?.breachedAt,
        ).not.toBeNull();
      }
    });

    it('leaves alone a clock that is not yet due, one with no timeline, and one completed on time', async () => {
      const running = await underScrutiny(approvalP, 'sweep-ok');
      const unconfigured = await underScrutiny(approvalU, 'sweep-nc');
      const done = await underScrutiny(approvalP, 'sweep-done');
      await recommend(done).expect(201);

      await sweepMine();
      for (const s of [running, unconfigured, done]) {
        expect(
          (await clockOf(ctx.prisma, s.applicationId))?.breachedAt,
        ).toBeNull();
        expect(await breaches(s.applicationId)).toHaveLength(0);
      }
      expect((await clockOf(ctx.prisma, done.applicationId))?.status).toBe(
        'COMPLETED',
      );
      expect(
        (await clockOf(ctx.prisma, unconfigured.applicationId))?.status,
      ).toBe('NOT_CONFIGURED');
    });
  });

  // -------------------------------------------------------------------------
  describe('breach and the application transitions', () => {
    it('a pause cannot hide a breach: the query that finds the deadline passed records it, once', async () => {
      const s = await lateClock('pause-late');
      const q = await api(w.soA1)
        .post(`${officerApp(s.applicationId)}/queries`)
        .send({ question: 'Please clarify.' })
        .expect(201);
      const clock = await clockOf(ctx.prisma, s.applicationId);
      expect(clock?.status).toBe('PAUSED');
      expect(clock?.breachedAt).not.toBeNull();
      let logs = await breaches(s.applicationId);
      expect(logs).toHaveLength(1);
      expect(detectedBy(logs[0])).toBe('PAUSE');

      // A sweep skips a paused clock; answering resumes it; nothing repeats.
      expect((await sweepMine()).breached).toBe(0);
      await api(w.owner)
        .post(`${appBase(s)}/queries/${q.body.id}/respond`)
        .send({ responseText: 'Clarified.' })
        .expect(200);
      await sweepMine();
      logs = await breaches(s.applicationId);
      expect(logs).toHaveLength(1);
      expect(
        (await clockOf(ctx.prisma, s.applicationId))?.breachedAt?.getTime(),
      ).toBe(clock?.breachedAt?.getTime());
    });

    it('completing late records the breach at completion, and says it was not within the timeline', async () => {
      const s = await lateClock('complete-late');
      await recommend(s).expect(201);
      const clock = await clockOf(ctx.prisma, s.applicationId);
      expect(clock?.status).toBe('COMPLETED');
      expect(clock?.breachedAt).not.toBeNull();
      const logs = await breaches(s.applicationId);
      expect(logs).toHaveLength(1);
      expect(detectedBy(logs[0])).toBe('COMPLETION');
      const completed = await ctx.prisma.auditLog.findFirstOrThrow({
        where: { entityId: s.applicationId, action: 'SLA_COMPLETED' },
      });
      expect(completed.afterState).toMatchObject({ withinTimeline: false });
      // A completed clock is decided; the sweep never revisits it.
      expect((await sweepMine()).breached).toBe(0);
      expect(await breaches(s.applicationId)).toHaveLength(1);
    });

    it('a sweep racing the completion: exactly one breach record, whichever wins', async () => {
      const s = await lateClock('race-complete');
      const [, rec] = await Promise.all([sweepMine(), recommend(s)]);
      expect(rec.status).toBe(201);
      const clock = await clockOf(ctx.prisma, s.applicationId);
      expect(clock?.status).toBe('COMPLETED');
      expect(clock?.breachedAt).not.toBeNull();
      expect(await breaches(s.applicationId)).toHaveLength(1);
    });

    it('the SLA never decides the application: a breached clock leaves its state and outcome alone', async () => {
      const s = await lateClock('no-decision');
      const stateBefore = (
        await ctx.prisma.approvalApplication.findUniqueOrThrow({
          where: { id: s.applicationId },
        })
      ).internalState;
      await sweepMine();
      const after = await ctx.prisma.approvalApplication.findUniqueOrThrow({
        where: { id: s.applicationId },
      });
      expect(after.internalState).toBe(stateBefore);
    });
  });

  // -------------------------------------------------------------------------
  describe('the applicant sees only their own application, read-only', () => {
    let s: Sub;
    beforeAll(async () => {
      s = await underScrutiny(approvalP, 'ap');
    });

    it('shows the FRD 25.1 fields and no more', async () => {
      const res = await api(w.owner)
        .get(`${appBase(s)}/sla`)
        .expect(200);
      expect(Object.keys(res.body).sort()).toEqual(
        [
          'applicationId',
          'submittedAt',
          'currentStage',
          'status',
          'timelineConfigured',
          'timelineMessage',
          'expectedBy',
          'waitingForApplicant',
          'elapsedSinceSubmissionMs',
        ].sort(),
      );
      expect(res.body).toMatchObject({
        applicationId: s.applicationId,
        status: 'RUNNING',
        timelineConfigured: true,
        timelineMessage: null,
      });
    });

    it('says "Timeline not yet configured" rather than guess a date', async () => {
      const u = await underScrutiny(approvalU, 'ap-u');
      const res = await api(w.owner)
        .get(`${appBase(u)}/sla`)
        .expect(200);
      expect(res.body).toMatchObject({
        timelineConfigured: false,
        expectedBy: null,
      });
      expect(res.body.timelineMessage).toMatch(/not yet configured/i);
    });

    it("refuses another enterprise's applicant, whichever enterprise they name", async () => {
      // Their own enterprise, someone else's project / application: not found.
      const own = await api(w.owner2)
        .get(
          `/enterprises/${w.enterprise2Id}/projects/${s.projectId}/applications/${s.applicationId}/sla`,
        )
        .expect(404);
      expect(errorCode(own)).toBe('NOT_FOUND');
      // The owner's enterprise: no access at all.
      const foreign = await api(w.owner2).get(`${appBase(s)}/sla`);
      expect([403, 404]).toContain(foreign.status);
      expect(foreign.body).not.toHaveProperty('dueAt');
    });

    it('is closed to unauthenticated callers and to every non-applicant role', async () => {
      await request(ctx.http)
        .get(`${API}${appBase(s)}/sla`)
        .expect(401);
      // Denied by role (403) or, having no access to the enterprise, as
      // not-found (404): never the clock.
      for (const actor of [w.soA1, w.adminA, w.aaA, w.sysAdmin, w.leadership]) {
        const res = await api(actor).get(`${appBase(s)}/sla`);
        expect([403, 404]).toContain(res.status);
        expect(res.body).not.toHaveProperty('dueAt');
        expect(res.body).not.toHaveProperty('status');
      }
    });

    it('a draft has no clock and reads as not tracked', async () => {
      const projectId = (
        await ctx.createProjectVia(w.owner.accessToken, w.enterpriseId, 'sb-dr')
      ).id;
      const snapshotId = await ctx.discover(
        w.owner.accessToken,
        w.enterpriseId,
        projectId,
      );
      const created = await api(w.owner)
        .post(
          `/enterprises/${w.enterpriseId}/projects/${projectId}/applications`,
        )
        .send({ approvalTypeId: approvalP, discoverySnapshotId: snapshotId })
        .expect(201);
      const draft = { projectId, applicationId: created.body.id as string };
      const res = await api(w.owner)
        .get(`${appBase(draft)}/sla`)
        .expect(200);
      expect(res.body.status).toBe('NOT_TRACKED');
      expect(res.body.submittedAt).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  describe('officers see the SLA of the applications they can already see', () => {
    let mine: Sub;
    let unassigned: Sub;
    let deptB: Sub;
    beforeAll(async () => {
      mine = await underScrutiny(approvalP, 'off-mine');
      unassigned = await submit(approvalP, 'off-unassigned');
      deptB = await submit(approvalBStage, 'off-b');
    });

    const idsOf = async (actor: Actor, query = '') => {
      const res = await api(actor).get(`/officer/sla${query}`).expect(200);
      return (res.body.items as { applicationId: string }[]).map(
        (i) => i.applicationId,
      );
    };

    it('the assigned Scrutiny Officer and the department Administrator read one clock', async () => {
      for (const actor of [w.soA1, w.adminA]) {
        const res = await officerSla(mine, actor).expect(200);
        expect(res.body).toMatchObject({
          applicationId: mine.applicationId,
          status: 'RUNNING',
          configured: true,
          slaDays: 3,
          breached: false,
        });
      }
    });

    it("an unassigned officer, another department's staff and an out-of-stage Approving Authority get not-found", async () => {
      for (const actor of [w.soA2, w.soB, w.adminB, w.aaA]) {
        const res = await officerSla(mine, actor).expect(404);
        expect(errorCode(res)).toBe('NOT_FOUND');
      }
      await officerSla(deptB, w.adminA).expect(404);
      await officerSla(deptB, w.soA1).expect(404);
    });

    it('the Approving Authority sees a clock once the application awaits their decision', async () => {
      const s = await underScrutiny(approvalP, 'off-aa');
      await recommend(s).expect(201);
      const res = await officerSla(s, w.aaA).expect(200);
      expect(res.body.status).toBe('COMPLETED');
    });

    it('roles outside the officer chain are refused', async () => {
      for (const actor of [w.owner, w.inspectorA, w.sysAdmin, w.leadership]) {
        const res = await officerSla(mine, actor).expect(403);
        expect(errorCode(res)).toBe('INSUFFICIENT_ROLE');
        await api(actor).get('/officer/sla').expect(403);
      }
      await request(ctx.http).get(`${API}/officer/sla`).expect(401);
    });

    it('the queue is scoped to what the role can see', async () => {
      const so = await idsOf(w.soA1);
      expect(so).toContain(mine.applicationId);
      expect(so).not.toContain(unassigned.applicationId);
      expect(so).not.toContain(deptB.applicationId);

      const admin = await idsOf(w.adminA);
      expect(admin).toEqual(
        expect.arrayContaining([mine.applicationId, unassigned.applicationId]),
      );
      expect(admin).not.toContain(deptB.applicationId);

      const adminB = await idsOf(w.adminB);
      expect(adminB).toContain(deptB.applicationId);
      expect(adminB).not.toContain(mine.applicationId);
      expect(await idsOf(w.soB)).not.toContain(mine.applicationId);
    });

    it('filters by status and by breached, and validates paging', async () => {
      const late = await lateClock('off-late');
      const breached = await idsOf(w.adminA, '?breached=true');
      expect(breached).toContain(late.applicationId);
      expect(breached).not.toContain(mine.applicationId);
      const fine = await idsOf(w.adminA, '?breached=false');
      expect(fine).toContain(mine.applicationId);
      expect(fine).not.toContain(late.applicationId);
      expect(await idsOf(w.adminA, '?status=COMPLETED')).not.toContain(
        mine.applicationId,
      );
      await api(w.adminA).get('/officer/sla?pageSize=0').expect(400);
      await api(w.adminA).get('/officer/sla?pageSize=1000').expect(400);
      await api(w.adminA).get('/officer/sla?status=BOGUS').expect(400);
    });

    it('no route sets, moves or clears a deadline for any actor', async () => {
      const paths = [
        `${officerApp(mine.applicationId)}/sla`,
        `${appBase(mine)}/sla`,
        '/officer/sla',
      ];
      const body = { dueAt: '2099-01-01T00:00:00.000Z', breachedAt: null };
      for (const actor of [w.owner, w.soA1, w.adminA, w.sysAdmin]) {
        for (const path of paths) {
          for (const verb of ['post', 'put', 'patch', 'del'] as const) {
            const res = await api(actor)[verb](path).send(body);
            expect(res.status).toBe(404);
          }
        }
      }
      expect((await clockOf(ctx.prisma, mine.applicationId))?.dueAt).toEqual(
        (await clockOf(ctx.prisma, mine.applicationId))?.originalDueAt,
      );
    });
  });

  // -------------------------------------------------------------------------
  describe('configuration: who may change a stage duration and the calendar', () => {
    const stageUrl = (id: string) => `/admin/sla/stages/${id}`;

    it("a Department Administrator lists only their own department's stages", async () => {
      const a = await api(w.adminA).get('/admin/sla/stages').expect(200);
      const ids = (a.body as { id: string }[]).map((x) => x.id);
      expect(ids).toContain(stageP);
      expect(ids).not.toContain(stageB);
      const b = await api(w.adminB).get('/admin/sla/stages').expect(200);
      const idsB = (b.body as { id: string }[]).map((x) => x.id);
      expect(idsB).toContain(stageB);
      expect(idsB).not.toContain(stageP);
    });

    it('only the administrator of the stage’s department may change it', async () => {
      const notTheirs = await api(w.adminB)
        .put(stageUrl(stageP))
        .send({ slaDays: 9 })
        .expect(404);
      expect(errorCode(notTheirs)).toBe('NOT_FOUND');
      // Business authority: not even a System Administrator (FRD 35.2).
      for (const actor of [w.sysAdmin, w.soA1, w.aaA, w.leadership, w.owner]) {
        const res = await api(actor)
          .put(stageUrl(stageP))
          .send({ slaDays: 9 })
          .expect(403);
        expect(errorCode(res)).toBe('INSUFFICIENT_ROLE');
      }
      await api(w.sysAdmin).get('/admin/sla/stages').expect(403);
      expect(
        (
          await ctx.prisma.workflowStage.findUniqueOrThrow({
            where: { id: stageP },
          })
        ).slaDays,
      ).toBe(3);
    });

    it('validates the duration and refuses anything but the two configuration fields', async () => {
      for (const bad of [0, -1, 1.5, '3', 'abc', 3651]) {
        await api(w.adminA)
          .put(stageUrl(stageP))
          .send({ slaDays: bad })
          .expect(400);
      }
      await api(w.adminA).put(stageUrl(stageP)).send({}).expect(400);
      // A deadline is not configuration and cannot be smuggled in.
      await api(w.adminA)
        .put(stageUrl(stageP))
        .send({ slaDays: 4, dueAt: '2099-01-01T00:00:00.000Z' })
        .expect(400);
      await api(w.adminA)
        .put(stageUrl(stageP))
        .send({ slaDays: 3 })
        .expect(400); // unchanged
      await api(w.adminA)
        .put('/admin/sla/stages/not-a-uuid')
        .send({ slaDays: 4 })
        .expect(400);
    });

    it('a change is applied, audited with before / after, and is read back', async () => {
      const res = await api(w.adminA)
        .put(stageUrl(stageP))
        .send({ slaDays: 4 })
        .expect(200);
      expect(res.body).toMatchObject({ slaDays: 4, pauseOnQuery: true });
      const log = await ctx.prisma.auditLog.findFirstOrThrow({
        where: { entityId: stageP, action: 'SLA_CONFIGURATION_CHANGED' },
      });
      expect(log.userId).toBe(w.adminA.user.id);
      expect(log.beforeState).toEqual({ slaDays: 3, pauseOnQuery: true });
      // Restore, so later tests keep their fixture.
      await api(w.adminA)
        .put(stageUrl(stageP))
        .send({ slaDays: 3 })
        .expect(200);
    });

    it('two administrators changing a stage at once are serialised', async () => {
      const results = await Promise.all(
        [4, 5, 6].map((d) =>
          api(w.adminA).put(stageUrl(stageP)).send({ slaDays: d }),
        ),
      );
      expect(results.every((r) => r.status === 200)).toBe(true);
      const stage = await ctx.prisma.workflowStage.findUniqueOrThrow({
        where: { id: stageP },
      });
      const logs = await ctx.prisma.auditLog.findMany({
        where: { entityId: stageP, action: 'SLA_CONFIGURATION_CHANGED' },
        orderBy: { createdAt: 'asc' },
      });
      // Each audited "before" is the previous "after": no lost update.
      const last = logs[logs.length - 1];
      expect((last.afterState as { slaDays: number }).slaDays).toBe(
        stage.slaDays,
      );
      const seen = logs.slice(-3).map((l) => l.beforeState) as {
        slaDays: number;
      }[];
      const afters = logs
        .slice(-3)
        .map((l) => (l.afterState as { slaDays: number }).slaDays);
      expect(new Set(afters).size).toBe(3);
      expect(seen.slice(1).map((b) => b.slaDays)).toEqual(afters.slice(0, 2));
      await api(w.adminA)
        .put(stageUrl(stageP))
        .send({ slaDays: 3 })
        .expect(200);
    });

    it('holidays: an administrator keeps their own department’s calendar; the state-wide one is the System Administrator’s', async () => {
      const dept = await api(w.adminA)
        .post('/admin/sla/holidays')
        .send({
          date: '2043-01-05',
          description: 'Fixture holiday',
          departmentId: w.deptA.id,
        })
        .expect(201);
      // A department administrator must name a department, and only theirs.
      await api(w.adminA)
        .post('/admin/sla/holidays')
        .send({ date: '2043-01-06', description: 'No department' })
        .expect(400);
      await api(w.adminA)
        .post('/admin/sla/holidays')
        .send({
          date: '2043-01-06',
          description: 'Other department',
          departmentId: w.deptB.id,
        })
        .expect(403);
      const dup = await api(w.adminA)
        .post('/admin/sla/holidays')
        .send({
          date: '2043-01-05',
          description: 'Again',
          departmentId: w.deptA.id,
        })
        .expect(409);
      expect(errorCode(dup)).toBe('HOLIDAY_ALREADY_EXISTS');
      await api(w.adminA)
        .post('/admin/sla/holidays')
        .send({
          date: '2043-02-30',
          description: 'Not a date',
          departmentId: w.deptA.id,
        })
        .expect(400);

      const state = await api(w.sysAdmin)
        .post('/admin/sla/holidays')
        .send({ date: '2043-01-07', description: 'State-wide fixture' })
        .expect(201);
      expect(state.body.departmentId).toBeNull();
      // A System Administrator does not maintain a department's calendar.
      await api(w.sysAdmin)
        .post('/admin/sla/holidays')
        .send({
          date: '2043-01-08',
          description: 'Not theirs',
          departmentId: w.deptA.id,
        })
        .expect(403);

      // Visibility: an administrator sees state-wide + their department's.
      const seenA = (
        (await api(w.adminA).get('/admin/sla/holidays').expect(200)).body as {
          id: string;
        }[]
      ).map((h) => h.id);
      expect(seenA).toEqual(
        expect.arrayContaining([dept.body.id, state.body.id]),
      );
      const seenB = (
        (await api(w.adminB).get('/admin/sla/holidays').expect(200)).body as {
          id: string;
        }[]
      ).map((h) => h.id);
      expect(seenB).toContain(state.body.id);
      expect(seenB).not.toContain(dept.body.id);

      // Removal is scoped the same way; what is not theirs is not found.
      await api(w.adminB)
        .del(`/admin/sla/holidays/${dept.body.id}`)
        .expect(404);
      await api(w.adminA)
        .del(`/admin/sla/holidays/${state.body.id}`)
        .expect(404);
      for (const actor of [w.soA1, w.owner, w.leadership]) {
        await api(actor).get('/admin/sla/holidays').expect(403);
      }
      await api(w.adminA)
        .del(`/admin/sla/holidays/${dept.body.id}`)
        .expect(204);
      await api(w.sysAdmin)
        .del(`/admin/sla/holidays/${state.body.id}`)
        .expect(204);
      await api(w.sysAdmin)
        .del(`/admin/sla/holidays/${state.body.id}`)
        .expect(404);
    });
  });
});
