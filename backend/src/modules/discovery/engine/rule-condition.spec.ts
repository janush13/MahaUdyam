import { DiscoveryInputs } from './discovery-fields';
import {
  Condition,
  ConditionOperator,
  MAX_CONDITION_DEPTH,
  MAX_CONDITION_NODES,
  MAX_LIST_VALUES,
  describeOutcome,
  evaluateCondition,
  validateCondition,
} from './rule-condition';

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

const leaf = (
  field: string,
  op: ConditionOperator,
  value: unknown,
): Condition => ({ field, op, value }) as Condition;
const run = (c: Condition, i: DiscoveryInputs = inputs) =>
  evaluateCondition(c, i).result;
const issuePaths = (c: unknown) => validateCondition(c).map((i) => i.path);

describe('condition operators — evaluation', () => {
  describe('equals', () => {
    it.each([
      ['boolean', leaf('hazardous_flag', 'equals', true), true],
      ['boolean (unequal)', leaf('hazardous_flag', 'equals', false), false],
      ['enum', leaf('project_stage', 'equals', 'expansion'), true],
      ['enum (unequal)', leaf('project_stage', 'equals', 'greenfield'), false],
      ['number', leaf('employment_count', 'equals', 40), true],
      ['number (unequal)', leaf('employment_count', 'equals', 41), false],
      ['text', leaf('district', 'equals', 'Pune'), true],
    ])('%s', (_n, condition, expected) => {
      expect(run(condition)).toBe(expected);
    });

    it('compares text fields trimmed and case-insensitively, but enums exactly', () => {
      expect(run(leaf('district', 'equals', '  pUNe '))).toBe(true);
      expect(
        run(leaf('enterprise_type', 'equals', 'private limited company')),
      ).toBe(true);
      expect(run(leaf('sector_code', 'equals', '25910'))).toBe(true);
      // Enum values are validated to the exact vocabulary, so a differently
      // cased value can never be published — and never matches if it were.
      expect(run(leaf('project_stage', 'equals', 'Expansion'))).toBe(false);
    });
  });

  describe('in / not_in', () => {
    it('in: true when any listed value matches', () => {
      expect(
        run(leaf('project_stage', 'in', ['greenfield', 'expansion'])),
      ).toBe(true);
      expect(
        run(leaf('project_stage', 'in', ['greenfield', 'brownfield'])),
      ).toBe(false);
      expect(run(leaf('district', 'in', ['nashik', 'PUNE']))).toBe(true);
      expect(run(leaf('employment_count', 'in', [10, 40]))).toBe(true);
    });

    it('not_in: true only when none of the listed values match', () => {
      expect(
        run(leaf('project_stage', 'not_in', ['greenfield', 'brownfield'])),
      ).toBe(true);
      expect(
        run(leaf('project_stage', 'not_in', ['greenfield', 'expansion'])),
      ).toBe(false);
      expect(run(leaf('district', 'not_in', ['Nashik']))).toBe(true);
      expect(run(leaf('district', 'not_in', [' pune ']))).toBe(false);
    });
  });

  describe('gt / lt (strict)', () => {
    it.each([
      ['gt', 39, true],
      ['gt', 40, false],
      ['gt', 41, false],
      ['lt', 41, true],
      ['lt', 40, false],
      ['lt', 39, false],
    ] as const)('employment_count %s %p -> %s', (op, value, expected) => {
      expect(run(leaf('employment_count', op, value))).toBe(expected);
    });

    it('works on decimal amounts', () => {
      expect(run(leaf('investment_amount', 'gt', 4_999_999.99))).toBe(true);
      expect(run(leaf('investment_amount', 'lt', 5_000_000))).toBe(false);
    });
  });

  describe('between (inclusive)', () => {
    it.each([
      [[10, 40], true],
      [[40, 100], true],
      [[40, 40], true],
      [[41, 100], false],
      [[0, 39], false],
      [[10, 100], true],
    ] as const)('employment_count between %j -> %s', (range, expected) => {
      expect(run(leaf('employment_count', 'between', range))).toBe(expected);
    });
  });

  describe('missing values: unknown never matches', () => {
    it('every operator is false when the field has no value — including not_in', () => {
      for (const c of [
        leaf('industrial_area', 'equals', 'MIDC Chakan'),
        leaf('industrial_area', 'in', ['MIDC Chakan']),
        leaf('industrial_area', 'not_in', ['MIDC Chakan']),
        leaf('hazardous_category', 'equals', 'x'),
      ]) {
        expect(run(c)).toBe(false);
      }
    });

    it('an input key that is absent entirely behaves like null', () => {
      const without = Object.fromEntries(
        Object.entries(inputs).filter(([key]) => key !== 'hazardous_flag'),
      );
      expect(run(leaf('hazardous_flag', 'equals', true), without)).toBe(false);
      expect(run(leaf('hazardous_flag', 'not_in', [false]), without)).toBe(
        false,
      );
    });
  });
});

describe('all / any — nesting', () => {
  const T = leaf('hazardous_flag', 'equals', true);
  const F = leaf('hazardous_flag', 'equals', false);

  it('all requires every child; any requires at least one', () => {
    expect(run({ all: [T, T] })).toBe(true);
    expect(run({ all: [T, F] })).toBe(false);
    expect(run({ any: [F, T] })).toBe(true);
    expect(run({ any: [F, F] })).toBe(false);
  });

  it('nests to arbitrary (bounded) depth in both directions', () => {
    expect(run({ all: [T, { any: [F, { all: [T, T] }] }] })).toBe(true);
    expect(run({ any: [F, { all: [T, { any: [F, F] }] }] })).toBe(false);
    expect(run({ all: [{ any: [{ all: [T, T] }, F] }, { any: [F, T] }] })).toBe(
      true,
    );
  });

  it('evaluates every child (no short-circuit) so the trace is complete', () => {
    const trace = evaluateCondition({ all: [F, T, F] }, inputs);
    expect(trace).toMatchObject({ kind: 'all', result: false });
    expect(
      trace.kind !== 'condition' && trace.children.map((c) => c.result),
    ).toEqual([false, true, false]);
  });

  it('records the field, operator, expected and actual value on each leaf', () => {
    const trace = evaluateCondition(
      leaf('project_stage', 'in', ['greenfield']),
      inputs,
    );
    expect(trace).toEqual({
      kind: 'condition',
      field: 'project_stage',
      op: 'in',
      expected: ['greenfield'],
      actual: 'expansion',
      result: false,
    });
  });
});

describe('describeOutcome — plain-language explanation', () => {
  const both: Condition = {
    all: [
      leaf('hazardous_flag', 'equals', true),
      leaf('project_stage', 'in', ['greenfield', 'expansion']),
    ],
  };

  it('lists every satisfied condition of a matched all, with the project value', () => {
    expect(describeOutcome(evaluateCondition(both, inputs), true)).toEqual([
      'hazardous_flag equals true (project value: true)',
      'project_stage is one of [greenfield, expansion] (project value: expansion)',
    ]);
  });

  it('lists only the failing conditions of a failed all', () => {
    const c: Condition = {
      all: [
        leaf('hazardous_flag', 'equals', true),
        leaf('employment_count', 'gt', 100),
      ],
    };
    expect(describeOutcome(evaluateCondition(c, inputs), false)).toEqual([
      'employment_count is greater than 100 (project value: 40)',
    ]);
  });

  it('lists only the true children of a matched any, all children of a failed any', () => {
    const c: Condition = {
      any: [
        leaf('employment_count', 'gt', 100),
        leaf('district', 'equals', 'pune'),
      ],
    };
    expect(describeOutcome(evaluateCondition(c, inputs), true)).toEqual([
      'district equals pune (project value: Pune)',
    ]);
    const none: Condition = {
      any: [
        leaf('employment_count', 'gt', 100),
        leaf('employment_count', 'lt', 1),
      ],
    };
    expect(
      describeOutcome(evaluateCondition(none, inputs), false),
    ).toHaveLength(2);
  });

  it('describes between, not_in and a missing value', () => {
    expect(
      describeOutcome(
        evaluateCondition(
          leaf('employment_count', 'between', [10, 50]),
          inputs,
        ),
        true,
      ),
    ).toEqual([
      'employment_count is between 10 and 50 (inclusive) (project value: 40)',
    ]);
    expect(
      describeOutcome(
        evaluateCondition(leaf('industrial_area', 'equals', 'X'), inputs),
        false,
      ),
    ).toEqual(['industrial_area equals X (project value: not provided)']);
  });
});

describe('validateCondition — valid definitions', () => {
  it.each([
    [leaf('hazardous_flag', 'equals', true)],
    [leaf('project_stage', 'in', ['greenfield', 'brownfield'])],
    [leaf('land_status', 'not_in', ['owned'])],
    [leaf('investment_amount', 'gt', 1000)],
    [leaf('employment_count', 'between', [1, 10])],
    [leaf('district', 'equals', 'Pune')],
    [
      {
        all: [
          leaf('hazardous_flag', 'equals', true),
          {
            any: [
              leaf('employment_count', 'lt', 5),
              leaf('district', 'in', ['Pune']),
            ],
          },
        ],
      },
    ],
  ])('accepts %j', (c) => {
    expect(validateCondition(c)).toEqual([]);
  });

  it('accepts every documented enum value and every catalogued field', () => {
    for (const v of ['micro', 'small', 'medium', 'large']) {
      expect(
        validateCondition(leaf('enterprise_size_band', 'equals', v)),
      ).toEqual([]);
    }
    for (const v of ['owned', 'leased', 'allotted_by_midc']) {
      expect(validateCondition(leaf('land_status', 'equals', v))).toEqual([]);
    }
  });
});

describe('validateCondition — malformed definitions', () => {
  it.each([
    ['null', null],
    ['a string', 'all'],
    ['a number', 5],
    ['an array', []],
    ['an empty object', {}],
    ['all: not an array', { all: 'x' }],
    ['all: empty array', { all: [] }],
    ['any: empty array', { any: [] }],
    [
      'all AND any together',
      {
        all: [leaf('hazardous_flag', 'equals', true)],
        any: [leaf('hazardous_flag', 'equals', true)],
      },
    ],
    [
      'all mixed with leaf keys',
      {
        all: [leaf('hazardous_flag', 'equals', true)],
        field: 'hazardous_flag',
      },
    ],
    [
      'all with an extra key',
      { all: [leaf('hazardous_flag', 'equals', true)], not: true },
    ],
    ['a child that is not an object', { all: ['x'] }],
    [
      'a leaf with an extra key',
      { field: 'hazardous_flag', op: 'equals', value: true, extra: 1 },
    ],
    ['a leaf missing value', { field: 'hazardous_flag', op: 'equals' }],
    ['a leaf missing op', { field: 'hazardous_flag', value: true }],
    ['a leaf missing field', { op: 'equals', value: true }],
    ['an unknown operator', leaf('hazardous_flag', 'contains' as never, true)],
    ['a non-string operator', { field: 'hazardous_flag', op: 5, value: true }],
    ['an unknown field', leaf('made_up_field', 'equals', 1)],
    ['a prototype-key field', leaf('__proto__', 'equals', 1)],
    ['a constructor field', leaf('constructor', 'equals', 1)],
    [
      'a camelCase field (fields are snake_case)',
      leaf('projectStage', 'equals', 'expansion'),
    ],
    ['boolean field with a string', leaf('hazardous_flag', 'equals', 'true')],
    ['number field with a string', leaf('employment_count', 'equals', '40')],
    ['number field with NaN', leaf('employment_count', 'gt', Number.NaN)],
    [
      'number field with Infinity',
      leaf('employment_count', 'lt', Number.POSITIVE_INFINITY),
    ],
    [
      'enum field with an unknown value',
      leaf('project_stage', 'equals', 'Greenfield'),
    ],
    [
      'enum in-list with an unknown member',
      leaf('project_stage', 'in', ['greenfield', 'nope']),
    ],
    ['text field with an empty string', leaf('district', 'equals', '   ')],
    [
      'text field with an over-long value',
      leaf('district', 'equals', 'x'.repeat(201)),
    ],
    ['in with a non-array', leaf('project_stage', 'in', 'greenfield')],
    ['in with an empty array', leaf('project_stage', 'in', [])],
    ['not_in with an empty array', leaf('project_stage', 'not_in', [])],
    ['gt on an enum field', leaf('project_stage', 'gt', 1)],
    ['lt on a boolean field', leaf('hazardous_flag', 'lt', 1)],
    ['between on a text field', leaf('district', 'between', ['a', 'b'])],
    ['between with one element', leaf('employment_count', 'between', [1])],
    [
      'between with three elements',
      leaf('employment_count', 'between', [1, 2, 3]),
    ],
    ['between with min > max', leaf('employment_count', 'between', [10, 1])],
    [
      'between with non-numbers',
      leaf('employment_count', 'between', ['a', 'b']),
    ],
    ['between with a non-array', leaf('employment_count', 'between', 5)],
  ])('rejects %s', (_name, c) => {
    expect(validateCondition(c).length).toBeGreaterThan(0);
  });

  it('reports the location of each problem', () => {
    expect(
      issuePaths({
        all: [
          leaf('hazardous_flag', 'equals', true),
          leaf('nope', 'equals', 1),
        ],
      }),
    ).toEqual(['all[1].field']);
    expect(
      issuePaths({
        all: [{ any: [leaf('employment_count', 'between', [5, 1])] }],
      }),
    ).toEqual(['all[0].any[0].value']);
  });

  it('reports every problem at once, not just the first', () => {
    const issues = validateCondition({
      all: [
        leaf('nope', 'equals', 1),
        leaf('employment_count', 'gt', 'x'),
        leaf('project_stage', 'in', []),
      ],
    });
    expect(issues.length).toBeGreaterThanOrEqual(3);
  });

  it('never throws, whatever it is given', () => {
    for (const bad of [
      undefined,
      null,
      Symbol.iterator as unknown,
      () => 1,
      new Date(),
      Object.create(null),
      [[]],
      { all: [null] },
    ]) {
      expect(() => validateCondition(bad)).not.toThrow();
      expect(validateCondition(bad).length).toBeGreaterThan(0);
    }
  });

  describe('resource limits', () => {
    const T = leaf('hazardous_flag', 'equals', true);

    it(`allows nesting up to ${MAX_CONDITION_DEPTH} levels and rejects deeper`, () => {
      let ok: Condition = T;
      for (let i = 1; i < MAX_CONDITION_DEPTH; i++) ok = { all: [ok] };
      expect(validateCondition(ok)).toEqual([]);
      expect(validateCondition({ all: [ok] }).length).toBeGreaterThan(0);
    });

    it(`allows ${MAX_CONDITION_NODES} nodes and rejects more`, () => {
      const at = (n: number) => ({
        all: Array.from({ length: n - 1 }, () => T),
      });
      expect(validateCondition(at(MAX_CONDITION_NODES))).toEqual([]);
      expect(
        validateCondition(at(MAX_CONDITION_NODES + 1)).length,
      ).toBeGreaterThan(0);
    });

    it(`rejects an in-list longer than ${MAX_LIST_VALUES}`, () => {
      const ok = leaf(
        'employment_count',
        'in',
        Array.from({ length: MAX_LIST_VALUES }, (_, i) => i),
      );
      const tooMany = leaf(
        'employment_count',
        'in',
        Array.from({ length: MAX_LIST_VALUES + 1 }, (_, i) => i),
      );
      expect(validateCondition(ok)).toEqual([]);
      expect(validateCondition(tooMany).length).toBeGreaterThan(0);
    });
  });
});

describe('the grammar is closed: there is no way to run code', () => {
  it('rejects expression-like values and keys instead of interpreting them', () => {
    for (const c of [
      { field: 'employment_count', op: 'gt', value: '1 + 1' },
      { field: 'employment_count', op: 'gt', value: { $expr: '1' } },
      { expr: 'inputs.employment_count > 5' },
      { field: 'employment_count', op: 'eval', value: 'process.exit()' },
      { field: 'employment_count > 5 || true', op: 'equals', value: 1 },
      { js: 'return true' },
    ]) {
      expect(validateCondition(c).length).toBeGreaterThan(0);
    }
  });
});
