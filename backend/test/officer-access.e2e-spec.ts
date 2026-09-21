import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { API, E2eContext, createE2eContext } from './support/e2e-helpers';
import { pdfBytes } from './support/document-fixtures';
import {
  Actor,
  OfficerWorld,
  as,
  buildOfficerWorld,
} from './support/officer-world';

jest.setTimeout(600_000);

/**
 * Who may use the officer workspace, on what, and what they can do — across
 * roles, departments and enterprises — plus privilege-escalation and
 * information-leak checks. Real HTTP -> Nest -> Prisma -> PostgreSQL.
 *
 * Layers under test (none of them new): JWT + MFA + RolesGuard (which roles may
 * use the routes at all) and OfficerAccessService (which applications, and
 * which actions, once the department is DERIVED from the application).
 */
describe('Officer access e2e — roles, departments, scoping, escalation', () => {
  let ctx: E2eContext;
  let w: OfficerWorld;

  const api = (a: { accessToken: string }) => as(ctx, a.accessToken);
  const appPath = (id: string) => `/officer/applications/${id}`;
  const dbApp = (id: string) =>
    ctx.prisma.approvalApplication.findUniqueOrThrow({ where: { id } });

  /** An application assigned to soA1 and UNDER_SCRUTINY, with one document. */
  const working = async (tag: string) => {
    const s = await ctx.submittedApplication(
      w.owner.accessToken,
      w.enterpriseId,
      w.approvalA,
      tag,
      {
        beforeSubmit: async ({ projectId, applicationId }) => {
          await ctx
            .uploadDocument(
              w.owner.accessToken,
              w.enterpriseId,
              projectId,
              applicationId,
              pdfBytes(tag),
            )
            .expect(201);
        },
      },
    );
    await api(w.adminA)
      .post(`${appPath(s.applicationId)}/assignment`)
      .send({ officerUserId: w.soA1.user.id })
      .expect(201);
    await api(w.soA1)
      .post(`${appPath(s.applicationId)}/start-scrutiny`)
      .expect(200);
    const [doc] = (
      await api(w.soA1)
        .get(`${appPath(s.applicationId)}/documents`)
        .expect(200)
    ).body;
    return { ...s, documentId: doc.id as string };
  };

  beforeAll(async () => {
    ctx = await createE2eContext();
    w = await buildOfficerWorld(ctx, 'ac');
  });

  afterAll(async () => {
    await ctx.cleanup();
    await ctx.app.close();
  });

  // -------------------------------------------------------------------------
  describe('who can use the officer routes at all (role layer)', () => {
    const routes: Array<
      [string, (a: { accessToken: string }) => request.Test]
    > = [
      ['GET /officer/dashboard', (a) => api(a).get('/officer/dashboard')],
      ['GET /officer/applications', (a) => api(a).get('/officer/applications')],
    ];

    it.each(routes)(
      '%s: officer roles pass, everyone else is INSUFFICIENT_ROLE',
      async (_name, call) => {
        for (const actor of [
          w.soA1,
          w.soA2,
          w.adminA,
          w.aaA,
          w.soB,
          w.adminB,
        ]) {
          expect((await call(actor)).status).toBe(200);
        }
        for (const actor of [
          w.inspectorA,
          w.sysAdmin,
          w.leadership,
          w.owner,
          w.owner2,
        ]) {
          const res = await call(actor);
          expect(res.status).toBe(403);
          expect(res.body.error.code).toBe('INSUFFICIENT_ROLE');
        }
      },
    );

    it('unauthenticated, malformed and wrong-type tokens are 401 on every officer route', async () => {
      const s = await working('unauth');
      const urls = [
        '/officer/dashboard',
        '/officer/applications',
        appPath(s.applicationId),
        `${appPath(s.applicationId)}/history`,
        `${appPath(s.applicationId)}/discovery`,
        `${appPath(s.applicationId)}/documents`,
        `${appPath(s.applicationId)}/documents/${s.documentId}/download`,
      ];
      for (const url of urls) {
        expect((await request(ctx.http).get(`${API}${url}`)).status).toBe(401);
        expect(
          (
            await request(ctx.http)
              .get(`${API}${url}`)
              .set('Authorization', 'Bearer not.a.token')
          ).status,
        ).toBe(401);
      }
      for (const [method, url] of [
        ['post', `${appPath(s.applicationId)}/start-scrutiny`],
        ['post', `${appPath(s.applicationId)}/queries`],
        ['post', `${appPath(s.applicationId)}/recommendation`],
        ['post', `${appPath(s.applicationId)}/assignment`],
        ['put', `${appPath(s.applicationId)}/assignment`],
      ] as const) {
        expect(
          (await request(ctx.http)[method](`${API}${url}`).send({})).status,
        ).toBe(401);
      }
    });

    it('an officer who has not completed MFA cannot use the workspace (Step 4 enforcement applies)', async () => {
      const user = await ctx.registerWithRole(
        'ac-nomfa',
        'SCRUTINY_OFFICER',
        w.deptA.id,
      );
      const login = await ctx.login(user).expect(200);
      expect(login.body.status).toBe('MFA_SETUP_REQUIRED');
      const res = await request(ctx.http)
        .get(`${API}/officer/dashboard`)
        .set('Authorization', `Bearer ${login.body.challengeToken}`);
      expect([401, 403]).toContain(res.status);
    });

    it('a role change takes effect on the very next request, on the same token', async () => {
      const temp = await ctx.officerSession(
        'ac-temp',
        'SCRUTINY_OFFICER',
        w.deptA.id,
      );
      await api(temp).get('/officer/dashboard').expect(200);
      await ctx.prisma.userRole.deleteMany({
        where: { userId: temp.user.id, role: { code: 'SCRUTINY_OFFICER' } },
      });
      const res = await api(temp).get('/officer/dashboard').expect(403);
      expect(res.body.error.code).toBe('INSUFFICIENT_ROLE');
    });
  });

  // -------------------------------------------------------------------------
  describe('who can see which application (department + assignment layer)', () => {
    it.each([
      ['the assigned Scrutiny Officer', () => w.soA1, 200],
      ['another Scrutiny Officer of the same department', () => w.soA2, 404],
      ['the Department Administrator of the department', () => w.adminA, 200],
      [
        'the Approving Authority, while it is not awaiting a decision',
        () => w.aaA,
        404,
      ],
      ['a Scrutiny Officer of another department', () => w.soB, 404],
      [
        'the Department Administrator of another department',
        () => w.adminB,
        404,
      ],
      ['an inspector of the same department', () => w.inspectorA, 403],
      ['a system administrator', () => w.sysAdmin, 403],
      ['a leadership user', () => w.leadership, 403],
      ['the applicant who owns it', () => w.owner, 403],
      ['another enterprise’s applicant', () => w.owner2, 403],
    ])('opening the application: %s -> %i', async (_l, actor, expected) => {
      const s = await working('view');
      const res = await api(actor()).get(appPath(s.applicationId));
      expect(res.status).toBe(expected);
    });

    it('applies the same scoping to discovery, history, documents, versions and downloads', async () => {
      const s = await working('scoping');
      const paths = [
        `${appPath(s.applicationId)}/discovery`,
        `${appPath(s.applicationId)}/history`,
        `${appPath(s.applicationId)}/documents`,
        `${appPath(s.applicationId)}/documents/${s.documentId}`,
        `${appPath(s.applicationId)}/documents/${s.documentId}/versions`,
        `${appPath(s.applicationId)}/documents/${s.documentId}/download`,
      ];
      for (const path of paths) {
        expect((await api(w.soA1).get(path)).status).toBe(200);
        expect((await api(w.adminA).get(path)).status).toBe(200);
        for (const denied of [w.soA2, w.aaA, w.soB, w.adminB]) {
          expect({
            path,
            status: (await api(denied).get(path)).status,
          }).toEqual({ path, status: 404 });
        }
        for (const forbidden of [
          w.inspectorA,
          w.sysAdmin,
          w.leadership,
          w.owner,
        ]) {
          expect({
            path,
            status: (await api(forbidden).get(path)).status,
          }).toEqual({ path, status: 403 });
        }
      }
    });

    it('the Approving Authority gains sight of an application exactly when it is recommended — and only read access', async () => {
      const s = await working('aa');
      await api(w.aaA).get(appPath(s.applicationId)).expect(404);
      await api(w.soA1)
        .post(`${appPath(s.applicationId)}/recommendation`)
        .send({ outcome: 'APPROVE', reason: 'in order' })
        .expect(201);

      const detail = await api(w.aaA).get(appPath(s.applicationId)).expect(200);
      expect(detail.body).toMatchObject({
        internalState: 'RECOMMENDED_FOR_APPROVAL',
        actingRole: 'APPROVING_AUTHORITY',
        // Step 15: the statutory act is the authority's next step (nothing else).
        availableActions: ['DECIDE'],
      });
      expect(detail.body.decision).toBeNull();
      expect(detail.body.recommendations).toHaveLength(1);
      expect(detail.body.recommendations[0]).toMatchObject({
        outcome: 'APPROVE',
        isRecommendationOnly: true,
      });
      expect(detail.body.assignmentHistory).toBeNull();
      await api(w.aaA)
        .get(`${appPath(s.applicationId)}/documents/${s.documentId}/download`)
        .expect(200);
      await api(w.aaA)
        .get(`${appPath(s.applicationId)}/history`)
        .expect(200);

      // ...but no power over it: 403 (they can see it, their role cannot do this).
      const body = { verdict: 'VERIFIED' };
      for (const call of [
        () => api(w.aaA).post(`${appPath(s.applicationId)}/start-scrutiny`),
        () =>
          api(w.aaA)
            .post(`${appPath(s.applicationId)}/queries`)
            .send({ question: 'q' }),
        () =>
          api(w.aaA)
            .post(`${appPath(s.applicationId)}/observations`)
            .send({ body: 'b' }),
        () =>
          api(w.aaA)
            .post(`${appPath(s.applicationId)}/recommendation`)
            .send({ outcome: 'REJECT', reason: 'r' }),
        () =>
          api(w.aaA)
            .post(
              `${appPath(s.applicationId)}/documents/${s.documentId}/review`,
            )
            .send(body),
        () =>
          api(w.aaA)
            .post(`${appPath(s.applicationId)}/assignment`)
            .send({ officerUserId: w.soA2.user.id }),
        () =>
          api(w.aaA)
            .put(`${appPath(s.applicationId)}/assignment`)
            .send({ officerUserId: w.soA2.user.id, reason: 'why' }),
      ]) {
        expect([403]).toContain((await call()).status);
      }
      expect((await dbApp(s.applicationId)).internalState).toBe(
        'RECOMMENDED_FOR_APPROVAL',
      );
      // No route takes a status: only the named decision action exists (Step 15,
      // covered by decision-access.e2e), and it refuses a smuggled state.
      const smuggled = await api(w.aaA)
        .post(`${appPath(s.applicationId)}/decision`)
        .send({ decision: 'APPROVED', internalState: 'APPROVED' });
      expect(smuggled.status).toBe(400);
      for (const path of ['approve', 'reject', 'status']) {
        expect(
          (
            await api(w.aaA)
              .post(`${appPath(s.applicationId)}/${path}`)
              .send({ decision: 'APPROVED' })
          ).status,
        ).toBe(404);
      }
      expect(await dbApp(s.applicationId)).toMatchObject({
        internalState: 'RECOMMENDED_FOR_APPROVAL',
        decidedAt: null,
        decisionReason: null,
      });
    });

    it('a Department Administrator can see and assign but does no scrutiny and never decides', async () => {
      const s = await working('admin-limits');
      const o = api(w.adminA);
      const before = (await dbApp(s.applicationId)).internalState;
      for (const [call, name] of [
        [() => o.post(`${appPath(s.applicationId)}/start-scrutiny`), 'start'],
        [
          () =>
            o
              .post(`${appPath(s.applicationId)}/queries`)
              .send({ question: 'q' }),
          'query',
        ],
        [
          () =>
            o
              .post(`${appPath(s.applicationId)}/observations`)
              .send({ body: 'b' }),
          'observation',
        ],
        [
          () =>
            o
              .post(`${appPath(s.applicationId)}/recommendation`)
              .send({ outcome: 'APPROVE', reason: 'r' }),
          'recommend',
        ],
        [
          () =>
            o
              .post(
                `${appPath(s.applicationId)}/documents/${s.documentId}/review`,
              )
              .send({ verdict: 'VERIFIED' }),
          'review',
        ],
      ] as const) {
        const res = await call();
        expect({ name, status: res.status }).toEqual({ name, status: 403 });
      }
      expect((await dbApp(s.applicationId)).internalState).toBe(before);
      expect(
        await ctx.prisma.documentVerification.count({
          where: { documentId: s.documentId },
        }),
      ).toBe(0);
    });

    it('an inspector has no scrutiny capability on any route, even in their own department', async () => {
      const s = await working('inspector');
      for (const call of [
        () => api(w.inspectorA).get(appPath(s.applicationId)),
        () =>
          api(w.inspectorA).post(`${appPath(s.applicationId)}/start-scrutiny`),
        () =>
          api(w.inspectorA)
            .post(`${appPath(s.applicationId)}/observations`)
            .send({ body: 'b' }),
        () =>
          api(w.inspectorA)
            .post(`${appPath(s.applicationId)}/queries`)
            .send({ question: 'q' }),
        () =>
          api(w.inspectorA)
            .post(`${appPath(s.applicationId)}/recommendation`)
            .send({ outcome: 'APPROVE', reason: 'r' }),
        () =>
          api(w.inspectorA).get(
            `${appPath(s.applicationId)}/documents/${s.documentId}/download`,
          ),
      ]) {
        const res = await call();
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('INSUFFICIENT_ROLE');
      }
    });
  });

  // -------------------------------------------------------------------------
  describe('every scrutiny WRITE is the assigned officer’s alone', () => {
    const writes: Array<
      [string, (id: string, docId: string) => (a: Actor) => request.Test]
    > = [
      [
        'start scrutiny',
        (id) => (a) => api(a).post(`${appPath(id)}/start-scrutiny`),
      ],
      [
        'record an observation',
        (id) => (a) =>
          api(a)
            .post(`${appPath(id)}/observations`)
            .send({ body: 'note' }),
      ],
      [
        'raise a query',
        (id) => (a) =>
          api(a)
            .post(`${appPath(id)}/queries`)
            .send({ question: 'q?' }),
      ],
      [
        'recommend',
        (id) => (a) =>
          api(a)
            .post(`${appPath(id)}/recommendation`)
            .send({ outcome: 'APPROVE', reason: 'ok' }),
      ],
      [
        'review a document',
        (id, doc) => (a) =>
          api(a)
            .post(`${appPath(id)}/documents/${doc}/review`)
            .send({ verdict: 'VERIFIED' }),
      ],
    ];

    it.each(writes)(
      '%s: nobody else can, and nothing changes',
      async (name, build) => {
        const s = await working(`write-${name}`);
        const before = await dbApp(s.applicationId);
        const call = build(s.applicationId, s.documentId);
        // A same-department officer who is not assigned: the application does not exist for them.
        expect((await call(w.soA2)).status).toBe(404);
        // Other departments' Scrutiny Officer: same 404.
        expect((await call(w.soB)).status).toBe(404);
        // A role the route does not allow is refused BEFORE any lookup, so it
        // reveals nothing about the application: another department's
        // administrator gets exactly what they get for an id that does not exist.
        const adminBRes = await call(w.adminB);
        expect(adminBRes.status).toBe(403);
        expect(adminBRes.body.error.code).toBe('INSUFFICIENT_ROLE');
        const ghost = await build(
          '00000000-0000-4000-8000-000000000000',
          s.documentId,
        )(w.adminB);
        expect(ghost.status).toBe(403);
        expect(ghost.body.error.code).toBe('INSUFFICIENT_ROLE');
        // Own department's administrator: refused the same way.
        expect((await call(w.adminA)).status).toBe(403);
        for (const actor of [w.inspectorA, w.sysAdmin, w.leadership, w.owner]) {
          expect((await call(actor)).status).toBe(403);
        }
        const after = await dbApp(s.applicationId);
        expect(after.internalState).toBe(before.internalState);
        expect(after.updatedAt).toEqual(before.updatedAt);
        expect(
          await ctx.prisma.scrutinyObservation.count({
            where: { applicationId: s.applicationId },
          }),
        ).toBe(0);
        expect(
          await ctx.prisma.applicationQuery.count({
            where: { applicationId: s.applicationId },
          }),
        ).toBe(0);
        expect(
          await ctx.prisma.scrutinyRecommendation.count({
            where: { applicationId: s.applicationId },
          }),
        ).toBe(0);
        expect(
          await ctx.prisma.documentVerification.count({
            where: { documentId: s.documentId },
          }),
        ).toBe(0);
      },
    );
  });

  // -------------------------------------------------------------------------
  describe('information leakage: a missing application and a hidden one look the same', () => {
    it('gives byte-identical 404s for nonexistent, draft, other-department and not-assigned applications', async () => {
      const s = await working('leak');
      const other = await ctx.submittedApplication(
        w.owner.accessToken,
        w.enterpriseId,
        w.approvalB,
        'ac-leak-b',
      );
      // A draft in department A.
      const project = await ctx.createProjectVia(
        w.owner.accessToken,
        w.enterpriseId,
        'ac-leak-draft',
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

      const probes = [
        randomUUID(), // does not exist
        draft.body.id, // a draft: invisible to every officer
        other.applicationId, // another department's
        s.applicationId, // this department's, but not assigned to soA2
      ];
      const bodies = [];
      for (const id of probes) {
        const res = await api(w.soA2).get(appPath(id)).expect(404);
        bodies.push(res.body);
      }
      for (const b of bodies) {
        expect(b).toEqual(bodies[0]);
      }
      expect(bodies[0]).toEqual({
        error: { code: 'NOT_FOUND', message: 'Application not found.' },
      });
      // The same holds for write routes and sub-resources.
      for (const id of probes) {
        for (const res of [
          await api(w.soA2).get(`${appPath(id)}/history`),
          await api(w.soA2).get(`${appPath(id)}/documents`),
          await api(w.soA2).post(`${appPath(id)}/start-scrutiny`),
        ]) {
          expect(res.status).toBe(404);
          expect(res.body).toEqual(bodies[0]);
        }
      }
      // A draft is invisible even to the administrator of its department.
      await api(w.adminA).get(appPath(draft.body.id)).expect(404);
    });

    it('does not reveal a document’s existence across applications or departments', async () => {
      const s = await working('leak-doc');
      const t = await working('leak-doc-2');
      const probes = [
        `${appPath(s.applicationId)}/documents/${randomUUID()}`,
        `${appPath(s.applicationId)}/documents/${t.documentId}`,
      ];
      const bodies = [];
      for (const url of probes) {
        for (const suffix of ['', '/download', '/versions']) {
          const res = await api(w.soA1).get(`${url}${suffix}`).expect(404);
          bodies.push(res.body);
        }
      }
      for (const b of bodies) {
        expect(b).toEqual(bodies[0]);
      }
    });

    it('a malformed application id is a validation error, never a database error', async () => {
      for (const id of ['nope', '123', "'; DROP TABLE x;--", '%00', 'null']) {
        const res = await api(w.soA1).get(`${appPath(id)}`);
        expect([400, 404]).toContain(res.status);
        expect(JSON.stringify(res.body)).not.toMatch(
          /prisma|sql|syntax|invocation/i,
        );
      }
    });
  });

  // -------------------------------------------------------------------------
  describe('client-controlled department, role and ownership are never trusted', () => {
    it('ignores a department named in a header, and refuses one in a body', async () => {
      const s = await working('clientdept');
      // adminB claims department A in a header: still their own scope.
      const res = await api(w.adminB)
        .get('/officer/applications')
        .set('x-department-id', w.deptA.id)
        .set('x-role', 'DEPT_ADMIN')
        .expect(200);
      expect(res.body.items.map((r: { id: string }) => r.id)).not.toContain(
        s.applicationId,
      );
      await api(w.adminB)
        .get(appPath(s.applicationId))
        .set('x-department-id', w.deptA.id)
        .expect(404);
      // A body field naming a department (or a role, or an actor) is a validation error.
      for (const body of [
        { officerUserId: w.soA2.user.id, departmentId: w.deptA.id },
        { officerUserId: w.soA2.user.id, role: 'DEPT_ADMIN' },
        { officerUserId: w.soA2.user.id, actingAs: 'DEPT_ADMIN' },
      ]) {
        await api(w.adminB)
          .post(`${appPath(s.applicationId)}/assignment`)
          .send(body)
          .expect(400);
      }
      await api(w.soB)
        .post(`${appPath(s.applicationId)}/observations`)
        .send({
          body: 'x',
          departmentId: w.deptA.id,
          authorUserId: w.soA1.user.id,
        })
        .expect(400);
      expect(
        await ctx.prisma.scrutinyObservation.count({
          where: { applicationId: s.applicationId },
        }),
      ).toBe(0);
    });

    it('the department of a stored record is the application’s, whoever acts', async () => {
      const s = await working('deptderive');
      await api(w.soA1)
        .post(`${appPath(s.applicationId)}/observations`)
        .send({ body: 'note' })
        .expect(201);
      const q = await api(w.soA1)
        .post(`${appPath(s.applicationId)}/queries`)
        .send({ question: 'q' })
        .expect(201);
      const obs = await ctx.prisma.scrutinyObservation.findFirstOrThrow({
        where: { applicationId: s.applicationId },
      });
      const query = await ctx.prisma.applicationQuery.findUniqueOrThrow({
        where: { id: q.body.id },
      });
      expect(obs.departmentId).toBe(w.deptA.id);
      expect(query.departmentId).toBe(w.deptA.id);
      const assignment =
        await ctx.prisma.applicationAssignment.findFirstOrThrow({
          where: { applicationId: s.applicationId },
        });
      expect(assignment.departmentId).toBe(w.deptA.id);
    });

    it('cannot act on an application through a role held only in another department', async () => {
      const s = await working('crossrole');
      // adminB administers department B: they can neither see nor assign here.
      await api(w.adminB).get(appPath(s.applicationId)).expect(404);
      await api(w.adminB)
        .put(`${appPath(s.applicationId)}/assignment`)
        .send({ officerUserId: w.soB.user.id, reason: 'poach it' })
        .expect(404);
      // ...and soB, a Scrutiny Officer elsewhere, cannot be assigned into department A.
      const res = await api(w.adminA)
        .put(`${appPath(s.applicationId)}/assignment`)
        .send({ officerUserId: w.soB.user.id, reason: 'borrow' })
        .expect(422);
      expect(res.body.error.code).toBe('INVALID_ASSIGNEE');
    });
  });

  // -------------------------------------------------------------------------
  describe('roles are held per department, and a role without a department grants nothing', () => {
    it('a user who is a Scrutiny Officer in A and an administrator in B gets each role’s powers only in its department', async () => {
      const both = await ctx.officerSession(
        'ac-both',
        'SCRUTINY_OFFICER',
        w.deptA.id,
      );
      await ctx.users.assignRole({
        userId: both.user.id,
        roleCode: 'DEPT_ADMIN',
        departmentId: w.deptB.id,
        assignedByUserId: null,
        ipAddress: '127.0.0.1',
      });
      const inA = await ctx.submittedApplication(
        w.owner.accessToken,
        w.enterpriseId,
        w.approvalA,
        'ac-both-a',
      );
      const inB = await ctx.submittedApplication(
        w.owner.accessToken,
        w.enterpriseId,
        w.approvalB,
        'ac-both-b',
      );
      await api(w.adminA)
        .post(`${appPath(inA.applicationId)}/assignment`)
        .send({ officerUserId: both.user.id })
        .expect(201);

      // In A they act as a Scrutiny Officer.
      const asOfficer = await api(both)
        .get(appPath(inA.applicationId))
        .expect(200);
      expect(asOfficer.body.actingRole).toBe('SCRUTINY_OFFICER');
      await api(both)
        .post(`${appPath(inA.applicationId)}/start-scrutiny`)
        .expect(200);
      // In B they act as an administrator: see and assign, but do no scrutiny.
      const asAdmin = await api(both)
        .get(appPath(inB.applicationId))
        .expect(200);
      expect(asAdmin.body.actingRole).toBe('DEPT_ADMIN');
      await api(both)
        .post(`${appPath(inB.applicationId)}/start-scrutiny`)
        .expect(403);
      await api(both)
        .post(`${appPath(inB.applicationId)}/assignment`)
        .send({ officerUserId: w.soB.user.id })
        .expect(201);
      // Their administrator role gives them no administrator power in A.
      const otherInA = await ctx.submittedApplication(
        w.owner.accessToken,
        w.enterpriseId,
        w.approvalA,
        'ac-both-a2',
      );
      await api(both).get(appPath(otherInA.applicationId)).expect(404);
      await api(both)
        .post(`${appPath(otherInA.applicationId)}/assignment`)
        .send({ officerUserId: w.soA1.user.id })
        .expect(404);
      // The queue combines exactly the two scopes: department-wide in B (where
      // the shared world holds other tests' applications too), only their own
      // assignments in A.
      const list = await api(both)
        .get('/officer/applications?pageSize=100')
        .expect(200);
      const ids = list.body.items.map((r: { id: string }) => r.id);
      expect(ids).toContain(inA.applicationId);
      expect(ids).toContain(inB.applicationId);
      expect(ids).not.toContain(otherInA.applicationId);
      const expected = await ctx.prisma.approvalApplication.findMany({
        where: {
          internalState: { not: 'DRAFT' },
          OR: [
            { approvalType: { departmentId: w.deptB.id } },
            {
              approvalType: { departmentId: w.deptA.id },
              assignments: {
                some: { officerUserId: both.user.id, endedAt: null },
              },
            },
          ],
        },
        select: { id: true },
      });
      expect([...ids].sort()).toEqual(expected.map((r) => r.id).sort());
    });

    it('an officer role with NO department (fail closed) sees and can do nothing', async () => {
      const orphan = await ctx.officerSession(
        'ac-orphan',
        'SCRUTINY_OFFICER',
        undefined,
      );
      const s = await working('orphan');
      // Even if an assignment row were forced in, the role has no department to match.
      await ctx.prisma.applicationAssignment.updateMany({
        where: { applicationId: s.applicationId, endedAt: null },
        data: {
          endedAt: new Date(),
          endedByUserId: w.adminA.user.id,
          endReason: 'test',
        },
      });
      await ctx.prisma.applicationAssignment.create({
        data: {
          applicationId: s.applicationId,
          departmentId: w.deptA.id,
          officerUserId: orphan.user.id,
          assignedByUserId: w.adminA.user.id,
        },
      });
      expect(
        (await api(orphan).get('/officer/applications').expect(200)).body.total,
      ).toBe(0);
      await api(orphan).get(appPath(s.applicationId)).expect(404);
      await api(orphan)
        .post(`${appPath(s.applicationId)}/observations`)
        .send({ body: 'x' })
        .expect(404);
      const dash = (await api(orphan).get('/officer/dashboard').expect(200))
        .body;
      expect(dash).toMatchObject({ roles: [], byState: {}, assignedToMe: 0 });
    });

    it('an assignee who loses the officer role loses the application at once', async () => {
      const temp = await ctx.officerSession(
        'ac-lose',
        'SCRUTINY_OFFICER',
        w.deptA.id,
      );
      const s = await ctx.submittedApplication(
        w.owner.accessToken,
        w.enterpriseId,
        w.approvalA,
        'ac-lose',
      );
      await api(w.adminA)
        .post(`${appPath(s.applicationId)}/assignment`)
        .send({ officerUserId: temp.user.id })
        .expect(201);
      await api(temp).get(appPath(s.applicationId)).expect(200);
      await ctx.prisma.userRole.deleteMany({ where: { userId: temp.user.id } });
      await api(temp).get(appPath(s.applicationId)).expect(403);
      // The application is not stranded: the administrator can reassign it.
      const moved = await api(w.adminA)
        .put(`${appPath(s.applicationId)}/assignment`)
        .send({ officerUserId: w.soA1.user.id, reason: 'officer left' })
        .expect(200);
      expect(moved.body.officerUserId).toBe(w.soA1.user.id);
    });
  });

  // -------------------------------------------------------------------------
  describe('applicant-side access to queries is the existing enterprise model', () => {
    it('answering needs Full Delegation; a stranger, and other enterprises, get nothing', async () => {
      const s = await working('appq');
      const q = await api(w.soA1)
        .post(`${appPath(s.applicationId)}/queries`)
        .send({ question: 'q?' })
        .expect(201);
      const base = `/enterprises/${w.enterpriseId}/projects/${s.projectId}/applications/${s.applicationId}/queries`;
      // Another enterprise's owner: no relationship at all.
      await api(w.owner2).get(base).expect(404);
      await api(w.owner2)
        .post(`${base}/${q.body.id}/respond`)
        .send({ responseText: 'x' })
        .expect(404);
      // Officers are strangers to the enterprise: the existing enterprise
      // model answers 404, and the officer roles grant nothing on this route.
      for (const officer of [w.soA1, w.adminA, w.aaA]) {
        expect((await api(officer).get(base)).status).toBe(404);
        expect(
          (
            await api(officer)
              .post(`${base}/${q.body.id}/respond`)
              .send({ responseText: 'x' })
          ).status,
        ).toBe(404);
      }
      expect(
        (
          await ctx.prisma.applicationQuery.findUniqueOrThrow({
            where: { id: q.body.id },
          })
        ).status,
      ).toBe('OPEN');
      await api(w.owner)
        .post(`${base}/${q.body.id}/respond`)
        .send({ responseText: 'From the owner.' })
        .expect(200);
    });

    it('an applicant cannot reach any officer resource, including their own application', async () => {
      const s = await working('applicant-officer');
      for (const url of [
        appPath(s.applicationId),
        `${appPath(s.applicationId)}/history`,
        `${appPath(s.applicationId)}/discovery`,
        `${appPath(s.applicationId)}/documents`,
      ]) {
        expect((await api(w.owner).get(url)).status).toBe(403);
      }
      // The observations an officer writes are absent from every applicant view.
      await api(w.soA1)
        .post(`${appPath(s.applicationId)}/observations`)
        .send({ body: 'ONLY-FOR-OFFICERS' })
        .expect(201);
      const base = `/enterprises/${w.enterpriseId}/projects/${s.projectId}/applications/${s.applicationId}`;
      const seen = JSON.stringify([
        (await api(w.owner).get(base).expect(200)).body,
        (await api(w.owner).get(`${base}/queries`).expect(200)).body,
        (await api(w.owner).get(`${base}/documents`).expect(200)).body,
      ]);
      expect(seen).not.toContain('ONLY-FOR-OFFICERS');
    });
  });
});
