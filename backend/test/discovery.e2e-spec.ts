import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { API, E2eContext, createE2eContext } from './support/e2e-helpers';

jest.setTimeout(300_000);

interface Actor {
  user: { id: string };
  accessToken: string;
}

/**
 * Approval discovery over real HTTP -> Nest -> Prisma -> PostgreSQL.
 *
 * Rules live in one global table, so other suites' fixtures can coexist with
 * these; every assertion is therefore scoped to the approval types THIS suite
 * created (`mine`). Rules are published through the real service (grammar
 * validation + versioning), never raw inserts — except where a test needs a
 * deliberately malformed stored rule.
 */
describe('Approval discovery e2e — owner: results, versioning, snapshots, immutability', () => {
  let ctx: E2eContext;
  let owner: Actor;
  let enterpriseId: string;
  let projectId: string;

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
  });
  const discover = (pid = projectId, eid = enterpriseId, by: Actor = owner) =>
    as(by.accessToken).post(
      `/enterprises/${eid}/projects/${pid}/discover-approvals`,
    );
  const snapshotUrl = (id: string, pid = projectId, eid = enterpriseId) =>
    `/enterprises/${eid}/projects/${pid}/discoveries/${id}`;

  /** Only this suite's approval types, in the engine's order. */
  // Response bodies are untyped JSON, so these work on `any`.
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const mine = (ids: string[], list: any[]): any[] =>
    list.filter((x) => ids.includes(x.approvalType.id));
  const names = (list: any[]): string[] =>
    list.map((x) => (x.approvalType.name as string).replace(/ [a-z0-9]+$/, ''));

  beforeAll(async () => {
    ctx = await createE2eContext();
    owner = await ctx.applicantSession('disc-owner');
    enterpriseId = (await ctx.createEnterprise(owner.accessToken, 'disc')).id;
    projectId = (
      await ctx.createProjectVia(owner.accessToken, enterpriseId, 'disc', {
        district: 'Pune',
        sectorCode: '25910',
        enterpriseSizeBand: 'small',
        investmentAmount: 5_000_000,
        employmentCount: 40,
        projectStage: 'expansion',
        landStatus: 'leased',
        landLeaseDetails: { lessorName: 'MIDC', leaseTermMonths: 99 },
        hazardousFlag: true,
        hazardousCategory: 'Chemical processing',
      })
    ).id;
  });

  afterAll(async () => {
    await ctx.cleanup();
    await ctx.app.close();
  });

  // -------------------------------------------------------------------------
  describe('POST …/discover-approvals — evaluation', () => {
    let ids: {
      A: string;
      B: string;
      C: string;
      D: string;
      E: string;
      F: string;
      G: string;
      H: string;
    };
    let all: string[];
    let deptCode: string;

    beforeAll(async () => {
      const dept = await ctx.createDepartment('eval');
      deptCode = dept.code;
      const t = async (n: string) => ctx.createApprovalType(dept.id, n);
      ids = {
        A: await t('Alpha'),
        B: await t('Bravo'),
        C: await t('Charlie'),
        D: await t('Delta'),
        E: await t('Echo'),
        F: await t('Foxtrot'),
        G: await t('Golf'),
        H: await t('Hotel'),
      };
      all = Object.values(ids);
      const author = owner.user.id;

      // Matches; officially required; priority 20.
      await ctx.publishRule(
        author,
        ids.A,
        {
          all: [
            { field: 'hazardous_flag', op: 'equals', value: true },
            {
              field: 'project_stage',
              op: 'in',
              value: ['greenfield', 'expansion'],
            },
          ],
        },
        {
          isOfficiallyRequired: true,
          priority: 20,
          sourceReference: 'E2E cite A',
        },
      );
      // Matches (between, inclusive); priority 10 => listed first.
      await ctx.publishRule(
        author,
        ids.B,
        { field: 'employment_count', op: 'between', value: [40, 50] },
        { priority: 10 },
      );
      // Does not match.
      await ctx.publishRule(author, ids.C, {
        field: 'employment_count',
        op: 'gt',
        value: 100,
      });
      // Matches, but excluded (leased land).
      await ctx.publishRule(
        author,
        ids.D,
        { field: 'hazardous_flag', op: 'equals', value: true },
        {
          excludesIf: {
            any: [{ field: 'land_status', op: 'equals', value: 'leased' }],
          },
        },
      );
      // Nested all/any, case-insensitive text; priority 30.
      await ctx.publishRule(
        author,
        ids.E,
        {
          all: [
            {
              any: [
                { field: 'district', op: 'in', value: ['nashik', 'PUNE'] },
                { field: 'sector_code', op: 'equals', value: '00000' },
              ],
            },
            { field: 'investment_amount', op: 'lt', value: 10_000_000 },
          ],
        },
        { priority: 30 },
      );
      // Would match, but the rule is switched off.
      await ctx.publishRule(
        author,
        ids.F,
        { field: 'hazardous_flag', op: 'equals', value: true },
        { isActive: false },
      );
      // Would match, but not effective yet.
      await ctx.publishRule(
        author,
        ids.G,
        { field: 'hazardous_flag', op: 'equals', value: true },
        { effectiveFrom: new Date(Date.now() + 3_600_000) },
      );
      // Would match, but already ended.
      await ctx.publishRule(
        author,
        ids.H,
        { field: 'hazardous_flag', op: 'equals', value: true },
        {
          effectiveFrom: new Date(Date.now() - 7_200_000),
          effectiveTo: new Date(Date.now() - 3_600_000),
        },
      );
    });

    it('returns the applicable approvals in priority order, each with department, exact rule version, label and explanation', async () => {
      const res = await discover().expect(201);
      const applicable = mine(all, res.body.applicable);

      expect(names(applicable)).toEqual(['Bravo', 'Alpha', 'Echo']); // priorities 10, 20, 30
      const [b, a, e] = applicable;

      expect(a).toMatchObject({
        label: 'OFFICIALLY_REQUIRED',
        department: { code: deptCode },
        rule: { version: 1, priority: 20, sourceReference: 'E2E cite A' },
      });
      expect(a.rule.id).toEqual(expect.stringMatching(/^[0-9a-f-]{36}$/));
      expect(a.explanation).toBe(
        'Shown because: hazardous_flag equals true (project value: true); project_stage is one of [greenfield, expansion] (project value: expansion).',
      );
      expect(a.trace).toMatchObject({ kind: 'all', result: true });

      expect(b.label).toBe('POTENTIALLY_APPLICABLE'); // the default (FRD §10.3)
      expect(b.explanation).toBe(
        'Shown because: employment_count is between 40 and 50 (inclusive) (project value: 40).',
      );
      expect(e.explanation).toContain(
        'district is one of [nashik, PUNE] (project value: Pune)',
      );
      expect(e.explanation).toContain(
        'investment_amount is less than 10000000 (project value: 5000000)',
      );
    });

    it('reports rules that did not apply, with the reason — and never lists switched-off, not-yet-effective or ended rules', async () => {
      const res = await discover().expect(201);
      const notApplicable = mine(all, res.body.notApplicable) as Array<{
        approvalType: { name: string };
        reason: string;
        explanation: string;
      }>;

      expect(
        Object.fromEntries(notApplicable.map((n) => [names([n])[0], n.reason])),
      ).toEqual({
        Charlie: 'CONDITIONS_NOT_MET',
        Delta: 'EXCLUDED',
      });
      expect(
        notApplicable.find((n) => n.reason === 'CONDITIONS_NOT_MET')
          ?.explanation,
      ).toBe(
        'Not suggested because: employment_count is greater than 100 (project value: 40).',
      );
      expect(
        notApplicable.find((n) => n.reason === 'EXCLUDED')?.explanation,
      ).toBe(
        'Excluded because: land_status equals leased (project value: leased).',
      );

      const everywhere = [
        ...res.body.applicable,
        ...res.body.notApplicable,
      ].map((x: { approvalType: { id: string } }) => x.approvalType.id);
      for (const skipped of [ids.F, ids.G, ids.H]) {
        expect(everywhere).not.toContain(skipped);
      }
    });

    it('echoes the evaluated characteristics, the discovery timestamp, the engine version and the recommendation-not-determination notice', async () => {
      const before = Date.now();
      const res = await discover().expect(201);
      expect(res.body).toMatchObject({
        projectId,
        engineVersion: '1.0.0',
        inputs: {
          hazardous_flag: true,
          project_stage: 'expansion',
          land_status: 'leased',
          employment_count: 40,
          investment_amount: 5000000,
          district: 'Pune',
          sector_code: '25910',
          enterprise_size_band: 'small',
          industrial_area: null,
          enterprise_type: 'Private Limited Company',
        },
      });
      expect(res.body.projectReferenceNumber).toMatch(/^PRJ-\d{4}-\d{6}$/);
      expect(
        Math.abs(new Date(res.body.evaluatedAt).getTime() - before),
      ).toBeLessThan(60_000);
      expect(res.body.notice).toMatch(
        /not a legal or statutory determination/i,
      );
      expect(res.body.summary.rulesEvaluated).toBe(
        res.body.summary.applicableCount + res.body.summary.notApplicableCount,
      );
      expect(res.body.reproducible).toBeUndefined();
    });

    it('is deterministic: repeated runs return identical applicable and non-applicable results', async () => {
      const strip = (body: any) =>
        JSON.stringify({
          a: mine(all, body.applicable),
          n: mine(all, body.notApplicable),
          i: body.inputs,
        });
      const first = strip((await discover().expect(201)).body);
      for (let i = 0; i < 3; i++) {
        expect(strip((await discover().expect(201)).body)).toBe(first);
      }
    });

    it('exposes only documented fields — no internal ids of users, no rule-author identity', async () => {
      const res = await discover().expect(201);
      expect(Object.keys(res.body).sort()).toEqual(
        [
          'snapshotId',
          'projectId',
          'projectReferenceNumber',
          'evaluatedAt',
          'engineVersion',
          'notice',
          'message',
          'inputs',
          'summary',
          'applicable',
          'notApplicable',
        ].sort(),
      );
      expect(JSON.stringify(res.body)).not.toContain(owner.user.id);
    });
  });

  // -------------------------------------------------------------------------
  describe('versioning and historical correctness', () => {
    let typeId: string;
    let v1: { id: string };
    const type = () => [typeId];

    beforeAll(async () => {
      const dept = await ctx.createDepartment('ver');
      typeId = await ctx.createApprovalType(dept.id, 'Versioned');
      // v1: does NOT match this project (employment 40).
      v1 = await ctx.publishRule(
        owner.user.id,
        typeId,
        { field: 'employment_count', op: 'lt', value: 10 },
        { sourceReference: 'E2E v1' },
      );
    });

    it('a newer version changes future discoveries but never rewrites earlier ones', async () => {
      const first = (await discover().expect(201)).body;
      expect(mine(type(), first.applicable)).toHaveLength(0);
      const before = mine(type(), first.notApplicable)[0] as any;
      expect(before.rule).toMatchObject({ id: v1.id, version: 1 });

      // Publish v2 with a definition that DOES match.
      const v2 = await ctx.publishRule(
        owner.user.id,
        typeId,
        { field: 'employment_count', op: 'gt', value: 10 },
        { sourceReference: 'E2E v2' },
      );
      expect(v2.version).toBe(2);

      const second = (await discover().expect(201)).body;
      const after = mine(type(), second.applicable)[0] as any;
      expect(after.rule).toMatchObject({
        id: v2.id,
        version: 2,
        sourceReference: 'E2E v2',
      });
      expect(mine(type(), second.notApplicable)).toHaveLength(0);

      // The first snapshot still says exactly what it said.
      const reread = (
        await as(owner.accessToken)
          .get(snapshotUrl(first.snapshotId))
          .expect(200)
      ).body;
      expect(mine(type(), reread.applicable)).toHaveLength(0);
      expect((mine(type(), reread.notApplicable)[0] as any).rule).toMatchObject(
        { id: v1.id, version: 1 },
      );
      expect(reread.evaluatedAt).toBe(first.evaluatedAt);
      expect(reread.reproducible).toBe(true);
    });

    it('old versions remain in the table, byte-for-byte, after a newer one is published', async () => {
      const rows = await ctx.prisma.approvalRule.findMany({
        where: { approvalTypeId: typeId },
        orderBy: { version: 'asc' },
      });
      expect(rows.map((r) => r.version)).toEqual([1, 2]);
      expect(rows[0].conditions).toEqual({
        field: 'employment_count',
        op: 'lt',
        value: 10,
      });
      expect(rows[0].effectiveTo).toBeNull(); // superseded by resolution, not by editing the row
    });

    it('the database itself refuses to change a published rule version, or any snapshot', async () => {
      const dbCode = async (op: () => Promise<unknown>) =>
        op().then(
          () => 'no error',
          (e: Error) => e.message,
        );

      expect(
        await dbCode(() =>
          ctx.prisma.approvalRule.update({
            where: { id: v1.id },
            data: {
              conditions: { field: 'employment_count', op: 'gt', value: 0 },
            },
          }),
        ),
      ).toMatch(/immutable/);
      expect(
        await dbCode(() =>
          ctx.prisma.approvalRule.update({
            where: { id: v1.id },
            data: { sourceReference: 'edited' },
          }),
        ),
      ).toMatch(/immutable/);
      expect(
        await dbCode(() =>
          ctx.prisma.approvalRule.update({
            where: { id: v1.id },
            data: { isOfficiallyRequired: true },
          }),
        ),
      ).toMatch(/immutable/);
      expect(
        await dbCode(() =>
          ctx.prisma.approvalRule.update({
            where: { id: v1.id },
            data: { version: 99 },
          }),
        ),
      ).toMatch(/immutable/);

      const snap = await ctx.prisma.discoverySnapshot.findFirstOrThrow({
        where: { projectId },
      });
      expect(
        await dbCode(() =>
          ctx.prisma.discoverySnapshot.update({
            where: { id: snap.id },
            data: { result: {} },
          }),
        ),
      ).toMatch(/immutable/);
      expect(
        await dbCode(() =>
          ctx.prisma.discoverySnapshot.update({
            where: { id: snap.id },
            data: { matchedApprovalTypeIds: [] },
          }),
        ),
      ).toMatch(/immutable/);

      const unchanged = await ctx.prisma.approvalRule.findUniqueOrThrow({
        where: { id: v1.id },
      });
      expect(unchanged.sourceReference).toBe('E2E v1');
    });

    it('a version can be end-dated exactly once, and retired (is_active) — nothing else', async () => {
      const dept = await ctx.createDepartment('enddate');
      const t = await ctx.createApprovalType(dept.id, 'EndDated');
      const rule = await ctx.publishRule(owner.user.id, t, {
        field: 'hazardous_flag',
        op: 'equals',
        value: true,
      });
      const end = new Date(Date.now() + 86_400_000);
      await ctx.prisma.approvalRule.update({
        where: { id: rule.id },
        data: { effectiveTo: end },
      });
      await expect(
        ctx.prisma.approvalRule.update({
          where: { id: rule.id },
          data: { effectiveTo: new Date(Date.now() + 172_800_000) },
        }),
      ).rejects.toThrow(/effective_to can only be set once/);
      await ctx.prisma.approvalRule.update({
        where: { id: rule.id },
        data: { isActive: false },
      });
    });

    it('a retired latest version switches the approval off — it does not resurrect an older version', async () => {
      const dept = await ctx.createDepartment('retire');
      const t = await ctx.createApprovalType(dept.id, 'Retired');
      await ctx.publishRule(owner.user.id, t, {
        field: 'hazardous_flag',
        op: 'equals',
        value: true,
      }); // v1 matches
      const v2 = await ctx.publishRule(owner.user.id, t, {
        field: 'hazardous_flag',
        op: 'equals',
        value: true,
      });

      const live = (await discover().expect(201)).body;
      expect((mine([t], live.applicable)[0] as any).rule.version).toBe(2);

      await ctx.prisma.approvalRule.update({
        where: { id: v2.id },
        data: { isActive: false },
      });
      const after = (await discover().expect(201)).body;
      expect(mine([t], after.applicable)).toHaveLength(0);
      expect(mine([t], after.notApplicable)).toHaveLength(0); // not falling back to v1
    });

    it('a version scheduled for the future is ignored until it takes effect', async () => {
      const dept = await ctx.createDepartment('sched');
      const t = await ctx.createApprovalType(dept.id, 'Scheduled');
      await ctx.publishRule(owner.user.id, t, {
        field: 'employment_count',
        op: 'gt',
        value: 999,
      }); // v1: no match
      await ctx.publishRule(
        owner.user.id,
        t,
        { field: 'employment_count', op: 'gt', value: 0 },
        { effectiveFrom: new Date(Date.now() + 3_600_000) },
      ); // v2: future
      const res = (await discover().expect(201)).body;
      expect(mine([t], res.applicable)).toHaveLength(0);
      expect((mine([t], res.notApplicable)[0] as any).rule.version).toBe(1);
    });

    it('publishing enforces the grammar, sequential versions and monotonic effective dates', async () => {
      const dept = await ctx.createDepartment('pub');
      const t = await ctx.createApprovalType(dept.id, 'Publishing');
      const count = () =>
        ctx.prisma.approvalRule.count({ where: { approvalTypeId: t } });

      for (const bad of [
        { field: 'made_up', op: 'equals', value: 1 },
        { field: 'employment_count', op: 'gt', value: 'lots' },
        { all: [] },
        { expr: 'process.exit()' },
      ]) {
        await expect(
          ctx.publishRule(owner.user.id, t, bad),
        ).rejects.toMatchObject({
          response: { code: 'INVALID_RULE_DEFINITION' },
        });
      }
      expect(await count()).toBe(0);

      const ok = { field: 'hazardous_flag', op: 'equals', value: true };
      const a = await ctx.publishRule(owner.user.id, t, ok, {
        effectiveFrom: new Date('2026-06-01T00:00:00Z'),
      });
      const b = await ctx.publishRule(owner.user.id, t, ok, {
        effectiveFrom: new Date('2026-07-01T00:00:00Z'),
      });
      expect([a.version, b.version]).toEqual([1, 2]);

      await expect(
        ctx.publishRule(owner.user.id, t, ok, {
          effectiveFrom: new Date('2026-06-15T00:00:00Z'),
        }),
      ).rejects.toMatchObject({
        response: { code: 'INVALID_EFFECTIVE_DATES' },
      });
      await expect(
        ctx.publishRule(owner.user.id, t, ok, { sourceReference: '' }),
      ).rejects.toBeDefined();
      expect(await count()).toBe(2);
    });

    it('concurrent publishes never collide: versions stay strictly sequential', async () => {
      const dept = await ctx.createDepartment('conc');
      const t = await ctx.createApprovalType(dept.id, 'Concurrent');
      const ok = { field: 'hazardous_flag', op: 'equals', value: true };
      // One shared effectiveFrom: lock order is arbitrary, and a version may
      // not take effect before its predecessor did.
      const effectiveFrom = new Date(Date.now() - 3_600_000);
      const results = await Promise.all(
        [1, 2, 3, 4].map(() =>
          ctx.publishRule(owner.user.id, t, ok, { effectiveFrom }),
        ),
      );
      expect(results.map((r) => r.version).sort()).toEqual([1, 2, 3, 4]);
    });
  });

  // -------------------------------------------------------------------------
  describe('snapshots are historical records', () => {
    it('a later change to the project, the approval type or the rule set does not alter an earlier snapshot', async () => {
      const ent = (await ctx.createEnterprise(owner.accessToken, 'hist')).id;
      const pid = (
        await ctx.createProjectVia(owner.accessToken, ent, 'hist', {
          employmentCount: 40,
          hazardousFlag: true,
        })
      ).id;
      const dept = await ctx.createDepartment('hist');
      const t = await ctx.createApprovalType(dept.id, 'History');
      await ctx.publishRule(owner.user.id, t, {
        field: 'employment_count',
        op: 'gt',
        value: 20,
      });

      const first = (await discover(pid, ent).expect(201)).body;
      const firstApplicable = mine([t], first.applicable)[0] as any;
      expect(firstApplicable.approvalType.name).toContain('History');

      // Change everything that could feed a re-evaluation.
      await as(owner.accessToken)
        .put(`/enterprises/${ent}/projects/${pid}`)
        .send({ employmentCount: 5 })
        .expect(200);
      await ctx.prisma.approvalType.update({
        where: { id: t },
        data: { name: `Renamed Approval ${ctx.runId}` },
      });
      await ctx.publishRule(owner.user.id, t, {
        field: 'employment_count',
        op: 'gt',
        value: 1000,
      });

      const second = (await discover(pid, ent).expect(201)).body;
      expect(mine([t], second.applicable)).toHaveLength(0);
      expect(second.inputs.employment_count).toBe(5);

      // The first snapshot is exactly as it was: old inputs, old name, old rule.
      const reread = (
        await as(owner.accessToken)
          .get(snapshotUrl(first.snapshotId, pid, ent))
          .expect(200)
      ).body;
      expect(reread.inputs.employment_count).toBe(40);
      const kept = mine([t], reread.applicable)[0] as any;
      expect(kept.approvalType.name).toBe(firstApplicable.approvalType.name);
      expect(kept.rule.version).toBe(1);
      expect(reread.reproducible).toBe(true);
    });

    it('stores the exact rule versions used, with their definitions, plus inputs, result and author', async () => {
      const dept = await ctx.createDepartment('stored');
      const t = await ctx.createApprovalType(dept.id, 'Stored');
      const definition = {
        all: [
          { field: 'project_stage', op: 'equals', value: 'expansion' },
          { field: 'employment_count', op: 'between', value: [1, 100] },
        ],
      };
      const rule = await ctx.publishRule(owner.user.id, t, definition, {
        sourceReference: 'E2E stored',
      });

      const run = (await discover().expect(201)).body;
      const row = await ctx.prisma.discoverySnapshot.findUniqueOrThrow({
        where: { id: run.snapshotId },
      });
      const used = (row.ruleVersionsUsed as any[]).find(
        (r) => r.approvalType.id === t,
      );

      expect(used).toMatchObject({
        ruleId: rule.id,
        version: 1,
        sourceReference: 'E2E stored',
        conditions: definition,
      });
      expect(row.matchedApprovalTypeIds).toContain(t);
      expect(row.engineVersion).toBe('1.0.0');
      expect(row.createdByUserId).toBe(owner.user.id);
      expect((row.projectInputs as any).project_stage).toBe('expansion');
      expect(
        (row.result as any).applicable.some(
          (a: any) => a.approvalType.id === t,
        ),
      ).toBe(true);
    });

    it('lists snapshots newest first, and each can be re-read and is reproducible', async () => {
      const ent = (await ctx.createEnterprise(owner.accessToken, 'list')).id;
      const pid = (await ctx.createProjectVia(owner.accessToken, ent, 'list'))
        .id;
      const a = (await discover(pid, ent).expect(201)).body.snapshotId;
      const b = (await discover(pid, ent).expect(201)).body.snapshotId;
      const c = (await discover(pid, ent).expect(201)).body.snapshotId;

      const list = (
        await as(owner.accessToken)
          .get(`/enterprises/${ent}/projects/${pid}/discoveries`)
          .expect(200)
      ).body;
      expect(list.map((s: { id: string }) => s.id)).toEqual([c, b, a]);
      expect(list[0]).toMatchObject({ engineVersion: '1.0.0' });
      expect(typeof list[0].rulesEvaluated).toBe('number');
      expect(list[0].applicableCount + list[0].notApplicableCount).toBe(
        list[0].rulesEvaluated,
      );

      for (const id of [a, b, c]) {
        expect(
          (
            await as(owner.accessToken)
              .get(snapshotUrl(id, pid, ent))
              .expect(200)
          ).body.reproducible,
        ).toBe(true);
      }
    });

    it('detects a snapshot whose stored result no longer matches its stored rules and inputs (tamper evidence)', async () => {
      const ent = (await ctx.createEnterprise(owner.accessToken, 'tamper')).id;
      const pid = (await ctx.createProjectVia(owner.accessToken, ent, 'tamper'))
        .id;
      const dept = await ctx.createDepartment('tamper');
      const t = await ctx.createApprovalType(dept.id, 'Tamper');
      await ctx.publishRule(owner.user.id, t, {
        field: 'hazardous_flag',
        op: 'in',
        value: [true, false],
      });
      const run = (await discover(pid, ent).expect(201)).body;

      // Only possible by bypassing the immutability trigger, as a DBA with
      // superuser rights could. Transaction-scoped (SET LOCAL), so the trigger
      // is back in force the instant the transaction ends — even on a crash.
      await ctx.prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(
          `SET LOCAL session_replication_role = replica`,
        );
        await tx.$executeRawUnsafe(
          `UPDATE discovery_snapshots SET result = jsonb_set(result, '{applicable}', '[]'::jsonb) WHERE id = '${run.snapshotId}'`,
        );
      });
      const reread = (
        await as(owner.accessToken)
          .get(snapshotUrl(run.snapshotId, pid, ent))
          .expect(200)
      ).body;
      expect(reread.reproducible).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  describe('malformed stored rules', () => {
    it('a stored rule that violates the grammar is reported as DEFINITION_INVALID — never evaluated, never a 500 — and others still run', async () => {
      const dept = await ctx.createDepartment('bad');
      const bad = await ctx.createApprovalType(dept.id, 'Broken');
      const good = await ctx.createApprovalType(dept.id, 'Healthy');
      // Bypasses the publish service on purpose: something got into the table.
      await ctx.prisma.approvalRule.create({
        data: {
          approvalTypeId: bad,
          version: 1,
          effectiveFrom: new Date(Date.now() - 3_600_000),
          sourceReference: 'E2E bad',
          conditions: {
            all: [
              { field: 'not_a_field', op: 'equals', value: 1 },
              { expr: 'process.exit(1)' },
            ],
          },
          createdBy: owner.user.id,
        },
      });
      await ctx.publishRule(owner.user.id, good, {
        field: 'hazardous_flag',
        op: 'equals',
        value: true,
      });

      const res = await discover().expect(201);
      const broken = mine([bad], res.body.notApplicable)[0] as any;
      expect(broken).toMatchObject({
        reason: 'DEFINITION_INVALID',
        trace: null,
      });
      expect(broken.issues.length).toBeGreaterThan(0);
      expect(
        broken.issues.map((i: { message: string }) => i.message).join(' '),
      ).toMatch(/unknown field/);
      expect(mine([bad], res.body.applicable)).toHaveLength(0);
      expect(mine([good], res.body.applicable)).toHaveLength(1);

      const reread = (
        await as(owner.accessToken)
          .get(snapshotUrl(res.body.snapshotId))
          .expect(200)
      ).body;
      expect(reread.reproducible).toBe(true);
    });

    it('an invalid excludes_if invalidates the rule instead of being ignored', async () => {
      const dept = await ctx.createDepartment('badx');
      const t = await ctx.createApprovalType(dept.id, 'BadExclude');
      await ctx.prisma.approvalRule.create({
        data: {
          approvalTypeId: t,
          version: 1,
          effectiveFrom: new Date(Date.now() - 3_600_000),
          sourceReference: 'E2E bad',
          conditions: { field: 'hazardous_flag', op: 'equals', value: true },
          excludesIf: { field: 'employment_count', op: 'gt', value: 'many' },
          createdBy: owner.user.id,
        },
      });
      const res = await discover().expect(201);
      expect(mine([t], res.body.applicable)).toHaveLength(0);
      expect((mine([t], res.body.notApplicable)[0] as any).reason).toBe(
        'DEFINITION_INVALID',
      );
    });
  });

  // -------------------------------------------------------------------------
  describe('audit', () => {
    it('records each discovery run with the actor, project, snapshot and the rule versions used — and each rule publication', async () => {
      const dept = await ctx.createDepartment('audit');
      const t = await ctx.createApprovalType(dept.id, 'Audited');
      const rule = await ctx.publishRule(owner.user.id, t, {
        field: 'hazardous_flag',
        op: 'equals',
        value: true,
      });

      const published = await ctx.prisma.auditLog.findMany({
        where: { entityId: rule.id, action: 'RULE_VERSION_PUBLISHED' },
      });
      expect(published).toHaveLength(1);
      expect(published[0]).toMatchObject({
        userId: owner.user.id,
        entityType: 'ApprovalRule',
      });
      expect(published[0].afterState).toMatchObject({
        approvalTypeId: t,
        version: 1,
        sourceReference: 'E2E TEST FIXTURE',
      });

      const run = (await discover().expect(201)).body;
      const rows = await ctx.prisma.auditLog.findMany({
        where: { entityId: run.snapshotId, action: 'DISCOVERY_RUN' },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        userId: owner.user.id,
        entityType: 'DiscoverySnapshot',
        roleAtTime: 'APPLICANT',
      });
      expect(rows[0].afterState).toMatchObject({
        projectId,
        enterpriseId,
        actingAs: 'OWNER',
        engineVersion: '1.0.0',
      });
      expect((rows[0].afterState as any).ruleVersions).toEqual(
        expect.arrayContaining([{ ruleId: rule.id, version: 1 }]),
      );
      expect(rows[0].ipAddress).toBeTruthy();
      expect(JSON.stringify([published[0], rows[0]]).toLowerCase()).not.toMatch(
        /password|secret|token|hash/,
      );
    });
  });

  // -------------------------------------------------------------------------
  describe('input handling', () => {
    it('validates ids: malformed project or snapshot ids are 400, unknown ones 404, and nothing is persisted', async () => {
      const before = await ctx.prisma.discoverySnapshot.count({
        where: { projectId },
      });
      await discover('not-a-uuid').expect(400);
      await discover(randomUUID()).expect(404);
      await as(owner.accessToken)
        .get(
          `/enterprises/${enterpriseId}/projects/${projectId}/discoveries/not-a-uuid`,
        )
        .expect(400);
      await as(owner.accessToken).get(snapshotUrl(randomUUID())).expect(404);
      expect(
        await ctx.prisma.discoverySnapshot.count({ where: { projectId } }),
      ).toBe(before);
    });

    it('takes no request body: characteristics come from the stored project, so a caller cannot feed the engine chosen inputs', async () => {
      const ent = (await ctx.createEnterprise(owner.accessToken, 'nobody')).id;
      const pid = (
        await ctx.createProjectVia(owner.accessToken, ent, 'nobody', {
          hazardousFlag: false,
          employmentCount: 3,
        })
      ).id;
      const dept = await ctx.createDepartment('nobody');
      const t = await ctx.createApprovalType(dept.id, 'NoBody');
      await ctx.publishRule(owner.user.id, t, {
        field: 'hazardous_flag',
        op: 'equals',
        value: true,
      });

      const res = await discover(pid, ent).send({
        inputs: { hazardous_flag: true },
        hazardous_flag: true,
        hazardousFlag: true,
      });
      // Either rejected outright or ignored — never honoured.
      if (res.status === 201) {
        expect(res.body.inputs.hazardous_flag).toBe(false);
        expect(mine([t], res.body.applicable)).toHaveLength(0);
      } else {
        expect(res.status).toBe(400);
      }
    });
  });

  // -------------------------------------------------------------------------
  describe('Swagger', () => {
    it('documents the three discovery endpoints with bearer auth, and no rule-authoring endpoint exists', async () => {
      const { body } = await request(ctx.http)
        .get('/api/docs-json')
        .expect(200);
      const base = `${API}/enterprises/{enterpriseId}/projects/{projectId}`;
      expect(
        body.paths[`${base}/discover-approvals`].post.security,
      ).toBeDefined();
      expect(body.paths[`${base}/discoveries`].get.security).toBeDefined();
      expect(
        body.paths[`${base}/discoveries/{snapshotId}`].get.security,
      ).toBeDefined();

      const schemas = body.components.schemas as Record<
        string,
        { properties?: Record<string, unknown> }
      >;
      for (const name of [
        'DiscoveryResultDto',
        'ApplicableApprovalDto',
        'NotApplicableRuleDto',
        'DiscoverySnapshotSummaryDto',
      ]) {
        expect(schemas[name]).toBeDefined();
        for (const prop of Object.keys(schemas[name].properties ?? {})) {
          expect(prop).not.toMatch(
            /password|hash|secret|token|createdBy|creator|ownerUserId/i,
          );
        }
      }
      // Rules are administered elsewhere: no HTTP route creates or edits them.
      expect(
        Object.keys(body.paths).filter((p) => /rules?|approval-types/i.test(p)),
      ).toEqual([]);
    });
  });
});
