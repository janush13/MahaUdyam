import { createHash, randomInt, randomUUID } from 'node:crypto';
import { ConsoleLogger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { authenticator } from 'otplib';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp, setupSwagger } from '../../src/app.setup';
import { PrismaService } from '../../src/infrastructure/prisma/prisma.service';
import {
  STORAGE_SERVICE,
  StorageService,
} from '../../src/infrastructure/storage/storage.interface';
import { ApprovalRulesService } from '../../src/modules/discovery/approval-rules.service';
import { UsersService } from '../../src/modules/users/users.service';
import { AuthzTestModule } from './authz-test.module';

export const PASSWORD = 'E2eStr0ngPassw0rd';
export const API = '/api/v1';

export interface TestUser {
  id: string;
  email: string;
  mobile: string;
  password: string;
}

export interface Session {
  accessToken: string;
  refreshCookieValue: string;
}

export class E2eContext {
  readonly runId = `${Date.now().toString(36)}${randomInt(1000, 9999)}`;
  readonly userIds: string[] = [];
  readonly departmentIds: string[] = [];
  readonly enterpriseIds: string[] = [];
  readonly projectIds: string[] = [];
  readonly approvalTypeIds: string[] = [];
  private counter = 0;

  constructor(
    readonly app: NestExpressApplication,
    readonly prisma: PrismaService,
    readonly users: UsersService,
    readonly config: ConfigService,
  ) {}

  get http() {
    return this.app.getHttpServer();
  }

  get cookieName(): string {
    return this.config.getOrThrow<string>('authSecurity.refreshCookieName');
  }

  get accessSecret(): string {
    return this.config.getOrThrow<string>('jwt.accessSecret');
  }

  get refreshSecret(): string {
    return this.config.getOrThrow<string>('jwt.refreshSecret');
  }

  get maxFailedAttempts(): number {
    return this.config.getOrThrow<number>(
      'authSecurity.maxFailedLoginAttempts',
    );
  }

  /** Every identifier is unique to this run, so tests never collide with
   * each other or with pre-existing development data. */
  newIdentity(tag: string): Omit<TestUser, 'id'> {
    this.counter += 1;
    return {
      email: `e2e-${this.runId}-${tag}-${this.counter}@example.test`,
      mobile: `9${String(randomInt(0, 1_000_000_000)).padStart(9, '0')}`,
      password: PASSWORD,
    };
  }

  async register(tag: string): Promise<TestUser> {
    const identity = this.newIdentity(tag);
    const res = await request(this.http)
      .post(`${API}/auth/register`)
      .send({ name: `E2E ${tag}`, ...identity })
      .expect(201);
    this.userIds.push(res.body.id);
    return { id: res.body.id, ...identity };
  }

  async registerWithRole(
    tag: string,
    roleCode: string,
    departmentId?: string,
  ): Promise<TestUser> {
    const user = await this.register(tag);
    await this.users.assignRole({
      userId: user.id,
      roleCode,
      departmentId: departmentId ?? null,
      assignedByUserId: null,
      ipAddress: '127.0.0.1',
    });
    return user;
  }

  login(user: Pick<TestUser, 'email' | 'password'>) {
    return request(this.http)
      .post(`${API}/auth/login`)
      .send({ emailOrMobile: user.email, password: user.password });
  }

  async applicantSession(tag: string): Promise<{ user: TestUser } & Session> {
    const user = await this.register(tag);
    const res = await this.login(user).expect(200);
    return {
      user,
      accessToken: res.body.accessToken,
      refreshCookieValue: cookieValue(res, this.cookieName)!,
    };
  }

  /** Drives the real flow end to end: password login -> mfa_setup token ->
   * enroll -> confirm -> password login again -> MFA challenge -> verified
   * session. Returns the TOTP secret so the test can keep generating
   * codes. Never logged. */
  async fullMfaSession(
    user: TestUser,
  ): Promise<Session & { secret: string; user: TestUser }> {
    const setup = await this.login(user).expect(200);
    expect(setup.body.status).toBe('MFA_SETUP_REQUIRED');
    const secret = await this.enrollAndConfirm(setup.body.challengeToken);
    return { ...(await this.mfaLogin(user, secret)), secret, user };
  }

  async enrollAndConfirm(bearer: string): Promise<string> {
    const enroll = await request(this.http)
      .post(`${API}/auth/mfa/enroll`)
      .set('Authorization', `Bearer ${bearer}`)
      .expect(201);
    const secret = extractSecret(enroll.body.provisioningUri);
    await request(this.http)
      .post(`${API}/auth/mfa/confirm`)
      .set('Authorization', `Bearer ${bearer}`)
      .send({ code: await freshTotp(secret) })
      .expect(200);
    return secret;
  }

  async mfaLogin(user: TestUser, secret: string): Promise<Session> {
    const challenge = await this.login(user).expect(200);
    expect(challenge.body.status).toBe('MFA_REQUIRED');
    const res = await request(this.http)
      .post(`${API}/auth/mfa/verify`)
      .send({
        challengeToken: challenge.body.challengeToken,
        code: await freshTotp(secret),
      })
      .expect(200);
    return {
      accessToken: res.body.accessToken,
      refreshCookieValue: cookieValue(res, this.cookieName)!,
    };
  }

  refresh(cookieVal?: string) {
    const req = request(this.http).post(`${API}/auth/refresh`);
    return cookieVal
      ? req.set('Cookie', `${this.cookieName}=${cookieVal}`)
      : req;
  }

  logout(cookieVal?: string) {
    const req = request(this.http).post(`${API}/auth/logout`);
    return cookieVal
      ? req.set('Cookie', `${this.cookieName}=${cookieVal}`)
      : req;
  }

  me(token: string) {
    return request(this.http)
      .get(`${API}/auth/me`)
      .set('Authorization', `Bearer ${token}`);
  }

  /** A valid CreateEnterpriseDto body, unique per run. */
  enterprisePayload(
    tag: string,
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    this.counter += 1;
    return {
      name: `E2E Enterprise ${tag} ${this.runId}-${this.counter}`,
      businessType: 'Private Limited Company',
      registrationNumber: `UDYAM-E2E-${this.runId}-${this.counter}`,
      registrationNumberType: 'UDYAM',
      address: 'Plot 14, MIDC Chakan, Pune, Maharashtra 410501',
      sector: 'Engineering',
      ...overrides,
    };
  }

  /** Creates an enterprise over real HTTP and tracks it for cleanup. */
  async createEnterprise(
    token: string,
    tag = 'ent',
    overrides: Record<string, unknown> = {},
  ): Promise<{ id: string; referenceNumber: string; body: any }> {
    const res = await request(this.http)
      .post(`${API}/enterprises`)
      .set('Authorization', `Bearer ${token}`)
      .send(this.enterprisePayload(tag, overrides))
      .expect(201);
    this.enterpriseIds.push(res.body.id);
    return {
      id: res.body.id,
      referenceNumber: res.body.referenceNumber,
      body: res.body,
    };
  }

  /** A department for rule fixtures (tracked for cleanup). */
  async createDepartment(tag: string): Promise<{ id: string; code: string }> {
    this.counter += 1;
    const dept = await this.prisma.department.create({
      data: {
        name: `E2E Dept ${tag} ${this.runId}-${this.counter}`,
        code: `E2E-${tag}-${this.runId}-${this.counter}`.toUpperCase(),
      },
    });
    this.departmentIds.push(dept.id);
    return { id: dept.id, code: dept.code };
  }

  /** An approval type for rule fixtures (tracked for cleanup). Test data
   * only — no statutory approval is ever seeded. */
  async createApprovalType(
    departmentId: string,
    name: string,
  ): Promise<string> {
    const type = await this.prisma.approvalType.create({
      data: { name: `${name} ${this.runId}`, departmentId },
    });
    this.approvalTypeIds.push(type.id);
    return type.id;
  }

  /** Publishes a rule version through the real service (grammar validation,
   * version numbering, audit) — not a raw insert. */
  publishRule(
    authorUserId: string,
    approvalTypeId: string,
    conditions: unknown,
    extra: Record<string, unknown> = {},
  ) {
    return this.app.get(ApprovalRulesService).publishVersion({
      approvalTypeId,
      conditions,
      sourceReference: 'E2E TEST FIXTURE',
      createdByUserId: authorUserId,
      ipAddress: '127.0.0.1',
      // Well in the past, so "now" is always inside the window.
      effectiveFrom: new Date(Date.now() - 3_600_000),
      ...extra,
    });
  }

  /** An active workflow for an approval type (tracked for cleanup via the
   * approval type). Test data only — no statutory workflow is ever seeded. */
  createWorkflow(
    approvalTypeId: string,
    over: { version?: number; isActive?: boolean } = {},
  ) {
    return this.prisma.workflow.create({
      data: {
        approvalTypeId,
        name: `E2E workflow ${this.runId}`,
        version: over.version ?? 1,
        isActive: over.isActive ?? true,
      },
    });
  }

  /** Department + approval type + a rule that matches every project + an
   * active workflow: everything an application needs to be started. Returns
   * the ids. Test data only. */
  async createStartableApproval(
    authorUserId: string,
    tag: string,
    over: {
      withWorkflow?: boolean;
      ruleExtra?: Record<string, unknown>;
      /** Put the approval in an EXISTING department (so officers of that
       * department can work its applications). */
      departmentId?: string;
    } = {},
  ): Promise<{ departmentId: string; approvalTypeId: string; ruleId: string }> {
    const dept = over.departmentId
      ? { id: over.departmentId }
      : await this.createDepartment(tag);
    const approvalTypeId = await this.createApprovalType(dept.id, tag);
    const rule = await this.publishRule(
      authorUserId,
      approvalTypeId,
      { field: 'hazardous_flag', op: 'in', value: [true, false] },
      over.ruleExtra ?? {},
    );
    if (over.withWorkflow !== false) {
      await this.createWorkflow(approvalTypeId);
    }
    return { departmentId: dept.id, approvalTypeId, ruleId: rule.id };
  }

  /** A department-scoped officer with a fully MFA-verified session, made the
   * way production makes one: register, assign the role (an internal service
   * capability), then enrol and confirm TOTP over the real endpoints. */
  async officerSession(
    tag: string,
    roleCode: string,
    departmentId?: string,
  ): Promise<{ user: TestUser; accessToken: string }> {
    const user = await this.registerWithRole(tag, roleCode, departmentId);
    const session = await this.fullMfaSession(user);
    return { user, accessToken: session.accessToken };
  }

  /** A SUBMITTED application (over the real applicant flow) for an approval,
   * plus everything needed to work with it. */
  async submittedApplication(
    applicantToken: string,
    enterpriseId: string,
    approvalTypeId: string,
    tag: string,
    options: {
      formData?: Record<string, unknown>;
      projectId?: string;
      /** Runs between creating the draft and submitting (e.g. to upload). */
      beforeSubmit?: (ids: {
        projectId: string;
        applicationId: string;
      }) => Promise<void>;
    } = {},
  ): Promise<{
    projectId: string;
    applicationId: string;
    referenceNumber: string;
    snapshotId: string;
  }> {
    const projectId =
      options.projectId ??
      (await this.createProjectVia(applicantToken, enterpriseId, tag)).id;
    const snapshotId = await this.discover(
      applicantToken,
      enterpriseId,
      projectId,
    );
    const base = `${API}/enterprises/${enterpriseId}/projects/${projectId}/applications`;
    const created = await request(this.http)
      .post(base)
      .set('Authorization', `Bearer ${applicantToken}`)
      .send({
        approvalTypeId,
        discoverySnapshotId: snapshotId,
        ...(options.formData ? { formData: options.formData } : {}),
      })
      .expect(201);
    const applicationId = created.body.id as string;
    if (options.beforeSubmit) {
      await options.beforeSubmit({ projectId, applicationId });
    }
    const submitted = await request(this.http)
      .post(`${base}/${applicationId}/submit`)
      .set('Authorization', `Bearer ${applicantToken}`)
      .send({ declarationAccepted: true })
      .expect(200);
    return {
      projectId,
      applicationId,
      referenceNumber: submitted.body.referenceNumber as string,
      snapshotId,
    };
  }

  /** Runs approval discovery over HTTP and returns the persisted snapshot id. */
  async discover(
    token: string,
    enterpriseId: string,
    projectId: string,
  ): Promise<string> {
    const res = await request(this.http)
      .post(
        `${API}/enterprises/${enterpriseId}/projects/${projectId}/discover-approvals`,
      )
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    return res.body.snapshotId as string;
  }

  /** Uploads a document over real multipart HTTP. `file` is the bytes; the
   * filename / declared content type / text fields are overridable. */
  uploadDocument(
    token: string,
    enterpriseId: string,
    projectId: string,
    applicationId: string,
    file: Buffer | null,
    options: {
      filename?: string;
      contentType?: string;
      fields?: Record<string, string>;
      path?: string;
      /** Build the multipart body by hand, so the filename reaches the server
       * exactly as written (HTTP client libraries trim paths to a basename). */
      raw?: boolean;
    } = {},
  ) {
    if (options.raw) {
      const boundary = `----e2e${randomUUID()}`;
      const parts: Buffer[] = [];
      for (const [name, value] of Object.entries(options.fields ?? {})) {
        parts.push(
          Buffer.from(
            `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
            'utf8',
          ),
        );
      }
      if (file !== null) {
        parts.push(
          Buffer.from(
            `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${options.filename ?? 'document.pdf'}"\r\nContent-Type: ${options.contentType ?? 'application/pdf'}\r\n\r\n`,
            'utf8',
          ),
          file,
          Buffer.from('\r\n', 'utf8'),
        );
      }
      parts.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'));
      return request(this.http)
        .post(
          `${API}/enterprises/${enterpriseId}/projects/${projectId}/applications/${applicationId}/${options.path ?? 'documents'}`,
        )
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', `multipart/form-data; boundary=${boundary}`)
        .send(Buffer.concat(parts));
    }
    const req = request(this.http)
      .post(
        `${API}/enterprises/${enterpriseId}/projects/${projectId}/applications/${applicationId}/${options.path ?? 'documents'}`,
      )
      .set('Authorization', `Bearer ${token}`);
    for (const [name, value] of Object.entries(options.fields ?? {})) {
      req.field(name, value);
    }
    if (file !== null) {
      req.attach('file', file, {
        filename: options.filename ?? 'document.pdf',
        contentType: options.contentType ?? 'application/pdf',
      });
    }
    return req;
  }

  /** A valid CreateProjectDto body. */
  projectPayload(
    tag: string,
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    this.counter += 1;
    return {
      name: `E2E Project ${tag} ${this.runId}-${this.counter}`,
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
      ...overrides,
    };
  }

  /** Creates a project over real HTTP as `token` and tracks it for cleanup. */
  async createProjectVia(
    token: string,
    enterpriseId: string,
    tag = 'proj',
    overrides: Record<string, unknown> = {},
  ): Promise<{ id: string; referenceNumber: string; body: any }> {
    const res = await request(this.http)
      .post(`${API}/enterprises/${enterpriseId}/projects`)
      .set('Authorization', `Bearer ${token}`)
      .send(this.projectPayload(tag, overrides))
      .expect(201);
    this.projectIds.push(res.body.id);
    return {
      id: res.body.id,
      referenceNumber: res.body.referenceNumber,
      body: res.body,
    };
  }

  /** Inserts a project directly (bypassing the API), for tests that need a
   * project without going through authorisation. */
  async createProject(enterpriseId: string, tag = 'p'): Promise<string> {
    const project = await this.prisma.project.create({
      data: {
        enterpriseId,
        name: `E2E Project ${tag} ${this.runId}`,
        district: 'Pune',
        taluka: 'Khed',
        sectorCode: 'E2E',
        enterpriseSizeBand: 'micro',
        investmentAmount: 100000,
        employmentCount: 5,
        landStatus: 'owned',
        constructionStatus: 'not_started',
        productionStatus: 'pre_production',
        hazardousFlag: false,
        projectStage: 'greenfield',
      },
    });
    this.projectIds.push(project.id);
    return project.id;
  }

  async cleanup(): Promise<void> {
    // Enterprises/representatives/projects reference users with RESTRICT, so
    // they must go first.
    // Include anything owned by a tracked user, so a test that failed
    // before tracking its enterprise cannot wedge cleanup on the FK.
    const owned = await this.prisma.enterprise.findMany({
      where: { ownerUserId: { in: this.userIds } },
      select: { id: true },
    });
    this.enterpriseIds.push(...owned.map((e) => e.id));
    await this.prisma.enterpriseRepresentative.deleteMany({
      where: {
        OR: [
          { enterpriseId: { in: this.enterpriseIds } },
          { representativeUserId: { in: this.userIds } },
        ],
      },
    });
    const doomedProjects = await this.prisma.project.findMany({
      where: {
        OR: [
          { id: { in: this.projectIds } },
          { enterpriseId: { in: this.enterpriseIds } },
        ],
      },
      select: { id: true },
    });
    // Step 10 records reference applications, documents, observations and
    // users with RESTRICT, so they go first (queries before the observations
    // they may cite).
    const doomedApplications = await this.prisma.approvalApplication.findMany({
      where: {
        OR: [
          { projectId: { in: doomedProjects.map((p) => p.id) } },
          { approvalTypeId: { in: this.approvalTypeIds } },
          { createdByUserId: { in: this.userIds } },
        ],
      },
      select: { id: true },
    });
    const appIds = doomedApplications.map((a) => a.id);
    // Step 14: obligation occurrences reference applications, requirements and
    // the user who fulfilled them (RESTRICT), so they go first.
    await this.prisma.complianceRecord.deleteMany({
      where: {
        OR: [
          { applicationId: { in: appIds } },
          {
            complianceRequirement: {
              approvalTypeId: { in: this.approvalTypeIds },
            },
          },
          { fulfilledByUserId: { in: this.userIds } },
        ],
      },
    });
    await this.prisma.complianceRequirement.deleteMany({
      where: { approvalTypeId: { in: this.approvalTypeIds } },
    });
    // Step 12: an SLA clock and its pauses reference applications and queries
    // (RESTRICT), so they go before both.
    await this.prisma.slaPause.deleteMany({
      where: { slaInstance: { applicationId: { in: appIds } } },
    });
    await this.prisma.slaInstance.deleteMany({
      where: { applicationId: { in: appIds } },
    });
    await this.prisma.applicationQuery.deleteMany({
      where: {
        OR: [
          { applicationId: { in: appIds } },
          { raisedByUserId: { in: this.userIds } },
        ],
      },
    });
    await this.prisma.scrutinyObservation.deleteMany({
      where: {
        OR: [
          { applicationId: { in: appIds } },
          { authorUserId: { in: this.userIds } },
        ],
      },
    });
    // Step 15: a certificate references its decision and its file; a decision
    // references the recommendation it answered (all RESTRICT), so certificate,
    // then decision, then recommendation.
    await this.prisma.approvalCertificate.deleteMany({
      where: {
        OR: [
          { applicationId: { in: appIds } },
          { issuedByUserId: { in: this.userIds } },
        ],
      },
    });
    await this.prisma.approvalDecision.deleteMany({
      where: {
        OR: [
          { applicationId: { in: appIds } },
          { decidedByUserId: { in: this.userIds } },
        ],
      },
    });
    await this.prisma.scrutinyRecommendation.deleteMany({
      where: {
        OR: [
          { applicationId: { in: appIds } },
          { recommendedByUserId: { in: this.userIds } },
        ],
      },
    });
    await this.prisma.applicationAssignment.deleteMany({
      where: {
        OR: [
          { applicationId: { in: appIds } },
          { officerUserId: { in: this.userIds } },
          { assignedByUserId: { in: this.userIds } },
        ],
      },
    });
    // Step 11A: inspections (and conflict declarations) reference
    // applications, projects and users with RESTRICT.
    // Step 11B: an inspection's results, evidence and report first.
    const doomedInspections = await this.prisma.inspection.findMany({
      where: {
        OR: [
          { applicationId: { in: appIds } },
          { inspectorId: { in: this.userIds } },
          { createdByUserId: { in: this.userIds } },
          { assignedByUserId: { in: this.userIds } },
        ],
      },
      select: { id: true },
    });
    const inspectionIds = doomedInspections.map((i) => i.id);
    await this.prisma.inspectionReport.deleteMany({
      where: { inspectionId: { in: inspectionIds } },
    });
    await this.prisma.inspectionReportSummary.deleteMany({
      where: { inspectionId: { in: inspectionIds } },
    });
    const evidence = await this.prisma.inspectionEvidence.findMany({
      where: { inspectionId: { in: inspectionIds } },
      select: { id: true },
    });
    await this.prisma.inspectionEvidence.deleteMany({
      where: { id: { in: evidence.map((e) => e.id) } },
    });
    // (The evidence FILES are ordinary documents uploaded by tracked users: the
    // document cleanup below removes their stored objects and rows.)
    await this.prisma.inspection.deleteMany({
      where: {
        OR: [
          { applicationId: { in: appIds } },
          { inspectorId: { in: this.userIds } },
          { createdByUserId: { in: this.userIds } },
          { assignedByUserId: { in: this.userIds } },
        ],
      },
    });
    // Step 12: the stage rows an SLA clock hangs on (inspections referenced
    // them, so only now).
    await this.prisma.applicationStage.deleteMany({
      where: { applicationId: { in: appIds } },
    });
    await this.prisma.inspectorConflict.deleteMany({
      where: {
        OR: [
          { projectId: { in: doomedProjects.map((p) => p.id) } },
          { inspectorId: { in: this.userIds } },
          { reviewedBy: { in: this.userIds } },
        ],
      },
    });
    await this.prisma.documentVerification.deleteMany({
      where: {
        OR: [
          { verifiedByUserId: { in: this.userIds } },
          { document: { uploadedBy: { in: this.userIds } } },
        ],
      },
    });
    // Step 16: scheme applications reference projects, schemes and users with
    // RESTRICT (their evidence links cascade), and a scheme's rules / required
    // documents / itself reference departments and users with RESTRICT.
    const doomedSchemes = await this.prisma.scheme.findMany({
      where: {
        OR: [
          { departmentId: { in: this.departmentIds } },
          { createdByUserId: { in: this.userIds } },
          { publishedByUserId: { in: this.userIds } },
        ],
      },
      select: { id: true },
    });
    const schemeIds = doomedSchemes.map((s) => s.id);
    const doomedSchemeApplications =
      await this.prisma.schemeApplication.findMany({
        where: {
          OR: [
            { projectId: { in: doomedProjects.map((p) => p.id) } },
            { schemeId: { in: schemeIds } },
            { createdByUserId: { in: this.userIds } },
            { decidedByUserId: { in: this.userIds } },
          ],
        },
        select: { id: true },
      });
    const schemeApplicationIds = doomedSchemeApplications.map((a) => a.id);
    await this.prisma.schemeApplicationStatusHistory.deleteMany({
      where: {
        OR: [
          { schemeApplicationId: { in: schemeApplicationIds } },
          { actorUserId: { in: this.userIds } },
        ],
      },
    });
    await this.prisma.schemeApplication.deleteMany({
      where: { id: { in: schemeApplicationIds } },
    });
    await this.prisma.schemeDocumentRequirement.deleteMany({
      where: { schemeId: { in: schemeIds } },
    });
    await this.prisma.schemeRule.deleteMany({
      where: {
        OR: [
          { schemeId: { in: schemeIds } },
          { createdByUserId: { in: this.userIds } },
        ],
      },
    });
    await this.prisma.scheme.deleteMany({ where: { id: { in: schemeIds } } });
    // Applications reference projects, snapshots, approval types, workflows
    // and users with RESTRICT, so they go before all of those.
    await this.prisma.approvalApplication.deleteMany({
      where: {
        OR: [
          { projectId: { in: doomedProjects.map((p) => p.id) } },
          { approvalTypeId: { in: this.approvalTypeIds } },
          { createdByUserId: { in: this.userIds } },
        ],
      },
    });
    // Documents: remove the stored objects, then the rows - newest version
    // first, because a version references the one it replaced (RESTRICT).
    const storage = this.app.get<StorageService>(STORAGE_SERVICE);
    const stored = await this.prisma.document.findMany({
      where: { uploadedBy: { in: this.userIds } },
      select: { filePath: true },
    });
    for (const { filePath } of stored) {
      await storage.delete(filePath).catch(() => undefined);
    }
    for (let round = 0; round < 100; round++) {
      const { count } = await this.prisma.document.deleteMany({
        where: {
          uploadedBy: { in: this.userIds },
          replacements: { none: {} },
        },
      });
      if (count === 0) {
        break;
      }
    }
    await this.prisma.documentRequirement.deleteMany({
      where: { approvalTypeId: { in: this.approvalTypeIds } },
    });
    // Step 11B: department checklists hang off approval types (RESTRICT).
    await this.prisma.inspectionChecklist.deleteMany({
      where: { approvalTypeId: { in: this.approvalTypeIds } },
    });
    // Step 11C: a workflow's stages (an INSPECTION stage marks an approval as
    // requiring an inspection) go before the workflow itself (RESTRICT).
    await this.prisma.workflowStage.deleteMany({
      where: { workflow: { approvalTypeId: { in: this.approvalTypeIds } } },
    });
    await this.prisma.workflow.deleteMany({
      where: { approvalTypeId: { in: this.approvalTypeIds } },
    });
    // Snapshots reference projects and users with RESTRICT.
    await this.prisma.discoverySnapshot.deleteMany({
      where: {
        OR: [
          { projectId: { in: doomedProjects.map((p) => p.id) } },
          { createdByUserId: { in: this.userIds } },
        ],
      },
    });
    await this.prisma.project.deleteMany({
      where: { id: { in: doomedProjects.map((p) => p.id) } },
    });
    // Rules reference users and approval types with RESTRICT.
    await this.prisma.approvalRule.deleteMany({
      where: {
        OR: [
          { approvalTypeId: { in: this.approvalTypeIds } },
          { createdBy: { in: this.userIds } },
        ],
      },
    });
    await this.prisma.approvalDependency.deleteMany({
      where: {
        OR: [
          { approvalTypeId: { in: this.approvalTypeIds } },
          { dependsOnApprovalTypeId: { in: this.approvalTypeIds } },
        ],
      },
    });
    await this.prisma.approvalType.deleteMany({
      where: { id: { in: this.approvalTypeIds } },
    });
    await this.prisma.enterprise.deleteMany({
      where: { id: { in: this.enterpriseIds } },
    });
    for (const id of this.userIds) {
      await this.prisma.auditLog.deleteMany({
        where: {
          OR: [
            { userId: id },
            { afterState: { path: ['userId'], equals: id } },
          ],
        },
      });
    }
    // System-attributed events (no user: an SLA breach found by the sweep, a
    // notification whose delivery finally failed) are about an application or a
    // notification the cleanup is removing; the per-user deletion above cannot
    // find them.
    const notificationIds = (
      await this.prisma.notification.findMany({
        where: { userId: { in: this.userIds } },
        select: { id: true },
      })
    ).map((n) => n.id);
    await this.prisma.auditLog.deleteMany({
      where: { entityId: { in: [...appIds, ...notificationIds] } },
    });
    // Step 12: holidays reference users and departments (RESTRICT).
    await this.prisma.slaHoliday.deleteMany({
      where: {
        OR: [
          { createdByUserId: { in: this.userIds } },
          { departmentId: { in: this.departmentIds } },
        ],
      },
    });
    // refresh_sessions, mfa_credentials and user_roles cascade with the user.
    await this.prisma.user.deleteMany({ where: { id: { in: this.userIds } } });
    await this.prisma.department.deleteMany({
      where: { id: { in: this.departmentIds } },
    });
  }
}

export async function createE2eContext(
  options: { verboseLogs?: boolean } = {},
): Promise<E2eContext> {
  // Step 12: the hourly breach sweep must not fire in the middle of a test run;
  // tests drive `SlaSweepService.sweep(now)` themselves.
  process.env.SLA_SWEEP_ENABLED = 'false';
  // Step 13: nor may the notification retry job fire on its own; tests drive
  // `NotificationDeliveryService.retryDue(now)` themselves.
  process.env.NOTIFICATION_RETRY_ENABLED = 'false';
  // Step 14: nor may the hourly compliance job; tests drive
  // `ComplianceSyncService.run(now, scope)` themselves.
  process.env.COMPLIANCE_SYNC_ENABLED = 'false';
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule, AuthzTestModule],
  }).compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>();
  if (options.verboseLogs) {
    // Nest's testing module logs only errors by default. Log-hygiene tests
    // need the real, production-verbosity logger or they would pass
    // vacuously.
    app.useLogger(new ConsoleLogger());
  }
  configureApp(app);
  setupSwagger(app);
  await app.init();
  // Listen once on an ephemeral loopback port. Without this, supertest starts
  // its own listener per request and CLOSES it when that request ends, which
  // resets any other request still in flight — so concurrent requests (e.g.
  // Promise.all in a beforeAll, or the concurrency tests) flake with
  // ECONNRESET. With an already-listening server it never starts or stops one.
  await app.listen(0, '127.0.0.1');

  return new E2eContext(
    app,
    app.get(PrismaService),
    app.get(UsersService),
    app.get(ConfigService),
  );
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function extractSecret(provisioningUri: string): string {
  const secret = new URL(provisioningUri).searchParams.get('secret');
  if (!secret) throw new Error('provisioning URI has no secret');
  return secret;
}

/** Generates a code guaranteed to still be valid by the time the server
 * checks it: if the current 30s TOTP step is about to roll over, wait for
 * the next one rather than racing it. */
export async function freshTotp(secret: string): Promise<string> {
  if (authenticator.timeRemaining() < 3) {
    await new Promise((r) =>
      setTimeout(r, (authenticator.timeRemaining() + 1) * 1000),
    );
  }
  return authenticator.generate(secret);
}

export function wrongTotp(secret: string): string {
  const valid = authenticator.generate(secret);
  return valid === '000000' ? '111111' : '000000';
}

export function setCookieHeaders(res: request.Response): string[] {
  const header = res.headers['set-cookie'] as unknown as string[] | undefined;
  return header ?? [];
}

export function cookieHeader(
  res: request.Response,
  name: string,
): string | undefined {
  return setCookieHeaders(res).find((h) => h.startsWith(`${name}=`));
}

export function cookieValue(
  res: request.Response,
  name: string,
): string | undefined {
  const header = cookieHeader(res, name);
  return header ? header.slice(name.length + 1).split(';')[0] : undefined;
}

export function base64url(input: object | string): string {
  const buffer = Buffer.from(
    typeof input === 'string' ? input : JSON.stringify(input),
  );
  return buffer.toString('base64url');
}

/** Captures everything the process writes to stdout/stderr (Nest's logger
 * included) so a test can assert no secret ever reaches a log line. */
export function captureOutput(): { stop: () => string } {
  const chunks: string[] = [];
  const capture = (chunk: unknown) => {
    chunks.push(
      typeof chunk === 'string'
        ? chunk
        : Buffer.from(chunk as Uint8Array).toString(),
    );
    return true;
  };
  const out = jest
    .spyOn(process.stdout, 'write')
    .mockImplementation(capture as never);
  const err = jest
    .spyOn(process.stderr, 'write')
    .mockImplementation(capture as never);
  return {
    stop: () => {
      out.mockRestore();
      err.mockRestore();
      return chunks.join('');
    },
  };
}
