import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { API, E2eContext, createE2eContext } from './support/e2e-helpers';

jest.setTimeout(240_000);

interface Actor {
  user: { id: string };
  accessToken: string;
}

/**
 * Project CRUD as the enterprise OWNER, over real HTTP -> Nest -> Prisma ->
 * PostgreSQL: creation, validation, listing, read, update, cross-enterprise
 * and cross-project attempts, absence of any lifecycle/status surface, audit
 * and Swagger. Representative behaviour is in project-access.e2e-spec.ts.
 */
describe('Projects e2e — owner: create, list, read, update', () => {
  let ctx: E2eContext;
  let owner: Actor;
  let other: Actor;

  const as = (token: string) => ({
    get: (p: string) =>
      request(ctx.http)
        .get(`${API}${p}`)
        .set('Authorization', `Bearer ${token}`),
    post: (p: string) =>
      request(ctx.http)
        .post(`${API}${p}`)
        .set('Authorization', `Bearer ${token}`),
    put: (p: string) =>
      request(ctx.http)
        .put(`${API}${p}`)
        .set('Authorization', `Bearer ${token}`),
    patch: (p: string) =>
      request(ctx.http)
        .patch(`${API}${p}`)
        .set('Authorization', `Bearer ${token}`),
    del: (p: string) =>
      request(ctx.http)
        .delete(`${API}${p}`)
        .set('Authorization', `Bearer ${token}`),
  });

  const newEnterprise = async (tag: string, actor: Actor = owner) =>
    (await ctx.createEnterprise(actor.accessToken, tag)).id;

  const audit = (entityId: string, action: string) =>
    ctx.prisma.auditLog.findMany({ where: { entityId, action } });

  beforeAll(async () => {
    ctx = await createE2eContext();
    [owner, other] = await Promise.all([
      ctx.applicantSession('proj-owner'),
      ctx.applicantSession('proj-other'),
    ]);
  });

  afterAll(async () => {
    await ctx.cleanup();
    await ctx.app.close();
  });

  // -------------------------------------------------------------------------
  describe('POST /enterprises/:enterpriseId/projects', () => {
    it('creates a project under the enterprise with a generated reference number and echoes the characteristics', async () => {
      const enterpriseId = await newEnterprise('create');
      const payload = ctx.projectPayload('create');
      const res = await as(owner.accessToken)
        .post(`/enterprises/${enterpriseId}/projects`)
        .send(payload)
        .expect(201);
      ctx.projectIds.push(res.body.id);

      expect(res.body).toMatchObject({
        enterpriseId,
        name: payload.name,
        district: 'Pune',
        taluka: 'Khed',
        sectorCode: '25910',
        enterpriseSizeBand: 'small',
        investmentAmount: 25000000.5,
        employmentCount: 40,
        projectStage: 'expansion',
        landStatus: 'owned',
        constructionStatus: 'not_started',
        productionStatus: 'pre_production',
        hazardousFlag: false,
        industrialArea: null,
        landLeaseDetails: null,
        hazardousCategory: null,
        environmentalCategory: null,
        additionalSiteDetails: null,
        expectedCommissioningDate: null,
      });
      expect(res.body.referenceNumber).toMatch(/^PRJ-\d{4}-\d{6}$/);

      const row = await ctx.prisma.project.findUniqueOrThrow({
        where: { id: res.body.id },
      });
      expect(row.enterpriseId).toBe(enterpriseId);
      expect(Number(row.investmentAmount)).toBe(25000000.5);
    });

    it('exposes exactly the documented fields — no status, no owner, no internals', async () => {
      const enterpriseId = await newEnterprise('shape');
      const { body } = await ctx.createProjectVia(
        owner.accessToken,
        enterpriseId,
        'shape',
      );
      expect(Object.keys(body).sort()).toEqual(
        [
          'id',
          'referenceNumber',
          'enterpriseId',
          'name',
          'district',
          'taluka',
          'industrialArea',
          'sectorCode',
          'enterpriseSizeBand',
          'investmentAmount',
          'employmentCount',
          'projectStage',
          'landStatus',
          'landLeaseDetails',
          'constructionStatus',
          'productionStatus',
          'hazardousFlag',
          'hazardousCategory',
          'environmentalCategory',
          'additionalSiteDetails',
          'expectedCommissioningDate',
          'createdAt',
          'updatedAt',
        ].sort(),
      );
      expect(JSON.stringify(body)).not.toContain(owner.user.id);
    });

    it('stores every optional field: lease details on leased land, hazardous category, site details, commissioning date', async () => {
      const enterpriseId = await newEnterprise('optionals');
      const { body } = await ctx.createProjectVia(
        owner.accessToken,
        enterpriseId,
        'opt',
        {
          landStatus: 'leased',
          landLeaseDetails: { lessorName: 'MIDC', leaseTermMonths: 99 },
          hazardousFlag: true,
          hazardousCategory: 'Chemical processing',
          industrialArea: 'MIDC Chakan Phase II',
          environmentalCategory: 'Category B',
          additionalSiteDetails: 'Adjoins the Unit 1 boundary wall.',
          expectedCommissioningDate: '2027-04-01',
        },
      );
      expect(body).toMatchObject({
        landStatus: 'leased',
        landLeaseDetails: { lessorName: 'MIDC', leaseTermMonths: 99 },
        hazardousFlag: true,
        hazardousCategory: 'Chemical processing',
        industrialArea: 'MIDC Chakan Phase II',
        environmentalCategory: 'Category B',
        additionalSiteDetails: 'Adjoins the Unit 1 boundary wall.',
        expectedCommissioningDate: '2027-04-01',
      });
    });

    it('generates a distinct reference number for every project', async () => {
      const enterpriseId = await newEnterprise('refs');
      const a = await ctx.createProjectVia(
        owner.accessToken,
        enterpriseId,
        'a',
      );
      const b = await ctx.createProjectVia(
        owner.accessToken,
        enterpriseId,
        'b',
      );
      expect(a.referenceNumber).not.toBe(b.referenceNumber);
    });

    it('trims surrounding whitespace before storing', async () => {
      const enterpriseId = await newEnterprise('trim');
      const { id } = await ctx.createProjectVia(
        owner.accessToken,
        enterpriseId,
        'trim',
        {
          name: '   Trimmed Project   ',
          district: '  Nashik ',
        },
      );
      const row = await ctx.prisma.project.findUniqueOrThrow({ where: { id } });
      expect(row.name).toBe('Trimmed Project');
      expect(row.district).toBe('Nashik');
    });

    it.each([
      'name',
      'district',
      'taluka',
      'sectorCode',
      'enterpriseSizeBand',
      'investmentAmount',
      'employmentCount',
      'projectStage',
      'landStatus',
      'constructionStatus',
      'productionStatus',
      'hazardousFlag',
    ])(
      'rejects a body missing the mandatory field %s with 400 VALIDATION_ERROR and creates nothing',
      async (field) => {
        const enterpriseId = await newEnterprise('missing');
        const payload = ctx.projectPayload('missing');
        delete payload[field];
        const res = await as(owner.accessToken)
          .post(`/enterprises/${enterpriseId}/projects`)
          .send(payload)
          .expect(400);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
        expect(Object.keys(res.body.error.fields ?? {})).toContain(field);
        expect(
          await ctx.prisma.project.count({ where: { enterpriseId } }),
        ).toBe(0);
      },
    );

    it.each([
      ['projectStage', 'Greenfield'],
      ['projectStage', 'new_build'],
      ['landStatus', 'rented'],
      ['constructionStatus', 'in_progress'],
      ['productionStatus', 'live'],
      ['enterpriseSizeBand', 'MICRO'],
      ['investmentAmount', 0],
      ['investmentAmount', -10],
      ['investmentAmount', '1000'],
      ['investmentAmount', 10.123],
      ['employmentCount', -1],
      ['employmentCount', 2.5],
      ['hazardousFlag', 'false'],
      ['name', '     '],
      ['expectedCommissioningDate', '01-04-2027'],
      ['expectedCommissioningDate', '2027-02-31'],
    ])('rejects invalid %s = %p', async (field, value) => {
      const enterpriseId = await newEnterprise('invalid');
      const res = await as(owner.accessToken)
        .post(`/enterprises/${enterpriseId}/projects`)
        .send(ctx.projectPayload('invalid', { [field]: value }))
        .expect(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(await ctx.prisma.project.count({ where: { enterpriseId } })).toBe(
        0,
      );
    });

    it('enforces the conditional fields: lease details only on leased land, hazardous category only when hazardous', async () => {
      const enterpriseId = await newEnterprise('conditional');
      const lease = await as(owner.accessToken)
        .post(`/enterprises/${enterpriseId}/projects`)
        .send(
          ctx.projectPayload('c1', {
            landStatus: 'owned',
            landLeaseDetails: { lessorName: 'MIDC', leaseTermMonths: 12 },
          }),
        )
        .expect(400);
      expect(Object.keys(lease.body.error.fields)).toContain(
        'landLeaseDetails',
      );

      const hazard = await as(owner.accessToken)
        .post(`/enterprises/${enterpriseId}/projects`)
        .send(
          ctx.projectPayload('c2', {
            hazardousFlag: false,
            hazardousCategory: 'Chemical',
          }),
        )
        .expect(400);
      expect(Object.keys(hazard.body.error.fields)).toContain(
        'hazardousCategory',
      );

      // Malformed nested lease details are rejected too.
      await as(owner.accessToken)
        .post(`/enterprises/${enterpriseId}/projects`)
        .send(
          ctx.projectPayload('c3', {
            landStatus: 'leased',
            landLeaseDetails: { lessorName: 'MIDC' },
          }),
        )
        .expect(400);
      expect(await ctx.prisma.project.count({ where: { enterpriseId } })).toBe(
        0,
      );
    });

    it('rejects client attempts to set ownership, the enterprise, identifiers or any status', async () => {
      const enterpriseId = await newEnterprise('mass');
      const otherEnterprise = await newEnterprise('mass-other', other);
      for (const extra of [
        { enterpriseId: otherEnterprise },
        { enterprise_id: otherEnterprise },
        { ownerUserId: other.user.id },
        { id: randomUUID() },
        { referenceNumber: 'PRJ-2026-999999' },
        { status: 'APPROVED' },
        { projectStatus: 'ACTIVE' },
        { createdAt: new Date().toISOString() },
      ]) {
        const res = await as(owner.accessToken)
          .post(`/enterprises/${enterpriseId}/projects`)
          .send(ctx.projectPayload('mass', extra))
          .expect(400);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
      }
      expect(
        await ctx.prisma.project.count({
          where: { enterpriseId: { in: [enterpriseId, otherEnterprise] } },
        }),
      ).toBe(0);
    });

    it('requires authentication', async () => {
      const enterpriseId = await newEnterprise('anon');
      await request(ctx.http)
        .post(`${API}/enterprises/${enterpriseId}/projects`)
        .send(ctx.projectPayload('anon'))
        .expect(401);
    });

    it('is restricted to the APPLICANT role: a staff-only (MFA-verified) officer gets 403 INSUFFICIENT_ROLE', async () => {
      const enterpriseId = await newEnterprise('officer');
      const officer = await ctx.registerWithRole(
        'proj-officer',
        'SCRUTINY_OFFICER',
      );
      await ctx.prisma.userRole.deleteMany({
        where: { userId: officer.id, role: { code: 'APPLICANT' } },
      });
      const { accessToken } = await ctx.fullMfaSession(officer);
      const res = await as(accessToken)
        .post(`/enterprises/${enterpriseId}/projects`)
        .send(ctx.projectPayload('officer'))
        .expect(403);
      expect(res.body.error.code).toBe('INSUFFICIENT_ROLE');
      await as(accessToken)
        .get(`/enterprises/${enterpriseId}/projects`)
        .expect(403);
      expect(await ctx.prisma.project.count({ where: { enterpriseId } })).toBe(
        0,
      );
    });

    it('a user cannot create a project in someone else’s enterprise: 404, identical to a nonexistent or malformed enterprise, nothing created', async () => {
      const foreign = await newEnterprise('foreign', other);
      const body = ctx.projectPayload('intruder');

      const denied = await as(owner.accessToken)
        .post(`/enterprises/${foreign}/projects`)
        .send(body)
        .expect(404);
      const missing = await as(owner.accessToken)
        .post(`/enterprises/${randomUUID()}/projects`)
        .send(body)
        .expect(404);
      const malformed = await as(owner.accessToken)
        .post('/enterprises/not-a-uuid/projects')
        .send(body)
        .expect(404);

      expect(denied.body.error.code).toBe('NOT_FOUND');
      expect(denied.body.error.message).toBe(missing.body.error.message);
      expect(denied.body.error.message).toBe(malformed.body.error.message);
      expect(
        await ctx.prisma.project.count({ where: { enterpriseId: foreign } }),
      ).toBe(0);
    });

    it('audits the creation with the actor, the enterprise and no sensitive data', async () => {
      const enterpriseId = await newEnterprise('audit-create');
      const { id, referenceNumber } = await ctx.createProjectVia(
        owner.accessToken,
        enterpriseId,
        'audit',
      );
      const rows = await audit(id, 'PROJECT_CREATED');
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        userId: owner.user.id,
        entityType: 'Project',
        roleAtTime: 'APPLICANT',
      });
      expect(rows[0].afterState).toMatchObject({
        enterpriseId,
        actingAs: 'OWNER',
        referenceNumber,
      });
      expect(rows[0].ipAddress).toBeTruthy();
      expect(JSON.stringify(rows[0]).toLowerCase()).not.toMatch(
        /password|secret|token|hash/,
      );
    });
  });

  // -------------------------------------------------------------------------
  describe('GET /enterprises/:enterpriseId/projects', () => {
    it('lists only this enterprise’s projects, newest first — never another enterprise’s, even the same owner’s', async () => {
      const first = await newEnterprise('list-1');
      const second = await newEnterprise('list-2');
      const a = await ctx.createProjectVia(owner.accessToken, first, 'a');
      const b = await ctx.createProjectVia(owner.accessToken, first, 'b');
      const c = await ctx.createProjectVia(owner.accessToken, second, 'c');

      const res = await as(owner.accessToken)
        .get(`/enterprises/${first}/projects`)
        .expect(200);
      expect(res.body.map((p: { id: string }) => p.id)).toEqual([b.id, a.id]);
      expect(res.body.map((p: { id: string }) => p.id)).not.toContain(c.id);

      const empty = await newEnterprise('list-empty');
      expect(
        (
          await as(owner.accessToken)
            .get(`/enterprises/${empty}/projects`)
            .expect(200)
        ).body,
      ).toEqual([]);
    });

    it('a stranger gets 404, no token 401', async () => {
      const enterpriseId = await newEnterprise('list-authz');
      await ctx.createProjectVia(owner.accessToken, enterpriseId, 'x');
      await as(other.accessToken)
        .get(`/enterprises/${enterpriseId}/projects`)
        .expect(404);
      await request(ctx.http)
        .get(`${API}/enterprises/${enterpriseId}/projects`)
        .expect(401);
    });
  });

  // -------------------------------------------------------------------------
  describe('GET /enterprises/:enterpriseId/projects/:projectId', () => {
    it('lets the owner read a project', async () => {
      const enterpriseId = await newEnterprise('get');
      const { id, body } = await ctx.createProjectVia(
        owner.accessToken,
        enterpriseId,
        'get',
      );
      const res = await as(owner.accessToken)
        .get(`/enterprises/${enterpriseId}/projects/${id}`)
        .expect(200);
      expect(res.body).toEqual(body);
    });

    it('a stranger cannot read it (404), and no token is 401', async () => {
      const enterpriseId = await newEnterprise('get-authz');
      const { id } = await ctx.createProjectVia(
        owner.accessToken,
        enterpriseId,
        'x',
      );
      await as(other.accessToken)
        .get(`/enterprises/${enterpriseId}/projects/${id}`)
        .expect(404);
      await request(ctx.http)
        .get(`${API}/enterprises/${enterpriseId}/projects/${id}`)
        .expect(401);
    });

    it('a project id from ANOTHER enterprise is a 404 under this enterprise’s URL — even for the owner of both', async () => {
      const e1 = await newEnterprise('cross-1');
      const e2 = await newEnterprise('cross-2');
      const p2 = await ctx.createProjectVia(owner.accessToken, e2, 'p2');

      const cross = await as(owner.accessToken)
        .get(`/enterprises/${e1}/projects/${p2.id}`)
        .expect(404);
      const missing = await as(owner.accessToken)
        .get(`/enterprises/${e1}/projects/${randomUUID()}`)
        .expect(404);
      expect(cross.body.error.code).toBe('NOT_FOUND');
      expect(cross.body.error.message).toBe(missing.body.error.message);
      expect(JSON.stringify(cross.body)).not.toContain(p2.id);
      // ...while its own URL works.
      await as(owner.accessToken)
        .get(`/enterprises/${e2}/projects/${p2.id}`)
        .expect(200);
    });

    it('a malformed project id is a 400 and never a server error', async () => {
      const enterpriseId = await newEnterprise('get-malformed');
      const res = await as(owner.accessToken)
        .get(`/enterprises/${enterpriseId}/projects/not-a-uuid`)
        .expect(400);
      expect(res.body.error.code).toBe('BAD_REQUEST');
    });
  });

  // -------------------------------------------------------------------------
  describe('PUT /enterprises/:enterpriseId/projects/:projectId', () => {
    it('updates fields, refreshes updatedAt and audits only what changed with the previous values', async () => {
      const enterpriseId = await newEnterprise('upd');
      const { id, body } = await ctx.createProjectVia(
        owner.accessToken,
        enterpriseId,
        'upd',
      );
      const res = await as(owner.accessToken)
        .put(`/enterprises/${enterpriseId}/projects/${id}`)
        .send({
          employmentCount: 55,
          constructionStatus: 'ongoing',
          name: '  Renamed Project  ',
          district: 'Pune',
        })
        .expect(200);

      expect(res.body).toMatchObject({
        employmentCount: 55,
        constructionStatus: 'ongoing',
        name: 'Renamed Project',
        district: 'Pune',
        referenceNumber: body.referenceNumber,
        enterpriseId,
      });
      expect(new Date(res.body.updatedAt).getTime()).toBeGreaterThanOrEqual(
        new Date(body.updatedAt).getTime(),
      );

      const rows = await audit(id, 'PROJECT_UPDATED');
      expect(rows).toHaveLength(1);
      expect(rows[0].userId).toBe(owner.user.id);
      expect(rows[0].beforeState).toEqual({
        employmentCount: 40,
        constructionStatus: 'not_started',
        name: body.name,
      });
      expect(rows[0].afterState).toEqual({
        employmentCount: 55,
        constructionStatus: 'ongoing',
        name: 'Renamed Project',
        enterpriseId,
        actingAs: 'OWNER',
      });
    });

    it('updates the investment amount and the commissioning date, preserving decimals', async () => {
      const enterpriseId = await newEnterprise('upd-num');
      const { id } = await ctx.createProjectVia(
        owner.accessToken,
        enterpriseId,
        'num',
      );
      const res = await as(owner.accessToken)
        .put(`/enterprises/${enterpriseId}/projects/${id}`)
        .send({
          investmentAmount: 9999999999999.99,
          expectedCommissioningDate: '2028-02-29',
        })
        .expect(200);
      expect(res.body.investmentAmount).toBe(9999999999999.99);
      expect(res.body.expectedCommissioningDate).toBe('2028-02-29');
    });

    it('clears optional fields with null but never a mandatory one', async () => {
      const enterpriseId = await newEnterprise('upd-null');
      const { id } = await ctx.createProjectVia(
        owner.accessToken,
        enterpriseId,
        'null',
        {
          industrialArea: 'MIDC X',
          environmentalCategory: 'Cat B',
          additionalSiteDetails: 'Notes',
          expectedCommissioningDate: '2027-04-01',
        },
      );
      const url = `/enterprises/${enterpriseId}/projects/${id}`;
      const cleared = await as(owner.accessToken)
        .put(url)
        .send({
          industrialArea: null,
          environmentalCategory: null,
          additionalSiteDetails: null,
          expectedCommissioningDate: null,
        })
        .expect(200);
      expect(cleared.body).toMatchObject({
        industrialArea: null,
        environmentalCategory: null,
        additionalSiteDetails: null,
        expectedCommissioningDate: null,
      });
      for (const field of [
        'name',
        'district',
        'sectorCode',
        'projectStage',
        'hazardousFlag',
        'investmentAmount',
      ]) {
        await as(owner.accessToken)
          .put(url)
          .send({ [field]: null })
          .expect(400);
      }
    });

    it('checks conditional rules against the resulting project: leaving "leased" or un-flagging hazardous needs an explicit null', async () => {
      const enterpriseId = await newEnterprise('upd-cond');
      const { id } = await ctx.createProjectVia(
        owner.accessToken,
        enterpriseId,
        'cond',
        {
          landStatus: 'leased',
          landLeaseDetails: { lessorName: 'MIDC', leaseTermMonths: 60 },
          hazardousFlag: true,
          hazardousCategory: 'Chemical',
        },
      );
      const url = `/enterprises/${enterpriseId}/projects/${id}`;

      const land = await as(owner.accessToken)
        .put(url)
        .send({ landStatus: 'owned' })
        .expect(400);
      expect(Object.keys(land.body.error.fields)).toContain('landLeaseDetails');
      const haz = await as(owner.accessToken)
        .put(url)
        .send({ hazardousFlag: false })
        .expect(400);
      expect(Object.keys(haz.body.error.fields)).toContain('hazardousCategory');
      const unchanged = await ctx.prisma.project.findUniqueOrThrow({
        where: { id },
      });
      expect(unchanged.landStatus).toBe('leased');
      expect(unchanged.hazardousFlag).toBe(true);

      const ok = await as(owner.accessToken)
        .put(url)
        .send({
          landStatus: 'owned',
          landLeaseDetails: null,
          hazardousFlag: false,
          hazardousCategory: null,
        })
        .expect(200);
      expect(ok.body).toMatchObject({
        landStatus: 'owned',
        landLeaseDetails: null,
        hazardousFlag: false,
        hazardousCategory: null,
      });
      // ...and details cannot be added back to non-leased land.
      await as(owner.accessToken)
        .put(url)
        .send({ landLeaseDetails: { lessorName: 'MIDC', leaseTermMonths: 1 } })
        .expect(400);
    });

    it('rejects an empty body and invalid values', async () => {
      const enterpriseId = await newEnterprise('upd-bad');
      const { id } = await ctx.createProjectVia(
        owner.accessToken,
        enterpriseId,
        'bad',
      );
      const url = `/enterprises/${enterpriseId}/projects/${id}`;
      await as(owner.accessToken).put(url).send({}).expect(400);
      await as(owner.accessToken)
        .put(url)
        .send({ projectStage: 'Greenfield' })
        .expect(400);
      await as(owner.accessToken)
        .put(url)
        .send({ investmentAmount: -1 })
        .expect(400);
      await as(owner.accessToken)
        .put(url)
        .send({ hazardousFlag: 'yes' })
        .expect(400);
      await as(owner.accessToken).put(url).send({ name: ' ' }).expect(400);
      const row = await ctx.prisma.project.findUniqueOrThrow({ where: { id } });
      expect(row.projectStage).toBe('expansion');
    });

    it('rejects attempts to move a project to another enterprise, change its reference number, or write a status', async () => {
      const e1 = await newEnterprise('move-1');
      const e2 = await newEnterprise('move-2');
      const { id, referenceNumber } = await ctx.createProjectVia(
        owner.accessToken,
        e1,
        'move',
      );
      for (const extra of [
        { enterpriseId: e2 },
        { enterprise_id: e2 },
        { referenceNumber: 'PRJ-2026-000000' },
        { id: randomUUID() },
        { status: 'APPROVED' },
        { projectStatus: 'CLOSED' },
        { state: 'ACTIVE' },
      ]) {
        await as(owner.accessToken)
          .put(`/enterprises/${e1}/projects/${id}`)
          .send({ employmentCount: 41, ...extra })
          .expect(400);
      }
      const row = await ctx.prisma.project.findUniqueOrThrow({ where: { id } });
      expect(row).toMatchObject({
        enterpriseId: e1,
        referenceNumber,
        employmentCount: 40,
      });
    });

    it('a no-op update succeeds without an audit entry', async () => {
      const enterpriseId = await newEnterprise('upd-noop');
      const { id } = await ctx.createProjectVia(
        owner.accessToken,
        enterpriseId,
        'noop',
      );
      await as(owner.accessToken)
        .put(`/enterprises/${enterpriseId}/projects/${id}`)
        .send({ employmentCount: 40 })
        .expect(200);
      expect(await audit(id, 'PROJECT_UPDATED')).toHaveLength(0);
    });

    it('a stranger cannot update (404) and nothing changes', async () => {
      const enterpriseId = await newEnterprise('upd-stranger');
      const { id, body } = await ctx.createProjectVia(
        owner.accessToken,
        enterpriseId,
        'x',
      );
      await as(other.accessToken)
        .put(`/enterprises/${enterpriseId}/projects/${id}`)
        .send({ name: 'Hijacked Project' })
        .expect(404);
      await request(ctx.http)
        .put(`${API}/enterprises/${enterpriseId}/projects/${id}`)
        .send({ name: 'Anon Edit' })
        .expect(401);
      const row = await ctx.prisma.project.findUniqueOrThrow({ where: { id } });
      expect(row.name).toBe(body.name);
      expect(await audit(id, 'PROJECT_UPDATED')).toHaveLength(0);
    });

    it('cannot reach a project of another enterprise through this enterprise’s URL — even when the caller owns both', async () => {
      const e1 = await newEnterprise('put-cross-1');
      const e2 = await newEnterprise('put-cross-2');
      const p2 = await ctx.createProjectVia(owner.accessToken, e2, 'p2');
      await as(owner.accessToken)
        .put(`/enterprises/${e1}/projects/${p2.id}`)
        .send({ name: 'Cross Edit' })
        .expect(404);
      const row = await ctx.prisma.project.findUniqueOrThrow({
        where: { id: p2.id },
      });
      expect(row).toMatchObject({ name: p2.body.name, enterpriseId: e2 });
    });
  });

  // -------------------------------------------------------------------------
  describe('lifecycle: the requirements define none', () => {
    it('exposes no status, transition or delete surface for projects', async () => {
      const enterpriseId = await newEnterprise('nolife');
      const { id } = await ctx.createProjectVia(
        owner.accessToken,
        enterpriseId,
        'nolife',
      );
      const base = `/enterprises/${enterpriseId}/projects/${id}`;
      for (const [method, url] of [
        ['patch', base],
        ['delete', base],
        ['post', `${base}/status`],
        ['put', `${base}/status`],
        ['post', `${base}/transition`],
        ['post', `${base}/submit`],
        ['post', `${base}/archive`],
        ['post', `${base}/approve`],
        ['delete', `/enterprises/${enterpriseId}/projects`],
        ['put', `/enterprises/${enterpriseId}/projects`],
      ] as const) {
        const res = await (as(owner.accessToken) as any)
          [method === 'delete' ? 'del' : method](url)
          .send({ status: 'ACTIVE' });
        expect([404, 405]).toContain(res.status);
      }
      expect(await ctx.prisma.project.count({ where: { id } })).toBe(1);
    });

    it('project stage and construction/production status are validated data, not a state machine: any documented value may be set', async () => {
      const enterpriseId = await newEnterprise('char');
      const { id } = await ctx.createProjectVia(
        owner.accessToken,
        enterpriseId,
        'char',
      );
      const url = `/enterprises/${enterpriseId}/projects/${id}`;
      for (const constructionStatus of [
        'ongoing',
        'completed',
        'not_started',
      ]) {
        const res = await as(owner.accessToken)
          .put(url)
          .send({ constructionStatus })
          .expect(200);
        expect(res.body.constructionStatus).toBe(constructionStatus);
      }
      for (const projectStage of ['greenfield', 'brownfield', 'expansion']) {
        await as(owner.accessToken).put(url).send({ projectStage }).expect(200);
      }
      await as(owner.accessToken)
        .put(url)
        .send({ productionStatus: 'commercial' })
        .expect(200);
      await as(owner.accessToken)
        .put(url)
        .send({ productionStatus: 'archived' })
        .expect(400);
    });
  });

  // -------------------------------------------------------------------------
  describe('Swagger', () => {
    it('documents the four project endpoints with bearer auth and exposes no status or internal fields', async () => {
      const { body } = await request(ctx.http)
        .get('/api/docs-json')
        .expect(200);
      const schemas = body.components.schemas as Record<
        string,
        { properties?: Record<string, unknown> }
      >;
      const listPath = `${API}/enterprises/{enterpriseId}/projects`;
      const onePath = `${API}/enterprises/{enterpriseId}/projects/{projectId}`;

      for (const [path, method] of [
        [listPath, 'post'],
        [listPath, 'get'],
        [onePath, 'get'],
        [onePath, 'put'],
      ]) {
        expect(body.paths[path][method].security).toBeDefined();
      }
      expect(Object.keys(body.paths[onePath]).sort()).toEqual(['get', 'put']);

      for (const name of [
        'ProjectResponseDto',
        'CreateProjectDto',
        'UpdateProjectDto',
      ]) {
        const props = Object.keys(schemas[name].properties ?? {});
        expect(props).not.toContain('status');
        expect(props).not.toContain('ownerUserId');
        for (const prop of props) {
          expect(prop).not.toMatch(/password|hash|secret|token/i);
        }
      }
      for (const name of ['CreateProjectDto', 'UpdateProjectDto']) {
        const props = Object.keys(schemas[name].properties ?? {});
        expect(props).not.toContain('enterpriseId');
        expect(props).not.toContain('referenceNumber');
        expect(props).not.toContain('id');
      }
    });
  });
});
