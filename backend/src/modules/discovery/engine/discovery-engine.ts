import {
  Condition,
  ConditionIssue,
  ConditionTrace,
  describeOutcome,
  evaluateCondition,
  validateCondition,
} from './rule-condition';
import { DiscoveryInputs } from './discovery-fields';

/**
 * Bumped whenever the grammar or evaluation semantics change, and stored on
 * every snapshot, so an old result can always be tied to the semantics that
 * produced it.
 */
export const DISCOVERY_ENGINE_VERSION = '1.0.0';

/** Discovery is a recommendation, never a statutory determination (FRD
 * §10.3, §10.4). Returned with every result. */
export const DISCOVERY_NOTICE =
  'These approvals are potentially applicable, based only on the project details you entered and the rules the departments have configured. ' +
  'This is not a legal or statutory determination: an approval is shown as "Officially Required" only where the responsible department has confirmed the rule as authoritative. ' +
  'If a scenario has no configured rule, no approval is suggested for it — please consult the relevant department.';

export type ApprovalLabel = 'POTENTIALLY_APPLICABLE' | 'OFFICIALLY_REQUIRED';

export type NotApplicableReason =
  'CONDITIONS_NOT_MET' | 'EXCLUDED' | 'DEFINITION_INVALID';

/**
 * One rule version, self-contained: everything the engine needs, and
 * everything worth keeping on a snapshot. Plain JSON — no database types.
 * The engine reads ONLY this and the inputs, so re-running it on a stored
 * descriptor reproduces the original result exactly.
 */
export interface RuleDescriptor {
  ruleId: string;
  version: number;
  priority: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  isOfficiallyRequired: boolean;
  sourceReference: string;
  conditions: unknown;
  excludesIf: unknown | null;
  approvalType: {
    id: string;
    name: string;
    legalName: string | null;
    legalReference: string | null;
  };
  department: { id: string; code: string; name: string };
  dependsOn: Array<{ approvalTypeId: string; name: string }>;
}

interface ResultRuleRef {
  id: string;
  version: number;
  priority: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  sourceReference: string;
}

interface ResultApprovalRef {
  id: string;
  name: string;
  legalName: string | null;
  legalReference: string | null;
}

export interface ApplicableApproval {
  approvalType: ResultApprovalRef;
  department: { id: string; code: string; name: string };
  rule: ResultRuleRef;
  label: ApprovalLabel;
  explanation: string;
  trace: ConditionTrace;
  dependsOn: Array<{
    approvalTypeId: string;
    name: string;
    /** Whether that prerequisite is itself among this run's applicable
     * approvals. Relationship only — application status is a later step. */
    alsoApplicable: boolean;
  }>;
}

export interface NotApplicableRule {
  approvalType: ResultApprovalRef;
  department: { id: string; code: string; name: string };
  rule: ResultRuleRef;
  reason: NotApplicableReason;
  explanation: string;
  trace: ConditionTrace | null;
  /** Only for DEFINITION_INVALID. */
  issues?: ConditionIssue[];
}

export interface DiscoveryEngineResult {
  applicable: ApplicableApproval[];
  notApplicable: NotApplicableRule[];
  matchedApprovalTypeIds: string[];
  summary: {
    rulesEvaluated: number;
    applicableCount: number;
    notApplicableCount: number;
  };
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Total, input-order-independent ordering: priority, then department code,
 * then approval name, then rule id. */
function compareRules(a: RuleDescriptor, b: RuleDescriptor): number {
  return (
    a.priority - b.priority ||
    compareStrings(a.department.code, b.department.code) ||
    compareStrings(a.approvalType.name, b.approvalType.name) ||
    compareStrings(a.ruleId, b.ruleId)
  );
}

function ruleRef(rule: RuleDescriptor): ResultRuleRef {
  return {
    id: rule.ruleId,
    version: rule.version,
    priority: rule.priority,
    effectiveFrom: rule.effectiveFrom,
    effectiveTo: rule.effectiveTo,
    sourceReference: rule.sourceReference,
  };
}

/**
 * Evaluates rule versions against project inputs. PURE and DETERMINISTIC:
 * the output depends only on the arguments (never on time, randomness, the
 * database, or the order the rules are passed in), so it can be re-run on a
 * stored snapshot and must reproduce it. No I/O, no framework, no AI.
 *
 * Per rule (Blueprint §10.5):
 *   1. an invalid stored definition is reported, never evaluated or guessed;
 *   2. `conditions` must hold, else CONDITIONS_NOT_MET;
 *   3. `excludes_if`, if present and true, removes it as EXCLUDED;
 *   4. otherwise the approval is applicable, labelled "Potentially
 *      Applicable" unless the rule is flagged officially required (FRD §10.3).
 * One rule's outcome never affects another's.
 */
export function evaluateDiscovery(
  rules: readonly RuleDescriptor[],
  inputs: DiscoveryInputs,
): DiscoveryEngineResult {
  const ordered = [...rules].sort(compareRules);

  const applicable: ApplicableApproval[] = [];
  const notApplicable: NotApplicableRule[] = [];

  for (const rule of ordered) {
    const base = {
      approvalType: { ...rule.approvalType },
      department: { ...rule.department },
      rule: ruleRef(rule),
    };

    const issues = validateCondition(rule.conditions);
    if (rule.excludesIf !== null && rule.excludesIf !== undefined) {
      for (const issue of validateCondition(rule.excludesIf)) {
        issues.push({ ...issue, path: `excludes_if:${issue.path}` });
      }
    }
    if (issues.length > 0) {
      notApplicable.push({
        ...base,
        reason: 'DEFINITION_INVALID',
        explanation:
          'This rule’s definition is invalid, so it was not evaluated and no approval is suggested from it.',
        trace: null,
        issues,
      });
      continue;
    }

    const trace = evaluateCondition(rule.conditions as Condition, inputs);
    if (!trace.result) {
      notApplicable.push({
        ...base,
        reason: 'CONDITIONS_NOT_MET',
        explanation: `Not suggested because: ${describeOutcome(trace, false).join('; ')}.`,
        trace,
      });
      continue;
    }

    if (rule.excludesIf !== null && rule.excludesIf !== undefined) {
      const exclusion = evaluateCondition(rule.excludesIf as Condition, inputs);
      if (exclusion.result) {
        notApplicable.push({
          ...base,
          reason: 'EXCLUDED',
          explanation: `Excluded because: ${describeOutcome(exclusion, true).join('; ')}.`,
          trace: exclusion,
        });
        continue;
      }
    }

    applicable.push({
      ...base,
      label: rule.isOfficiallyRequired
        ? 'OFFICIALLY_REQUIRED'
        : 'POTENTIALLY_APPLICABLE',
      explanation: `Shown because: ${describeOutcome(trace, true).join('; ')}.`,
      trace,
      dependsOn: [],
    });
  }

  const matchedApprovalTypeIds = [
    ...new Set(applicable.map((a) => a.approvalType.id)),
  ];
  const matched = new Set(matchedApprovalTypeIds);
  const dependenciesByType = new Map(
    ordered.map((r) => [r.approvalType.id, r.dependsOn] as const),
  );
  for (const item of applicable) {
    item.dependsOn = (dependenciesByType.get(item.approvalType.id) ?? [])
      .map((d) => ({
        approvalTypeId: d.approvalTypeId,
        name: d.name,
        alsoApplicable: matched.has(d.approvalTypeId),
      }))
      .sort(
        (a, b) =>
          compareStrings(a.name, b.name) ||
          compareStrings(a.approvalTypeId, b.approvalTypeId),
      );
  }

  return {
    applicable,
    notApplicable,
    matchedApprovalTypeIds,
    summary: {
      rulesEvaluated: ordered.length,
      applicableCount: applicable.length,
      notApplicableCount: notApplicable.length,
    },
  };
}
