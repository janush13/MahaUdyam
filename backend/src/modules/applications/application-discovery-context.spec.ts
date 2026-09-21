import { ApplicableApproval } from '../discovery/engine/discovery-engine';
import {
  buildDiscoveryContext,
  ruleVersionLabel,
} from './application-discovery-context';

const makeEntry = (label = 'POTENTIALLY_APPLICABLE') =>
  ({
    approvalType: {
      id: 'type-1',
      name: 'Type A',
      legalName: null,
      legalReference: null,
    },
    department: { id: 'd1', code: 'DEPT-A', name: 'Dept A' },
    rule: {
      id: 'rule-1',
      version: 3,
      priority: 100,
      effectiveFrom: '2026-01-01T00:00:00.000Z',
      effectiveTo: null,
      sourceReference: 'TBD',
    },
    label,
    explanation: 'Shown because: hazardous_flag equals true.',
    trace: { kind: 'all', result: true, children: [] },
    dependsOn: [],
  }) as unknown as ApplicableApproval;

describe('discovery context', () => {
  const snapshot = {
    id: 'snap-1',
    evaluatedAt: new Date('2026-09-19T10:00:00.000Z'),
    engineVersion: '1.0.0',
  };

  it('copies exactly the rule/discovery facts needed to answer "which rule was used"', () => {
    expect(buildDiscoveryContext(snapshot, makeEntry())).toEqual({
      snapshotId: 'snap-1',
      snapshotEvaluatedAt: '2026-09-19T10:00:00.000Z',
      engineVersion: '1.0.0',
      recommendationLabel: 'POTENTIALLY_APPLICABLE',
      rule: { id: 'rule-1', version: 3, sourceReference: 'TBD' },
      department: { id: 'd1', code: 'DEPT-A', name: 'Dept A' },
      explanation: 'Shown because: hazardous_flag equals true.',
    });
  });

  it('keeps the recommendation label as discovery set it (never upgrades it)', () => {
    const context = buildDiscoveryContext(
      snapshot,
      makeEntry('OFFICIALLY_REQUIRED'),
    );
    expect(context.recommendationLabel).toBe('OFFICIALLY_REQUIRED');
  });

  it('does not alias the source entry (later mutation cannot rewrite it)', () => {
    const entry = makeEntry();
    const context = buildDiscoveryContext(snapshot, entry);
    (entry.rule as { version: number }).version = 99;
    expect(context.rule.version).toBe(3);
  });

  it('formats the audit rule-version label', () => {
    expect(ruleVersionLabel(buildDiscoveryContext(snapshot, makeEntry()))).toBe(
      'rule-1@v3',
    );
    expect(ruleVersionLabel(null)).toBeNull();
    expect(ruleVersionLabel(undefined)).toBeNull();
  });
});
