import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { EnterpriseAccess } from './interfaces/enterprise-access.interface';
import { RepresentativesService } from './representatives.service';

const OWNER = '00000000-0000-4000-8000-0000000000a1';
const REP = '00000000-0000-4000-8000-0000000000b2';
const ENTERPRISE = '00000000-0000-4000-8000-0000000000c3';
const AUTH_ID = '00000000-0000-4000-8000-0000000000d4';
const FUTURE = new Date(Date.now() + 3_600_000);
const PAST = new Date(Date.now() - 60_000);

const access = {
  relation: 'OWNER',
  enterprise: { id: ENTERPRISE, ownerUserId: OWNER },
  scopedProjectIds: [],
} as unknown as EnterpriseAccess;

function record(overrides: Record<string, unknown> = {}) {
  return {
    id: AUTH_ID,
    enterpriseId: ENTERPRISE,
    representativeUserId: REP,
    scope: 'PREPARE_SUBMIT',
    scopedProjectIds: [],
    status: 'ACTIVE',
    authorisedAt: new Date(),
    expiresAt: null,
    revokedAt: null,
    createdAt: new Date(),
    representative: { name: 'Rep' },
    enterprise: {
      id: ENTERPRISE,
      name: 'Acme',
      referenceNumber: 'ENT-2026-000001',
    },
    ...overrides,
  };
}

function build(
  opts: {
    existing?: object | null;
    updateCount?: number;
    targetUser?: object | null;
  } = {},
) {
  const repo = {
    findFirst: jest
      .fn()
      .mockResolvedValue(
        opts.existing === undefined ? record() : opts.existing,
      ),
    findUnique: jest.fn().mockResolvedValue(record()),
    findUniqueOrThrow: jest.fn().mockResolvedValue(record()),
    updateMany: jest.fn().mockResolvedValue({ count: opts.updateCount ?? 1 }),
    create: jest
      .fn()
      .mockResolvedValue(record({ status: 'PENDING', authorisedAt: null })),
  };
  const tx = {
    $executeRaw: jest.fn().mockResolvedValue([]),
    enterpriseRepresentative: {
      ...repo,
      findFirst: jest.fn().mockResolvedValue(null),
    },
  };
  const prisma = {
    enterpriseRepresentative: repo,
    project: { count: jest.fn().mockResolvedValue(0) },
    $transaction: jest.fn((fn: (t: unknown) => unknown) => fn(tx)),
  } as unknown as PrismaService;
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const users = {
    findByEmailOrMobile: jest
      .fn()
      .mockResolvedValue(
        opts.targetUser === undefined
          ? { id: REP, isActive: true }
          : opts.targetUser,
      ),
  } as unknown as UsersService;
  const notifications = {
    representativeAuthorisationRequested: jest
      .fn()
      .mockResolvedValue(undefined),
  };
  return {
    notifications,
    service: new RepresentativesService(
      prisma,
      audit as unknown as AuditService,
      users,
      notifications as never,
    ),
    repo,
    tx,
    audit,
    users,
  };
}

const codeOf = (e: unknown) =>
  (e as { getResponse: () => { code: string } }).getResponse().code;

describe('RepresentativesService', () => {
  describe('authorise', () => {
    it('always creates a PENDING record — status is never set by the grant', async () => {
      const { service, tx } = build();
      await service.authorise(
        access,
        OWNER,
        { emailOrMobile: 'r@example.com', scope: 'FULL' },
        '1.1.1.1',
      );
      const data = tx.enterpriseRepresentative.create.mock.calls[0][0].data;
      expect(data).not.toHaveProperty('status');
      expect(data).not.toHaveProperty('authorisedAt');
    });

    it('rejects an unknown or deactivated user with REPRESENTATIVE_USER_NOT_FOUND', async () => {
      for (const targetUser of [null, { id: REP, isActive: false }]) {
        const { service } = build({ targetUser });
        const error = await service
          .authorise(
            access,
            OWNER,
            { emailOrMobile: 'x@example.com', scope: 'FULL' },
            'ip',
          )
          .catch((e: unknown) => e);
        expect(error).toBeInstanceOf(NotFoundException);
        expect(codeOf(error)).toBe('REPRESENTATIVE_USER_NOT_FOUND');
      }
    });

    it('does not let the owner authorise themselves', async () => {
      const { service } = build({ targetUser: { id: OWNER, isActive: true } });
      const error = await service
        .authorise(
          access,
          OWNER,
          { emailOrMobile: 'me@example.com', scope: 'FULL' },
          'ip',
        )
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(BadRequestException);
      expect(codeOf(error)).toBe('CANNOT_AUTHORISE_SELF');
    });

    it('rejects an expiry in the past', async () => {
      const { service } = build();
      const error = await service
        .authorise(
          access,
          OWNER,
          { emailOrMobile: 'r@example.com', scope: 'FULL', expiresAt: PAST },
          'ip',
        )
        .catch((e: unknown) => e);
      expect(codeOf(error)).toBe('INVALID_EXPIRY');
    });

    it('rejects projects that do not belong to the enterprise', async () => {
      const { service } = build();
      const error = await service
        .authorise(
          access,
          OWNER,
          {
            emailOrMobile: 'r@example.com',
            scope: 'FULL',
            projectIds: ['3f9c1f0e-6b1d-4c53-9d0a-5b8a2f7e1c11'],
          },
          'ip',
        )
        .catch((e: unknown) => e);
      expect(codeOf(error)).toBe('INVALID_PROJECT_SCOPE');
    });

    it('serialises concurrent grants with an advisory lock and rejects a live duplicate', async () => {
      const { service, tx } = build();
      tx.enterpriseRepresentative.findFirst.mockResolvedValue({
        id: 'existing',
      });
      const error = await service
        .authorise(
          access,
          OWNER,
          { emailOrMobile: 'r@example.com', scope: 'FULL' },
          'ip',
        )
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ConflictException);
      expect(codeOf(error)).toBe('REPRESENTATIVE_ALREADY_AUTHORISED');
      expect(tx.$executeRaw).toHaveBeenCalled();
      expect(tx.enterpriseRepresentative.create).not.toHaveBeenCalled();
    });
  });

  describe('accept (two-sided consent)', () => {
    it('activates a PENDING authorisation and audits it under the representative', async () => {
      const { service, repo, audit } = build({
        existing: record({ status: 'PENDING', authorisedAt: null }),
      });
      await service.accept(REP, AUTH_ID, 'ip');
      const update = repo.updateMany.mock.calls[0][0];
      expect(update.where).toMatchObject({
        id: AUTH_ID,
        representativeUserId: REP,
        status: 'PENDING',
      });
      expect(update.data.status).toBe('ACTIVE');
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: REP,
          action: 'REPRESENTATIVE_AUTHORISATION_ACCEPTED',
        }),
      );
    });

    it('is a 404 for anyone other than the named representative (lookup is keyed on their own id)', async () => {
      const { service, repo } = build({ existing: null });
      await expect(
        service.accept('someone-else', AUTH_ID, 'ip'),
      ).rejects.toThrow(NotFoundException);
      expect(repo.findFirst.mock.calls[0][0].where).toEqual({
        id: AUTH_ID,
        representativeUserId: 'someone-else',
      });
    });

    it.each([
      ['REVOKED', null, 'AUTHORISATION_REVOKED'],
      ['ACTIVE', null, 'AUTHORISATION_ALREADY_ACTIVE'],
      ['PENDING', PAST, 'AUTHORISATION_EXPIRED'],
    ])(
      'refuses a %s authorisation (expiry %s) with %s',
      async (status, expiresAt, code) => {
        const { service, repo } = build({
          existing: record({ status, expiresAt }),
        });
        const error = await service
          .accept(REP, AUTH_ID, 'ip')
          .catch((e: unknown) => e);
        expect(error).toBeInstanceOf(ConflictException);
        expect(codeOf(error)).toBe(code);
        expect(repo.updateMany).not.toHaveBeenCalled();
      },
    );

    it('reports why when it loses a race (revoked between the read and the atomic claim)', async () => {
      const { service, repo } = build({
        existing: record({ status: 'PENDING', authorisedAt: null }),
        updateCount: 0,
      });
      repo.findUnique.mockResolvedValue(record({ status: 'REVOKED' }));
      const error = await service
        .accept(REP, AUTH_ID, 'ip')
        .catch((e: unknown) => e);
      expect(codeOf(error)).toBe('AUTHORISATION_REVOKED');
    });
  });

  describe('update (owner changes scope)', () => {
    it('sends an ACTIVE authorisation back to PENDING when the scope is increased', async () => {
      const { service, repo, audit } = build({
        existing: record({ scope: 'VIEW_ONLY' }),
      });
      await service.update(access, AUTH_ID, OWNER, { scope: 'FULL' }, 'ip');
      const data = repo.updateMany.mock.calls[0][0].data;
      expect(data).toMatchObject({
        scope: 'FULL',
        status: 'PENDING',
        authorisedAt: null,
      });
      expect(
        audit.record.mock.calls[0][0].afterState.requiresReAcceptance,
      ).toBe(true);
    });

    it('keeps an ACTIVE authorisation ACTIVE when the scope is reduced (takes effect immediately)', async () => {
      const { service, repo } = build({ existing: record({ scope: 'FULL' }) });
      await service.update(
        access,
        AUTH_ID,
        OWNER,
        { scope: 'VIEW_ONLY' },
        'ip',
      );
      const data = repo.updateMany.mock.calls[0][0].data;
      expect(data.scope).toBe('VIEW_ONLY');
      expect(data).not.toHaveProperty('status');
    });

    it('does not require re-acceptance for an expiry-only change', async () => {
      const { service, repo } = build({ existing: record() });
      await service.update(access, AUTH_ID, OWNER, { expiresAt: FUTURE }, 'ip');
      expect(repo.updateMany.mock.calls[0][0].data).not.toHaveProperty(
        'status',
      );
    });

    it('refuses to modify a revoked authorisation', async () => {
      const { service, repo } = build({
        existing: record({ status: 'REVOKED' }),
      });
      const error = await service
        .update(access, AUTH_ID, OWNER, { scope: 'FULL' }, 'ip')
        .catch((e: unknown) => e);
      expect(codeOf(error)).toBe('AUTHORISATION_REVOKED');
      expect(repo.updateMany).not.toHaveBeenCalled();
    });

    it('never touches a record revoked concurrently (the write is conditional on status != REVOKED)', async () => {
      const { service, repo } = build({
        existing: record({ scope: 'VIEW_ONLY' }),
        updateCount: 0,
      });
      const error = await service
        .update(access, AUTH_ID, OWNER, { scope: 'FULL' }, 'ip')
        .catch((e: unknown) => e);
      expect(repo.updateMany.mock.calls[0][0].where).toEqual({
        id: AUTH_ID,
        status: { not: 'REVOKED' },
      });
      expect(codeOf(error)).toBe('AUTHORISATION_REVOKED');
    });

    it('only finds authorisations of THIS enterprise (an id from another enterprise is a 404)', async () => {
      const { service, repo } = build({ existing: null });
      await expect(
        service.update(access, AUTH_ID, OWNER, { scope: 'FULL' }, 'ip'),
      ).rejects.toThrow(NotFoundException);
      expect(repo.findFirst.mock.calls[0][0].where).toEqual({
        id: AUTH_ID,
        enterpriseId: ENTERPRISE,
      });
    });

    it('requires at least one field', async () => {
      const { service } = build();
      const error = await service
        .update(access, AUTH_ID, OWNER, {}, 'ip')
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(BadRequestException);
    });
  });

  describe('revoke', () => {
    it('marks REVOKED with a timestamp and audits once', async () => {
      const { service, repo, audit } = build();
      await service.revoke(access, AUTH_ID, OWNER, 'ip');
      const update = repo.updateMany.mock.calls[0][0];
      expect(update.data.status).toBe('REVOKED');
      expect(update.data.revokedAt).toBeInstanceOf(Date);
      expect(audit.record).toHaveBeenCalledTimes(1);
      expect(audit.record.mock.calls[0][0].action).toBe(
        'REPRESENTATIVE_AUTHORISATION_REVOKED',
      );
    });

    it('is idempotent: revoking an already-revoked authorisation adds no second audit entry', async () => {
      const { service, audit } = build({
        existing: record({ status: 'REVOKED' }),
        updateCount: 0,
      });
      await expect(
        service.revoke(access, AUTH_ID, OWNER, 'ip'),
      ).resolves.toBeDefined();
      expect(audit.record).not.toHaveBeenCalled();
    });
  });
});

describe('RepresentativesService: notifying the representative (FRD 20.2)', () => {
  it('tells the invited representative once the offer is made (they must accept; nothing is granted)', async () => {
    const { service, notifications } = build();
    await service.authorise(
      access,
      OWNER,
      { emailOrMobile: 'r@example.com', scope: 'FULL' },
      '1.1.1.1',
    );
    expect(
      notifications.representativeAuthorisationRequested,
    ).toHaveBeenCalledTimes(1);
  });

  it('does not notify when the offer is refused', async () => {
    const { service, notifications } = build({ targetUser: null });
    await expect(
      service.authorise(
        access,
        OWNER,
        { emailOrMobile: 'nobody@example.com', scope: 'FULL' },
        'ip',
      ),
    ).rejects.toBeDefined();
    expect(
      notifications.representativeAuthorisationRequested,
    ).not.toHaveBeenCalled();
  });

  it('asks for fresh consent again when an accepted authorisation is WIDENED, and not when it is narrowed', async () => {
    const widened = build({ existing: record({ scope: 'VIEW_ONLY' }) });
    await widened.service.update(
      access,
      AUTH_ID,
      OWNER,
      { scope: 'FULL' },
      'ip',
    );
    expect(
      widened.notifications.representativeAuthorisationRequested,
    ).toHaveBeenCalledWith(AUTH_ID, expect.any(Date));
    const narrowed = build({ existing: record({ scope: 'FULL' }) });
    await narrowed.service.update(
      access,
      AUTH_ID,
      OWNER,
      { scope: 'VIEW_ONLY' },
      'ip',
    );
    expect(
      narrowed.notifications.representativeAuthorisationRequested,
    ).not.toHaveBeenCalled();
  });
});
