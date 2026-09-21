import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  DocumentStatus,
  SchemeApplicationStatus,
  SchemePublishStatus,
} from '@prisma/client';

export class SchemeDepartmentDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() code: string;
  @ApiProperty() name: string;
}

export class SchemeDocumentRequirementDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() name: string;
  @ApiProperty() isMandatory: boolean;
  @ApiProperty({ nullable: true, type: String }) description: string | null;
  @ApiProperty({
    nullable: true,
    type: Number,
    description: 'Null = the platform default limit.',
  })
  maxSizeBytes: number | null;
  @ApiProperty({
    type: [String],
    description: 'Empty = every supported type.',
  })
  allowedMimeTypes: string[];
}

/** A published, active scheme as an applicant (or the public) sees it (FRD
 * 29.2). Never carries eligibility rules, draft state or who maintains it. */
export class SchemeDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() name: string;
  @ApiProperty({ type: SchemeDepartmentDto }) department: SchemeDepartmentDto;
  @ApiProperty() description: string;
  @ApiProperty() benefits: string;
  @ApiProperty({ nullable: true, type: String }) benefitType: string | null;
  @ApiProperty({ description: 'The eligibility criteria in plain language.' })
  eligibilityCriteria: string;
  @ApiProperty({ type: [String], description: 'Empty = not restricted.' })
  applicableSectors: string[];
  @ApiProperty({ type: [String] }) applicableDistricts: string[];
  @ApiProperty({ type: [String] }) applicableEnterpriseSizes: string[];
  @ApiProperty({
    nullable: true,
    type: String,
    format: 'date-time',
    description: 'Null = no deadline configured.',
  })
  applicationDeadline: Date | null;
  @ApiProperty({
    description:
      'False once the configured deadline has passed (applying is then refused).',
  })
  applicationOpen: boolean;
  @ApiProperty({ nullable: true, type: String }) sourceReference: string | null;
  @ApiProperty({ type: [SchemeDocumentRequirementDto] })
  documentRequirements: SchemeDocumentRequirementDto[];
}

export class SchemeListDto {
  @ApiProperty({ type: [SchemeDto] }) items: SchemeDto[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() pageSize: number;
}

export class SchemeRuleDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() version: number;
  @ApiProperty({ type: String, format: 'date-time' }) effectiveFrom: Date;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  effectiveTo: Date | null;
  @ApiProperty() isActive: boolean;
  @ApiProperty() priority: number;
  @ApiProperty() sourceReference: string;
  @ApiProperty({ type: 'object', additionalProperties: true })
  conditions: unknown;
  @ApiProperty({ format: 'uuid' }) createdByUserId: string;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: Date;
}

export class SchemeCapabilitiesDto {
  @ApiProperty({ description: 'May edit the draft, its rules and documents.' })
  canMaintain: boolean;
  @ApiProperty({ description: 'May publish it (configured publisher role).' })
  canPublish: boolean;
  @ApiProperty({
    description: 'May return it to draft or activate / deactivate it.',
  })
  canWithdraw: boolean;
}

/** A scheme as the officers who maintain and publish it see it. */
export class SchemeAdminDto extends SchemeDto {
  @ApiProperty({ enum: SchemePublishStatus })
  publishStatus: SchemePublishStatus;
  @ApiProperty() isActive: boolean;
  @ApiProperty() version: number;
  @ApiProperty({ format: 'uuid' }) createdByUserId: string;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  publishedAt: Date | null;
  @ApiProperty({ nullable: true, type: String, format: 'uuid' })
  publishedByUserId: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: Date;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt: Date;
  @ApiProperty({
    type: [SchemeRuleDto],
    description:
      'Every version, oldest first. The highest effective one applies.',
  })
  rules: SchemeRuleDto[];
  @ApiProperty({ type: SchemeCapabilitiesDto })
  capabilities: SchemeCapabilitiesDto;
}

export class SchemeAdminListDto {
  @ApiProperty({ type: [SchemeAdminDto] }) items: SchemeAdminDto[];
}

// ---- recommendations --------------------------------------------------------

export class SchemeRuleRefDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() version: number;
  @ApiProperty() priority: number;
  @ApiProperty() sourceReference: string;
  @ApiProperty({ type: String, format: 'date-time' }) effectiveFrom: string;
}

export class ExistingSchemeApplicationDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ nullable: true, type: String }) referenceNumber: string | null;
  @ApiProperty({ enum: SchemeApplicationStatus })
  status: SchemeApplicationStatus;
}

export class SchemeRecommendationDto {
  @ApiProperty({ description: '1-based position in the ranked list.' })
  rank: number;
  @ApiProperty({ type: SchemeDto }) scheme: SchemeDto;
  @ApiProperty({ enum: ['MAY_BE_ELIGIBLE'] }) label: 'MAY_BE_ELIGIBLE';
  @ApiProperty({
    description:
      'The mandatory FRD 29.4 wording: a suggestion, not an eligibility determination.',
  })
  notice: string;
  @ApiProperty({
    description: 'Why the scheme was suggested, in plain language.',
  })
  explanation: string;
  @ApiProperty({ type: SchemeRuleRefDto }) rule: SchemeRuleRefDto;
  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description: 'The condition-by-condition evaluation behind the suggestion.',
  })
  trace: unknown;
  @ApiProperty({
    type: ExistingSchemeApplicationDto,
    nullable: true,
    description: 'This project’s live application for the scheme, if any.',
  })
  existingApplication: ExistingSchemeApplicationDto | null;
}

export class SchemeRecommendationsDto {
  @ApiProperty({ format: 'uuid' }) projectId: string;
  @ApiProperty() projectReferenceNumber: string;
  @ApiProperty({ type: String, format: 'date-time' }) evaluatedAt: Date;
  @ApiProperty() engineVersion: string;
  @ApiProperty({ description: 'Shown once with the whole list.' })
  notice: string;
  @ApiProperty({ nullable: true, type: String }) message: string | null;
  @ApiProperty({
    type: 'object',
    properties: {
      rulesEvaluated: { type: 'number' },
      recommendedCount: { type: 'number' },
      notRecommendedCount: { type: 'number' },
    },
  })
  summary: {
    rulesEvaluated: number;
    recommendedCount: number;
    notRecommendedCount: number;
  };
  @ApiProperty({ type: [SchemeRecommendationDto] })
  recommendations: SchemeRecommendationDto[];
}

// ---- applications -----------------------------------------------------------

export class SchemeTimelineEntryDto {
  @ApiProperty({ enum: SchemeApplicationStatus, nullable: true, type: String })
  fromStatus: SchemeApplicationStatus | null;
  @ApiProperty({ enum: SchemeApplicationStatus })
  toStatus: SchemeApplicationStatus;
  @ApiProperty({ type: String, format: 'date-time' }) at: Date;
  @ApiProperty({
    nullable: true,
    type: String,
    description: 'The decision reason, on the APPROVED / REJECTED entry only.',
  })
  reason: string | null;
}

export class OfficerSchemeTimelineEntryDto extends SchemeTimelineEntryDto {
  @ApiProperty({ format: 'uuid' }) actorUserId: string;
  @ApiProperty() actorRole: string;
}

export class SchemeApplicationRecommendationDto {
  @ApiProperty({
    enum: ['RECOMMENDED', 'NOT_RECOMMENDED', 'NO_RULE', 'RULE_INVALID'],
    description:
      'What the system suggested for the project when it applied. Never a determination.',
  })
  status: 'RECOMMENDED' | 'NOT_RECOMMENDED' | 'NO_RULE' | 'RULE_INVALID';
  @ApiProperty({ nullable: true, type: SchemeRuleRefDto })
  rule: SchemeRuleRefDto | null;
  @ApiProperty({ nullable: true, type: String }) explanation: string | null;
  @ApiProperty() notice: string;
}

export class SchemeApplicationSchemeDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() name: string;
  @ApiProperty({ nullable: true, type: String }) benefitType: string | null;
  @ApiProperty({ type: SchemeDepartmentDto }) department: SchemeDepartmentDto;
}

export class SchemeApplicationDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ nullable: true, type: String }) referenceNumber: string | null;
  @ApiProperty({ enum: SchemeApplicationStatus })
  status: SchemeApplicationStatus;
  @ApiProperty({ type: SchemeApplicationSchemeDto })
  scheme: SchemeApplicationSchemeDto;
  @ApiProperty({ format: 'uuid' }) enterpriseId: string;
  @ApiProperty({ format: 'uuid' }) projectId: string;
  @ApiProperty() projectReferenceNumber: string;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  submittedAt: Date | null;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  decidedAt: Date | null;
  @ApiProperty({ nullable: true, type: String }) decisionReason: string | null;
  @ApiProperty({
    nullable: true,
    type: String,
    format: 'date-time',
    description:
      'When the benefit was recorded as disbursed. A status marker only.',
  })
  disbursedAt: Date | null;
  @ApiProperty({ type: SchemeApplicationRecommendationDto })
  recommendation: SchemeApplicationRecommendationDto;
  @ApiProperty({
    description: 'Whether evidence can still be added or replaced.',
  })
  evidenceEditable: boolean;
  @ApiProperty({ type: [SchemeTimelineEntryDto] })
  timeline: SchemeTimelineEntryDto[];
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: Date;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt: Date;
}

class OfficerRefDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() name: string;
  @ApiProperty() referenceNumber: string;
}

export class OfficerSchemeApplicationSummaryDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ nullable: true, type: String }) referenceNumber: string | null;
  @ApiProperty({ enum: SchemeApplicationStatus })
  status: SchemeApplicationStatus;
  @ApiProperty({ type: SchemeApplicationSchemeDto })
  scheme: SchemeApplicationSchemeDto;
  @ApiProperty({ type: OfficerRefDto }) enterprise: OfficerRefDto;
  @ApiProperty({ type: OfficerRefDto }) project: OfficerRefDto;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  submittedAt: Date | null;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt: Date;
}

export class OfficerSchemeApplicationListDto {
  @ApiProperty({ type: [OfficerSchemeApplicationSummaryDto] })
  items: OfficerSchemeApplicationSummaryDto[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() pageSize: number;
}

export class OfficerSchemeApplicationDto extends OfficerSchemeApplicationSummaryDto {
  @ApiProperty({ nullable: true, type: String }) decisionReason: string | null;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  decidedAt: Date | null;
  @ApiProperty({ nullable: true, type: String, format: 'uuid' })
  decidedByUserId: string | null;
  @ApiProperty({ nullable: true, type: String, format: 'date-time' })
  disbursedAt: Date | null;
  @ApiProperty({ format: 'uuid' }) appliedByUserId: string;
  @ApiProperty({ type: SchemeApplicationRecommendationDto })
  recommendation: SchemeApplicationRecommendationDto;
  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description:
      'The project characteristics the recommendation was evaluated on (as they are now).',
  })
  projectInputs: Record<string, unknown>;
  @ApiProperty({
    type: [String],
    description: 'The actions the Scheme Officer can take from this status.',
  })
  availableActions: string[];
  @ApiProperty({ type: [OfficerSchemeTimelineEntryDto] })
  timeline: OfficerSchemeTimelineEntryDto[];
}

/** The outcome of a status action. */
export class SchemeApplicationActionResultDto {
  @ApiProperty({ type: OfficerSchemeApplicationDto })
  application: OfficerSchemeApplicationDto;
}

// ---- evidence ---------------------------------------------------------------

export class SchemeEvidenceRequirementStatusDto extends SchemeDocumentRequirementDto {
  @ApiProperty({
    description:
      'A current, scanned document that has not been rejected or expired.',
  })
  satisfied: boolean;
  @ApiProperty({
    nullable: true,
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      version: { type: 'number' },
      status: { enum: Object.values(DocumentStatus) },
    },
  })
  currentDocument: {
    id: string;
    version: number;
    status: DocumentStatus;
  } | null;
}

export class SchemeDocumentReviewDto {
  @ApiProperty({ enum: ['VERIFIED', 'REJECTED'] }) verdict: string;
  @ApiProperty({ type: String, format: 'date-time' }) reviewedAt: Date;
  @ApiProperty({
    nullable: true,
    type: String,
    description:
      'The reason for a rejection (verification notes are internal).',
  })
  reason: string | null;
  @ApiPropertyOptional({ description: 'Officer view only.' }) notes?:
    string | null;
  @ApiPropertyOptional({ format: 'uuid', description: 'Officer view only.' })
  reviewedByUserId?: string;
}

export class SchemeDocumentDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) schemeApplicationId: string;
  @ApiProperty({ format: 'uuid' }) lineageId: string;
  @ApiProperty() version: number;
  @ApiProperty({ description: 'False once a newer version replaced it.' })
  isCurrent: boolean;
  @ApiProperty({ nullable: true, type: String, format: 'uuid' })
  previousVersionId: string | null;
  @ApiProperty({
    nullable: true,
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      name: { type: 'string' },
      isMandatory: { type: 'boolean' },
    },
  })
  requirement: { id: string; name: string; isMandatory: boolean } | null;
  @ApiProperty() originalFilename: string;
  @ApiProperty() mimeType: string;
  @ApiProperty() sizeBytes: number;
  @ApiProperty({ enum: DocumentStatus }) status: DocumentStatus;
  @ApiProperty({ nullable: true, type: String, example: '2027-03-31' })
  expiryDate: string | null;
  @ApiProperty({
    type: 'object',
    properties: {
      state: { enum: ['CLEAN', 'NOT_SCANNED'] },
      scannedAt: { type: 'string', format: 'date-time', nullable: true },
      scanner: { type: 'string', nullable: true },
    },
  })
  scan: { state: string; scannedAt: Date | null; scanner: string | null };
  @ApiProperty() downloadable: boolean;
  @ApiProperty({ nullable: true, type: SchemeDocumentReviewDto })
  review: SchemeDocumentReviewDto | null;
  @ApiProperty({ format: 'uuid' }) uploadedByUserId: string;
  @ApiProperty({ type: String, format: 'date-time' }) uploadedAt: Date;
}
