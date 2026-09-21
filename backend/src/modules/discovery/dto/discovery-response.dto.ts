import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class ApprovalRefDto {
  @ApiProperty() id: string;
  @ApiProperty({ description: 'Plain-language name.' }) name: string;
  @ApiProperty({
    nullable: true,
    description: 'Official / legal name, where configured.',
  })
  legalName: string | null;
  @ApiProperty({ nullable: true }) legalReference: string | null;
}

class DepartmentRefDto {
  @ApiProperty() id: string;
  @ApiProperty() code: string;
  @ApiProperty() name: string;
}

class RuleRefDto {
  @ApiProperty({ description: 'The exact rule version evaluated.' }) id: string;
  @ApiProperty() version: number;
  @ApiProperty() priority: number;
  @ApiProperty() effectiveFrom: string;
  @ApiProperty({ nullable: true }) effectiveTo: string | null;
  @ApiProperty({
    description:
      'Evidence the rule rests on. "TBD" means the department has not yet supplied one.',
  })
  sourceReference: string;
}

class DependencyDto {
  @ApiProperty() approvalTypeId: string;
  @ApiProperty() name: string;
  @ApiProperty({
    description:
      'Whether this prerequisite is itself among the applicable approvals of this run.',
  })
  alsoApplicable: boolean;
}

export class ApplicableApprovalDto {
  @ApiProperty({ type: ApprovalRefDto }) approvalType: ApprovalRefDto;
  @ApiProperty({ type: DepartmentRefDto }) department: DepartmentRefDto;
  @ApiProperty({ type: RuleRefDto }) rule: RuleRefDto;
  @ApiProperty({
    enum: ['POTENTIALLY_APPLICABLE', 'OFFICIALLY_REQUIRED'],
    description:
      '"Officially Required" only where the department has flagged the rule as authoritative (FRD §10.3); otherwise "Potentially Applicable".',
  })
  label: 'POTENTIALLY_APPLICABLE' | 'OFFICIALLY_REQUIRED';
  @ApiProperty({
    description:
      'Plain-language reason, tied to the project values that triggered it.',
  })
  explanation: string;
  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description:
      'Structured evaluation evidence (each condition with expected and actual values).',
  })
  trace: object;
  @ApiProperty({ type: [DependencyDto] }) dependsOn: DependencyDto[];
}

export class NotApplicableRuleDto {
  @ApiProperty({ type: ApprovalRefDto }) approvalType: ApprovalRefDto;
  @ApiProperty({ type: DepartmentRefDto }) department: DepartmentRefDto;
  @ApiProperty({ type: RuleRefDto }) rule: RuleRefDto;
  @ApiProperty({
    enum: ['CONDITIONS_NOT_MET', 'EXCLUDED', 'DEFINITION_INVALID'],
  })
  reason: 'CONDITIONS_NOT_MET' | 'EXCLUDED' | 'DEFINITION_INVALID';
  @ApiProperty() explanation: string;
  @ApiProperty({ type: 'object', additionalProperties: true, nullable: true })
  trace: object | null;
  @ApiPropertyOptional({
    description:
      'Only for DEFINITION_INVALID: what is wrong with the stored rule.',
  })
  issues?: Array<{ path: string; message: string }>;
}

class DiscoverySummaryCountsDto {
  @ApiProperty() rulesEvaluated: number;
  @ApiProperty() applicableCount: number;
  @ApiProperty() notApplicableCount: number;
}

/** A discovery run, as returned by the run endpoint and when re-read. */
export class DiscoveryResultDto {
  @ApiProperty({
    description: 'Id of the persisted, immutable snapshot of this run.',
  })
  snapshotId: string;
  @ApiProperty() projectId: string;
  @ApiProperty({ example: 'PRJ-2026-000001' }) projectReferenceNumber: string;
  @ApiProperty({ description: 'Discovery timestamp.' }) evaluatedAt: Date;
  @ApiProperty({
    example: '1.0.0',
    description: 'Version of the grammar/evaluation semantics.',
  })
  engineVersion: string;
  @ApiProperty({
    description:
      'Discovery is a recommendation, not a statutory determination (FRD §10.3/§10.4).',
  })
  notice: string;
  @ApiProperty({
    nullable: true,
    description:
      'Set when nothing could be determined (no rules configured, or none matched), instead of guessing (FRD §10.4).',
  })
  message: string | null;
  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description: 'The project characteristics exactly as evaluated.',
  })
  inputs: object;
  @ApiProperty({ type: DiscoverySummaryCountsDto })
  summary: DiscoverySummaryCountsDto;
  @ApiProperty({ type: [ApplicableApprovalDto] })
  applicable: ApplicableApprovalDto[];
  @ApiProperty({ type: [NotApplicableRuleDto] })
  notApplicable: NotApplicableRuleDto[];
  @ApiPropertyOptional({
    description:
      'Only when re-reading a snapshot: whether re-running the engine on the stored rules and inputs reproduces the stored result exactly.',
  })
  reproducible?: boolean;
}

export class DiscoverySnapshotSummaryDto {
  @ApiProperty() id: string;
  @ApiProperty() evaluatedAt: Date;
  @ApiProperty() engineVersion: string;
  @ApiProperty() rulesEvaluated: number;
  @ApiProperty() applicableCount: number;
  @ApiProperty() notApplicableCount: number;
  @ApiProperty({ type: [String] }) matchedApprovalTypeIds: string[];
}
