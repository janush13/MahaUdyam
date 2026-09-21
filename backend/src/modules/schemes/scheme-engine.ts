import {
  Condition,
  ConditionIssue,
  ConditionTrace,
  describeOutcome,
  evaluateCondition,
  validateCondition,
} from '../discovery/engine/rule-condition';
import { DiscoveryInputs } from '../discovery/engine/discovery-fields';
import { RECOMMENDATION_NOTICE } from './scheme.constants';

/**
 * Bumped whenever the evaluation semantics change and stored with what it
 * produced, so an old recommendation can always be tied to the semantics that
 * produced it.
 */
export const SCHEME_ENGINE_VERSION = '1.0.0';

/** The ONLY label a scheme can carry. There is deliberately no "eligible" /
 * "officially eligible": FRD 29.4 / TRD 15 - the system suggests, the Scheme
 * Officer's own verification is the determination. */
export type SchemeRecommendationLabel = 'MAY_BE_ELIGIBLE';

export type NotRecommendedReason = 'CONDITIONS_NOT_MET' | 'DEFINITION_INVALID';

/**
 * One scheme's rule version, self-contained: everything the engine needs. Plain
 * JSON - no database types. The engine reads ONLY this and the inputs, so
 * re-running it on a stored descriptor reproduces the original result.
 */
export interface SchemeRuleDescriptor {
  ruleId: string;
  version: number;
  priority: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  sourceReference: string;
  conditions: unknown;
  scheme: { id: string; name: string; benefitType: string | null };
  department: { id: string; code: string; name: string };
}

interface RuleRef {
  id: string;
  version: number;
  priority: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  sourceReference: string;
}

interface SchemeRef {
  id: string;
  name: string;
  benefitType: string | null;
}

export interface RecommendedScheme {
  /** 1-based position in the ranking. */
  rank: number;
  scheme: SchemeRef;
  department: { id: string; code: string; name: string };
  rule: RuleRef;
  label: SchemeRecommendationLabel;
  notice: string;
  explanation: string;
  trace: ConditionTrace;
}

export interface NotRecommendedScheme {
  scheme: SchemeRef;
  department: { id: string; code: string; name: string };
  rule: RuleRef;
  reason: NotRecommendedReason;
  explanation: string;
  trace: ConditionTrace | null;
  /** Only for DEFINITION_INVALID. */
  issues?: ConditionIssue[];
}

export interface SchemeEngineResult {
  recommended: RecommendedScheme[];
  notRecommended: NotRecommendedScheme[];
  summary: {
    rulesEvaluated: number;
    recommendedCount: number;
    notRecommendedCount: number;
  };
}

/** One rule's outcome, before ranking. */
export type SchemeRuleOutcome =
  | {
      kind: 'RECOMMENDED';
      explanation: string;
      trace: ConditionTrace;
    }
  | {
      kind: 'NOT_RECOMMENDED';
      reason: NotRecommendedReason;
      explanation: string;
      trace: ConditionTrace | null;
      issues?: ConditionIssue[];
    };

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Total, input-order-independent ranking: the department's own `priority`
 * (lower first), then department code, scheme name, scheme id and rule id. The
 * requirements define no ranking criterion (TRD 15 "ranked list"), and no ML
 * ranking is built (Blueprint 3), so nothing else influences the order. */
function compareRules(
  a: SchemeRuleDescriptor,
  b: SchemeRuleDescriptor,
): number {
  return (
    a.priority - b.priority ||
    compareStrings(a.department.code, b.department.code) ||
    compareStrings(a.scheme.name, b.scheme.name) ||
    compareStrings(a.scheme.id, b.scheme.id) ||
    compareStrings(a.ruleId, b.ruleId)
  );
}

function ruleRef(rule: SchemeRuleDescriptor): RuleRef {
  return {
    id: rule.ruleId,
    version: rule.version,
    priority: rule.priority,
    effectiveFrom: rule.effectiveFrom,
    effectiveTo: rule.effectiveTo,
    sourceReference: rule.sourceReference,
  };
}

/** Evaluates ONE rule version. An invalid stored definition is reported, never
 * evaluated or guessed at. Pure. */
export function evaluateSchemeRule(
  rule: Pick<SchemeRuleDescriptor, 'conditions'>,
  inputs: DiscoveryInputs,
): SchemeRuleOutcome {
  const issues = validateCondition(rule.conditions);
  if (issues.length > 0) {
    return {
      kind: 'NOT_RECOMMENDED',
      reason: 'DEFINITION_INVALID',
      explanation:
        'This scheme’s eligibility rule is invalid, so it was not evaluated and the scheme is not suggested.',
      trace: null,
      issues,
    };
  }
  const trace = evaluateCondition(rule.conditions as Condition, inputs);
  if (!trace.result) {
    return {
      kind: 'NOT_RECOMMENDED',
      reason: 'CONDITIONS_NOT_MET',
      explanation: `Not suggested because: ${describeOutcome(trace, false).join('; ')}.`,
      trace,
    };
  }
  return {
    kind: 'RECOMMENDED',
    explanation: `Suggested because: ${describeOutcome(trace, true).join('; ')}.`,
    trace,
  };
}

/**
 * Evaluates rule versions against a project's characteristics. PURE and
 * DETERMINISTIC: the output depends only on the arguments (never on time,
 * randomness, the database, or the order the rules are passed in). No I/O, no
 * framework, no AI - the same condition grammar and evaluator as approval
 * discovery (Blueprint 8.2 "the exact same rule-evaluation code path"), applied
 * to a different rule set.
 *
 * The result is a RECOMMENDATION: a scheme whose conditions hold is labelled
 * "may be eligible" and carries the FRD 29.4 notice; it is never called
 * eligible, and one rule's outcome never affects another's.
 */
export function evaluateSchemeRecommendations(
  rules: readonly SchemeRuleDescriptor[],
  inputs: DiscoveryInputs,
): SchemeEngineResult {
  const ordered = [...rules].sort(compareRules);
  const recommended: RecommendedScheme[] = [];
  const notRecommended: NotRecommendedScheme[] = [];

  for (const rule of ordered) {
    const base = {
      scheme: { ...rule.scheme },
      department: { ...rule.department },
      rule: ruleRef(rule),
    };
    const outcome = evaluateSchemeRule(rule, inputs);
    if (outcome.kind === 'RECOMMENDED') {
      recommended.push({
        rank: recommended.length + 1,
        ...base,
        label: 'MAY_BE_ELIGIBLE',
        notice: RECOMMENDATION_NOTICE,
        explanation: outcome.explanation,
        trace: outcome.trace,
      });
    } else {
      notRecommended.push({
        ...base,
        reason: outcome.reason,
        explanation: outcome.explanation,
        trace: outcome.trace,
        ...(outcome.issues ? { issues: outcome.issues } : {}),
      });
    }
  }

  return {
    recommended,
    notRecommended,
    summary: {
      rulesEvaluated: ordered.length,
      recommendedCount: recommended.length,
      notRecommendedCount: notRecommended.length,
    },
  };
}
