import { pdfBytes } from './document-fixtures';
import { E2eContext } from './e2e-helpers';
import { Actor, as } from './officer-world';

/**
 * The cast every scheme E2E needs, built over the real flows (registration, role
 * assignment, TOTP enrolment, login). Departments, schemes, rules and thresholds
 * are labelled TEST FIXTURES: no government scheme, eligibility threshold, benefit
 * or deadline is ever seeded or assumed.
 *
 *   department A : Scheme Officers soA + soA2, Department Administrator adminA
 *                  (the default scheme PUBLISHER), Scrutiny Officer scrutinyA
 *   department B : Scheme Officer soB, Department Administrator adminB
 *   no department: legal (LEGAL_COMPLIANCE), sysAdmin (SYSTEM_ADMIN)
 *   applicants   : owner (owns `enterpriseId`), owner2 (owns `enterprise2Id`)
 */
export interface SchemeWorld {
  deptA: { id: string; code: string };
  deptB: { id: string; code: string };
  soA: Actor;
  soA2: Actor;
  soB: Actor;
  adminA: Actor;
  adminB: Actor;
  legal: Actor;
  sysAdmin: Actor;
  scrutinyA: Actor;
  owner: Actor;
  owner2: Actor;
  enterpriseId: string;
  enterprise2Id: string;
}

export async function buildSchemeWorld(
  ctx: E2eContext,
  tag: string,
): Promise<SchemeWorld> {
  const [deptA, deptB] = await Promise.all([
    ctx.createDepartment(`${tag}a`),
    ctx.createDepartment(`${tag}b`),
  ]);
  const [owner, owner2] = await Promise.all([
    ctx.applicantSession(`${tag}-owner`),
    ctx.applicantSession(`${tag}-owner2`),
  ]);
  const [enterprise, enterprise2] = await Promise.all([
    ctx.createEnterprise(owner.accessToken, `${tag}-ent`),
    ctx.createEnterprise(owner2.accessToken, `${tag}-ent2`),
  ]);
  const [soA, soA2, soB, adminA, adminB, legal, sysAdmin, scrutinyA] =
    await Promise.all([
      ctx.officerSession(`${tag}-so1`, 'SCHEME_OFFICER', deptA.id),
      ctx.officerSession(`${tag}-so2`, 'SCHEME_OFFICER', deptA.id),
      ctx.officerSession(`${tag}-sob`, 'SCHEME_OFFICER', deptB.id),
      ctx.officerSession(`${tag}-adm`, 'DEPT_ADMIN', deptA.id),
      ctx.officerSession(`${tag}-admb`, 'DEPT_ADMIN', deptB.id),
      ctx.officerSession(`${tag}-legal`, 'LEGAL_COMPLIANCE', undefined),
      ctx.officerSession(`${tag}-sys`, 'SYSTEM_ADMIN', undefined),
      ctx.officerSession(`${tag}-scr`, 'SCRUTINY_OFFICER', deptA.id),
    ]);
  return {
    deptA,
    deptB,
    soA,
    soA2,
    soB,
    adminA,
    adminB,
    legal,
    sysAdmin,
    scrutinyA,
    owner,
    owner2,
    enterpriseId: enterprise.id,
    enterprise2Id: enterprise2.id,
  };
}

/** A valid draft body. Every value is a labelled fixture. */
export function schemeBody(
  ctx: E2eContext,
  departmentId: string,
  over: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    departmentId,
    name: `E2E Scheme ${ctx.runId}-${Math.random().toString(36).slice(2, 8)}`,
    description: 'A test-fixture scheme; not a real government scheme.',
    benefits: 'Test-fixture benefit text.',
    eligibilityCriteria: 'Test-fixture eligibility criteria in plain language.',
    ...over,
  };
}

export interface PublishedScheme {
  id: string;
  name: string;
  ruleId: string | null;
  requirementIds: string[];
}

/**
 * Drafts a scheme as the department's Scheme Officer, adds its rule and required
 * documents, and publishes it as the department's publisher (over real HTTP).
 * `rule: null` publishes a scheme with no eligibility rule.
 */
export async function publishScheme(
  ctx: E2eContext,
  w: SchemeWorld,
  options: {
    department?: 'A' | 'B';
    body?: Record<string, unknown>;
    rule?: Record<string, unknown> | null;
    ruleExtra?: Record<string, unknown>;
    requirements?: Array<Record<string, unknown>>;
    publish?: boolean;
  } = {},
): Promise<PublishedScheme> {
  const dept = options.department === 'B' ? w.deptB : w.deptA;
  const officer = options.department === 'B' ? w.soB : w.soA;
  const publisher = options.department === 'B' ? w.adminB : w.adminA;
  const draft = await as(ctx, officer.accessToken)
    .post('/scheme-officer/schemes')
    .send(schemeBody(ctx, dept.id, options.body))
    .expect(201);
  const id = draft.body.id as string;
  let ruleId: string | null = null;
  if (options.rule !== null) {
    const rule = await as(ctx, officer.accessToken)
      .post(`/scheme-officer/schemes/${id}/rules`)
      .send({
        conditions: options.rule ?? {
          field: 'hazardous_flag',
          op: 'in',
          value: [true, false],
        },
        sourceReference: 'E2E TEST FIXTURE',
        effectiveFrom: new Date(Date.now() - 3_600_000).toISOString(),
        ...options.ruleExtra,
      })
      .expect(201);
    ruleId = rule.body.id as string;
  }
  const requirementIds: string[] = [];
  for (const requirement of options.requirements ?? []) {
    const created = await as(ctx, officer.accessToken)
      .post(`/scheme-officer/schemes/${id}/document-requirements`)
      .send(requirement)
      .expect(201);
    requirementIds.push(created.body.id as string);
  }
  if (options.publish !== false) {
    await as(ctx, publisher.accessToken)
      .post(`/scheme-officer/schemes/${id}/publish`)
      .expect(200);
  }
  return { id, name: draft.body.name as string, ruleId, requirementIds };
}

/** Applies for a scheme over HTTP as `token`, returning the response. */
export function applyFor(
  ctx: E2eContext,
  token: string,
  enterpriseId: string,
  projectId: string,
  schemeId: string,
) {
  return as(ctx, token).post(
    `/enterprises/${enterpriseId}/projects/${projectId}/schemes/${schemeId}/apply`,
  );
}

export const schemeApplicationBase = (
  enterpriseId: string,
  projectId: string,
  applicationId: string,
) =>
  `/enterprises/${enterpriseId}/projects/${projectId}/scheme-applications/${applicationId}`;

/** Uploads evidence over real multipart HTTP. */
export function uploadEvidence(
  ctx: E2eContext,
  token: string,
  enterpriseId: string,
  projectId: string,
  applicationId: string,
  options: {
    file?: Buffer | null;
    filename?: string;
    contentType?: string;
    fields?: Record<string, string>;
    path?: string;
  } = {},
) {
  const req = as(ctx, token).post(
    `${schemeApplicationBase(enterpriseId, projectId, applicationId)}/${options.path ?? 'documents'}`,
  );
  for (const [name, value] of Object.entries(options.fields ?? {})) {
    req.field(name, value);
  }
  if (options.file !== null) {
    req.attach('file', options.file ?? pdfBytes(), {
      filename: options.filename ?? 'evidence.pdf',
      contentType: options.contentType ?? 'application/pdf',
    });
  }
  return req;
}
