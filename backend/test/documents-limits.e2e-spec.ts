import request from 'supertest';
import { API, E2eContext, createE2eContext } from './support/e2e-helpers';
import { pdfBytes } from './support/document-fixtures';

jest.setTimeout(300_000);

/**
 * The platform's per-file ceiling is configuration (DOCUMENT_MAX_SIZE_BYTES).
 * Here it is set small so the limit is exercised precisely, end to end.
 * A DocumentRequirement can only LOWER it, never raise it.
 */
describe('Documents e2e — configurable size ceiling', () => {
  const CEILING = 4096;
  let ctx: E2eContext;
  let token: string;
  let userId: string;
  let enterpriseId: string;

  const padTo = (size: number) => {
    const head = pdfBytes();
    return Buffer.concat([head, Buffer.alloc(size - head.length, 0x20)]);
  };

  const application = async (tag: string, maxSizeBytes?: number) => {
    const project = await ctx.createProjectVia(token, enterpriseId, tag);
    const approval = await ctx.createStartableApproval(userId, tag);
    let requirementId: string | undefined;
    if (maxSizeBytes !== undefined) {
      requirementId = (
        await ctx.prisma.documentRequirement.create({
          data: {
            approvalTypeId: approval.approvalTypeId,
            name: `E2E limit ${tag}`,
            isMandatory: false,
            maxSizeBytes,
          },
        })
      ).id;
    }
    const snapshotId = await ctx.discover(token, enterpriseId, project.id);
    const created = await request(ctx.http)
      .post(
        `${API}/enterprises/${enterpriseId}/projects/${project.id}/applications`,
      )
      .set('Authorization', `Bearer ${token}`)
      .send({
        approvalTypeId: approval.approvalTypeId,
        discoverySnapshotId: snapshotId,
      })
      .expect(201);
    return {
      projectId: project.id,
      applicationId: created.body.id as string,
      requirementId,
    };
  };

  const upload = (
    a: { projectId: string; applicationId: string; requirementId?: string },
    file: Buffer,
  ) =>
    ctx.uploadDocument(
      token,
      enterpriseId,
      a.projectId,
      a.applicationId,
      file,
      {
        fields: a.requirementId
          ? { documentRequirementId: a.requirementId }
          : {},
      },
    );

  beforeAll(async () => {
    process.env.DOCUMENT_MAX_SIZE_BYTES = String(CEILING);
    ctx = await createE2eContext();
    const session = await ctx.applicantSession('lim-owner');
    token = session.accessToken;
    userId = session.user.id;
    enterpriseId = (await ctx.createEnterprise(token, 'lim')).id;
  });

  afterAll(async () => {
    delete process.env.DOCUMENT_MAX_SIZE_BYTES;
    await ctx.cleanup();
    await ctx.app.close();
  });

  it('accepts a file exactly at the configured ceiling and rejects one byte over', async () => {
    const a = await application('ceiling');
    await upload(a, padTo(CEILING)).expect(201);
    const over = await upload(a, padTo(CEILING + 1));
    expect(over.status).toBe(413);
    expect(over.body.error.code).toBe('FILE_TOO_LARGE');
    const far = await upload(a, padTo(CEILING * 10));
    expect(far.status).toBe(413);
    expect(far.body.error.code).toBe('FILE_TOO_LARGE');
    expect(
      await ctx.prisma.applicationDocument.count({
        where: { applicationId: a.applicationId },
      }),
    ).toBe(1);
  });

  it('a requirement can lower the ceiling but never raise it', async () => {
    const lower = await application('lower', 1024);
    const listing = await request(ctx.http)
      .get(
        `${API}/enterprises/${enterpriseId}/projects/${lower.projectId}/applications/${lower.applicationId}/document-requirements`,
      )
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(listing.body[0].maxSizeBytes).toBe(1024);
    expect((await upload(lower, padTo(2000))).status).toBe(413);
    await upload(lower, padTo(1000)).expect(201);

    const higher = await application('higher', 1_000_000);
    const listing2 = await request(ctx.http)
      .get(
        `${API}/enterprises/${enterpriseId}/projects/${higher.projectId}/applications/${higher.applicationId}/document-requirements`,
      )
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(listing2.body[0].maxSizeBytes).toBe(CEILING);
    expect((await upload(higher, padTo(CEILING + 1))).status).toBe(413);
    await upload(higher, padTo(CEILING)).expect(201);
  });
});
