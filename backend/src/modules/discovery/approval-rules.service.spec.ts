import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ApprovalRulesService } from './approval-rules.service';

const TYPE = '10000000-0000-4000-8000-000000000001';
const AUTHOR = '00000000-0000-4000-8000-0000000000a1';
const GOOD = { field: 'hazardous_flag', op: 'equals', value: true };
const NOW = new Date('2026-09-19T10:00:00Z');

function buildPublish(
  latest: { version: number; effectiveFrom: Date } | null = null,
  typeExists = true,
) {
  const tx = {
    $executeRaw: jest.fn().mockResolvedValue(1),
    approvalRule: {
      findFirst: jest.fn().mockResolvedValue(latest),
      create: jest.fn().mockImplementation(({ data }) =>
        Promise.resolve({
          id: 'rule-id',
          createdAt: NOW,
          effectiveTo: null,
          ...data,
        }),
      ),
    },
  };
  const prisma = {
    approvalType: {
      findUnique: jest.fn().mockResolvedValue(typeExists ? { id: TYPE } : null),
    },
    $transaction: jest.fn((fn: (t: unknown) => unknown) => fn(tx)),
  } as unknown as PrismaService;
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  return {
    service: new ApprovalRulesService(prisma, audit as unknown as AuditService),
    tx,
    audit,
  };
}

const input = (overrides: Record<string, unknown> = {}) => ({
  approvalTypeId: TYPE,
  conditions: GOOD,
  sourceReference: 'Department circular 12/2026',
  createdByUserId: AUTHOR,
  ipAddress: '127.0.0.1',
  ...overrides,
});

const codeOf = (e: unknown) =>
  (e as { getResponse: () => { code: string } }).getResponse().code;
const fieldsOf = (e: unknown) =>
  (
    e as { getResponse: () => { fields: Record<string, string[]> } }
  ).getResponse().fields;

describe('ApprovalRulesService.publishVersion', () => {
  it('creates version 1 for an approval type with no rules, with safe defaults', async () => {
    const { service, tx } = buildPublish(null);
    const rule = await service.publishVersion(input());
    const data = tx.approvalRule.create.mock.calls[0][0].data;
    expect(rule.version).toBe(1);
    expect(data).toMatchObject({
      version: 1,
      isActive: true,
      isOfficiallyRequired: false, // "Potentially Applicable" unless a department says otherwise
      priority: 100,
      createdBy: AUTHOR,
    });
  });

  it('numbers each new version sequentially — never updating an existing row', async () => {
    const { service, tx } = buildPublish({
      version: 4,
      effectiveFrom: new Date('2026-01-01'),
    });
    const rule = await service.publishVersion(
      input({ effectiveFrom: new Date('2026-06-01') }),
    );
    expect(rule.version).toBe(5);
    expect(tx.approvalRule.create).toHaveBeenCalledTimes(1);
    expect(Object.keys(tx)).not.toContain('update');
    expect(Object.keys(tx.approvalRule)).not.toEqual(
      expect.arrayContaining(['update', 'updateMany']),
    );
  });

  it('serialises concurrent publishes for the same approval type with an advisory lock', async () => {
    const { service, tx } = buildPublish();
    await service.publishVersion(input());
    expect(tx.$executeRaw).toHaveBeenCalled();
  });

  it('rejects a new version that would take effect before the previous one did', async () => {
    const { service, tx } = buildPublish({
      version: 2,
      effectiveFrom: new Date('2026-06-01'),
    });
    const error = await service
      .publishVersion(input({ effectiveFrom: new Date('2026-05-31') }))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BadRequestException);
    expect(codeOf(error)).toBe('INVALID_EFFECTIVE_DATES');
    expect(tx.approvalRule.create).not.toHaveBeenCalled();
  });

  it.each([
    ['unknown field', { field: 'made_up', op: 'equals', value: 1 }],
    [
      'unknown operator',
      { field: 'hazardous_flag', op: 'matches', value: true },
    ],
    ['empty all', { all: [] }],
    ['code-like payload', { expr: '1+1' }],
    ['null', null],
  ])(
    'rejects an invalid condition (%s) with INVALID_RULE_DEFINITION and stores nothing',
    async (_n, conditions) => {
      const { service, tx, audit } = buildPublish();
      const error = await service
        .publishVersion(input({ conditions }))
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(BadRequestException);
      expect(codeOf(error)).toBe('INVALID_RULE_DEFINITION');
      expect(fieldsOf(error).conditions.length).toBeGreaterThan(0);
      expect(tx.approvalRule.create).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    },
  );

  it('rejects an invalid excludes_if the same way, naming the right field', async () => {
    const { service } = buildPublish();
    const error = await service
      .publishVersion(
        input({
          excludesIf: { field: 'employment_count', op: 'gt', value: 'many' },
        }),
      )
      .catch((e: unknown) => e);
    expect(codeOf(error)).toBe('INVALID_RULE_DEFINITION');
    expect(Object.keys(fieldsOf(error))).toEqual(['excludesIf']);
  });

  it.each(['', '  ', 'ab', 'x'.repeat(501)])(
    'requires a usable source reference (%p)',
    async (sourceReference) => {
      const { service } = buildPublish();
      await expect(
        service.publishVersion(input({ sourceReference })),
      ).rejects.toThrow(BadRequestException);
    },
  );

  it('accepts the explicit TBD marker for a not-yet-cited rule', async () => {
    const { service } = buildPublish();
    await expect(
      service.publishVersion(input({ sourceReference: 'TBD' })),
    ).resolves.toBeDefined();
  });

  it.each([-1, 1.5, 10_001])('rejects priority %p', async (priority) => {
    const { service } = buildPublish();
    await expect(service.publishVersion(input({ priority }))).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects effectiveTo that is not after effectiveFrom', async () => {
    const { service } = buildPublish();
    const from = new Date('2026-06-01');
    for (const to of [from, new Date('2026-05-01')]) {
      const error = await service
        .publishVersion(input({ effectiveFrom: from, effectiveTo: to }))
        .catch((e: unknown) => e);
      expect(codeOf(error)).toBe('INVALID_EFFECTIVE_DATES');
    }
  });

  it('is a 404 for an unknown approval type', async () => {
    const { service } = buildPublish(null, false);
    await expect(service.publishVersion(input())).rejects.toThrow(
      NotFoundException,
    );
  });

  it('audits the publication with the author and the full definition', async () => {
    const { service, audit } = buildPublish({
      version: 1,
      effectiveFrom: new Date('2026-01-01'),
    });
    await service.publishVersion(
      input({
        effectiveFrom: new Date('2026-06-01'),
        isOfficiallyRequired: true,
      }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: AUTHOR,
        action: 'RULE_VERSION_PUBLISHED',
        entityType: 'ApprovalRule',
        afterState: expect.objectContaining({
          version: 2,
          isOfficiallyRequired: true,
          sourceReference: 'Department circular 12/2026',
          conditions: GOOD,
        }),
      }),
    );
  });
});

describe('ApprovalRulesService.loadEffectiveRules', () => {
  const T2 = '10000000-0000-4000-8000-000000000002';
  const dept = { id: 'd1', code: 'DEPT-A', name: 'Dept A' };
  const row = (
    approvalTypeId: string,
    version: number,
    isActive = true,
    extra: Record<string, unknown> = {},
  ) => ({
    id: `rule-${approvalTypeId.slice(-1)}-v${version}`,
    approvalTypeId,
    version,
    isActive,
    priority: 100,
    isOfficiallyRequired: false,
    sourceReference: 'TBD',
    effectiveFrom: new Date('2026-01-01T00:00:00Z'),
    effectiveTo: null,
    conditions: GOOD,
    excludesIf: null,
    approvalType: {
      id: approvalTypeId,
      name: `Type ${approvalTypeId.slice(-1)}`,
      legalName: null,
      legalReference: null,
      department: dept,
    },
    ...extra,
  });

  function buildLoad(rows: object[], deps: object[] = []) {
    const prisma = {
      approvalRule: { findMany: jest.fn().mockResolvedValue(rows) },
      approvalDependency: { findMany: jest.fn().mockResolvedValue(deps) },
    };
    return {
      service: new ApprovalRulesService(
        prisma as unknown as PrismaService,
        {} as AuditService,
      ),
      prisma,
    };
  }

  it('queries only rules already effective and not yet ended, for active approval types and departments', async () => {
    const { service, prisma } = buildLoad([]);
    await service.loadEffectiveRules(NOW);
    expect(prisma.approvalRule.findMany.mock.calls[0][0].where).toEqual({
      effectiveFrom: { lte: NOW },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: NOW } }],
      approvalType: { isActive: true, department: { isActive: true } },
    });
  });

  it('chooses the HIGHEST effective version per approval type', async () => {
    const { service } = buildLoad([
      row(TYPE, 3),
      row(TYPE, 2),
      row(TYPE, 1),
      row(T2, 1),
    ]);
    const rules = await service.loadEffectiveRules(NOW);
    expect(
      rules.map((r) => `${r.approvalType.id.slice(-1)}v${r.version}`).sort(),
    ).toEqual(['1v3', '2v1']);
  });

  it('a deactivated latest version switches the approval off — it does not fall back to an older version', async () => {
    const { service } = buildLoad([
      row(TYPE, 2, false),
      row(TYPE, 1, true),
      row(T2, 1),
    ]);
    const rules = await service.loadEffectiveRules(NOW);
    expect(rules.map((r) => r.approvalType.id)).toEqual([T2]);
  });

  it('returns self-contained descriptors: definition, department, source and dependencies', async () => {
    const { service, prisma } = buildLoad(
      [
        row(TYPE, 1, true, {
          isOfficiallyRequired: true,
          priority: 7,
          sourceReference: 'Circular 5',
        }),
      ],
      [
        {
          approvalTypeId: TYPE,
          dependsOnApprovalType: { id: T2, name: 'Prerequisite' },
        },
      ],
    );
    const [rule] = await service.loadEffectiveRules(NOW);
    expect(rule).toEqual({
      ruleId: 'rule-1-v1',
      version: 1,
      priority: 7,
      effectiveFrom: '2026-01-01T00:00:00.000Z',
      effectiveTo: null,
      isOfficiallyRequired: true,
      sourceReference: 'Circular 5',
      conditions: GOOD,
      excludesIf: null,
      approvalType: {
        id: TYPE,
        name: 'Type 1',
        legalName: null,
        legalReference: null,
      },
      department: dept,
      dependsOn: [{ approvalTypeId: T2, name: 'Prerequisite' }],
    });
    expect(prisma.approvalDependency.findMany.mock.calls[0][0].where).toEqual({
      approvalTypeId: { in: [TYPE] },
    });
  });

  it('does not query dependencies when nothing is effective', async () => {
    const { service, prisma } = buildLoad([row(TYPE, 1, false)]);
    expect(await service.loadEffectiveRules(NOW)).toEqual([]);
    expect(prisma.approvalDependency.findMany).not.toHaveBeenCalled();
  });
});
