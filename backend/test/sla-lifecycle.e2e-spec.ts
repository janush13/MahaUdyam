import { E2eContext, createE2eContext } from './support/e2e-helpers';
import { future } from './support/inspection-helpers';
import {
  Actor,
  OfficerWorld,
  as,
  buildOfficerWorld,
} from './support/officer-world';
import { addScrutinyStage, clockOf, expectedDue } from './support/sla-helpers';
import { localDateOf } from '../src/modules/sla/working-days';

jest.setTimeout(600_000);

/**
 * Step 12 — the SLA clock's lifecycle over real HTTP -> Nest -> Prisma ->
 * PostgreSQL: it starts at submission from the stage's configuration
 * (snapshotted), pauses while a query awaits the applicant (only where the stage
 * is configured to), resumes on the response with the deadline moved forward by
 * exactly the paused time, and completes when scrutiny finishes. Configuration
 * changes never re-time an existing application; every step is audited; the
 * database itself refuses illegal clock changes.
 *
 * Stages (department A):
 *   approvalP  3 working days, pauses on a query
 *   approvalN  3 working days, keeps running during a query
 *   approvalU  no duration configured ("Timeline not yet configured")
 *   approvalA  (the world's) no SLA stage at all
 */
describe('SLA lifecycle e2e (Step 12)', () => {
  let ctx: E2eContext;
  let w: OfficerWorld;
  let approvalP: string;
  let approvalN: string;
  let approvalU: string;
  let approvalH: string;
  let stageP: string;
  let stageH: string;

  const api = (a: { accessToken: string }) => as(ctx, a.accessToken);
  const officerApp = (id: string) => `/officer/applications/${id}`;
  const errorCode = (res: { body: { error?: { code?: string } } }) =>
    res.body.error?.code;
  const appBase = (s: Sub) =>
    `/enterprises/${w.enterpriseId}/projects/${s.projectId}/applications/${s.applicationId}`;

  interface Sub {
    projectId: string;
    applicationId: string;
  }

  const newApproval = async (
    tag: string,
    config: { slaDays?: number | null; pauseOnQuery?: boolean } | null,
  ) => {
    const { approvalTypeId } = await ctx.createStartableApproval(
      w.owner.user.id,
      `sl-${tag}`,
      { departmentId: w.deptA.id },
    );
    const stage =
      config === null
        ? null
        : await addScrutinyStage(
            ctx.prisma,
            approvalTypeId,
            w.deptA.id,
            config,
          );
    return { approvalTypeId, stageId: stage?.id ?? null };
  };

  const submit = (approval: string, tag: string) =>
    ctx.submittedApplication(
      w.owner.accessToken,
      w.enterpriseId,
      approval,
      `sl-${tag}`,
    );

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

  const raise = (s: Sub, question = 'Please clarify the layout.') =>
    api(w.soA1)
      .post(`${officerApp(s.applicationId)}/queries`)
      .send({ question });
  const respond = (s: Sub, queryId: string) =>
    api(w.owner)
      .post(`${appBase(s)}/queries/${queryId}/respond`)
      .send({ responseText: 'Here is the clarification.' });
  const recommend = (s: Sub) =>
    api(w.soA1)
      .post(`${officerApp(s.applicationId)}/recommendation`)
      .send({ outcome: 'APPROVE', reason: 'In order.' });
  const officerSla = async (s: Sub, actor: Actor = w.soA1) =>
    (
      await api(actor)
        .get(`${officerApp(s.applicationId)}/sla`)
        .expect(200)
    ).body;
  const events = (applicationId: string, action: string) =>
    ctx.prisma.auditLog.findMany({
      where: { entityId: applicationId, action },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  const stateOf = async (applicationId: string) =>
    (
      await ctx.prisma.approvalApplication.findUniqueOrThrow({
        where: { id: applicationId },
      })
    ).internalState;

  /** A fixture query that is already closed (only one unclosed query may
   * exist per application), so a pause can be attempted against it directly. */
  const closedQuery = (applicationId: string, roundNumber: number) =>
    ctx.prisma.applicationQuery.create({
      data: {
        applicationId,
        departmentId: w.deptA.id,
        roundNumber,
        raisedByUserId: w.soA1.user.id,
        question: 'Fixture query',
        status: 'CLOSED',
        responseText: 'Fixture answer',
        respondedByUserId: w.owner.user.id,
        respondedAt: new Date(),
        closedByUserId: w.soA1.user.id,
        closedAt: new Date(),
      },
    });

  beforeAll(async () => {
    ctx = await createE2eContext();
    w = await buildOfficerWorld(ctx, 'sl');
    const p = await newApproval('p', { slaDays: 3, pauseOnQuery: true });
    approvalP = p.approvalTypeId;
    stageP = p.stageId as string;
    approvalN = (await newApproval('n', { slaDays: 3, pauseOnQuery: false }))
      .approvalTypeId;
    approvalU = (await newApproval('u', {})).approvalTypeId;
    const h = await newApproval('h', { slaDays: 3, pauseOnQuery: true });
    approvalH = h.approvalTypeId;
    stageH = h.stageId as string;
  });

  afterAll(async () => {
    await ctx.cleanup();
    await ctx.app.close();
  });

  // -------------------------------------------------------------------------
  describe('creation: the clock starts at submission', () => {
    it('a configured stage starts a RUNNING clock, due = submission + sla_days working days, with its configuration snapshotted', async () => {
      const s = await submit(approvalP, 'start');
      const app = await ctx.prisma.approvalApplication.findUniqueOrThrow({
        where: { id: s.applicationId },
      });
      const clock = await clockOf(ctx.prisma, s.applicationId);
      expect(clock).not.toBeNull();
      expect(clock).toMatchObject({
        status: 'RUNNING',
        slaDays: 3,
        pauseOnQuery: true,
        pausedAt: null,
        completedAt: null,
        breachedAt: null,
      });
      // Started at the moment of submission, in the same transaction.
      expect(clock?.startedAt.getTime()).toBe(app.submittedAt?.getTime());
      const due = expectedDue(clock?.startedAt as Date, 3);
      expect(clock?.originalDueAt?.getTime()).toBe(due.getTime());
      expect(clock?.dueAt?.getTime()).toBe(due.getTime());
      // The stage it hangs on is ACTIVE from the same instant.
      expect(clock?.applicationStage).toMatchObject({
        status: 'ACTIVE',
        workflowStageId: stageP,
      });
      expect(clock?.applicationStage.startedAt?.getTime()).toBe(
        clock?.startedAt.getTime(),
      );
      // Its own working-days rule: never earlier than the next working day.
      expect(due.getTime()).toBeGreaterThan(
        (clock?.startedAt.getTime() as number) + 2 * 86_400_000,
      );
    });

    it('audits SLA_STARTED against the application with the actor, department and project', async () => {
      const s = await submit(approvalP, 'audit-start');
      const [event] = await events(s.applicationId, 'SLA_STARTED');
      const clock = await clockOf(ctx.prisma, s.applicationId);
      expect(event.userId).toBe(w.owner.user.id);
      expect(event.roleAtTime).toBe('APPLICANT');
      expect(event.entityType).toBe('ApprovalApplication');
      expect(event.afterState).toMatchObject({
        slaInstanceId: clock?.id,
        applicationId: s.applicationId,
        projectId: s.projectId,
        departmentId: w.deptA.id,
        enterpriseId: w.enterpriseId,
        configured: true,
        slaDays: 3,
        pauseOnQuery: true,
      });
      // ... and it is part of the application's history.
      const history = await api(w.adminA)
        .get(`${officerApp(s.applicationId)}/history`)
        .expect(200);
      expect(history.body.map((h: { action: string }) => h.action)).toContain(
        'SLA_STARTED',
      );
    });

    it('a stage with no configured duration starts a NOT_CONFIGURED clock: no date is guessed', async () => {
      const s = await submit(approvalU, 'unconfigured');
      const clock = await clockOf(ctx.prisma, s.applicationId);
      expect(clock).toMatchObject({
        status: 'NOT_CONFIGURED',
        slaDays: null,
        originalDueAt: null,
        dueAt: null,
      });
      const [event] = await events(s.applicationId, 'SLA_STARTED');
      expect(event.afterState).toMatchObject({
        configured: false,
        dueAt: null,
      });
      const applicant = await api(w.owner)
        .get(`${appBase(s)}/sla`)
        .expect(200);
      expect(applicant.body).toMatchObject({
        status: 'NOT_CONFIGURED',
        timelineConfigured: false,
        expectedBy: null,
        timelineMessage:
          'Timeline not yet configured — TO BE VALIDATED WITH GOVERNMENT DEPARTMENT',
      });
    });

    it('a workflow with no SLA-tracked stage has no clock at all', async () => {
      const s = await submit(w.approvalA, 'no-stage');
      expect(await clockOf(ctx.prisma, s.applicationId)).toBeNull();
      expect(
        await ctx.prisma.applicationStage.count({
          where: { applicationId: s.applicationId },
        }),
      ).toBe(0);
      expect(await events(s.applicationId, 'SLA_STARTED')).toHaveLength(0);
      const applicant = await api(w.owner)
        .get(`${appBase(s)}/sla`)
        .expect(200);
      expect(applicant.body).toMatchObject({
        status: 'NOT_TRACKED',
        currentStage: null,
        timelineConfigured: false,
      });
      expect(applicant.body.elapsedSinceSubmissionMs).toEqual(
        expect.any(Number),
      );
    });

    it('a draft has no clock; submitting twice (racing) creates exactly one', async () => {
      const draft = await ctx.createProjectVia(
        w.owner.accessToken,
        w.enterpriseId,
        'sl-draft',
      );
      const snapshotId = await ctx.discover(
        w.owner.accessToken,
        w.enterpriseId,
        draft.id,
      );
      const created = await api(w.owner)
        .post(
          `/enterprises/${w.enterpriseId}/projects/${draft.id}/applications`,
        )
        .send({ approvalTypeId: approvalP, discoverySnapshotId: snapshotId })
        .expect(201);
      const s = {
        projectId: draft.id,
        applicationId: created.body.id as string,
      };
      expect(await clockOf(ctx.prisma, s.applicationId)).toBeNull();
      // (It cannot be submitted as-is if a mandatory document is missing; the
      // fixture has none, so it can.)
      const results = await Promise.all([
        api(w.owner)
          .post(`${appBase(s)}/submit`)
          .send({ declarationAccepted: true }),
        api(w.owner)
          .post(`${appBase(s)}/submit`)
          .send({ declarationAccepted: true }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(
        await ctx.prisma.slaInstance.count({
          where: { applicationId: s.applicationId },
        }),
      ).toBe(1);
      expect(await events(s.applicationId, 'SLA_STARTED')).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  describe('due-date calculation: configured timelines and the working-day calendar', () => {
    it('a department holiday moves the deadline of applications submitted afterwards, not of earlier ones', async () => {
      const before = await submit(approvalH, 'hol-before');
      const beforeClock = await clockOf(ctx.prisma, before.applicationId);
      // The day the un-holidayed deadline would fall on becomes a holiday.
      const naive = expectedDue(beforeClock?.startedAt as Date, 3);
      const holiday = localDateOf(naive, 330);
      const added = await api(w.adminA)
        .post('/admin/sla/holidays')
        .send({
          date: holiday,
          description: 'Test holiday (fixture)',
          departmentId: w.deptA.id,
        })
        .expect(201);

      const after = await submit(approvalH, 'hol-after');
      const afterClock = await clockOf(ctx.prisma, after.applicationId);
      const shifted = expectedDue(afterClock?.startedAt as Date, 3, [holiday]);
      expect(afterClock?.dueAt?.getTime()).toBe(shifted.getTime());
      // The holiday was a working day of the window, so the deadline moved on.
      expect(shifted.getTime()).toBeGreaterThan(
        expectedDue(afterClock?.startedAt as Date, 3).getTime(),
      );
      // The earlier application keeps the deadline it was given.
      const stillBefore = await clockOf(ctx.prisma, before.applicationId);
      expect(stillBefore?.dueAt?.getTime()).toBe(naive.getTime());

      // Removing the holiday restores the calendar for later applications only.
      await api(w.adminA)
        .del(`/admin/sla/holidays/${added.body.id}`)
        .expect(204);
      const restored = await submit(approvalH, 'hol-restored');
      const restoredClock = await clockOf(ctx.prisma, restored.applicationId);
      expect(restoredClock?.dueAt?.getTime()).toBe(
        expectedDue(restoredClock?.startedAt as Date, 3).getTime(),
      );
      const shiftedNow = await clockOf(ctx.prisma, after.applicationId);
      expect(shiftedNow?.dueAt?.getTime()).toBe(shifted.getTime());
    });

    it('holiday changes are audited (added, removed) with the actor', async () => {
      const added = await api(w.adminA)
        .post('/admin/sla/holidays')
        .send({
          date: '2041-01-14',
          description: 'Audit fixture',
          departmentId: w.deptA.id,
        })
        .expect(201);
      await api(w.adminA)
        .del(`/admin/sla/holidays/${added.body.id}`)
        .expect(204);
      const rows = await ctx.prisma.auditLog.findMany({
        where: { entityId: added.body.id },
        orderBy: { createdAt: 'asc' },
      });
      expect(rows.map((r) => r.action)).toEqual([
        'SLA_HOLIDAY_ADDED',
        'SLA_HOLIDAY_REMOVED',
      ]);
      expect(rows.every((r) => r.userId === w.adminA.user.id)).toBe(true);
      expect(rows[0].afterState).toMatchObject({
        departmentId: w.deptA.id,
        date: '2041-01-14',
      });
    });
  });

  // -------------------------------------------------------------------------
  describe('historical correctness: configuration changes never re-time an existing application', () => {
    it('the clock keeps the duration, pause rule and deadline it started under; the next application gets the new configuration', async () => {
      const first = await underScrutiny(approvalH, 'hist-1');
      const firstClock = await clockOf(ctx.prisma, first.applicationId);
      expect(firstClock).toMatchObject({ slaDays: 3, pauseOnQuery: true });
      const seenBefore = await api(w.owner)
        .get(`${appBase(first)}/sla`)
        .expect(200);

      const changed = await api(w.adminA)
        .put(`/admin/sla/stages/${stageH}`)
        .send({ slaDays: 10, pauseOnQuery: false })
        .expect(200);
      expect(changed.body).toMatchObject({ slaDays: 10, pauseOnQuery: false });

      // Untouched: the stored clock, and everything read from it.
      const firstAfter = await clockOf(ctx.prisma, first.applicationId);
      expect(firstAfter).toMatchObject({
        slaDays: 3,
        pauseOnQuery: true,
        status: 'RUNNING',
      });
      expect(firstAfter?.originalDueAt?.getTime()).toBe(
        firstClock?.originalDueAt?.getTime(),
      );
      expect(firstAfter?.dueAt?.getTime()).toBe(firstClock?.dueAt?.getTime());
      const seenAfter = await api(w.owner)
        .get(`${appBase(first)}/sla`)
        .expect(200);
      expect(seenAfter.body.expectedBy).toBe(seenBefore.body.expectedBy);
      const officer = await officerSla(first);
      expect(officer).toMatchObject({ slaDays: 3, pauseOnQuery: true });

      // ...and it still PAUSES on a query, as it started (the snapshot rules).
      const q = await raise(first).expect(201);
      expect((await clockOf(ctx.prisma, first.applicationId))?.status).toBe(
        'PAUSED',
      );
      await respond(first, q.body.id).expect(200);

      // The next application uses the new configuration.
      const second = await underScrutiny(approvalH, 'hist-2');
      const secondClock = await clockOf(ctx.prisma, second.applicationId);
      expect(secondClock).toMatchObject({ slaDays: 10, pauseOnQuery: false });
      expect(secondClock?.dueAt?.getTime()).toBe(
        expectedDue(secondClock?.startedAt as Date, 10).getTime(),
      );
      const q2 = await raise(second).expect(201);
      expect((await clockOf(ctx.prisma, second.applicationId))?.status).toBe(
        'RUNNING',
      );
      await respond(second, q2.body.id).expect(200);

      // Clearing the duration returns later applications to "not configured".
      await api(w.adminA)
        .put(`/admin/sla/stages/${stageH}`)
        .send({ slaDays: null })
        .expect(200);
      const third = await submit(approvalH, 'hist-3');
      expect((await clockOf(ctx.prisma, third.applicationId))?.status).toBe(
        'NOT_CONFIGURED',
      );
      expect((await clockOf(ctx.prisma, first.applicationId))?.slaDays).toBe(3);

      // Every configuration change is audited with its before and after.
      const changes = await ctx.prisma.auditLog.findMany({
        where: { entityId: stageH, action: 'SLA_CONFIGURATION_CHANGED' },
        orderBy: { createdAt: 'asc' },
      });
      expect(changes).toHaveLength(2);
      expect(changes[0].beforeState).toEqual({
        slaDays: 3,
        pauseOnQuery: true,
      });
      expect(changes[0].afterState).toMatchObject({
        slaDays: 10,
        pauseOnQuery: false,
        departmentId: w.deptA.id,
        appliesTo: 'APPLICATIONS_SUBMITTED_AFTER_THIS_CHANGE',
      });
      expect(changes[1].beforeState).toEqual({
        slaDays: 10,
        pauseOnQuery: false,
      });
      expect(changes.every((c) => c.userId === w.adminA.user.id)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  describe('pause / resume on a query (TRD 12; Blueprint 23.2)', () => {
    it('raising a query pauses the clock; the applicant answering resumes it with the deadline moved forward by exactly the paused time', async () => {
      const s = await underScrutiny(approvalP, 'pause-1');
      const before = await clockOf(ctx.prisma, s.applicationId);

      const q = await raise(s).expect(201);
      // The application's own state machine is exactly as before.
      expect(await stateOf(s.applicationId)).toBe('QUERY_RAISED');
      const paused = await clockOf(ctx.prisma, s.applicationId);
      expect(paused).toMatchObject({ status: 'PAUSED' });
      expect(paused?.pausedAt).not.toBeNull();
      expect(paused?.dueAt?.getTime()).toBe(before?.dueAt?.getTime());
      expect(paused?.pauses).toHaveLength(1);
      expect(paused?.pauses[0]).toMatchObject({
        reason: 'QUERY_AWAITING_APPLICANT',
        queryId: q.body.id,
        resumedAt: null,
      });
      expect(paused?.pauses[0].pausedAt.getTime()).toBe(
        paused?.pausedAt?.getTime(),
      );

      // The countdown is frozen while paused.
      const a = await officerSla(s);
      await new Promise((r) => setTimeout(r, 40));
      const b = await officerSla(s);
      expect(a.status).toBe('PAUSED');
      expect(b.remainingMs).toBe(a.remainingMs);
      const applicantWhilePaused = await api(w.owner)
        .get(`${appBase(s)}/sla`)
        .expect(200);
      expect(applicantWhilePaused.body).toMatchObject({
        status: 'PAUSED',
        waitingForApplicant: true,
      });

      await respond(s, q.body.id).expect(200);
      expect(await stateOf(s.applicationId)).toBe('APPLICANT_RESPONDED');
      const resumed = await clockOf(ctx.prisma, s.applicationId);
      expect(resumed).toMatchObject({ status: 'RUNNING', pausedAt: null });
      const period = resumed?.pauses[0];
      expect(period?.resumedAt).not.toBeNull();
      const pausedFor =
        (period?.resumedAt as Date).getTime() -
        (period?.pausedAt as Date).getTime();
      expect(pausedFor).toBeGreaterThanOrEqual(40);
      // Exactly the paused time, added to the deadline.
      expect(resumed?.dueAt?.getTime()).toBe(
        (before?.dueAt?.getTime() as number) + pausedFor,
      );
      // The deadline as first calculated is never rewritten.
      expect(resumed?.originalDueAt?.getTime()).toBe(
        before?.originalDueAt?.getTime(),
      );

      // Closing the query does not touch the clock.
      await api(w.soA1)
        .post(`${officerApp(s.applicationId)}/queries/${q.body.id}/close`)
        .expect(200);
      expect(await stateOf(s.applicationId)).toBe('UNDER_SCRUTINY');
      const closed = await clockOf(ctx.prisma, s.applicationId);
      expect(closed?.status).toBe('RUNNING');
      expect(closed?.dueAt?.getTime()).toBe(resumed?.dueAt?.getTime());
    });

    it('every pause period is kept: a second query round adds a second row and the totals add up', async () => {
      const s = await underScrutiny(approvalP, 'pause-2');
      const original = (await clockOf(ctx.prisma, s.applicationId))
        ?.originalDueAt;
      for (const round of [1, 2]) {
        const q = await raise(s, `Round ${round} question`).expect(201);
        await new Promise((r) => setTimeout(r, 20));
        await respond(s, q.body.id).expect(200);
        await api(w.soA1)
          .post(`${officerApp(s.applicationId)}/queries/${q.body.id}/close`)
          .expect(200);
      }
      const clock = await clockOf(ctx.prisma, s.applicationId);
      expect(clock?.pauses).toHaveLength(2);
      expect(clock?.pauses.every((p) => p.resumedAt !== null)).toBe(true);
      const total = clock?.pauses.reduce(
        (sum, p) =>
          sum + ((p.resumedAt as Date).getTime() - p.pausedAt.getTime()),
        0,
      ) as number;
      expect(clock?.dueAt?.getTime()).toBe(
        (original?.getTime() as number) + total,
      );
      expect(clock?.originalDueAt?.getTime()).toBe(original?.getTime());
      const view = await officerSla(s);
      expect(view.totalPausedMs).toBe(total);
      expect(view.pauses).toHaveLength(2);
      // Audited, in order.
      expect((await events(s.applicationId, 'SLA_PAUSED')).length).toBe(2);
      const resumes = await events(s.applicationId, 'SLA_RESUMED');
      expect(resumes).toHaveLength(2);
      expect(resumes[0].beforeState).toEqual({
        dueAt: expect.any(String),
      });
      expect(resumes[0].afterState).toMatchObject({
        pausedMs: expect.any(Number),
        queryId: clock?.pauses[0].queryId,
      });
    });

    it('audits the pause and the resume against the application, attributed to the officer and to the applicant', async () => {
      const s = await underScrutiny(approvalP, 'pause-audit');
      const q = await raise(s).expect(201);
      await respond(s, q.body.id).expect(200);
      const [paused] = await events(s.applicationId, 'SLA_PAUSED');
      const [resumed] = await events(s.applicationId, 'SLA_RESUMED');
      expect(paused.userId).toBe(w.soA1.user.id);
      expect(paused.roleAtTime).toBe('SCRUTINY_OFFICER');
      expect(paused.afterState).toMatchObject({
        applicationId: s.applicationId,
        departmentId: w.deptA.id,
        queryId: q.body.id,
        reason: 'QUERY_AWAITING_APPLICANT',
      });
      expect(resumed.userId).toBe(w.owner.user.id);
      expect(resumed.roleAtTime).toBe('APPLICANT');
      expect(resumed.afterState).toMatchObject({
        applicationId: s.applicationId,
        queryId: q.body.id,
        enterpriseId: w.enterpriseId,
      });
    });

    it('a stage that does not pause keeps running through a query: no pause row, no pause event, deadline untouched', async () => {
      const s = await underScrutiny(approvalN, 'nopause');
      const before = await clockOf(ctx.prisma, s.applicationId);
      const q = await raise(s).expect(201);
      const during = await clockOf(ctx.prisma, s.applicationId);
      expect(during?.status).toBe('RUNNING');
      expect(during?.pauses).toHaveLength(0);
      await respond(s, q.body.id).expect(200);
      const after = await clockOf(ctx.prisma, s.applicationId);
      expect(after?.status).toBe('RUNNING');
      expect(after?.dueAt?.getTime()).toBe(before?.dueAt?.getTime());
      expect(await events(s.applicationId, 'SLA_PAUSED')).toHaveLength(0);
      expect(await events(s.applicationId, 'SLA_RESUMED')).toHaveLength(0);
    });

    it('an unconfigured clock has nothing to pause', async () => {
      const s = await underScrutiny(approvalU, 'unconf-query');
      const q = await raise(s).expect(201);
      const clock = await clockOf(ctx.prisma, s.applicationId);
      expect(clock?.status).toBe('NOT_CONFIGURED');
      expect(clock?.pauses).toHaveLength(0);
      await respond(s, q.body.id).expect(200);
      expect(await events(s.applicationId, 'SLA_PAUSED')).toHaveLength(0);
    });

    it('a query that is refused (a second one while one is out) does not pause twice', async () => {
      const s = await underScrutiny(approvalP, 'double-query');
      await raise(s).expect(201);
      const again = await raise(s);
      expect(again.status).toBe(409);
      expect((await clockOf(ctx.prisma, s.applicationId))?.pauses).toHaveLength(
        1,
      );
    });
  });

  // -------------------------------------------------------------------------
  describe('completion: scrutiny finishing ends the stage clock', () => {
    it('the recommendation completes the clock and its stage, within the timeline', async () => {
      const s = await underScrutiny(approvalP, 'complete');
      await recommend(s).expect(201);
      const clock = await clockOf(ctx.prisma, s.applicationId);
      expect(clock).toMatchObject({ status: 'COMPLETED', breachedAt: null });
      expect(clock?.completedAt).not.toBeNull();
      expect(clock?.applicationStage).toMatchObject({ status: 'COMPLETED' });
      expect(clock?.applicationStage.completedAt?.getTime()).toBe(
        clock?.completedAt?.getTime(),
      );
      const [event] = await events(s.applicationId, 'SLA_COMPLETED');
      expect(event.userId).toBe(w.soA1.user.id);
      expect(event.afterState).toMatchObject({
        withinTimeline: true,
        configured: true,
      });
      const view = await officerSla(s);
      expect(view).toMatchObject({
        status: 'COMPLETED',
        remainingMs: null,
        breached: false,
      });
      const applicant = await api(w.owner)
        .get(`${appBase(s)}/sla`)
        .expect(200);
      expect(applicant.body.status).toBe('COMPLETED');
    });

    it('a clock with no timeline completes without a verdict on it', async () => {
      const s = await underScrutiny(approvalU, 'complete-unconf');
      await recommend(s).expect(201);
      expect((await clockOf(ctx.prisma, s.applicationId))?.status).toBe(
        'COMPLETED',
      );
      const [event] = await events(s.applicationId, 'SLA_COMPLETED');
      expect(event.afterState).toMatchObject({
        configured: false,
        withinTimeline: null,
      });
    });

    it('a refused recommendation leaves the clock running', async () => {
      const s = await underScrutiny(approvalP, 'refused-rec');
      await api(w.soA1)
        .post(`${officerApp(s.applicationId)}/inspections`)
        .send({
          inspectorUserId: w.inspectorA.user.id,
          siteAddress: 'Plot 12',
          scheduledAt: future(2),
        })
        .expect(201);
      const res = await recommend(s);
      expect(res.status).toBe(409);
      expect(errorCode(res)).toBe('INSPECTION_OPEN');
      expect((await clockOf(ctx.prisma, s.applicationId))?.status).toBe(
        'RUNNING',
      );
    });

    it('inspection activity does not touch the SLA clock (no inspection timing is defined)', async () => {
      const s = await underScrutiny(approvalP, 'inspection');
      const before = await clockOf(ctx.prisma, s.applicationId);
      const created = await api(w.soA1)
        .post(`${officerApp(s.applicationId)}/inspections`)
        .send({
          inspectorUserId: w.inspectorA.user.id,
          siteAddress: 'Plot 12',
          scheduledAt: future(2),
        })
        .expect(201);
      await api(w.inspectorA)
        .post(`/inspections/${created.body.id}/confirm`)
        .expect(200);
      await api(w.inspectorA)
        .post(`/inspections/${created.body.id}/report`)
        .send({ overallFinding: 'COMPLIANT', summary: 'Inspected.' })
        .expect(201);
      const after = await clockOf(ctx.prisma, s.applicationId);
      expect(after?.status).toBe('RUNNING');
      expect(after?.dueAt?.getTime()).toBe(before?.dueAt?.getTime());
      expect(after?.updatedAt.getTime()).toBe(before?.updatedAt.getTime());
      await recommend(s).expect(201);
      expect((await clockOf(ctx.prisma, s.applicationId))?.status).toBe(
        'COMPLETED',
      );
    });
  });

  // -------------------------------------------------------------------------
  describe('concurrency (the application row lock)', () => {
    it('a query raised while the officer recommends, raced: the clock agrees with whichever transition won', async () => {
      for (let round = 0; round < 4; round++) {
        const s = await underScrutiny(approvalP, `race-q-${round}`);
        const [q, rec] = await Promise.all([raise(s), recommend(s)]);
        expect([201, 409]).toContain(q.status);
        expect([201, 409]).toContain(rec.status);
        // Exactly one of the two competing transitions happens.
        expect(q.status === 201 || rec.status === 201).toBe(true);
        expect(q.status === 201 && rec.status === 201).toBe(false);
        const clock = await clockOf(ctx.prisma, s.applicationId);
        if (rec.status === 201) {
          expect(await stateOf(s.applicationId)).toBe(
            'RECOMMENDED_FOR_APPROVAL',
          );
          expect(clock?.status).toBe('COMPLETED');
          expect(clock?.pauses).toHaveLength(0);
        } else {
          expect(await stateOf(s.applicationId)).toBe('QUERY_RAISED');
          expect(clock?.status).toBe('PAUSED');
          expect(clock?.pauses).toHaveLength(1);
        }
      }
    });

    it('two simultaneous answers to one query: one resumes the clock, the other changes nothing', async () => {
      const s = await underScrutiny(approvalP, 'race-resume');
      const q = await raise(s).expect(201);
      const results = await Promise.all([
        respond(s, q.body.id),
        respond(s, q.body.id),
        respond(s, q.body.id),
      ]);
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      const clock = await clockOf(ctx.prisma, s.applicationId);
      expect(clock?.status).toBe('RUNNING');
      expect(clock?.pauses).toHaveLength(1);
      expect(await events(s.applicationId, 'SLA_RESUMED')).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  describe('the database itself refuses illegal clock changes', () => {
    let s: Sub;
    let clockId: string;

    beforeAll(async () => {
      s = await underScrutiny(approvalP, 'db-rules');
      clockId = (await clockOf(ctx.prisma, s.applicationId))?.id as string;
    });

    const dbUpdate = (data: Record<string, unknown>, id = clockId) =>
      ctx.prisma.slaInstance.update({ where: { id }, data });

    it('a deadline never moves earlier; what a clock started under never changes', async () => {
      const clock = await clockOf(ctx.prisma, s.applicationId);
      const earlier = new Date((clock?.dueAt as Date).getTime() - 1000);
      await expect(dbUpdate({ dueAt: earlier })).rejects.toThrow(
        /never moves earlier/,
      );
      await expect(dbUpdate({ slaDays: 99 })).rejects.toThrow(/immutable/);
      await expect(dbUpdate({ startedAt: new Date() })).rejects.toThrow(
        /immutable/,
      );
      await expect(dbUpdate({ originalDueAt: earlier })).rejects.toThrow(
        /immutable/,
      );
      await expect(dbUpdate({ pauseOnQuery: false })).rejects.toThrow(
        /immutable/,
      );
      await expect(dbUpdate({ applicationId: s.projectId })).rejects.toThrow(
        /immutable|sla_instances/,
      );
    });

    it('a paused status needs a pause time, and a completed one a completion time', async () => {
      await expect(dbUpdate({ status: 'PAUSED' })).rejects.toThrow(
        /sla_instances_state_check/,
      );
      await expect(dbUpdate({ status: 'COMPLETED' })).rejects.toThrow(
        /sla_instances_state_check/,
      );
      await expect(dbUpdate({ pausedAt: new Date() })).rejects.toThrow(
        /sla_instances_state_check/,
      );
    });

    it('a pause is history: it can be resumed once and nothing else, and only one is open at a time', async () => {
      const q = await raise(s).expect(201);
      const open = (await clockOf(ctx.prisma, s.applicationId))?.pauses[0];
      // A second open pause on the same (already paused) clock: refused by the
      // trigger, with the partial unique index as a second line of defence.
      const q2 = await closedQuery(s.applicationId, 99);
      await expect(
        ctx.prisma.slaPause.create({
          data: {
            slaInstanceId: clockId,
            reason: 'QUERY_AWAITING_APPLICANT',
            queryId: q2.id,
            pausedAt: new Date(),
          },
        }),
      ).rejects.toThrow(
        /only a running clock|one_open_per_instance|Unique constraint/,
      );
      // Rewriting a pause, or resuming before it began.
      await expect(
        ctx.prisma.slaPause.update({
          where: { id: open?.id },
          data: { pausedAt: new Date(0) },
        }),
      ).rejects.toThrow(/only be resumed|sla_pauses_period_check|history/);
      await expect(
        ctx.prisma.slaPause.update({
          where: { id: open?.id },
          data: {
            resumedAt: new Date((open?.pausedAt as Date).getTime() - 1000),
          },
        }),
      ).rejects.toThrow(/only be resumed|sla_pauses_period_check|history/);
      await respond(s, q.body.id).expect(200);
      // Resumed already: never edited again.
      await expect(
        ctx.prisma.slaPause.update({
          where: { id: open?.id },
          data: { resumedAt: new Date() },
        }),
      ).rejects.toThrow(/only be resumed|history/);
      await ctx.prisma.applicationQuery.delete({ where: { id: q2.id } });
    });

    it('a pause needs a running clock that is configured to pause, and a query of the same application', async () => {
      const other = await underScrutiny(approvalN, 'db-nopause');
      const noPause = (await clockOf(ctx.prisma, other.applicationId))
        ?.id as string;
      const q = await closedQuery(other.applicationId, 98);
      await expect(
        ctx.prisma.slaPause.create({
          data: {
            slaInstanceId: noPause,
            reason: 'QUERY_AWAITING_APPLICANT',
            queryId: q.id,
            pausedAt: new Date(),
          },
        }),
      ).rejects.toThrow(/configured to pause/);
      // A query of a DIFFERENT application cannot pause this clock.
      const foreign = await closedQuery(other.applicationId, 97);
      const fresh = await underScrutiny(approvalP, 'db-foreign');
      const freshClock = (await clockOf(ctx.prisma, fresh.applicationId))
        ?.id as string;
      await expect(
        ctx.prisma.slaPause.create({
          data: {
            slaInstanceId: freshClock,
            reason: 'QUERY_AWAITING_APPLICANT',
            queryId: foreign.id,
            pausedAt: new Date(),
          },
        }),
      ).rejects.toThrow(/does not belong/);
      await ctx.prisma.applicationQuery.deleteMany({
        where: { id: { in: [q.id, foreign.id] } },
      });
    });

    it('a completed clock is permanent, and a recorded breach is never rewritten', async () => {
      const done = await underScrutiny(approvalP, 'db-done');
      await recommend(done).expect(201);
      const id = (await clockOf(ctx.prisma, done.applicationId))?.id as string;
      await expect(
        dbUpdate({ dueAt: new Date(Date.now() + 1e9) }, id),
      ).rejects.toThrow(/permanent/);
      await expect(
        dbUpdate({ status: 'RUNNING', completedAt: null }, id),
      ).rejects.toThrow(/permanent/);

      const late = await underScrutiny(approvalP, 'db-breach');
      const lateId = (await clockOf(ctx.prisma, late.applicationId))
        ?.id as string;
      const breachedAt = new Date();
      await dbUpdate({ breachedAt }, lateId);
      await expect(dbUpdate({ breachedAt: null }, lateId)).rejects.toThrow(
        /never cleared or rewritten/,
      );
      await expect(
        dbUpdate({ breachedAt: new Date(breachedAt.getTime() + 5000) }, lateId),
      ).rejects.toThrow(/never cleared or rewritten/);
    });

    it('a stage duration must be positive; a holiday can be neither blank nor edited', async () => {
      await expect(
        ctx.prisma.workflowStage.update({
          where: { id: stageP },
          data: { slaDays: 0 },
        }),
      ).rejects.toThrow(/sla_days_check/);
      const holiday = await ctx.prisma.slaHoliday.create({
        data: {
          departmentId: w.deptA.id,
          holidayDate: new Date('2041-03-03T00:00:00.000Z'),
          description: 'Fixture',
          createdByUserId: w.adminA.user.id,
        },
      });
      await expect(
        ctx.prisma.slaHoliday.update({
          where: { id: holiday.id },
          data: { description: 'Changed' },
        }),
      ).rejects.toThrow(/./);
      await expect(
        ctx.prisma.slaHoliday.create({
          data: {
            departmentId: w.deptA.id,
            holidayDate: new Date('2041-03-04T00:00:00.000Z'),
            description: '   ',
            createdByUserId: w.adminA.user.id,
          },
        }),
      ).rejects.toThrow(/sla_holidays_description_check/);
      // One entry per date per calendar.
      await expect(
        ctx.prisma.slaHoliday.create({
          data: {
            departmentId: w.deptA.id,
            holidayDate: new Date('2041-03-03T00:00:00.000Z'),
            description: 'Duplicate',
            createdByUserId: w.adminA.user.id,
          },
        }),
      ).rejects.toThrow(/Unique constraint/);
    });
  });
});
