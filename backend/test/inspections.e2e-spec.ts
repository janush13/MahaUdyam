import st from 'supertest';
import { E2eContext, createE2eContext } from './support/e2e-helpers';
import {
  finishInspection,
  markScrutinyFinished,
} from './support/inspection-helpers';
import {
  Actor,
  OfficerWorld,
  as,
  buildOfficerWorld,
} from './support/officer-world';

jest.setTimeout(600_000);

/**
 * Inspection foundation over real HTTP -> Nest -> Prisma -> PostgreSQL:
 * requesting/assigning/scheduling an inspection, its validation and its
 * database-level integrity, concurrency, and the audit trail. Who may READ
 * inspections is in inspections-access.e2e-spec.ts.
 */
describe('Inspections e2e — create, schedule, reassign', () => {
  let ctx: E2eContext;
  let w: OfficerWorld;
  let inspectorA2: Actor;
  let inspectorB: Actor;

  const api = (a: { accessToken: string }) => as(ctx, a.accessToken);
  const appPath = (id: string) => `/officer/applications/${id}`;
  const inspectionsPath = (id: string, suffix = '') =>
    `${appPath(id)}/inspections${suffix}`;
  const dbInspections = (applicationId: string) =>
    ctx.prisma.inspection.findMany({ where: { applicationId } });
  const dbApp = (id: string) =>
    ctx.prisma.approvalApplication.findUniqueOrThrow({ where: { id } });
  const events = (entityId: string, action?: string) =>
    ctx.prisma.auditLog.findMany({
      where: { entityId, ...(action ? { action } : {}) },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

  const submitted = (tag: string) =>
    ctx.submittedApplication(
      w.owner.accessToken,
      w.enterpriseId,
      w.approvalA,
      tag,
    );
  /** Assigned to soA1 and UNDER_SCRUTINY. */
  const underScrutiny = async (tag: string) => {
    const s = await submitted(tag);
    await api(w.adminA)
      .post(`${appPath(s.applicationId)}/assignment`)
      .send({ officerUserId: w.soA1.user.id })
      .expect(201);
    await api(w.soA1)
      .post(`${appPath(s.applicationId)}/start-scrutiny`)
      .expect(200);
    return s;
  };
  const request = (
    applicationId: string,
    body: Record<string, unknown> = {},
    actor: Actor = w.soA1,
  ) =>
    api(actor)
      .post(inspectionsPath(applicationId))
      .send({
        inspectorUserId: w.inspectorA.user.id,
        siteAddress: 'Plot 12, MIDC Industrial Area',
        ...body,
      });
  let counter = 0;
  const errorCode = (res: { body: { error?: { code?: string } } }) =>
    res.body.error?.code;

  beforeAll(async () => {
    ctx = await createE2eContext();
    w = await buildOfficerWorld(ctx, 'in');
    [inspectorA2, inspectorB] = await Promise.all([
      ctx.officerSession('in-ins2', 'INSPECTOR', w.deptA.id),
      ctx.officerSession('in-insb', 'INSPECTOR', w.deptB.id),
    ]);
  });

  afterAll(async () => {
    await ctx.cleanup();
    await ctx.app.close();
  });

  // -------------------------------------------------------------------------
  describe('requesting an inspection', () => {
    it('creates a PENDING inspection without a schedule: the chain Application -> Inspection -> inspector, no state change', async () => {
      const s = await underScrutiny('c-pending');
      const before = await dbApp(s.applicationId);
      const res = await request(s.applicationId).expect(201);

      expect(res.body).toMatchObject({
        applicationId: s.applicationId,
        applicationReference: s.referenceNumber,
        status: 'PENDING',
        scheduledAt: null,
        siteAddress: 'Plot 12, MIDC Industrial Area',
        inspector: { userId: w.inspectorA.user.id },
        assignedBy: { userId: w.soA1.user.id },
        department: { id: w.deptA.id },
        approvalType: { id: w.approvalA },
      });
      expect(res.body.inspector.name).toEqual(expect.any(String));
      // Enterprise/project/department come through the application, not copies.
      const rows = await dbInspections(s.applicationId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        id: res.body.id,
        applicationId: s.applicationId,
        inspectorId: w.inspectorA.user.id,
        status: 'PENDING',
        scheduledAt: null,
        createdByUserId: w.soA1.user.id,
        assignedByUserId: w.soA1.user.id,
        applicationStageId: null,
        geoConsentGiven: false,
      });
      const back = await ctx.prisma.inspection.findUniqueOrThrow({
        where: { id: res.body.id },
        include: {
          application: { include: { project: true, approvalType: true } },
        },
      });
      expect(back.application.project.enterpriseId).toBe(w.enterpriseId);
      expect(back.application.approvalType.departmentId).toBe(w.deptA.id);
      // The application itself is untouched: no inspection arrow is executable yet.
      const after = await dbApp(s.applicationId);
      expect(after.internalState).toBe('UNDER_SCRUTINY');
      expect(after.applicantStatus).toBe(before.applicantStatus);
      expect(after.updatedAt).toEqual(before.updatedAt);
    });

    it('creates a SCHEDULED inspection when a future date/time is given (offsets honoured)', async () => {
      const s = await underScrutiny('c-scheduled');
      const at = '2099-10-01T10:30:00+05:30';
      const res = await request(s.applicationId, { scheduledAt: at }).expect(
        201,
      );
      expect(res.body.status).toBe('SCHEDULED');
      expect(new Date(res.body.scheduledAt).toISOString()).toBe(
        '2099-10-01T05:00:00.000Z',
      );
      const [row] = await dbInspections(s.applicationId);
      expect(row.status).toBe('SCHEDULED');
      expect(row.scheduledAt?.toISOString()).toBe('2099-10-01T05:00:00.000Z');
    });

    it('exposes no internal column, secret or storage detail', async () => {
      const s = await underScrutiny('c-shape');
      const res = await request(s.applicationId).expect(201);
      expect(Object.keys(res.body).sort()).toEqual(
        [
          'applicationId',
          'applicationReference',
          'approvalType',
          'assignedAt',
          'assignedBy',
          'confirmedAt',
          'createdAt',
          'department',
          'id',
          'inspector',
          'project',
          'scheduledAt',
          'siteAddress',
          'status',
          'updatedAt',
        ].sort(),
      );
      expect(JSON.stringify(res.body)).not.toMatch(
        /geoConsent|applicationStage|createdByUserId|password|token|secret|filePath/i,
      );
    });

    it('accepts an inspector who holds Inspector in this department and a CLEARED conflict declaration', async () => {
      const s = await underScrutiny('c-cleared');
      const cleared = await ctx.registerWithRole(
        'in-cleared',
        'INSPECTOR',
        w.deptA.id,
      );
      await ctx.prisma.inspectorConflict.create({
        data: {
          inspectorId: cleared.id,
          projectId: s.projectId,
          status: 'CLEARED',
        },
      });
      await request(s.applicationId, { inspectorUserId: cleared.id }).expect(
        201,
      );
    });
  });

  // -------------------------------------------------------------------------
  describe('who may request one (and nothing changes when they may not)', () => {
    it('only the Scrutiny Officer the application is assigned to', async () => {
      const s = await underScrutiny('a-matrix');
      const before = await dbApp(s.applicationId);

      // Unauthenticated.
      const anon = await st(ctx.http)
        .post(`/api/v1${inspectionsPath(s.applicationId)}`)
        .send({ inspectorUserId: w.inspectorA.user.id, siteAddress: 'x' });
      expect(anon.status).toBe(401);

      // Same department, not assigned: the application does not exist for them.
      expect((await request(s.applicationId, {}, w.soA2)).status).toBe(404);
      // Another department's officer.
      expect((await request(s.applicationId, {}, w.soB)).status).toBe(404);
      // Roles the route does not allow at all: refused before any lookup.
      for (const actor of [
        w.adminA,
        w.adminB,
        w.aaA,
        w.inspectorA,
        w.sysAdmin,
        w.leadership,
        w.owner,
        w.owner2,
      ]) {
        const res = await request(s.applicationId, {}, actor);
        expect(res.status).toBe(403);
        expect(errorCode(res)).toBe('INSUFFICIENT_ROLE');
      }
      expect(await dbInspections(s.applicationId)).toHaveLength(0);
      expect(await events(s.applicationId, 'INSPECTION_CREATED')).toHaveLength(
        0,
      );
      expect((await dbApp(s.applicationId)).updatedAt).toEqual(
        before.updatedAt,
      );
    });

    it('an Inspector cannot do scrutiny, and a Scrutiny Officer cannot act as an inspector', async () => {
      const s = await underScrutiny('a-noswap');
      const asInspector = api(w.inspectorA);
      for (const res of [
        await asInspector.post(`${appPath(s.applicationId)}/start-scrutiny`),
        await asInspector
          .post(`${appPath(s.applicationId)}/observations`)
          .send({ body: 'x' }),
        await asInspector
          .post(`${appPath(s.applicationId)}/queries`)
          .send({ question: 'x' }),
        await asInspector
          .post(`${appPath(s.applicationId)}/recommendation`)
          .send({ outcome: 'APPROVE', reason: 'x' }),
        await asInspector.get(appPath(s.applicationId)),
      ]) {
        expect(res.status).toBe(403);
      }
      // A Scrutiny Officer is not an Inspector: cannot be assigned as one.
      const res = await request(s.applicationId, {
        inspectorUserId: w.soA2.user.id,
      });
      expect(res.status).toBe(422);
      expect(errorCode(res)).toBe('INVALID_ASSIGNEE');
    });

    it('a client cannot steer to another department or application: ids in the URL and body are resolved server-side', async () => {
      const inA = await underScrutiny('x-a');
      const inB = await ctx.submittedApplication(
        w.owner.accessToken,
        w.enterpriseId,
        w.approvalB,
        'x-b',
      );
      await api(w.adminB)
        .post(`${appPath(inB.applicationId)}/assignment`)
        .send({ officerUserId: w.soB.user.id })
        .expect(201);
      await api(w.soB)
        .post(`${appPath(inB.applicationId)}/start-scrutiny`)
        .expect(200);

      // soA1 against department B's application.
      expect((await request(inB.applicationId)).status).toBe(404);
      // A department id in the body is not accepted at all.
      const res = await request(inA.applicationId, {
        departmentId: w.deptB.id,
      });
      expect(res.status).toBe(400);
      // An enterprise, application or actor cannot be smuggled in either.
      for (const extra of [
        { applicationId: inB.applicationId },
        { enterpriseId: w.enterprise2Id },
        { createdByUserId: w.soB.user.id },
      ]) {
        expect((await request(inA.applicationId, extra)).status).toBe(400);
      }
      // An unknown / malformed application id.
      expect(
        (await request('00000000-0000-4000-8000-000000000000')).status,
      ).toBe(404);
      expect((await request('not-a-uuid')).status).toBe(400);
      expect(await dbInspections(inA.applicationId)).toHaveLength(0);
      expect(await dbInspections(inB.applicationId)).toHaveLength(0);
    });

    it('a draft is not an application an officer can reach', async () => {
      let draftStatus: number | undefined;
      let draftId: string | undefined;
      await ctx.submittedApplication(
        w.owner.accessToken,
        w.enterpriseId,
        w.approvalA,
        'x-draft',
        {
          // Runs while the application is still a DRAFT.
          beforeSubmit: async ({ applicationId }) => {
            draftId = applicationId;
            draftStatus = (await request(applicationId)).status;
          },
        },
      );
      expect(draftStatus).toBe(404);
      expect(await dbInspections(draftId as string)).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  describe('the inspector must be eligible', () => {
    it.each([
      ['an Inspector of another department', () => inspectorB.user.id],
      ['a user who is not an Inspector', () => w.owner.user.id],
      ['an Approving Authority', () => w.aaA.user.id],
      [
        'a user that does not exist',
        () => '00000000-0000-4000-8000-0000000000ff',
      ],
    ])('rejects %s (422 INVALID_ASSIGNEE)', async (_name, pick) => {
      const s = await underScrutiny('e-invalid');
      const res = await request(s.applicationId, { inspectorUserId: pick() });
      expect(res.status).toBe(422);
      expect(errorCode(res)).toBe('INVALID_ASSIGNEE');
      expect(await dbInspections(s.applicationId)).toHaveLength(0);
    });

    it('rejects a deactivated inspector', async () => {
      const s = await underScrutiny('e-dead');
      const dead = await ctx.registerWithRole(
        'in-dead',
        'INSPECTOR',
        w.deptA.id,
      );
      await ctx.prisma.user.update({
        where: { id: dead.id },
        data: { isActive: false },
      });
      const res = await request(s.applicationId, { inspectorUserId: dead.id });
      expect(res.status).toBe(422);
      expect(errorCode(res)).toBe('INVALID_ASSIGNEE');
    });

    it.each(['DECLARED', 'CONFIRMED'] as const)(
      'rejects an inspector with a %s conflict of interest for this project, but not for another',
      async (status) => {
        const s = await underScrutiny(`e-conflict-${status}`);
        const other = await underScrutiny(`e-conflict-other-${status}`);
        const inspector = await ctx.registerWithRole(
          `in-conflict-${status}`,
          'INSPECTOR',
          w.deptA.id,
        );
        await ctx.prisma.inspectorConflict.create({
          data: { inspectorId: inspector.id, projectId: s.projectId, status },
        });
        const res = await request(s.applicationId, {
          inspectorUserId: inspector.id,
        });
        expect(res.status).toBe(422);
        expect(errorCode(res)).toBe('INSPECTOR_CONFLICT_OF_INTEREST');
        expect(await dbInspections(s.applicationId)).toHaveLength(0);
        // The declaration is per project.
        await request(other.applicationId, {
          inspectorUserId: inspector.id,
        }).expect(201);
      },
    );
  });

  // -------------------------------------------------------------------------
  describe('validation', () => {
    it.each([
      ['no body', {}],
      ['a blank site', { siteAddress: '   ' }],
      ['a site over 500 characters', { siteAddress: 'x'.repeat(501) }],
      ['an inspector that is not a UUID', { inspectorUserId: 'me' }],
      [
        'a schedule without an offset',
        { scheduledAt: '2099-10-01T10:30:00' },
        {},
      ],
      ['a date only', { scheduledAt: '2099-10-01' }],
      ['a schedule that is not a date', { scheduledAt: 'tomorrow' }],
      ['a schedule in the past', { scheduledAt: '2020-01-01T00:00:00Z' }],
      ['a client-chosen status', { status: 'COMPLETED' }],
      ['an internal state', { internalState: 'INSPECTION_COMPLETED' }],
      ['geo consent', { geoConsentGiven: true }],
      [
        'a workflow stage',
        { applicationStageId: '00000000-0000-4000-8000-000000000001' },
        {},
      ],
    ])('rejects %s (400) and creates nothing', async (name, body) => {
      const s = await underScrutiny(`v-${(counter += 1)}`);
      const payload =
        name === 'no body'
          ? await api(w.soA1).post(inspectionsPath(s.applicationId)).send({})
          : await request(s.applicationId, body);
      expect(payload.status).toBe(400);
      expect(errorCode(payload)).toBe('VALIDATION_ERROR');
      expect(await dbInspections(s.applicationId)).toHaveLength(0);
      expect(await events(s.applicationId, 'INSPECTION_CREATED')).toHaveLength(
        0,
      );
    });

    it('names the offending field for a past schedule', async () => {
      const s = await underScrutiny('v-field');
      const res = await request(s.applicationId, {
        scheduledAt: '2020-01-01T00:00:00Z',
      });
      expect(JSON.stringify(res.body)).toContain('scheduledAt');
    });

    it('trims the site address', async () => {
      const s = await underScrutiny('v-trim');
      const res = await request(s.applicationId, {
        siteAddress: '   Plot 7   ',
      }).expect(201);
      expect(res.body.siteAddress).toBe('Plot 7');
    });
  });

  // -------------------------------------------------------------------------
  describe('when an inspection can be requested', () => {
    it('only while the application is under scrutiny', async () => {
      // SUBMITTED + assigned, scrutiny not started.
      const notStarted = await submitted('s-submitted');
      await api(w.adminA)
        .post(`${appPath(notStarted.applicationId)}/assignment`)
        .send({ officerUserId: w.soA1.user.id })
        .expect(201);
      const r1 = await request(notStarted.applicationId);
      expect(r1.status).toBe(409);
      expect(errorCode(r1)).toBe('INSPECTION_NOT_MODIFIABLE');

      // A query is out with the applicant.
      const queried = await underScrutiny('s-query');
      await api(w.soA1)
        .post(`${appPath(queried.applicationId)}/queries`)
        .send({ question: 'Please clarify.' })
        .expect(201);
      expect((await request(queried.applicationId)).status).toBe(409);

      // Scrutiny finished: the recommendation is with the Approving Authority.
      const done = await underScrutiny('s-recommended');
      await markScrutinyFinished(ctx.prisma, done.applicationId);
      expect((await request(done.applicationId)).status).toBe(409);

      for (const id of [notStarted, queried, done]) {
        expect(await dbInspections(id.applicationId)).toHaveLength(0);
      }
    });

    it('one open inspection per application; two simultaneous requests: exactly one wins', async () => {
      const s = await underScrutiny('s-race');
      const results = await Promise.all([
        request(s.applicationId, { siteAddress: 'Site one' }),
        request(s.applicationId, { siteAddress: 'Site two' }),
        request(s.applicationId, { siteAddress: 'Site three' }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409]);
      for (const r of results.filter((x) => x.status === 409)) {
        expect(errorCode(r)).toBe('INSPECTION_ALREADY_OPEN');
      }
      expect(await dbInspections(s.applicationId)).toHaveLength(1);
      expect(await events(s.applicationId, 'INSPECTION_CREATED')).toHaveLength(
        1,
      );
    });

    it('a finished inspection does not block a further one (re-inspection); an open one does', async () => {
      const s = await underScrutiny('s-reinspect');
      const first = await request(s.applicationId).expect(201);
      expect((await request(s.applicationId)).status).toBe(409);
      // Finish it the way the database allows (a report, then COMPLETED).
      await finishInspection(ctx.prisma, first.body.id);
      await request(s.applicationId, { siteAddress: 'Second visit' }).expect(
        201,
      );
      expect(await dbInspections(s.applicationId)).toHaveLength(2);
    });

    it('a recommendation racing an inspection request: exactly one order wins and the rest is refused cleanly', async () => {
      const s = await underScrutiny('s-recommend-race');
      const [rec, insp] = await Promise.all([
        api(w.soA1)
          .post(`${appPath(s.applicationId)}/recommendation`)
          .send({ outcome: 'APPROVE', reason: 'ok' }),
        request(s.applicationId),
      ]);
      expect([201, 409]).toContain(insp.status);
      expect([201, 409]).toContain(rec.status);
      const app = await dbApp(s.applicationId);
      // Whatever the order, no state other than the two defined ones.
      expect(['UNDER_SCRUTINY', 'RECOMMENDED_FOR_APPROVAL']).toContain(
        app.internalState,
      );
      expect((await dbInspections(s.applicationId)).length).toBe(
        insp.status === 201 ? 1 : 0,
      );
    });
  });

  // -------------------------------------------------------------------------
  describe('scheduling and reassigning', () => {
    it('setting a date on a PENDING inspection makes it SCHEDULED; moving it reschedules; both are audited', async () => {
      const s = await underScrutiny('u-schedule');
      const created = await request(s.applicationId).expect(201);
      const path = inspectionsPath(s.applicationId, `/${created.body.id}`);

      const scheduled = await api(w.soA1)
        .put(path)
        .send({ scheduledAt: '2099-11-01T09:00:00+05:30' })
        .expect(200);
      expect(scheduled.body.status).toBe('SCHEDULED');
      const moved = await api(w.soA1)
        .put(path)
        .send({ scheduledAt: '2099-11-05T09:00:00+05:30' })
        .expect(200);
      expect(moved.body.status).toBe('SCHEDULED');
      expect(new Date(moved.body.scheduledAt).toISOString()).toBe(
        '2099-11-05T03:30:00.000Z',
      );
      // Not an assignment change: the assignment metadata is untouched.
      expect(moved.body.assignedAt).toBe(created.body.assignedAt);

      const trail = (await events(s.applicationId)).filter((e) =>
        e.action.startsWith('INSPECTION_'),
      );
      expect(trail.map((e) => e.action)).toEqual([
        'INSPECTION_CREATED',
        'INSPECTION_SCHEDULED',
        'INSPECTION_RESCHEDULED',
      ]);
      const rescheduled = trail[2];
      expect(
        (rescheduled.beforeState as { scheduledAt: string }).scheduledAt,
      ).toBe('2099-11-01T03:30:00.000Z');
    });

    it('reassigning needs a reason and an eligible inspector, and records who assigned and when', async () => {
      const s = await underScrutiny('u-reassign');
      const created = await request(s.applicationId).expect(201);
      const path = inspectionsPath(s.applicationId, `/${created.body.id}`);

      // No reason.
      expect(
        (
          await api(w.soA1)
            .put(path)
            .send({ inspectorUserId: inspectorA2.user.id })
        ).status,
      ).toBe(400);
      // Ineligible inspector (another department).
      const bad = await api(w.soA1)
        .put(path)
        .send({ inspectorUserId: inspectorB.user.id, reason: 'workload' });
      expect(bad.status).toBe(422);
      expect(errorCode(bad)).toBe('INVALID_ASSIGNEE');
      expect((await dbInspections(s.applicationId))[0].inspectorId).toBe(
        w.inspectorA.user.id,
      );

      const ok = await api(w.soA1)
        .put(path)
        .send({
          inspectorUserId: inspectorA2.user.id,
          reason: 'Original inspector on leave',
        })
        .expect(200);
      expect(ok.body.inspector.userId).toBe(inspectorA2.user.id);
      expect(new Date(ok.body.assignedAt).getTime()).toBeGreaterThan(
        new Date(created.body.assignedAt).getTime(),
      );
      const row = await ctx.prisma.inspection.findUniqueOrThrow({
        where: { id: created.body.id },
      });
      expect(row.inspectorId).toBe(inspectorA2.user.id);
      expect(row.assignedByUserId).toBe(w.soA1.user.id);
      expect(row.createdByUserId).toBe(w.soA1.user.id);

      const [event] = await events(s.applicationId, 'INSPECTION_REASSIGNED');
      expect(event).toMatchObject({
        userId: w.soA1.user.id,
        roleAtTime: 'SCRUTINY_OFFICER',
      });
      expect(event.beforeState).toMatchObject({
        inspectorUserId: w.inspectorA.user.id,
      });
      expect(event.afterState).toMatchObject({
        inspectorUserId: inspectorA2.user.id,
        reason: 'Original inspector on leave',
      });
    });

    it('updates the site, and a request that changes nothing is refused', async () => {
      const s = await underScrutiny('u-site');
      const created = await request(s.applicationId).expect(201);
      const path = inspectionsPath(s.applicationId, `/${created.body.id}`);
      const res = await api(w.soA1)
        .put(path)
        .send({ siteAddress: 'Plot 99' })
        .expect(200);
      expect(res.body.siteAddress).toBe('Plot 99');
      expect(
        await events(s.applicationId, 'INSPECTION_SITE_UPDATED'),
      ).toHaveLength(1);

      for (const body of [
        {},
        { siteAddress: 'Plot 99' },
        { inspectorUserId: w.inspectorA.user.id, reason: 'same' },
        { scheduledAt: null },
      ]) {
        const noop = await api(w.soA1).put(path).send(body);
        expect(noop.status).toBe(400);
      }
    });

    it('a schedule can be moved but never removed, and never into the past', async () => {
      const s = await underScrutiny('u-nounschedule');
      const created = await request(s.applicationId, {
        scheduledAt: '2099-12-01T09:00:00Z',
      }).expect(201);
      const path = inspectionsPath(s.applicationId, `/${created.body.id}`);
      expect(
        (
          await api(w.soA1)
            .put(path)
            .send({ scheduledAt: '2020-01-01T00:00:00Z' })
        ).status,
      ).toBe(400);
      expect(
        (await api(w.soA1).put(path).send({ scheduledAt: null })).status,
      ).toBe(400);
      expect((await dbInspections(s.applicationId))[0].status).toBe(
        'SCHEDULED',
      );
    });

    it('cannot change status or any field outside the three it names', async () => {
      const s = await underScrutiny('u-nostatus');
      const created = await request(s.applicationId).expect(201);
      const path = inspectionsPath(s.applicationId, `/${created.body.id}`);
      for (const body of [
        { status: 'COMPLETED', siteAddress: 'x' },
        { applicationId: s.applicationId, siteAddress: 'x' },
        { createdByUserId: w.soA2.user.id, siteAddress: 'x' },
      ]) {
        expect((await api(w.soA1).put(path).send(body)).status).toBe(400);
      }
      expect((await dbInspections(s.applicationId))[0].status).toBe('PENDING');
    });

    it('only the assigned Scrutiny Officer; not another officer, another department, an administrator or the inspector', async () => {
      const s = await underScrutiny('u-authz');
      const created = await request(s.applicationId).expect(201);
      const path = inspectionsPath(s.applicationId, `/${created.body.id}`);
      const send = (a: Actor) =>
        api(a).put(path).send({ siteAddress: 'Hijacked' });

      expect((await send(w.soA2)).status).toBe(404);
      expect((await send(w.soB)).status).toBe(404);
      for (const actor of [
        w.adminA,
        w.adminB,
        w.aaA,
        w.inspectorA,
        w.sysAdmin,
        w.owner,
      ]) {
        const res = await send(actor);
        expect(res.status).toBe(403);
        expect(errorCode(res)).toBe('INSUFFICIENT_ROLE');
      }
      expect((await dbInspections(s.applicationId))[0].siteAddress).not.toBe(
        'Hijacked',
      );
    });

    it('another application’s inspection is not found through this one', async () => {
      const s1 = await underScrutiny('u-cross-1');
      const s2 = await underScrutiny('u-cross-2');
      const other = await request(s2.applicationId).expect(201);
      const res = await api(w.soA1)
        .put(inspectionsPath(s1.applicationId, `/${other.body.id}`))
        .send({ siteAddress: 'Cross' });
      expect(res.status).toBe(404);
      expect((await dbInspections(s2.applicationId))[0].siteAddress).not.toBe(
        'Cross',
      );
      expect(
        (
          await api(w.soA1)
            .put(
              inspectionsPath(
                s1.applicationId,
                '/00000000-0000-4000-8000-0000000000aa',
              ),
            )
            .send({ siteAddress: 'x' })
        ).status,
      ).toBe(404);
      expect(
        (
          await api(w.soA1)
            .put(inspectionsPath(s1.applicationId, '/nope'))
            .send({ siteAddress: 'x' })
        ).status,
      ).toBe(400);
    });

    it('is refused for a finished or cancelled inspection and after scrutiny has finished', async () => {
      const s = await underScrutiny('u-locked');
      const created = await request(s.applicationId).expect(201);
      const path = inspectionsPath(s.applicationId, `/${created.body.id}`);

      // Since Step 11C the recommendation is refused while an inspection is open;
      // set the finished-scrutiny state directly.
      await markScrutinyFinished(ctx.prisma, s.applicationId);
      const afterScrutiny = await api(w.soA1)
        .put(path)
        .send({ siteAddress: 'Late' });
      // Still visible to the assigned officer, but scrutiny has finished.
      expect(afterScrutiny.status).toBe(409);
      expect(errorCode(afterScrutiny)).toBe('INSPECTION_NOT_MODIFIABLE');

      const t = await underScrutiny('u-locked-2');
      const c2 = await request(t.applicationId).expect(201);
      await ctx.prisma.inspection.update({
        where: { id: c2.body.id },
        data: { status: 'CANCELLED' },
      });
      const res = await api(w.soA1)
        .put(inspectionsPath(t.applicationId, `/${c2.body.id}`))
        .send({ siteAddress: 'Late' });
      expect(res.status).toBe(409);
      expect(errorCode(res)).toBe('INSPECTION_NOT_MODIFIABLE');
    });

    it('two identical reassignments at once: one wins, the other changes nothing', async () => {
      const s = await underScrutiny('u-race');
      const created = await request(s.applicationId).expect(201);
      const path = inspectionsPath(s.applicationId, `/${created.body.id}`);
      const body = { inspectorUserId: inspectorA2.user.id, reason: 'Race' };
      const results = await Promise.all([
        api(w.soA1).put(path).send(body),
        api(w.soA1).put(path).send(body),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
      expect(
        await events(s.applicationId, 'INSPECTION_REASSIGNED'),
      ).toHaveLength(1);
      expect((await dbInspections(s.applicationId))[0].inspectorId).toBe(
        inspectorA2.user.id,
      );
    });

    it('a reassignment moves the inspector’s access with it', async () => {
      const s = await underScrutiny('u-access');
      const created = await request(s.applicationId).expect(201);
      await api(w.inspectorA)
        .get(`/inspections/${created.body.id}`)
        .expect(200);
      await api(inspectorA2).get(`/inspections/${created.body.id}`).expect(404);
      await api(w.soA1)
        .put(inspectionsPath(s.applicationId, `/${created.body.id}`))
        .send({ inspectorUserId: inspectorA2.user.id, reason: 'Swap' })
        .expect(200);
      await api(w.inspectorA)
        .get(`/inspections/${created.body.id}`)
        .expect(404);
      await api(inspectorA2).get(`/inspections/${created.body.id}`).expect(200);
    });
  });

  // -------------------------------------------------------------------------
  describe('audit', () => {
    it('records creation with actor, role, department, enterprise, project, application and rule version — and no sensitive data', async () => {
      const s = await underScrutiny('au-create');
      const res = await request(s.applicationId, {
        scheduledAt: '2099-10-01T09:00:00Z',
      }).expect(201);
      const [event] = await events(s.applicationId, 'INSPECTION_CREATED');
      expect(event).toMatchObject({
        userId: w.soA1.user.id,
        roleAtTime: 'SCRUTINY_OFFICER',
        entityType: 'ApprovalApplication',
        entityId: s.applicationId,
      });
      expect(event.ipAddress).toEqual(expect.any(String));
      expect(event.afterState).toMatchObject({
        inspectionId: res.body.id,
        inspectorUserId: w.inspectorA.user.id,
        status: 'SCHEDULED',
        applicationId: s.applicationId,
        departmentId: w.deptA.id,
        enterpriseId: w.enterpriseId,
        projectId: s.projectId,
        actingAs: 'SCRUTINY_OFFICER',
      });
      expect(event.ruleVersionUsed).toEqual(expect.any(String));
      expect(JSON.stringify(event)).not.toMatch(/password|token|secret|mfa/i);
    });

    it('refused requests leave no inspection audit trail', async () => {
      const s = await underScrutiny('au-refused');
      await request(s.applicationId, {}, w.soA2);
      await request(s.applicationId, {}, w.adminA);
      await request(s.applicationId, { scheduledAt: '2020-01-01T00:00:00Z' });
      await request(s.applicationId, { inspectorUserId: inspectorB.user.id });
      const trail = (await events(s.applicationId)).filter((e) =>
        e.action.startsWith('INSPECTION_'),
      );
      expect(trail).toEqual([]);
    });

    it('the application history shows the inspection story in plain language, to the roles that can see the application', async () => {
      const s = await underScrutiny('au-history');
      const created = await request(s.applicationId).expect(201);
      await api(w.soA1)
        .put(inspectionsPath(s.applicationId, `/${created.body.id}`))
        .send({ scheduledAt: '2099-10-01T09:00:00Z' })
        .expect(200);
      await api(w.soA1)
        .put(inspectionsPath(s.applicationId, `/${created.body.id}`))
        .send({ inspectorUserId: inspectorA2.user.id, reason: 'Swap' })
        .expect(200);
      const history = await api(w.adminA)
        .get(`${appPath(s.applicationId)}/history`)
        .expect(200);
      const summaries = history.body
        .filter((h: { action: string }) => h.action.startsWith('INSPECTION_'))
        .map((h: { summary: string }) => h.summary);
      expect(summaries).toEqual([
        'Inspection requested (not yet scheduled)',
        'Inspection scheduled',
        'Inspection assigned to a different inspector',
      ]);
      expect(JSON.stringify(history.body)).not.toMatch(/Swap/);
    });
  });

  // -------------------------------------------------------------------------
  describe('enforced by PostgreSQL itself, not only by service code', () => {
    const base = async (tag: string) => {
      const s = await underScrutiny(tag);
      const created = await request(s.applicationId).expect(201);
      return { s, id: created.body.id as string };
    };

    it('the status must agree with the schedule', async () => {
      const { s, id } = await base('db-status');
      await expect(
        ctx.prisma.inspection.update({
          where: { id },
          data: { status: 'SCHEDULED' },
        }),
      ).rejects.toThrow();
      await expect(
        ctx.prisma.inspection.create({
          data: {
            applicationId: s.applicationId,
            inspectorId: w.inspectorA.user.id,
            siteAddress: 'x',
            status: 'PENDING',
            scheduledAt: new Date(Date.now() + 1e9),
            createdByUserId: w.soA1.user.id,
            assignedByUserId: w.soA1.user.id,
          },
        }),
      ).rejects.toThrow();
    });

    it('a blank site is refused', async () => {
      const { id } = await base('db-site');
      await expect(
        ctx.prisma.inspection.update({
          where: { id },
          data: { siteAddress: '   ' },
        }),
      ).rejects.toThrow();
    });

    it('at most one open inspection per application, whoever tries', async () => {
      const { s } = await base('db-one-open');
      await expect(
        ctx.prisma.inspection.create({
          data: {
            applicationId: s.applicationId,
            inspectorId: w.inspectorA.user.id,
            siteAddress: 'x',
            createdByUserId: w.soA1.user.id,
            assignedByUserId: w.soA1.user.id,
          },
        }),
      ).rejects.toThrow();
    });

    it('the application, creator and creation time can never change', async () => {
      const { s, id } = await base('db-immutable');
      const other = await underScrutiny('db-immutable-2');
      await expect(
        ctx.prisma.inspection.update({
          where: { id },
          data: { applicationId: other.applicationId },
        }),
      ).rejects.toThrow();
      await expect(
        ctx.prisma.inspection.update({
          where: { id },
          data: { createdByUserId: w.soA2.user.id },
        }),
      ).rejects.toThrow();
      await expect(
        ctx.prisma.inspection.update({
          where: { id },
          data: { createdAt: new Date(0) },
        }),
      ).rejects.toThrow();
      expect((await dbInspections(s.applicationId))[0].applicationId).toBe(
        s.applicationId,
      );
    });

    it('a scheduled inspection cannot go back to pending, and a finished one is permanent', async () => {
      const s = await underScrutiny('db-terminal');
      const created = await request(s.applicationId, {
        scheduledAt: '2099-10-01T09:00:00Z',
      }).expect(201);
      await expect(
        ctx.prisma
          .$executeRaw`UPDATE inspections SET status = 'PENDING', scheduled_at = NULL WHERE id = ${created.body.id}::uuid`,
      ).rejects.toThrow();
      // COMPLETED is impossible without a submitted report...
      await expect(
        ctx.prisma.inspection.update({
          where: { id: created.body.id },
          data: { status: 'COMPLETED' },
        }),
      ).rejects.toThrow();
      // ...and, with one, the inspection is finished for good.
      await finishInspection(ctx.prisma, created.body.id);
      await expect(
        ctx.prisma.inspection.update({
          where: { id: created.body.id },
          data: { siteAddress: 'Edited later' },
        }),
      ).rejects.toThrow();
      await expect(
        ctx.prisma.inspection.update({
          where: { id: created.body.id },
          data: { status: 'CANCELLED' },
        }),
      ).rejects.toThrow();
    });

    it('a workflow stage, if named, must belong to the inspection’s own application', async () => {
      const a = await underScrutiny('db-stage-a');
      const b = await underScrutiny('db-stage-b');
      const created = await request(a.applicationId).expect(201);
      const appB = await dbApp(b.applicationId);
      const stage = await ctx.prisma.workflowStage.create({
        data: {
          workflowId: appB.workflowId,
          sequenceOrder: 1,
          name: 'E2E inspection stage',
          departmentId: w.deptA.id,
          stageType: 'INSPECTION',
        },
      });
      const appStage = await ctx.prisma.applicationStage.create({
        data: { applicationId: b.applicationId, workflowStageId: stage.id },
      });
      try {
        // A's inspection cannot hang off B's stage...
        await expect(
          ctx.prisma.inspection.update({
            where: { id: created.body.id },
            data: { applicationStageId: appStage.id },
          }),
        ).rejects.toThrow();
        // ...but B's own inspection can be linked to it.
        const own = await ctx.prisma.inspection.create({
          data: {
            applicationId: b.applicationId,
            applicationStageId: appStage.id,
            inspectorId: w.inspectorA.user.id,
            siteAddress: 'x',
            createdByUserId: w.soA1.user.id,
            assignedByUserId: w.soA1.user.id,
          },
        });
        expect(own.applicationStageId).toBe(appStage.id);
        await ctx.prisma.inspection.delete({ where: { id: own.id } });
      } finally {
        await ctx.prisma.applicationStage.delete({
          where: { id: appStage.id },
        });
        await ctx.prisma.workflowStage.delete({ where: { id: stage.id } });
      }
    });

    it('inspections cannot be orphaned: the application, inspector and creator are protected by foreign keys', async () => {
      const { s } = await base('db-fk');
      await expect(
        ctx.prisma.inspection.create({
          data: {
            applicationId: '00000000-0000-4000-8000-000000000123',
            inspectorId: w.inspectorA.user.id,
            siteAddress: 'x',
            createdByUserId: w.soA1.user.id,
            assignedByUserId: w.soA1.user.id,
          },
        }),
      ).rejects.toThrow();
      await expect(
        ctx.prisma.inspection.create({
          data: {
            applicationId: s.applicationId,
            inspectorId: '00000000-0000-4000-8000-000000000124',
            siteAddress: 'x',
            status: 'CANCELLED',
            createdByUserId: w.soA1.user.id,
            assignedByUserId: w.soA1.user.id,
          },
        }),
      ).rejects.toThrow();
      await expect(
        ctx.prisma.approvalApplication.delete({
          where: { id: s.applicationId },
        }),
      ).rejects.toThrow();
    });
  });
});
