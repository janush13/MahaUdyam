import { randomUUID } from 'node:crypto';
import { E2eContext, createE2eContext } from './support/e2e-helpers';
import { OfficerWorld, as, buildOfficerWorld } from './support/officer-world';

jest.setTimeout(600_000);

interface Row {
  id: string;
  referenceNumber: string;
  internalState: string;
  applicantStatus: string;
  assignedOfficer: { userId: string } | null;
  awaitingApplicant: boolean;
  approvalType: { id: string };
  department: { id: string };
  enterprise: { id: string; name: string };
  project: { id: string; name: string };
}

/**
 * The officer queue, dashboard and assignment over real HTTP -> Nest -> Prisma
 * -> PostgreSQL: department/role scoping, filtering, search, stable pagination,
 * assignment and reassignment (with history), and the races around them.
 */
describe('Officer workspace e2e — queue, dashboard, assignment', () => {
  let ctx: E2eContext;
  let w: OfficerWorld;
  let approvalA2: string;

  // Dataset (department A): a1 submitted+unassigned; a2 submitted -> soA1;
  // a3 under scrutiny -> soA1; a4 query raised -> soA1; a5 recommended -> soA2;
  // a6 submitted -> soA2 (a second approval type). Department B: b1 -> soB.
  // Plus one DRAFT in department A, which no officer may ever see.
  const apps: Record<
    string,
    {
      applicationId: string;
      projectId: string;
      referenceNumber: string;
      tag: string;
    }
  > = {};
  let draftId: string;

  const api = (a: { accessToken: string }) => as(ctx, a.accessToken);
  const appPath = (id: string) => `/officer/applications/${id}`;
  const assign = (
    applicationId: string,
    officer: { user: { id: string } },
    by = w.adminA,
  ) =>
    api(by)
      .post(`${appPath(applicationId)}/assignment`)
      .send({ officerUserId: officer.user.id });
  const ids = (rows: Row[]) => rows.map((r) => r.id).sort();
  const dbApp = (id: string) =>
    ctx.prisma.approvalApplication.findUniqueOrThrow({ where: { id } });
  const list = async (actor: { accessToken: string }, query = '') =>
    (await api(actor).get(`/officer/applications${query}`).expect(200))
      .body as {
      items: Row[];
      page: number;
      pageSize: number;
      total: number;
    };

  const submit = async (
    key: string,
    approval: string,
    enterpriseId = w.enterpriseId,
    token = w.owner.accessToken,
  ) => {
    const tag = `wsq-${key}`;
    const s = await ctx.submittedApplication(
      token,
      enterpriseId,
      approval,
      tag,
    );
    apps[key] = { ...s, tag };
    return s;
  };

  beforeAll(async () => {
    ctx = await createE2eContext();
    w = await buildOfficerWorld(ctx, 'ws');
    approvalA2 = (
      await ctx.createStartableApproval(w.owner.user.id, 'ws-a2', {
        departmentId: w.deptA.id,
      })
    ).approvalTypeId;

    await submit('a1', w.approvalA);
    await submit('a2', w.approvalA);
    await submit('a3', w.approvalA);
    await submit('a4', w.approvalA);
    await submit('a5', w.approvalA);
    await submit('a6', approvalA2);
    await submit('b1', w.approvalB);

    await assign(apps.a2.applicationId, w.soA1).expect(201);
    await assign(apps.a3.applicationId, w.soA1).expect(201);
    await assign(apps.a4.applicationId, w.soA1).expect(201);
    await assign(apps.a5.applicationId, w.soA2).expect(201);
    await assign(apps.a6.applicationId, w.soA2).expect(201);
    await assign(apps.b1.applicationId, w.soB, w.adminB).expect(201);
    await api(w.soA1)
      .post(`${appPath(apps.a3.applicationId)}/start-scrutiny`)
      .expect(200);
    await api(w.soA1)
      .post(`${appPath(apps.a4.applicationId)}/start-scrutiny`)
      .expect(200);
    await api(w.soA1)
      .post(`${appPath(apps.a4.applicationId)}/queries`)
      .send({ question: 'Open question' })
      .expect(201);
    await api(w.soA2)
      .post(`${appPath(apps.a5.applicationId)}/start-scrutiny`)
      .expect(200);
    await api(w.soA2)
      .post(`${appPath(apps.a5.applicationId)}/recommendation`)
      .send({ outcome: 'APPROVE', reason: 'ok' })
      .expect(201);

    // A draft in department A.
    const project = await ctx.createProjectVia(
      w.owner.accessToken,
      w.enterpriseId,
      'wsq-draft',
    );
    const snapshot = await ctx.discover(
      w.owner.accessToken,
      w.enterpriseId,
      project.id,
    );
    const draft = await as(ctx, w.owner.accessToken)
      .post(
        `/enterprises/${w.enterpriseId}/projects/${project.id}/applications`,
      )
      .send({ approvalTypeId: w.approvalA, discoverySnapshotId: snapshot })
      .expect(201);
    draftId = draft.body.id;
  });

  afterAll(async () => {
    await ctx.cleanup();
    await ctx.app.close();
  });

  const idOf = (key: string) => apps[key].applicationId;

  // -------------------------------------------------------------------------
  describe('the queue is scoped by role and department', () => {
    it('a Department Administrator sees the whole department — and nothing of another department or any draft', async () => {
      const res = await list(w.adminA);
      expect(ids(res.items)).toEqual(
        ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'].map(idOf).sort(),
      );
      expect(res.total).toBe(6);
      expect(res.items.every((r) => r.department.id === w.deptA.id)).toBe(true);
      expect(res.items.map((r) => r.id)).not.toContain(draftId);
      expect(res.items.map((r) => r.id)).not.toContain(idOf('b1'));
    });

    it('a Scrutiny Officer sees only what is assigned to them', async () => {
      expect(ids((await list(w.soA1)).items)).toEqual(
        ['a2', 'a3', 'a4'].map(idOf).sort(),
      );
      expect(ids((await list(w.soA2)).items)).toEqual(
        ['a5', 'a6'].map(idOf).sort(),
      );
      expect(ids((await list(w.soB)).items)).toEqual([idOf('b1')]);
    });

    it('the Approving Authority sees only applications awaiting a decision', async () => {
      expect(ids((await list(w.aaA)).items)).toEqual([idOf('a5')]);
    });

    it('the other department’s administrator sees only their own department', async () => {
      expect(ids((await list(w.adminB)).items)).toEqual([idOf('b1')]);
    });

    it('a role with no department, or with no officer role, sees nothing and gets no error about why', async () => {
      // An applicant / inspector / system admin / leadership user cannot use the queue at all.
      for (const actor of [w.inspectorA, w.sysAdmin, w.leadership, w.owner]) {
        const res = await api(actor).get('/officer/applications').expect(403);
        expect(res.body.error.code).toBe('INSUFFICIENT_ROLE');
      }
    });

    it('rows carry what an inbox needs, and no form data or personal data', async () => {
      const { items } = await list(w.adminA, '?pageSize=100');
      const row = items.find((r) => r.id === idOf('a4'))!;
      expect(row).toMatchObject({
        id: idOf('a4'),
        referenceNumber: apps.a4.referenceNumber,
        internalState: 'QUERY_RAISED',
        applicantStatus: 'QUERY_RAISED',
        awaitingApplicant: true,
        assignedOfficer: { userId: w.soA1.user.id },
        approvalType: { id: w.approvalA },
        department: { id: w.deptA.id },
      });
      expect(row.enterprise).toMatchObject({ id: w.enterpriseId });
      expect(items.find((r) => r.id === idOf('a1'))).toMatchObject({
        assignedOfficer: null,
        awaitingApplicant: false,
        internalState: 'SUBMITTED',
      });
      const text = JSON.stringify(items);
      for (const forbidden of [
        'formData',
        'address',
        w.owner.user.email,
        w.owner.user.mobile,
        'registrationNumber',
      ]) {
        expect(text).not.toContain(forbidden);
      }
    });
  });

  // -------------------------------------------------------------------------
  describe('pagination and ordering', () => {
    it('pages are disjoint, complete and stable, with a real total', async () => {
      const seen: string[] = [];
      for (const page of [1, 2, 3]) {
        const res = await list(w.adminA, `?page=${page}&pageSize=2`);
        expect(res).toMatchObject({ page, pageSize: 2, total: 6 });
        expect(res.items).toHaveLength(2);
        seen.push(...res.items.map((r) => r.id));
      }
      expect(new Set(seen).size).toBe(6);
      expect(seen.sort()).toEqual(
        ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'].map(idOf).sort(),
      );
      // Beyond the end: nothing, but the total is still right.
      const beyond = await list(w.adminA, '?page=4&pageSize=2');
      expect(beyond.items).toEqual([]);
      expect(beyond.total).toBe(6);
    });

    it('is deterministic: the same request returns the same order every time', async () => {
      const first = (await list(w.adminA, '?pageSize=100')).items.map(
        (r) => r.id,
      );
      for (let i = 0; i < 3; i++) {
        expect(
          (await list(w.adminA, '?pageSize=100')).items.map((r) => r.id),
        ).toEqual(first);
      }
      // Oldest submission first by default (an inbox).
      expect(first).toEqual(['a1', 'a2', 'a3', 'a4', 'a5', 'a6'].map(idOf));
    });

    it('supports descending order and other sort fields, and reverses exactly', async () => {
      const asc = (
        await list(w.adminA, '?pageSize=100&sort=submittedAt&order=asc')
      ).items.map((r) => r.id);
      const desc = (
        await list(w.adminA, '?pageSize=100&sort=submittedAt&order=desc')
      ).items.map((r) => r.id);
      expect(desc).toEqual([...asc].reverse());
      const byRef = (
        await list(w.adminA, '?pageSize=100&sort=referenceNumber&order=asc')
      ).items.map((r) => r.referenceNumber);
      expect(byRef).toEqual([...byRef].sort());
      const byUpdated = await list(
        w.adminA,
        '?pageSize=100&sort=updatedAt&order=desc',
      );
      expect(byUpdated.total).toBe(6);
    });

    it('breaks ties by id, so consecutive pages never overlap or skip', async () => {
      const one = (await list(w.adminA, '?pageSize=100')).items.map(
        (r) => r.id,
      );
      const paged = [
        ...(await list(w.adminA, '?page=1&pageSize=3')).items,
        ...(await list(w.adminA, '?page=2&pageSize=3')).items,
      ].map((r) => r.id);
      expect(paged).toEqual(one);
      // Sorting by a column where every row is equal is still a total order.
      const ties = (
        await list(w.adminA, '?pageSize=100&sort=updatedAt&order=asc')
      ).items.map((r) => r.id);
      const tiesPaged = [
        ...(await list(w.adminA, '?page=1&pageSize=4&sort=updatedAt&order=asc'))
          .items,
        ...(await list(w.adminA, '?page=2&pageSize=4&sort=updatedAt&order=asc'))
          .items,
      ].map((r) => r.id);
      expect(tiesPaged).toEqual(ties);
    });

    it.each([
      ['page 0', '?page=0'],
      ['a negative page', '?page=-1'],
      ['a fractional page', '?page=1.5'],
      ['a non-numeric page', '?page=abc'],
      ['pageSize 0', '?pageSize=0'],
      ['pageSize over the maximum', '?pageSize=101'],
      ['an unknown sort field', '?sort=password'],
      ['an unknown order', '?order=sideways'],
    ])('rejects %s', async (_l, query) => {
      const res = await api(w.adminA)
        .get(`/officer/applications${query}`)
        .expect(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  // -------------------------------------------------------------------------
  describe('filtering and search', () => {
    it('filters by scrutiny status and applicant status', async () => {
      expect(
        ids((await list(w.adminA, '?internalState=QUERY_RAISED')).items),
      ).toEqual([idOf('a4')]);
      expect(
        ids((await list(w.adminA, '?internalState=UNDER_SCRUTINY')).items),
      ).toEqual([idOf('a3')]);
      expect(
        ids(
          (await list(w.adminA, '?internalState=RECOMMENDED_FOR_APPROVAL'))
            .items,
        ),
      ).toEqual([idOf('a5')]);
      expect(
        ids((await list(w.adminA, '?internalState=SUBMITTED')).items),
      ).toEqual(['a1', 'a2', 'a6'].map(idOf).sort());
      expect(
        ids((await list(w.adminA, '?applicantStatus=AWAITING_DECISION')).items),
      ).toEqual([idOf('a5')]);
      expect((await list(w.adminA, '?internalState=APPROVED')).total).toBe(0);
    });

    it('filters by assignment: unassigned, or a given officer', async () => {
      expect(ids((await list(w.adminA, '?unassigned=true')).items)).toEqual([
        idOf('a1'),
      ]);
      expect(
        ids((await list(w.adminA, '?unassigned=false')).items),
      ).toHaveLength(6);
      expect(
        ids(
          (await list(w.adminA, `?assignedOfficerId=${w.soA2.user.id}`)).items,
        ),
      ).toEqual(['a5', 'a6'].map(idOf).sort());
      expect(
        (await list(w.adminA, `?assignedOfficerId=${randomUUID()}`)).total,
      ).toBe(0);
      // A Scrutiny Officer can not widen their view by naming someone else.
      expect(
        (await list(w.soA1, `?assignedOfficerId=${w.soA2.user.id}`)).total,
      ).toBe(0);
    });

    it('filters by approval type, enterprise and project', async () => {
      expect(
        ids((await list(w.adminA, `?approvalTypeId=${approvalA2}`)).items),
      ).toEqual([idOf('a6')]);
      expect(
        (await list(w.adminA, `?approvalTypeId=${w.approvalB}`)).total,
      ).toBe(0); // another department's approval
      expect(
        (await list(w.adminA, `?enterpriseId=${w.enterpriseId}`)).total,
      ).toBe(6);
      expect(
        (await list(w.adminA, `?enterpriseId=${w.enterprise2Id}`)).total,
      ).toBe(0);
      expect(
        ids((await list(w.adminA, `?projectId=${apps.a3.projectId}`)).items),
      ).toEqual([idOf('a3')]);
    });

    it('searches by application reference, project name and enterprise name (case-insensitive substring)', async () => {
      expect(
        ids(
          (
            await list(
              w.adminA,
              `?q=${encodeURIComponent(apps.a3.referenceNumber)}`,
            )
          ).items,
        ),
      ).toEqual([idOf('a3')]);
      expect(
        ids(
          (await list(w.adminA, `?q=${apps.a3.referenceNumber.toLowerCase()}`))
            .items,
        ),
      ).toEqual([idOf('a3')]);
      expect(ids((await list(w.adminA, '?q=WSQ-A4')).items)).toEqual([
        idOf('a4'),
      ]); // project name
      expect((await list(w.adminA, '?q=ws-ent')).total).toBe(6); // enterprise name
      expect((await list(w.adminA, '?q=no-such-thing-anywhere')).total).toBe(0);
      // Search stays inside the caller's scope.
      expect((await list(w.soA1, '?q=wsq-a5')).total).toBe(0);
      expect(ids((await list(w.adminB, '?q=wsq')).items)).toEqual([idOf('b1')]);
    });

    it('treats search text as data, never as a query (wildcards and SQL fragments match nothing extra)', async () => {
      for (const q of [
        "'; DROP TABLE approval_applications; --",
        '%',
        '_',
        '\\',
        '" OR 1=1 --',
        '{"$ne":null}',
      ]) {
        const res = await api(w.adminA).get(
          `/officer/applications?q=${encodeURIComponent(q)}`,
        );
        expect(res.status).toBe(200);
        expect(res.body.total).toBeLessThanOrEqual(6);
      }
      expect(
        await ctx.prisma.approvalApplication.count({
          where: { id: idOf('a1') },
        }),
      ).toBe(1);
      const wild = await list(w.adminA, `?q=${encodeURIComponent('%')}`);
      // '%' is a literal to the search, not "everything".
      expect(wild.total).toBe(0);
    });

    it('filters by submission date range (inclusive, UTC)', async () => {
      const today = new Date().toISOString().slice(0, 10);
      expect(
        (await list(w.adminA, `?submittedFrom=${today}&submittedTo=${today}`))
          .total,
      ).toBe(6);
      expect((await list(w.adminA, '?submittedTo=2020-01-01')).total).toBe(0);
      expect((await list(w.adminA, '?submittedFrom=2999-01-01')).total).toBe(0);
    });

    it.each([
      ['an impossible date', '?submittedFrom=2026-02-30'],
      ['a malformed date', '?submittedTo=01-02-2026'],
      ['DRAFT as a status', '?internalState=DRAFT'],
      ['an unknown status', '?internalState=PENDING'],
      ['an unknown applicant status', '?applicantStatus=MAYBE'],
      ['a non-uuid id', '?approvalTypeId=x'],
      ['a non-boolean flag', '?unassigned=maybe'],
      ['an over-long search', `?q=${'x'.repeat(101)}`],
      ['an unknown filter (no raw query language)', '?where=1=1'],
      ['an unknown filter field', '?formData=anything'],
    ])('rejects %s', async (_l, query) => {
      const res = await api(w.adminA)
        .get(`/officer/applications${query}`)
        .expect(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('a department id can only NARROW the caller’s own scope', async () => {
      expect((await list(w.adminA, `?departmentId=${w.deptA.id}`)).total).toBe(
        6,
      );
      expect((await list(w.adminA, `?departmentId=${w.deptB.id}`)).total).toBe(
        0,
      );
      expect(
        (await list(w.adminA, `?departmentId=${randomUUID()}`)).total,
      ).toBe(0);
      expect((await list(w.soA1, `?departmentId=${w.deptB.id}`)).total).toBe(0);
      expect((await list(w.soB, `?departmentId=${w.deptA.id}`)).total).toBe(0);
      // A header naming a department is ignored.
      const res = await api(w.adminB)
        .get('/officer/applications')
        .set('x-department-id', w.deptA.id)
        .expect(200);
      expect(ids(res.body.items)).toEqual([idOf('b1')]);
    });
  });

  // -------------------------------------------------------------------------
  describe('the dashboard', () => {
    it('counts the caller’s own scope', async () => {
      const admin = (await api(w.adminA).get('/officer/dashboard').expect(200))
        .body;
      expect(admin).toMatchObject({
        byState: {
          SUBMITTED: 3,
          UNDER_SCRUTINY: 1,
          QUERY_RAISED: 1,
          RECOMMENDED_FOR_APPROVAL: 1,
        },
        unassigned: 1,
        awaitingApplicant: 1,
        awaitingDecision: 1,
        assignedToMe: 0,
      });
      expect(admin.roles).toEqual([
        { role: 'DEPT_ADMIN', departmentId: w.deptA.id },
      ]);

      const so1 = (await api(w.soA1).get('/officer/dashboard').expect(200))
        .body;
      expect(so1).toMatchObject({
        assignedToMe: 3,
        unassigned: 0,
        awaitingApplicant: 1,
        awaitingDecision: 0,
      });
      expect(so1.byState).toEqual({
        SUBMITTED: 1,
        UNDER_SCRUTINY: 1,
        QUERY_RAISED: 1,
      });

      const aa = (await api(w.aaA).get('/officer/dashboard').expect(200)).body;
      expect(aa).toMatchObject({
        awaitingDecision: 1,
        assignedToMe: 0,
        unassigned: 0,
      });
      expect(aa.byState).toEqual({ RECOMMENDED_FOR_APPROVAL: 1 });

      const b = (await api(w.adminB).get('/officer/dashboard').expect(200))
        .body;
      expect(b.byState).toEqual({ SUBMITTED: 1 });
    });

    it('is refused to every non-officer role', async () => {
      for (const actor of [w.inspectorA, w.sysAdmin, w.leadership, w.owner]) {
        await api(actor).get('/officer/dashboard').expect(403);
      }
    });
  });

  // -------------------------------------------------------------------------
  describe('assignment', () => {
    it('assigns an unassigned application to a Scrutiny Officer of its department', async () => {
      const s = await ctx.submittedApplication(
        w.owner.accessToken,
        w.enterpriseId,
        w.approvalA,
        'wsq-assign',
      );
      const res = await assign(s.applicationId, w.soA1).expect(201);
      expect(res.body).toMatchObject({
        applicationId: s.applicationId,
        officerUserId: w.soA1.user.id,
        assignedByUserId: w.adminA.user.id,
      });
      expect(res.body.assignedAt).toEqual(expect.any(String));
      const row = await ctx.prisma.applicationAssignment.findUniqueOrThrow({
        where: { id: res.body.id },
      });
      expect(row).toMatchObject({
        departmentId: w.deptA.id,
        officerUserId: w.soA1.user.id,
        endedAt: null,
        endedByUserId: null,
      });

      // The officer now sees it; before, they did not.
      await api(w.soA1).get(appPath(s.applicationId)).expect(200);
      const detail = await api(w.adminA)
        .get(appPath(s.applicationId))
        .expect(200);
      expect(detail.body.assignedOfficer).toMatchObject({
        userId: w.soA1.user.id,
      });
      expect(detail.body.assignmentHistory).toHaveLength(1);
      expect(detail.body.assignmentHistory[0]).toMatchObject({
        officerUserId: w.soA1.user.id,
        assignedByUserId: w.adminA.user.id,
        endedAt: null,
      });
      // Assignment moves no workflow state.
      expect((await dbApp(s.applicationId)).internalState).toBe('SUBMITTED');

      const audit = (
        await ctx.prisma.auditLog.findMany({
          where: { entityId: s.applicationId, action: 'APPLICATION_ASSIGNED' },
        })
      )[0];
      expect(audit).toMatchObject({
        userId: w.adminA.user.id,
        roleAtTime: 'DEPT_ADMIN',
      });
      expect(audit.afterState).toMatchObject({
        assignedOfficerUserId: w.soA1.user.id,
        departmentId: w.deptA.id,
        enterpriseId: w.enterpriseId,
        projectId: s.projectId,
        assignmentId: res.body.id,
      });
      expect(audit.ruleVersionUsed).toMatch(/@v1$/);
    });

    it('an application can remain unassigned; nothing assigns it automatically', async () => {
      const s = await ctx.submittedApplication(
        w.owner.accessToken,
        w.enterpriseId,
        w.approvalA,
        'wsq-unassigned',
      );
      expect(
        await ctx.prisma.applicationAssignment.count({
          where: { applicationId: s.applicationId },
        }),
      ).toBe(0);
      // No scrutiny officer can see or start it.
      await api(w.soA1).get(appPath(s.applicationId)).expect(404);
      await api(w.soA1)
        .post(`${appPath(s.applicationId)}/start-scrutiny`)
        .expect(404);
      // The administrator sees it as unassigned.
      const detail = await api(w.adminA)
        .get(appPath(s.applicationId))
        .expect(200);
      expect(detail.body.assignedOfficer).toBeNull();
    });

    it.each([
      ['a user who does not exist', () => randomUUID()],
      ['an applicant with no officer role', () => w.owner.user.id],
      ['a Scrutiny Officer of ANOTHER department', () => w.soB.user.id],
      ['an Approving Authority (not a Scrutiny Officer)', () => w.aaA.user.id],
      ['an inspector', () => w.inspectorA.user.id],
      ['the administrator themselves', () => w.adminA.user.id],
    ])('refuses to assign %s and creates nothing', async (_l, target) => {
      const s = await ctx.submittedApplication(
        w.owner.accessToken,
        w.enterpriseId,
        w.approvalA,
        'wsq-badassignee',
      );
      const res = await api(w.adminA)
        .post(`${appPath(s.applicationId)}/assignment`)
        .send({ officerUserId: target() })
        .expect(422);
      expect(res.body.error.code).toBe('INVALID_ASSIGNEE');
      expect(
        await ctx.prisma.applicationAssignment.count({
          where: { applicationId: s.applicationId },
        }),
      ).toBe(0);
    });

    it('refuses a deactivated officer', async () => {
      const gone = await ctx.officerSession(
        'ws-gone',
        'SCRUTINY_OFFICER',
        w.deptA.id,
      );
      await ctx.prisma.user.update({
        where: { id: gone.user.id },
        data: { isActive: false },
      });
      const s = await ctx.submittedApplication(
        w.owner.accessToken,
        w.enterpriseId,
        w.approvalA,
        'wsq-inactive',
      );
      const res = await assign(s.applicationId, gone).expect(422);
      expect(res.body.error.code).toBe('INVALID_ASSIGNEE');
    });

    it.each([
      ['no assignee', {}],
      ['a non-uuid assignee', { officerUserId: 'x' }],
      [
        'a smuggled department',
        { officerUserId: randomUUID(), departmentId: randomUUID() },
      ],
      [
        'a smuggled assigner',
        { officerUserId: randomUUID(), assignedByUserId: randomUUID() },
      ],
      [
        'a smuggled state',
        { officerUserId: randomUUID(), internalState: 'APPROVED' },
      ],
    ])('rejects %s', async (_l, body) => {
      const res = await api(w.adminA)
        .post(`${appPath(idOf('a1'))}/assignment`)
        .send(body)
        .expect(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('an already-assigned application must be reassigned, not assigned again', async () => {
      const res = await assign(idOf('a2'), w.soA2).expect(409);
      expect(res.body.error.code).toBe('ALREADY_ASSIGNED');
      expect(
        (
          await api(w.adminA)
            .get(appPath(idOf('a2')))
            .expect(200)
        ).body.assignedOfficer.userId,
      ).toBe(w.soA1.user.id);
    });

    it('reassigns with a reason, keeps the history, and moves access with it', async () => {
      const s = await ctx.submittedApplication(
        w.owner.accessToken,
        w.enterpriseId,
        w.approvalA,
        'wsq-reassign',
      );
      const first = await assign(s.applicationId, w.soA1).expect(201);
      await api(w.soA1)
        .post(`${appPath(s.applicationId)}/start-scrutiny`)
        .expect(200);
      await api(w.soA1)
        .post(`${appPath(s.applicationId)}/observations`)
        .send({ body: 'from officer one' })
        .expect(201);

      const moved = await api(w.adminA)
        .put(`${appPath(s.applicationId)}/assignment`)
        .send({
          officerUserId: w.soA2.user.id,
          reason: 'Officer one is on leave.',
        })
        .expect(200);
      expect(moved.body).toMatchObject({
        officerUserId: w.soA2.user.id,
        assignedByUserId: w.adminA.user.id,
      });

      const history = await ctx.prisma.applicationAssignment.findMany({
        where: { applicationId: s.applicationId },
        orderBy: { assignedAt: 'asc' },
      });
      expect(history).toHaveLength(2);
      expect(history[0]).toMatchObject({
        id: first.body.id,
        officerUserId: w.soA1.user.id,
        endedByUserId: w.adminA.user.id,
        endReason: 'Officer one is on leave.',
      });
      expect(history[0].endedAt).not.toBeNull();
      expect(history[1]).toMatchObject({
        id: moved.body.id,
        officerUserId: w.soA2.user.id,
        endedAt: null,
      });

      // Access moved: the old officer loses sight of it, the new one gains it (with the record so far).
      await api(w.soA1).get(appPath(s.applicationId)).expect(404);
      await api(w.soA1)
        .post(`${appPath(s.applicationId)}/observations`)
        .send({ body: 'still mine?' })
        .expect(404);
      const asNew = await api(w.soA2).get(appPath(s.applicationId)).expect(200);
      expect(
        asNew.body.observations.map((o: { body: string }) => o.body),
      ).toEqual(['from officer one']);
      expect(asNew.body.assignmentHistory).toBeNull(); // administrators only
      await api(w.soA2)
        .post(`${appPath(s.applicationId)}/observations`)
        .send({ body: 'from officer two' })
        .expect(201);

      const audit = await ctx.prisma.auditLog.findFirstOrThrow({
        where: { entityId: s.applicationId, action: 'APPLICATION_REASSIGNED' },
      });
      expect(audit.beforeState).toMatchObject({
        assignedOfficerUserId: w.soA1.user.id,
      });
      expect(audit.afterState).toMatchObject({
        assignedOfficerUserId: w.soA2.user.id,
        reason: 'Officer one is on leave.',
        departmentId: w.deptA.id,
      });
      expect(audit).toMatchObject({
        userId: w.adminA.user.id,
        roleAtTime: 'DEPT_ADMIN',
      });
    });

    it('reassignment needs a reason, an existing assignment and a different officer', async () => {
      const s = await ctx.submittedApplication(
        w.owner.accessToken,
        w.enterpriseId,
        w.approvalA,
        'wsq-reassign-rules',
      );
      const put = (body: Record<string, unknown>) =>
        api(w.adminA)
          .put(`${appPath(s.applicationId)}/assignment`)
          .send(body);
      const notAssigned = await put({
        officerUserId: w.soA2.user.id,
        reason: 'no one holds it',
      }).expect(409);
      expect(notAssigned.body.error.code).toBe('NOT_ASSIGNED');
      await assign(s.applicationId, w.soA1).expect(201);
      await put({ officerUserId: w.soA2.user.id }).expect(400);
      await put({ officerUserId: w.soA2.user.id, reason: '' }).expect(400);
      await put({ officerUserId: w.soA2.user.id, reason: 'x' }).expect(400);
      const same = await put({
        officerUserId: w.soA1.user.id,
        reason: 'the same officer again',
      }).expect(422);
      expect(same.body.error.code).toBe('INVALID_ASSIGNEE');
      const wrongDept = await put({
        officerUserId: w.soB.user.id,
        reason: 'another department',
      }).expect(422);
      expect(wrongDept.body.error.code).toBe('INVALID_ASSIGNEE');
      expect(
        await ctx.prisma.applicationAssignment.count({
          where: { applicationId: s.applicationId, endedAt: null },
        }),
      ).toBe(1);
      expect(
        (
          await ctx.prisma.applicationAssignment.findFirstOrThrow({
            where: { applicationId: s.applicationId, endedAt: null },
          })
        ).officerUserId,
      ).toBe(w.soA1.user.id);
    });

    it('cannot be (re)assigned once scrutiny has finished', async () => {
      const done = await assign(idOf('a5'), w.soA1).expect(409);
      expect(done.body.error.code).toBe('INVALID_STATE_TRANSITION');
      const moved = await api(w.adminA)
        .put(`${appPath(idOf('a5'))}/assignment`)
        .send({ officerUserId: w.soA1.user.id, reason: 'after recommendation' })
        .expect(409);
      expect(moved.body.error.code).toBe('INVALID_STATE_TRANSITION');
      expect(
        (
          await ctx.prisma.applicationAssignment.findFirstOrThrow({
            where: { applicationId: idOf('a5'), endedAt: null },
          })
        ).officerUserId,
      ).toBe(w.soA2.user.id);
    });

    it('two simultaneous assignments: exactly one wins, whoever they name', async () => {
      const s = await ctx.submittedApplication(
        w.owner.accessToken,
        w.enterpriseId,
        w.approvalA,
        'wsq-race',
      );
      const results = await Promise.all([
        assign(s.applicationId, w.soA1),
        assign(s.applicationId, w.soA2),
        assign(s.applicationId, w.soA1),
        assign(s.applicationId, w.soA2),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409, 409]);
      for (const r of results.filter((x) => x.status === 409)) {
        expect(r.body.error.code).toBe('ALREADY_ASSIGNED');
      }
      expect(
        await ctx.prisma.applicationAssignment.count({
          where: { applicationId: s.applicationId },
        }),
      ).toBe(1);
      const audits = await ctx.prisma.auditLog.count({
        where: { entityId: s.applicationId, action: 'APPLICATION_ASSIGNED' },
      });
      expect(audits).toBe(1);
    });

    it('simultaneous reassignments leave exactly one active assignment and a complete history', async () => {
      const s = await ctx.submittedApplication(
        w.owner.accessToken,
        w.enterpriseId,
        w.approvalA,
        'wsq-rerace',
      );
      await assign(s.applicationId, w.soA1).expect(201);
      const results = await Promise.all(
        [w.soA2, w.soA2, w.soA2].map((officer, i) =>
          api(w.adminA)
            .put(`${appPath(s.applicationId)}/assignment`)
            .send({ officerUserId: officer.user.id, reason: `move ${i}` }),
        ),
      );
      // Serialised: the first moves it to soA2, the rest find it already there.
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      for (const r of results.filter((x) => x.status !== 200)) {
        expect([422, 409]).toContain(r.status);
      }
      const rows = await ctx.prisma.applicationAssignment.findMany({
        where: { applicationId: s.applicationId },
      });
      expect(rows.filter((r) => r.endedAt === null)).toHaveLength(1);
      expect(rows).toHaveLength(2);
    });

    it('a reassignment racing scrutiny: the outgoing officer’s late action is refused, never applied', async () => {
      const s = await ctx.submittedApplication(
        w.owner.accessToken,
        w.enterpriseId,
        w.approvalA,
        'wsq-handover',
      );
      await assign(s.applicationId, w.soA1).expect(201);
      const results = await Promise.all([
        api(w.soA1).post(`${appPath(s.applicationId)}/start-scrutiny`),
        api(w.adminA)
          .put(`${appPath(s.applicationId)}/assignment`)
          .send({ officerUserId: w.soA2.user.id, reason: 'handover' }),
      ]);
      const active = await ctx.prisma.applicationAssignment.findFirstOrThrow({
        where: { applicationId: s.applicationId, endedAt: null },
      });
      expect(active.officerUserId).toBe(w.soA2.user.id);
      const started = results[0].status === 200;
      // Either order is coherent: started-then-moved, or refused-then-moved.
      expect((await dbApp(s.applicationId)).internalState).toBe(
        started ? 'UNDER_SCRUTINY' : 'SUBMITTED',
      );
      if (!started) {
        expect(results[0].status).toBe(404);
      }
      // From now on only the new officer can act.
      await api(w.soA1)
        .post(`${appPath(s.applicationId)}/observations`)
        .send({ body: 'x' })
        .expect(404);
    });

    it('is the Department Administrator’s alone: no other role, and no administrator of another department', async () => {
      const s = await ctx.submittedApplication(
        w.owner.accessToken,
        w.enterpriseId,
        w.approvalA,
        'wsq-noassign',
      );
      const body = { officerUserId: w.soA2.user.id };
      // Roles refused outright.
      for (const actor of [w.inspectorA, w.sysAdmin, w.leadership, w.owner]) {
        const res = await api(actor)
          .post(`${appPath(s.applicationId)}/assignment`)
          .send(body)
          .expect(403);
        expect(res.body.error.code).toBe('INSUFFICIENT_ROLE');
      }
      // Officer roles that are not administrators.
      await api(w.soA1)
        .post(`${appPath(s.applicationId)}/assignment`)
        .send(body)
        .expect(403);
      await api(w.aaA)
        .post(`${appPath(s.applicationId)}/assignment`)
        .send(body)
        .expect(403);
      // An administrator of ANOTHER department cannot even see it.
      await api(w.adminB)
        .post(`${appPath(s.applicationId)}/assignment`)
        .send(body)
        .expect(404);
      expect(
        await ctx.prisma.applicationAssignment.count({
          where: { applicationId: s.applicationId },
        }),
      ).toBe(0);
    });

    it('a department’s administrator cannot assign another department’s application (404, not a hint it exists)', async () => {
      const res = await api(w.adminB)
        .post(`${appPath(idOf('a1'))}/assignment`)
        .send({ officerUserId: w.soB.user.id })
        .expect(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('lists the assignable officers of the administrator’s own department, with workload', async () => {
      const res = await api(w.adminA).get('/officer/officers').expect(200);
      const byId = Object.fromEntries(
        res.body.map((o: { userId: string }) => [o.userId, o]),
      );
      expect(Object.keys(byId)).toEqual(
        expect.arrayContaining([w.soA1.user.id, w.soA2.user.id]),
      );
      expect(byId[w.soB.user.id]).toBeUndefined();
      expect(byId[w.aaA.user.id]).toBeUndefined();
      expect(byId[w.soA1.user.id]).toMatchObject({
        departmentId: w.deptA.id,
        openAssignments: expect.any(Number),
      });
      expect(byId[w.soA1.user.id].openAssignments).toBeGreaterThanOrEqual(3);
      const b = await api(w.adminB).get('/officer/officers').expect(200);
      expect(b.body.map((o: { userId: string }) => o.userId)).toEqual([
        w.soB.user.id,
      ]);
      for (const actor of [w.soA1, w.aaA, w.inspectorA, w.owner]) {
        await api(actor).get('/officer/officers').expect(403);
      }
      expect(JSON.stringify(res.body)).not.toMatch(/email|mobile|password/i);
    });
  });

  // -------------------------------------------------------------------------
  describe('enforced by PostgreSQL itself', () => {
    it('at most one active assignment per application, and history is permanent', async () => {
      const s = await ctx.submittedApplication(
        w.owner.accessToken,
        w.enterpriseId,
        w.approvalA,
        'wsq-db',
      );
      const first = await assign(s.applicationId, w.soA1).expect(201);
      await expect(
        ctx.prisma.applicationAssignment.create({
          data: {
            applicationId: s.applicationId,
            departmentId: w.deptA.id,
            officerUserId: w.soA2.user.id,
            assignedByUserId: w.adminA.user.id,
          },
        }),
      ).rejects.toThrow(/one_active|Unique/i);

      // Identity can never change; only ending (once) is allowed.
      for (const data of [
        { officerUserId: w.soA2.user.id },
        { assignedByUserId: w.soA2.user.id },
        { assignedAt: new Date(0) },
        { applicationId: randomUUID() },
      ]) {
        await expect(
          ctx.prisma.applicationAssignment.update({
            where: { id: first.body.id },
            data: data as never,
          }),
        ).rejects.toThrow();
      }
      await expect(
        ctx.prisma.applicationAssignment.update({
          where: { id: first.body.id },
          data: { endedAt: new Date() },
        }),
      ).rejects.toThrow(/end_coherent/);
      await ctx.prisma.applicationAssignment.update({
        where: { id: first.body.id },
        data: {
          endedAt: new Date(),
          endedByUserId: w.adminA.user.id,
          endReason: 'closing',
        },
      });
      await expect(
        ctx.prisma.applicationAssignment.update({
          where: { id: first.body.id },
          data: { endReason: 'rewritten' },
        }),
      ).rejects.toThrow(/permanent/);
    });
  });
});
