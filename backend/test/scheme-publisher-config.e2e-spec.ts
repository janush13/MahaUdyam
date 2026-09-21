import { E2eContext, createE2eContext } from './support/e2e-helpers';
import { as } from './support/officer-world';
import {
  SchemeWorld,
  buildSchemeWorld,
  publishScheme,
} from './support/scheme-world';

jest.setTimeout(600_000);

/**
 * Step 16 - who publishes a scheme is FRD register item 10 ("Department Admin vs
 * Legal/Compliance", TO BE VALIDATED), so it is deployment configuration
 * (SCHEME_PUBLISHER_ROLES), not code. This boots the application with the Scheme
 * Officer and Legal / Compliance named as publishers and shows the same
 * department-scoped rules follow the configuration - and that the default
 * publisher (the Department Administrator) then has no publish right.
 */
describe('Schemes e2e - configurable publisher role', () => {
  let ctx: E2eContext;
  let w: SchemeWorld;
  const original = process.env.SCHEME_PUBLISHER_ROLES;
  const api = (a: { accessToken: string }) => as(ctx, a.accessToken);
  const errorCode = (res: { body: { error?: { code?: string } } }) =>
    res.body.error?.code;

  beforeAll(async () => {
    process.env.SCHEME_PUBLISHER_ROLES = 'SCHEME_OFFICER, legal_compliance';
    ctx = await createE2eContext();
    w = await buildSchemeWorld(ctx, 'sp');
  });

  afterAll(async () => {
    await ctx.cleanup();
    await ctx.app.close();
    if (original === undefined) {
      delete process.env.SCHEME_PUBLISHER_ROLES;
    } else {
      process.env.SCHEME_PUBLISHER_ROLES = original;
    }
  });

  it('the drafting Scheme Officer may publish when the deployment says so, and the record shows who drafted and who published', async () => {
    const s = await publishScheme(ctx, w, { publish: false });
    const draft = await api(w.soA)
      .get(`/scheme-officer/schemes/${s.id}`)
      .expect(200);
    expect(draft.body.capabilities).toEqual({
      canMaintain: true,
      canPublish: true,
      canWithdraw: true,
    });
    const res = await api(w.soA)
      .post(`/scheme-officer/schemes/${s.id}/publish`)
      .expect(200);
    expect(res.body).toMatchObject({
      publishStatus: 'PUBLISHED',
      publishedByUserId: w.soA.user.id,
    });
    const [event] = await ctx.prisma.auditLog.findMany({
      where: { entityId: s.id, action: 'SCHEME_PUBLISHED' },
    });
    expect(event).toMatchObject({
      userId: w.soA.user.id,
      roleAtTime: 'SCHEME_OFFICER',
    });
    expect(event.afterState).toMatchObject({ draftedByUserId: w.soA.user.id });
  });

  it('a Legal / Compliance user (not department-scoped) can review and publish any department’s draft, but not edit it', async () => {
    const s = await publishScheme(ctx, w, { department: 'B', publish: false });
    const seen = await api(w.legal)
      .get(`/scheme-officer/schemes/${s.id}`)
      .expect(200);
    expect(seen.body.capabilities).toEqual({
      canMaintain: false,
      canPublish: true,
      canWithdraw: true,
    });
    const denied = await api(w.legal)
      .put(`/scheme-officer/schemes/${s.id}`)
      .send({ benefits: 'x' })
      .expect(403);
    expect(errorCode(denied)).toBe('INSUFFICIENT_PERMISSION');
    const res = await api(w.legal)
      .post(`/scheme-officer/schemes/${s.id}/publish`)
      .expect(200);
    expect(res.body.publishedByUserId).toBe(w.legal.user.id);
    const [event] = await ctx.prisma.auditLog.findMany({
      where: { entityId: s.id, action: 'SCHEME_PUBLISHED' },
    });
    expect(event).toMatchObject({
      userId: w.legal.user.id,
      roleAtTime: 'LEGAL_COMPLIANCE',
    });
  });

  it('the Department Administrator, no longer named, has no rights over the catalogue (404)', async () => {
    const s = await publishScheme(ctx, w, { publish: false });
    await api(w.adminA).get(`/scheme-officer/schemes/${s.id}`).expect(404);
    await api(w.adminA)
      .post(`/scheme-officer/schemes/${s.id}/publish`)
      .expect(404);
  });

  it('a Scheme Officer of another department still cannot publish this department’s scheme', async () => {
    const s = await publishScheme(ctx, w, { publish: false });
    await api(w.soB)
      .post(`/scheme-officer/schemes/${s.id}/publish`)
      .expect(404);
  });

  it('a System Administrator can never publish, whatever is configured', async () => {
    const s = await publishScheme(ctx, w, { publish: false });
    const res = await api(w.sysAdmin)
      .post(`/scheme-officer/schemes/${s.id}/publish`)
      .expect(403);
    expect(errorCode(res)).toBe('INSUFFICIENT_ROLE');
  });
});
