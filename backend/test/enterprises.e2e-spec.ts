import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { API, E2eContext, createE2eContext } from './support/e2e-helpers';

jest.setTimeout(240_000);

/**
 * Enterprise management over real HTTP -> Nest -> Prisma -> PostgreSQL:
 * creation + ownership, owner/representative/stranger read access, owner-only
 * update, role gating and audit events.
 */
describe('Enterprises e2e — creation, ownership, read and update', () => {
  let ctx: E2eContext;
  let owner: { user: { id: string }; accessToken: string };
  let other: { user: { id: string }; accessToken: string };

  const as = (token: string) => ({
    get: (path: string) =>
      request(ctx.http)
        .get(`${API}${path}`)
        .set('Authorization', `Bearer ${token}`),
    post: (path: string) =>
      request(ctx.http)
        .post(`${API}${path}`)
        .set('Authorization', `Bearer ${token}`),
    put: (path: string) =>
      request(ctx.http)
        .put(`${API}${path}`)
        .set('Authorization', `Bearer ${token}`),
  });

  beforeAll(async () => {
    ctx = await createE2eContext();
    owner = await ctx.applicantSession('ent-owner');
    other = await ctx.applicantSession('ent-other');
  });

  afterAll(async () => {
    await ctx.cleanup();
    await ctx.app.close();
  });

  describe('POST /enterprises', () => {
    it('creates an enterprise owned by the authenticated user and returns a generated reference number', async () => {
      const payload = ctx.enterprisePayload('create', {
        tradeName: 'Sahyadri Precision',
        website: 'https://sahyadri.example.com',
        contactPersonName: 'Meera Kulkarni',
        contactPersonMobile: '9123456780',
      });
      const res = await as(owner.accessToken)
        .post('/enterprises')
        .send(payload)
        .expect(201);
      ctx.enterpriseIds.push(res.body.id);

      expect(res.body).toMatchObject({
        name: payload.name,
        businessType: payload.businessType,
        registrationNumber: payload.registrationNumber,
        registrationNumberType: 'UDYAM',
        sector: 'Engineering',
        tradeName: 'Sahyadri Precision',
        website: 'https://sahyadri.example.com',
        contactPersonName: 'Meera Kulkarni',
        contactPersonMobile: '9123456780',
        accessType: 'OWNER',
      });
      expect(res.body.referenceNumber).toMatch(/^ENT-\d{4}-\d{6}$/);
      expect(res.body.representativeScope).toBeUndefined();

      const row = await ctx.prisma.enterprise.findUniqueOrThrow({
        where: { id: res.body.id },
      });
      expect(row.ownerUserId).toBe(owner.user.id);
    });

    it('never exposes internal columns such as the owner user id', async () => {
      const { body } = await ctx.createEnterprise(owner.accessToken, 'leak');
      expect(Object.keys(body).sort()).toEqual(
        [
          'id',
          'referenceNumber',
          'name',
          'tradeName',
          'businessType',
          'registrationNumber',
          'registrationNumberType',
          'sector',
          'address',
          'website',
          'contactPersonName',
          'contactPersonMobile',
          'createdAt',
          'updatedAt',
          'accessType',
        ].sort(),
      );
      expect(JSON.stringify(body)).not.toContain(owner.user.id);
    });

    it('generates a distinct reference number for every enterprise', async () => {
      const a = await ctx.createEnterprise(owner.accessToken, 'ref-a');
      const b = await ctx.createEnterprise(owner.accessToken, 'ref-b');
      expect(a.referenceNumber).not.toBe(b.referenceNumber);
    });

    it('trims surrounding whitespace before storing', async () => {
      const { id } = await ctx.createEnterprise(owner.accessToken, 'trim', {
        name: '   Trimmed Works Ltd   ',
        sector: '  Textiles ',
      });
      const row = await ctx.prisma.enterprise.findUniqueOrThrow({
        where: { id },
      });
      expect(row.name).toBe('Trimmed Works Ltd');
      expect(row.sector).toBe('Textiles');
    });

    it.each([
      'name',
      'businessType',
      'registrationNumber',
      'registrationNumberType',
      'address',
      'sector',
    ])(
      'rejects a body missing the mandatory field %s with 400 VALIDATION_ERROR',
      async (field) => {
        const payload = ctx.enterprisePayload('missing');
        delete payload[field];
        const res = await as(owner.accessToken)
          .post('/enterprises')
          .send(payload)
          .expect(400);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
        expect(Object.keys(res.body.error.fields ?? {})).toContain(field);
      },
    );

    it('rejects a whitespace-only mandatory field, a bad website and a bad contact mobile', async () => {
      for (const bad of [
        { name: '     ' },
        { website: 'not a url' },
        { website: 'javascript:alert(1)' },
        { contactPersonMobile: '12ab' },
      ]) {
        await as(owner.accessToken)
          .post('/enterprises')
          .send(ctx.enterprisePayload('bad', bad))
          .expect(400);
      }
    });

    it('rejects client attempts to set ownership or the reference number', async () => {
      for (const extra of [
        { ownerUserId: other.user.id },
        { owner_user_id: other.user.id },
        { referenceNumber: 'ENT-2026-999999' },
        { id: randomUUID() },
      ]) {
        const res = await as(owner.accessToken)
          .post('/enterprises')
          .send(ctx.enterprisePayload('mass', extra))
          .expect(400);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
      }
      const stolen = await ctx.prisma.enterprise.count({
        where: { ownerUserId: other.user.id },
      });
      expect(stolen).toBe(0);
    });

    it('requires authentication', async () => {
      await request(ctx.http)
        .post(`${API}/enterprises`)
        .send(ctx.enterprisePayload('anon'))
        .expect(401);
    });

    it('is restricted to the APPLICANT role: an MFA-verified officer gets 403 INSUFFICIENT_ROLE and nothing is created', async () => {
      const officer = await ctx.registerWithRole(
        'ent-officer',
        'SCRUTINY_OFFICER',
      );
      // Public registration always grants APPLICANT; model a staff-only
      // account by removing it (a user who is BOTH applicant and officer is
      // legitimately allowed to use applicant endpoints).
      await ctx.prisma.userRole.deleteMany({
        where: { userId: officer.id, role: { code: 'APPLICANT' } },
      });
      const { accessToken } = await ctx.fullMfaSession(officer);
      const res = await as(accessToken)
        .post('/enterprises')
        .send(ctx.enterprisePayload('officer'))
        .expect(403);
      expect(res.body.error.code).toBe('INSUFFICIENT_ROLE');
      await as(accessToken).get('/enterprises').expect(403);
      expect(
        await ctx.prisma.enterprise.count({
          where: { ownerUserId: officer.id },
        }),
      ).toBe(0);
    });

    it('audits the creation with the actor, the entity and no sensitive data', async () => {
      const { id, referenceNumber } = await ctx.createEnterprise(
        owner.accessToken,
        'audit',
      );
      const rows = await ctx.prisma.auditLog.findMany({
        where: { entityId: id, action: 'ENTERPRISE_CREATED' },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        userId: owner.user.id,
        entityType: 'Enterprise',
        roleAtTime: 'APPLICANT',
      });
      expect(rows[0].afterState).toMatchObject({ referenceNumber });
      expect(JSON.stringify(rows[0]).toLowerCase()).not.toMatch(
        /password|secret|token|hash/,
      );
    });
  });

  describe('GET /enterprises and GET /enterprises/:id', () => {
    it('lists only the caller’s own enterprises', async () => {
      const mine = await ctx.createEnterprise(owner.accessToken, 'list-mine');
      const theirs = await ctx.createEnterprise(
        other.accessToken,
        'list-theirs',
      );

      const ownerList = await as(owner.accessToken)
        .get('/enterprises')
        .expect(200);
      const ids = ownerList.body.map((e: { id: string }) => e.id);
      expect(ids).toContain(mine.id);
      expect(ids).not.toContain(theirs.id);
      expect(
        ownerList.body.every(
          (e: { accessType: string }) => e.accessType === 'OWNER',
        ),
      ).toBe(true);

      const otherList = await as(other.accessToken)
        .get('/enterprises')
        .expect(200);
      const otherIds = otherList.body.map((e: { id: string }) => e.id);
      expect(otherIds).toContain(theirs.id);
      expect(otherIds).not.toContain(mine.id);
    });

    it('lets the owner read their enterprise', async () => {
      const { id, body } = await ctx.createEnterprise(
        owner.accessToken,
        'get-own',
      );
      const res = await as(owner.accessToken)
        .get(`/enterprises/${id}`)
        .expect(200);
      expect(res.body).toMatchObject({
        id,
        name: body.name,
        accessType: 'OWNER',
      });
    });

    it('returns an identical 404 for another user’s enterprise, a nonexistent id and a malformed id (no probing)', async () => {
      const { id } = await ctx.createEnterprise(
        owner.accessToken,
        'get-foreign',
      );

      const foreign = await as(other.accessToken)
        .get(`/enterprises/${id}`)
        .expect(404);
      const missing = await as(other.accessToken)
        .get(`/enterprises/${randomUUID()}`)
        .expect(404);
      const malformed = await as(other.accessToken)
        .get('/enterprises/not-a-uuid')
        .expect(404);

      for (const res of [foreign, missing, malformed]) {
        expect(res.body.error.code).toBe('NOT_FOUND');
      }
      expect(foreign.body.error.message).toBe(missing.body.error.message);
      expect(foreign.body.error.message).toBe(malformed.body.error.message);
      expect(JSON.stringify(foreign.body)).not.toContain(id);
    });

    it('requires authentication', async () => {
      const { id } = await ctx.createEnterprise(owner.accessToken, 'get-anon');
      await request(ctx.http).get(`${API}/enterprises/${id}`).expect(401);
      await request(ctx.http).get(`${API}/enterprises`).expect(401);
    });
  });

  describe('PUT /enterprises/:id', () => {
    it('lets the owner update fields, refreshes updatedAt and audits only what changed', async () => {
      const { id, body } = await ctx.createEnterprise(owner.accessToken, 'upd');
      const res = await as(owner.accessToken)
        .put(`/enterprises/${id}`)
        .send({
          sector: 'Textiles',
          address: '  New Address, Nashik 422001  ',
          tradeName: 'NewTrade',
        })
        .expect(200);

      expect(res.body).toMatchObject({
        sector: 'Textiles',
        address: 'New Address, Nashik 422001',
        tradeName: 'NewTrade',
        name: body.name,
        referenceNumber: body.referenceNumber,
      });
      expect(new Date(res.body.updatedAt).getTime()).toBeGreaterThanOrEqual(
        new Date(body.updatedAt).getTime(),
      );

      const audit = await ctx.prisma.auditLog.findMany({
        where: { entityId: id, action: 'ENTERPRISE_UPDATED' },
      });
      expect(audit).toHaveLength(1);
      expect(audit[0].userId).toBe(owner.user.id);
      expect(audit[0].beforeState).toEqual({
        sector: 'Engineering',
        address: 'Plot 14, MIDC Chakan, Pune, Maharashtra 410501',
        tradeName: null,
      });
      expect(audit[0].afterState).toEqual({
        sector: 'Textiles',
        address: 'New Address, Nashik 422001',
        tradeName: 'NewTrade',
      });
    });

    it('can clear optional fields with null but never a mandatory field', async () => {
      const { id } = await ctx.createEnterprise(owner.accessToken, 'clear', {
        tradeName: 'Temp Trade',
        website: 'https://temp.example.com',
      });
      const cleared = await as(owner.accessToken)
        .put(`/enterprises/${id}`)
        .send({ tradeName: null, website: null })
        .expect(200);
      expect(cleared.body.tradeName).toBeNull();
      expect(cleared.body.website).toBeNull();

      for (const field of ['name', 'sector', 'address', 'registrationNumber']) {
        await as(owner.accessToken)
          .put(`/enterprises/${id}`)
          .send({ [field]: null })
          .expect(400);
      }
    });

    it('rejects an empty body, invalid values, and attempts to change ownership or the reference number', async () => {
      const { id, referenceNumber } = await ctx.createEnterprise(
        owner.accessToken,
        'upd-bad',
      );
      await as(owner.accessToken)
        .put(`/enterprises/${id}`)
        .send({})
        .expect(400);
      await as(owner.accessToken)
        .put(`/enterprises/${id}`)
        .send({ name: ' ' })
        .expect(400);
      await as(owner.accessToken)
        .put(`/enterprises/${id}`)
        .send({ website: 'nope' })
        .expect(400);
      for (const extra of [
        { ownerUserId: other.user.id },
        { referenceNumber: 'ENT-2026-000000' },
        { id: randomUUID() },
      ]) {
        await as(owner.accessToken)
          .put(`/enterprises/${id}`)
          .send({ sector: 'X1', ...extra })
          .expect(400);
      }
      const row = await ctx.prisma.enterprise.findUniqueOrThrow({
        where: { id },
      });
      expect(row.ownerUserId).toBe(owner.user.id);
      expect(row.referenceNumber).toBe(referenceNumber);
      expect(row.sector).toBe('Engineering');
    });

    it('a no-op update succeeds without writing an audit entry', async () => {
      const { id } = await ctx.createEnterprise(owner.accessToken, 'noop');
      await as(owner.accessToken)
        .put(`/enterprises/${id}`)
        .send({ sector: 'Engineering' })
        .expect(200);
      expect(
        await ctx.prisma.auditLog.count({
          where: { entityId: id, action: 'ENTERPRISE_UPDATED' },
        }),
      ).toBe(0);
    });

    it('denies another user with 404 and leaves the enterprise untouched', async () => {
      const { id, body } = await ctx.createEnterprise(
        owner.accessToken,
        'upd-foreign',
      );
      const res = await as(other.accessToken)
        .put(`/enterprises/${id}`)
        .send({ name: 'Hijacked Ltd', sector: 'Hijacked' })
        .expect(404);
      expect(res.body.error.code).toBe('NOT_FOUND');

      const row = await ctx.prisma.enterprise.findUniqueOrThrow({
        where: { id },
      });
      expect(row.name).toBe(body.name);
      expect(row.ownerUserId).toBe(owner.user.id);
      expect(
        await ctx.prisma.auditLog.count({
          where: { entityId: id, action: 'ENTERPRISE_UPDATED' },
        }),
      ).toBe(0);
    });

    it('requires authentication', async () => {
      const { id } = await ctx.createEnterprise(owner.accessToken, 'upd-anon');
      await request(ctx.http)
        .put(`${API}/enterprises/${id}`)
        .send({ sector: 'X1' })
        .expect(401);
    });
  });

  describe('there is no way to take over or delete an enterprise', () => {
    it('exposes no delete route and no ownership-transfer route', async () => {
      const { id } = await ctx.createEnterprise(owner.accessToken, 'norot');
      for (const [method, url] of [
        ['delete', `${API}/enterprises/${id}`],
        ['patch', `${API}/enterprises/${id}`],
        ['post', `${API}/enterprises/${id}/owner`],
        ['put', `${API}/enterprises/${id}/owner`],
      ] as const) {
        const res = await (request(ctx.http) as any)
          [method](url)
          .set('Authorization', `Bearer ${other.accessToken}`)
          .send({ ownerUserId: other.user.id });
        expect([404, 405]).toContain(res.status);
      }
      const row = await ctx.prisma.enterprise.findUniqueOrThrow({
        where: { id },
      });
      expect(row.ownerUserId).toBe(owner.user.id);
    });
  });

  describe('Swagger', () => {
    it('documents the enterprise endpoints with bearer auth and exposes no internal fields in schemas', async () => {
      const { body } = await request(ctx.http)
        .get('/api/docs-json')
        .expect(200);
      const schemas = body.components.schemas as Record<
        string,
        { properties?: Record<string, unknown> }
      >;

      for (const [path, methods] of [
        [`${API}/enterprises`, ['post', 'get']],
        [`${API}/enterprises/{enterpriseId}`, ['get', 'put']],
      ] as const) {
        for (const method of methods) {
          expect(body.paths[path][method].security).toBeDefined();
        }
      }
      for (const name of [
        'EnterpriseResponseDto',
        'RepresentativeResponseDto',
        'MyAuthorisationResponseDto',
      ]) {
        expect(schemas[name]).toBeDefined();
        const props = Object.keys(schemas[name].properties ?? {});
        expect(props).not.toContain('ownerUserId');
        expect(props).not.toContain('representativeUserId');
        for (const prop of props) {
          expect(prop).not.toMatch(/password|hash|secret|token/i);
        }
      }
      const createProps = Object.keys(
        schemas.CreateEnterpriseDto.properties ?? {},
      );
      expect(createProps).not.toContain('ownerUserId');
      expect(createProps).not.toContain('referenceNumber');
    });
  });
});
