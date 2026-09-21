import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { RepresentativeScope } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { EnterpriseAccessLevel } from './constants/representative-scope.constant';
import { EnterpriseAccessService } from './enterprise-access.service';

const OWNER = '00000000-0000-4000-8000-0000000000a1';
const REP = '00000000-0000-4000-8000-0000000000b2';
const ENTERPRISE = '00000000-0000-4000-8000-0000000000c3';
const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const FUTURE = new Date(Date.now() + 3_600_000);
const PAST = new Date(Date.now() - 60_000);

const enterprise = { id: ENTERPRISE, ownerUserId: OWNER, name: 'Acme' };

function build(
  records: Array<{
    scope: RepresentativeScope;
    scopedProjectIds?: string[];
    status?: string;
    expiresAt?: Date | null;
  }>,
  found: object | null = enterprise,
) {
  const findMany = jest.fn().mockResolvedValue(
    records.map((r) => ({
      status: 'ACTIVE',
      expiresAt: null,
      scopedProjectIds: [],
      ...r,
    })),
  );
  const prisma = {
    enterprise: { findUnique: jest.fn().mockResolvedValue(found) },
    enterpriseRepresentative: { findMany },
  } as unknown as PrismaService;
  return { service: new EnterpriseAccessService(prisma), prisma, findMany };
}

describe('EnterpriseAccessService', () => {
  describe('no live relationship -> 404 (never reveals the enterprise exists)', () => {
    it('unknown enterprise', async () => {
      const { service } = build([], null);
      await expect(
        service.assertAccess(REP, ENTERPRISE, 'VIEW_ONLY'),
      ).rejects.toThrow(NotFoundException);
    });

    it('malformed id is a 404, not a database error', async () => {
      const { service, prisma } = build([]);
      await expect(
        service.assertAccess(REP, 'not-a-uuid', 'VIEW_ONLY'),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.enterprise.findUnique).not.toHaveBeenCalled();
    });

    it('a stranger with no authorisation', async () => {
      const { service } = build([]);
      await expect(
        service.assertAccess(REP, ENTERPRISE, 'VIEW_ONLY'),
      ).rejects.toThrow(NotFoundException);
    });

    it('an authorisation whose expiry has passed', async () => {
      const { service } = build([{ scope: 'FULL', expiresAt: PAST }]);
      await expect(
        service.assertAccess(REP, ENTERPRISE, 'VIEW_ONLY'),
      ).rejects.toThrow(NotFoundException);
    });

    it('only ACTIVE records are ever considered (PENDING/REVOKED are excluded by the query itself)', async () => {
      const { service, findMany } = build([]);
      await service.resolve(REP, ENTERPRISE);
      expect(findMany).toHaveBeenCalledWith({
        where: {
          enterpriseId: ENTERPRISE,
          representativeUserId: REP,
          status: 'ACTIVE',
        },
      });
    });
  });

  describe('owner', () => {
    it.each([
      'OWNER',
      'VIEW_ONLY',
      'PREPARE_SUBMIT',
      'FULL',
    ] as EnterpriseAccessLevel[])(
      'satisfies %s without consulting representative records',
      async (level) => {
        const { service, findMany } = build([]);
        const access = await service.assertAccess(OWNER, ENTERPRISE, level);
        expect(access.relation).toBe('OWNER');
        expect(findMany).not.toHaveBeenCalled();
      },
    );
  });

  describe('representative scope matrix (FRD §20.3)', () => {
    const matrix: Array<[RepresentativeScope, EnterpriseAccessLevel, boolean]> =
      [
        ['VIEW_ONLY', 'VIEW_ONLY', true],
        ['VIEW_ONLY', 'PREPARE_SUBMIT', false],
        ['VIEW_ONLY', 'FULL', false],
        ['VIEW_ONLY', 'OWNER', false],
        ['PREPARE_SUBMIT', 'VIEW_ONLY', true],
        ['PREPARE_SUBMIT', 'PREPARE_SUBMIT', true],
        ['PREPARE_SUBMIT', 'FULL', false],
        ['PREPARE_SUBMIT', 'OWNER', false],
        ['FULL', 'VIEW_ONLY', true],
        ['FULL', 'PREPARE_SUBMIT', true],
        ['FULL', 'FULL', true],
        // Even full delegation can never edit the enterprise profile or
        // authorise other representatives.
        ['FULL', 'OWNER', false],
      ];

    it.each(matrix)(
      'held %s, required %s -> allowed=%s',
      async (scope, required, allowed) => {
        const { service } = build([{ scope }]);
        const result = service.assertAccess(REP, ENTERPRISE, required);
        if (allowed) {
          await expect(result).resolves.toMatchObject({
            relation: 'REPRESENTATIVE',
            scope,
          });
        } else {
          const error = await result.catch((e: unknown) => e);
          expect(error).toBeInstanceOf(ForbiddenException);
          expect((error as ForbiddenException).getResponse()).toMatchObject({
            code: 'FORBIDDEN_SCOPE',
          });
        }
      },
    );

    it('an unexpired time-bound authorisation still works', async () => {
      const { service } = build([{ scope: 'FULL', expiresAt: FUTURE }]);
      await expect(
        service.assertAccess(REP, ENTERPRISE, 'FULL'),
      ).resolves.toBeDefined();
    });
  });

  describe('project restriction', () => {
    it('may view the enterprise itself (context) but not do more at enterprise level', async () => {
      const { service } = build([{ scope: 'FULL', scopedProjectIds: [P1] }]);
      await expect(
        service.assertAccess(REP, ENTERPRISE, 'VIEW_ONLY'),
      ).resolves.toBeDefined();
      await expect(
        service.assertAccess(REP, ENTERPRISE, 'PREPARE_SUBMIT'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('may act on a project inside the list, at or below their scope', async () => {
      const { service } = build([
        { scope: 'PREPARE_SUBMIT', scopedProjectIds: [P1] },
      ]);
      await expect(
        service.assertAccess(REP, ENTERPRISE, 'PREPARE_SUBMIT', P1),
      ).resolves.toBeDefined();
      await expect(
        service.assertAccess(REP, ENTERPRISE, 'VIEW_ONLY', P1),
      ).resolves.toBeDefined();
    });

    it('is denied on a project outside the list, even for view', async () => {
      const { service } = build([{ scope: 'FULL', scopedProjectIds: [P1] }]);
      await expect(
        service.assertAccess(REP, ENTERPRISE, 'VIEW_ONLY', P2),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        service.assertAccess(REP, ENTERPRISE, 'PREPARE_SUBMIT', P2),
      ).rejects.toThrow(ForbiddenException);
    });

    it('scope still applies inside the project list', async () => {
      const { service } = build([
        { scope: 'VIEW_ONLY', scopedProjectIds: [P1] },
      ]);
      await expect(
        service.assertAccess(REP, ENTERPRISE, 'PREPARE_SUBMIT', P1),
      ).rejects.toThrow(ForbiddenException);
    });

    it('an unrestricted authorisation covers every project', async () => {
      const { service } = build([
        { scope: 'PREPARE_SUBMIT', scopedProjectIds: [] },
      ]);
      await expect(
        service.assertAccess(REP, ENTERPRISE, 'PREPARE_SUBMIT', P2),
      ).resolves.toBeDefined();
    });
  });
});
