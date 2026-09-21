import { randomUUID } from 'node:crypto';
import request from 'supertest';
import {
  STORAGE_SERVICE,
  StorageService,
} from '../src/infrastructure/storage/storage.interface';
import { API, E2eContext, createE2eContext } from './support/e2e-helpers';
import { eicarPdf, pdfBytes } from './support/document-fixtures';

jest.setTimeout(300_000);

type Scope = 'VIEW_ONLY' | 'PREPARE_SUBMIT' | 'FULL';
interface Actor {
  user: { id: string; email: string; mobile: string };
  accessToken: string;
}

/**
 * Who may do what with an application's documents, through the EXISTING
 * EnterpriseAccessGuard — no second authorisation system. Real HTTP -> Nest
 * -> Prisma -> PostgreSQL -> local storage.
 *
 *   read   (list, requirements, get, versions, download) : owner, or any live
 *                                                           representative scope
 *   write  (upload, replace)                              : owner, or a live
 *                                                           PREPARE_SUBMIT / FULL representative
 *   PENDING / REVOKED / expired / stranger                : nothing (404)
 *   project-restricted representatives                    : only their listed projects
 *
 * Every denial must also leave storage, documents and audit untouched.
 */
describe('Documents e2e — authorisation, representative scopes, project restrictions, isolation', () => {
  let ctx: E2eContext;
  let owner: Actor;
  let owner2: Actor;
  let repFull: Actor;
  let repPrepare: Actor;
  let repView: Actor;
  let repRestricted: Actor;
  let stranger: Actor;
  let approvalA: string;
  let approvalB: string;
  let storage: StorageService;
  let putSpy: jest.SpyInstance;

  const as = (token: string) => ({
    get: (p: string) =>
      request(ctx.http)
        .get(`${API}${p}`)
        .set('Authorization', `Bearer ${token}`),
    post: (p: string) =>
      request(ctx.http)
        .post(`${API}${p}`)
        .set('Authorization', `Bearer ${token}`),
    put: (p: string) =>
      request(ctx.http)
        .put(`${API}${p}`)
        .set('Authorization', `Bearer ${token}`),
    patch: (p: string) =>
      request(ctx.http)
        .patch(`${API}${p}`)
        .set('Authorization', `Bearer ${token}`),
    del: (p: string) =>
      request(ctx.http)
        .delete(`${API}${p}`)
        .set('Authorization', `Bearer ${token}`),
  });

  const setup = async (tag: string, by: Actor = owner) => {
    const enterpriseId = (await ctx.createEnterprise(by.accessToken, tag)).id;
    const p1 = (
      await ctx.createProjectVia(by.accessToken, enterpriseId, `${tag}-1`)
    ).id;
    const p2 = (
      await ctx.createProjectVia(by.accessToken, enterpriseId, `${tag}-2`)
    ).id;
    return { enterpriseId, p1, p2 };
  };
  const grant = (
    enterpriseId: string,
    body: Record<string, unknown>,
    by: Actor = owner,
  ) =>
    as(by.accessToken)
      .post(`/enterprises/${enterpriseId}/representatives`)
      .send(body);
  const accept = (authId: string, by: Actor) =>
    as(by.accessToken).post(`/representative-authorisations/${authId}/accept`);
  const activate = async (
    enterpriseId: string,
    rep: Actor,
    scope: Scope,
    extra: Record<string, unknown> = {},
  ) => {
    const granted = await grant(enterpriseId, {
      emailOrMobile: rep.user.email,
      scope,
      ...extra,
    }).expect(201);
    await accept(granted.body.id, rep).expect(200);
    return granted.body.id as string;
  };

  const appBase = (e: string, p: string, a: string) =>
    `/enterprises/${e}/projects/${p}/applications/${a}`;
  const docsUrl = (e: string, p: string, a: string, suffix = '') =>
    `${appBase(e, p, a)}/documents${suffix}`;

  /** Owner-created application (approval A) with one uploaded document. */
  const ownerDoc = async (
    enterpriseId: string,
    projectId: string,
    approvalTypeId = approvalA,
  ) => {
    const snapshotId = await ctx.discover(
      owner.accessToken,
      enterpriseId,
      projectId,
    );
    const app = await as(owner.accessToken)
      .post(`/enterprises/${enterpriseId}/projects/${projectId}/applications`)
      .send({ approvalTypeId, discoverySnapshotId: snapshotId })
      .expect(201);
    const applicationId = app.body.id as string;
    const doc = await ctx
      .uploadDocument(
        owner.accessToken,
        enterpriseId,
        projectId,
        applicationId,
        pdfBytes(),
      )
      .expect(201);
    return {
      snapshotId,
      applicationId,
      documentId: doc.body.id as string,
      lineageId: doc.body.lineageId as string,
    };
  };
  const dbDoc = (id: string) =>
    ctx.prisma.document.findUniqueOrThrow({ where: { id } });
  const docCount = (applicationId: string) =>
    ctx.prisma.applicationDocument.count({ where: { applicationId } });
  const auditCount = (entityIds: string[]) =>
    ctx.prisma.auditLog.count({ where: { entityId: { in: entityIds } } });

  beforeAll(async () => {
    ctx = await createE2eContext();
    [owner, owner2, repFull, repPrepare, repView, repRestricted, stranger] =
      await Promise.all([
        ctx.applicantSession('da-owner'),
        ctx.applicantSession('da-owner2'),
        ctx.applicantSession('da-full'),
        ctx.applicantSession('da-prepare'),
        ctx.applicantSession('da-view'),
        ctx.applicantSession('da-restricted'),
        ctx.applicantSession('da-stranger'),
      ]);
    approvalA = (await ctx.createStartableApproval(owner.user.id, 'dx-a'))
      .approvalTypeId;
    approvalB = (await ctx.createStartableApproval(owner.user.id, 'dx-b'))
      .approvalTypeId;
    storage = ctx.app.get<StorageService>(STORAGE_SERVICE);
  });

  beforeEach(() => {
    putSpy = jest.spyOn(storage, 'put');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await ctx.cleanup();
    await ctx.app.close();
  });

  // -------------------------------------------------------------------------
  describe('scope × operation', () => {
    const actorFor = (scope: Scope) =>
      ({ VIEW_ONLY: repView, PREPARE_SUBMIT: repPrepare, FULL: repFull })[
        scope
      ];
    const expected: Record<
      Scope,
      { write: number; read: number; download: number }
    > = {
      VIEW_ONLY: { write: 403, read: 200, download: 200 },
      PREPARE_SUBMIT: { write: 201, read: 200, download: 200 },
      FULL: { write: 201, read: 200, download: 200 },
    };

    it.each(['VIEW_ONLY', 'PREPARE_SUBMIT', 'FULL'] as Scope[])(
      'a %s representative can do exactly what that scope allows',
      async (scope) => {
        const { enterpriseId, p1 } = await setup(`matrix-${scope}`);
        const actor = actorFor(scope);
        await activate(enterpriseId, actor, scope);
        const { applicationId, documentId } = await ownerDoc(enterpriseId, p1);
        const want = expected[scope];
        const rep = as(actor.accessToken);
        const base = docsUrl(enterpriseId, p1, applicationId);

        // reads
        const list = await rep.get(base);
        expect(list.status).toBe(want.read);
        expect(list.body.map((d: { id: string }) => d.id)).toContain(
          documentId,
        );
        expect((await rep.get(`${base}/${documentId}`)).status).toBe(want.read);
        expect((await rep.get(`${base}/${documentId}/versions`)).status).toBe(
          want.read,
        );
        expect(
          (
            await rep.get(
              `${appBase(enterpriseId, p1, applicationId)}/document-requirements`,
            )
          ).status,
        ).toBe(want.read);
        const dl = await rep.get(`${base}/${documentId}/download`);
        expect(dl.status).toBe(want.download);

        // writes
        const before = await docCount(applicationId);
        const events = await auditCount([applicationId, documentId]);
        putSpy.mockClear();
        const upload = await ctx.uploadDocument(
          actor.accessToken,
          enterpriseId,
          p1,
          applicationId,
          pdfBytes(),
        );
        expect(upload.status).toBe(want.write);
        const replaceRes = await ctx.uploadDocument(
          actor.accessToken,
          enterpriseId,
          p1,
          applicationId,
          pdfBytes(),
          { path: `documents/${documentId}/replace` },
        );
        expect(replaceRes.status).toBe(want.write);

        if (want.write === 403) {
          expect(upload.body.error.code).toBe('FORBIDDEN_SCOPE');
          expect(replaceRes.body.error.code).toBe('FORBIDDEN_SCOPE');
          // A denied write persists nothing and never reaches storage.
          expect(putSpy).not.toHaveBeenCalled();
          expect(await docCount(applicationId)).toBe(before);
          expect(await auditCount([applicationId, documentId])).toBe(events);
        } else {
          expect(upload.body.uploadedByUserId).toBe(actor.user.id);
          expect(replaceRes.body.uploadedByUserId).toBe(actor.user.id);
          expect(replaceRes.body.previousVersionId).toBe(documentId);
          expect(await docCount(applicationId)).toBe(before + 2);
        }
      },
    );

    it('a representative’s upload, replacement and download are attributed to the representative (FRD §20.5)', async () => {
      const { enterpriseId, p1 } = await setup('rep-audit');
      await activate(enterpriseId, repPrepare, 'PREPARE_SUBMIT');
      const { applicationId } = await ownerDoc(enterpriseId, p1);
      const rep = repPrepare.accessToken;

      const v1 = await ctx
        .uploadDocument(rep, enterpriseId, p1, applicationId, pdfBytes())
        .expect(201);
      const v2 = await ctx
        .uploadDocument(rep, enterpriseId, p1, applicationId, pdfBytes(), {
          path: `documents/${v1.body.id}/replace`,
        })
        .expect(201);
      await as(rep)
        .get(
          docsUrl(enterpriseId, p1, applicationId, `/${v2.body.id}/download`),
        )
        .expect(200);

      const events = await ctx.prisma.auditLog.findMany({
        where: { entityId: { in: [v1.body.id, v2.body.id] } },
      });
      expect(events.map((e) => e.action).sort()).toEqual(
        [
          'DOCUMENT_ASSOCIATED',
          'DOCUMENT_ASSOCIATED',
          'DOCUMENT_DOWNLOADED',
          'DOCUMENT_REPLACED',
          'DOCUMENT_SCAN_COMPLETED',
          'DOCUMENT_SCAN_COMPLETED',
          'DOCUMENT_UPLOADED',
          'DOCUMENT_UPLOADED',
        ].sort(),
      );
      for (const e of events) {
        expect(e.userId).toBe(repPrepare.user.id);
        expect(e.afterState).toMatchObject({
          enterpriseId,
          projectId: p1,
          applicationId,
          actingAs: 'REPRESENTATIVE',
          representativeScope: 'PREPARE_SUBMIT',
        });
      }
    });

    it('a representative’s infected upload is rejected and attributed to them', async () => {
      const { enterpriseId, p1 } = await setup('rep-infected');
      await activate(enterpriseId, repFull, 'FULL');
      const { applicationId } = await ownerDoc(enterpriseId, p1);
      putSpy.mockClear();
      const res = await ctx
        .uploadDocument(
          repFull.accessToken,
          enterpriseId,
          p1,
          applicationId,
          eicarPdf(),
        )
        .expect(422);
      expect(res.body.error.code).toBe('MALWARE_DETECTED');
      expect(putSpy).not.toHaveBeenCalled();
      const event = await ctx.prisma.auditLog.findFirstOrThrow({
        where: { entityId: applicationId, action: 'DOCUMENT_SCAN_REJECTED' },
      });
      expect(event.userId).toBe(repFull.user.id);
      expect(event.afterState).toMatchObject({
        actingAs: 'REPRESENTATIVE',
        representativeScope: 'FULL',
        stored: false,
      });
    });

    it('an owner can read and download what a representative uploaded, and vice versa', async () => {
      const { enterpriseId, p1 } = await setup('shared');
      await activate(enterpriseId, repPrepare, 'PREPARE_SUBMIT');
      const { applicationId } = await ownerDoc(enterpriseId, p1);
      const bytes = pdfBytes('rep-made');
      const made = await ctx
        .uploadDocument(
          repPrepare.accessToken,
          enterpriseId,
          p1,
          applicationId,
          bytes,
        )
        .expect(201);
      const seen = await as(owner.accessToken)
        .get(
          docsUrl(enterpriseId, p1, applicationId, `/${made.body.id}/download`),
        )
        .buffer(true)
        .parse((r, cb) => {
          const c: Buffer[] = [];
          r.on('data', (x: Buffer) => c.push(x));
          r.on('end', () => cb(null, Buffer.concat(c)));
        })
        .expect(200);
      expect(seen.body).toEqual(bytes);
    });
  });

  // -------------------------------------------------------------------------
  describe('non-live authorisations and strangers: no access at all', () => {
    const expectNoAccess = async (
      actor: Actor,
      enterpriseId: string,
      p1: string,
      applicationId: string,
      documentId: string,
    ) => {
      const a = as(actor.accessToken);
      const base = docsUrl(enterpriseId, p1, applicationId);
      const before = await docCount(applicationId);
      const row = await dbDoc(documentId);
      const events = await auditCount([applicationId, documentId]);
      putSpy.mockClear();

      const responses = [
        await a.get(base),
        await a.get(`${base}/${documentId}`),
        await a.get(`${base}/${documentId}/versions`),
        await a.get(`${base}/${documentId}/download`),
        await a.get(
          `${appBase(enterpriseId, p1, applicationId)}/document-requirements`,
        ),
        await ctx.uploadDocument(
          actor.accessToken,
          enterpriseId,
          p1,
          applicationId,
          pdfBytes(),
        ),
        await ctx.uploadDocument(
          actor.accessToken,
          enterpriseId,
          p1,
          applicationId,
          pdfBytes(),
          { path: `documents/${documentId}/replace` },
        ),
      ];
      for (const res of responses) {
        expect(res.status).toBe(404);
        expect(res.body.error.code).toBe('NOT_FOUND');
        // Not even the stored path can leak through an error.
        expect(JSON.stringify(res.body)).not.toContain(row.filePath);
      }
      // Identical bodies: nothing about the enterprise's existence leaks.
      expect(new Set(responses.map((r) => r.body.error.message)).size).toBe(1);

      expect(putSpy).not.toHaveBeenCalled();
      expect(await docCount(applicationId)).toBe(before);
      expect(await auditCount([applicationId, documentId])).toBe(events);
    };

    it('PENDING (not yet accepted)', async () => {
      const { enterpriseId, p1 } = await setup('pending');
      const d = await ownerDoc(enterpriseId, p1);
      await grant(enterpriseId, {
        emailOrMobile: repFull.user.email,
        scope: 'FULL',
      }).expect(201);
      await expectNoAccess(
        repFull,
        enterpriseId,
        p1,
        d.applicationId,
        d.documentId,
      );
    });

    it('REVOKED — immediately, with the same still-valid access token; the representative’s upload is preserved', async () => {
      const { enterpriseId, p1 } = await setup('revoked');
      const d = await ownerDoc(enterpriseId, p1);
      const authId = await activate(enterpriseId, repFull, 'FULL');
      const made = await ctx
        .uploadDocument(
          repFull.accessToken,
          enterpriseId,
          p1,
          d.applicationId,
          pdfBytes(),
        )
        .expect(201);

      await as(owner.accessToken)
        .del(`/enterprises/${enterpriseId}/representatives/${authId}`)
        .expect(200);
      await expectNoAccess(
        repFull,
        enterpriseId,
        p1,
        d.applicationId,
        made.body.id,
      );

      // FRD §20.4: their work is preserved, and the owner keeps full access to it.
      const kept = await as(owner.accessToken)
        .get(docsUrl(enterpriseId, p1, d.applicationId, `/${made.body.id}`))
        .expect(200);
      expect(kept.body.uploadedByUserId).toBe(repFull.user.id);
      await as(owner.accessToken)
        .get(
          docsUrl(
            enterpriseId,
            p1,
            d.applicationId,
            `/${made.body.id}/download`,
          ),
        )
        .expect(200);
    });

    it('EXPIRED — access ends the moment the expiry passes', async () => {
      const { enterpriseId, p1 } = await setup('expired');
      const d = await ownerDoc(enterpriseId, p1);
      const authId = await activate(enterpriseId, repFull, 'FULL', {
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      });
      await as(repFull.accessToken)
        .get(
          docsUrl(
            enterpriseId,
            p1,
            d.applicationId,
            `/${d.documentId}/download`,
          ),
        )
        .expect(200);

      await ctx.prisma.enterpriseRepresentative.update({
        where: { id: authId },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      await expectNoAccess(
        repFull,
        enterpriseId,
        p1,
        d.applicationId,
        d.documentId,
      );
    });

    it('a stranger with no authorisation', async () => {
      const { enterpriseId, p1 } = await setup('stranger');
      const d = await ownerDoc(enterpriseId, p1);
      await expectNoAccess(
        stranger,
        enterpriseId,
        p1,
        d.applicationId,
        d.documentId,
      );
    });

    it('unauthenticated requests are rejected before any document logic runs', async () => {
      const { enterpriseId, p1 } = await setup('unauth');
      const d = await ownerDoc(enterpriseId, p1);
      const base = `${API}${docsUrl(enterpriseId, p1, d.applicationId)}`;
      putSpy.mockClear();
      await request(ctx.http).get(base).expect(401);
      await request(ctx.http).get(`${base}/${d.documentId}`).expect(401);
      await request(ctx.http)
        .get(`${base}/${d.documentId}/download`)
        .expect(401);
      await request(ctx.http)
        .get(`${base}/${d.documentId}/versions`)
        .expect(401);
      await request(ctx.http)
        .post(base)
        .attach('file', pdfBytes(), 'a.pdf')
        .expect(401);
      await request(ctx.http)
        .post(`${base}/${d.documentId}/replace`)
        .attach('file', pdfBytes(), 'a.pdf')
        .expect(401);
      expect(putSpy).not.toHaveBeenCalled();
      expect(await docCount(d.applicationId)).toBe(1);
    });

    it('a staff-only officer (MFA-verified) cannot use documents even with a representative authorisation (Step 4 RBAC)', async () => {
      const { enterpriseId, p1 } = await setup('officer');
      const d = await ownerDoc(enterpriseId, p1);
      const officer = await ctx.registerWithRole(
        'da-officer',
        'SCRUTINY_OFFICER',
      );
      const granted = await grant(enterpriseId, {
        emailOrMobile: officer.email,
        scope: 'FULL',
      }).expect(201);
      const { accessToken } = await ctx.fullMfaSession(officer);
      await as(accessToken)
        .post(`/representative-authorisations/${granted.body.id}/accept`)
        .expect(200);
      await ctx.prisma.userRole.deleteMany({
        where: { userId: officer.id, role: { code: 'APPLICANT' } },
      });

      putSpy.mockClear();
      const res = await as(accessToken)
        .get(
          docsUrl(
            enterpriseId,
            p1,
            d.applicationId,
            `/${d.documentId}/download`,
          ),
        )
        .expect(403);
      expect(res.body.error.code).toBe('INSUFFICIENT_ROLE');
      await ctx
        .uploadDocument(
          accessToken,
          enterpriseId,
          p1,
          d.applicationId,
          pdfBytes(),
        )
        .expect(403);
      expect(putSpy).not.toHaveBeenCalled();
      expect(await docCount(d.applicationId)).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  describe('scope changes take effect on the very next request', () => {
    it('reducing PREPARE_SUBMIT to VIEW_ONLY stops writing immediately but keeps reading', async () => {
      const { enterpriseId, p1 } = await setup('downgrade');
      const authId = await activate(enterpriseId, repPrepare, 'PREPARE_SUBMIT');
      const d = await ownerDoc(enterpriseId, p1);
      await ctx
        .uploadDocument(
          repPrepare.accessToken,
          enterpriseId,
          p1,
          d.applicationId,
          pdfBytes(),
        )
        .expect(201);

      await as(owner.accessToken)
        .patch(`/enterprises/${enterpriseId}/representatives/${authId}`)
        .send({ scope: 'VIEW_ONLY' })
        .expect(200);
      putSpy.mockClear();
      await ctx
        .uploadDocument(
          repPrepare.accessToken,
          enterpriseId,
          p1,
          d.applicationId,
          pdfBytes(),
        )
        .expect(403);
      expect(putSpy).not.toHaveBeenCalled();
      await as(repPrepare.accessToken)
        .get(docsUrl(enterpriseId, p1, d.applicationId))
        .expect(200);
    });

    it('raising VIEW_ONLY to PREPARE_SUBMIT does nothing until the representative accepts again', async () => {
      const { enterpriseId, p1 } = await setup('upgrade');
      const authId = await activate(enterpriseId, repView, 'VIEW_ONLY');
      const d = await ownerDoc(enterpriseId, p1);
      await as(owner.accessToken)
        .patch(`/enterprises/${enterpriseId}/representatives/${authId}`)
        .send({ scope: 'PREPARE_SUBMIT' })
        .expect(200);
      await as(repView.accessToken)
        .get(docsUrl(enterpriseId, p1, d.applicationId))
        .expect(404); // PENDING: no access at all
      await accept(authId, repView).expect(200);
      await ctx
        .uploadDocument(
          repView.accessToken,
          enterpriseId,
          p1,
          d.applicationId,
          pdfBytes(),
        )
        .expect(201);
    });
  });

  // -------------------------------------------------------------------------
  describe('project-restricted representatives', () => {
    it('may use documents only for their listed project; every other project is the same 403', async () => {
      const { enterpriseId, p1, p2 } = await setup('restricted');
      const foreign = await setup('restricted-foreign', owner2);
      await activate(enterpriseId, repRestricted, 'PREPARE_SUBMIT', {
        projectIds: [p1],
      });
      const d1 = await ownerDoc(enterpriseId, p1);
      const d2 = await ownerDoc(enterpriseId, p2);
      const rep = repRestricted.accessToken;

      // Allowed on p1.
      const made = await ctx
        .uploadDocument(rep, enterpriseId, p1, d1.applicationId, pdfBytes())
        .expect(201);
      await as(rep)
        .get(docsUrl(enterpriseId, p1, d1.applicationId))
        .expect(200);
      await as(rep)
        .get(
          docsUrl(
            enterpriseId,
            p1,
            d1.applicationId,
            `/${made.body.id}/download`,
          ),
        )
        .expect(200);
      await ctx
        .uploadDocument(rep, enterpriseId, p1, d1.applicationId, pdfBytes(), {
          path: `documents/${made.body.id}/replace`,
        })
        .expect(201);

      // Denied on a sibling project, another enterprise's project, and a
      // nonexistent one - identical 403s, so nothing about existence leaks.
      const before2 = await docCount(d2.applicationId);
      putSpy.mockClear();
      const probe = async (project: string, enterprise = enterpriseId) => [
        await as(rep).get(docsUrl(enterprise, project, d2.applicationId)),
        await as(rep).get(
          docsUrl(enterprise, project, d2.applicationId, `/${d2.documentId}`),
        ),
        await as(rep).get(
          docsUrl(
            enterprise,
            project,
            d2.applicationId,
            `/${d2.documentId}/download`,
          ),
        ),
        await as(rep).get(
          docsUrl(
            enterprise,
            project,
            d2.applicationId,
            `/${d2.documentId}/versions`,
          ),
        ),
        await as(rep).get(
          `${appBase(enterprise, project, d2.applicationId)}/document-requirements`,
        ),
        await ctx.uploadDocument(
          rep,
          enterprise,
          project,
          d2.applicationId,
          pdfBytes(),
        ),
        await ctx.uploadDocument(
          rep,
          enterprise,
          project,
          d2.applicationId,
          pdfBytes(),
          {
            path: `documents/${d2.documentId}/replace`,
          },
        ),
      ];
      const sibling = await probe(p2);
      const missing = await probe(randomUUID());
      const alien = await probe(foreign.p1);
      for (const res of [...sibling, ...missing, ...alien]) {
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe('FORBIDDEN_SCOPE');
      }
      expect(missing.map((r) => r.body)).toEqual(sibling.map((r) => r.body));
      expect(alien.map((r) => r.body)).toEqual(sibling.map((r) => r.body));

      expect(putSpy).not.toHaveBeenCalled();
      expect(await docCount(d2.applicationId)).toBe(before2);
    });

    it('a VIEW_ONLY project-restricted representative can read their project’s documents and nothing else', async () => {
      const { enterpriseId, p1, p2 } = await setup('restricted-view');
      await activate(enterpriseId, repRestricted, 'VIEW_ONLY', {
        projectIds: [p1],
      });
      const d1 = await ownerDoc(enterpriseId, p1);
      const d2 = await ownerDoc(enterpriseId, p2);
      const rep = as(repRestricted.accessToken);
      await rep.get(docsUrl(enterpriseId, p1, d1.applicationId)).expect(200);
      await rep
        .get(
          docsUrl(
            enterpriseId,
            p1,
            d1.applicationId,
            `/${d1.documentId}/download`,
          ),
        )
        .expect(200);
      await ctx
        .uploadDocument(
          repRestricted.accessToken,
          enterpriseId,
          p1,
          d1.applicationId,
          pdfBytes(),
        )
        .expect(403);
      await rep.get(docsUrl(enterpriseId, p2, d2.applicationId)).expect(403);
      await rep
        .get(
          docsUrl(
            enterpriseId,
            p2,
            d2.applicationId,
            `/${d2.documentId}/download`,
          ),
        )
        .expect(403);
    });

    it('a document of one project can never be reached through another project’s URL', async () => {
      const { enterpriseId, p1, p2 } = await setup('cross-project');
      await activate(enterpriseId, repRestricted, 'FULL', { projectIds: [p1] });
      const d1 = await ownerDoc(enterpriseId, p1);
      const d2 = await ownerDoc(enterpriseId, p2);

      // p2's application and document ids under p1's URL: they do not exist there.
      for (const token of [owner.accessToken, repRestricted.accessToken]) {
        const a = as(token);
        await a.get(docsUrl(enterpriseId, p1, d2.applicationId)).expect(404);
        await a
          .get(
            docsUrl(
              enterpriseId,
              p1,
              d2.applicationId,
              `/${d2.documentId}/download`,
            ),
          )
          .expect(404);
        // p1's application, but p2's document id.
        await a
          .get(docsUrl(enterpriseId, p1, d1.applicationId, `/${d2.documentId}`))
          .expect(404);
        await a
          .get(
            docsUrl(
              enterpriseId,
              p1,
              d1.applicationId,
              `/${d2.documentId}/download`,
            ),
          )
          .expect(404);
        await a
          .get(
            docsUrl(
              enterpriseId,
              p1,
              d1.applicationId,
              `/${d2.documentId}/versions`,
            ),
          )
          .expect(404);
      }
      putSpy.mockClear();
      await ctx
        .uploadDocument(
          owner.accessToken,
          enterpriseId,
          p1,
          d2.applicationId,
          pdfBytes(),
        )
        .expect(404);
      await ctx
        .uploadDocument(
          repRestricted.accessToken,
          enterpriseId,
          p1,
          d1.applicationId,
          pdfBytes(),
          {
            path: `documents/${d2.documentId}/replace`,
          },
        )
        .expect(404);
      expect(putSpy).not.toHaveBeenCalled();
      expect(await docCount(d2.applicationId)).toBe(1);
    });

    it('an unrestricted representative reaches every project of the enterprise', async () => {
      const { enterpriseId, p1, p2 } = await setup('unrestricted');
      await activate(enterpriseId, repFull, 'FULL');
      const d1 = await ownerDoc(enterpriseId, p1);
      const d2 = await ownerDoc(enterpriseId, p2);
      for (const [p, d] of [
        [p1, d1],
        [p2, d2],
      ] as const) {
        await as(repFull.accessToken)
          .get(
            docsUrl(
              enterpriseId,
              p,
              d.applicationId,
              `/${d.documentId}/download`,
            ),
          )
          .expect(200);
      }
    });
  });

  // -------------------------------------------------------------------------
  describe('ownership is derived from the URL chain, never supplied by the client', () => {
    it('an application under the wrong project or enterprise in the URL is a 404, even for the owner', async () => {
      const a = await setup('chain-a');
      const b = await setup('chain-b');
      const d = await ownerDoc(a.enterpriseId, a.p1);
      putSpy.mockClear();

      // Right enterprise, WRONG project for this application.
      const wrongProject = docsUrl(a.enterpriseId, a.p2, d.applicationId);
      await as(owner.accessToken).get(wrongProject).expect(404);
      await as(owner.accessToken)
        .get(`${wrongProject}/${d.documentId}/download`)
        .expect(404);
      await ctx
        .uploadDocument(
          owner.accessToken,
          a.enterpriseId,
          a.p2,
          d.applicationId,
          pdfBytes(),
        )
        .expect(404);
      // A second enterprise the SAME owner also owns: project / application of
      // enterprise A addressed through enterprise B.
      await as(owner.accessToken)
        .get(docsUrl(b.enterpriseId, a.p1, d.applicationId))
        .expect(404);
      await ctx
        .uploadDocument(
          owner.accessToken,
          b.enterpriseId,
          a.p1,
          d.applicationId,
          pdfBytes(),
        )
        .expect(404);
      await ctx
        .uploadDocument(
          owner.accessToken,
          b.enterpriseId,
          b.p1,
          d.applicationId,
          pdfBytes(),
        )
        .expect(404);
      expect(putSpy).not.toHaveBeenCalled();
      expect(await docCount(d.applicationId)).toBe(1);
    });

    it('ownership / association fields in the request are refused, not trusted', async () => {
      const { enterpriseId, p1, p2 } = await setup('conflict');
      const d = await ownerDoc(enterpriseId, p1);
      const other = await ownerDoc(enterpriseId, p2);
      putSpy.mockClear();
      for (const fields of [
        { applicationId: other.applicationId },
        { projectId: p2 },
        { enterpriseId: randomUUID() },
        { ownerId: p2, ownerType: 'PROJECT' },
        { uploadedBy: repFull.user.id },
        {
          documentRequirementId: randomUUID(),
          applicationId: other.applicationId,
        },
      ]) {
        const res = await ctx.uploadDocument(
          owner.accessToken,
          enterpriseId,
          p1,
          d.applicationId,
          pdfBytes(),
          { fields: fields as unknown as Record<string, string> },
        );
        expect([400, 422]).toContain(res.status);
      }
      expect(putSpy).not.toHaveBeenCalled();
      expect(await docCount(d.applicationId)).toBe(1);
      expect(await docCount(other.applicationId)).toBe(1);
      expect((await dbDoc(d.documentId)).ownerId).toBe(p1);
    });

    it('a document requirement of another approval cannot be used, and the stored owner is always the URL’s project', async () => {
      const { enterpriseId, p1 } = await setup('req-chain');
      const dA = await ownerDoc(enterpriseId, p1, approvalA);
      const foreignRequirement = await ctx.prisma.documentRequirement.create({
        data: {
          approvalTypeId: approvalB,
          name: 'E2E foreign req',
          isMandatory: false,
        },
      });
      const res = await ctx
        .uploadDocument(
          owner.accessToken,
          enterpriseId,
          p1,
          dA.applicationId,
          pdfBytes(),
          {
            fields: { documentRequirementId: foreignRequirement.id },
          },
        )
        .expect(422);
      expect(res.body.error.code).toBe('DOCUMENT_REQUIREMENT_MISMATCH');
      const row = await dbDoc(dA.documentId);
      expect(row.ownerType).toBe('PROJECT');
      expect(row.ownerId).toBe(p1);
    });

    it('a document id of another application in the SAME project cannot be read, replaced or listed', async () => {
      const { enterpriseId, p1 } = await setup('same-project');
      const first = await ownerDoc(enterpriseId, p1, approvalA);
      const second = await ownerDoc(enterpriseId, p1, approvalB);
      putSpy.mockClear();
      const url = (a: string, suffix = '') =>
        docsUrl(enterpriseId, p1, a, suffix);
      await as(owner.accessToken)
        .get(url(first.applicationId, `/${second.documentId}`))
        .expect(404);
      await as(owner.accessToken)
        .get(url(first.applicationId, `/${second.documentId}/download`))
        .expect(404);
      await ctx
        .uploadDocument(
          owner.accessToken,
          enterpriseId,
          p1,
          first.applicationId,
          pdfBytes(),
          {
            path: `documents/${second.documentId}/replace`,
          },
        )
        .expect(404);
      const list = await as(owner.accessToken)
        .get(url(first.applicationId))
        .expect(200);
      expect(list.body.map((x: { id: string }) => x.id)).toEqual([
        first.documentId,
      ]);
      expect(putSpy).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  describe('cross-enterprise isolation', () => {
    it('another enterprise’s owner sees nothing of this enterprise’s documents', async () => {
      const mine = await setup('iso-mine');
      const theirs = await setup('iso-theirs', owner2);
      const d = await ownerDoc(mine.enterpriseId, mine.p1);
      const o2 = as(owner2.accessToken);
      const base = docsUrl(mine.enterpriseId, mine.p1, d.applicationId);
      putSpy.mockClear();

      // Through my enterprise's URL: no relationship at all -> 404.
      for (const res of [
        await o2.get(base),
        await o2.get(`${base}/${d.documentId}`),
        await o2.get(`${base}/${d.documentId}/download`),
        await o2.get(`${base}/${d.documentId}/versions`),
        await ctx.uploadDocument(
          owner2.accessToken,
          mine.enterpriseId,
          mine.p1,
          d.applicationId,
          pdfBytes(),
        ),
        await ctx.uploadDocument(
          owner2.accessToken,
          mine.enterpriseId,
          mine.p1,
          d.applicationId,
          pdfBytes(),
          {
            path: `documents/${d.documentId}/replace`,
          },
        ),
      ]) {
        expect(res.status).toBe(404);
      }

      // Through THEIR enterprise + project, with MY application / document ids.
      const theirs1 = docsUrl(theirs.enterpriseId, theirs.p1, d.applicationId);
      await o2.get(theirs1).expect(404);
      await o2.get(`${theirs1}/${d.documentId}/download`).expect(404);
      await ctx
        .uploadDocument(
          owner2.accessToken,
          theirs.enterpriseId,
          theirs.p1,
          d.applicationId,
          pdfBytes(),
        )
        .expect(404);
      // My project id under THEIR enterprise URL.
      await o2
        .get(docsUrl(theirs.enterpriseId, mine.p1, d.applicationId))
        .expect(404);

      expect(putSpy).not.toHaveBeenCalled();
      expect(await docCount(d.applicationId)).toBe(1);
    });

    it('a representative of one enterprise has no reach into another’s documents', async () => {
      const a = await setup('iso-rep-a');
      const b = await setup('iso-rep-b', owner2);
      await activate(a.enterpriseId, repFull, 'FULL');
      const snapshotId = await ctx.discover(
        owner2.accessToken,
        b.enterpriseId,
        b.p1,
      );
      const app = await as(owner2.accessToken)
        .post(`/enterprises/${b.enterpriseId}/projects/${b.p1}/applications`)
        .send({ approvalTypeId: approvalA, discoverySnapshotId: snapshotId })
        .expect(201);
      const doc = await ctx
        .uploadDocument(
          owner2.accessToken,
          b.enterpriseId,
          b.p1,
          app.body.id,
          pdfBytes(),
        )
        .expect(201);

      const rep = as(repFull.accessToken);
      const bDocs = docsUrl(b.enterpriseId, b.p1, app.body.id);
      await rep.get(bDocs).expect(404);
      await rep.get(`${bDocs}/${doc.body.id}/download`).expect(404);
      await ctx
        .uploadDocument(
          repFull.accessToken,
          b.enterpriseId,
          b.p1,
          app.body.id,
          pdfBytes(),
        )
        .expect(404);
      // ...and through THEIR OWN enterprise, with B's ids.
      await rep.get(docsUrl(a.enterpriseId, a.p1, app.body.id)).expect(404);
      await rep
        .get(
          docsUrl(
            a.enterpriseId,
            a.p1,
            app.body.id,
            `/${doc.body.id}/download`,
          ),
        )
        .expect(404);
    });

    it('document ids cannot be enumerated: every miss looks the same to every caller', async () => {
      const mine = await setup('enum-mine');
      const theirs = await setup('enum-theirs', owner2);
      const d = await ownerDoc(mine.enterpriseId, mine.p1);
      const missing = randomUUID();

      const probes = [
        // The owner: a missing id, and a real id of another enterprise.
        await as(owner.accessToken).get(
          docsUrl(mine.enterpriseId, mine.p1, d.applicationId, `/${missing}`),
        ),
        // A stranger to my enterprise probing a real id and a fake one: identical.
        await as(owner2.accessToken).get(
          docsUrl(
            mine.enterpriseId,
            mine.p1,
            d.applicationId,
            `/${d.documentId}`,
          ),
        ),
        await as(owner2.accessToken).get(
          docsUrl(mine.enterpriseId, mine.p1, d.applicationId, `/${missing}`),
        ),
      ];
      // The two stranger probes are byte-identical; the owner's miss is a
      // document-level 404 in the same envelope.
      expect(probes[1].status).toBe(404);
      expect(probes[1].body).toEqual(probes[2].body);
      expect(probes[0].status).toBe(404);
      expect(probes[0].body.error.code).toBe(probes[1].body.error.code);
      expect(theirs.enterpriseId).toBeDefined();
    });
  });
});
