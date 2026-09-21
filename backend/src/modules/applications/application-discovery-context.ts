import { ApplicableApproval } from '../discovery/engine/discovery-engine';

/**
 * The copy of one discovery result entry kept ON the application row
 * (`approval_applications.discovery_context`), so "which rule / discovery
 * context was used for this application?" is answerable from the application
 * alone and can never change: the snapshot it came from is immutable (database
 * trigger) and the application's link to it is immutable too.
 *
 * It is a RECOMMENDATION record: the label is "Potentially Applicable" unless
 * a department flagged the rule authoritative (FRD §10.3). It says nothing
 * about a statutory decision.
 */
export interface ApplicationDiscoveryContext {
  snapshotId: string;
  snapshotEvaluatedAt: string;
  engineVersion: string;
  recommendationLabel: ApplicableApproval['label'];
  rule: { id: string; version: number; sourceReference: string };
  department: { id: string; code: string; name: string };
  explanation: string;
}

export function buildDiscoveryContext(
  snapshot: { id: string; evaluatedAt: Date; engineVersion: string },
  entry: ApplicableApproval,
): ApplicationDiscoveryContext {
  return {
    snapshotId: snapshot.id,
    snapshotEvaluatedAt: snapshot.evaluatedAt.toISOString(),
    engineVersion: snapshot.engineVersion,
    recommendationLabel: entry.label,
    rule: {
      id: entry.rule.id,
      version: entry.rule.version,
      sourceReference: entry.rule.sourceReference,
    },
    department: {
      id: entry.department.id,
      code: entry.department.code,
      name: entry.department.name,
    },
    explanation: entry.explanation,
  };
}

/** `<ruleId>@v<version>` — the form stored in audit_logs.rule_version_used. */
export function ruleVersionLabel(
  context: Pick<ApplicationDiscoveryContext, 'rule'> | null | undefined,
): string | null {
  return context ? `${context.rule.id}@v${context.rule.version}` : null;
}
