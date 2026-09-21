import { DiscoveryInputs } from './discovery-fields';
import {
  DISCOVERY_ENGINE_VERSION,
  DISCOVERY_NOTICE,
  RuleDescriptor,
  evaluateDiscovery,
} from './discovery-engine';

const inputs: DiscoveryInputs = {
  sector_code: '25910',
  district: 'Pune',
  taluka: 'Khed',
  industrial_area: null,
  enterprise_size_band: 'small',
  investment_amount: 5_000_000,
  employment_count: 40,
  project_stage: 'expansion',
  land_status: 'leased',
  construction_status: 'not_started',
  production_status: 'pre_production',
  hazardous_flag: true,
  hazardous_category: null,
  environmental_category: null,
  enterprise_type: 'Private Limited Company',
};

let counter = 0;
function rule(
  overrides: Partial<RuleDescriptor> & { name?: string; dept?: string } = {},
): RuleDescriptor {
  counter += 1;
  const { name = `Approval ${counter}`, dept = 'DEPT-A', ...rest } = overrides;
  return {
    ruleId: `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`,
    version: 1,
    priority: 100,
    effectiveFrom: '2026-01-01T00:00:00.000Z',
    effectiveTo: null,
    isOfficiallyRequired: false,
    sourceReference: 'TEST FIXTURE',
    conditions: { field: 'hazardous_flag', op: 'equals', value: true },
    excludesIf: null,
    approvalType: {
      id: `10000000-0000-4000-8000-${String(counter).padStart(12, '0')}`,
      name,
      legalName: null,
      legalReference: null,
    },
    department: {
      id: `20000000-0000-4000-8000-${dept
        .charCodeAt(dept.length - 1)
        .toString()
        .padStart(12, '0')}`,
      code: dept,
      name: `${dept} name`,
    },
    dependsOn: [],
    ...rest,
  };
}

describe('evaluateDiscovery — outcomes', () => {
  it('returns an empty, well-formed result when no rules exist (nothing is guessed)', () => {
    expect(evaluateDiscovery([], inputs)).toEqual({
      applicable: [],
      notApplicable: [],
      matchedApprovalTypeIds: [],
      summary: { rulesEvaluated: 0, applicableCount: 0, notApplicableCount: 0 },
    });
  });

  it('a matching rule yields an applicable approval with department, rule/version and an explanation', () => {
    const r = rule({
      name: 'Approval X',
      version: 3,
      conditions: {
        all: [
          { field: 'hazardous_flag', op: 'equals', value: true },
          {
            field: 'project_stage',
            op: 'in',
            value: ['greenfield', 'expansion'],
          },
        ],
      },
    });
    const result = evaluateDiscovery([r], inputs);

    expect(result.applicable).toHaveLength(1);
    const item = result.applicable[0];
    expect(item.approvalType).toMatchObject({
      id: r.approvalType.id,
      name: 'Approval X',
    });
    expect(item.department).toEqual(r.department);
    expect(item.rule).toMatchObject({
      id: r.ruleId,
      version: 3,
      sourceReference: 'TEST FIXTURE',
    });
    expect(item.explanation).toBe(
      'Shown because: hazardous_flag equals true (project value: true); project_stage is one of [greenfield, expansion] (project value: expansion).',
    );
    expect(item.trace).toMatchObject({ kind: 'all', result: true });
    expect(result.matchedApprovalTypeIds).toEqual([r.approvalType.id]);
    expect(result.notApplicable).toEqual([]);
  });

  it('labels every result "Potentially Applicable" unless the rule is flagged officially required (FRD §10.3)', () => {
    const plain = rule({ name: 'Plain' });
    const official = rule({ name: 'Official', isOfficiallyRequired: true });
    const { applicable } = evaluateDiscovery([plain, official], inputs);
    expect(
      Object.fromEntries(applicable.map((a) => [a.approvalType.name, a.label])),
    ).toEqual({
      Plain: 'POTENTIALLY_APPLICABLE',
      Official: 'OFFICIALLY_REQUIRED',
    });
  });

  it('a non-matching rule is reported as CONDITIONS_NOT_MET with the failing condition', () => {
    const r = rule({
      conditions: { field: 'employment_count', op: 'gt', value: 100 },
    });
    const result = evaluateDiscovery([r], inputs);
    expect(result.applicable).toEqual([]);
    expect(result.notApplicable).toHaveLength(1);
    expect(result.notApplicable[0]).toMatchObject({
      reason: 'CONDITIONS_NOT_MET',
      explanation:
        'Not suggested because: employment_count is greater than 100 (project value: 40).',
    });
    expect(result.matchedApprovalTypeIds).toEqual([]);
  });

  describe('excludes_if', () => {
    const matching = { field: 'hazardous_flag', op: 'equals', value: true };

    it('removes an otherwise-matching approval and says why', () => {
      const r = rule({
        conditions: matching,
        excludesIf: {
          any: [{ field: 'land_status', op: 'equals', value: 'leased' }],
        },
      });
      const result = evaluateDiscovery([r], inputs);
      expect(result.applicable).toEqual([]);
      expect(result.notApplicable[0]).toMatchObject({
        reason: 'EXCLUDED',
        explanation:
          'Excluded because: land_status equals leased (project value: leased).',
      });
    });

    it('does not remove it when the exclusion does not hold', () => {
      const r = rule({
        conditions: matching,
        excludesIf: { field: 'land_status', op: 'equals', value: 'owned' },
      });
      expect(evaluateDiscovery([r], inputs).applicable).toHaveLength(1);
    });

    it('is only consulted when the main conditions matched', () => {
      const r = rule({
        conditions: { field: 'employment_count', op: 'gt', value: 100 },
        excludesIf: { field: 'land_status', op: 'equals', value: 'leased' },
      });
      expect(evaluateDiscovery([r], inputs).notApplicable[0].reason).toBe(
        'CONDITIONS_NOT_MET',
      );
    });

    it('a missing value never triggers an exclusion (unknown does not exclude)', () => {
      const r = rule({
        conditions: matching,
        excludesIf: { field: 'industrial_area', op: 'equals', value: 'MIDC' },
      });
      expect(evaluateDiscovery([r], inputs).applicable).toHaveLength(1);
    });
  });

  it('one rule never affects another: several approvals can apply at once', () => {
    const a = rule({ name: 'A' });
    const b = rule({
      name: 'B',
      conditions: { field: 'project_stage', op: 'equals', value: 'expansion' },
    });
    const c = rule({
      name: 'C',
      conditions: { field: 'project_stage', op: 'equals', value: 'greenfield' },
    });
    const result = evaluateDiscovery([a, b, c], inputs);
    expect(result.applicable.map((x) => x.approvalType.name)).toEqual([
      'A',
      'B',
    ]);
    expect(result.notApplicable.map((x) => x.approvalType.name)).toEqual(['C']);
    expect(result.summary).toEqual({
      rulesEvaluated: 3,
      applicableCount: 2,
      notApplicableCount: 1,
    });
  });
});

describe('evaluateDiscovery — malformed stored definitions', () => {
  it('reports an invalid rule as DEFINITION_INVALID with the issues, never evaluates or guesses it, and keeps evaluating the rest', () => {
    const good = rule({ name: 'Good' });
    const broken = rule({
      name: 'Broken',
      conditions: { field: 'made_up', op: 'equals', value: 1 },
    });
    const result = evaluateDiscovery([broken, good], inputs);

    expect(result.applicable.map((a) => a.approvalType.name)).toEqual(['Good']);
    expect(result.notApplicable).toHaveLength(1);
    expect(result.notApplicable[0]).toMatchObject({
      reason: 'DEFINITION_INVALID',
      trace: null,
    });
    expect(result.notApplicable[0].issues?.[0]).toEqual({
      path: '$.field',
      message: 'unknown field "made_up"',
    });
  });

  it.each([
    ['null', null],
    ['a string', 'true'],
    ['an empty all', { all: [] }],
    [
      'an unknown operator',
      { field: 'hazardous_flag', op: 'contains', value: true },
    ],
    ['a code-like payload', { expr: 'process.exit(1)' }],
  ])(
    'treats %s in conditions as invalid rather than matching or crashing',
    (_n, conditions) => {
      const result = evaluateDiscovery([rule({ conditions })], inputs);
      expect(result.applicable).toEqual([]);
      expect(result.notApplicable[0].reason).toBe('DEFINITION_INVALID');
    },
  );

  it('an invalid excludes_if invalidates the rule (it is never treated as "no exclusion")', () => {
    const r = rule({
      excludesIf: { field: 'made_up', op: 'equals', value: 1 },
    });
    const result = evaluateDiscovery([r], inputs);
    expect(result.applicable).toEqual([]);
    expect(result.notApplicable[0].issues?.[0].path).toBe(
      'excludes_if:$.field',
    );
  });
});

describe('evaluateDiscovery — priority and ordering', () => {
  it('orders by priority, then department code, then approval name, then rule id', () => {
    const rules = [
      rule({ name: 'Zeta', dept: 'DEPT-B', priority: 10 }),
      rule({ name: 'Alpha', dept: 'DEPT-B', priority: 50 }),
      rule({ name: 'Beta', dept: 'DEPT-A', priority: 50 }),
      rule({ name: 'Alpha', dept: 'DEPT-A', priority: 50 }),
      rule({ name: 'Omega', dept: 'DEPT-A', priority: 100 }),
    ];
    const order = evaluateDiscovery(rules, inputs).applicable.map(
      (a) => `${a.rule.priority}/${a.department.code}/${a.approvalType.name}`,
    );
    expect(order).toEqual([
      '10/DEPT-B/Zeta',
      '50/DEPT-A/Alpha',
      '50/DEPT-A/Beta',
      '50/DEPT-B/Alpha',
      '100/DEPT-A/Omega',
    ]);
  });

  it('breaks a complete tie by rule id, so the order is total', () => {
    const a = rule({ name: 'Same', priority: 5 });
    const b = rule({ name: 'Same', priority: 5 });
    const result = evaluateDiscovery([b, a], inputs);
    expect(result.applicable.map((x) => x.rule.id)).toEqual(
      [a.ruleId, b.ruleId].sort(),
    );
  });

  it('orders non-applicable rules the same way', () => {
    const cond = { field: 'employment_count', op: 'gt', value: 999 };
    const late = rule({ name: 'Late', priority: 90, conditions: cond });
    const early = rule({ name: 'Early', priority: 10, conditions: cond });
    expect(
      evaluateDiscovery([late, early], inputs).notApplicable.map(
        (n) => n.approvalType.name,
      ),
    ).toEqual(['Early', 'Late']);
  });
});

describe('evaluateDiscovery — determinism and reproducibility', () => {
  const build = () => [
    rule({ name: 'A', priority: 20 }),
    rule({
      name: 'B',
      priority: 10,
      conditions: {
        all: [
          { field: 'project_stage', op: 'in', value: ['expansion'] },
          {
            any: [
              { field: 'employment_count', op: 'between', value: [30, 50] },
              { field: 'district', op: 'equals', value: 'nashik' },
            ],
          },
        ],
      },
    }),
    rule({
      name: 'C',
      conditions: { field: 'employment_count', op: 'gt', value: 100 },
    }),
    rule({
      name: 'D',
      excludesIf: { field: 'district', op: 'equals', value: 'pune' },
    }),
    rule({ name: 'E', conditions: { bad: true } }),
  ];

  it('repeated evaluation gives byte-identical results', () => {
    const rules = build();
    const first = JSON.stringify(evaluateDiscovery(rules, inputs));
    for (let i = 0; i < 25; i++) {
      expect(JSON.stringify(evaluateDiscovery(rules, inputs))).toBe(first);
    }
  });

  it('the order rules are supplied in never changes the result', () => {
    const rules = build();
    const expected = JSON.stringify(evaluateDiscovery(rules, inputs));
    expect(
      JSON.stringify(evaluateDiscovery([...rules].reverse(), inputs)),
    ).toBe(expected);
    const shuffled = [rules[2], rules[4], rules[0], rules[3], rules[1]];
    expect(JSON.stringify(evaluateDiscovery(shuffled, inputs))).toBe(expected);
  });

  it('a snapshot round-trip through JSON (how it is stored) reproduces the result exactly', () => {
    const rules = build();
    const original = evaluateDiscovery(rules, inputs);
    const storedRules = JSON.parse(JSON.stringify(rules));
    const storedInputs = JSON.parse(JSON.stringify(inputs));
    expect(evaluateDiscovery(storedRules, storedInputs)).toEqual(original);
  });

  it('does not mutate its arguments', () => {
    const rules = build();
    const rulesBefore = JSON.stringify(rules);
    const inputsBefore = JSON.stringify(inputs);
    evaluateDiscovery(rules, inputs);
    expect(JSON.stringify(rules)).toBe(rulesBefore);
    expect(JSON.stringify(inputs)).toBe(inputsBefore);
  });

  it('the result depends on the inputs: changing a characteristic changes the outcome', () => {
    const rules = [
      rule({
        conditions: {
          field: 'project_stage',
          op: 'equals',
          value: 'expansion',
        },
      }),
    ];
    expect(evaluateDiscovery(rules, inputs).applicable).toHaveLength(1);
    expect(
      evaluateDiscovery(rules, { ...inputs, project_stage: 'greenfield' })
        .applicable,
    ).toHaveLength(0);
  });
});

describe('evaluateDiscovery — dependencies', () => {
  it('lists prerequisites and whether each is itself applicable (relationship only)', () => {
    const prerequisite = rule({ name: 'Prerequisite' });
    const dependent = rule({
      name: 'Dependent',
      dependsOn: [
        { approvalTypeId: prerequisite.approvalType.id, name: 'Prerequisite' },
        {
          approvalTypeId: '30000000-0000-4000-8000-000000000001',
          name: 'Not applicable one',
        },
      ],
    });
    const item = evaluateDiscovery(
      [dependent, prerequisite],
      inputs,
    ).applicable.find((a) => a.approvalType.name === 'Dependent');
    expect(item?.dependsOn).toEqual([
      {
        approvalTypeId: '30000000-0000-4000-8000-000000000001',
        name: 'Not applicable one',
        alsoApplicable: false,
      },
      {
        approvalTypeId: prerequisite.approvalType.id,
        name: 'Prerequisite',
        alsoApplicable: true,
      },
    ]);
  });
});

describe('constants', () => {
  it('states that discovery is a recommendation, not a statutory determination', () => {
    expect(DISCOVERY_NOTICE).toMatch(/not a legal or statutory determination/i);
    expect(DISCOVERY_NOTICE).toMatch(/Officially Required/);
    expect(DISCOVERY_ENGINE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
