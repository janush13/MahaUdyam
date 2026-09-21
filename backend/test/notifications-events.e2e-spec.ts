import request from 'supertest';
import { API, E2eContext, createE2eContext } from './support/e2e-helpers';
import { future } from './support/inspection-helpers';
import {
  Actor,
  OfficerWorld,
  as,
  buildOfficerWorld,
} from './support/officer-world';

jest.setTimeout(600_000);

/**
 * Step 13 — the notifications the platform raises from its own transitions, and
 * who receives them, over real HTTP -> Nest -> Prisma -> PostgreSQL.
 *
 * Every event here is in FRD 26.1 / TRD 13 AND backed by a transition that
 * already exists. Recipients are DERIVED (enterprise owner + live
 * representatives; the officer who raised a query), never chosen by a caller.
 */
describe('Notifications e2e — events and recipients', () => {
  let ctx: E2eContext;
  let w: OfficerWorld;
  let repFull: Actor; // unrestricted FULL
  let repView: Actor; // unrestricted VIEW_ONLY
  let repP2: Actor; // PREPARE_SUBMIT restricted to project P2 only
  let repPending: Actor; // offered, never accepted
  let repRevoked: Actor; // accepted, then revoked
  let P1: string;
  let P2: string;
  let repFullAuthId: string;

  const api = (a: { accessToken: string }) => as(ctx, a.accessToken);
  const officerApp = (id: string) => `/officer/applications/${id}`;
  const errorCode = (res: { body: { error?: { code?: string } } }) =>
    res.body.error?.code;

  interface N {
    id: string;
    eventType: string;
    title: string;
    message: string;
    read: boolean;
    applicationId: string | null;
    projectId: string | null;
    enterpriseId: string | null;
    payload: Record<string, unknown> | null;
  }
  const inbox = async (a: Actor, query = ''): Promise<N[]> =>
    (await api(a).get(`/notifications${query}`).expect(200)).body.items;
  const of = async (a: Actor, eventType: string, applicationId?: string) =>
    (await inbox(a, '?pageSize=100')).filter(
      (n) =>
        n.eventType === eventType &&
        (applicationId === undefined || n.applicationId === applicationId),
    );

  const enterpriseName = async () =>
    (
      await ctx.prisma.enterprise.findUniqueOrThrow({
        where: { id: w.enterpriseId },
      })
    ).name;

  const grant = async (
    rep: Actor,
    scope: string,
    extra: Record<string, unknown> = {},
  ): Promise<string> => {
    const res = await api(w.owner)
      .post(`/enterprises/${w.enterpriseId}/representatives`)
      .send({ emailOrMobile: rep.user.email, scope, ...extra })
      .expect(201);
    return res.body.id;
  };
  const accept = (rep: Actor, id: string) =>
    api(rep).post(`/representative-authorisations/${id}/accept`).expect(200);

  const submit = (tag: string, projectId?: string) =>
    ctx.submittedApplication(
      w.owner.accessToken,
      w.enterpriseId,
      w.approvalA,
      `nt-${tag}`,
      projectId ? { projectId } : {},
    );
  const underScrutiny = async (tag: string, projectId?: string) => {
    const s = await submit(tag, projectId);
    await api(w.adminA)
      .post(`${officerApp(s.applicationId)}/assignment`)
      .send({ officerUserId: w.soA1.user.id })
      .expect(201);
    await api(w.soA1)
      .post(`${officerApp(s.applicationId)}/start-scrutiny`)
      .expect(200);
    return s;
  };
  const appBase = (s: { projectId: string; applicationId: string }) =>
    `/enterprises/${w.enterpriseId}/projects/${s.projectId}/applications/${s.applicationId}`;

  /** Every notification row in the database that mentions `needle` anywhere. */
  const leaks = (needle: string) =>
    ctx.prisma.notification.findMany({
      where: {
        OR: [
          { title: { contains: needle } },
          { message: { contains: needle } },
          { payload: { string_contains: needle } },
        ],
      },
      select: { id: true },
    });

  beforeAll(async () => {
    ctx = await createE2eContext();
    w = await buildOfficerWorld(ctx, 'nt');
    [repFull, repView, repP2, repPending, repRevoked] = await Promise.all(
      ['full', 'view', 'p2', 'pending', 'revoked'].map((t) =>
        ctx.applicantSession(`nt-rep-${t}`),
      ),
    );
    P1 = (
      await ctx.createProjectVia(w.owner.accessToken, w.enterpriseId, 'nt-p1')
    ).id;
    P2 = (
      await ctx.createProjectVia(w.owner.accessToken, w.enterpriseId, 'nt-p2')
    ).id;
  });

  afterAll(async () => {
    await ctx.cleanup();
    await ctx.app.close();
  });

  // -------------------------------------------------------------------------
  describe('representative authorisation offer (FRD 20.2)', () => {
    it('tells the invited representative, naming the enterprise, before any access exists; nobody else', async () => {
      repFullAuthId = await grant(repFull, 'FULL');
      const got = await of(repFull, 'REPRESENTATIVE_AUTHORISATION_REQUESTED');
      expect(got).toHaveLength(1);
      expect(got[0]).toMatchObject({
        applicationId: null,
        projectId: null,
        enterpriseId: w.enterpriseId,
        read: false,
      });
      expect(got[0].message).toContain(await enterpriseName());
      expect(got[0].message).toMatch(/until you accept/i);
      // The granting owner and unrelated users are not told.
      expect(
        await of(w.owner, 'REPRESENTATIVE_AUTHORISATION_REQUESTED'),
      ).toEqual([]);
      expect(
        await of(w.owner2, 'REPRESENTATIVE_AUTHORISATION_REQUESTED'),
      ).toEqual([]);
      // The offer alone grants nothing.
      await api(repFull)
        .get(`/enterprises/${w.enterpriseId}`)
        .expect((r) => expect([403, 404]).toContain(r.status));
      await accept(repFull, repFullAuthId);
    });

    it('a representative offered a narrower scope, a view-only one and a restricted one are each told', async () => {
      const viewId = await grant(repView, 'VIEW_ONLY');
      await accept(repView, viewId);
      const p2Id = await grant(repP2, 'PREPARE_SUBMIT', { projectIds: [P2] });
      await accept(repP2, p2Id);
      await grant(repPending, 'FULL'); // never accepted
      const revokedId = await grant(repRevoked, 'FULL');
      await accept(repRevoked, revokedId);
      await api(w.owner)
        .del(`/enterprises/${w.enterpriseId}/representatives/${revokedId}`)
        .expect(200);
      for (const rep of [repView, repP2, repPending, repRevoked]) {
        expect(
          await of(rep, 'REPRESENTATIVE_AUTHORISATION_REQUESTED'),
        ).toHaveLength(1);
      }
    });

    it('widening an ACCEPTED authorisation asks for fresh consent (a second notice); narrowing does not', async () => {
      const before = (
        await of(repView, 'REPRESENTATIVE_AUTHORISATION_REQUESTED')
      ).length;
      const viewAuth = (
        await ctx.prisma.enterpriseRepresentative.findFirstOrThrow({
          where: { representativeUserId: repView.user.id },
        })
      ).id;
      await api(w.owner)
        .patch(`/enterprises/${w.enterpriseId}/representatives/${viewAuth}`)
        .send({ scope: 'FULL' })
        .expect(200);
      expect(
        await of(repView, 'REPRESENTATIVE_AUTHORISATION_REQUESTED'),
      ).toHaveLength(before + 1);
      await accept(repView, viewAuth);
      await api(w.owner)
        .patch(`/enterprises/${w.enterpriseId}/representatives/${viewAuth}`)
        .send({ scope: 'VIEW_ONLY' })
        .expect(200);
      expect(
        await of(repView, 'REPRESENTATIVE_AUTHORISATION_REQUESTED'),
      ).toHaveLength(before + 1);
    });
  });

  // -------------------------------------------------------------------------
  describe('application submitted (FRD 26.1)', () => {
    it('reaches the owner and every live representative covering the project - once - and nobody else', async () => {
      const s = await submit('sub', P1);
      const ref = (
        await ctx.prisma.approvalApplication.findUniqueOrThrow({
          where: { id: s.applicationId },
        })
      ).referenceNumber as string;

      for (const a of [w.owner, repFull, repView]) {
        const got = await of(a, 'APPLICATION_SUBMITTED', s.applicationId);
        expect(got).toHaveLength(1);
        expect(got[0]).toMatchObject({
          applicationId: s.applicationId,
          projectId: P1,
          enterpriseId: w.enterpriseId,
          read: false,
        });
        expect(got[0].message).toContain(ref);
        expect(got[0].payload).toMatchObject({ referenceNumber: ref });
      }
      // A representative restricted to ANOTHER project, an unaccepted offer, a
      // revoked one, another enterprise's owner, and every officer role.
      for (const a of [
        repP2,
        repPending,
        repRevoked,
        w.owner2,
        w.soA1,
        w.soA2,
        w.adminA,
        w.aaA,
        w.inspectorA,
        w.sysAdmin,
        w.leadership,
      ]) {
        expect(await of(a, 'APPLICATION_SUBMITTED', s.applicationId)).toEqual(
          [],
        );
      }
    });

    it('a project-restricted representative is told about THEIR project', async () => {
      const s = await submit('sub-p2', P2);
      expect(
        await of(repP2, 'APPLICATION_SUBMITTED', s.applicationId),
      ).toHaveLength(1);
      expect(
        await of(repFull, 'APPLICATION_SUBMITTED', s.applicationId),
      ).toHaveLength(1);
    });

    it('a refused submission raises nothing', async () => {
      const s = await submit('sub-twice');
      await api(w.owner)
        .post(`${appBase(s)}/submit`)
        .send({ declarationAccepted: true })
        .expect(409);
      expect(
        await of(w.owner, 'APPLICATION_SUBMITTED', s.applicationId),
      ).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  describe('the query loop (FRD 26.1 query raised / responded)', () => {
    it('a raised query reaches the applicant side, without the question; the answer reaches only the officer who raised it', async () => {
      const s = await underScrutiny('query');
      const QUESTION = 'SECRET-QUESTION-9f3a';
      const ANSWER = 'SECRET-ANSWER-77c1';
      const OBSERVATION = 'SECRET-OBSERVATION-52be';
      await api(w.soA1)
        .post(`${officerApp(s.applicationId)}/observations`)
        .send({ body: OBSERVATION })
        .expect(201);
      const q = await api(w.soA1)
        .post(`${officerApp(s.applicationId)}/queries`)
        .send({ question: QUESTION })
        .expect(201);

      for (const a of [w.owner, repFull, repView]) {
        const got = await of(a, 'QUERY_RAISED', s.applicationId);
        expect(got).toHaveLength(1);
        expect(got[0].message).toMatch(/round 1/);
        expect(got[0].message).not.toContain(QUESTION);
      }
      for (const a of [w.soA1, w.soA2, w.adminA, repP2, repPending, w.owner2]) {
        expect(await of(a, 'QUERY_RAISED', s.applicationId)).toEqual([]);
      }

      await api(w.owner)
        .post(`${appBase(s)}/queries/${q.body.id}/respond`)
        .send({ responseText: ANSWER })
        .expect(200);
      const answered = await of(w.soA1, 'QUERY_RESPONDED', s.applicationId);
      expect(answered).toHaveLength(1);
      expect(answered[0]).toMatchObject({
        applicationId: s.applicationId,
        read: false,
      });
      expect(answered[0].message).not.toContain(ANSWER);
      // Nobody else is told: not the applicants, not another officer, not the
      // department administrator.
      for (const a of [w.owner, repFull, w.soA2, w.adminA, w.aaA, w.soB]) {
        expect(await of(a, 'QUERY_RESPONDED', s.applicationId)).toEqual([]);
      }

      // Nothing an officer wrote or an applicant answered is in ANY notification.
      for (const secret of [QUESTION, ANSWER, OBSERVATION]) {
        expect(await leaks(secret)).toEqual([]);
      }
    });

    it('a query refused (a second one while one is open) raises no second notification', async () => {
      const s = await underScrutiny('query-twice');
      await api(w.soA1)
        .post(`${officerApp(s.applicationId)}/queries`)
        .send({ question: 'First?' })
        .expect(201);
      await api(w.soA1)
        .post(`${officerApp(s.applicationId)}/queries`)
        .send({ question: 'Second?' })
        .expect((r) => expect(r.status).toBeGreaterThanOrEqual(400));
      expect(await of(w.owner, 'QUERY_RAISED', s.applicationId)).toHaveLength(
        1,
      );
    });

    it('two simultaneous answers to one query notify the officer once', async () => {
      const s = await underScrutiny('query-race');
      const q = await api(w.soA1)
        .post(`${officerApp(s.applicationId)}/queries`)
        .send({ question: 'Please clarify.' })
        .expect(201);
      const responses = await Promise.all(
        [1, 2, 3].map(() =>
          api(w.owner)
            .post(`${appBase(s)}/queries/${q.body.id}/respond`)
            .send({ responseText: 'Clarified.' }),
        ),
      );
      expect(responses.filter((r) => r.status === 200)).toHaveLength(1);
      expect(await of(w.soA1, 'QUERY_RESPONDED', s.applicationId)).toHaveLength(
        1,
      );
    });
  });

  // -------------------------------------------------------------------------
  describe('inspection scheduled / rescheduled (FRD 26.1)', () => {
    const SITE = 'SECRET-SITE-Plot-88';

    it('is raised once a visit has a date, and again for each reschedule - by the officer or the inspector - without the inspector or the site', async () => {
      const s = await underScrutiny('insp');
      const created = await api(w.soA1)
        .post(`${officerApp(s.applicationId)}/inspections`)
        .send({ inspectorUserId: w.inspectorA.user.id, siteAddress: SITE })
        .expect(201);
      // Awaiting a date is not yet "scheduled".
      expect(
        await of(w.owner, 'INSPECTION_SCHEDULED', s.applicationId),
      ).toEqual([]);

      const inspectorName = (
        await ctx.prisma.user.findUniqueOrThrow({
          where: { id: w.inspectorA.user.id },
        })
      ).name;
      const first = future(5);
      await api(w.soA1)
        .put(`${officerApp(s.applicationId)}/inspections/${created.body.id}`)
        .send({ scheduledAt: first })
        .expect(200);
      for (const a of [w.owner, repFull, repView]) {
        const got = await of(a, 'INSPECTION_SCHEDULED', s.applicationId);
        expect(got).toHaveLength(1);
        expect(got[0].message).toContain(new Date(first).toISOString());
        expect(got[0].message).not.toContain(SITE);
        expect(got[0].message).not.toContain(inspectorName);
      }
      for (const a of [w.inspectorA, w.soA1, w.adminA, repP2, w.owner2]) {
        expect(await of(a, 'INSPECTION_SCHEDULED', s.applicationId)).toEqual(
          [],
        );
      }

      // The officer moves it; the inspector moves it again.
      await api(w.soA1)
        .put(`${officerApp(s.applicationId)}/inspections/${created.body.id}`)
        .send({ scheduledAt: future(6) })
        .expect(200);
      await api(w.inspectorA)
        .post(`/inspections/${created.body.id}/reschedule`)
        .send({ scheduledAt: future(7), reason: 'Site closed' })
        .expect(200);
      const moved = await of(
        w.owner,
        'INSPECTION_RESCHEDULED',
        s.applicationId,
      );
      expect(moved).toHaveLength(2);
      expect(new Set(moved.map((n) => n.id)).size).toBe(2);
      expect(
        await of(repFull, 'INSPECTION_RESCHEDULED', s.applicationId),
      ).toHaveLength(2);
      // Changing only the site or the inspector is not a reschedule.
      await api(w.soA1)
        .put(`${officerApp(s.applicationId)}/inspections/${created.body.id}`)
        .send({ siteAddress: 'Somewhere else' })
        .expect(200);
      expect(
        await of(w.owner, 'INSPECTION_RESCHEDULED', s.applicationId),
      ).toHaveLength(2);
      expect(await leaks(SITE)).toEqual([]);
    });

    it('created with a date, it is "scheduled" straight away', async () => {
      const s = await underScrutiny('insp-dated');
      await api(w.soA1)
        .post(`${officerApp(s.applicationId)}/inspections`)
        .send({
          inspectorUserId: w.inspectorA.user.id,
          siteAddress: 'Plot 1',
          scheduledAt: future(4),
        })
        .expect(201);
      expect(
        await of(w.owner, 'INSPECTION_SCHEDULED', s.applicationId),
      ).toHaveLength(1);
    });

    it('a refused inspection raises nothing', async () => {
      const s = await underScrutiny('insp-refused');
      await api(w.soA1)
        .post(`${officerApp(s.applicationId)}/inspections`)
        .send({
          inspectorUserId: w.inspectorA.user.id,
          siteAddress: 'Plot 1',
          scheduledAt: '2020-01-01T00:00:00Z',
        })
        .expect(400);
      expect(
        await of(w.owner, 'INSPECTION_SCHEDULED', s.applicationId),
      ).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  describe('events this build deliberately does not raise', () => {
    it('raises no event outside the supported catalogue, whatever the flow did', async () => {
      const supported = [
        'APPLICATION_SUBMITTED',
        'QUERY_RAISED',
        'QUERY_RESPONDED',
        'INSPECTION_SCHEDULED',
        'INSPECTION_RESCHEDULED',
        'REPRESENTATIVE_AUTHORISATION_REQUESTED',
        'SLA_WARNING',
        'SLA_BREACHED',
      ];
      const users = [
        w.owner,
        w.soA1,
        w.adminA,
        repFull,
        repView,
        repP2,
        repPending,
        repRevoked,
      ].map((a) => a.user.id);
      const rows = await ctx.prisma.notification.findMany({
        where: { userId: { in: users } },
        select: { eventType: true },
      });
      expect(rows.length).toBeGreaterThan(0);
      for (const r of rows) {
        expect(supported).toContain(r.eventType);
      }
    });

    it('assignment, scrutiny start and recommendation stay silent (not in FRD 26.1)', async () => {
      const s = await underScrutiny('silent');
      await api(w.soA1)
        .post(`${officerApp(s.applicationId)}/recommendation`)
        .send({ outcome: 'APPROVE', reason: 'In order.' })
        .expect(201);
      const rows = await ctx.prisma.notification.findMany({
        where: { applicationId: s.applicationId },
        select: { eventType: true },
      });
      // Only the applicant-facing submission; nothing about assignment,
      // scrutiny or the recommendation, and nobody in the officer chain is told.
      expect([...new Set(rows.map((r) => r.eventType))]).toEqual([
        'APPLICATION_SUBMITTED',
      ]);
    });
  });

  // -------------------------------------------------------------------------
  describe('a revoked representative stops seeing application notifications', () => {
    it('revocation hides the application-scoped ones at once; the personal offer notice stays theirs', async () => {
      const s = await submit('revoke-late');
      expect(
        await of(repFull, 'APPLICATION_SUBMITTED', s.applicationId),
      ).toHaveLength(1);
      const unreadBefore = (
        await api(repFull).get('/notifications/unread-count').expect(200)
      ).body.unread;

      await api(w.owner)
        .del(`/enterprises/${w.enterpriseId}/representatives/${repFullAuthId}`)
        .expect(200);

      expect(
        await of(repFull, 'APPLICATION_SUBMITTED', s.applicationId),
      ).toEqual([]);
      const remaining = await inbox(repFull, '?pageSize=100');
      expect(remaining.every((n) => n.applicationId === null)).toBe(true);
      expect(
        await of(repFull, 'REPRESENTATIVE_AUTHORISATION_REQUESTED'),
      ).toHaveLength(1);
      const unreadAfter = (
        await api(repFull).get('/notifications/unread-count').expect(200)
      ).body.unread;
      expect(unreadAfter).toBeLessThan(unreadBefore);
      // The row still exists; it is only no longer readable through the API.
      expect(
        await ctx.prisma.notification.count({
          where: {
            userId: repFull.user.id,
            applicationId: s.applicationId,
          },
        }),
      ).toBe(1);
      const hidden = await ctx.prisma.notification.findFirstOrThrow({
        where: { userId: repFull.user.id, applicationId: s.applicationId },
      });
      await api(repFull).get(`/notifications/${hidden.id}`).expect(404);
      await api(repFull).post(`/notifications/${hidden.id}/read`).expect(404);
      // The owner is unaffected.
      expect(
        await of(w.owner, 'APPLICATION_SUBMITTED', s.applicationId),
      ).toHaveLength(1);
      expect(
        errorCode(await api(repFull).get(`/notifications/${hidden.id}`)),
      ).toBe('NOT_FOUND');
    });
  });

  it('is closed to unauthenticated callers', async () => {
    await request(ctx.http).get(`${API}/notifications`).expect(401);
    await request(ctx.http)
      .get(`${API}/notifications/unread-count`)
      .expect(401);
  });
});
