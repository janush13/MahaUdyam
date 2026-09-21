import { ApiProperty } from '@nestjs/swagger';
import { ApplicantStatus } from '@prisma/client';
import { ValidationSummary } from '../application-readiness';

class ApplicationDepartmentDto {
  @ApiProperty() id: string;
  @ApiProperty() code: string;
  @ApiProperty() name: string;
}

class ApplicationApprovalTypeDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty({ nullable: true }) legalName: string | null;
  @ApiProperty({ type: ApplicationDepartmentDto })
  department: ApplicationDepartmentDto;
}

class ApplicationDiscoveryRuleDto {
  @ApiProperty({ description: 'The exact rule version that suggested it.' })
  id: string;
  @ApiProperty() version: number;
  @ApiProperty() sourceReference: string;
}

export class ApplicationDiscoveryDto {
  @ApiProperty({
    format: 'uuid',
    description:
      'The immutable Step 7 discovery snapshot the application was started from.',
  })
  snapshotId: string;
  @ApiProperty() snapshotEvaluatedAt: string;
  @ApiProperty() engineVersion: string;
  @ApiProperty({
    enum: ['POTENTIALLY_APPLICABLE', 'OFFICIALLY_REQUIRED'],
    description:
      'How discovery labelled it. "Officially Required" only where the department flagged the rule authoritative; otherwise "Potentially Applicable".',
  })
  recommendationLabel: string;
  @ApiProperty({ type: ApplicationDiscoveryRuleDto })
  rule: ApplicationDiscoveryRuleDto;
  @ApiProperty({ type: ApplicationDepartmentDto })
  department: ApplicationDepartmentDto;
  @ApiProperty() explanation: string;
  @ApiProperty() note: string;
}

export class ApplicationResponseDto {
  @ApiProperty() id: string;
  @ApiProperty({
    nullable: true,
    description:
      'Application Reference Number — generated at submission; null while a draft.',
  })
  referenceNumber: string | null;
  @ApiProperty({ description: 'From the project — never client-supplied.' })
  enterpriseId: string;
  @ApiProperty() projectId: string;
  @ApiProperty() projectReferenceNumber: string;
  @ApiProperty({ type: ApplicationApprovalTypeDto })
  approvalType: ApplicationApprovalTypeDto;
  @ApiProperty({ enum: ApplicantStatus })
  applicantStatus: ApplicantStatus;
  @ApiProperty({
    description: 'True only while the applicant may still edit (draft).',
  })
  editable: boolean;
  @ApiProperty({ type: 'object', additionalProperties: true })
  formData: Record<string, unknown>;
  @ApiProperty({ type: ApplicationDiscoveryDto, nullable: true })
  discovery: ApplicationDiscoveryDto | null;
  @ApiProperty({ nullable: true }) submittedAt: Date | null;
  @ApiProperty({ nullable: true }) declarationAcceptedAt: Date | null;
  @ApiProperty({ format: 'uuid' }) createdByUserId: string;
  @ApiProperty({ format: 'uuid', nullable: true })
  submittedByUserId: string | null;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
}

export class ApplicationStatusDto {
  @ApiProperty() id: string;
  @ApiProperty({ nullable: true }) referenceNumber: string | null;
  @ApiProperty({ enum: ApplicantStatus })
  applicantStatus: ApplicantStatus;
  @ApiProperty() editable: boolean;
  @ApiProperty({ nullable: true }) submittedAt: Date | null;
  @ApiProperty() updatedAt: Date;
}

class ValidationIssueDto {
  @ApiProperty() code: string;
  @ApiProperty({ required: false }) field?: string;
  @ApiProperty() message: string;
}

class MissingDocumentDto {
  @ApiProperty() requirementId: string;
  @ApiProperty() name: string;
}

export class ValidationSummaryDto implements ValidationSummary {
  @ApiProperty({ type: [ValidationIssueDto], description: 'Block submission.' })
  errors: ValidationIssueDto[];
  @ApiProperty({
    type: [ValidationIssueDto],
    description: 'Do not block submission.',
  })
  warnings: ValidationIssueDto[];
  @ApiProperty({
    type: [MissingDocumentDto],
    description: 'Mandatory documents not yet attached — block submission.',
  })
  missingDocuments: MissingDocumentDto[];
  @ApiProperty({ description: 'True when Submit is enabled.' })
  readyForSubmission: boolean;
  @ApiProperty({ description: 'FRD §16.2 mandatory wording.' })
  disclaimer: string;
}
