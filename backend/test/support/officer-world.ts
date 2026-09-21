import request from 'supertest';
import { API, E2eContext, TestUser } from './e2e-helpers';

export interface Actor {
  user: TestUser;
  accessToken: string;
}

/**
 * The cast every officer E2E needs, built once per spec file over the real
 * flows (registration, role assignment, TOTP enrolment, login):
 *
 *   department A  : scrutiny officers soA1 + soA2, admin adminA, approving
 *                   authority aaA, inspector inspectorA
 *   department B  : scrutiny officer soB, admin adminB
 *   no department : sysAdmin (SYSTEM_ADMIN), leadership (LEADERSHIP)
 *   applicants    : owner (owns `enterpriseId`), owner2 (owns `enterprise2Id`)
 *
 * approvalA belongs to department A, approvalB to department B. No statutory
 * data: departments, approvals and rules are labelled test fixtures.
 */
export interface OfficerWorld {
  deptA: { id: string; code: string };
  deptB: { id: string; code: string };
  approvalA: string;
  approvalB: string;
  owner: Actor;
  owner2: Actor;
  enterpriseId: string;
  enterprise2Id: string;
  soA1: Actor;
  soA2: Actor;
  adminA: Actor;
  aaA: Actor;
  inspectorA: Actor;
  soB: Actor;
  adminB: Actor;
  sysAdmin: Actor;
  leadership: Actor;
}

export async function buildOfficerWorld(
  ctx: E2eContext,
  tag: string,
): Promise<OfficerWorld> {
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
  const approvalA = (
    await ctx.createStartableApproval(owner.user.id, `${tag}-a`, {
      departmentId: deptA.id,
    })
  ).approvalTypeId;
  const approvalB = (
    await ctx.createStartableApproval(owner.user.id, `${tag}-b`, {
      departmentId: deptB.id,
    })
  ).approvalTypeId;

  const [
    soA1,
    soA2,
    adminA,
    aaA,
    inspectorA,
    soB,
    adminB,
    sysAdmin,
    leadership,
  ] = await Promise.all([
    ctx.officerSession(`${tag}-so1`, 'SCRUTINY_OFFICER', deptA.id),
    ctx.officerSession(`${tag}-so2`, 'SCRUTINY_OFFICER', deptA.id),
    ctx.officerSession(`${tag}-adm`, 'DEPT_ADMIN', deptA.id),
    ctx.officerSession(`${tag}-aa`, 'APPROVING_AUTHORITY', deptA.id),
    ctx.officerSession(`${tag}-ins`, 'INSPECTOR', deptA.id),
    ctx.officerSession(`${tag}-sob`, 'SCRUTINY_OFFICER', deptB.id),
    ctx.officerSession(`${tag}-admb`, 'DEPT_ADMIN', deptB.id),
    ctx.officerSession(`${tag}-sys`, 'SYSTEM_ADMIN', undefined),
    ctx.officerSession(`${tag}-lead`, 'LEADERSHIP', undefined),
  ]);

  return {
    deptA,
    deptB,
    approvalA,
    approvalB,
    owner,
    owner2,
    enterpriseId: enterprise.id,
    enterprise2Id: enterprise2.id,
    soA1,
    soA2,
    adminA,
    aaA,
    inspectorA,
    soB,
    adminB,
    sysAdmin,
    leadership,
  };
}

/** Terse authenticated HTTP for one token. */
export function as(ctx: E2eContext, token: string) {
  const call =
    (method: 'get' | 'post' | 'put' | 'patch' | 'delete') => (path: string) =>
      request(ctx.http)
        [method](`${API}${path}`)
        .set('Authorization', `Bearer ${token}`);
  return {
    get: call('get'),
    post: call('post'),
    put: call('put'),
    patch: call('patch'),
    del: call('delete'),
  };
}
