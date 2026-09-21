import {
  DiscoveryInputs,
  DiscoveryValue,
  FieldDefinition,
  getFieldDefinition,
} from './discovery-fields';

/**
 * The declarative rule-condition grammar (Blueprint §10.3/§10.5) — and
 * nothing else. Data, never code: a condition is plain JSON that is
 * validated against this closed grammar and then interpreted by the small
 * evaluator below. There is no expression language, no `eval`/`Function`, no
 * user-supplied code path, and no AI/LLM anywhere in this module.
 *
 *   node   := all | any | leaf
 *   all    := { "all": [node, ...] }            every child must hold
 *   any    := { "any": [node, ...] }            at least one child must hold
 *   leaf   := { "field": F, "op": OP, "value": V }
 *
 *   equals   value is a scalar
 *   in       value is a non-empty array of scalars     (field is any of them)
 *   not_in   value is a non-empty array of scalars     (field is none of them)
 *   gt / lt  value is a number                         (strict; numeric fields)
 *   between  value is [min, max], min <= max           (inclusive; numeric fields)
 *
 * Semantics worth stating once:
 *  - A field with no value (null — an optional characteristic left blank)
 *    makes EVERY leaf false, including `not_in`. Unknown never matches, so a
 *    missing answer can never make an approval look applicable by accident.
 *  - `text` fields compare trimmed and case-insensitively; everything else
 *    compares exactly.
 */
export const CONDITION_OPERATORS = [
  'equals',
  'in',
  'not_in',
  'gt',
  'lt',
  'between',
] as const;
export type ConditionOperator = (typeof CONDITION_OPERATORS)[number];

export interface LeafCondition {
  field: string;
  op: ConditionOperator;
  value: unknown;
}
export interface AllCondition {
  all: Condition[];
}
export interface AnyCondition {
  any: Condition[];
}
export type Condition = AllCondition | AnyCondition | LeafCondition;

/** Hard limits, so a stored rule can never be a resource-exhaustion vector. */
export const MAX_CONDITION_DEPTH = 6;
export const MAX_CONDITION_NODES = 50;
export const MAX_LIST_VALUES = 100;
export const MAX_TEXT_VALUE_LENGTH = 200;

export interface ConditionIssue {
  /** Location within the definition, e.g. `all[1].value`. */
  path: string;
  message: string;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateScalar(
  field: FieldDefinition,
  value: unknown,
  path: string,
  issues: ConditionIssue[],
): void {
  switch (field.kind) {
    case 'boolean':
      if (typeof value !== 'boolean') {
        issues.push({ path, message: 'must be a boolean' });
      }
      return;
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        issues.push({ path, message: 'must be a finite number' });
      }
      return;
    case 'enum':
      if (typeof value !== 'string' || !field.values?.includes(value)) {
        issues.push({
          path,
          message: `must be one of: ${(field.values ?? []).join(', ')}`,
        });
      }
      return;
    case 'text':
      if (
        typeof value !== 'string' ||
        value.trim().length === 0 ||
        value.length > MAX_TEXT_VALUE_LENGTH
      ) {
        issues.push({
          path,
          message: `must be a non-empty string of at most ${MAX_TEXT_VALUE_LENGTH} characters`,
        });
      }
      return;
  }
}

function validateLeaf(
  node: Record<string, unknown>,
  path: string,
  issues: ConditionIssue[],
): void {
  const extra = Object.keys(node).filter(
    (k) => k !== 'field' && k !== 'op' && k !== 'value',
  );
  if (extra.length > 0) {
    issues.push({ path, message: `unknown key(s): ${extra.join(', ')}` });
  }

  const fieldName = node.field;
  const field =
    typeof fieldName === 'string' ? getFieldDefinition(fieldName) : undefined;
  if (!field) {
    issues.push({
      path: `${path}.field`,
      message: `unknown field${typeof fieldName === 'string' ? ` "${fieldName}"` : ''}`,
    });
  }

  const op = node.op;
  if (
    typeof op !== 'string' ||
    !(CONDITION_OPERATORS as readonly string[]).includes(op)
  ) {
    issues.push({
      path: `${path}.op`,
      message: `operator must be one of: ${CONDITION_OPERATORS.join(', ')}`,
    });
    return;
  }
  if (!('value' in node)) {
    issues.push({ path: `${path}.value`, message: 'is required' });
    return;
  }
  if (!field) {
    return;
  }

  const valuePath = `${path}.value`;
  const value = node.value;

  if (op === 'gt' || op === 'lt' || op === 'between') {
    if (field.kind !== 'number') {
      issues.push({
        path: `${path}.op`,
        message: `"${op}" is only valid for numeric fields`,
      });
      return;
    }
  }

  switch (op) {
    case 'equals':
      validateScalar(field, value, valuePath, issues);
      return;
    case 'in':
    case 'not_in':
      if (
        !Array.isArray(value) ||
        value.length === 0 ||
        value.length > MAX_LIST_VALUES
      ) {
        issues.push({
          path: valuePath,
          message: `must be an array of 1 to ${MAX_LIST_VALUES} values`,
        });
        return;
      }
      value.forEach((item, i) =>
        validateScalar(field, item, `${valuePath}[${i}]`, issues),
      );
      return;
    case 'gt':
    case 'lt':
      validateScalar(field, value, valuePath, issues);
      return;
    case 'between': {
      if (!Array.isArray(value) || value.length !== 2) {
        issues.push({ path: valuePath, message: 'must be [min, max]' });
        return;
      }
      const before = issues.length;
      value.forEach((item, i) =>
        validateScalar(field, item, `${valuePath}[${i}]`, issues),
      );
      if (
        issues.length === before &&
        (value[0] as number) > (value[1] as number)
      ) {
        issues.push({ path: valuePath, message: 'min must not exceed max' });
      }
      return;
    }
  }
}

/**
 * Validates a condition against the grammar. Returns every problem found
 * (empty = valid). Pure; never throws on bad input.
 */
export function validateCondition(node: unknown): ConditionIssue[] {
  const issues: ConditionIssue[] = [];
  let nodeCount = 0;

  const visit = (current: unknown, path: string, depth: number): void => {
    nodeCount += 1;
    if (nodeCount > MAX_CONDITION_NODES) {
      if (nodeCount === MAX_CONDITION_NODES + 1) {
        issues.push({
          path,
          message: `too many conditions (maximum ${MAX_CONDITION_NODES})`,
        });
      }
      return;
    }
    if (depth > MAX_CONDITION_DEPTH) {
      issues.push({
        path,
        message: `nested too deeply (maximum ${MAX_CONDITION_DEPTH} levels)`,
      });
      return;
    }
    if (!isPlainObject(current)) {
      issues.push({ path: path || '$', message: 'must be an object' });
      return;
    }

    const hasAll = 'all' in current;
    const hasAny = 'any' in current;
    const hasLeafKey =
      'field' in current || 'op' in current || 'value' in current;

    if (hasAll || hasAny) {
      if (hasLeafKey || (hasAll && hasAny)) {
        issues.push({
          path: path || '$',
          message:
            'a node is exactly one of: all, any, or a field/op/value condition',
        });
        return;
      }
      const key = hasAll ? 'all' : 'any';
      const extra = Object.keys(current).filter((k) => k !== key);
      if (extra.length > 0) {
        issues.push({
          path: path || '$',
          message: `unknown key(s): ${extra.join(', ')}`,
        });
      }
      const children = current[key];
      if (!Array.isArray(children) || children.length === 0) {
        issues.push({
          path: `${path}${path ? '.' : ''}${key}`,
          message: 'must be a non-empty array',
        });
        return;
      }
      children.forEach((child, i) =>
        visit(child, `${path}${path ? '.' : ''}${key}[${i}]`, depth + 1),
      );
      return;
    }

    validateLeaf(current, path || '$', issues);
  };

  visit(node, '', 1);
  return issues;
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

export type ConditionTrace =
  | { kind: 'all' | 'any'; result: boolean; children: ConditionTrace[] }
  | {
      kind: 'condition';
      field: string;
      op: ConditionOperator;
      expected: unknown;
      actual: DiscoveryValue;
      result: boolean;
    };

function normaliseText(value: unknown): string {
  return String(value).trim().toLowerCase();
}

function valuesEqual(
  field: FieldDefinition,
  actual: DiscoveryValue,
  expected: unknown,
): boolean {
  return field.kind === 'text'
    ? normaliseText(actual) === normaliseText(expected)
    : actual === expected;
}

function evaluateLeaf(
  leaf: LeafCondition,
  field: FieldDefinition,
  actual: DiscoveryValue,
): boolean {
  // Unknown never matches — not even `not_in` (see the grammar notes).
  if (actual === null || actual === undefined) {
    return false;
  }
  switch (leaf.op) {
    case 'equals':
      return valuesEqual(field, actual, leaf.value);
    case 'in':
      return (leaf.value as unknown[]).some((v) =>
        valuesEqual(field, actual, v),
      );
    case 'not_in':
      return !(leaf.value as unknown[]).some((v) =>
        valuesEqual(field, actual, v),
      );
    case 'gt':
      return (actual as number) > (leaf.value as number);
    case 'lt':
      return (actual as number) < (leaf.value as number);
    case 'between': {
      const [min, max] = leaf.value as [number, number];
      return (actual as number) >= min && (actual as number) <= max;
    }
  }
}

/**
 * Evaluates an ALREADY-VALIDATED condition and returns the full evidence
 * tree. Deliberately does not short-circuit: every child is evaluated, so the
 * explanation is complete, and the result depends only on (condition,
 * inputs) — never on evaluation order, time, or anything outside the inputs.
 */
export function evaluateCondition(
  node: Condition,
  inputs: DiscoveryInputs,
): ConditionTrace {
  if ('all' in node) {
    const children = node.all.map((c) => evaluateCondition(c, inputs));
    return { kind: 'all', result: children.every((c) => c.result), children };
  }
  if ('any' in node) {
    const children = node.any.map((c) => evaluateCondition(c, inputs));
    return { kind: 'any', result: children.some((c) => c.result), children };
  }

  const field = getFieldDefinition(node.field);
  if (!field) {
    // Unreachable for validated input; fail closed rather than guess.
    return {
      kind: 'condition',
      field: node.field,
      op: node.op,
      expected: node.value,
      actual: null,
      result: false,
    };
  }
  const actual = Object.prototype.hasOwnProperty.call(inputs, node.field)
    ? inputs[node.field]
    : null;
  return {
    kind: 'condition',
    field: node.field,
    op: node.op,
    expected: node.value,
    actual,
    result: evaluateLeaf(node, field, actual),
  };
}

// ---------------------------------------------------------------------------
// Plain-language explanation (FRD §10.2 "why it may be applicable")
// ---------------------------------------------------------------------------

function formatValue(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(formatValue).join(', ')}]`;
  }
  return value === null || value === undefined ? 'not provided' : String(value);
}

function describeLeaf(
  t: Extract<ConditionTrace, { kind: 'condition' }>,
): string {
  let phrase: string;
  switch (t.op) {
    case 'equals':
      phrase = `equals ${formatValue(t.expected)}`;
      break;
    case 'in':
      phrase = `is one of ${formatValue(t.expected)}`;
      break;
    case 'not_in':
      phrase = `is not one of ${formatValue(t.expected)}`;
      break;
    case 'gt':
      phrase = `is greater than ${formatValue(t.expected)}`;
      break;
    case 'lt':
      phrase = `is less than ${formatValue(t.expected)}`;
      break;
    case 'between': {
      const [min, max] = t.expected as [number, number];
      phrase = `is between ${min} and ${max} (inclusive)`;
      break;
    }
  }
  return `${t.field} ${phrase} (project value: ${formatValue(t.actual)})`;
}

/**
 * The individual conditions whose outcome equals `outcome`. For a matched
 * `all` that is every child; for a matched `any` only the children that were
 * true; for a failed `all` only the children that were false; for a failed
 * `any` every child. Ordered as written, so the text is deterministic.
 */
export function describeOutcome(
  trace: ConditionTrace,
  outcome: boolean,
): string[] {
  if (trace.kind === 'condition') {
    return trace.result === outcome ? [describeLeaf(trace)] : [];
  }
  return trace.children
    .filter((c) => c.result === outcome)
    .flatMap((c) => describeOutcome(c, outcome));
}
