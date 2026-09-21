import request from 'supertest';
import { API, E2eContext, createE2eContext } from './support/e2e-helpers';
import { as } from './support/officer-world';
import {
  PublishedScheme,
  SchemeWorld,
  buildSchemeWorld,
  publishScheme,
  schemeBody,
} from './support/scheme-world';

jest.setTimeout(600_000);

/**
 * Step 16 - the scheme catalogue: drafting, the publish / approval control, the
 * freeze on what was published, public browsing, and who may do what - over real
 * HTTP -> Nest -> Prisma -> PostgreSQL. Departments, schemes, rules and every
 * value are labelled test fixtures; nothing statutory is seeded or assumed.
 */
describe('Schemes e2e - catalogue, publication and browsing', () => {
  let ctx: E2eContext;
  let w: SchemeWorld;

  const api = (a: { accessToken: string }) => as(ctx, a.accessToken);
  const errorCode = (res: { body: { error?: { code?: string } } }) =>
    res.body.error?.code;
  const publicGet = (path: string) => request(ctx.http).get(`${API}${path}`);
  const draft = async (over: Record<string, unknown> = {}) =>
    (
      await api(w.soA)
        .post('/scheme-officer/schemes')
        .send(schemeBody(ctx, w.deptA.id, over))
        .expect(201)
    ).body;
  const audits = (entityId: string, action: string) =>
    ctx.prisma.auditLog.findMany({
      where: { entityId, action },
      orderBy: { createdAt: 'asc' },
    });

  beforeAll(async () => {
    ctx = await createE2eContext();
    w = await buildSchemeWorld(ctx, 'sc');
  });

  afterAll(async () => {
    await ctx.cleanup();
    await ctx.app.close();
  });

  describe('drafting', () => {
    it('a Scheme Officer drafts an entry: DRAFT, version 1, server-set identity, no default benefit or deadline', async () => {
      const res = await api(w.soA)
        .post('/scheme-officer/schemes')
        .send(schemeBody(ctx, w.deptA.id))
        .expect(201);
      expect(res.body).toMatchObject({
        publishStatus: 'DRAFT',
        isActive: true,
        version: 1,
        createdByUserId: w.soA.user.id,
        publishedAt: null,
        publishedByUserId: null,
        benefitType: null,
        applicationDeadline: null,
        sourceReference: null,
        applicableSectors: [],
        applicableDistricts: [],
        applicableEnterpriseSizes: [],
        rules: [],
        documentRequirements: [],
        capabilities: {
          canMaintain: true,
          canPublish: false,
          canWithdraw: true,
        },
      });
    });

    it('takes no status, version, creator or publisher from the client', async () => {
      for (const forbidden of [
        { publishStatus: 'PUBLISHED' },
        { isActive: false },
        { version: 9 },
        { createdByUserId: w.owner.user.id },
        { publishedByUserId: w.owner.user.id },
      ]) {
        const res = await api(w.soA)
          .post('/scheme-officer/schemes')
          .send(schemeBody(ctx, w.deptA.id, forbidden))
          .expect(400);
        expect(errorCode(res)).toBe('VALIDATION_ERROR');
      }
    });

    it('validates the body: required text, deadline instant, facet lists, benefit type', async () => {
      for (const bad of [
        { name: '   ' },
        { description: '' },
        { benefits: undefined },
        { eligibilityCriteria: undefined },
        { applicationDeadline: 'next tuesday' },
        { applicableSectors: 'not-a-list' },
        { applicableDistricts: [1, 2] },
        { benefitType: '' },
      ]) {
        await api(w.soA)
          .post('/scheme-officer/schemes')
          .send(schemeBody(ctx, w.deptA.id, bad))
          .expect(400);
      }
    });

    it('trims and de-duplicates facet lists', async () => {
      const res = await api(w.soA)
        .post('/scheme-officer/schemes')
        .send(
          schemeBody(ctx, w.deptA.id, {
            applicableDistricts: [' Pune ', 'Pune', 'Nashik'],
          }),
        )
        .expect(201);
      expect(res.body.applicableDistricts).toEqual(['Pune', 'Nashik']);
    });

    it('edits a draft, bumps its version and audits before / after', async () => {
      const s = await draft();
      const res = await api(w.soA)
        .put(`/scheme-officer/schemes/${s.id}`)
        .send({
          benefits: 'Revised test-fixture benefit text.',
          benefitType: 'Test type',
          applicationDeadline: '2099-01-01T00:00:00.000Z',
        })
        .expect(200);
      expect(res.body).toMatchObject({
        version: 2,
        benefits: 'Revised test-fixture benefit text.',
        benefitType: 'Test type',
        applicationDeadline: '2099-01-01T00:00:00.000Z',
      });
      const [event] = await audits(s.id, 'SCHEME_UPDATED');
      expect(event).toMatchObject({
        userId: w.soA.user.id,
        roleAtTime: 'SCHEME_OFFICER',
        entityType: 'Scheme',
      });
      expect(event.beforeState).toMatchObject({
        benefits: s.benefits,
        version: 1,
        benefitType: null,
      });
      expect(event.afterState).toMatchObject({
        benefits: 'Revised test-fixture benefit text.',
        version: 2,
        benefitType: 'Test type',
        departmentId: w.deptA.id,
      });
      // a null clears a nullable field
      const cleared = await api(w.soA)
        .put(`/scheme-officer/schemes/${s.id}`)
        .send({ benefitType: null, applicationDeadline: null })
        .expect(200);
      expect(cleared.body).toMatchObject({
        benefitType: null,
        applicationDeadline: null,
        version: 3,
      });
    });

    it('refuses an edit that changes nothing, and any change to the department', async () => {
      const s = await draft();
      const same = await api(w.soA)
        .put(`/scheme-officer/schemes/${s.id}`)
        .send({ name: s.name })
        .expect(400);
      expect(errorCode(same)).toBe('VALIDATION_ERROR');
      await api(w.soA)
        .put(`/scheme-officer/schemes/${s.id}`)
        .send({ departmentId: w.deptB.id })
        .expect(400);
    });

    it('audits creation with actor, role and the full entry', async () => {
      const s = await draft({ benefitType: 'Test type' });
      const [event] = await audits(s.id, 'SCHEME_CREATED');
      expect(event).toMatchObject({
        userId: w.soA.user.id,
        roleAtTime: 'SCHEME_OFFICER',
        entityType: 'Scheme',
        beforeState: null,
      });
      expect(event.afterState).toMatchObject({
        schemeId: s.id,
        departmentId: w.deptA.id,
        name: s.name,
        publishStatus: 'DRAFT',
        benefitType: 'Test type',
      });
    });
  });

  describe('eligibility rule versions', () => {
    it('validates a rule against the closed grammar and refuses an invalid one', async () => {
      const s = await draft();
      for (const bad of [
        { field: 'not_a_field', op: 'equals', value: 1 },
        { field: 'district', op: 'matches', value: 'x' },
        { all: [] },
        { field: 'investment_amount', op: 'between', value: [9, 1] },
      ]) {
        const res = await api(w.soA)
          .post(`/scheme-officer/schemes/${s.id}/rules`)
          .send({ conditions: bad, sourceReference: 'TBD' })
          .expect(400);
        expect(errorCode(res)).toBe('INVALID_RULE_DEFINITION');
      }
      const detail = await api(w.soA)
        .get(`/scheme-officer/schemes/${s.id}`)
        .expect(200);
      expect(detail.body.rules).toEqual([]);
    });

    it('needs a source reference (the literal "TBD" is accepted, never a guess)', async () => {
      const s = await draft();
      const conditions = { field: 'district', op: 'equals', value: 'Pune' };
      await api(w.soA)
        .post(`/scheme-officer/schemes/${s.id}/rules`)
        .send({ conditions })
        .expect(400);
      await api(w.soA)
        .post(`/scheme-officer/schemes/${s.id}/rules`)
        .send({ conditions, sourceReference: 'ab' })
        .expect(400);
      await api(w.soA)
        .post(`/scheme-officer/schemes/${s.id}/rules`)
        .send({ conditions, sourceReference: 'TBD' })
        .expect(201);
    });

    it('adds immutable, sequentially numbered versions, and audits each with the rule version', async () => {
      const s = await draft();
      const conditions = { field: 'district', op: 'equals', value: 'Pune' };
      const v1 = await api(w.soA)
        .post(`/scheme-officer/schemes/${s.id}/rules`)
        .send({ conditions, sourceReference: 'E2E TEST FIXTURE', priority: 5 })
        .expect(201);
      const v2 = await api(w.soA)
        .post(`/scheme-officer/schemes/${s.id}/rules`)
        .send({
          conditions: { field: 'district', op: 'equals', value: 'Nashik' },
          sourceReference: 'E2E TEST FIXTURE',
          isActive: false,
        })
        .expect(201);
      expect(v1.body).toMatchObject({
        version: 1,
        priority: 5,
        isActive: true,
      });
      expect(v2.body).toMatchObject({
        version: 2,
        priority: 100,
        isActive: false,
      });
      const [event] = await audits(s.id, 'SCHEME_RULE_VERSION_ADDED');
      expect(event.ruleVersionUsed).toBe(`${v1.body.id}@v1`);
      expect(event.afterState).toMatchObject({ conditions, version: 1 });

      // history is never rewritten: PostgreSQL itself refuses an UPDATE
      await expect(
        ctx.prisma
          .$executeRaw`UPDATE scheme_rules SET priority = 1 WHERE id = ${v1.body.id}::uuid`,
      ).rejects.toThrow();
    });

    it('refuses dates out of order', async () => {
      const s = await draft();
      const conditions = { field: 'district', op: 'equals', value: 'Pune' };
      const now = Date.now();
      const first = await api(w.soA)
        .post(`/scheme-officer/schemes/${s.id}/rules`)
        .send({
          conditions,
          sourceReference: 'TBD',
          effectiveFrom: new Date(now).toISOString(),
        })
        .expect(201);
      expect(first.body.version).toBe(1);
      const before = await api(w.soA)
        .post(`/scheme-officer/schemes/${s.id}/rules`)
        .send({
          conditions,
          sourceReference: 'TBD',
          effectiveFrom: new Date(now - 86_400_000).toISOString(),
        })
        .expect(400);
      expect(errorCode(before)).toBe('INVALID_EFFECTIVE_DATES');
      const inverted = await api(w.soA)
        .post(`/scheme-officer/schemes/${s.id}/rules`)
        .send({
          conditions,
          sourceReference: 'TBD',
          effectiveFrom: new Date(now + 2 * 86_400_000).toISOString(),
          effectiveTo: new Date(now + 86_400_000).toISOString(),
        })
        .expect(400);
      expect(errorCode(inverted)).toBe('INVALID_EFFECTIVE_DATES');
    });
  });

  describe('required documents', () => {
    it('adds, changes and removes a requirement on a draft, audited', async () => {
      const s = await draft();
      const created = await api(w.soA)
        .post(`/scheme-officer/schemes/${s.id}/document-requirements`)
        .send({
          name: 'Test document',
          isMandatory: true,
          allowedMimeTypes: ['application/pdf'],
          maxSizeBytes: 1000,
        })
        .expect(201);
      expect(created.body).toMatchObject({
        name: 'Test document',
        isMandatory: true,
        description: null,
        maxSizeBytes: 1000,
        allowedMimeTypes: ['application/pdf'],
      });
      const updated = await api(w.soA)
        .put(
          `/scheme-officer/schemes/${s.id}/document-requirements/${created.body.id}`,
        )
        .send({
          isMandatory: false,
          description: 'Plain words',
          maxSizeBytes: null,
        })
        .expect(200);
      expect(updated.body).toMatchObject({
        isMandatory: false,
        description: 'Plain words',
        maxSizeBytes: null,
      });
      await api(w.soA)
        .put(
          `/scheme-officer/schemes/${s.id}/document-requirements/${created.body.id}`,
        )
        .send({ isMandatory: false })
        .expect(400);
      await api(w.soA)
        .del(
          `/scheme-officer/schemes/${s.id}/document-requirements/${created.body.id}`,
        )
        .expect(204);
      const detail = await api(w.soA)
        .get(`/scheme-officer/schemes/${s.id}`)
        .expect(200);
      expect(detail.body.documentRequirements).toEqual([]);
      for (const action of [
        'SCHEME_DOCUMENT_REQUIREMENT_ADDED',
        'SCHEME_DOCUMENT_REQUIREMENT_UPDATED',
        'SCHEME_DOCUMENT_REQUIREMENT_REMOVED',
      ]) {
        expect(await audits(s.id, action)).toHaveLength(1);
      }
    });

    it('validates a requirement (name, size, only supported content types)', async () => {
      const s = await draft();
      for (const bad of [
        { isMandatory: true },
        { name: 'x' },
        { name: 'x', isMandatory: true, maxSizeBytes: 0 },
        { name: 'x', isMandatory: true, allowedMimeTypes: ['application/zip'] },
      ]) {
        await api(w.soA)
          .post(`/scheme-officer/schemes/${s.id}/document-requirements`)
          .send(bad)
          .expect(400);
      }
    });

    it('a requirement is found only through its own scheme', async () => {
      const a = await draft();
      const b = await draft();
      const req = await api(w.soA)
        .post(`/scheme-officer/schemes/${a.id}/document-requirements`)
        .send({ name: 'Test document', isMandatory: false })
        .expect(201);
      await api(w.soA)
        .put(
          `/scheme-officer/schemes/${b.id}/document-requirements/${req.body.id}`,
        )
        .send({ name: 'Renamed' })
        .expect(404);
      await api(w.soA)
        .del(
          `/scheme-officer/schemes/${b.id}/document-requirements/${req.body.id}`,
        )
        .expect(404);
    });
  });

  describe('publication control (FRD 34: subject to a publish / approval step)', () => {
    let s: PublishedScheme;

    beforeAll(async () => {
      s = await publishScheme(ctx, w, { publish: false });
    });

    it('a draft is invisible to the public and to applicants', async () => {
      await publicGet(`/schemes/${s.id}`).expect(404);
      const list = await publicGet(
        `/schemes?q=${encodeURIComponent(s.name)}`,
      ).expect(200);
      expect(list.body.items).toEqual([]);
    });

    it('the drafting Scheme Officer cannot publish (default publisher: the Department Administrator)', async () => {
      const res = await api(w.soA)
        .post(`/scheme-officer/schemes/${s.id}/publish`)
        .expect(403);
      expect(errorCode(res)).toBe('INSUFFICIENT_PERMISSION');
    });

    it("another department's administrator cannot publish it (and cannot see it)", async () => {
      await api(w.adminB)
        .post(`/scheme-officer/schemes/${s.id}/publish`)
        .expect(404);
    });

    it('a Legal / Compliance user cannot publish unless the deployment names that role', async () => {
      await api(w.legal)
        .post(`/scheme-officer/schemes/${s.id}/publish`)
        .expect(404);
    });

    it('the department’s administrator publishes it, audited with who drafted and who published', async () => {
      const res = await api(w.adminA)
        .post(`/scheme-officer/schemes/${s.id}/publish`)
        .expect(200);
      expect(res.body).toMatchObject({
        publishStatus: 'PUBLISHED',
        publishedByUserId: w.adminA.user.id,
        capabilities: {
          canMaintain: false,
          canPublish: true,
          canWithdraw: true,
        },
      });
      expect(res.body.publishedAt).toEqual(expect.any(String));
      const [event] = await audits(s.id, 'SCHEME_PUBLISHED');
      expect(event).toMatchObject({
        userId: w.adminA.user.id,
        roleAtTime: 'DEPT_ADMIN',
        entityType: 'Scheme',
      });
      expect(event.beforeState).toMatchObject({ publishStatus: 'DRAFT' });
      expect(event.afterState).toMatchObject({
        publishStatus: 'PUBLISHED',
        draftedByUserId: w.soA.user.id,
        departmentId: w.deptA.id,
        ruleVersions: [{ id: s.ruleId, version: 1 }],
      });
      // publishing twice is refused
      const again = await api(w.adminA)
        .post(`/scheme-officer/schemes/${s.id}/publish`)
        .expect(409);
      expect(errorCode(again)).toBe('SCHEME_ALREADY_PUBLISHED');
    });

    it('a published scheme is visible without an account, and shows nothing internal', async () => {
      const res = await publicGet(`/schemes/${s.id}`).expect(200);
      expect(res.body).toMatchObject({
        id: s.id,
        name: s.name,
        department: { id: w.deptA.id, code: w.deptA.code },
        applicationOpen: true,
        documentRequirements: [],
      });
      for (const internal of [
        'rules',
        'publishStatus',
        'isActive',
        'createdByUserId',
        'publishedByUserId',
        'version',
        'capabilities',
        'conditions',
      ]) {
        expect(res.body).not.toHaveProperty(internal);
      }
      expect(JSON.stringify(res.body)).not.toContain(w.soA.user.id);
    });

    it('is frozen: content, rules and requirements cannot change while published', async () => {
      const edit = await api(w.soA)
        .put(`/scheme-officer/schemes/${s.id}`)
        .send({ benefits: 'Sneaky change' })
        .expect(409);
      expect(errorCode(edit)).toBe('SCHEME_NOT_EDITABLE');
      const rule = await api(w.soA)
        .post(`/scheme-officer/schemes/${s.id}/rules`)
        .send({
          conditions: { field: 'district', op: 'equals', value: 'Pune' },
          sourceReference: 'TBD',
        })
        .expect(409);
      expect(errorCode(rule)).toBe('SCHEME_NOT_EDITABLE');
      const req = await api(w.soA)
        .post(`/scheme-officer/schemes/${s.id}/document-requirements`)
        .send({ name: 'Sneaky', isMandatory: true })
        .expect(409);
      expect(errorCode(req)).toBe('SCHEME_NOT_EDITABLE');
      // ...and PostgreSQL itself agrees, below the application
      await expect(
        ctx.prisma
          .$executeRaw`UPDATE schemes SET benefits = 'x' WHERE id = ${s.id}::uuid`,
      ).rejects.toThrow();
      await expect(
        ctx.prisma
          .$executeRaw`INSERT INTO scheme_rules (scheme_id, version, effective_from, conditions, source_reference, created_by_user_id) VALUES (${s.id}::uuid, 9, now(), '{}'::jsonb, 'x', ${w.soA.user.id}::uuid)`,
      ).rejects.toThrow();
      await expect(
        ctx.prisma
          .$executeRaw`INSERT INTO scheme_document_requirements (scheme_id, name, is_mandatory) VALUES (${s.id}::uuid, 'x', true)`,
      ).rejects.toThrow();
    });

    it('returning it to draft hides it, allows editing, and needs publishing again', async () => {
      const unpublished = await api(w.soA)
        .post(`/scheme-officer/schemes/${s.id}/unpublish`)
        .expect(200);
      expect(unpublished.body).toMatchObject({
        publishStatus: 'DRAFT',
        publishedAt: null,
        publishedByUserId: null,
      });
      await publicGet(`/schemes/${s.id}`).expect(404);
      const [event] = await audits(s.id, 'SCHEME_UNPUBLISHED');
      expect(event).toMatchObject({
        userId: w.soA.user.id,
        roleAtTime: 'SCHEME_OFFICER',
      });
      expect(event.beforeState).toMatchObject({ publishStatus: 'PUBLISHED' });

      await api(w.soA)
        .put(`/scheme-officer/schemes/${s.id}`)
        .send({ benefits: 'Revised after approval' })
        .expect(200);
      const again = await api(w.soA)
        .post(`/scheme-officer/schemes/${s.id}/unpublish`)
        .expect(409);
      expect(errorCode(again)).toBe('SCHEME_NOT_PUBLISHED');
      await api(w.adminA)
        .post(`/scheme-officer/schemes/${s.id}/publish`)
        .expect(200);
      const back = await publicGet(`/schemes/${s.id}`).expect(200);
      expect(back.body.benefits).toBe('Revised after approval');
    });

    it('a deactivated scheme is hidden and re-appears unchanged when reactivated', async () => {
      const off = await api(w.soA)
        .put(`/scheme-officer/schemes/${s.id}/active`)
        .send({ isActive: false })
        .expect(200);
      expect(off.body).toMatchObject({
        isActive: false,
        publishStatus: 'PUBLISHED',
      });
      await publicGet(`/schemes/${s.id}`).expect(404);
      const noop = await api(w.soA)
        .put(`/scheme-officer/schemes/${s.id}/active`)
        .send({ isActive: false })
        .expect(400);
      expect(errorCode(noop)).toBe('VALIDATION_ERROR');
      await api(w.adminA)
        .put(`/scheme-officer/schemes/${s.id}/active`)
        .send({ isActive: true })
        .expect(200);
      const back = await publicGet(`/schemes/${s.id}`).expect(200);
      expect(back.body.benefits).toBe('Revised after approval');
      const events = await audits(s.id, 'SCHEME_ACTIVATION_CHANGED');
      expect(events.map((e) => e.afterState)).toEqual([
        expect.objectContaining({ isActive: false }),
        expect.objectContaining({ isActive: true }),
      ]);
    });
  });

  describe('who may reach the catalogue administration', () => {
    let s: PublishedScheme;

    beforeAll(async () => {
      s = await publishScheme(ctx, w, { publish: false });
    });

    it("another department's Scheme Officer sees and can do nothing to it (404, not 403)", async () => {
      await api(w.soB).get(`/scheme-officer/schemes/${s.id}`).expect(404);
      await api(w.soB)
        .put(`/scheme-officer/schemes/${s.id}`)
        .send({ benefits: 'x' })
        .expect(404);
      await api(w.soB)
        .post(`/scheme-officer/schemes/${s.id}/rules`)
        .send({
          conditions: { field: 'district', op: 'equals', value: 'x' },
          sourceReference: 'TBD',
        })
        .expect(404);
      await api(w.soB)
        .post(`/scheme-officer/schemes/${s.id}/unpublish`)
        .expect(404);
      const list = await api(w.soB).get('/scheme-officer/schemes').expect(200);
      expect(list.body.items.map((i: { id: string }) => i.id)).not.toContain(
        s.id,
      );
    });

    it('cannot draft into a department the caller is not a Scheme Officer of', async () => {
      await api(w.soA)
        .post('/scheme-officer/schemes')
        .send(schemeBody(ctx, w.deptB.id))
        .expect(404);
      await api(w.adminA)
        .post('/scheme-officer/schemes')
        .send(schemeBody(ctx, w.deptA.id))
        .expect(404);
    });

    it('the publisher can read a draft to review it, but cannot edit it (403, least privilege)', async () => {
      const seen = await api(w.adminA)
        .get(`/scheme-officer/schemes/${s.id}`)
        .expect(200);
      expect(seen.body.capabilities).toEqual({
        canMaintain: false,
        canPublish: true,
        canWithdraw: true,
      });
      const res = await api(w.adminA)
        .put(`/scheme-officer/schemes/${s.id}`)
        .send({ benefits: 'x' })
        .expect(403);
      expect(errorCode(res)).toBe('INSUFFICIENT_PERMISSION');
      await api(w.adminA)
        .post(`/scheme-officer/schemes/${s.id}/rules`)
        .send({
          conditions: { field: 'district', op: 'equals', value: 'x' },
          sourceReference: 'TBD',
        })
        .expect(403);
    });

    it('the list is scoped to the caller, and filterable', async () => {
      const mine = await api(w.soA).get('/scheme-officer/schemes').expect(200);
      expect(mine.body.items.map((i: { id: string }) => i.id)).toContain(s.id);
      const drafts = await api(w.soA)
        .get('/scheme-officer/schemes?publishStatus=DRAFT')
        .expect(200);
      expect(
        drafts.body.items.every(
          (i: { publishStatus: string; department: { id: string } }) =>
            i.publishStatus === 'DRAFT' && i.department.id === w.deptA.id,
        ),
      ).toBe(true);
      await api(w.soA)
        .get('/scheme-officer/schemes?publishStatus=NOPE')
        .expect(400);
    });

    it('no other role reaches these routes: applicant, scrutiny officer, system administrator, unauthenticated', async () => {
      for (const actor of [w.owner, w.scrutinyA, w.sysAdmin]) {
        const res = await api(actor).get('/scheme-officer/schemes').expect(403);
        expect(errorCode(res)).toBe('INSUFFICIENT_ROLE');
        await api(actor)
          .post('/scheme-officer/schemes')
          .send(schemeBody(ctx, w.deptA.id))
          .expect(403);
        await api(actor)
          .post(`/scheme-officer/schemes/${s.id}/publish`)
          .expect(403);
      }
      await request(ctx.http).get(`${API}/scheme-officer/schemes`).expect(401);
      await request(ctx.http)
        .post(`${API}/scheme-officer/schemes/${s.id}/publish`)
        .expect(401);
    });

    it('a malformed id is a 400, an unknown one a 404', async () => {
      await api(w.soA).get('/scheme-officer/schemes/not-a-uuid').expect(400);
      await api(w.soA)
        .get('/scheme-officer/schemes/00000000-0000-4000-8000-000000000000')
        .expect(404);
    });
  });

  describe('browsing (FRD 29.1 / 29.2)', () => {
    const tag = () => `browse-${Math.random().toString(36).slice(2, 8)}`;
    let keyword: string;
    let pune: PublishedScheme;
    let nashik: PublishedScheme;
    let open: PublishedScheme;
    let closed: PublishedScheme;
    let withDocs: PublishedScheme;

    const names = async (query: string) =>
      (
        await publicGet(`/schemes?q=${keyword}${query}`).expect(200)
      ).body.items.map((i: { name: string }) => i.name);

    beforeAll(async () => {
      keyword = tag();
      const body = (over: Record<string, unknown>) => ({
        name: `${keyword} ${Math.random().toString(36).slice(2, 6)}`,
        ...over,
      });
      pune = await publishScheme(ctx, w, {
        body: body({
          applicableDistricts: ['Pune'],
          applicableSectors: ['25910'],
          applicableEnterpriseSizes: ['small'],
          benefitType: 'Type One',
        }),
      });
      nashik = await publishScheme(ctx, w, {
        department: 'B',
        body: body({
          applicableDistricts: ['Nashik'],
          applicableSectors: ['99999'],
          applicableEnterpriseSizes: ['large'],
          benefitType: 'Type Two',
        }),
      });
      open = await publishScheme(ctx, w, { body: body({}), rule: null });
      closed = await publishScheme(ctx, w, {
        body: body({ applicationDeadline: '2000-01-01T00:00:00.000Z' }),
        rule: null,
      });
      withDocs = await publishScheme(ctx, w, {
        body: body({
          description: `${keyword} plain words`,
          applicationDeadline: '2099-12-31T00:00:00.000Z',
        }),
        rule: null,
        requirements: [
          { name: 'Proof A', isMandatory: true, description: 'Plain words' },
          { name: 'Proof B', isMandatory: false },
        ],
      });
      // a draft with the same keyword must never show
      await publishScheme(ctx, w, { body: body({}), publish: false });
    });

    it('lists only published, active schemes matching the keyword', async () => {
      const found = await names('&pageSize=100');
      expect(found).toEqual(
        expect.arrayContaining([
          pune.name,
          nashik.name,
          open.name,
          closed.name,
          withDocs.name,
        ]),
      );
      expect(found).toHaveLength(5);
    });

    it('filters by location; a scheme that lists no districts stays listed', async () => {
      const found = await names('&district=pune');
      expect(found).toContain(pune.name);
      expect(found).not.toContain(nashik.name);
      expect(found).toEqual(expect.arrayContaining([open.name, closed.name]));
    });

    it('filters by sector, enterprise size and benefit type (case-insensitive)', async () => {
      const sector = await names('&sector=99999');
      expect(sector).toContain(nashik.name);
      expect(sector).not.toContain(pune.name);
      const size = await names('&enterpriseSize=SMALL');
      expect(size).toContain(pune.name);
      expect(size).not.toContain(nashik.name);
      // benefit type is exact: only schemes that HAVE one can match
      expect(await names('&benefitType=type%20two')).toEqual([nashik.name]);
      expect(await names('&benefitType=none')).toEqual([]);
    });

    it('filters by department and pages the result', async () => {
      expect(await names(`&departmentId=${w.deptB.id}`)).toEqual([nashik.name]);
      const page = await publicGet(
        `/schemes?q=${keyword}&pageSize=2&page=2`,
      ).expect(200);
      expect(page.body).toMatchObject({ total: 5, page: 2, pageSize: 2 });
      expect(page.body.items).toHaveLength(2);
    });

    it('searches the keyword in the description too, case-insensitively', async () => {
      const res = await publicGet(
        `/schemes?q=${keyword.toUpperCase()}%20PLAIN`,
      ).expect(200);
      expect(res.body.items.map((i: { name: string }) => i.name)).toEqual([
        withDocs.name,
      ]);
    });

    it('shows required documents and the deadline, and marks a passed deadline as closed', async () => {
      const res = await publicGet(`/schemes/${withDocs.id}`).expect(200);
      expect(res.body.applicationDeadline).toBe('2099-12-31T00:00:00.000Z');
      expect(res.body.applicationOpen).toBe(true);
      expect(res.body.documentRequirements).toEqual([
        expect.objectContaining({
          name: 'Proof A',
          isMandatory: true,
          description: 'Plain words',
        }),
        expect.objectContaining({
          name: 'Proof B',
          isMandatory: false,
          description: null,
        }),
      ]);
      expect(
        (await publicGet(`/schemes/${closed.id}`).expect(200)).body
          .applicationOpen,
      ).toBe(false);
      expect(
        (await publicGet(`/schemes/${open.id}`).expect(200)).body
          .applicationDeadline,
      ).toBeNull();
    });

    it('rejects unknown or malformed query parameters', async () => {
      await publicGet('/schemes?nope=1').expect(400);
      await publicGet('/schemes?pageSize=1000').expect(400);
      await publicGet('/schemes?departmentId=x').expect(400);
      await publicGet('/schemes/not-a-uuid').expect(400);
    });
  });
});
