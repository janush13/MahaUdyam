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

const iso = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString();

interface Item {
  id: string;
  status: string;
  scheduledAt: string | null;
  assignedBy: { userId: string } | null;
  inspector: { userId: string };
  applicationId: string;
}

/**
 * Who may READ inspections, over real HTTP -> Nest -> Prisma -> PostgreSQL:
 * the detail route, the caller's list (scoping, filters, pagination, stable
 * ordering) and the per-application list — for every role, across departments
 * and enterprises.
 *
 * Dataset (department A unless noted):
 *   ia1  application a1 -> soA1, inspector inspectorA,  scheduled in 1 day
 *   ia2  application a2 -> soA1, inspector inspectorA,  scheduled in 3 days
 *   ia4  application a4 -> soA1, inspector inspectorA2, PENDING (no date);
 *        scrutiny is later finished (recommended) in one describe block
 *   ia3  application a3 -> soA2, inspector inspectorA2, scheduled in 2 days
 *   ib1  department B, application b1 -> soB, inspector inspectorB
 */
describe('Inspections access e2e — who sees which inspection', () => {
  let ctx: E2eContext;
  let w: OfficerWorld;
  let inspectorA2: Actor;
  let inspectorB: Actor;
  const ids: Record<string, string> = {};
  const apps: Record<string, { applicationId: string; projectId: string }> = {};

  const api = (a: { accessToken: string }) => as(ctx, a.accessToken);
  const appPath = (id: string) => `/officer/applications/${id}`;
  const errorCode = (res: { body: { error?: { code?: string } } }) =>
    res.body.error?.code;
  const list = async (actor: Actor, query = '') =>
    (await api(actor).get(`/inspections${query}`).expect(200)).body as {
      items: Item[];
      page: number;
      pageSize: number;
      total: number;
    };
  const idsOf = (items: Item[]) => items.map((i) => i.id);

  /** An application under scrutiny by `officer`, with an inspection. */
  const withInspection = async (
    key: string,
    opts: {
      approval?: string;
      admin?: Actor;
      officer?: Actor;
      inspector?: Actor;
      scheduledAt?: string;
    } = {},
  ) => {
    const officer = opts.officer ?? w.soA1;
    const s = await ctx.submittedApplication(
      w.owner.accessToken,
      w.enterpriseId,
      opts.approval ?? w.approvalA,
      `ia-${key}`,
    );
    apps[key] = s;
    await api(opts.admin ?? w.adminA)
      .post(`${appPath(s.applicationId)}/assignment`)
      .send({ officerUserId: officer.user.id })
      .expect(201);
    await api(officer)
      .post(`${appPath(s.applicationId)}/start-scrutiny`)
      .expect(200);
    const res = await api(officer)
      .post(`${appPath(s.applicationId)}/inspections`)
      .send({
        inspectorUserId: (opts.inspector ?? w.inspectorA).user.id,
        siteAddress: `Site of ${key}`,
        ...(opts.scheduledAt ? { scheduledAt: opts.scheduledAt } : {}),
      })
      .expect(201);
    ids[key] = res.body.id;
    return s;
  };

  beforeAll(async () => {
    ctx = await createE2eContext();
    w = await buildOfficerWorld(ctx, 'ia');
    [inspectorA2, inspectorB] = await Promise.all([
      ctx.officerSession('ia-ins2', 'INSPECTOR', w.deptA.id),
      ctx.officerSession('ia-insb', 'INSPECTOR', w.deptB.id),
    ]);
    await withInspection('a1', { scheduledAt: iso(1) });
    await withInspection('a2', { scheduledAt: iso(3) });
    await withInspection('a4', { inspector: inspectorA2 });
    await withInspection('a3', {
      officer: w.soA2,
      inspector: inspectorA2,
      scheduledAt: iso(2),
    });
    await withInspection('b1', {
      approval: w.approvalB,
      admin: w.adminB,
      officer: w.soB,
      inspector: inspectorB,
      scheduledAt: iso(1),
    });
  });

  afterAll(async () => {
    await ctx.cleanup();
    await ctx.app.close();
  });

  // -------------------------------------------------------------------------
  describe('one inspection: GET /inspections/:id', () => {
    it.each([
      [
        'the Scrutiny Officer the application is assigned to',
        () => w.soA1,
        200,
      ],
      ['the department’s administrator', () => w.adminA, 200],
      ['the assigned Inspector', () => w.inspectorA, 200],
      ['another Scrutiny Officer of the department', () => w.soA2, 404],
      ['another Inspector of the department', () => inspectorA2, 404],
      ['an Inspector of another department', () => inspectorB, 404],
      ['another department’s officer', () => w.soB, 404],
      ['another department’s administrator', () => w.adminB, 404],
      [
        'the Approving Authority before a recommendation exists',
        () => w.aaA,
        404,
      ],
      ['a system administrator', () => w.sysAdmin, 403],
      ['a leadership user', () => w.leadership, 403],
      ['the applicant who owns the application', () => w.owner, 403],
      ['another enterprise’s applicant', () => w.owner2, 403],
    ] as Array<[string, () => Actor, number]>)(
      'ia1 as %s -> %i',
      async (_who, pick, status) => {
        const res = await api(pick()).get(`/inspections/${ids.a1}`);
        expect(res.status).toBe(status);
        if (status === 200) {
          expect(res.body.id).toBe(ids.a1);
        }
      },
    );

    it('is 401 without a token, 404 for an unknown id and 400 for a malformed one', async () => {
      expect(
        (await st(ctx.http).get(`/api/v1/inspections/${ids.a1}`)).status,
      ).toBe(401);
      expect(
        (
          await api(w.soA1).get(
            '/inspections/00000000-0000-4000-8000-0000000000aa',
          )
        ).status,
      ).toBe(404);
      expect((await api(w.soA1).get('/inspections/not-a-uuid')).status).toBe(
        400,
      );
    });

    it('the department can never be steered from the client: another department’s inspection is a plain 404 for every department-A role', async () => {
      for (const actor of [
        w.soA1,
        w.soA2,
        w.adminA,
        w.aaA,
        w.inspectorA,
        inspectorA2,
      ]) {
        const res = await api(actor).get(`/inspections/${ids.b1}`);
        expect(res.status).toBe(404);
        expect(errorCode(res)).toBe('NOT_FOUND');
      }
      // ...and it is byte-for-byte what a nonexistent inspection looks like.
      const real = await api(w.soA1).get(`/inspections/${ids.b1}`);
      const ghost = await api(w.soA1).get(
        '/inspections/00000000-0000-4000-8000-0000000000bb',
      );
      expect(real.body.error.message).toBe(ghost.body.error.message);
    });

    it('an officer sees the full working view, including who assigned the inspector', async () => {
      const res = await api(w.soA1).get(`/inspections/${ids.a1}`).expect(200);
      expect(res.body).toMatchObject({
        applicationId: apps.a1.applicationId,
        status: 'SCHEDULED',
        assignedBy: { userId: w.soA1.user.id },
        inspector: { userId: w.inspectorA.user.id },
        department: { id: w.deptA.id },
        siteAddress: 'Site of a1',
      });
    });

    it('an Inspector sees only the minimum needed to conduct the visit', async () => {
      const res = await api(w.inspectorA)
        .get(`/inspections/${ids.a1}`)
        .expect(200);
      expect(res.body).toMatchObject({
        id: ids.a1,
        status: 'SCHEDULED',
        siteAddress: 'Site of a1',
        inspector: { userId: w.inspectorA.user.id },
        assignedBy: null,
      });
      expect(res.body.applicationReference).toEqual(expect.any(String));
      expect(res.body.project.name).toEqual(expect.any(String));
      // Nothing about the enterprise, the form, documents, scrutiny or queries.
      const text = JSON.stringify(res.body);
      expect(text).not.toMatch(
        /formData|enterprise|document|observation|recommendation|query|scrutiny|internalState|@example\.test/i,
      );
    });

    it('never exposes the officer who assigned the Inspector, or any internal column, to an Inspector', async () => {
      const res = await api(w.inspectorA)
        .get(`/inspections/${ids.a1}`)
        .expect(200);
      expect(JSON.stringify(res.body)).not.toContain(w.soA1.user.id);
      expect(JSON.stringify(res.body)).not.toMatch(
        /geoConsent|applicationStage|createdByUserId|password|token|secret/i,
      );
    });
  });

  // -------------------------------------------------------------------------
  describe('the caller’s list: GET /inspections', () => {
    it('an Inspector sees only their own assignments, soonest first, unscheduled last', async () => {
      const a = await list(w.inspectorA);
      expect(idsOf(a.items)).toEqual([ids.a1, ids.a2]);
      expect(a.total).toBe(2);
      expect(a.items.every((i) => i.assignedBy === null)).toBe(true);
      expect(
        a.items.every((i) => i.inspector.userId === w.inspectorA.user.id),
      ).toBe(true);

      const a2 = await list(inspectorA2);
      // a3 (in 2 days) before a4 (no date yet).
      expect(idsOf(a2.items)).toEqual([ids.a3, ids.a4]);
      expect(a2.items[1].scheduledAt).toBeNull();

      expect(idsOf((await list(inspectorB)).items)).toEqual([ids.b1]);
    });

    it('a Scrutiny Officer sees only the inspections of applications assigned to them', async () => {
      expect(idsOf((await list(w.soA1)).items)).toEqual([
        ids.a1,
        ids.a2,
        ids.a4,
      ]);
      expect(idsOf((await list(w.soA2)).items)).toEqual([ids.a3]);
      expect(idsOf((await list(w.soB)).items)).toEqual([ids.b1]);
      const asOfficer = (await list(w.soA1)).items;
      expect(
        asOfficer.every((i) => i.assignedBy?.userId === w.soA1.user.id),
      ).toBe(true);
    });

    it('a Department Administrator sees the whole department — and only theirs', async () => {
      const inDeptA = await ctx.prisma.inspection.findMany({
        where: { application: { approvalType: { departmentId: w.deptA.id } } },
        select: { id: true },
      });
      const a = await list(w.adminA, '?pageSize=100');
      expect(a.total).toBe(inDeptA.length);
      expect(idsOf(a.items).sort()).toEqual(inDeptA.map((i) => i.id).sort());
      expect(idsOf(a.items)).not.toContain(ids.b1);
      expect(idsOf((await list(w.adminB)).items)).toEqual([ids.b1]);
    });

    it('the Approving Authority sees only inspections of applications awaiting a decision', async () => {
      expect((await list(w.aaA)).items).toEqual([]);
    });

    it('roles that have no business with inspections are refused at the route', async () => {
      for (const actor of [w.sysAdmin, w.leadership, w.owner, w.owner2]) {
        const res = await api(actor).get('/inspections');
        expect(res.status).toBe(403);
        expect(errorCode(res)).toBe('INSUFFICIENT_ROLE');
      }
      expect((await st(ctx.http).get('/api/v1/inspections')).status).toBe(401);
    });

    it('filters by status, application and schedule window — and can only narrow', async () => {
      expect(idsOf((await list(w.adminA, '?status=PENDING')).items)).toEqual([
        ids.a4,
      ]);
      expect(
        idsOf(
          (await list(w.adminA, '?status=SCHEDULED&pageSize=100')).items,
        ).sort(),
      ).toEqual([ids.a1, ids.a2, ids.a3].sort());
      expect(idsOf((await list(w.adminA, '?status=COMPLETED')).items)).toEqual(
        [],
      );
      // Application filter.
      expect(
        idsOf(
          (await list(w.soA1, `?applicationId=${apps.a2.applicationId}`)).items,
        ),
      ).toEqual([ids.a2]);
      // An application outside the caller's scope: an empty list, never a leak.
      for (const foreign of [apps.b1.applicationId, apps.a3.applicationId]) {
        const res = await list(w.soA1, `?applicationId=${foreign}`);
        expect(res).toMatchObject({ items: [], total: 0 });
      }
      expect(
        idsOf(
          (await list(w.adminA, `?applicationId=${apps.b1.applicationId}`))
            .items,
        ),
      ).toEqual([]);
      // Schedule window (inclusive, offsets honoured).
      const window = await list(
        w.adminA,
        `?scheduledFrom=${encodeURIComponent(iso(1.5))}&scheduledTo=${encodeURIComponent(iso(2.5))}`,
      );
      expect(idsOf(window.items)).toEqual([ids.a3]);
    });

    it('paginates completely and stably, with a real total', async () => {
      const pages: string[] = [];
      for (const page of [1, 2, 3]) {
        const p = await list(w.soA1, `?pageSize=1&page=${page}`);
        expect(p).toMatchObject({ page, pageSize: 1, total: 3 });
        pages.push(...idsOf(p.items));
      }
      expect(pages).toEqual([ids.a1, ids.a2, ids.a4]);
      expect(idsOf((await list(w.soA1, '?pageSize=1&page=4')).items)).toEqual(
        [],
      );
      const twice = [
        await list(w.adminA, '?pageSize=100'),
        await list(w.adminA, '?pageSize=100'),
      ];
      expect(idsOf(twice[0].items)).toEqual(idsOf(twice[1].items));
    });

    it('breaks ties deterministically (same schedule: newest first, then id)', async () => {
      const at = iso(9);
      const x = await withInspection('tie1', { scheduledAt: at });
      const y = await withInspection('tie2', { scheduledAt: at });
      expect(x.applicationId).not.toBe(y.applicationId);
      const items = (await list(w.inspectorA, '?pageSize=100')).items;
      const tied = items.filter((i) => [ids.tie1, ids.tie2].includes(i.id));
      expect(tied).toHaveLength(2);
      // Newest created first.
      expect(tied[0].id).toBe(ids.tie2);
      const again = (await list(w.inspectorA, '?pageSize=100')).items;
      expect(idsOf(again)).toEqual(idsOf(items));
    });

    it.each([
      ['a page size over the limit', '?pageSize=101'],
      ['a zero page size', '?pageSize=0'],
      ['a zero page', '?page=0'],
      ['an unknown status', '?status=DONE'],
      [
        'a client-supplied department',
        '?departmentId=00000000-0000-4000-8000-000000000001',
      ],
      [
        'a client-supplied inspector',
        '?inspectorId=00000000-0000-4000-8000-000000000001',
      ],
      ['a raw query', '?where=1%3D1'],
      ['a malformed application id', '?applicationId=x'],
      ['a window with no offset', '?scheduledFrom=2026-10-01T00:00:00'],
      [
        'an inverted window',
        `?scheduledFrom=${encodeURIComponent('2030-01-02T00:00:00Z')}&scheduledTo=${encodeURIComponent('2030-01-01T00:00:00Z')}`,
      ],
    ])('rejects %s (400)', async (_name, query) => {
      const res = await api(w.adminA).get(`/inspections${query}`);
      expect(res.status).toBe(400);
      expect(errorCode(res)).toBe('VALIDATION_ERROR');
    });
  });

  // -------------------------------------------------------------------------
  describe('one application’s inspections: GET /officer/applications/:id/inspections', () => {
    const path = (key: string) =>
      `${appPath(apps[key].applicationId)}/inspections`;

    it('is available to the officer roles that can see the application', async () => {
      for (const actor of [w.soA1, w.adminA]) {
        const res = await api(actor).get(path('a1')).expect(200);
        expect(idsOf(res.body)).toEqual([ids.a1]);
        expect(res.body[0].assignedBy.userId).toBe(w.soA1.user.id);
      }
    });

    it('is a 404 for everyone else who reaches the route, and a 403 for roles the route does not allow', async () => {
      for (const actor of [w.soA2, w.soB, w.adminB, w.aaA]) {
        expect((await api(actor).get(path('a1'))).status).toBe(404);
      }
      for (const actor of [
        w.inspectorA,
        w.sysAdmin,
        w.leadership,
        w.owner,
        w.owner2,
      ]) {
        const res = await api(actor).get(path('a1'));
        expect(res.status).toBe(403);
        expect(errorCode(res)).toBe('INSUFFICIENT_ROLE');
      }
      expect(
        (
          await api(w.soA1).get(
            `${appPath('00000000-0000-4000-8000-000000000001')}/inspections`,
          )
        ).status,
      ).toBe(404);
      expect(
        (await api(w.soA1).get(`${appPath('x')}/inspections`)).status,
      ).toBe(400);
    });

    it('lists every inspection of an application, newest first', async () => {
      const s = apps.a2;
      const first = await ctx.prisma.inspection.findFirstOrThrow({
        where: { applicationId: s.applicationId },
      });
      await finishInspection(ctx.prisma, first.id);
      const second = await api(w.soA1)
        .post(path('a2'))
        .send({
          inspectorUserId: w.inspectorA.user.id,
          siteAddress: 'Second visit',
        })
        .expect(201);
      const res = await api(w.soA1).get(path('a2')).expect(200);
      expect(idsOf(res.body)).toEqual([second.body.id, first.id]);
      expect(res.body.map((i: Item) => i.status)).toEqual([
        'PENDING',
        'COMPLETED',
      ]);
    });
  });

  // -------------------------------------------------------------------------
  describe('when scrutiny has finished, the Approving Authority sees the inspection', () => {
    it('only once the recommendation is with them, and only for that application', async () => {
      await api(w.aaA).get(`/inspections/${ids.a4}`).expect(404);
      // Since Step 11C the recommendation is refused while an inspection is open;
      // set the finished-scrutiny state directly.
      await markScrutinyFinished(ctx.prisma, apps.a4.applicationId);

      const res = await api(w.aaA).get(`/inspections/${ids.a4}`).expect(200);
      expect(res.body.assignedBy).not.toBeNull();
      expect(idsOf((await list(w.aaA)).items)).toEqual([ids.a4]);
      // Not the applications still under scrutiny.
      await api(w.aaA).get(`/inspections/${ids.a1}`).expect(404);
      expect(
        idsOf(
          (
            await api(w.aaA)
              .get(`${appPath(apps.a4.applicationId)}/inspections`)
              .expect(200)
          ).body,
        ),
      ).toEqual([ids.a4]);
      // Read-only: the Approving Authority cannot change or request one.
      const put = await api(w.aaA)
        .put(`${appPath(apps.a4.applicationId)}/inspections/${ids.a4}`)
        .send({ siteAddress: 'Changed' });
      expect(put.status).toBe(403);
      // The inspector still sees their assignment.
      await api(inspectorA2).get(`/inspections/${ids.a4}`).expect(200);
    });
  });

  // -------------------------------------------------------------------------
  describe('the applicant side is unchanged by this step', () => {
    it('the applicant’s own application view reveals nothing about the inspection or the inspector', async () => {
      const s = apps.a1;
      const res = await api(w.owner)
        .get(
          `/enterprises/${w.enterpriseId}/projects/${s.projectId}/applications/${s.applicationId}`,
        )
        .expect(200);
      const text = JSON.stringify(res.body);
      expect(text).not.toContain(ids.a1);
      expect(text).not.toContain(w.inspectorA.user.id);
      expect(text).not.toContain('Site of a1');
      // The applicant-facing status is exactly what scrutiny gave it: no
      // inspection status is invented before that step exists.
      expect(res.body.applicantStatus).toBe('UNDER_SCRUTINY');
    });

    it('the applicant reaches inspections only through their own enterprise-scoped view (Step 11C), never the officer or inspector routes', async () => {
      expect(
        (await api(w.owner).get(`/enterprises/${w.enterpriseId}/inspections`))
          .status,
      ).toBe(404);
      for (const path of [
        '/inspections',
        `/inspections/${ids.a1}`,
        `/inspections/${ids.a1}/report`,
        `${appPath(apps.a1.applicationId)}/inspections`,
      ]) {
        const res = await api(w.owner).get(path);
        expect(res.status).toBe(403);
        expect(errorCode(res)).toBe('INSUFFICIENT_ROLE');
      }
      await api(w.owner)
        .get(
          `/enterprises/${w.enterpriseId}/projects/${apps.a1.projectId}/applications/${apps.a1.applicationId}/inspections`,
        )
        .expect(200);
    });
  });

  // -------------------------------------------------------------------------
  describe('regression: Step 10 scrutiny is unaffected by an inspection existing', () => {
    it('an application with an open inspection is still worked exactly as before', async () => {
      // A twin application under scrutiny by the same officer, with NO inspection.
      const twin = await ctx.submittedApplication(
        w.owner.accessToken,
        w.enterpriseId,
        w.approvalA,
        'ia-twin',
      );
      await api(w.adminA)
        .post(`${appPath(twin.applicationId)}/assignment`)
        .send({ officerUserId: w.soA1.user.id })
        .expect(201);
      await api(w.soA1)
        .post(`${appPath(twin.applicationId)}/start-scrutiny`)
        .expect(200);

      const s = apps.a2;
      await api(w.soA1)
        .post(`${appPath(s.applicationId)}/observations`)
        .send({ body: 'Noted.' })
        .expect(201);
      const withInspection = await api(w.soA1)
        .get(appPath(s.applicationId))
        .expect(200);
      const without = await api(w.soA1)
        .get(appPath(twin.applicationId))
        .expect(200);
      expect(withInspection.body.internalState).toBe('UNDER_SCRUTINY');
      expect(withInspection.body.availableActions).toEqual(
        without.body.availableActions,
      );
      expect(withInspection.body.availableActions).toEqual(
        expect.arrayContaining(['RAISE_QUERY', 'RECOMMEND']),
      );
      // An Inspector is still not an officer.
      expect(
        (await api(w.inspectorA).get(appPath(s.applicationId))).status,
      ).toBe(403);
    });
  });
  // -------------------------------------------------------------------------
  describe('an Inspector�s access follows their role (last: it adds an inspection of its own)', () => {
    it('an Inspector who loses the role, or holds it only elsewhere, loses access', async () => {
      const temp = await ctx.officerSession('ia-temp', 'INSPECTOR', w.deptA.id);
      const s = await ctx.submittedApplication(
        w.owner.accessToken,
        w.enterpriseId,
        w.approvalA,
        'ia-temp-app',
      );
      await api(w.adminA)
        .post(`${appPath(s.applicationId)}/assignment`)
        .send({ officerUserId: w.soA1.user.id })
        .expect(201);
      await api(w.soA1)
        .post(`${appPath(s.applicationId)}/start-scrutiny`)
        .expect(200);
      const created = await api(w.soA1)
        .post(`${appPath(s.applicationId)}/inspections`)
        .send({ inspectorUserId: temp.user.id, siteAddress: 'Temp site' })
        .expect(201);
      await api(temp).get(`/inspections/${created.body.id}`).expect(200);

      await ctx.prisma.userRole.deleteMany({ where: { userId: temp.user.id } });
      // The role is gone: refused at the route.
      await api(temp).get(`/inspections/${created.body.id}`).expect(403);
      // Granted only in the OTHER department: sees nothing here.
      await ctx.users.assignRole({
        userId: temp.user.id,
        roleCode: 'INSPECTOR',
        departmentId: w.deptB.id,
        assignedByUserId: null,
        ipAddress: '127.0.0.1',
      });
      await api(temp).get(`/inspections/${created.body.id}`).expect(404);
      expect((await list(temp)).total).toBe(0);
    });
  });
});
