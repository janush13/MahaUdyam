import request from 'supertest';
import { E2eContext } from './e2e-helpers';
import { pdfBytes } from './document-fixtures';
import { Actor, OfficerWorld, as } from './officer-world';

export const officerApp = (id: string) => `/officer/applications/${id}`;

export const errorCode = (res: { body: { error?: { code?: string } } }) =>
  res.body.error?.code;

export interface Submitted {
  projectId: string;
  applicationId: string;
  referenceNumber: string;
}

/**
 * A REAL recommended application, over the real flow: submitted by the
 * applicant, assigned by the department administrator, scrutiny started and a
 * recommendation recorded by the assigned scrutiny officer.
 */
export async function recommended(
  ctx: E2eContext,
  w: OfficerWorld,
  tag: string,
  opts: {
    approvalTypeId?: string;
    outcome?: 'APPROVE' | 'REJECT';
    reason?: string;
  } = {},
): Promise<Submitted> {
  const s = await ctx.submittedApplication(
    w.owner.accessToken,
    w.enterpriseId,
    opts.approvalTypeId ?? w.approvalA,
    tag,
  );
  await as(ctx, w.adminA.accessToken)
    .post(`${officerApp(s.applicationId)}/assignment`)
    .send({ officerUserId: w.soA1.user.id })
    .expect(201);
  await as(ctx, w.soA1.accessToken)
    .post(`${officerApp(s.applicationId)}/start-scrutiny`)
    .expect(200);
  await as(ctx, w.soA1.accessToken)
    .post(`${officerApp(s.applicationId)}/recommendation`)
    .send({
      outcome: opts.outcome ?? 'APPROVE',
      reason: opts.reason ?? 'Recorded reason for the recommendation.',
    })
    .expect(201);
  return s;
}

export const decide = (
  ctx: E2eContext,
  actor: Actor,
  applicationId: string,
  body: Record<string, unknown> = {
    outcome: 'APPROVE',
    reason: 'Recorded reason for the decision.',
  },
) =>
  as(ctx, actor.accessToken)
    .post(`${officerApp(applicationId)}/decision`)
    .send(body);

export const issueCertificate = (
  ctx: E2eContext,
  actor: Actor,
  applicationId: string,
  opts: {
    data?: Buffer | null;
    filename?: string;
    type?: string;
    fields?: Record<string, string>;
  } = {},
) => {
  let req = request(ctx.http)
    .post(`/api/v1${officerApp(applicationId)}/certificate`)
    .set('Authorization', `Bearer ${actor.accessToken}`);
  if (opts.data !== null) {
    req = req.attach('file', opts.data ?? pdfBytes(`cert-${applicationId}`), {
      filename: opts.filename ?? 'certificate.pdf',
      contentType: opts.type ?? 'application/pdf',
    });
  }
  for (const [k, v] of Object.entries(opts.fields ?? {})) {
    req = req.field(k, v);
  }
  return req;
};

/** Recommended, approved and (optionally) certified, over the real routes. */
export async function approved(
  ctx: E2eContext,
  w: OfficerWorld,
  tag: string,
  opts: Parameters<typeof recommended>[3] = {},
): Promise<Submitted> {
  const s = await recommended(ctx, w, tag, opts);
  await decide(ctx, w.aaA, s.applicationId).expect(201);
  return s;
}
