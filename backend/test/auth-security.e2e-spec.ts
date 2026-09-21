import request from 'supertest';
import { AuditService } from '../src/infrastructure/audit/audit.service';
import {
  API,
  E2eContext,
  PASSWORD,
  captureOutput,
  cookieValue,
  createE2eContext,
  extractSecret,
  freshTotp,
  wrongTotp,
} from './support/e2e-helpers';

jest.setTimeout(240_000);

describe('Auth e2e — audit trail, secret hygiene, CORS, Swagger, health', () => {
  let ctx: E2eContext;

  beforeAll(async () => {
    ctx = await createE2eContext({ verboseLogs: true });
  });

  afterAll(async () => {
    await ctx.cleanup();
    await ctx.app.close();
  });

  describe('audit_logs', () => {
    it('records every authentication lifecycle event with the right actor, entity and no secrets', async () => {
      const officer = await ctx.registerWithRole(
        'audit-life',
        'SCRUTINY_OFFICER',
      );

      // Failed password, then MFA setup -> enable.
      await ctx
        .login({ email: officer.email, password: 'Wr0ngPasswordEntirely' })
        .expect(401);
      const setup = await ctx.login(officer).expect(200);
      const enroll = await request(ctx.http)
        .post(`${API}/auth/mfa/enroll`)
        .set('Authorization', `Bearer ${setup.body.challengeToken}`)
        .expect(201);
      const secret = extractSecret(enroll.body.provisioningUri);
      await request(ctx.http)
        .post(`${API}/auth/mfa/confirm`)
        .set('Authorization', `Bearer ${setup.body.challengeToken}`)
        .send({ code: wrongTotp(secret) })
        .expect(400);
      await request(ctx.http)
        .post(`${API}/auth/mfa/confirm`)
        .set('Authorization', `Bearer ${setup.body.challengeToken}`)
        .send({ code: await freshTotp(secret) })
        .expect(200);

      // MFA login: one failure, one success.
      const challenge = await ctx.login(officer).expect(200);
      await request(ctx.http)
        .post(`${API}/auth/mfa/verify`)
        .send({
          challengeToken: challenge.body.challengeToken,
          code: wrongTotp(secret),
        })
        .expect(401);
      const verified = await request(ctx.http)
        .post(`${API}/auth/mfa/verify`)
        .send({
          challengeToken: challenge.body.challengeToken,
          code: await freshTotp(secret),
        })
        .expect(200);

      // Rotation, reuse detection, logout.
      const first = cookieValue(verified, ctx.cookieName)!;
      const rotated = await ctx.refresh(first).expect(200);
      const second = cookieValue(rotated, ctx.cookieName)!;
      await ctx.refresh(first).expect(401); // reuse
      const relogin = await ctx.mfaLogin(officer, secret);
      await ctx.logout(relogin.refreshCookieValue).expect(200);

      const rows = await ctx.prisma.auditLog.findMany({
        where: { userId: officer.id },
        orderBy: { createdAt: 'asc' },
      });
      const actions = rows.map((r) => r.action);
      for (const expected of [
        'USER_REGISTERED',
        'LOGIN_FAILURE',
        'MFA_ENROLLED',
        'MFA_VERIFY_FAILURE',
        'MFA_ENABLED',
        'MFA_LOGIN_SUCCESS',
        'REFRESH_TOKEN_ROTATED',
        'REFRESH_TOKEN_REUSE_DETECTED',
        'LOGOUT',
      ]) {
        expect(actions).toContain(expected);
      }
      // Both the wrong confirm code and the wrong login code were audited.
      expect(actions.filter((a) => a === 'MFA_VERIFY_FAILURE')).toHaveLength(2);

      const assigned = await ctx.prisma.auditLog.findMany({
        where: {
          action: 'ROLE_ASSIGNED',
          afterState: { path: ['userId'], equals: officer.id },
        },
      });
      expect(assigned).toHaveLength(1);

      // Every row is well-formed and carries a real client address.
      for (const row of rows) {
        expect(row.entityId).toMatch(/^[0-9a-f-]{36}$/);
        expect(row.ipAddress).not.toBe('');
        expect(row.ipAddress).not.toBe('internal');
      }

      // No secret material anywhere in any audit row for this user.
      const blob = JSON.stringify([...rows, ...assigned]);
      for (const secretish of [
        PASSWORD,
        secret,
        first,
        second,
        relogin.refreshCookieValue,
        relogin.accessToken,
        'otpauth',
        'passwordHash',
        '$argon2',
      ]) {
        expect(blob).not.toContain(secretish);
      }
    });

    it('audits a successful password login for a non-MFA account', async () => {
      const { user } = await ctx.applicantSession('audit-plain');
      const actions = (
        await ctx.prisma.auditLog.findMany({ where: { userId: user.id } })
      ).map((a) => a.action);
      expect(actions).toEqual(
        expect.arrayContaining(['USER_REGISTERED', 'LOGIN_SUCCESS']),
      );
    });

    it('does not audit (or reveal) attempts against nonexistent accounts', async () => {
      // Spied rather than counted: other e2e suites run in parallel against
      // the same audit_logs table, so a table-wide row count is racy. The
      // app runs in this process, and this suite's tests run sequentially,
      // so the spy sees exactly the audit writes this one request causes.
      const record = jest.spyOn(ctx.app.get(AuditService), 'record');
      try {
        const res = await ctx
          .login({
            email: `ghost-${ctx.runId}@example.test`,
            password: 'Wr0ngPasswordEntirely',
          })
          .expect(401);
        expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
        expect(record).not.toHaveBeenCalled();
      } finally {
        record.mockRestore();
      }
    });
  });

  describe('log hygiene', () => {
    it('never writes passwords, TOTP secrets, tokens or hashes to stdout/stderr through a full lifecycle, including failures', async () => {
      const capture = captureOutput();
      let secret = '';
      let tokens: string[] = [];
      let password = PASSWORD;
      try {
        const officer = await ctx.registerWithRole('logs', 'SCRUTINY_OFFICER');
        password = officer.password;
        await ctx
          .login({ email: officer.email, password: 'Wr0ngPasswordEntirely' })
          .expect(401);
        const setup = await ctx.login(officer).expect(200);
        secret = await ctx.enrollAndConfirm(setup.body.challengeToken);
        const session = await ctx.mfaLogin(officer, secret);
        const rotated = await ctx
          .refresh(session.refreshCookieValue)
          .expect(200);
        await ctx.refresh(session.refreshCookieValue).expect(401);
        await request(ctx.http)
          .post(`${API}/auth/register`)
          .send({ name: 'Bad', email: 'nope', mobile: '1', password: 'x' })
          .expect(400);
        tokens = [
          setup.body.challengeToken,
          session.accessToken,
          session.refreshCookieValue,
          rotated.body.accessToken,
          cookieValue(rotated, ctx.cookieName)!,
        ];
      } finally {
        const output = capture.stop();
        expect(output.length).toBeGreaterThan(0); // the logger really was captured
        for (const sensitive of [
          password,
          secret,
          ...tokens,
          '$argon2',
          'passwordHash',
        ]) {
          expect(sensitive).toBeTruthy();
          expect(output).not.toContain(sensitive);
        }
      }
    });
  });

  describe('error hygiene', () => {
    it('error responses never contain stack traces, SQL, file paths or secrets', async () => {
      const bodies = [
        await request(ctx.http).get(`${API}/auth/me`).expect(401),
        await request(ctx.http)
          .post(`${API}/auth/register`)
          .send({})
          .expect(400),
        await request(ctx.http).get(`${API}/nope`).expect(404),
        await ctx
          .login({ email: 'x@example.test', password: 'Wr0ngPasswordEntirely' })
          .expect(401),
        await request(ctx.http)
          .post(`${API}/auth/login`)
          .set('Content-Type', 'application/json')
          .send('{"broken":')
          .expect(400),
      ];
      for (const res of bodies) {
        expect(Object.keys(res.body)).toEqual(['error']);
        const text = res.text;
        expect(text).not.toMatch(/\bat\s+\S+\s+\(.*:\d+:\d+\)/); // stack frame
        expect(text.toLowerCase()).not.toMatch(
          /prisma|select |insert |postgres|node_modules|stack/,
        );
        expect(text).not.toContain(ctx.accessSecret);
        expect(text).not.toContain(ctx.refreshSecret);
        expect(text).not.toMatch(/[A-Z]:\\|\/home\//);
      }
    });

    it('security headers are present (helmet) and the server does not advertise its framework', async () => {
      const res = await request(ctx.http).get(`${API}/health`).expect(200);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['x-powered-by']).toBeUndefined();
      expect(res.headers['strict-transport-security']).toBeDefined();
    });
  });

  describe('CORS', () => {
    const frontendUrl = () => ctx.config.getOrThrow<string>('frontendUrl');

    it('allows credentialed requests only from the configured frontend origin — never a wildcard', async () => {
      const res = await request(ctx.http)
        .options(`${API}/auth/login`)
        .set('Origin', frontendUrl())
        .set('Access-Control-Request-Method', 'POST')
        .expect(204);
      expect(res.headers['access-control-allow-origin']).toBe(frontendUrl());
      expect(res.headers['access-control-allow-origin']).not.toBe('*');
      expect(res.headers['access-control-allow-credentials']).toBe('true');
    });

    it('does not grant CORS access to any other origin', async () => {
      const res = await request(ctx.http)
        .options(`${API}/auth/login`)
        .set('Origin', 'https://evil.example')
        .set('Access-Control-Request-Method', 'POST');
      expect(res.headers['access-control-allow-origin']).not.toBe(
        'https://evil.example',
      );
      expect(res.headers['access-control-allow-origin']).not.toBe('*');

      const actual = await request(ctx.http)
        .get(`${API}/health`)
        .set('Origin', 'https://evil.example')
        .expect(200);
      expect(actual.headers['access-control-allow-origin']).not.toBe(
        'https://evil.example',
      );
      expect(actual.headers['access-control-allow-origin']).not.toBe('*');
    });
  });

  describe('Swagger (/api/docs, /api/docs-json)', () => {
    it('serves the UI and documents exactly the real authentication, enterprise, project, discovery, application, document, officer and health endpoints', async () => {
      await request(ctx.http).get('/api/docs').expect(200);
      const res = await request(ctx.http).get('/api/docs-json').expect(200);
      const paths = Object.keys(res.body.paths).sort();

      expect(paths).toEqual(
        [
          `${API}/auth/register`,
          `${API}/auth/login`,
          `${API}/auth/mfa/verify`,
          `${API}/auth/refresh`,
          `${API}/auth/logout`,
          `${API}/auth/me`,
          `${API}/auth/mfa/enroll`,
          `${API}/auth/mfa/confirm`,
          // Step 5 — enterprise management + representative authorisation.
          `${API}/enterprises`,
          `${API}/enterprises/{enterpriseId}`,
          `${API}/enterprises/{enterpriseId}/representatives`,
          `${API}/enterprises/{enterpriseId}/representatives/{representativeId}`,
          `${API}/representative-authorisations`,
          `${API}/representative-authorisations/{authorisationId}/accept`,
          // Step 6 — project management.
          `${API}/enterprises/{enterpriseId}/projects`,
          `${API}/enterprises/{enterpriseId}/projects/{projectId}`,
          // Step 7 — approval discovery.
          `${API}/enterprises/{enterpriseId}/projects/{projectId}/discover-approvals`,
          `${API}/enterprises/{enterpriseId}/projects/{projectId}/discoveries`,
          `${API}/enterprises/{enterpriseId}/projects/{projectId}/discoveries/{snapshotId}`,
          // Step 8 — application lifecycle (no route writes a status).
          `${API}/enterprises/{enterpriseId}/applications`,
          `${API}/enterprises/{enterpriseId}/projects/{projectId}/applications`,
          `${API}/enterprises/{enterpriseId}/projects/{projectId}/applications/{applicationId}`,
          `${API}/enterprises/{enterpriseId}/projects/{projectId}/applications/{applicationId}/status`,
          `${API}/enterprises/{enterpriseId}/projects/{projectId}/applications/{applicationId}/draft`,
          `${API}/enterprises/{enterpriseId}/projects/{projectId}/applications/{applicationId}/pre-validate`,
          `${API}/enterprises/{enterpriseId}/projects/{projectId}/applications/{applicationId}/submit`,
          // Step 9 — document management (no delete, no status / scan writes).
          `${API}/enterprises/{enterpriseId}/projects/{projectId}/applications/{applicationId}/documents`,
          `${API}/enterprises/{enterpriseId}/projects/{projectId}/applications/{applicationId}/documents/{documentId}`,
          `${API}/enterprises/{enterpriseId}/projects/{projectId}/applications/{applicationId}/documents/{documentId}/download`,
          `${API}/enterprises/{enterpriseId}/projects/{projectId}/applications/{applicationId}/documents/{documentId}/replace`,
          `${API}/enterprises/{enterpriseId}/projects/{projectId}/applications/{applicationId}/documents/{documentId}/versions`,
          `${API}/enterprises/{enterpriseId}/projects/{projectId}/applications/{applicationId}/document-requirements`,
          `${API}/enterprises/{enterpriseId}/projects/{projectId}/applications/{applicationId}/decision`,
          `${API}/enterprises/{enterpriseId}/projects/{projectId}/applications/{applicationId}/certificate/download`,
          // Step 10 — applicant side of the query loop (no route edits a question).
          `${API}/enterprises/{enterpriseId}/projects/{projectId}/applications/{applicationId}/queries`,
          `${API}/enterprises/{enterpriseId}/projects/{projectId}/applications/{applicationId}/queries/{queryId}/respond`,
          // Step 10 — officer workspace + scrutiny (no route takes or writes a status; the statutory acts follow, Step 15).
          `${API}/officer/dashboard`,
          `${API}/officer/officers`,
          `${API}/officer/applications`,
          `${API}/officer/applications/{applicationId}`,
          `${API}/officer/applications/{applicationId}/assignment`,
          `${API}/officer/applications/{applicationId}/decision`,
          `${API}/officer/applications/{applicationId}/certificate`,
          `${API}/officer/applications/{applicationId}/certificate/download`,
          `${API}/officer/applications/{applicationId}/discovery`,
          `${API}/officer/applications/{applicationId}/documents`,
          `${API}/officer/applications/{applicationId}/documents/{documentId}`,
          `${API}/officer/applications/{applicationId}/documents/{documentId}/download`,
          `${API}/officer/applications/{applicationId}/documents/{documentId}/review`,
          `${API}/officer/applications/{applicationId}/documents/{documentId}/versions`,
          `${API}/officer/applications/{applicationId}/history`,
          `${API}/officer/applications/{applicationId}/observations`,
          `${API}/officer/applications/{applicationId}/queries`,
          `${API}/officer/applications/{applicationId}/queries/{queryId}/close`,
          `${API}/officer/applications/{applicationId}/recommendation`,
          `${API}/officer/applications/{applicationId}/start-scrutiny`,
          // Step 11A — inspection foundation (no status route; no completion).
          `${API}/officer/applications/{applicationId}/inspections`,
          `${API}/officer/applications/{applicationId}/inspections/{inspectionId}`,
          `${API}/inspections`,
          `${API}/inspections/{inspectionId}`,
          // Step 11B — inspection execution (the inspector's actions; no status route).
          `${API}/inspections/{inspectionId}/confirm`,
          `${API}/inspections/{inspectionId}/reschedule`,
          `${API}/inspections/{inspectionId}/results`,
          `${API}/inspections/{inspectionId}/evidence`,
          `${API}/inspections/{inspectionId}/evidence/{evidenceId}/download`,
          `${API}/inspections/{inspectionId}/report`,
          // Step 11C — the applicant's read-only view of their inspections.
          `${API}/enterprises/{enterpriseId}/projects/{projectId}/applications/{applicationId}/inspections`,
          `${API}/enterprises/{enterpriseId}/projects/{projectId}/applications/{applicationId}/inspections/{inspectionId}`,
          // Step 12 — SLA management (read-only views; a stage's duration and the
          // holiday calendar are configuration; no route sets, moves or clears a deadline).
          `${API}/enterprises/{enterpriseId}/projects/{projectId}/applications/{applicationId}/sla`,
          `${API}/officer/sla`,
          `${API}/officer/applications/{applicationId}/sla`,
          `${API}/admin/sla/stages`,
          `${API}/admin/sla/stages/{workflowStageId}`,
          `${API}/admin/sla/holidays`,
          `${API}/admin/sla/holidays/{holidayId}`,
          // Step 14 — compliance management (obligations are a department's
          // configuration; the only applicant action is fulfilling one; no status route).
          `${API}/enterprises/{enterpriseId}/compliance`,
          `${API}/enterprises/{enterpriseId}/projects/{projectId}/applications/{applicationId}/compliance`,
          `${API}/enterprises/{enterpriseId}/projects/{projectId}/applications/{applicationId}/compliance/{recordId}`,
          `${API}/enterprises/{enterpriseId}/projects/{projectId}/applications/{applicationId}/compliance/{recordId}/fulfil`,
          `${API}/enterprises/{enterpriseId}/projects/{projectId}/applications/{applicationId}/compliance/{recordId}/evidence`,
          `${API}/officer/compliance`,
          `${API}/officer/applications/{applicationId}/compliance`,
          `${API}/officer/applications/{applicationId}/compliance/{recordId}/evidence`,
          `${API}/admin/compliance/requirements`,
          `${API}/admin/compliance/requirements/{requirementId}`,
          // Step 13 — the in-app notification centre (own notifications only; no
          // route creates, edits or deletes one).
          `${API}/notifications`,
          `${API}/notifications/unread-count`,
          `${API}/notifications/{id}`,
          `${API}/notifications/{id}/read`,
          `${API}/health`,
          `${API}/health/db`,
        ].sort(),
      );
      expect(paths.some((p) => p.includes('test-authz'))).toBe(false);
    });

    it('documents no way to write an application status, and hides the internal state and workflow', async () => {
      const { body } = await request(ctx.http)
        .get('/api/docs-json')
        .expect(200);
      const statusPath = `${API}/enterprises/{enterpriseId}/projects/{projectId}/applications/{applicationId}/status`;
      expect(Object.keys(body.paths[statusPath])).toEqual(['get']);
      const applicationPath = `${API}/enterprises/{enterpriseId}/projects/{projectId}/applications/{applicationId}`;
      expect(Object.keys(body.paths[applicationPath])).toEqual(['get']);

      const schemas = body.components.schemas as Record<
        string,
        { properties?: Record<string, unknown> }
      >;
      for (const name of ['ApplicationResponseDto', 'ApplicationStatusDto']) {
        const props = Object.keys(schemas[name].properties ?? {});
        expect(props).toContain('applicantStatus');
        expect(props).not.toContain('internalState');
        expect(props).not.toContain('workflowId');
      }
      // Request bodies carry ONLY what the caller may decide — no status,
      // state, enterprise, owner or project field.
      const requestProps = (name: string) =>
        Object.keys(schemas[name].properties ?? {}).sort();
      expect(requestProps('CreateApplicationDto')).toEqual([
        'approvalTypeId',
        'discoverySnapshotId',
        'formData',
      ]);
      expect(requestProps('UpdateApplicationDraftDto')).toEqual(['formData']);
      expect(requestProps('SubmitApplicationDto')).toEqual([
        'declarationAccepted',
      ]);
    });

    it('documents no way to delete a document or write its status / scan state, and exposes no storage internals', async () => {
      const { body } = await request(ctx.http)
        .get('/api/docs-json')
        .expect(200);
      const base = `${API}/enterprises/{enterpriseId}/projects/{projectId}/applications/{applicationId}`;
      const methods = (path: string) => Object.keys(body.paths[path]).sort();
      expect(methods(`${base}/documents`)).toEqual(['get', 'post']);
      expect(methods(`${base}/documents/{documentId}`)).toEqual(['get']);
      expect(methods(`${base}/documents/{documentId}/download`)).toEqual([
        'get',
      ]);
      expect(methods(`${base}/documents/{documentId}/versions`)).toEqual([
        'get',
      ]);
      expect(methods(`${base}/documents/{documentId}/replace`)).toEqual([
        'post',
      ]);
      expect(methods(`${base}/document-requirements`)).toEqual(['get']);

      // Uploads are multipart, and say so.
      for (const path of [
        `${base}/documents`,
        `${base}/documents/{documentId}/replace`,
      ]) {
        expect(Object.keys(body.paths[path].post.requestBody.content)).toEqual([
          'multipart/form-data',
        ]);
      }

      const schemas = body.components.schemas as Record<
        string,
        { properties?: Record<string, unknown> }
      >;
      const props = (name: string) =>
        Object.keys(schemas[name].properties ?? {}).sort();

      // Nothing about where or how a file is stored, its hash, or scan internals.
      const forbidden =
        /filepath|storage|checksum|hash|lineage_?internal|ownertype|ownerid|scanstatus|token|secret|password/i;
      for (const name of [
        'DocumentResponseDto',
        'DocumentRequirementStatusDto',
      ]) {
        expect(schemas[name]).toBeDefined();
        for (const prop of props(name)) {
          expect(prop).not.toMatch(forbidden);
        }
      }

      // Request bodies carry ONLY what the caller may decide.
      expect(props('UploadDocumentBodyDoc')).toEqual([
        'documentRequirementId',
        'expiryDate',
        'file',
      ]);
      expect(props('ReplaceDocumentBodyDoc')).toEqual(['expiryDate', 'file']);
    });

    const DECISION_PATHS = [
      `${API}/officer/applications/{applicationId}/decision`,
      `${API}/officer/applications/{applicationId}/certificate`,
      `${API}/officer/applications/{applicationId}/certificate/download`,
    ];

    it('documents no officer route that writes a status, decides, edits or deletes, and no officer request field for state or department', async () => {
      const { body } = await request(ctx.http)
        .get('/api/docs-json')
        .expect(200);
      // Every officer path is GET / POST / PUT only (PUT: reassignment).
      const officerPaths = Object.keys(body.paths).filter((p) =>
        p.startsWith(`${API}/officer`),
      );
      expect(officerPaths.length).toBeGreaterThan(0);
      for (const path of officerPaths) {
        for (const method of Object.keys(body.paths[path])) {
          expect(['get', 'post', 'put']).toContain(method);
        }
        // The Approving Authority's statutory acts (Step 15) are the ONLY
        // officer routes that name a decision or a certificate: each a named
        // action, none taking a status.
        if (DECISION_PATHS.includes(path)) {
          continue;
        }
        expect(path).not.toMatch(/status|approve|reject|decision|certificate/i);
      }
      expect(
        officerPaths.filter((p) => DECISION_PATHS.includes(p)).sort(),
      ).toEqual([...DECISION_PATHS].sort());
      for (const path of DECISION_PATHS) {
        expect(Object.keys(body.paths[path]).sort()).toEqual(
          path.endsWith('/download') ? ['get'] : ['post'],
        );
      }
      // The only PUTs: reassigning an application's officer, and changing an
      // open inspection's inspector / schedule / site (Step 11A).
      expect(
        officerPaths.filter((p) => body.paths[p].put !== undefined).sort(),
      ).toEqual(
        [
          `${API}/officer/applications/{applicationId}/assignment`,
          `${API}/officer/applications/{applicationId}/inspections/{inspectionId}`,
        ].sort(),
      );

      const schemas = body.components.schemas as Record<
        string,
        { properties?: Record<string, unknown> }
      >;
      const props = (name: string) =>
        Object.keys(schemas[name].properties ?? {}).sort();
      // Request bodies name only what the officer decides: never a state, a
      // status, a department, an enterprise or an actor.
      expect(props('AssignOfficerDto')).toEqual(['officerUserId']);
      expect(props('ReassignOfficerDto')).toEqual(['officerUserId', 'reason']);
      expect(props('RecordObservationDto')).toEqual([
        'body',
        'relatedDocumentId',
        'relatedField',
      ]);
      expect(props('RaiseQueryDto')).toEqual([
        'question',
        'sourceObservationId',
      ]);
      expect(props('RecommendDto')).toEqual(['outcome', 'reason']);
      // The decision names only the outcome and the reason (Step 15).
      expect(props('DecideDto')).toEqual(['outcome', 'reason']);
      expect(props('IssueCertificateBodyDoc')).toEqual([
        'certificateNumber',
        'file',
      ]);
      expect(props('RespondToQueryDto')).toEqual(['responseText']);
      expect(props('ReviewDocumentDto')).toEqual([
        'notes',
        'validUntil',
        'verdict',
      ]);
      const forbiddenRequest =
        /status|state|department|enterprise|actor|role|userid$|token|password|secret|storage|path/i;
      for (const name of [
        'RecordObservationDto',
        'RaiseQueryDto',
        'RecommendDto',
        'DecideDto',
        'RespondToQueryDto',
        'ReviewDocumentDto',
      ]) {
        for (const prop of props(name)) {
          expect(prop).not.toMatch(forbiddenRequest);
        }
      }
      // The officer workspace's responses expose no storage internals,
      // security data or secrets.
      const forbiddenResponse =
        /filepath|storage|checksum|hash|scanstatus|token|secret|password|mfa|refresh/i;
      for (const name of Object.keys(schemas)) {
        if (
          /^(Officer|Observation|Recommendation|AssignmentHistory|AssignmentResult|Assignee|HistoryEntry|ApplicantQuery)/.test(
            name,
          )
        ) {
          for (const prop of props(name)) {
            expect(prop).not.toMatch(forbiddenResponse);
          }
        }
      }
    });

    it('documents no way to write an inspection status, complete or delete one, and exposes no internal column', async () => {
      const { body } = await request(ctx.http)
        .get('/api/docs-json')
        .expect(200);
      const methods = (path: string) => Object.keys(body.paths[path]).sort();
      const forApplication = `${API}/officer/applications/{applicationId}/inspections`;
      expect(methods(forApplication)).toEqual(['get', 'post']);
      expect(methods(`${forApplication}/{inspectionId}`)).toEqual(['put']);
      expect(methods(`${API}/inspections`)).toEqual(['get']);
      expect(methods(`${API}/inspections/{inspectionId}`)).toEqual(['get']);
      for (const path of Object.keys(body.paths).filter((p) =>
        p.includes('/inspections'),
      )) {
        // (`/report` is the inspector's report submission, a real Step 11B route.)
        expect(path).not.toMatch(
          /status|complete|cancel|approve|reject|decision/i,
        );
      }

      const schemas = body.components.schemas as Record<
        string,
        { properties?: Record<string, unknown> }
      >;
      const props = (name: string) =>
        Object.keys(schemas[name].properties ?? {}).sort();
      // Request bodies name only what the scrutiny officer decides.
      expect(props('CreateInspectionDto')).toEqual([
        'inspectorUserId',
        'scheduledAt',
        'siteAddress',
      ]);
      expect(props('UpdateInspectionDto')).toEqual([
        'inspectorUserId',
        'reason',
        'scheduledAt',
        'siteAddress',
      ]);
      // The response carries no internal column, consent flag or stage.
      const forbidden =
        /geoconsent|applicationstage|createdbyuserid|password|token|secret|storage|filepath|hash/i;
      for (const name of ['InspectionDto', 'InspectionListDto']) {
        expect(schemas[name]).toBeDefined();
        for (const prop of props(name)) {
          expect(prop).not.toMatch(forbidden);
        }
      }
    });

    it('documents the applicant inspection view as read-only, with no inspector, evidence or internal column', async () => {
      const { body } = await request(ctx.http)
        .get('/api/docs-json')
        .expect(200);
      const base = `${API}/enterprises/{enterpriseId}/projects/{projectId}/applications/{applicationId}/inspections`;
      const methods = (path: string) => Object.keys(body.paths[path]).sort();
      expect(methods(base)).toEqual(['get']);
      expect(methods(`${base}/{inspectionId}`)).toEqual(['get']);

      const schemas = body.components.schemas as Record<
        string,
        { properties?: Record<string, unknown> }
      >;
      const props = (name: string) =>
        Object.keys(schemas[name].properties ?? {}).sort();
      expect(props('ApplicantInspectionDto')).toEqual([
        'createdAt',
        'id',
        'outcome',
        'scheduleConfirmedAt',
        'scheduledAt',
        'siteAddress',
        'status',
        'updatedAt',
      ]);
      expect(props('ApplicantInspectionOutcomeDto')).toEqual([
        'correctiveAction',
        'overallFinding',
        'recordedAt',
      ]);
      expect(props('ApplicantInspectionsDto')).toEqual([
        'applicationId',
        'inspectionRequired',
        'inspections',
      ]);
    });

    it('documents the inspector actions with no status write, no delete, and no request field for identity, status, location or storage', async () => {
      const { body } = await request(ctx.http)
        .get('/api/docs-json')
        .expect(200);
      const base = `${API}/inspections/{inspectionId}`;
      const methods = (path: string) => Object.keys(body.paths[path]).sort();
      expect(methods(`${base}/confirm`)).toEqual(['post']);
      expect(methods(`${base}/reschedule`)).toEqual(['post']);
      expect(methods(`${base}/results`)).toEqual(['post']);
      expect(methods(`${base}/evidence`)).toEqual(['post']);
      expect(methods(`${base}/evidence/{evidenceId}/download`)).toEqual([
        'get',
      ]);
      expect(methods(`${base}/report`)).toEqual(['get', 'post']);
      // No inspection route can be PATCHed or DELETEd, ever.
      for (const path of Object.keys(body.paths).filter((p) =>
        p.includes('/inspections'),
      )) {
        expect(Object.keys(body.paths[path])).not.toContain('patch');
        expect(Object.keys(body.paths[path])).not.toContain('delete');
      }
      // Evidence is multipart, like every other upload.
      expect(
        Object.keys(body.paths[`${base}/evidence`].post.requestBody.content),
      ).toEqual(['multipart/form-data']);

      const schemas = body.components.schemas as Record<
        string,
        { properties?: Record<string, unknown> }
      >;
      const props = (name: string) =>
        Object.keys(schemas[name].properties ?? {}).sort();
      expect(props('RescheduleInspectionDto')).toEqual([
        'reason',
        'scheduledAt',
      ]);
      expect(props('RecordResultDto')).toEqual([
        'checklistItemId',
        'evidenceId',
        'finding',
        'notes',
        'response',
      ]);
      expect(props('AttachEvidenceBodyDoc')).toEqual([
        'caption',
        'capturedAt',
        'file',
      ]);
      expect(props('SubmitReportDto')).toEqual([
        'correctiveAction',
        'overallFinding',
        'summary',
      ]);
      // Nothing that identifies who, what state, where, or how it is stored.
      const forbiddenRequest =
        /status|state|completed|outcome|inspectionid|applicationid|departmentid|userid|recordedby|submittedby|latitude|longitude|location|geo|storage|path|hash|checksum|scan/i;
      for (const name of [
        'RescheduleInspectionDto',
        'RecordResultDto',
        'AttachEvidenceBodyDoc',
        'SubmitReportDto',
      ]) {
        for (const prop of props(name)) {
          expect(prop).not.toMatch(forbiddenRequest);
        }
      }
      // Responses expose no storage internals, and no location.
      const forbiddenResponse =
        /filepath|storage|checksum|hash|geo|latitude|longitude|location|token|secret|password/i;
      for (const name of [
        'ResultDto',
        'EvidenceDto',
        'ChecklistItemViewDto',
        'ReportDto',
        'InspectionReportViewDto',
        'SubmitReportResultDto',
      ]) {
        expect(schemas[name]).toBeDefined();
        for (const prop of props(name)) {
          expect(prop).not.toMatch(forbiddenResponse);
        }
      }
    });

    it('response schemas expose no password hashes, refresh tokens, secrets or internal columns', async () => {
      const { body } = await request(ctx.http)
        .get('/api/docs-json')
        .expect(200);
      const schemas = body.components.schemas as Record<
        string,
        { properties?: Record<string, unknown> }
      >;
      const forbidden =
        /hash|refresh|totpsecret|secret|failedlogin|lockedun|isactive|token_hash|familyid/i;

      const responseSchemas = [
        'AuthenticatedUserDto',
        'LoginResponseDto',
        'RegisterResponseDto',
        'MfaEnrollResponseDto',
        'SimpleSuccessResponseDto',
      ];
      for (const name of responseSchemas) {
        expect(schemas[name]).toBeDefined();
        for (const prop of Object.keys(schemas[name].properties ?? {})) {
          expect(prop).not.toMatch(forbidden);
        }
      }
      // The only "password" the API accepts is the write-only input on
      // register/login — it must never appear in a response schema.
      for (const name of responseSchemas) {
        expect(Object.keys(schemas[name].properties ?? {})).not.toContain(
          'password',
        );
      }
      // Login/MFA request schemas never accept a refresh token or secret.
      for (const name of [
        'LoginDto',
        'RegisterDto',
        'MfaVerifyDto',
        'MfaConfirmDto',
      ]) {
        for (const prop of Object.keys(schemas[name].properties ?? {})) {
          expect(prop).not.toMatch(/refresh|hash|secret/i);
        }
      }
    });

    it('marks protected endpoints as bearer-authenticated and leaves register/login/refresh/logout open', async () => {
      const { body } = await request(ctx.http)
        .get('/api/docs-json')
        .expect(200);
      for (const path of ['me', 'mfa/enroll', 'mfa/confirm']) {
        const op = Object.values(body.paths[`${API}/auth/${path}`])[0] as {
          security?: unknown[];
        };
        expect(op.security).toBeDefined();
      }
    });
  });

  describe('health (public, backed by the Docker PostgreSQL)', () => {
    it('GET /health is reachable without credentials', async () => {
      const res = await request(ctx.http).get(`${API}/health`).expect(200);
      expect(res.body.status).toBe('ok');
    });

    it('GET /health/db reports the database as up, without leaking connection details', async () => {
      const res = await request(ctx.http).get(`${API}/health/db`).expect(200);
      expect(res.body.status).toBe('up');
      expect(typeof res.body.latencyMs).toBe('number');
      expect(res.text).not.toMatch(/postgres|mahaudyam|5433|password/i);
    });
  });
});
