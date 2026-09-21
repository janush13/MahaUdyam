import { E2eContext, createE2eContext } from './support/e2e-helpers';
import {
  Actor,
  OfficerWorld,
  as,
  buildOfficerWorld,
} from './support/officer-world';
import {
  approved,
  decide,
  errorCode,
  issueCertificate,
  recommended,
} from './support/decision-helpers';
import { pdfBytes } from './support/document-fixtures';

jest.setTimeout(600_000);

/**
 * Step 15 - concurrency and integrity: two decisions (or two certificate
 * issuances) racing on one application produce exactly ONE decision (or
 * certificate), one state, one notification and one audit trail; the loser is
 * told 409, and nothing is left half-done.
 */
describe('Decision concurrency e2e', () => {
  let ctx: E2eContext;
  let w: OfficerWorld;
  let aaA2: Actor;

  const dbApp = (id: string) =>
    ctx.prisma.approvalApplication.findUniqueOrThrow({ where: { id } });
  const auditCount = (entityId: string, action: string) =>
    ctx.prisma.auditLog.count({ where: { entityId, action } });
  const inbox = async (a: Actor) =>
    (
      await as(ctx, a.accessToken)
        .get('/notifications?pageSize=100')
        .expect(200)
    ).body.items as Array<{ eventType: string; applicationId: string | null }>;

  beforeAll(async () => {
    ctx = await createE2eContext();
    w = await buildOfficerWorld(ctx, 'dn');
    aaA2 = await ctx.officerSession(
      'dn-aa2',
      'APPROVING_AUTHORITY',
      w.deptA.id,
    );
  });

  afterAll(async () => {
    await ctx.cleanup();
    await ctx.app.close();
  });

  it('two authorities racing with OPPOSITE outcomes: exactly one decision, and the state is the winner’s', async () => {
    const s = await recommended(ctx, w, 'race-opp');
    const results = await Promise.all([
      decide(ctx, w.aaA, s.applicationId, {
        outcome: 'APPROVE',
        reason: 'approve',
      }),
      decide(ctx, aaA2, s.applicationId, {
        outcome: 'REJECT',
        reason: 'reject',
      }),
    ]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([201, 409]);
    const loser = results.find((r) => r.status === 409);
    expect(errorCode(loser as never)).toBe('DECISION_ALREADY_RECORDED');

    const decisions = await ctx.prisma.approvalDecision.findMany({
      where: { applicationId: s.applicationId },
    });
    expect(decisions).toHaveLength(1);
    const app = await dbApp(s.applicationId);
    expect(app.internalState).toBe(
      decisions[0].outcome === 'APPROVE' ? 'APPROVED' : 'REJECTED',
    );
    expect(app.decisionReason).toBe(decisions[0].reason);
    expect(app.decidedAt?.getTime()).toBe(decisions[0].decidedAt.getTime());

    // One audit event, one status change to the decided state, one notice.
    expect(
      await auditCount(s.applicationId, 'APPLICATION_DECISION_RECORDED'),
    ).toBe(1);
    const decidedChanges = (
      await ctx.prisma.auditLog.findMany({
        where: {
          entityId: s.applicationId,
          action: 'APPLICATION_STATUS_CHANGED',
        },
      })
    ).filter((e) =>
      ['APPROVED', 'REJECTED'].includes(
        (e.afterState as { internalState?: string })?.internalState ?? '',
      ),
    );
    expect(decidedChanges).toHaveLength(1);
    const type =
      decisions[0].outcome === 'APPROVE'
        ? 'APPROVAL_ISSUED'
        : 'APPLICATION_REJECTED';
    expect(
      (await inbox(w.owner)).filter(
        (n) =>
          n.applicationId === s.applicationId &&
          ['APPROVAL_ISSUED', 'APPLICATION_REJECTED'].includes(n.eventType),
      ),
    ).toMatchObject([{ eventType: type }]);
  });

  it('many identical decisions at once: one 201, the rest 409, one decision row', async () => {
    const s = await recommended(ctx, w, 'race-many');
    const actors = [w.aaA, aaA2, w.aaA, aaA2, w.aaA, aaA2];
    const results = await Promise.all(
      actors.map((a) => decide(ctx, a, s.applicationId)),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(5);
    expect(
      await ctx.prisma.approvalDecision.count({
        where: { applicationId: s.applicationId },
      }),
    ).toBe(1);
    expect((await dbApp(s.applicationId)).internalState).toBe('APPROVED');
    expect(
      await auditCount(s.applicationId, 'APPLICATION_DECISION_RECORDED'),
    ).toBe(1);
  });

  it('a decision racing a scrutiny action on the same application: one wins, the state is one they define, no decision without a recommendation', async () => {
    const s = await recommended(ctx, w, 'race-scrutiny');
    const results = await Promise.all([
      decide(ctx, w.aaA, s.applicationId),
      // A scrutiny officer trying to make a second recommendation meanwhile.
      as(ctx, w.soA1.accessToken)
        .post(`/officer/applications/${s.applicationId}/recommendation`)
        .send({ outcome: 'REJECT', reason: 'late second thought' }),
    ]);
    expect(results[0].status).toBe(201);
    expect(results[1].status).toBe(409);
    expect((await dbApp(s.applicationId)).internalState).toBe('APPROVED');
    const decision = await ctx.prisma.approvalDecision.findUniqueOrThrow({
      where: { applicationId: s.applicationId },
    });
    const recs = await ctx.prisma.scrutinyRecommendation.findMany({
      where: { applicationId: s.applicationId },
    });
    expect(recs).toHaveLength(1);
    expect(decision.recommendationId).toBe(recs[0].id);
  });

  it('two certificate issuances at once: one certificate, one file kept, one activation, obligations created once', async () => {
    const approvalTypeId = (
      await ctx.createStartableApproval(w.owner.user.id, 'dn-cert', {
        departmentId: w.deptA.id,
      })
    ).approvalTypeId;
    await as(ctx, w.adminA.accessToken)
      .post('/admin/compliance/requirements')
      .send({
        approvalTypeId,
        description: 'File the annual return',
        frequency: 'ONE_TIME',
        firstDueAfterDays: 30,
      })
      .expect(201);
    const s = await approved(ctx, w, 'race-cert', { approvalTypeId });
    const filesBefore = await ctx.prisma.document.count({
      where: { uploadedBy: w.aaA.user.id },
    });

    const results = await Promise.all([
      issueCertificate(ctx, w.aaA, s.applicationId, {
        data: pdfBytes('race-a'),
        fields: { certificateNumber: 'RACE/A' },
      }),
      issueCertificate(ctx, aaA2, s.applicationId, {
        data: pdfBytes('race-b'),
        fields: { certificateNumber: 'RACE/B' },
      }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const loser = results.find((r) => r.status === 409);
    expect(errorCode(loser as never)).toBe('CERTIFICATE_ALREADY_ISSUED');

    const certs = await ctx.prisma.approvalCertificate.findMany({
      where: { applicationId: s.applicationId },
    });
    expect(certs).toHaveLength(1);
    expect(certs[0].version).toBe(1);
    expect((await dbApp(s.applicationId)).internalState).toBe('ACTIVE');
    expect(
      await ctx.prisma.complianceRecord.count({
        where: { applicationId: s.applicationId },
      }),
    ).toBe(1);
    expect(
      await auditCount(s.applicationId, 'APPLICATION_CERTIFICATE_ISSUED'),
    ).toBe(1);
    expect(
      await auditCount(s.applicationId, 'COMPLIANCE_OBLIGATION_CREATED'),
    ).toBe(1);
    // The loser's file was discarded: only the winner's document exists.
    const filesAfter = await ctx.prisma.document.count({
      where: { uploadedBy: { in: [w.aaA.user.id, aaA2.user.id] } },
    });
    expect(filesAfter - filesBefore).toBe(1);
  });

  it('a decision and a certificate attempt racing: the certificate can only follow an approval, never precede it', async () => {
    const s = await recommended(ctx, w, 'race-order');
    const [d, c] = await Promise.all([
      decide(ctx, w.aaA, s.applicationId),
      issueCertificate(ctx, aaA2, s.applicationId),
    ]);
    expect(d.status).toBe(201);
    // Whichever order the lock gave them, a certificate is only ever issued
    // for an APPROVED application: either refused (not yet approved) or, if the
    // decision won the lock, issued on it.
    expect([201, 409]).toContain(c.status);
    const certs = await ctx.prisma.approvalCertificate.count({
      where: { applicationId: s.applicationId },
    });
    const app = await dbApp(s.applicationId);
    if (c.status === 201) {
      expect(certs).toBe(1);
      expect(app.internalState).toBe('ACTIVE');
    } else {
      expect(certs).toBe(0);
      expect(app.internalState).toBe('APPROVED');
    }
  });
});
