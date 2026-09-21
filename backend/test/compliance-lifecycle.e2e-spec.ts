import { E2eContext, createE2eContext } from './support/e2e-helpers';
import {
  activate,
  daysFromNow,
  istDate,
  recordsOf,
} from './support/compliance-helpers';
import {
  Actor,
  OfficerWorld,
  as,
  buildOfficerWorld,
} from './support/officer-world';
import { ComplianceSyncService } from '../src/modules/compliance/compliance-sync.service';
import {
  addDaysYmd,
  addMonthsYmd,
} from '../src/modules/compliance/compliance-dates';

jest.setTimeout(600_000);

/**
 * Step 14 - the compliance calendar's lifecycle over real HTTP -> Nest ->
 * Prisma -> PostgreSQL: a department configures an obligation; an application in
 * the compliance period (ACTIVE) gets it; its status follows the date
 * (UPCOMING -> DUE -> OVERDUE); a recurring obligation gets one record per
 * occurrence; a later change never rewrites history; every step is audited; and
 * the database itself refuses an illegal record.
 *
 * The date job is driven directly with a chosen "now" and only over THIS suite's
 * applications, so parallel suites cannot process each other's fixtures.
 */
describe('Compliance e2e - configuration, obligations, statuses, recurrence', () => {
  let ctx: E2eContext;
  let w: OfficerWorld;
  let sync: ComplianceSyncService;
  const mine = new Set<string>();

  const api = (a: { accessToken: string }) => as(ctx, a.accessToken);
  const errorCode = (res: { body: { error?: { code?: string } } }) =>
    res.body.error?.code;
  const run = (now: Date = new Date()) =>
    sync.run(now, { applicationIds: [...mine] });
  const appBase = (s: { projectId: string; applicationId: string }) =>
    `/enterprises/${w.enterpriseId}/projects/${s.projectId}/applications/${s.applicationId}`;

  /** A fresh approval type of department A (its own requirements). */
  const approval = async (tag: string) =>
    (
      await ctx.createStartableApproval(w.owner.user.id, `cl-${tag}`, {
        departmentId: w.deptA.id,
      })
    ).approvalTypeId;

  const configure = (
    admin: Actor,
    approvalTypeId: string,
    body: Record<string, unknown> = {},
  ) =>
    api(admin)
      .post('/admin/compliance/requirements')
      .send({
        approvalTypeId,
        description: 'File the periodic return',
        frequency: 'ONE_TIME',
        ...body,
      });

  /** A submitted application of `approvalTypeId`, moved into the compliance
   * period. */
  const active = async (approvalTypeId: string, tag: string) => {
    const s = await ctx.submittedApplication(
      w.owner.accessToken,
      w.enterpriseId,
      approvalTypeId,
      `cl-${tag}`,
    );
    mine.add(s.applicationId);
    await activate(ctx.prisma, s.applicationId);
    return s;
  };
  const submittedOnly = async (approvalTypeId: string, tag: string) => {
    const s = await ctx.submittedApplication(
      w.owner.accessToken,
      w.enterpriseId,
      approvalTypeId,
      `cl-${tag}`,
    );
    mine.add(s.applicationId);
    return s;
  };
  const events = (entityId: string, action: string) =>
    ctx.prisma.auditLog.findMany({
      where: { entityId, action },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  const inbox = async (a: Actor) =>
    (await api(a).get('/notifications?pageSize=100').expect(200)).body
      .items as Array<{
      eventType: string;
      applicationId: string | null;
      message: string;
    }>;
  const dueNotices = async (a: Actor, applicationId: string) =>
    (await inbox(a)).filter(
      (n) =>
        n.eventType === 'COMPLIANCE_DEADLINE_APPROACHING' &&
        n.applicationId === applicationId,
    );

  beforeAll(async () => {
    ctx = await createE2eContext();
    w = await buildOfficerWorld(ctx, 'cl');
    sync = ctx.app.get(ComplianceSyncService);
  });

  afterAll(async () => {
    await ctx.cleanup();
    await ctx.app.close();
  });

  // -------------------------------------------------------------------------
  describe('configuration: a department’s explicit obligation', () => {
    it('a Department Administrator configures one for their own department; nothing is defaulted', async () => {
      const type = await approval('cfg');
      const res = await configure(w.adminA, type).expect(201);
      expect(res.body).toMatchObject({
        approvalTypeId: type,
        departmentId: w.deptA.id,
        description: 'File the periodic return',
        frequency: 'ONE_TIME',
        evidenceRequired: false,
        applicantAction: null,
        sourceReference: null,
        firstDueAfterDays: null, // "not yet configured": no duration assumed
        dueWindowDays: 0,
        version: 1,
        isActive: true,
      });
      const listed = await api(w.adminA)
        .get('/admin/compliance/requirements')
        .expect(200);
      expect(listed.body.map((r: { id: string }) => r.id)).toContain(
        res.body.id,
      );
    });

    it('is audited with the actor and the full configuration', async () => {
      const type = await approval('cfg-audit');
      const res = await configure(w.adminA, type, {
        sourceReference: 'Notice 4(b)',
        evidenceRequired: true,
        firstDueAfterDays: 30,
        dueWindowDays: 5,
      }).expect(201);
      const [event] = await events(
        res.body.id,
        'COMPLIANCE_REQUIREMENT_CREATED',
      );
      expect(event).toMatchObject({
        userId: w.adminA.user.id,
        roleAtTime: 'DEPT_ADMIN',
        entityType: 'ComplianceRequirement',
      });
      expect(event.afterState).toMatchObject({
        departmentId: w.deptA.id,
        sourceReference: 'Notice 4(b)',
        evidenceRequired: true,
        firstDueAfterDays: 30,
        dueWindowDays: 5,
        version: 1,
      });
    });

    it('only the administrator of the approval type’s department may; another department’s or a platform administrator’s attempt changes nothing', async () => {
      const type = await approval('cfg-authz');
      const before = await ctx.prisma.complianceRequirement.count({
        where: { approvalTypeId: type },
      });
      const other = await configure(w.adminB, type).expect(404);
      expect(errorCode(other)).toBe('NOT_FOUND');
      for (const actor of [w.sysAdmin, w.soA1, w.aaA, w.leadership, w.owner]) {
        const res = await configure(actor, type).expect(403);
        expect(errorCode(res)).toBe('INSUFFICIENT_ROLE');
      }
      expect(
        await ctx.prisma.complianceRequirement.count({
          where: { approvalTypeId: type },
        }),
      ).toBe(before);
      await configure(w.adminA, '00000000-0000-4000-8000-000000000000').expect(
        404,
      );
    });

    it('a department administrator lists only their own department’s requirements', async () => {
      const type = await approval('cfg-list');
      const mineReq = await configure(w.adminA, type).expect(201);
      const ids = (a: Actor) =>
        api(a)
          .get('/admin/compliance/requirements')
          .expect(200)
          .then((r) => r.body.map((x: { id: string }) => x.id));
      expect(await ids(w.adminA)).toContain(mineReq.body.id);
      expect(await ids(w.adminB)).not.toContain(mineReq.body.id);
      await api(w.sysAdmin).get('/admin/compliance/requirements').expect(403);
    });

    it('validates: only ONE_TIME / MONTHLY / ANNUAL, whole non-negative days, no blank text, and nothing that is not configuration', async () => {
      const type = await approval('cfg-invalid');
      for (const bad of [
        { frequency: 'WEEKLY' },
        { frequency: 'annual' },
        { description: '   ' },
        { firstDueAfterDays: -1 },
        { firstDueAfterDays: 1.5 },
        { firstDueAfterDays: 3651 },
        { dueWindowDays: -3 },
        { status: 'FULFILLED' },
        { dueDate: '2027-01-01' },
        { version: 5 },
      ]) {
        await configure(w.adminA, type, bad).expect(400);
      }
      await api(w.adminA)
        .post('/admin/compliance/requirements')
        .send({ description: 'x', frequency: 'ANNUAL' })
        .expect(400);
    });

    it('an edit bumps the version, applies in place under a lock and is audited before / after; a no-op is refused; nothing can be deleted', async () => {
      const type = await approval('cfg-edit');
      const created = await configure(w.adminA, type).expect(201);
      const id = created.body.id;
      const edited = await api(w.adminA)
        .put(`/admin/compliance/requirements/${id}`)
        .send({ description: 'Reworded', firstDueAfterDays: 20 })
        .expect(200);
      expect(edited.body).toMatchObject({
        version: 2,
        description: 'Reworded',
        firstDueAfterDays: 20,
      });
      const [event] = await events(id, 'COMPLIANCE_REQUIREMENT_UPDATED');
      expect(event.userId).toBe(w.adminA.user.id);
      expect(event.beforeState).toMatchObject({
        description: 'File the periodic return',
        firstDueAfterDays: null,
        version: 1,
      });
      expect(event.afterState).toMatchObject({
        description: 'Reworded',
        version: 2,
        appliesTo: 'OCCURRENCES_CREATED_AFTER_THIS_CHANGE',
      });
      await api(w.adminA)
        .put(`/admin/compliance/requirements/${id}`)
        .send({ description: 'Reworded' })
        .expect(400);
      // Configuration is not clearable to nonsense, and the id / type never move.
      await api(w.adminA)
        .put(`/admin/compliance/requirements/${id}`)
        .send({ approvalTypeId: w.approvalB })
        .expect(400);
      await api(w.adminB)
        .put(`/admin/compliance/requirements/${id}`)
        .send({ description: 'Hijack' })
        .expect(404);
      await api(w.sysAdmin)
        .put(`/admin/compliance/requirements/${id}`)
        .send({ description: 'Hijack' })
        .expect(403);
      for (const verb of ['del', 'patch'] as const) {
        expect(
          (
            await api(w.adminA)
              [verb](`/admin/compliance/requirements/${id}`)
              .send({})
          ).status,
        ).toBe(404);
      }
      expect(
        (
          await ctx.prisma.complianceRequirement.findUniqueOrThrow({
            where: { id },
          })
        ).description,
      ).toBe('Reworded');
    });

    it('two administrators editing at once are serialised: each gets its own version', async () => {
      const type = await approval('cfg-race');
      const created = await configure(w.adminA, type).expect(201);
      const results = await Promise.all(
        [3, 4, 5].map((d) =>
          api(w.adminA)
            .put(`/admin/compliance/requirements/${created.body.id}`)
            .send({ firstDueAfterDays: d }),
        ),
      );
      expect(results.every((r) => r.status === 200)).toBe(true);
      expect(results.map((r) => r.body.version).sort()).toEqual([2, 3, 4]);
    });
  });

  // -------------------------------------------------------------------------
  describe('obligations exist only for what a department configured, in the compliance period', () => {
    it('an approval with no configured obligation has none, and says so', async () => {
      const type = await approval('none');
      const s = await active(type, 'none');
      const res = await run();
      expect(res.created).toBe(0);
      expect(await recordsOf(ctx.prisma, s.applicationId)).toEqual([]);
      const view = await api(w.owner)
        .get(`${appBase(s)}/compliance`)
        .expect(200);
      expect(view.body.items).toEqual([]);
      expect(view.body.note).toMatch(
        /once confirmed by the issuing department/,
      );
    });

    it('an application still in scrutiny (or any state but ACTIVE) gets nothing; ACTIVE gets the obligation, snapshotted', async () => {
      const type = await approval('active');
      const req = await configure(w.adminA, type, {
        description: 'File the return',
        applicantAction: 'Upload the return',
        sourceReference: 'Notice 4(b)',
        evidenceRequired: true,
        firstDueAfterDays: 10,
        dueWindowDays: 2,
      }).expect(201);
      const s = await submittedOnly(type, 'active');
      await run();
      expect(await recordsOf(ctx.prisma, s.applicationId)).toEqual([]);

      await activate(ctx.prisma, s.applicationId);
      const res = await run();
      expect(res.created).toBe(1);
      const [rec] = await recordsOf(ctx.prisma, s.applicationId);
      expect(rec).toMatchObject({
        complianceRequirementId: req.body.id,
        occurrenceNumber: 1,
        status: 'UPCOMING',
        requirementVersion: 1,
        description: 'File the return',
        frequency: 'ONE_TIME',
        evidenceRequired: true,
        applicantAction: 'Upload the return',
        sourceReference: 'Notice 4(b)',
        dueWindowDays: 2,
        fulfilledAt: null,
        fulfilledDocumentId: null,
      });
      expect(rec.dueDate?.toISOString().slice(0, 10)).toBe(
        addDaysYmd(istDate(), 10),
      );

      // Created by the system, audited against the application.
      const [created] = await events(
        s.applicationId,
        'COMPLIANCE_OBLIGATION_CREATED',
      );
      expect(created).toMatchObject({ userId: null, roleAtTime: 'SYSTEM' });
      expect(created.afterState).toMatchObject({
        complianceRecordId: rec.id,
        requirementVersion: 1,
        occurrenceNumber: 1,
        dueDate: addDaysYmd(istDate(), 10),
        departmentId: w.deptA.id,
      });
    });

    it('is idempotent: running again, or running at once, never creates a second occurrence', async () => {
      const type = await approval('idem');
      await configure(w.adminA, type, { firstDueAfterDays: 5 }).expect(201);
      const s = await active(type, 'idem');
      await Promise.all([run(), run(), run()]);
      await run();
      expect(await recordsOf(ctx.prisma, s.applicationId)).toHaveLength(1);
      expect(
        await events(s.applicationId, 'COMPLIANCE_OBLIGATION_CREATED'),
      ).toHaveLength(1);
    });

    it('with no first due date configured the obligation has no due date, says so, and never becomes due or overdue', async () => {
      const type = await approval('undated');
      await configure(w.adminA, type).expect(201);
      const s = await active(type, 'undated');
      await run();
      await run(daysFromNow(4000));
      const [rec] = await recordsOf(ctx.prisma, s.applicationId);
      expect(rec).toMatchObject({ dueDate: null, status: 'UPCOMING' });
      const view = await api(w.owner)
        .get(`${appBase(s)}/compliance`)
        .expect(200);
      expect(view.body.items[0]).toMatchObject({
        dueDate: null,
        status: 'UPCOMING',
      });
      expect(view.body.items[0].dueDateMessage).toMatch(/not yet configured/i);
      expect(await dueNotices(w.owner, s.applicationId)).toEqual([]);
    });

    it('an inactive requirement creates nothing for applications that arrive after it was switched off', async () => {
      const type = await approval('inactive');
      const req = await configure(w.adminA, type, {
        firstDueAfterDays: 5,
      }).expect(201);
      await api(w.adminA)
        .put(`/admin/compliance/requirements/${req.body.id}`)
        .send({ isActive: false })
        .expect(200);
      const s = await active(type, 'inactive');
      await run();
      expect(await recordsOf(ctx.prisma, s.applicationId)).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  describe('status follows the date: UPCOMING -> DUE -> OVERDUE', () => {
    it('moves with the configured window, audits each move as the system, and tells the applicant side once when it becomes DUE', async () => {
      const type = await approval('status');
      await configure(w.adminA, type, {
        firstDueAfterDays: 10,
        dueWindowDays: 2,
      }).expect(201);
      const s = await active(type, 'status');
      await run();
      const [rec] = await recordsOf(ctx.prisma, s.applicationId);
      const status = async () =>
        (
          await ctx.prisma.complianceRecord.findUniqueOrThrow({
            where: { id: rec.id },
          })
        ).status;

      await run(daysFromNow(7)); // due is day 10, window opens on day 8
      expect(await status()).toBe('UPCOMING');
      expect(await dueNotices(w.owner, s.applicationId)).toEqual([]);

      await run(daysFromNow(8));
      expect(await status()).toBe('DUE');
      const notice = await dueNotices(w.owner, s.applicationId);
      expect(notice).toHaveLength(1);
      expect(notice[0].message).toContain(addDaysYmd(istDate(), 10));
      // The requirement's own wording is not repeated in the notification.
      expect(notice[0].message).not.toContain('File the periodic return');
      // Nobody on the officer side is told.
      for (const a of [w.soA1, w.adminA, w.aaA, w.owner2]) {
        expect(await dueNotices(a, s.applicationId)).toEqual([]);
      }

      await run(daysFromNow(11));
      expect(await status()).toBe('OVERDUE');
      // Becoming overdue is not a second "approaching" notice.
      expect(await dueNotices(w.owner, s.applicationId)).toHaveLength(1);

      const changes = await events(
        s.applicationId,
        'COMPLIANCE_STATUS_CHANGED',
      );
      expect(changes.map((c) => (c.afterState as { to: string }).to)).toEqual([
        'DUE',
        'OVERDUE',
      ]);
      expect(
        changes.every((c) => c.userId === null && c.roleAtTime === 'SYSTEM'),
      ).toBe(true);
    });

    it('is idempotent: repeated and simultaneous runs change, audit and notify once', async () => {
      const type = await approval('status-idem');
      await configure(w.adminA, type, { firstDueAfterDays: 3 }).expect(201);
      const s = await active(type, 'status-idem');
      await run();
      const later = daysFromNow(3);
      await Promise.all([run(later), run(later), run(later)]);
      await run(later);
      expect(
        await events(s.applicationId, 'COMPLIANCE_STATUS_CHANGED'),
      ).toHaveLength(1);
      expect(await dueNotices(w.owner, s.applicationId)).toHaveLength(1);
    });

    it('a job that missed the window goes straight to OVERDUE, with no "approaching" notice', async () => {
      const type = await approval('status-missed');
      await configure(w.adminA, type, { firstDueAfterDays: 2 }).expect(201);
      const s = await active(type, 'status-missed');
      await run();
      await run(daysFromNow(30));
      const [rec] = await recordsOf(ctx.prisma, s.applicationId);
      expect(rec.status).toBe('OVERDUE');
      expect(await dueNotices(w.owner, s.applicationId)).toEqual([]);
    });

    it('a status is never a client input: no route takes one', async () => {
      const type = await approval('status-input');
      await configure(w.adminA, type, { firstDueAfterDays: 2 }).expect(201);
      const s = await active(type, 'status-input');
      await run();
      const [rec] = await recordsOf(ctx.prisma, s.applicationId);
      const base = `${appBase(s)}/compliance/${rec.id}`;
      for (const verb of ['put', 'patch', 'del'] as const) {
        expect(
          (await api(w.owner)[verb](base).send({ status: 'FULFILLED' })).status,
        ).toBe(404);
      }
      expect(
        (
          await api(w.owner)
            .post(`${appBase(s)}/compliance`)
            .send({ status: 'FULFILLED' })
        ).status,
      ).toBe(404);
      expect((await recordsOf(ctx.prisma, s.applicationId))[0].status).toBe(
        'UPCOMING',
      );
    });
  });

  // -------------------------------------------------------------------------
  describe('recurrence: each occurrence is its own record', () => {
    it('a monthly obligation gets its next occurrence when the previous due date is reached, counted from the first; history is never overwritten', async () => {
      const type = await approval('monthly');
      const req = await configure(w.adminA, type, {
        frequency: 'MONTHLY',
        firstDueAfterDays: 0,
        description: 'Monthly return',
      }).expect(201);
      const s = await active(type, 'monthly');
      await run();
      let records = await recordsOf(ctx.prisma, s.applicationId);
      expect(records).toHaveLength(1);
      const first = records[0].dueDate?.toISOString().slice(0, 10) as string;
      expect(first).toBe(istDate());

      // 40 days later: occurrence 1 (due today) has passed; 2 (+1 month) is due
      // or past; 3 (+2 months) is still ahead.
      await run(daysFromNow(40));
      records = await recordsOf(ctx.prisma, s.applicationId);
      expect(records.map((r) => r.occurrenceNumber)).toEqual([1, 2, 3]);
      expect(records.map((r) => r.dueDate?.toISOString().slice(0, 10))).toEqual(
        [first, addMonthsYmd(first, 1), addMonthsYmd(first, 2)],
      );
      expect(new Set(records.map((r) => r.id)).size).toBe(3);
      expect(records.map((r) => r.status)).toEqual([
        'OVERDUE',
        'OVERDUE',
        'UPCOMING',
      ]);
      expect(records.every((r) => r.frequency === 'MONTHLY')).toBe(true);

      // The first record is exactly as it was: not re-dated, not re-numbered.
      expect(records[0].dueDate?.toISOString().slice(0, 10)).toBe(first);
      expect(
        await events(s.applicationId, 'COMPLIANCE_OBLIGATION_CREATED'),
      ).toHaveLength(3);

      // Each occurrence is a separate obligation for the applicant.
      const view = await api(w.owner)
        .get(`${appBase(s)}/compliance`)
        .expect(200);
      expect(
        view.body.items.map(
          (i: { occurrenceNumber: number }) => i.occurrenceNumber,
        ),
      ).toEqual([1, 2, 3]);
      expect(req.body.frequency).toBe('MONTHLY');
    });

    it('an annual obligation recurs after twelve months, and a one-time obligation never recurs', async () => {
      const annual = await approval('annual');
      await configure(w.adminA, annual, {
        frequency: 'ANNUAL',
        firstDueAfterDays: 0,
      }).expect(201);
      const once = await approval('once');
      await configure(w.adminA, once, {
        frequency: 'ONE_TIME',
        firstDueAfterDays: 0,
      }).expect(201);
      const a = await active(annual, 'annual');
      const o = await active(once, 'once');
      await run();
      await run(daysFromNow(400));
      const ar = await recordsOf(ctx.prisma, a.applicationId);
      // Occurrence 2 (due at twelve months) has been reached, so the NEXT one
      // (24 months, still ahead) exists too: exactly one future occurrence.
      expect(ar.map((r) => r.occurrenceNumber)).toEqual([1, 2, 3]);
      const dueOf = (i: number) =>
        ar[i].dueDate?.toISOString().slice(0, 10) as string;
      expect(dueOf(1)).toBe(addMonthsYmd(dueOf(0), 12));
      expect(dueOf(2)).toBe(addMonthsYmd(dueOf(0), 24));
      expect(await recordsOf(ctx.prisma, o.applicationId)).toHaveLength(1);
    });

    it('a later change to the requirement never rewrites an existing occurrence; the next one takes the new version; switching it off stops recurrence and keeps history', async () => {
      const type = await approval('history');
      const req = await configure(w.adminA, type, {
        frequency: 'MONTHLY',
        firstDueAfterDays: 0,
        description: 'Original wording',
        evidenceRequired: false,
        dueWindowDays: 0,
      }).expect(201);
      const s = await active(type, 'history');
      await run();
      const before = (await recordsOf(ctx.prisma, s.applicationId))[0];

      await api(w.adminA)
        .put(`/admin/compliance/requirements/${req.body.id}`)
        .send({
          description: 'Reworded',
          evidenceRequired: true,
          dueWindowDays: 9,
          firstDueAfterDays: 99,
        })
        .expect(200);

      // The stored occurrence and everything read from it are untouched.
      const after = (await recordsOf(ctx.prisma, s.applicationId))[0];
      expect(after).toMatchObject({
        description: 'Original wording',
        requirementVersion: 1,
        evidenceRequired: false,
        dueWindowDays: 0,
      });
      expect(after.dueDate?.getTime()).toBe(before.dueDate?.getTime());
      const seen = await api(w.owner)
        .get(`${appBase(s)}/compliance`)
        .expect(200);
      expect(seen.body.items[0]).toMatchObject({
        description: 'Original wording',
        requirementVersion: 1,
        evidenceRequired: false,
      });

      // The next occurrence takes the new configuration.
      await run(daysFromNow(35));
      const records = await recordsOf(ctx.prisma, s.applicationId);
      expect(records[0]).toMatchObject({
        description: 'Original wording',
        requirementVersion: 1,
      });
      expect(records[1]).toMatchObject({
        occurrenceNumber: 2,
        description: 'Reworded',
        requirementVersion: 2,
        evidenceRequired: true,
        dueWindowDays: 9,
      });

      // Switch it off: nothing further is created, nothing existing changes.
      await api(w.adminA)
        .put(`/admin/compliance/requirements/${req.body.id}`)
        .send({ isActive: false })
        .expect(200);
      const count = (await recordsOf(ctx.prisma, s.applicationId)).length;
      await run(daysFromNow(400));
      const final = await recordsOf(ctx.prisma, s.applicationId);
      expect(final).toHaveLength(count);
      expect(final[0].description).toBe('Original wording');
    });
  });

  // -------------------------------------------------------------------------
  describe('the database refuses an illegal record', () => {
    let recId: string;
    let appId: string;
    let reqId: string;
    beforeAll(async () => {
      const type = await approval('db');
      const req = await configure(w.adminA, type, {
        firstDueAfterDays: 5,
        evidenceRequired: true,
      }).expect(201);
      reqId = req.body.id;
      const s = await active(type, 'db');
      appId = s.applicationId;
      await run();
      recId = (await recordsOf(ctx.prisma, appId))[0].id;
    });
    const update = (data: Record<string, unknown>, id?: string) =>
      ctx.prisma.complianceRecord.update({ where: { id: id ?? recId }, data });

    it('what an occurrence was created under never changes', async () => {
      for (const data of [
        { dueDate: new Date('2030-01-01') },
        { description: 'Tampered' },
        { requirementVersion: 9 },
        { occurrenceNumber: 7 },
        { evidenceRequired: false },
        { dueWindowDays: 30 },
        { frequency: 'MONTHLY' },
        { sourceReference: 'forged' },
        { applicantAction: 'forged' },
      ]) {
        await expect(update(data)).rejects.toThrow(/never changes/);
      }
    });

    it('status only moves forward, and FULFILLED needs its fulfilment and, where required, its evidence', async () => {
      await expect(update({ status: 'FULFILLED' })).rejects.toThrow(
        /requires evidence|compliance_records_state_check/,
      );
      // Without a document, where the snapshot says evidence is required.
      await expect(
        update({
          status: 'FULFILLED',
          fulfilledAt: new Date(),
          fulfilledByUserId: w.owner.user.id,
        }),
      ).rejects.toThrow(/requires evidence/);
      await update({ status: 'DUE' });
      await expect(update({ status: 'UPCOMING' })).rejects.toThrow(
        /invalid status transition/,
      );
      await update({ status: 'OVERDUE' });
      await expect(update({ status: 'DUE' })).rejects.toThrow(
        /invalid status transition/,
      );
    });

    it('fulfilment details change only with the fulfilment; a fulfilled record is permanent', async () => {
      const type = await approval('db-perm');
      await configure(w.adminA, type, {
        firstDueAfterDays: 5,
        evidenceRequired: false,
      }).expect(201);
      const s = await active(type, 'db-perm');
      await run();
      const id = (await recordsOf(ctx.prisma, s.applicationId))[0].id;
      await expect(update({ fulfilledAt: new Date() }, id)).rejects.toThrow();
      await update(
        {
          status: 'FULFILLED',
          fulfilledAt: new Date(),
          fulfilledByUserId: w.owner.user.id,
        },
        id,
      );
      for (const data of [
        { status: 'OVERDUE' },
        { status: 'DUE' },
        { fulfilledAt: new Date(0) },
        { fulfilledByUserId: w.owner2.user.id },
      ]) {
        await expect(update(data, id)).rejects.toThrow(/permanent/);
      }
    });

    it('an obligation can be created only for an ACTIVE application, of its own approval type, and is born UPCOMING; one row per occurrence', async () => {
      const notActive = await submittedOnly(w.approvalA, 'db-notactive');
      const base = {
        complianceRequirementId: reqId,
        occurrenceNumber: 1,
        requirementVersion: 1,
        description: 'x',
        frequency: 'ONE_TIME' as const,
        evidenceRequired: false,
        dueWindowDays: 0,
      };
      // Not the application's approval type.
      await expect(
        ctx.prisma.complianceRecord.create({
          data: { ...base, applicationId: notActive.applicationId },
        }),
      ).rejects.toThrow(/does not belong to the approval type/);
      // The right type but not ACTIVE.
      const type = await approval('db-state');
      const req = await configure(w.adminA, type, {}).expect(201);
      const submitted = await submittedOnly(type, 'db-state');
      await expect(
        ctx.prisma.complianceRecord.create({
          data: {
            ...base,
            complianceRequirementId: req.body.id,
            applicationId: submitted.applicationId,
          },
        }),
      ).rejects.toThrow(/only while the approval is ACTIVE/);
      // Born UPCOMING; a duplicate occurrence.
      await activate(ctx.prisma, submitted.applicationId);
      await expect(
        ctx.prisma.complianceRecord.create({
          data: {
            ...base,
            complianceRequirementId: req.body.id,
            applicationId: submitted.applicationId,
            status: 'DUE',
            dueDate: new Date('2030-01-01'),
          },
        }),
      ).rejects.toThrow(/born UPCOMING/);
      await ctx.prisma.complianceRecord.create({
        data: {
          ...base,
          complianceRequirementId: req.body.id,
          applicationId: submitted.applicationId,
        },
      });
      await expect(
        ctx.prisma.complianceRecord.create({
          data: {
            ...base,
            complianceRequirementId: req.body.id,
            applicationId: submitted.applicationId,
          },
        }),
      ).rejects.toThrow(/Unique constraint/);
    });

    it('a record without a due date can be neither due nor overdue; a requirement’s type never moves and its offsets are bounded', async () => {
      const type = await approval('db-undated');
      await configure(w.adminA, type, {}).expect(201);
      const s = await active(type, 'db-undated');
      await run();
      const id = (await recordsOf(ctx.prisma, s.applicationId))[0].id;
      await expect(update({ status: 'DUE' }, id)).rejects.toThrow(
        /compliance_records_state_check/,
      );
      await expect(
        ctx.prisma.complianceRequirement.update({
          where: { id: reqId },
          data: { approvalTypeId: w.approvalB },
        }),
      ).rejects.toThrow(/never changes/);
      await expect(
        ctx.prisma.complianceRequirement.update({
          where: { id: reqId },
          data: { firstDueAfterDays: -1 },
        }),
      ).rejects.toThrow(/compliance_requirements_config_check/);
      await expect(
        ctx.prisma.complianceRequirement.update({
          where: { id: reqId },
          data: { version: 0 },
        }),
      ).rejects.toThrow();
    });
  });
});
