import request from 'supertest';
import { API, E2eContext, createE2eContext } from './support/e2e-helpers';
import { activate, recordsOf } from './support/compliance-helpers';
import {
  Actor,
  OfficerWorld,
  as,
  buildOfficerWorld,
} from './support/officer-world';
import { ComplianceSyncService } from '../src/modules/compliance/compliance-sync.service';

jest.setTimeout(600_000);

/**
 * Step 14 - who may READ the compliance calendar, over real HTTP -> Nest ->
 * Prisma -> PostgreSQL. The applicant reads only their own enterprise's
 * obligations (a project-restricted representative only their projects); an
 * officer reads exactly the applications their role can already see (the
 * officer workspace rule); everyone else gets nothing, and nothing anywhere
 * lets a caller set, move or clear an obligation.
 */
describe('Compliance e2e - access and scoping', () => {
  let ctx: E2eContext;
  let w: OfficerWorld;
  let sync: ComplianceSyncService;
  let repFull: Actor;
  let repView: Actor;
  let repP2: Actor; // restricted to project P2
  let P1: string;
  let P2: string;
  let A1: { projectId: string; applicationId: string; recordId: string }; // P1, assigned to soA1
  let A2: { projectId: string; applicationId: string; recordId: string }; // P2, unassigned
  let B1: { projectId: string; applicationId: string; recordId: string }; // department B
  let X: { projectId: string; applicationId: string; recordId: string }; // another enterprise
  const mine = new Set<string>();

  const api = (a: { accessToken: string }) => as(ctx, a.accessToken);
  const errorCode = (res: { body: { error?: { code?: string } } }) =>
    res.body.error?.code;
  const run = () => sync.run(new Date(), { applicationIds: [...mine] });
  const appBase = (
    s: { projectId: string; applicationId: string },
    enterpriseId = w.enterpriseId,
  ) =>
    `/enterprises/${enterpriseId}/projects/${s.projectId}/applications/${s.applicationId}`;
  const officerApp = (id: string) => `/officer/applications/${id}`;

  const grant = async (
    rep: Actor,
    scope: string,
    extra: Record<string, unknown> = {},
  ) => {
    const res = await api(w.owner)
      .post(`/enterprises/${w.enterpriseId}/representatives`)
      .send({ emailOrMobile: rep.user.email, scope, ...extra })
      .expect(201);
    await api(rep)
      .post(`/representative-authorisations/${res.body.id}/accept`)
      .expect(200);
  };

  /** ACTIVE application with its occurrence. */
  const build = async (
    token: string,
    enterpriseId: string,
    approvalTypeId: string,
    tag: string,
    projectId?: string,
  ) => {
    const s = await ctx.submittedApplication(
      token,
      enterpriseId,
      approvalTypeId,
      `ca-${tag}`,
      projectId ? { projectId } : {},
    );
    mine.add(s.applicationId);
    return s;
  };

  beforeAll(async () => {
    ctx = await createE2eContext();
    w = await buildOfficerWorld(ctx, 'ca');
    sync = ctx.app.get(ComplianceSyncService);
    [repFull, repView, repP2] = await Promise.all(
      ['full', 'view', 'p2'].map((t) => ctx.applicantSession(`ca-rep-${t}`)),
    );
    P1 = (
      await ctx.createProjectVia(w.owner.accessToken, w.enterpriseId, 'ca-p1')
    ).id;
    P2 = (
      await ctx.createProjectVia(w.owner.accessToken, w.enterpriseId, 'ca-p2')
    ).id;
    await grant(repFull, 'FULL');
    await grant(repView, 'VIEW_ONLY');
    await grant(repP2, 'PREPARE_SUBMIT', { projectIds: [P2] });

    // Department A's approval, and department B's, each with one obligation.
    const typeA = (
      await ctx.createStartableApproval(w.owner.user.id, 'ca-a', {
        departmentId: w.deptA.id,
      })
    ).approvalTypeId;
    await api(w.adminA)
      .post('/admin/compliance/requirements')
      .send({
        approvalTypeId: typeA,
        description: 'Department A obligation',
        frequency: 'ONE_TIME',
        firstDueAfterDays: 10,
      })
      .expect(201);
    const typeB = (
      await ctx.createStartableApproval(w.owner.user.id, 'ca-b', {
        departmentId: w.deptB.id,
      })
    ).approvalTypeId;
    await api(w.adminB)
      .post('/admin/compliance/requirements')
      .send({
        approvalTypeId: typeB,
        description: 'Department B obligation',
        frequency: 'ONE_TIME',
        firstDueAfterDays: 20,
      })
      .expect(201);

    const a1 = await build(
      w.owner.accessToken,
      w.enterpriseId,
      typeA,
      'a1',
      P1,
    );
    await api(w.adminA)
      .post(`${officerApp(a1.applicationId)}/assignment`)
      .send({ officerUserId: w.soA1.user.id })
      .expect(201);
    const a2 = await build(
      w.owner.accessToken,
      w.enterpriseId,
      typeA,
      'a2',
      P2,
    );
    const b1 = await build(w.owner.accessToken, w.enterpriseId, typeB, 'b1');
    const x = await build(w.owner2.accessToken, w.enterprise2Id, typeA, 'x');
    for (const s of [a1, a2, b1, x]) {
      await activate(ctx.prisma, s.applicationId);
    }
    await run();
    const rec = async (s: { applicationId: string }) =>
      (await recordsOf(ctx.prisma, s.applicationId))[0].id;
    A1 = { ...a1, recordId: await rec(a1) };
    A2 = { ...a2, recordId: await rec(a2) };
    B1 = { ...b1, recordId: await rec(b1) };
    X = { ...x, recordId: await rec(x) };
  });

  afterAll(async () => {
    await ctx.cleanup();
    await ctx.app.close();
  });

  // -------------------------------------------------------------------------
  describe('the applicant side', () => {
    it('the owner reads their own application’s obligations with everything FRD 27.1 lists', async () => {
      const res = await api(w.owner)
        .get(`${appBase(A1)}/compliance`)
        .expect(200);
      expect(res.body.applicationId).toBe(A1.applicationId);
      expect(res.body.note).toBeNull();
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0]).toMatchObject({
        id: A1.recordId,
        description: 'Department A obligation',
        frequency: 'ONE_TIME',
        status: 'UPCOMING',
        occurrenceNumber: 1,
        evidenceRequired: false,
        evidence: null,
      });
      expect(Object.keys(res.body.items[0]).sort()).toEqual(
        [
          'id',
          'applicationId',
          'occurrenceNumber',
          'description',
          'frequency',
          'applicantAction',
          'sourceReference',
          'requirementVersion',
          'dueDate',
          'dueDateMessage',
          'status',
          'evidenceRequired',
          'fulfilledAt',
          'fulfilledLate',
          'evidence',
          'createdAt',
        ].sort(),
      );
      const one = await api(w.owner)
        .get(`${appBase(A1)}/compliance/${A1.recordId}`)
        .expect(200);
      expect(one.body.id).toBe(A1.recordId);
    });

    it('the enterprise list covers every project, earliest due date first, with paging and a status filter', async () => {
      const all = await api(w.owner)
        .get(`/enterprises/${w.enterpriseId}/compliance`)
        .expect(200);
      const ids = all.body.items.map((i: { id: string }) => i.id);
      expect(ids).toEqual(
        expect.arrayContaining([A1.recordId, A2.recordId, B1.recordId]),
      );
      expect(ids).not.toContain(X.recordId);
      const dues = all.body.items.map(
        (i: { dueDate: string | null }) => i.dueDate,
      );
      expect([...dues].sort()).toEqual(dues); // earliest first
      const page = await api(w.owner)
        .get(`/enterprises/${w.enterpriseId}/compliance?pageSize=1&page=2`)
        .expect(200);
      expect(page.body).toMatchObject({
        page: 2,
        pageSize: 1,
        total: all.body.total,
      });
      expect(page.body.items).toHaveLength(1);
      const overdue = await api(w.owner)
        .get(`/enterprises/${w.enterpriseId}/compliance?status=OVERDUE`)
        .expect(200);
      expect(overdue.body.items).toEqual([]);
      for (const q of ['status=LATE', 'pageSize=0', 'pageSize=101', 'page=0']) {
        await api(w.owner)
          .get(`/enterprises/${w.enterpriseId}/compliance?${q}`)
          .expect(400);
      }
    });

    it('a full or view-only representative reads everything; one restricted to a project reads only that project’s', async () => {
      for (const rep of [repFull, repView]) {
        const res = await api(rep)
          .get(`/enterprises/${w.enterpriseId}/compliance`)
          .expect(200);
        expect(res.body.items.map((i: { id: string }) => i.id)).toEqual(
          expect.arrayContaining([A1.recordId, A2.recordId]),
        );
        await api(rep)
          .get(`${appBase(A1)}/compliance`)
          .expect(200);
      }
      const restricted = await api(repP2)
        .get(`/enterprises/${w.enterpriseId}/compliance`)
        .expect(200);
      const ids = restricted.body.items.map((i: { id: string }) => i.id);
      expect(ids).toContain(A2.recordId);
      expect(ids).not.toContain(A1.recordId);
      expect(ids).not.toContain(B1.recordId);
      const denied = await api(repP2).get(`${appBase(A1)}/compliance`);
      expect([403, 404]).toContain(denied.status);
      expect(denied.body).not.toHaveProperty('items');
      const deniedOne = await api(repP2).get(
        `${appBase(A1)}/compliance/${A1.recordId}`,
      );
      expect([403, 404]).toContain(deniedOne.status);
      await api(repP2)
        .get(`${appBase(A2)}/compliance`)
        .expect(200);
    });

    it('another enterprise’s applicant sees none of it, whichever enterprise they name', async () => {
      const own = await api(w.owner2)
        .get(`/enterprises/${w.enterprise2Id}/compliance`)
        .expect(200);
      const ids = own.body.items.map((i: { id: string }) => i.id);
      expect(ids).toEqual([X.recordId]);
      // Their own enterprise, someone else's project / application / record.
      for (const path of [
        `/enterprises/${w.enterprise2Id}/projects/${A1.projectId}/applications/${A1.applicationId}/compliance`,
        `/enterprises/${w.enterprise2Id}/projects/${A1.projectId}/applications/${A1.applicationId}/compliance/${A1.recordId}`,
      ]) {
        const res = await api(w.owner2).get(path).expect(404);
        expect(errorCode(res)).toBe('NOT_FOUND');
      }
      // The owner's enterprise: no live relationship at all.
      for (const path of [
        `/enterprises/${w.enterpriseId}/compliance`,
        `${appBase(A1)}/compliance`,
        `${appBase(A1)}/compliance/${A1.recordId}`,
      ]) {
        const res = await api(w.owner2).get(path);
        expect([403, 404]).toContain(res.status);
        expect(res.body).not.toHaveProperty('items');
      }
      // And the owner cannot reach theirs.
      await api(w.owner)
        .get(`${appBase(X, w.enterprise2Id)}/compliance`)
        .expect(404);
    });

    it('a record is found only under its own application, and a malformed id is refused', async () => {
      await api(w.owner)
        .get(`${appBase(A1)}/compliance/${A2.recordId}`)
        .expect(404);
      await api(w.owner)
        .get(`${appBase(A1)}/compliance/not-a-uuid`)
        .expect(400);
    });

    it('officer and platform roles are refused on the applicant routes, and no session is 401', async () => {
      for (const actor of [
        w.soA1,
        w.adminA,
        w.aaA,
        w.sysAdmin,
        w.leadership,
        w.inspectorA,
      ]) {
        const res = await api(actor).get(`${appBase(A1)}/compliance`);
        expect([403, 404]).toContain(res.status);
        expect(res.body).not.toHaveProperty('items');
        expect([403, 404]).toContain(
          (await api(actor).get(`/enterprises/${w.enterpriseId}/compliance`))
            .status,
        );
      }
      await request(ctx.http)
        .get(`${API}${appBase(A1)}/compliance`)
        .expect(401);
      await request(ctx.http)
        .get(`${API}/enterprises/${w.enterpriseId}/compliance`)
        .expect(401);
    });
  });

  // -------------------------------------------------------------------------
  describe('the officer side', () => {
    const ids = async (actor: Actor, query = '') =>
      (
        (await api(actor).get(`/officer/compliance${query}`).expect(200)).body
          .items as Array<{
          id: string;
        }>
      ).map((i) => i.id);

    it('the assigned Scrutiny Officer reads their application’s obligations and only theirs', async () => {
      const mineList = await ids(w.soA1);
      expect(mineList).toContain(A1.recordId);
      expect(mineList).not.toContain(A2.recordId); // unassigned
      expect(mineList).not.toContain(B1.recordId);
      expect(mineList).not.toContain(X.recordId);
      const one = await api(w.soA1)
        .get(`${officerApp(A1.applicationId)}/compliance`)
        .expect(200);
      expect(one.body).toMatchObject({ applicationId: A1.applicationId });
      expect(one.body.applicationReference).toMatch(/^APP-/);
      expect(one.body.items.map((i: { id: string }) => i.id)).toEqual([
        A1.recordId,
      ]);
    });

    it('the Department Administrator reads the department’s, with the application and approval named, and no other department’s', async () => {
      const res = await api(w.adminA).get('/officer/compliance').expect(200);
      const list = res.body.items as Array<{
        id: string;
        applicationReference: string;
        approvalType: string;
        departmentId: string;
      }>;
      const listed = list.map((i) => i.id);
      expect(listed).toEqual(
        expect.arrayContaining([A1.recordId, A2.recordId, X.recordId]),
      );
      expect(listed).not.toContain(B1.recordId);
      expect(list.every((i) => i.departmentId === w.deptA.id)).toBe(true);
      expect(list[0].applicationReference).toMatch(/^APP-/);
      // Department B's administrator sees B's, and none of A's.
      const b = await ids(w.adminB);
      expect(b).toContain(B1.recordId);
      expect(b).not.toContain(A1.recordId);
      expect(b).not.toContain(A2.recordId);
    });

    it('an unassigned officer, another department’s staff and an Approving Authority without a decision pending see nothing of it', async () => {
      for (const actor of [w.soA2, w.soB, w.aaA]) {
        const list = await ids(actor);
        expect(list).not.toContain(A1.recordId);
        const res = await api(actor)
          .get(`${officerApp(A1.applicationId)}/compliance`)
          .expect(404);
        expect(errorCode(res)).toBe('NOT_FOUND');
      }
      for (const path of [
        `${officerApp(B1.applicationId)}/compliance`,
        `${officerApp(A2.applicationId)}/compliance`,
      ]) {
        // soA1 has neither B's application nor the unassigned A2.
        await api(w.soA1).get(path).expect(404);
      }
      await api(w.adminB)
        .get(`${officerApp(A1.applicationId)}/compliance`)
        .expect(404);
      await api(w.adminA)
        .get(`${officerApp(B1.applicationId)}/compliance`)
        .expect(404);
    });

    it('filters by status and validates paging; the applicant’s own data never appears under another department', async () => {
      expect(await ids(w.adminA, '?status=OVERDUE')).not.toContain(A1.recordId);
      expect(await ids(w.adminA, '?status=UPCOMING')).toContain(A1.recordId);
      for (const q of ['status=LATE', 'pageSize=0', 'pageSize=101', 'page=0']) {
        await api(w.adminA).get(`/officer/compliance?${q}`).expect(400);
      }
    });

    it('roles outside the officer chain are refused, and no session is 401', async () => {
      for (const actor of [
        w.owner,
        w.owner2,
        w.inspectorA,
        w.sysAdmin,
        w.leadership,
      ]) {
        const res = await api(actor).get('/officer/compliance').expect(403);
        expect(errorCode(res)).toBe('INSUFFICIENT_ROLE');
        await api(actor)
          .get(`${officerApp(A1.applicationId)}/compliance`)
          .expect(403);
      }
      await request(ctx.http).get(`${API}/officer/compliance`).expect(401);
    });

    it('no route lets an officer, an administrator or an applicant set, move, re-date or clear an obligation', async () => {
      const paths = [
        `${officerApp(A1.applicationId)}/compliance`,
        `${officerApp(A1.applicationId)}/compliance/${A1.recordId}`,
        `${appBase(A1)}/compliance/${A1.recordId}`,
        '/officer/compliance',
      ];
      const body = { status: 'FULFILLED', dueDate: '2099-01-01' };
      for (const actor of [w.owner, w.soA1, w.adminA, w.sysAdmin]) {
        for (const path of paths) {
          for (const verb of ['post', 'put', 'patch', 'del'] as const) {
            expect((await api(actor)[verb](path).send(body)).status).toBe(404);
          }
        }
      }
      const rec = await ctx.prisma.complianceRecord.findUniqueOrThrow({
        where: { id: A1.recordId },
      });
      expect(rec.status).toBe('UPCOMING');
      expect(rec.dueDate?.toISOString().slice(0, 10)).toBeTruthy();
    });
  });

  // -------------------------------------------------------------------------
  describe('notifications follow the same recipients', () => {
    it('a due obligation reaches the owner and live representatives of its project - not a representative of another project, an officer, or another enterprise', async () => {
      await sync.run(new Date(Date.now() + 10 * 86_400_000), {
        applicationIds: [...mine],
      });
      const notices = async (a: Actor, applicationId: string) =>
        (
          (await api(a).get('/notifications?pageSize=100').expect(200)).body
            .items as Array<{
            eventType: string;
            applicationId: string | null;
          }>
        ).filter(
          (n) =>
            n.eventType === 'COMPLIANCE_DEADLINE_APPROACHING' &&
            n.applicationId === applicationId,
        );
      // A1 (project P1, due in 10 days): the owner and unrestricted representatives.
      expect(await notices(w.owner, A1.applicationId)).toHaveLength(1);
      expect(await notices(repFull, A1.applicationId)).toHaveLength(1);
      expect(await notices(repView, A1.applicationId)).toHaveLength(1);
      expect(await notices(repP2, A1.applicationId)).toEqual([]);
      for (const a of [w.soA1, w.adminA, w.owner2]) {
        expect(await notices(a, A1.applicationId)).toEqual([]);
      }
      // A2 (project P2): the restricted representative is told too.
      expect(await notices(repP2, A2.applicationId)).toHaveLength(1);
      // Another enterprise's obligation is theirs alone.
      expect(await notices(w.owner2, X.applicationId)).toHaveLength(1);
      expect(await notices(w.owner, X.applicationId)).toEqual([]);
    });
  });
});
