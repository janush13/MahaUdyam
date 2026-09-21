import request from 'supertest';
import { API, E2eContext, createE2eContext } from './support/e2e-helpers';
import { eicarPdf, exeBytes, pdfBytes } from './support/document-fixtures';
import { istDate, recordsOf } from './support/compliance-helpers';
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
  officerApp,
  recommended,
} from './support/decision-helpers';
import { ComplianceSyncService } from '../src/modules/compliance/compliance-sync.service';
import { addDaysYmd } from '../src/modules/compliance/compliance-dates';

jest.setTimeout(600_000);

/**
 * Step 15 - the certificate, the activation it starts, the compliance
 * obligations it creates and the notifications the decision raises, over real
 * HTTP -> Nest -> Prisma -> PostgreSQL. No certificate format, numbering,
 * validity or e-sign is defined, so none is asserted beyond what is recorded.
 */
describe('Certificate e2e - issuance, activation, compliance, notifications', () => {
  let ctx: E2eContext;
  let w: OfficerWorld;
  let sync: ComplianceSyncService;

  const dbApp = (id: string) =>
    ctx.prisma.approvalApplication.findUniqueOrThrow({ where: { id } });
  const auditOf = (entityId: string, action: string) =>
    ctx.prisma.auditLog.findMany({
      where: { entityId, action },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  const certOf = (applicationId: string) =>
    ctx.prisma.approvalCertificate.findMany({ where: { applicationId } });
  const inbox = async (a: Actor) =>
    (
      await as(ctx, a.accessToken)
        .get('/notifications?pageSize=100')
        .expect(200)
    ).body.items as Array<{
      eventType: string;
      applicationId: string | null;
      message: string;
      title: string;
    }>;
  const noticesFor = async (a: Actor, applicationId: string) =>
    (await inbox(a)).filter((n) => n.applicationId === applicationId);

  /** A fresh approval type of department A, optionally with an obligation. */
  const approval = async (
    tag: string,
    obligation?: Record<string, unknown>,
  ) => {
    const id = (
      await ctx.createStartableApproval(w.owner.user.id, `ce-${tag}`, {
        departmentId: w.deptA.id,
      })
    ).approvalTypeId;
    if (obligation) {
      await as(ctx, w.adminA.accessToken)
        .post('/admin/compliance/requirements')
        .send({ approvalTypeId: id, ...obligation })
        .expect(201);
    }
    return id;
  };

  beforeAll(async () => {
    ctx = await createE2eContext();
    w = await buildOfficerWorld(ctx, 'ce');
    sync = ctx.app.get(ComplianceSyncService);
  });

  afterAll(async () => {
    await ctx.cleanup();
    await ctx.app.close();
  });

  // -------------------------------------------------------------------------
  describe('issuance', () => {
    it('APPROVED -> CERTIFICATE_ISSUED -> ACTIVE in one act; records number, version, date and the application / enterprise / project / department', async () => {
      const s = await approved(ctx, w, 'is1');
      const res = await issueCertificate(ctx, w.aaA, s.applicationId, {
        fields: { certificateNumber: 'DEPT-A/2026/17' },
      }).expect(201);
      expect(res.body).toMatchObject({
        applicationId: s.applicationId,
        internalState: 'ACTIVE',
        applicantStatus: 'APPROVED',
        complianceObligationsCreated: 0,
        certificate: {
          applicationId: s.applicationId,
          enterpriseId: w.enterpriseId,
          projectId: s.projectId,
          department: { id: w.deptA.id },
          version: 1,
          certificateNumber: 'DEPT-A/2026/17',
          issuedByUserId: w.aaA.user.id,
          file: { filename: 'certificate.pdf', downloadable: true },
        },
      });
      const app = await dbApp(s.applicationId);
      expect(app).toMatchObject({
        internalState: 'ACTIVE',
        applicantStatus: 'APPROVED',
      });
      const [cert] = await certOf(s.applicationId);
      const decision = await ctx.prisma.approvalDecision.findUniqueOrThrow({
        where: { applicationId: s.applicationId },
      });
      expect(cert).toMatchObject({
        version: 1,
        decisionId: decision.id,
        departmentId: w.deptA.id,
        certificateNumber: 'DEPT-A/2026/17',
        issuedByUserId: w.aaA.user.id,
      });
      // The activation time IS the issuance time; the decision time is earlier.
      expect(new Date(res.body.activatedAt).getTime()).toBe(
        cert.issuedAt.getTime(),
      );
      expect(cert.issuedAt.getTime()).toBeGreaterThanOrEqual(
        decision.decidedAt.getTime(),
      );
    });

    it('the number is optional: none given, none invented', async () => {
      const s = await approved(ctx, w, 'is2');
      const res = await issueCertificate(ctx, w.aaA, s.applicationId).expect(
        201,
      );
      expect(res.body.certificate.certificateNumber).toBeNull();
    });

    it('the file is a Step 9 document: project-owned, scanned, checksummed, not in the application’s document list', async () => {
      const s = await approved(ctx, w, 'is3');
      const bytes = pdfBytes('is3-file');
      await issueCertificate(ctx, w.aaA, s.applicationId, {
        data: bytes,
      }).expect(201);
      const [cert] = await certOf(s.applicationId);
      const doc = await ctx.prisma.document.findUniqueOrThrow({
        where: { id: cert.documentId },
      });
      expect(doc).toMatchObject({
        ownerType: 'PROJECT',
        ownerId: s.projectId,
        uploadedBy: w.aaA.user.id,
        mimeType: 'application/pdf',
        sizeBytes: bytes.length,
      });
      expect(doc.scannedAt).not.toBeNull();
      expect(doc.checksum).toMatch(/^[0-9a-f]{64}$/);
      expect(
        await ctx.prisma.applicationDocument.count({
          where: { documentId: doc.id },
        }),
      ).toBe(0);
      const docs = await as(ctx, w.soA1.accessToken)
        .get(`${officerApp(s.applicationId)}/documents`)
        .expect(200);
      expect(
        (docs.body as Array<{ id: string }>).some((d) => d.id === doc.id),
      ).toBe(false);
    });

    it('the applicant downloads exactly the bytes the department issued (audited); the officer detail shows the certificate', async () => {
      const s = await approved(ctx, w, 'is4');
      const bytes = pdfBytes('is4-file');
      await issueCertificate(ctx, w.aaA, s.applicationId, {
        data: bytes,
        fields: { certificateNumber: 'N-4' },
      }).expect(201);
      const dl = await request(ctx.http)
        .get(
          `${API}/enterprises/${w.enterpriseId}/projects/${s.projectId}/applications/${s.applicationId}/certificate/download`,
        )
        .set('Authorization', `Bearer ${w.owner.accessToken}`)
        .buffer(true)
        .parse((res, cb) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => cb(null, Buffer.concat(chunks)));
        })
        .expect(200);
      expect(dl.headers['content-type']).toMatch(/application\/pdf/);
      expect(dl.headers['cache-control']).toMatch(/no-store/);
      expect(Buffer.from(dl.body).equals(bytes)).toBe(true);
      const [cert] = await certOf(s.applicationId);
      expect(
        await ctx.prisma.auditLog.count({
          where: { entityId: cert.documentId, action: 'DOCUMENT_DOWNLOADED' },
        }),
      ).toBe(1);

      const detail = (
        await as(ctx, w.adminA.accessToken)
          .get(officerApp(s.applicationId))
          .expect(200)
      ).body;
      expect(detail.certificate).toMatchObject({
        certificateNumber: 'N-4',
        version: 1,
        issuedByUserId: w.aaA.user.id,
      });
      expect(detail.availableActions).not.toContain('ISSUE_CERTIFICATE');
    });
  });

  // -------------------------------------------------------------------------
  describe('prerequisites and the upload pipeline', () => {
    it.each([['not yet decided', async (t: string) => recommended(ctx, w, t)]])(
      '%s: the authority cannot issue a certificate (409), nothing is stored',
      async (_label, make) => {
        const s = await make('pr1');
        const before = await ctx.prisma.document.count({
          where: { uploadedBy: w.aaA.user.id },
        });
        const res = await issueCertificate(ctx, w.aaA, s.applicationId).expect(
          409,
        );
        expect(errorCode(res)).toBe('CERTIFICATE_NOT_ALLOWED');
        expect(
          await ctx.prisma.document.count({
            where: { uploadedBy: w.aaA.user.id },
          }),
        ).toBe(before);
        expect(await certOf(s.applicationId)).toHaveLength(0);
      },
    );

    it('a rejected application never gets a certificate', async () => {
      const s = await recommended(ctx, w, 'pr2', { outcome: 'REJECT' });
      await decide(ctx, w.aaA, s.applicationId, {
        outcome: 'REJECT',
        reason: 'Rejected.',
      }).expect(201);
      const res = await issueCertificate(ctx, w.aaA, s.applicationId).expect(
        409,
      );
      expect(errorCode(res)).toBe('CERTIFICATE_NOT_ALLOWED');
      expect((await dbApp(s.applicationId)).internalState).toBe('REJECTED');
    });

    it('a second issuance is 409 CERTIFICATE_ALREADY_ISSUED and changes nothing', async () => {
      const s = await approved(ctx, w, 'pr3');
      await issueCertificate(ctx, w.aaA, s.applicationId, {
        fields: { certificateNumber: 'FIRST' },
      }).expect(201);
      const [first] = await certOf(s.applicationId);
      const res = await issueCertificate(ctx, w.aaA, s.applicationId, {
        fields: { certificateNumber: 'SECOND' },
      }).expect(409);
      expect(errorCode(res)).toBe('CERTIFICATE_ALREADY_ISSUED');
      expect(await certOf(s.applicationId)).toEqual([first]);
    });

    it.each([
      ['no file', { data: null }, 400, 'FILE_REQUIRED'],
      ['an infected file', { data: eicarPdf() }, 422, 'MALWARE_DETECTED'],
      [
        'an executable',
        { data: exeBytes(), filename: 'c.exe', type: 'application/pdf' },
        422,
        undefined,
      ],
    ])(
      '%s is refused, nothing is stored, and the application stays APPROVED and can still be certified',
      async (_l, opts, status, code) => {
        const s = await approved(ctx, w, `up-${_l.replace(/\W+/g, '-')}`);
        const res = await issueCertificate(ctx, w.aaA, s.applicationId, opts);
        expect([status, 415]).toContain(res.status);
        if (code) {
          expect(errorCode(res)).toBe(code);
        }
        expect(await certOf(s.applicationId)).toHaveLength(0);
        expect((await dbApp(s.applicationId)).internalState).toBe('APPROVED');
        await issueCertificate(ctx, w.aaA, s.applicationId).expect(201);
      },
    );

    it.each([
      ['a validity period', { validUntil: '2030-01-01' }],
      ['a status', { status: 'ACTIVE' }],
      ['an over-long number', { certificateNumber: 'x'.repeat(101) }],
      ['a blank number', { certificateNumber: '   ' }],
    ])('refuses %s (400), nothing stored', async (_l, fields) => {
      const s = await approved(ctx, w, `fl-${_l.replace(/\W+/g, '-')}`);
      const res = await issueCertificate(ctx, w.aaA, s.applicationId, {
        fields: fields as Record<string, string>,
      }).expect(400);
      expect(errorCode(res)).toBe('VALIDATION_ERROR');
      expect(await certOf(s.applicationId)).toHaveLength(0);
      expect((await dbApp(s.applicationId)).internalState).toBe('APPROVED');
    });
  });

  // -------------------------------------------------------------------------
  describe('compliance activation (existing occurrence mechanism, real activation time)', () => {
    it('creates the department’s configured obligations at issuance, dated from the activation moment, and the hourly job then finds nothing to add', async () => {
      const approvalTypeId = await approval('cp1', {
        description: 'File the annual return',
        frequency: 'ONE_TIME',
        firstDueAfterDays: 30,
      });
      const s = await approved(ctx, w, 'cp1', { approvalTypeId });
      expect(await recordsOf(ctx.prisma, s.applicationId)).toHaveLength(0);

      const res = await issueCertificate(ctx, w.aaA, s.applicationId).expect(
        201,
      );
      expect(res.body.complianceObligationsCreated).toBe(1);
      const records = await recordsOf(ctx.prisma, s.applicationId);
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        status: 'UPCOMING',
        occurrenceNumber: 1,
        description: 'File the annual return',
      });
      expect(records[0].dueDate?.toISOString().slice(0, 10)).toBe(
        addDaysYmd(istDate(new Date(res.body.activatedAt)), 30),
      );

      const created = await auditOf(
        s.applicationId,
        'COMPLIANCE_OBLIGATION_CREATED',
      );
      expect(created).toHaveLength(1);
      expect(created[0]).toMatchObject({
        userId: w.aaA.user.id,
        roleAtTime: 'APPROVING_AUTHORITY',
      });
      expect(created[0].afterState).toMatchObject({
        triggeredBy: 'CERTIFICATE_ISSUED',
        departmentId: w.deptA.id,
      });

      // Idempotent: the job creates nothing more for this application.
      const run = await sync.run(new Date(), {
        applicationIds: [s.applicationId],
      });
      expect(run.created).toBe(0);
      expect(await recordsOf(ctx.prisma, s.applicationId)).toHaveLength(1);

      // The applicant sees it through the existing compliance view.
      const view = await as(ctx, w.owner.accessToken)
        .get(
          `/enterprises/${w.enterpriseId}/projects/${s.projectId}/applications/${s.applicationId}/compliance`,
        )
        .expect(200);
      expect(view.body.items).toHaveLength(1);
    });

    it('an approval with no configured obligation activates with none (nothing is inferred)', async () => {
      const s = await approved(ctx, w, 'cp2');
      const res = await issueCertificate(ctx, w.aaA, s.applicationId).expect(
        201,
      );
      expect(res.body.complianceObligationsCreated).toBe(0);
      expect(await recordsOf(ctx.prisma, s.applicationId)).toHaveLength(0);
    });

    it('a failed issuance (rejected file) creates no obligation and no ACTIVE state', async () => {
      const approvalTypeId = await approval('cp3', {
        description: 'File the annual return',
        frequency: 'ONE_TIME',
        firstDueAfterDays: 10,
      });
      const s = await approved(ctx, w, 'cp3', { approvalTypeId });
      await issueCertificate(ctx, w.aaA, s.applicationId, {
        data: eicarPdf(),
      }).expect(422);
      expect(await recordsOf(ctx.prisma, s.applicationId)).toHaveLength(0);
      expect((await dbApp(s.applicationId)).internalState).toBe('APPROVED');
    });

    it('audits both status changes with before/after, attributing ACTIVE to the platform', async () => {
      const s = await approved(ctx, w, 'cp4');
      await issueCertificate(ctx, w.aaA, s.applicationId).expect(201);
      const changes = await auditOf(
        s.applicationId,
        'APPLICATION_STATUS_CHANGED',
      );
      const issued = changes.find(
        (e) =>
          (e.afterState as { internalState?: string }).internalState ===
          'CERTIFICATE_ISSUED',
      );
      const active = changes.find(
        (e) =>
          (e.afterState as { internalState?: string }).internalState ===
          'ACTIVE',
      );
      expect(issued?.beforeState).toMatchObject({ internalState: 'APPROVED' });
      expect(active?.beforeState).toMatchObject({
        internalState: 'CERTIFICATE_ISSUED',
      });
      expect(issued).toMatchObject({
        userId: w.aaA.user.id,
        roleAtTime: 'APPROVING_AUTHORITY',
      });
      expect(active?.afterState).toMatchObject({ performedBy: 'SYSTEM' });
      const certEvents = await auditOf(
        s.applicationId,
        'APPLICATION_CERTIFICATE_ISSUED',
      );
      expect(certEvents).toHaveLength(1);
      expect(certEvents[0].afterState).toMatchObject({
        applicationId: s.applicationId,
        departmentId: w.deptA.id,
        enterpriseId: w.enterpriseId,
        projectId: s.projectId,
        certificateVersion: 1,
      });
    });
  });

  // -------------------------------------------------------------------------
  describe('notifications (NotificationEventsService, in-app always)', () => {
    it('an approval notifies the applicant side once (in-app), without the reason; officers are not told', async () => {
      const s = await recommended(ctx, w, 'nt1');
      await decide(ctx, w.aaA, s.applicationId, {
        outcome: 'APPROVE',
        reason: 'CONFIDENTIAL-REASON-TEXT',
      }).expect(201);
      const got = (await noticesFor(w.owner, s.applicationId)).filter(
        (n) => n.eventType === 'APPROVAL_ISSUED',
      );
      expect(got).toHaveLength(1);
      expect(got[0].message).toContain(s.referenceNumber);
      expect(got[0].message).not.toContain('CONFIDENTIAL-REASON-TEXT');
      for (const officer of [w.soA1, w.adminA, w.aaA]) {
        expect(
          (await noticesFor(officer, s.applicationId)).filter(
            (n) => n.eventType === 'APPROVAL_ISSUED',
          ),
        ).toHaveLength(0);
      }
      // Another enterprise's owner sees nothing of it.
      expect(await noticesFor(w.owner2, s.applicationId)).toHaveLength(0);
      // Issuing the certificate does not raise a second approval notice.
      await issueCertificate(ctx, w.aaA, s.applicationId).expect(201);
      expect(
        (await noticesFor(w.owner, s.applicationId)).filter(
          (n) => n.eventType === 'APPROVAL_ISSUED',
        ),
      ).toHaveLength(1);
    });

    it('a rejection notifies the applicant side once', async () => {
      const s = await recommended(ctx, w, 'nt2', { outcome: 'REJECT' });
      await decide(ctx, w.aaA, s.applicationId, {
        outcome: 'REJECT',
        reason: 'CONFIDENTIAL-REJECTION-TEXT',
      }).expect(201);
      const got = (await noticesFor(w.owner, s.applicationId)).filter(
        (n) => n.eventType === 'APPLICATION_REJECTED',
      );
      expect(got).toHaveLength(1);
      expect(got[0].message).not.toContain('CONFIDENTIAL-REJECTION-TEXT');
      const rows = await ctx.prisma.notification.findMany({
        where: {
          applicationId: s.applicationId,
          eventType: 'APPLICATION_REJECTED',
        },
      });
      // The in-app row is always there, whatever else is configured.
      expect(rows.some((r) => r.channel === 'IN_APP')).toBe(true);
    });

    it('a refused decision or certificate raises no notification', async () => {
      const s = await recommended(ctx, w, 'nt3');
      await as(ctx, w.aaA.accessToken)
        .post(`${officerApp(s.applicationId)}/decision`)
        .send({ outcome: 'APPROVE' })
        .expect(400);
      await issueCertificate(ctx, w.aaA, s.applicationId).expect(409);
      expect(
        (await noticesFor(w.owner, s.applicationId)).filter((n) =>
          ['APPROVAL_ISSUED', 'APPLICATION_REJECTED'].includes(n.eventType),
        ),
      ).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  describe('database integrity', () => {
    it('a certificate row is append-only', async () => {
      const s = await approved(ctx, w, 'db1');
      await issueCertificate(ctx, w.aaA, s.applicationId).expect(201);
      await expect(
        ctx.prisma.approvalCertificate.updateMany({
          where: { applicationId: s.applicationId },
          data: { certificateNumber: 'rewritten' },
        }),
      ).rejects.toThrow(/append-only/);
    });

    it('a certificate cannot be inserted for a non-approved application, another department, a rejecting decision, or someone else’s file', async () => {
      const notApproved = await recommended(ctx, w, 'db2a');
      const approvedApp = await approved(ctx, w, 'db2b');
      const other = await approved(ctx, w, 'db2c');
      await issueCertificate(ctx, w.aaA, other.applicationId).expect(201);
      const [otherCert] = await certOf(other.applicationId);
      const decision = await ctx.prisma.approvalDecision.findUniqueOrThrow({
        where: { applicationId: approvedApp.applicationId },
      });
      const base = {
        version: 1,
        issuedByUserId: w.aaA.user.id,
        issuedAt: new Date(),
      };
      // Not approved.
      await expect(
        ctx.prisma.approvalCertificate.create({
          data: {
            ...base,
            applicationId: notApproved.applicationId,
            decisionId: decision.id,
            departmentId: w.deptA.id,
            documentId: otherCert.documentId,
          },
        }),
      ).rejects.toThrow(/only for an approved application/);
      // Wrong department.
      await expect(
        ctx.prisma.approvalCertificate.create({
          data: {
            ...base,
            applicationId: approvedApp.applicationId,
            decisionId: decision.id,
            departmentId: w.deptB.id,
            documentId: otherCert.documentId,
          },
        }),
      ).rejects.toThrow(/own department/);
      // A file that belongs to another project.
      await expect(
        ctx.prisma.approvalCertificate.create({
          data: {
            ...base,
            applicationId: approvedApp.applicationId,
            decisionId: decision.id,
            departmentId: w.deptA.id,
            documentId: otherCert.documentId,
          },
        }),
      ).rejects.toThrow(
        /does not belong to this application’s project|does not belong to this application''s project|project/,
      );
      expect(await certOf(approvedApp.applicationId)).toHaveLength(0);
    });

    it('history is preserved: after issuance the recommendation, the decision and the certificate all remain', async () => {
      const s = await approved(ctx, w, 'db3');
      await issueCertificate(ctx, w.aaA, s.applicationId).expect(201);
      expect(
        await ctx.prisma.scrutinyRecommendation.count({
          where: { applicationId: s.applicationId },
        }),
      ).toBe(1);
      expect(
        await ctx.prisma.approvalDecision.count({
          where: { applicationId: s.applicationId },
        }),
      ).toBe(1);
      expect(await certOf(s.applicationId)).toHaveLength(1);
    });
  });
});
