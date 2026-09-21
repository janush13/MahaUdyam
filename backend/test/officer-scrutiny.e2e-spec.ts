import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { E2eContext, createE2eContext } from './support/e2e-helpers';
import { pdfBytes } from './support/document-fixtures';
import { OfficerWorld, as, buildOfficerWorld } from './support/officer-world';

jest.setTimeout(600_000);

/**
 * Application scrutiny end to end over real HTTP -> Nest -> Prisma ->
 * PostgreSQL: start, observations, the query loop, document review,
 * recommendation, the state machine (no arbitrary transitions, no decision
 * reachable), concurrency, the immutable discovery context, history, audit and
 * database-level integrity.
 */
describe('Officer scrutiny e2e — lifecycle, queries, documents, discovery, history, audit', () => {
  let ctx: E2eContext;
  let w: OfficerWorld;

  const officerApi = (a: { accessToken: string }) => as(ctx, a.accessToken);
  const applicant = () => as(ctx, w.owner.accessToken);
  const appPath = (id: string) => `/officer/applications/${id}`;
  const queriesPath = (projectId: string, applicationId: string, suffix = '') =>
    `/enterprises/${w.enterpriseId}/projects/${projectId}/applications/${applicationId}/queries${suffix}`;
  const dbApp = (id: string) =>
    ctx.prisma.approvalApplication.findUniqueOrThrow({ where: { id } });

  interface Submitted {
    projectId: string;
    applicationId: string;
    referenceNumber: string;
    snapshotId: string;
  }
  const submitted = (
    tag: string,
    options: Parameters<E2eContext['submittedApplication']>[4] = {},
  ): Promise<Submitted> =>
    ctx.submittedApplication(
      w.owner.accessToken,
      w.enterpriseId,
      w.approvalA,
      tag,
      options,
    );
  const withDocument = (
    tag: string,
  ): Parameters<E2eContext['submittedApplication']>[4] => ({
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
  });

  const assign = (applicationId: string, officer = w.soA1) =>
    officerApi(w.adminA)
      .post(`${appPath(applicationId)}/assignment`)
      .send({ officerUserId: officer.user.id });
  const start = (applicationId: string, officer = w.soA1) =>
    officerApi(officer).post(`${appPath(applicationId)}/start-scrutiny`);

  /** Assigned to soA1 and UNDER_SCRUTINY. */
  const underScrutiny = async (
    tag: string,
    options: Parameters<E2eContext['submittedApplication']>[4] = {},
  ) => {
    const s = await submitted(tag, options);
    await assign(s.applicationId).expect(201);
    await start(s.applicationId).expect(200);
    return s;
  };
  const events = (entityId: string) =>
    ctx.prisma.auditLog.findMany({
      where: { entityId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  const raiseQuery = (
    applicationId: string,
    question = 'Please clarify the proposed capacity.',
    extra: Record<string, unknown> = {},
  ) =>
    officerApi(w.soA1)
      .post(`${appPath(applicationId)}/queries`)
      .send({ question, ...extra });
  const respond = (
    s: Submitted,
    queryId: string,
    responseText = 'Capacity is 500 units per month.',
  ) =>
    applicant()
      .post(queriesPath(s.projectId, s.applicationId, `/${queryId}/respond`))
      .send({ responseText });

  beforeAll(async () => {
    ctx = await createE2eContext();
    w = await buildOfficerWorld(ctx, 'sc');
  });

  afterAll(async () => {
    await ctx.cleanup();
    await ctx.app.close();
  });

  // -------------------------------------------------------------------------
  describe('the scrutiny lifecycle', () => {
    it('runs SUBMITTED -> UNDER_SCRUTINY -> RECOMMENDED_FOR_APPROVAL, and stops there (no decision is reachable)', async () => {
      const s = await submitted('life', {
        formData: { proposedCapacity: '500 units' },
      });
      expect((await dbApp(s.applicationId)).internalState).toBe('SUBMITTED');
      await assign(s.applicationId).expect(201);

      const started = await start(s.applicationId).expect(200);
      expect(started.body).toEqual({
        applicationId: s.applicationId,
        internalState: 'UNDER_SCRUTINY',
        applicantStatus: 'UNDER_SCRUTINY',
      });
      expect(await dbApp(s.applicationId)).toMatchObject({
        internalState: 'UNDER_SCRUTINY',
        applicantStatus: 'UNDER_SCRUTINY',
      });

      const rec = await officerApi(w.soA1)
        .post(`${appPath(s.applicationId)}/recommendation`)
        .send({
          outcome: 'APPROVE',
          reason: 'All documents are in order and the project is within scope.',
        })
        .expect(201);
      expect(rec.body).toMatchObject({
        outcome: 'APPROVE',
        recommendedByUserId: w.soA1.user.id,
        isRecommendationOnly: true,
      });
      const row = await dbApp(s.applicationId);
      expect(row).toMatchObject({
        internalState: 'RECOMMENDED_FOR_APPROVAL',
        applicantStatus: 'AWAITING_DECISION',
        // Nothing decided: the decision columns are untouched.
        decidedAt: null,
        decisionReason: null,
      });

      // The applicant sees the derived status through the existing endpoint.
      const seen = await applicant()
        .get(
          `/enterprises/${w.enterpriseId}/projects/${s.projectId}/applications/${s.applicationId}/status`,
        )
        .expect(200);
      expect(seen.body.applicantStatus).toBe('AWAITING_DECISION');
    });

    it('a REJECT recommendation is still only a recommendation: same state, decision untouched', async () => {
      const s = await underScrutiny('rej');
      const rec = await officerApi(w.soA1)
        .post(`${appPath(s.applicationId)}/recommendation`)
        .send({
          outcome: 'REJECT',
          reason: 'The land status contradicts the declared use.',
        })
        .expect(201);
      expect(rec.body.outcome).toBe('REJECT');
      expect(await dbApp(s.applicationId)).toMatchObject({
        internalState: 'RECOMMENDED_FOR_APPROVAL',
        decidedAt: null,
        decisionReason: null,
      });
    });

    it.each([
      ['a recommendation with no reason', { outcome: 'APPROVE' }],
      ['a blank reason', { outcome: 'APPROVE', reason: '   ' }],
      ['an unknown outcome', { outcome: 'APPROVED', reason: 'x' }],
      [
        'an approve-and-decide attempt',
        { outcome: 'APPROVE', reason: 'x', decision: 'APPROVED' },
      ],
      [
        'a smuggled status',
        { outcome: 'APPROVE', reason: 'x', internalState: 'APPROVED' },
      ],
      [
        'a smuggled department',
        { outcome: 'APPROVE', reason: 'x', departmentId: randomUUID() },
      ],
    ])('refuses %s and changes nothing', async (_l, body) => {
      const s = await underScrutiny('recbad');
      const res = await officerApi(w.soA1)
        .post(`${appPath(s.applicationId)}/recommendation`)
        .send(body)
        .expect(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect((await dbApp(s.applicationId)).internalState).toBe(
        'UNDER_SCRUTINY',
      );
      expect(
        await ctx.prisma.scrutinyRecommendation.count({
          where: { applicationId: s.applicationId },
        }),
      ).toBe(0);
    });

    describe('every action is allowed only from its defined state', () => {
      const actions: Record<string, (id: string) => request.Test> = {
        'raise a query': (id) => raiseQuery(id),
        recommend: (id) =>
          officerApi(w.soA1)
            .post(`${appPath(id)}/recommendation`)
            .send({ outcome: 'APPROVE', reason: 'ok' }),
        'record an observation': (id) =>
          officerApi(w.soA1)
            .post(`${appPath(id)}/observations`)
            .send({ body: 'note' }),
      };

      it('start-scrutiny twice, or after it has moved on', async () => {
        const s = await underScrutiny('twice');
        const again = await start(s.applicationId).expect(409);
        expect(again.body.error.code).toBe('INVALID_STATE_TRANSITION');
        expect((await dbApp(s.applicationId)).internalState).toBe(
          'UNDER_SCRUTINY',
        );
      });

      it.each(Object.keys(actions))(
        'cannot %s before scrutiny has started',
        async (name) => {
          const s = await submitted(`early-${name}`);
          await assign(s.applicationId).expect(201);
          const res = await actions[name](s.applicationId).expect(409);
          expect(['INVALID_STATE_TRANSITION']).toContain(res.body.error.code);
          expect((await dbApp(s.applicationId)).internalState).toBe(
            'SUBMITTED',
          );
        },
      );

      it('nothing can be done to an application once it is recommended', async () => {
        const s = await underScrutiny('done');
        await officerApi(w.soA1)
          .post(`${appPath(s.applicationId)}/recommendation`)
          .send({ outcome: 'APPROVE', reason: 'fine' })
          .expect(201);
        for (const res of [
          await start(s.applicationId),
          await raiseQuery(s.applicationId),
          await officerApi(w.soA1)
            .post(`${appPath(s.applicationId)}/recommendation`)
            .send({ outcome: 'REJECT', reason: 'changed my mind' }),
          await officerApi(w.soA1)
            .post(`${appPath(s.applicationId)}/observations`)
            .send({ body: 'late' }),
        ]) {
          expect(res.status).toBe(409);
        }
        expect((await dbApp(s.applicationId)).internalState).toBe(
          'RECOMMENDED_FOR_APPROVAL',
        );
        expect(
          await ctx.prisma.scrutinyRecommendation.count({
            where: { applicationId: s.applicationId },
          }),
        ).toBe(1);
      });
    });

    it('offers no route that takes a status or reaches a decision', async () => {
      const s = await underScrutiny('nostatus');
      const base = appPath(s.applicationId);
      const o = officerApi(w.soA1);
      for (const call of [
        () => o.patch(base).send({ status: 'APPROVED' }),
        () => o.put(base).send({ status: 'APPROVED' }),
        () => o.patch(`${base}/status`).send({ status: 'APPROVED' }),
        () => o.post(`${base}/status`).send({ status: 'APPROVED' }),
        () => o.post(`${base}/approve`).send({}),
        () => o.post(`${base}/reject`).send({}),
        () => o.post(`${base}/transition`).send({ to: 'APPROVED' }),
        () => o.del(base),
      ]) {
        expect((await call()).status).toBe(404);
      }
      // A decision route exists since Step 15, but is the Approving Authority's
      // alone: a Scrutiny Officer is refused (403), and nothing changes.
      expect(
        (
          await o
            .post(`${base}/decision`)
            .send({ outcome: 'APPROVE', reason: 'x' })
        ).status,
      ).toBe(403);
      // Even a real action ignores a state named in its body.
      const res = await o
        .post(`${base}/observations`)
        .send({ body: 'x', internalState: 'APPROVED' })
        .expect(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect((await dbApp(s.applicationId)).internalState).toBe(
        'UNDER_SCRUTINY',
      );
    });

    it('the applicant’s own routes cannot move an application either', async () => {
      const s = await underScrutiny('applicantroutes');
      const base = `/enterprises/${w.enterpriseId}/projects/${s.projectId}/applications/${s.applicationId}`;
      for (const call of [
        () => applicant().patch(base).send({ status: 'APPROVED' }),
        () =>
          applicant()
            .put(`${base}/draft`)
            .send({ formData: { a: 1 } }),
        () =>
          applicant()
            .post(`${base}/submit`)
            .send({ declarationAccepted: true }),
      ]) {
        expect([404, 409]).toContain((await call()).status);
      }
      expect((await dbApp(s.applicationId)).internalState).toBe(
        'UNDER_SCRUTINY',
      );
    });

    it('two simultaneous starts: exactly one wins', async () => {
      const s = await submitted('racestart');
      await assign(s.applicationId).expect(201);
      const results = await Promise.all(
        [1, 2, 3, 4].map(() => start(s.applicationId)),
      );
      expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409, 409]);
      const started = (await events(s.applicationId)).filter(
        (e) => e.action === 'SCRUTINY_STARTED',
      );
      expect(started).toHaveLength(1);
    });

    it('a recommendation racing a query: exactly one wins, and the state is one they define', async () => {
      const s = await underScrutiny('racemix');
      const results = await Promise.all([
        officerApi(w.soA1)
          .post(`${appPath(s.applicationId)}/recommendation`)
          .send({ outcome: 'APPROVE', reason: 'ok' }),
        raiseQuery(s.applicationId),
        officerApi(w.soA1)
          .post(`${appPath(s.applicationId)}/recommendation`)
          .send({ outcome: 'REJECT', reason: 'no' }),
      ]);
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      expect(results.filter((r) => r.status === 409)).toHaveLength(2);
      const row = await dbApp(s.applicationId);
      expect(['QUERY_RAISED', 'RECOMMENDED_FOR_APPROVAL']).toContain(
        row.internalState,
      );
      const recs = await ctx.prisma.scrutinyRecommendation.count({
        where: { applicationId: s.applicationId },
      });
      const queries = await ctx.prisma.applicationQuery.count({
        where: { applicationId: s.applicationId },
      });
      expect(recs + queries).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  describe('internal observations', () => {
    it('records an observation that is never visible to the applicant', async () => {
      const s = await underScrutiny('obs');
      const secret = 'INTERNAL-ONLY the applicant must never read this';
      const res = await officerApi(w.soA1)
        .post(`${appPath(s.applicationId)}/observations`)
        .send({ body: secret, relatedField: 'proposedCapacity' })
        .expect(201);
      expect(res.body).toMatchObject({
        authorUserId: w.soA1.user.id,
        body: secret,
        relatedField: 'proposedCapacity',
        relatedDocumentId: null,
      });

      // Officers see it...
      const detail = await officerApi(w.soA1)
        .get(appPath(s.applicationId))
        .expect(200);
      expect(
        detail.body.observations.map((o: { body: string }) => o.body),
      ).toContain(secret);
      const asAdmin = await officerApi(w.adminA)
        .get(appPath(s.applicationId))
        .expect(200);
      expect(asAdmin.body.observations).toHaveLength(1);

      // ...the applicant never does, through any applicant-facing route.
      const base = `/enterprises/${w.enterpriseId}/projects/${s.projectId}/applications/${s.applicationId}`;
      for (const url of [
        base,
        `${base}/status`,
        `${base}/queries`,
        `${base}/documents`,
      ]) {
        const seen = await applicant().get(url).expect(200);
        expect(JSON.stringify(seen.body)).not.toContain('INTERNAL-ONLY');
      }
      const list = await applicant()
        .get(`/enterprises/${w.enterpriseId}/applications`)
        .expect(200);
      expect(JSON.stringify(list.body)).not.toContain('INTERNAL-ONLY');
    });

    it('validates and links an observation to this application’s own document only', async () => {
      const s = await underScrutiny('obslink', withDocument('obslink'));
      const other = await underScrutiny(
        'obslink-other',
        withDocument('obslink-other'),
      );
      const docs = await officerApi(w.soA1)
        .get(`${appPath(s.applicationId)}/documents`)
        .expect(200);
      const otherDocs = await officerApi(w.soA1)
        .get(`${appPath(other.applicationId)}/documents`)
        .expect(200);

      const ok = await officerApi(w.soA1)
        .post(`${appPath(s.applicationId)}/observations`)
        .send({ body: 'legibility', relatedDocumentId: docs.body[0].id })
        .expect(201);
      expect(ok.body.relatedDocumentId).toBe(docs.body[0].id);
      // Another application's document is "not found", exactly like a missing one.
      for (const id of [otherDocs.body[0].id, randomUUID()]) {
        const res = await officerApi(w.soA1)
          .post(`${appPath(s.applicationId)}/observations`)
          .send({ body: 'x', relatedDocumentId: id })
          .expect(404);
        expect(res.body.error.code).toBe('NOT_FOUND');
      }
      for (const body of [
        {},
        { body: '' },
        { body: '   ' },
        { body: 'x'.repeat(5001) },
        { body: 'x', relatedField: 'bad field!' },
        { body: 'x', relatedDocumentId: 'nope' },
        { body: 'x', authorUserId: w.soA2.user.id },
      ]) {
        await officerApi(w.soA1)
          .post(`${appPath(s.applicationId)}/observations`)
          .send(body)
          .expect(400);
      }
      expect(
        await ctx.prisma.scrutinyObservation.count({
          where: { applicationId: s.applicationId },
        }),
      ).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  describe('the query / clarification loop', () => {
    it('raise -> applicant sees it -> respond -> officer closes -> a second round', async () => {
      const s = await underScrutiny('loop');
      const q1 = await raiseQuery(
        s.applicationId,
        'What is the proposed capacity?',
      ).expect(201);
      expect(q1.body).toMatchObject({
        roundNumber: 1,
        status: 'OPEN',
        raisedByUserId: w.soA1.user.id,
        question: 'What is the proposed capacity?',
        response: null,
        closedAt: null,
      });
      expect(await dbApp(s.applicationId)).toMatchObject({
        internalState: 'QUERY_RAISED',
        applicantStatus: 'QUERY_RAISED',
      });

      // The applicant's view: department, question, no officer identity.
      const listed = await applicant()
        .get(queriesPath(s.projectId, s.applicationId))
        .expect(200);
      expect(listed.body).toHaveLength(1);
      expect(listed.body[0]).toMatchObject({
        id: q1.body.id,
        roundNumber: 1,
        status: 'OPEN',
        question: 'What is the proposed capacity?',
        department: { id: w.deptA.id, code: w.deptA.code },
        response: null,
      });
      expect(listed.body[0]).not.toHaveProperty('raisedByUserId');
      expect(listed.body[0]).not.toHaveProperty('sourceObservationId');
      expect(JSON.stringify(listed.body)).not.toContain(w.soA1.user.id);

      const answered = await respond(
        s,
        q1.body.id,
        'It is 500 units per month.',
      ).expect(200);
      expect(answered.body).toMatchObject({
        status: 'RESPONDED',
        response: {
          text: 'It is 500 units per month.',
          respondedByUserId: w.owner.user.id,
        },
      });
      expect(await dbApp(s.applicationId)).toMatchObject({
        internalState: 'APPLICANT_RESPONDED',
        applicantStatus: 'UNDER_SCRUTINY',
      });

      const closed = await officerApi(w.soA1)
        .post(`${appPath(s.applicationId)}/queries/${q1.body.id}/close`)
        .expect(200);
      expect(closed.body).toMatchObject({ status: 'CLOSED', roundNumber: 1 });
      expect(closed.body.closedAt).toEqual(expect.any(String));
      expect(await dbApp(s.applicationId)).toMatchObject({
        internalState: 'UNDER_SCRUTINY',
        applicantStatus: 'UNDER_SCRUTINY',
      });

      // A further query is a new round; the first stays exactly as it was.
      const q2 = await raiseQuery(
        s.applicationId,
        'Please attach the boiler certificate.',
      ).expect(201);
      expect(q2.body.roundNumber).toBe(2);
      const all = await officerApi(w.soA1)
        .get(appPath(s.applicationId))
        .expect(200);
      expect(
        all.body.queries.map((q: { roundNumber: number; status: string }) => [
          q.roundNumber,
          q.status,
        ]),
      ).toEqual([
        [1, 'CLOSED'],
        [2, 'OPEN'],
      ]);
      expect(all.body.queries[0].response.text).toBe(
        'It is 500 units per month.',
      );
    });

    it('turns an internal observation into a formal query without exposing the observation', async () => {
      const s = await underScrutiny('fromobs');
      const obs = await officerApi(w.soA1)
        .post(`${appPath(s.applicationId)}/observations`)
        .send({ body: 'INTERNAL reasoning: capacity looks inflated' })
        .expect(201);
      const q = await raiseQuery(
        s.applicationId,
        'Please justify the stated capacity.',
        { sourceObservationId: obs.body.id },
      ).expect(201);
      expect(q.body.sourceObservationId).toBe(obs.body.id);
      const seen = await applicant()
        .get(queriesPath(s.projectId, s.applicationId))
        .expect(200);
      expect(JSON.stringify(seen.body)).not.toContain('INTERNAL reasoning');
      // An observation of another application cannot be cited.
      const other = await underScrutiny('fromobs-other');
      const foreign = await officerApi(w.soA1)
        .post(`${appPath(other.applicationId)}/observations`)
        .send({ body: 'x' })
        .expect(201);
      const s2 = await underScrutiny('fromobs2');
      await raiseQuery(s2.applicationId, 'q', {
        sourceObservationId: foreign.body.id,
      }).expect(404);
      expect((await dbApp(s2.applicationId)).internalState).toBe(
        'UNDER_SCRUTINY',
      );
    });

    it('the applicant’s answer needs Full Delegation (or the owner), never a lesser scope', async () => {
      const s = await underScrutiny('scopes');
      const q = await raiseQuery(s.applicationId).expect(201);
      const grant = async (scope: string, tag: string) => {
        const rep = await ctx.applicantSession(`sc-rep-${tag}`);
        const g = await applicant()
          .post(`/enterprises/${w.enterpriseId}/representatives`)
          .send({ emailOrMobile: rep.user.email, scope })
          .expect(201);
        await as(ctx, rep.accessToken)
          .post(`/representative-authorisations/${g.body.id}/accept`)
          .expect(200);
        return rep;
      };
      const view = await grant('VIEW_ONLY', 'v');
      const prepare = await grant('PREPARE_SUBMIT', 'p');
      const full = await grant('FULL', 'f');
      const url = queriesPath(
        s.projectId,
        s.applicationId,
        `/${q.body.id}/respond`,
      );

      for (const rep of [view, prepare]) {
        const res = await as(ctx, rep.accessToken)
          .post(url)
          .send({ responseText: 'nope' })
          .expect(403);
        expect(res.body.error.code).toBe('FORBIDDEN_SCOPE');
      }
      // View Only can READ the queries.
      await as(ctx, view.accessToken)
        .get(queriesPath(s.projectId, s.applicationId))
        .expect(200);
      expect(
        (
          await ctx.prisma.applicationQuery.findUniqueOrThrow({
            where: { id: q.body.id },
          })
        ).status,
      ).toBe('OPEN');

      const ok = await as(ctx, full.accessToken)
        .post(url)
        .send({ responseText: 'From the FULL representative.' })
        .expect(200);
      expect(ok.body.response.respondedByUserId).toBe(full.user.id);
      // The audit trail attributes it to the representative.
      const audit = (await events(s.applicationId)).find(
        (e) => e.action === 'QUERY_RESPONDED',
      )!;
      expect(audit.userId).toBe(full.user.id);
      expect(audit.afterState).toMatchObject({
        actingAs: 'REPRESENTATIVE',
        representativeScope: 'FULL',
        enterpriseId: w.enterpriseId,
      });
    });

    it('a query can be answered exactly once, and only while open', async () => {
      const s = await underScrutiny('once');
      const q = await raiseQuery(s.applicationId).expect(201);
      const results = await Promise.all(
        [1, 2, 3].map((i) => respond(s, q.body.id, `answer ${i}`)),
      );
      expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409]);
      for (const r of results.filter((x) => x.status === 409)) {
        expect(r.body.error.code).toBe('QUERY_NOT_OPEN');
      }
      const stored = await ctx.prisma.applicationQuery.findUniqueOrThrow({
        where: { id: q.body.id },
      });
      expect(stored.responseText).toMatch(/^answer [123]$/);
      // Once closed, no further answer is accepted either.
      await officerApi(w.soA1)
        .post(`${appPath(s.applicationId)}/queries/${q.body.id}/close`)
        .expect(200);
      const late = await respond(s, q.body.id, 'too late').expect(409);
      expect(late.body.error.code).toBe('QUERY_NOT_OPEN');
      expect(
        (
          await ctx.prisma.applicationQuery.findUniqueOrThrow({
            where: { id: q.body.id },
          })
        ).responseText,
      ).toBe(stored.responseText);
    });

    it.each([
      ['an empty response', { responseText: '' }],
      ['a blank response', { responseText: '   ' }],
      ['an over-long response', { responseText: 'x'.repeat(5001) }],
      ['no response', {}],
      ['a smuggled status', { responseText: 'ok', internalState: 'APPROVED' }],
      ['an edited question', { responseText: 'ok', question: 'rewritten' }],
    ])('rejects %s', async (_l, body) => {
      const s = await underScrutiny('badresp');
      const q = await raiseQuery(s.applicationId, 'Original question').expect(
        201,
      );
      const res = await applicant()
        .post(
          queriesPath(s.projectId, s.applicationId, `/${q.body.id}/respond`),
        )
        .send(body)
        .expect(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      const stored = await ctx.prisma.applicationQuery.findUniqueOrThrow({
        where: { id: q.body.id },
      });
      expect(stored).toMatchObject({
        status: 'OPEN',
        responseText: null,
        question: 'Original question',
      });
    });

    it('rejects a question with no text and one with nothing to raise it from', async () => {
      const s = await underScrutiny('badq');
      for (const body of [
        {},
        { question: '' },
        { question: '  ' },
        { question: 'x'.repeat(5001) },
        { question: 'q', raisedByUserId: w.soA2.user.id },
        { question: 'q', roundNumber: 9 },
        { question: 'q', status: 'CLOSED' },
      ]) {
        await officerApi(w.soA1)
          .post(`${appPath(s.applicationId)}/queries`)
          .send(body)
          .expect(400);
      }
      expect(
        await ctx.prisma.applicationQuery.count({
          where: { applicationId: s.applicationId },
        }),
      ).toBe(0);
    });

    it('an officer cannot close a query the applicant has not answered, nor raise a second while one is open', async () => {
      const s = await underScrutiny('closerules');
      const q = await raiseQuery(s.applicationId).expect(201);
      const early = await officerApi(w.soA1)
        .post(`${appPath(s.applicationId)}/queries/${q.body.id}/close`)
        .expect(409);
      expect(early.body.error.code).toBe('INVALID_STATE_TRANSITION');
      const second = await raiseQuery(s.applicationId, 'another').expect(409);
      expect(second.body.error.code).toBe('INVALID_STATE_TRANSITION');
      expect(
        await ctx.prisma.applicationQuery.count({
          where: { applicationId: s.applicationId },
        }),
      ).toBe(1);
      await officerApi(w.soA1)
        .post(`${appPath(s.applicationId)}/queries/${randomUUID()}/close`)
        .expect(409); // wrong state before existence
    });

    it('cannot answer or list another application’s / enterprise’s queries', async () => {
      const s = await underScrutiny('isoq');
      const other = await underScrutiny('isoq-other');
      const q = await raiseQuery(s.applicationId).expect(201);
      const otherQ = await raiseQuery(other.applicationId).expect(201);
      // The right enterprise + application, but another application's query id.
      await respond(s, otherQ.body.id).expect(404);
      // A different enterprise's owner reaches nothing.
      const o2 = as(ctx, w.owner2.accessToken);
      await o2.get(queriesPath(s.projectId, s.applicationId)).expect(404);
      await o2
        .post(
          queriesPath(s.projectId, s.applicationId, `/${q.body.id}/respond`),
        )
        .send({ responseText: 'hijack' })
        .expect(404);
      expect(
        (
          await ctx.prisma.applicationQuery.findUniqueOrThrow({
            where: { id: q.body.id },
          })
        ).status,
      ).toBe('OPEN');
    });

    it('opens the applicant’s document upload while a query is open, and only then', async () => {
      const s = await underScrutiny('qdocs', withDocument('qdocs'));
      const base = (path = '') =>
        ctx.uploadDocument(
          w.owner.accessToken,
          w.enterpriseId,
          s.projectId,
          s.applicationId,
          pdfBytes(),
          path ? { path } : {},
        );
      // UNDER_SCRUTINY: the form and its documents are read-only (FRD 17.3).
      expect((await base()).status).toBe(409);

      const q = await raiseQuery(
        s.applicationId,
        'Please attach the site plan.',
      ).expect(201);
      const uploaded = await base().then((r) => r);
      expect(uploaded.status).toBe(201);
      await respond(s, q.body.id).expect(200);
      // Answered, but not yet closed: the department may still be reading.
      expect((await base()).status).toBe(409);
      await officerApi(w.soA1)
        .post(`${appPath(s.applicationId)}/queries/${q.body.id}/close`)
        .expect(200);
      expect((await base()).status).toBe(409);
      // The document added during the query is visible to the officer.
      const docs = await officerApi(w.soA1)
        .get(`${appPath(s.applicationId)}/documents`)
        .expect(200);
      expect(docs.body).toHaveLength(2);
    });
  });

  // -------------------------------------------------------------------------
  describe('document review and access', () => {
    const docsOf = async (applicationId: string) =>
      (
        await officerApi(w.soA1)
          .get(`${appPath(applicationId)}/documents`)
          .expect(200)
      ).body as Array<{ id: string; status: string; version: number }>;
    const review = (
      applicationId: string,
      documentId: string,
      body: Record<string, unknown>,
      officer = w.soA1,
    ) =>
      officerApi(officer)
        .post(`${appPath(applicationId)}/documents/${documentId}/review`)
        .send(body);

    it('verifies a scanned document: status, review record and audit', async () => {
      const s = await underScrutiny('verify', withDocument('verify'));
      const [doc] = await docsOf(s.applicationId);
      expect(doc.status).toBe('VALIDATION_PENDING');
      const res = await review(s.applicationId, doc.id, {
        verdict: 'VERIFIED',
        notes: 'Original seen.',
        validUntil: '2030-01-31',
      }).expect(200);
      expect(res.body).toMatchObject({
        id: doc.id,
        status: 'VERIFIED',
        review: {
          verdict: 'VERIFIED',
          reason: null,
          notes: 'Original seen.',
          reviewedByUserId: w.soA1.user.id,
        },
      });
      const row = await ctx.prisma.documentVerification.findFirstOrThrow({
        where: { documentId: doc.id },
      });
      expect(row).toMatchObject({
        verdict: 'VERIFIED',
        verifiedByUserId: w.soA1.user.id,
        notes: 'Original seen.',
      });
      expect(row.validUntil?.toISOString().slice(0, 10)).toBe('2030-01-31');
      const audit = (await events(doc.id)).find(
        (e) => e.action === 'DOCUMENT_VERIFIED',
      )!;
      expect(audit.userId).toBe(w.soA1.user.id);
      expect(audit.roleAtTime).toBe('SCRUTINY_OFFICER');
      expect(audit.afterState).toMatchObject({
        departmentId: w.deptA.id,
        applicationId: s.applicationId,
        version: 1,
        verdict: 'VERIFIED',
      });
    });

    it('rejects a document only with a reason, which the applicant then sees (the officer’s notes stay internal)', async () => {
      const s = await underScrutiny('reject', withDocument('reject'));
      const [doc] = await docsOf(s.applicationId);
      for (const body of [
        { verdict: 'REJECTED' },
        { verdict: 'REJECTED', notes: '   ' },
        { verdict: 'REJECTED', notes: 'x', validUntil: '2030-01-01' },
      ]) {
        await review(s.applicationId, doc.id, body).expect(400);
      }
      expect((await docsOf(s.applicationId))[0].status).toBe(
        'VALIDATION_PENDING',
      );

      await review(s.applicationId, doc.id, {
        verdict: 'REJECTED',
        notes: 'The scan is illegible.',
      }).expect(200);
      const applicantView = await applicant()
        .get(
          `/enterprises/${w.enterpriseId}/projects/${s.projectId}/applications/${s.applicationId}/documents/${doc.id}`,
        )
        .expect(200);
      expect(applicantView.body).toMatchObject({
        status: 'REJECTED',
        downloadable: false,
        review: { verdict: 'REJECTED', reason: 'The scan is illegible.' },
      });
      expect(applicantView.body.review).not.toHaveProperty('notes');
      expect(applicantView.body.review).not.toHaveProperty('reviewedByUserId');
      const audit = (await events(doc.id)).find(
        (e) => e.action === 'DOCUMENT_REJECTED_BY_OFFICER',
      )!;
      expect(audit.afterState).toMatchObject({ verdict: 'REJECTED' });
    });

    it('a verified document’s internal notes are never shown to the applicant', async () => {
      const s = await underScrutiny('vnotes', withDocument('vnotes'));
      const [doc] = await docsOf(s.applicationId);
      await review(s.applicationId, doc.id, {
        verdict: 'VERIFIED',
        notes: 'INTERNAL: matches the register',
      }).expect(200);
      const seen = await applicant()
        .get(
          `/enterprises/${w.enterpriseId}/projects/${s.projectId}/applications/${s.applicationId}/documents`,
        )
        .expect(200);
      expect(JSON.stringify(seen.body)).not.toContain('INTERNAL: matches');
      expect(seen.body[0].review).toMatchObject({
        verdict: 'VERIFIED',
        reason: null,
      });
    });

    it('a document is reviewed once; reviews cannot be repeated or changed', async () => {
      const s = await underScrutiny('once-review', withDocument('once-review'));
      const [doc] = await docsOf(s.applicationId);
      const results = await Promise.all(
        [1, 2, 3].map((i) =>
          review(
            s.applicationId,
            doc.id,
            i === 1
              ? { verdict: 'VERIFIED' }
              : { verdict: 'REJECTED', notes: `no ${i}` },
          ),
        ),
      );
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      for (const r of results.filter((x) => x.status === 409)) {
        expect(r.body.error.code).toBe('DOCUMENT_NOT_REVIEWABLE');
      }
      expect(
        await ctx.prisma.documentVerification.count({
          where: { documentId: doc.id },
        }),
      ).toBe(1);
      const again = await review(s.applicationId, doc.id, {
        verdict: 'REJECTED',
        notes: 'changed',
      }).expect(409);
      expect(again.body.error.code).toBe('DOCUMENT_NOT_REVIEWABLE');
    });

    it('review refuses documents that are not on the application, unknown verdicts and smuggled fields', async () => {
      const s = await underScrutiny(
        'rules-review',
        withDocument('rules-review'),
      );
      const [doc] = await docsOf(s.applicationId);
      // A document that is not on this application.
      const other = await underScrutiny(
        'rules-review-other',
        withDocument('rules-review-other'),
      );
      const [foreign] = await docsOf(other.applicationId);
      await review(s.applicationId, foreign.id, { verdict: 'VERIFIED' }).expect(
        404,
      );
      await review(s.applicationId, randomUUID(), {
        verdict: 'VERIFIED',
      }).expect(404);
      await review(s.applicationId, 'not-a-uuid', {
        verdict: 'VERIFIED',
      }).expect(400);
      // Unknown verdicts and smuggled fields.
      for (const body of [
        { verdict: 'APPROVED' },
        { verdict: 'CLEAN' },
        {},
        { verdict: 'VERIFIED', status: 'VERIFIED', scannedAt: new Date() },
      ]) {
        await review(s.applicationId, doc.id, body).expect(400);
      }
      expect((await docsOf(s.applicationId))[0].status).toBe(
        'VALIDATION_PENDING',
      );
    });

    it('mid-query the applicant may still be changing documents, so review waits until scrutiny resumes', async () => {
      const s = await underScrutiny('midq', withDocument('midq'));
      const [doc] = await docsOf(s.applicationId);
      const q = await raiseQuery(s.applicationId).expect(201);
      const res = await review(s.applicationId, doc.id, {
        verdict: 'VERIFIED',
      }).expect(409);
      expect(res.body.error.code).toBe('DOCUMENT_NOT_REVIEWABLE');
      await respond(s, q.body.id).expect(200);
      await review(s.applicationId, doc.id, { verdict: 'VERIFIED' }).expect(
        409,
      );
      await officerApi(w.soA1)
        .post(`${appPath(s.applicationId)}/queries/${q.body.id}/close`)
        .expect(200);
      await review(s.applicationId, doc.id, { verdict: 'VERIFIED' }).expect(
        200,
      );
    });

    it('only the CURRENT version is reviewable; a replaced version keeps its history', async () => {
      const s = await underScrutiny('replaced', withDocument('replaced-v1'));
      const [v1] = await docsOf(s.applicationId);
      await review(s.applicationId, v1.id, {
        verdict: 'REJECTED',
        notes: 'blurred',
      }).expect(200);
      const q = await raiseQuery(
        s.applicationId,
        'Please upload a clearer copy.',
      ).expect(201);
      // The applicant replaces the rejected document while the query is open.
      const v2 = await ctx
        .uploadDocument(
          w.owner.accessToken,
          w.enterpriseId,
          s.projectId,
          s.applicationId,
          pdfBytes('replaced-v2'),
          { path: `documents/${v1.id}/replace` },
        )
        .expect(201);
      expect(v2.body).toMatchObject({
        version: 2,
        previousVersionId: v1.id,
        status: 'VALIDATION_PENDING',
      });
      await respond(s, q.body.id).expect(200);
      await officerApi(w.soA1)
        .post(`${appPath(s.applicationId)}/queries/${q.body.id}/close`)
        .expect(200);

      // The old version can no longer be reviewed; the new one can.
      const stale = await review(s.applicationId, v1.id, {
        verdict: 'VERIFIED',
      }).expect(409);
      expect(stale.body.error.code).toBe('DOCUMENT_NOT_REVIEWABLE');
      await review(s.applicationId, v2.body.id, { verdict: 'VERIFIED' }).expect(
        200,
      );

      const chain = await officerApi(w.soA1)
        .get(`${appPath(s.applicationId)}/documents/${v2.body.id}/versions`)
        .expect(200);
      expect(
        chain.body.map((d: { version: number; status: string }) => [
          d.version,
          d.status,
        ]),
      ).toEqual([
        [1, 'REJECTED'],
        [2, 'VERIFIED'],
      ]);
      // The submission snapshot still says which version was used at submission.
      const detail = await officerApi(w.soA1)
        .get(appPath(s.applicationId))
        .expect(200);
      expect(detail.body.submittedDocuments).toHaveLength(1);
      expect(detail.body.submittedDocuments[0]).toMatchObject({
        documentId: v1.id,
        version: 1,
      });
    });

    it('serves a scanned document to the assigned officer, audited with role and department', async () => {
      const bytes = pdfBytes('officer-download');
      const s = await underScrutiny('dl', {
        beforeSubmit: async ({ projectId, applicationId }) => {
          await ctx
            .uploadDocument(
              w.owner.accessToken,
              w.enterpriseId,
              projectId,
              applicationId,
              bytes,
            )
            .expect(201);
        },
      });
      const [doc] = await docsOf(s.applicationId);
      const res = await officerApi(w.soA1)
        .get(`${appPath(s.applicationId)}/documents/${doc.id}/download`)
        .buffer(true)
        .parse((r, cb) => {
          const chunks: Buffer[] = [];
          r.on('data', (c: Buffer) => chunks.push(c));
          r.on('end', () => cb(null, Buffer.concat(chunks)));
        })
        .expect(200);
      expect(res.body).toEqual(bytes);
      expect(res.headers['content-disposition']).toMatch(/^attachment;/);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['cache-control']).toBe('private, no-store');

      const audit = (await events(doc.id)).find(
        (e) => e.action === 'DOCUMENT_DOWNLOADED',
      )!;
      expect(audit.userId).toBe(w.soA1.user.id);
      expect(audit.roleAtTime).toBe('SCRUTINY_OFFICER');
      expect(audit.afterState).toMatchObject({
        departmentId: w.deptA.id,
        actingAs: 'SCRUTINY_OFFICER',
        applicationId: s.applicationId,
        documentId: doc.id,
      });
    });

    it('never serves a rejected, never-scanned or scan-pending document', async () => {
      const s = await underScrutiny('blocked', withDocument('blocked'));
      const make = (
        status: 'REJECTED' | 'SCAN_PENDING' | 'UPLOADED',
        scanned: boolean,
      ) =>
        ctx.prisma.document.create({
          data: {
            ownerType: 'PROJECT',
            ownerId: s.projectId,
            filePath: `documents/fixture/${randomUUID()}`,
            checksum: 'x',
            originalFilename: 'fixture.pdf',
            mimeType: 'application/pdf',
            sizeBytes: 1,
            status,
            scannedAt: scanned ? new Date() : null,
            uploadedBy: w.owner.user.id,
            applicationDocuments: {
              create: { applicationId: s.applicationId },
            },
          },
        });
      for (const [status, scanned] of [
        ['REJECTED', true],
        ['SCAN_PENDING', false],
        ['UPLOADED', false],
      ] as const) {
        const row = await make(status, scanned);
        const res = await officerApi(w.soA1)
          .get(`${appPath(s.applicationId)}/documents/${row.id}/download`)
          .expect(409);
        expect(res.body.error.code).toBe('DOCUMENT_NOT_AVAILABLE');
        // ...and it cannot be reviewed into acceptance either.
        await review(s.applicationId, row.id, { verdict: 'VERIFIED' }).expect(
          409,
        );
      }
    });

    it('a storage key can never be reached through an officer route (traversal rows, missing objects)', async () => {
      const s = await underScrutiny('officer-key', withDocument('officer-key'));
      const row = await ctx.prisma.document.create({
        data: {
          ownerType: 'PROJECT',
          ownerId: s.projectId,
          filePath: '../../../etc/passwd',
          checksum: 'x',
          originalFilename: 'evil.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 1,
          status: 'VALIDATION_PENDING',
          scannedAt: new Date(),
          uploadedBy: w.owner.user.id,
          applicationDocuments: { create: { applicationId: s.applicationId } },
        },
      });
      const res = await officerApi(w.soA1)
        .get(`${appPath(s.applicationId)}/documents/${row.id}/download`)
        .expect(500);
      expect(res.body.error.code).toBe('DOCUMENT_INTEGRITY_ERROR');
      expect(JSON.stringify(res.body)).not.toMatch(/passwd|etc\//);
      for (const bad of ['..%2F..%2Fetc%2Fpasswd', 'not-a-uuid', '%2e%2e']) {
        expect([400, 404]).toContain(
          (
            await officerApi(w.soA1).get(
              `${appPath(s.applicationId)}/documents/${bad}/download`,
            )
          ).status,
        );
      }
    });

    it('lists only current versions by default and exposes no storage internals', async () => {
      const s = await underScrutiny('listdocs', withDocument('listdocs'));
      const res = await officerApi(w.soA1)
        .get(`${appPath(s.applicationId)}/documents`)
        .expect(200);
      const text = JSON.stringify(res.body);
      const row = await ctx.prisma.document.findFirstOrThrow({
        where: { id: res.body[0].id },
      });
      expect(text).not.toContain(row.filePath);
      expect(text).not.toContain(row.checksum);
      expect(res.body[0]).not.toHaveProperty('filePath');
      expect(res.body[0]).not.toHaveProperty('checksum');
      expect(res.body[0]).toMatchObject({
        isCurrent: true,
        downloadable: true,
        review: null,
      });
    });
  });

  // -------------------------------------------------------------------------
  describe('the stored discovery context', () => {
    it('shows the rule version that suggested the approval, read from the immutable snapshot', async () => {
      const s = await underScrutiny('disc');
      const res = await officerApi(w.soA1)
        .get(`${appPath(s.applicationId)}/discovery`)
        .expect(200);
      const snapshot = await ctx.prisma.discoverySnapshot.findUniqueOrThrow({
        where: { id: s.snapshotId },
      });
      expect(res.body).toMatchObject({
        snapshotId: s.snapshotId,
        snapshotEvaluatedAt: snapshot.evaluatedAt.toISOString(),
        engineVersion: snapshot.engineVersion,
        approvalType: { id: w.approvalA },
        department: { id: w.deptA.id },
        recommendationLabel: 'POTENTIALLY_APPLICABLE',
      });
      expect(res.body.rule).toMatchObject({
        version: 1,
        sourceReference: 'E2E TEST FIXTURE',
      });
      expect(res.body.explanation).toMatch(/^Shown because:/);
      expect(res.body.trace).toBeDefined();
      expect(res.body.dependsOn).toEqual([]);
      expect(res.body.notice).toMatch(
        /not a legal or statutory determination/i,
      );
      expect(res.body.notice).toMatch(
        /recommendation, not a statutory determination/i,
      );
    });

    it('is NOT re-evaluated: a newer rule version changes nothing the officer sees', async () => {
      // Its own approval type, because publishing a non-matching rule version
      // would stop the shared one from being discoverable for later tests.
      const own = await ctx.createStartableApproval(w.owner.user.id, 'frozen', {
        departmentId: w.deptA.id,
      });
      const s = await ctx.submittedApplication(
        w.owner.accessToken,
        w.enterpriseId,
        own.approvalTypeId,
        'disc-frozen',
      );
      await assign(s.applicationId).expect(201);
      await start(s.applicationId).expect(200);

      const before = (
        await officerApi(w.soA1)
          .get(`${appPath(s.applicationId)}/discovery`)
          .expect(200)
      ).body;
      // A newer rule version that would NOT match this project any more.
      const v2 = await ctx.publishRule(w.owner.user.id, own.approvalTypeId, {
        field: 'hazardous_flag',
        op: 'equals',
        value: true,
      });
      expect(v2.version).toBe(2);
      const after = (
        await officerApi(w.soA1)
          .get(`${appPath(s.applicationId)}/discovery`)
          .expect(200)
      ).body;
      expect(after).toEqual(before);
      expect(after.rule.version).toBe(1);
      const detail = await officerApi(w.soA1)
        .get(appPath(s.applicationId))
        .expect(200);
      expect(detail.body.referenceNumber).toBe(s.referenceNumber);
      // Looking never creates a snapshot: discovery is not re-run.
      expect(
        await ctx.prisma.discoverySnapshot.count({
          where: { projectId: s.projectId },
        }),
      ).toBe(1);
    });

    it('is reachable only through an application the caller can see', async () => {
      const s = await underScrutiny('disc-scope');
      await officerApi(w.soA2)
        .get(`${appPath(s.applicationId)}/discovery`)
        .expect(404);
      await officerApi(w.soB)
        .get(`${appPath(s.applicationId)}/discovery`)
        .expect(404);
      await officerApi(w.adminA)
        .get(`${appPath(s.applicationId)}/discovery`)
        .expect(200);
      await officerApi(w.inspectorA)
        .get(`${appPath(s.applicationId)}/discovery`)
        .expect(403);
    });
  });

  // -------------------------------------------------------------------------
  describe('application detail and history', () => {
    it('opens the full working view with project and enterprise context, and audits the access', async () => {
      const s = await underScrutiny('detail', {
        formData: { proposedCapacity: '500 units' },
        ...withDocument('detail'),
      });
      const res = await officerApi(w.soA1)
        .get(appPath(s.applicationId))
        .expect(200);
      const b = res.body;
      expect(b).toMatchObject({
        id: s.applicationId,
        referenceNumber: s.referenceNumber,
        internalState: 'UNDER_SCRUTINY',
        applicantStatus: 'UNDER_SCRUTINY',
        actingRole: 'SCRUTINY_OFFICER',
        formData: { proposedCapacity: '500 units' },
        approvalType: { id: w.approvalA },
        department: { id: w.deptA.id },
        submittedByUserId: w.owner.user.id,
        assignedOfficer: { userId: w.soA1.user.id },
        awaitingApplicant: false,
        assignmentHistory: null,
      });
      expect(b.enterpriseDetails).toMatchObject({
        id: w.enterpriseId,
        referenceNumber: expect.stringMatching(/^ENT-/),
      });
      expect(b.projectDetails).toMatchObject({
        id: s.projectId,
        referenceNumber: expect.stringMatching(/^PRJ-/),
        district: 'Pune',
      });
      expect(b.documents).toHaveLength(1);
      expect(b.submittedDocuments).toHaveLength(1);
      expect(b.availableActions).toEqual(
        expect.arrayContaining([
          'RAISE_QUERY',
          'RECOMMEND',
          'RECORD_OBSERVATION',
          'REVIEW_DOCUMENT',
        ]),
      );
      expect(b.availableActions).not.toContain('START_SCRUTINY');
      // No owner PII beyond what scrutiny needs.
      const text = JSON.stringify(b);
      expect(text).not.toContain(w.owner.user.email);
      expect(text).not.toContain(w.owner.user.mobile);
      expect(b.enterpriseDetails).not.toHaveProperty('ownerUserId');
      expect(b.enterpriseDetails).not.toHaveProperty('contactPersonMobile');

      const opened = (await events(s.applicationId)).filter(
        (e) => e.action === 'APPLICATION_OPENED_FOR_SCRUTINY',
      );
      expect(opened).toHaveLength(1);
      expect(opened[0]).toMatchObject({
        userId: w.soA1.user.id,
        roleAtTime: 'SCRUTINY_OFFICER',
      });
      expect(opened[0].afterState).toMatchObject({
        departmentId: w.deptA.id,
        applicationId: s.applicationId,
        enterpriseId: w.enterpriseId,
        projectId: s.projectId,
      });
      expect(opened[0].ruleVersionUsed).toMatch(/@v1$/);
    });

    it('offers a submitted, unstarted application only the actions that apply', async () => {
      const s = await submitted('actions');
      await assign(s.applicationId).expect(201);
      const asOfficer = await officerApi(w.soA1)
        .get(appPath(s.applicationId))
        .expect(200);
      expect(asOfficer.body.availableActions).toEqual(['START_SCRUTINY']);
      const asAdmin = await officerApi(w.adminA)
        .get(appPath(s.applicationId))
        .expect(200);
      expect(asAdmin.body.availableActions).toEqual(['REASSIGN']);
    });

    it('tells the story in order, in plain language, without security data or internal text', async () => {
      const s = await underScrutiny('story', withDocument('story'));
      await officerApi(w.soA1)
        .post(`${appPath(s.applicationId)}/observations`)
        .send({ body: 'SECRET BODY TEXT' })
        .expect(201);
      const q = await raiseQuery(s.applicationId, 'A question').expect(201);
      await respond(s, q.body.id, 'An answer').expect(200);
      await officerApi(w.soA1)
        .post(`${appPath(s.applicationId)}/queries/${q.body.id}/close`)
        .expect(200);
      const [doc] = (
        await officerApi(w.soA1)
          .get(`${appPath(s.applicationId)}/documents`)
          .expect(200)
      ).body;
      await officerApi(w.soA1)
        .post(`${appPath(s.applicationId)}/documents/${doc.id}/review`)
        .send({ verdict: 'VERIFIED' })
        .expect(200);
      await officerApi(w.soA1)
        .post(`${appPath(s.applicationId)}/recommendation`)
        .send({ outcome: 'APPROVE', reason: 'in order' })
        .expect(201);

      const res = await officerApi(w.adminA)
        .get(`${appPath(s.applicationId)}/history`)
        .expect(200);
      const summaries = res.body.map((e: { summary: string }) => e.summary);
      expect(summaries).toEqual(
        expect.arrayContaining([
          'Application started',
          'Document uploaded (version 1)',
          'Application submitted',
          'Assigned to an officer',
          'Scrutiny started',
          'Internal observation recorded',
          'Query raised (round 1)',
          'Applicant responded to query (round 1)',
          'Query closed (round 1)',
          'Document verified',
          expect.stringMatching(/^Recommendation recorded \(APPROVE\)/),
        ]),
      );
      const at = res.body.map((e: { at: string }) => new Date(e.at).getTime());
      expect([...at].sort((a, b) => a - b)).toEqual(at);
      const change = res.body.find(
        (e: { summary: string }) =>
          e.summary === 'Status changed: SUBMITTED → UNDER_SCRUTINY',
      );
      expect(change).toMatchObject({
        from: 'SUBMITTED',
        to: 'UNDER_SCRUTINY',
        actorRole: 'SCRUTINY_OFFICER',
      });

      const text = JSON.stringify(res.body);
      for (const forbidden of [
        'SECRET BODY TEXT',
        'ipAddress',
        'password',
        'token',
        'LOGIN',
        'MFA',
        'REFRESH',
      ]) {
        expect(text).not.toContain(forbidden);
      }
      for (const e of res.body) {
        expect(Object.keys(e).sort()).toEqual([
          'action',
          'actorRole',
          'actorUserId',
          'at',
          'from',
          'summary',
          'to',
        ]);
      }
      // The history is of THIS application: another application's events never appear.
      const other = await underScrutiny('story-other');
      const otherHistory = await officerApi(w.soA1)
        .get(`${appPath(other.applicationId)}/history`)
        .expect(200);
      expect(JSON.stringify(otherHistory.body)).not.toContain(s.applicationId);
      expect(otherHistory.body.length).toBeLessThan(res.body.length);
    });

    it('an earlier round’s question and answer stay exactly as they were when the application moves on', async () => {
      const s = await underScrutiny('immutable-story');
      const q = await raiseQuery(s.applicationId, 'Original wording').expect(
        201,
      );
      await respond(s, q.body.id, 'Original answer').expect(200);
      await officerApi(w.soA1)
        .post(`${appPath(s.applicationId)}/queries/${q.body.id}/close`)
        .expect(200);
      await officerApi(w.soA1)
        .post(`${appPath(s.applicationId)}/recommendation`)
        .send({ outcome: 'APPROVE', reason: 'ok' })
        .expect(201);
      const detail = await officerApi(w.adminA)
        .get(appPath(s.applicationId))
        .expect(200);
      expect(detail.body.queries[0]).toMatchObject({
        question: 'Original wording',
        status: 'CLOSED',
        response: { text: 'Original answer' },
      });
    });
  });

  // -------------------------------------------------------------------------
  describe('audit trail', () => {
    it('records every scrutiny action with actor, role, department, enterprise/project, application and rule version', async () => {
      const s = await submitted('audit');
      await assign(s.applicationId).expect(201);
      await start(s.applicationId).expect(200);
      await officerApi(w.soA1)
        .post(`${appPath(s.applicationId)}/observations`)
        .send({ body: 'note' })
        .expect(201);
      const q = await raiseQuery(s.applicationId).expect(201);
      await respond(s, q.body.id).expect(200);
      await officerApi(w.soA1)
        .post(`${appPath(s.applicationId)}/queries/${q.body.id}/close`)
        .expect(200);
      await officerApi(w.soA1)
        .post(`${appPath(s.applicationId)}/recommendation`)
        .send({ outcome: 'REJECT', reason: 'Out of scope.' })
        .expect(201);

      const log = await events(s.applicationId);
      const actions = log.map((e) => e.action);
      for (const expected of [
        'APPLICATION_ASSIGNED',
        'SCRUTINY_STARTED',
        'SCRUTINY_OBSERVATION_RECORDED',
        'QUERY_RAISED',
        'QUERY_RESPONDED',
        'QUERY_CLOSED',
        'SCRUTINY_RECOMMENDATION_RECORDED',
      ]) {
        expect(actions).toContain(expected);
      }
      // Every state change carries a before and an after (FRD 22.2).
      const changes = log.filter(
        (e) => e.action === 'APPLICATION_STATUS_CHANGED',
      );
      expect(
        changes.map((e) => [
          (e.beforeState as { internalState: string }).internalState,
          (e.afterState as { internalState: string }).internalState,
        ]),
      ).toEqual([
        ['DRAFT', 'SUBMITTED'],
        ['SUBMITTED', 'UNDER_SCRUTINY'],
        ['UNDER_SCRUTINY', 'QUERY_RAISED'],
        ['QUERY_RAISED', 'APPLICANT_RESPONDED'],
        ['APPLICANT_RESPONDED', 'UNDER_SCRUTINY'],
        ['UNDER_SCRUTINY', 'RECOMMENDED_FOR_APPROVAL'],
      ]);
      const officerEvents = log.filter((e) =>
        [
          'SCRUTINY_STARTED',
          'QUERY_RAISED',
          'QUERY_CLOSED',
          'SCRUTINY_RECOMMENDATION_RECORDED',
        ].includes(e.action),
      );
      for (const e of officerEvents) {
        expect(e.userId).toBe(w.soA1.user.id);
        expect(e.roleAtTime).toBe('SCRUTINY_OFFICER');
        expect(e.ruleVersionUsed).toMatch(/@v1$/);
        expect(e.afterState).toMatchObject({
          enterpriseId: w.enterpriseId,
          projectId: s.projectId,
          applicationId: s.applicationId,
          departmentId: w.deptA.id,
          actingAs: 'SCRUTINY_OFFICER',
        });
      }
      const assigned = log.find((e) => e.action === 'APPLICATION_ASSIGNED')!;
      expect(assigned).toMatchObject({
        userId: w.adminA.user.id,
        roleAtTime: 'DEPT_ADMIN',
      });
      expect(assigned.afterState).toMatchObject({
        assignedOfficerUserId: w.soA1.user.id,
        departmentId: w.deptA.id,
      });
      const rec = log.find(
        (e) => e.action === 'SCRUTINY_RECOMMENDATION_RECORDED',
      )!;
      expect(rec.afterState).toMatchObject({
        outcome: 'REJECT',
        isRecommendationOnly: true,
      });

      // No secret, token or internal text reaches the trail.
      const text = JSON.stringify(
        log.map((e) => [e.beforeState, e.afterState]),
      );
      expect(text).not.toMatch(/password|accessToken|refreshToken|secret/i);
      const observation = log.find(
        (e) => e.action === 'SCRUTINY_OBSERVATION_RECORDED',
      )!;
      expect(JSON.stringify(observation.afterState)).not.toContain('"note"');
    });

    it('refused actions leave no scrutiny audit trail', async () => {
      const s = await underScrutiny('audit-refused');
      const before = (await events(s.applicationId)).length;
      await officerApi(w.soA2)
        .post(`${appPath(s.applicationId)}/queries`)
        .send({ question: 'not mine' })
        .expect(404);
      await officerApi(w.soB)
        .post(`${appPath(s.applicationId)}/recommendation`)
        .send({ outcome: 'APPROVE', reason: 'x' })
        .expect(404);
      await officerApi(w.adminA)
        .post(`${appPath(s.applicationId)}/observations`)
        .send({ body: 'x' })
        .expect(403);
      await raiseQuery(s.applicationId, '').expect(400);
      expect((await events(s.applicationId)).length).toBe(before);
    });
  });

  // -------------------------------------------------------------------------
  describe('enforced by PostgreSQL itself, not only by service code', () => {
    it('observations, recommendations and reviews are append-only', async () => {
      const s = await underScrutiny('db-append', withDocument('db-append'));
      const obs = await officerApi(w.soA1)
        .post(`${appPath(s.applicationId)}/observations`)
        .send({ body: 'original' })
        .expect(201);
      const [doc] = (
        await officerApi(w.soA1)
          .get(`${appPath(s.applicationId)}/documents`)
          .expect(200)
      ).body;
      await officerApi(w.soA1)
        .post(`${appPath(s.applicationId)}/documents/${doc.id}/review`)
        .send({ verdict: 'VERIFIED' })
        .expect(200);
      await officerApi(w.soA1)
        .post(`${appPath(s.applicationId)}/recommendation`)
        .send({ outcome: 'APPROVE', reason: 'original' })
        .expect(201);

      await expect(
        ctx.prisma.scrutinyObservation.update({
          where: { id: obs.body.id },
          data: { body: 'rewritten' },
        }),
      ).rejects.toThrow(/append-only/);
      const review = await ctx.prisma.documentVerification.findFirstOrThrow({
        where: { documentId: doc.id },
      });
      await expect(
        ctx.prisma.documentVerification.update({
          where: { id: review.id },
          data: { verdict: 'REJECTED' },
        }),
      ).rejects.toThrow(/append-only/);
      const rec = await ctx.prisma.scrutinyRecommendation.findFirstOrThrow({
        where: { applicationId: s.applicationId },
      });
      await expect(
        ctx.prisma.scrutinyRecommendation.update({
          where: { id: rec.id },
          data: { outcome: 'REJECT' },
        }),
      ).rejects.toThrow(/append-only/);
      expect(
        (
          await ctx.prisma.scrutinyObservation.findUniqueOrThrow({
            where: { id: obs.body.id },
          })
        ).body,
      ).toBe('original');
    });

    it('a query’s wording, author and response can never change, and its status only moves forward', async () => {
      const s = await underScrutiny('db-query');
      const q = await raiseQuery(s.applicationId, 'Original wording').expect(
        201,
      );
      const id = q.body.id as string;
      for (const data of [
        { question: 'rewritten' },
        { raisedByUserId: w.soA2.user.id },
        { roundNumber: 9 },
        { createdAt: new Date(0) },
        { applicationId: randomUUID() },
      ]) {
        await expect(
          ctx.prisma.applicationQuery.update({
            where: { id },
            data: data as never,
          }),
        ).rejects.toThrow();
      }
      // Skipping a step, or forging a response in the same write, is refused.
      await expect(
        ctx.prisma.applicationQuery.update({
          where: { id },
          data: { status: 'CLOSED' },
        }),
      ).rejects.toThrow();
      await respond(s, id, 'The real answer').expect(200);
      for (const data of [
        { responseText: 'forged' },
        { respondedAt: new Date(0) },
        { respondedByUserId: w.soA2.user.id },
        { status: 'OPEN' as const },
      ]) {
        await expect(
          ctx.prisma.applicationQuery.update({
            where: { id },
            data: data as never,
          }),
        ).rejects.toThrow();
      }
      await officerApi(w.soA1)
        .post(`${appPath(s.applicationId)}/queries/${id}/close`)
        .expect(200);
      await expect(
        ctx.prisma.applicationQuery.update({
          where: { id },
          data: { closedAt: new Date(0) },
        }),
      ).rejects.toThrow();
      const stored = await ctx.prisma.applicationQuery.findUniqueOrThrow({
        where: { id },
      });
      expect(stored).toMatchObject({
        question: 'Original wording',
        responseText: 'The real answer',
        status: 'CLOSED',
      });
    });

    it('at most one query per application is un-closed, whoever tries', async () => {
      const s = await underScrutiny('db-oneopen');
      await raiseQuery(s.applicationId).expect(201);
      await expect(
        ctx.prisma.applicationQuery.create({
          data: {
            applicationId: s.applicationId,
            departmentId: w.deptA.id,
            roundNumber: 2,
            raisedByUserId: w.soA1.user.id,
            question: 'second open',
          },
        }),
      ).rejects.toThrow(/unclosed|Unique/i);
      await expect(
        ctx.prisma.applicationQuery.create({
          data: {
            applicationId: s.applicationId,
            departmentId: w.deptA.id,
            roundNumber: 1,
            raisedByUserId: w.soA1.user.id,
            question: 'duplicate round',
          },
        }),
      ).rejects.toThrow();
    });

    it('rejects an incoherent query row (a response on an OPEN query, blank wording)', async () => {
      const s = await underScrutiny('db-shape');
      const base = {
        applicationId: s.applicationId,
        departmentId: w.deptA.id,
        roundNumber: 1,
        raisedByUserId: w.soA1.user.id,
      };
      await expect(
        ctx.prisma.applicationQuery.create({
          data: {
            ...base,
            question: 'q',
            responseText: 'answer on an open query',
          },
        }),
      ).rejects.toThrow(/state_shape/);
      await expect(
        ctx.prisma.applicationQuery.create({
          data: { ...base, question: '   ' },
        }),
      ).rejects.toThrow(/question_check/);
    });
  });
});
