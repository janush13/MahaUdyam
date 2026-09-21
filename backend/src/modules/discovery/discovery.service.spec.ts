import { NotFoundException } from '@nestjs/common';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { EnterpriseAccess } from '../enterprises/interfaces/enterprise-access.interface';
import { ApprovalRulesService } from './approval-rules.service';
import { DiscoveryService } from './discovery.service';
import {
  DISCOVERY_ENGINE_VERSION,
  RuleDescriptor,
} from './engine/discovery-engine';

const ENTERPRISE = '00000000-0000-4000-8000-0000000000c3';
const PROJECT = '00000000-0000-4000-8000-0000000000e5';
const ACTOR = '00000000-0000-4000-8000-0000000000a1';

const ownerAccess = {
  relation: 'OWNER',
  enterprise: { id: ENTERPRISE, businessType: 'Private Limited Company' },
  scopedProjectIds: [],
} as unknown as EnterpriseAccess;

const projectRow = {
  id: PROJECT,
  enterpriseId: ENTERPRISE,
  referenceNumber: 'PRJ-2026-000001',
  sectorCode: '25910',
  district: 'Pune',
  taluka: 'Khed',
  industrialArea: null,
  enterpriseSizeBand: 'small',
  investmentAmount: { toString: () => '5000000.5' },
  employmentCount: 40,
  projectStage: 'expansion',
  landStatus: 'owned',
  constructionStatus: 'not_started',
  productionStatus: 'pre_production',
  hazardousFlag: true,
  hazardousCategory: null,
  environmentalCategory: null,
};

const rule = (over: Partial<RuleDescriptor> = {}): RuleDescriptor => ({
  ruleId: '90000000-0000-4000-8000-000000000001',
  version: 2,
  priority: 100,
  effectiveFrom: '2026-01-01T00:00:00.000Z',
  effectiveTo: null,
  isOfficiallyRequired: false,
  sourceReference: 'TBD',
  conditions: { field: 'hazardous_flag', op: 'equals', value: true },
  excludesIf: null,
  approvalType: {
    id: '10000000-0000-4000-8000-000000000001',
    name: 'Type A',
    legalName: null,
    legalReference: null,
  },
  department: { id: 'd1', code: 'DEPT-A', name: 'Dept A' },
  dependsOn: [],
  ...over,
});

function build(
  descriptors: RuleDescriptor[] = [rule()],
  project: object | null = projectRow,
) {
  const snapshotStore: Array<Record<string, unknown>> = [];
  const prisma = {
    project: { findFirst: jest.fn().mockResolvedValue(project) },
    discoverySnapshot: {
      create: jest.fn().mockImplementation(({ data }) => {
        const row = { id: 'snap-1', ...data };
        snapshotStore.push(row);
        return Promise.resolve(row);
      }),
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
  };
  const rules = {
    loadEffectiveRules: jest.fn().mockResolvedValue(descriptors),
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const service = new DiscoveryService(
    prisma as unknown as PrismaService,
    rules as unknown as ApprovalRulesService,
    audit as unknown as AuditService,
  );
  return { service, prisma, rules, audit, snapshotStore };
}

describe('DiscoveryService.run', () => {
  it('reads the project scoped to the authorised enterprise — another enterprise’s project id is a 404', async () => {
    const { service, prisma } = build([], null);
    await expect(
      service.run(ownerAccess, PROJECT, ACTOR, 'ip'),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.project.findFirst.mock.calls[0][0].where).toEqual({
      id: PROJECT,
      enterpriseId: ENTERPRISE,
    });
    expect(prisma.discoverySnapshot.create).not.toHaveBeenCalled();
  });

  it('evaluates the effective rules at the run instant and returns the structured result', async () => {
    const { service, rules } = build();
    const result = await service.run(ownerAccess, PROJECT, ACTOR, 'ip');

    expect(rules.loadEffectiveRules).toHaveBeenCalledWith(expect.any(Date));
    expect(result).toMatchObject({
      snapshotId: 'snap-1',
      projectId: PROJECT,
      projectReferenceNumber: 'PRJ-2026-000001',
      engineVersion: DISCOVERY_ENGINE_VERSION,
      message: null,
      summary: { rulesEvaluated: 1, applicableCount: 1, notApplicableCount: 0 },
    });
    expect(result.evaluatedAt).toBeInstanceOf(Date);
    expect(result.notice).toMatch(/not a legal or statutory determination/i);
    expect(result.applicable[0]).toMatchObject({
      label: 'POTENTIALLY_APPLICABLE',
      rule: { version: 2 },
      department: { code: 'DEPT-A' },
    });
    expect(result.reproducible).toBeUndefined(); // only reported when re-reading
  });

  it('persists a self-contained snapshot: exact rule versions with definitions, inputs, result, engine version, author', async () => {
    const { service, prisma } = build();
    await service.run(ownerAccess, PROJECT, ACTOR, 'ip');
    const data = prisma.discoverySnapshot.create.mock.calls[0][0].data;

    expect(data.projectId).toBe(PROJECT);
    expect(data.engineVersion).toBe(DISCOVERY_ENGINE_VERSION);
    expect(data.createdByUserId).toBe(ACTOR);
    expect(data.ruleVersionsUsed).toEqual([rule()]); // full definition, not just an id
    expect(data.projectInputs).toMatchObject({
      hazardous_flag: true,
      project_stage: 'expansion',
      enterprise_type: 'Private Limited Company',
      investment_amount: 5000000.5,
    });
    expect(data.result.applicable).toHaveLength(1);
    expect(data.matchedApprovalTypeIds).toEqual([
      '10000000-0000-4000-8000-000000000001',
    ]);
  });

  it('says so explicitly — and guesses nothing — when no rules are configured, or none match', async () => {
    const none = await build([]).service.run(ownerAccess, PROJECT, ACTOR, 'ip');
    expect(none.applicable).toEqual([]);
    expect(none.message).toMatch(/No approval rules have been configured/);

    const noMatch = await build([
      rule({ conditions: { field: 'employment_count', op: 'gt', value: 999 } }),
    ]).service.run(ownerAccess, PROJECT, ACTOR, 'ip');
    expect(noMatch.applicable).toEqual([]);
    expect(noMatch.message).toMatch(/could not determine additional approvals/);
    expect(noMatch.notApplicable[0].reason).toBe('CONDITIONS_NOT_MET');
  });

  it('audits the run with the actor, snapshot, enterprise, acting capacity and rule versions used', async () => {
    const { service, audit } = build();
    await service.run(
      { ...ownerAccess, relation: 'REPRESENTATIVE' } as EnterpriseAccess,
      PROJECT,
      ACTOR,
      '9.9.9.9',
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: ACTOR,
        action: 'DISCOVERY_RUN',
        entityType: 'DiscoverySnapshot',
        entityId: 'snap-1',
        ipAddress: '9.9.9.9',
        afterState: expect.objectContaining({
          projectId: PROJECT,
          enterpriseId: ENTERPRISE,
          actingAs: 'REPRESENTATIVE',
          applicableCount: 1,
          ruleVersions: [{ ruleId: rule().ruleId, version: 2 }],
        }),
      }),
    );
  });

  it('is deterministic: the same rules and project give the same result every time', async () => {
    const { service } = build([
      rule(),
      rule({
        ruleId: '90000000-0000-4000-8000-000000000002',
        approvalType: {
          id: '10000000-0000-4000-8000-000000000002',
          name: 'Type B',
          legalName: null,
          legalReference: null,
        },
      }),
    ]);
    const strip = (r: Awaited<ReturnType<typeof service.run>>) =>
      JSON.stringify({
        a: r.applicable,
        n: r.notApplicable,
        s: r.summary,
        i: r.inputs,
      });
    const first = strip(await service.run(ownerAccess, PROJECT, ACTOR, 'ip'));
    for (let i = 0; i < 5; i++) {
      expect(strip(await service.run(ownerAccess, PROJECT, ACTOR, 'ip'))).toBe(
        first,
      );
    }
  });

  it('never depends on a statutory value: with no rules it fabricates no approval, department or threshold', async () => {
    const result = await build([]).service.run(
      ownerAccess,
      PROJECT,
      ACTOR,
      'ip',
    );
    expect(
      JSON.stringify(result.applicable) + JSON.stringify(result.notApplicable),
    ).toBe('[][]');
  });
});

describe('DiscoveryService.get / list', () => {
  const storedFrom = async (descriptors: RuleDescriptor[]) => {
    const built = build(descriptors);
    await built.service.run(ownerAccess, PROJECT, ACTOR, 'ip');
    return { ...built, stored: built.snapshotStore[0] };
  };

  it('re-reads a snapshot exactly as stored and reports it reproducible', async () => {
    const { service, prisma, stored } = await storedFrom([rule()]);
    prisma.discoverySnapshot.findFirst.mockResolvedValue({
      ...stored,
      evaluatedAt: new Date(),
    });

    const result = await service.get(ownerAccess, PROJECT, 'snap-1');
    expect(result.reproducible).toBe(true);
    expect(result.applicable).toHaveLength(1);
    expect(prisma.discoverySnapshot.findFirst.mock.calls[0][0].where).toEqual({
      id: 'snap-1',
      projectId: PROJECT,
    });
  });

  it('reports NOT reproducible if the stored result no longer matches what the stored rules and inputs produce (tamper evidence)', async () => {
    const { service, prisma, stored } = await storedFrom([rule()]);
    const tampered = JSON.parse(JSON.stringify(stored));
    tampered.result.applicable = [];
    tampered.result.summary.applicableCount = 0;
    prisma.discoverySnapshot.findFirst.mockResolvedValue({
      ...tampered,
      evaluatedAt: new Date(),
    });
    expect(
      (await service.get(ownerAccess, PROJECT, 'snap-1')).reproducible,
    ).toBe(false);
  });

  it('serves the STORED result even if the live rules have since changed — history is not re-evaluated', async () => {
    const { service, prisma, rules, stored } = await storedFrom([rule()]);
    rules.loadEffectiveRules.mockResolvedValue([]); // rules retired since
    prisma.discoverySnapshot.findFirst.mockResolvedValue({
      ...stored,
      evaluatedAt: new Date(),
    });
    const result = await service.get(ownerAccess, PROJECT, 'snap-1');
    expect(result.applicable).toHaveLength(1);
    expect(rules.loadEffectiveRules).toHaveBeenCalledTimes(1); // only the original run
  });

  it('is a 404 for a snapshot that is not this project’s', async () => {
    const { service, prisma } = build();
    prisma.discoverySnapshot.findFirst.mockResolvedValue(null);
    await expect(service.get(ownerAccess, PROJECT, 'other')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('lists snapshots newest first with counts', async () => {
    const { service, prisma, stored } = await storedFrom([rule()]);
    prisma.discoverySnapshot.findMany.mockResolvedValue([
      { ...stored, evaluatedAt: new Date() },
    ]);
    const list = await service.list(ownerAccess, PROJECT);
    expect(prisma.discoverySnapshot.findMany.mock.calls[0][0]).toMatchObject({
      where: { projectId: PROJECT },
      orderBy: [{ evaluatedAt: 'desc' }, { id: 'desc' }],
    });
    expect(list[0]).toMatchObject({
      id: 'snap-1',
      rulesEvaluated: 1,
      applicableCount: 1,
      notApplicableCount: 0,
    });
  });
});
