import { DiscoveryInputs } from '../discovery/engine/discovery-fields';
import {
  SCHEME_ENGINE_VERSION,
  SchemeRuleDescriptor,
  evaluateSchemeRecommendations,
  evaluateSchemeRule,
} from './scheme-engine';
import { RECOMMENDATION_NOTICE } from './scheme.constants';

/** Test fixtures only - no real scheme, department or threshold. */
const INPUTS: DiscoveryInputs = {
  sector_code: '25910',
  district: 'Pune',
  taluka: 'Khed',
  industrial_area: null,
  enterprise_size_band: 'small',
  investment_amount: 25_000_000,
  employment_count: 40,
  project_stage: 'expansion',
  land_status: 'owned',
  construction_status: 'not_started',
  production_status: 'pre_production',
  hazardous_flag: false,
  hazardous_category: null,
  environmental_category: null,
  enterprise_type: 'Private Limited Company',
};

function rule(
  id: string,
  conditions: unknown,
  over: Partial<SchemeRuleDescriptor> & {
    schemeName?: string;
    deptCode?: string;
  } = {},
): SchemeRuleDescriptor {
  return {
    ruleId: id,
    version: over.version ?? 1,
    priority: over.priority ?? 100,
    effectiveFrom: '2026-01-01T00:00:00.000Z',
    effectiveTo: null,
    sourceReference: 'TEST FIXTURE',
    conditions,
    scheme: {
      id: `scheme-${id}`,
      name: over.schemeName ?? `Scheme ${id}`,
      benefitType: null,
    },
    department: {
      id: `dept-${over.deptCode ?? 'D1'}`,
      code: over.deptCode ?? 'D1',
      name: 'Test Department',
    },
  };
}

const MATCH = { field: 'district', op: 'equals', value: 'pune' };
const NO_MATCH = { field: 'district', op: 'equals', value: 'nagpur' };

describe('evaluateSchemeRecommendations', () => {
  it('suggests a scheme whose conditions hold, labelled "may be eligible" with the FRD 29.4 notice - never "eligible"', () => {
    const result = evaluateSchemeRecommendations([rule('a', MATCH)], INPUTS);
    expect(result.recommended).toHaveLength(1);
    const [r] = result.recommended;
    expect(r.label).toBe('MAY_BE_ELIGIBLE');
    expect(r.notice).toBe(RECOMMENDATION_NOTICE);
    expect(r.notice).toContain('not an official eligibility determination');
    expect(r.rank).toBe(1);
    expect(r.rule).toMatchObject({
      id: 'a',
      version: 1,
      sourceReference: 'TEST FIXTURE',
    });
    expect(r.explanation).toMatch(/^Suggested because:/);
    expect(JSON.stringify(result)).not.toMatch(/"eligible"|OFFICIALLY/);
  });

  it('explains why a scheme is not suggested', () => {
    const result = evaluateSchemeRecommendations([rule('a', NO_MATCH)], INPUTS);
    expect(result.recommended).toEqual([]);
    expect(result.notRecommended[0]).toMatchObject({
      reason: 'CONDITIONS_NOT_MET',
    });
    expect(result.notRecommended[0].explanation).toMatch(
      /^Not suggested because:/,
    );
    expect(result.summary).toEqual({
      rulesEvaluated: 1,
      recommendedCount: 0,
      notRecommendedCount: 1,
    });
  });

  it('evaluates sector, location, size and investment-threshold criteria (the documented ones) with the shared grammar', () => {
    const all = rule('a', {
      all: [
        { field: 'sector_code', op: 'in', value: ['25910', '25920'] },
        { field: 'district', op: 'in', value: ['Pune', 'Nashik'] },
        { field: 'enterprise_size_band', op: 'equals', value: 'small' },
        {
          field: 'investment_amount',
          op: 'between',
          value: [1_000_000, 50_000_000],
        },
      ],
    });
    expect(
      evaluateSchemeRecommendations([all], INPUTS).recommended,
    ).toHaveLength(1);

    const tooBig = rule('b', {
      field: 'investment_amount',
      op: 'gt',
      value: 50_000_000,
    });
    expect(
      evaluateSchemeRecommendations([tooBig], INPUTS).recommended,
    ).toHaveLength(0);
  });

  it('never suggests a scheme from a missing answer (unknown never matches)', () => {
    const r = rule('a', {
      field: 'industrial_area',
      op: 'not_in',
      value: ['x'],
    });
    expect(evaluateSchemeRecommendations([r], INPUTS).recommended).toEqual([]);
  });

  it('reports an invalid stored definition instead of guessing, and it never blocks the others', () => {
    const invalid = rule('bad', {
      field: 'no_such_field',
      op: 'equals',
      value: 1,
    });
    const result = evaluateSchemeRecommendations(
      [invalid, rule('ok', MATCH)],
      INPUTS,
    );
    expect(result.recommended.map((r) => r.rule.id)).toEqual(['ok']);
    expect(result.notRecommended[0]).toMatchObject({
      reason: 'DEFINITION_INVALID',
    });
    expect(result.notRecommended[0].issues?.length).toBeGreaterThan(0);
    expect(result.notRecommended[0].trace).toBeNull();
  });

  it('ranks by the department priority, then department code, scheme name and ids - independent of input order', () => {
    const rules = [
      rule('r1', MATCH, { priority: 50, schemeName: 'Zeta', deptCode: 'B' }),
      rule('r2', MATCH, { priority: 10, schemeName: 'Omega', deptCode: 'B' }),
      rule('r3', MATCH, { priority: 50, schemeName: 'Alpha', deptCode: 'B' }),
      rule('r4', MATCH, { priority: 50, schemeName: 'Zeta', deptCode: 'A' }),
    ];
    const expected = ['r2', 'r4', 'r3', 'r1'];
    const forward = evaluateSchemeRecommendations(rules, INPUTS);
    const reversed = evaluateSchemeRecommendations(
      [...rules].reverse(),
      INPUTS,
    );
    expect(forward.recommended.map((r) => r.rule.id)).toEqual(expected);
    expect(reversed.recommended.map((r) => r.rule.id)).toEqual(expected);
    expect(forward.recommended.map((r) => r.rank)).toEqual([1, 2, 3, 4]);
  });

  it('is deterministic and pure: the same inputs give the same result and nothing is mutated', () => {
    const rules = [rule('a', MATCH), rule('b', NO_MATCH)];
    const snapshot = JSON.stringify(rules);
    const first = evaluateSchemeRecommendations(rules, INPUTS);
    const second = evaluateSchemeRecommendations(rules, INPUTS);
    expect(second).toEqual(first);
    expect(JSON.stringify(rules)).toBe(snapshot);
  });

  it('returns an empty, explicit result when no rule is configured', () => {
    expect(evaluateSchemeRecommendations([], INPUTS)).toEqual({
      recommended: [],
      notRecommended: [],
      summary: {
        rulesEvaluated: 0,
        recommendedCount: 0,
        notRecommendedCount: 0,
      },
    });
  });

  it('evaluates a single rule the same way (used for the snapshot taken when applying)', () => {
    expect(evaluateSchemeRule({ conditions: MATCH }, INPUTS).kind).toBe(
      'RECOMMENDED',
    );
    expect(evaluateSchemeRule({ conditions: NO_MATCH }, INPUTS).kind).toBe(
      'NOT_RECOMMENDED',
    );
    expect(SCHEME_ENGINE_VERSION).toBe('1.0.0');
  });
});
