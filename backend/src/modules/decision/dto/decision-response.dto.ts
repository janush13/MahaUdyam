import { ApiProperty } from '@nestjs/swagger';

class DepartmentRefDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() code: string;
  @ApiProperty() name: string;
}

class CertificateFileDto {
  @ApiProperty() filename: string;
  @ApiProperty() mimeType: string;
  @ApiProperty() sizeBytes: number;
  @ApiProperty() downloadable: boolean;
}

/** What an applicant may know about a certificate: the record and the file, and
 * nothing about who in the department issued it. */
export class ApplicantCertificateDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) applicationId: string;
  @ApiProperty({ format: 'uuid' }) enterpriseId: string;
  @ApiProperty({ format: 'uuid' }) projectId: string;
  @ApiProperty({ type: DepartmentRefDto }) department: DepartmentRefDto;
  @ApiProperty({ example: 1 }) version: number;
  @ApiProperty({
    nullable: true,
    description:
      'As stated by the issuing department; null when none was given. No numbering scheme is defined by the requirements.',
  })
  certificateNumber: string | null;
  @ApiProperty() issuedAt: Date;
  @ApiProperty({ type: CertificateFileDto }) file: CertificateFileDto;
}

export class OfficerCertificateDto extends ApplicantCertificateDto {
  @ApiProperty({ format: 'uuid' }) decisionId: string;
  @ApiProperty({ format: 'uuid' }) issuedByUserId: string;
}

/** The statutory decision, as an officer sees it. */
export class DecisionDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) applicationId: string;
  @ApiProperty({ enum: ['APPROVE', 'REJECT'] }) outcome: 'APPROVE' | 'REJECT';
  @ApiProperty() reason: string;
  @ApiProperty({ format: 'uuid' }) decidedByUserId: string;
  @ApiProperty() decidedAt: Date;
  @ApiProperty({
    format: 'uuid',
    description: 'The scrutiny recommendation this decision answers.',
  })
  recommendationId: string;
  @ApiProperty({
    enum: ['APPROVE', 'REJECT'],
    description: 'What that recommendation advised (advice, not a decision).',
  })
  recommendedOutcome: 'APPROVE' | 'REJECT';
  @ApiProperty({
    description:
      'True when the decision differs from the recommendation - allowed: the recommendation is advice only.',
  })
  differsFromRecommendation: boolean;
  @ApiProperty({
    description: 'Always true: this, unlike a recommendation, is the decision.',
  })
  isStatutoryDecision: boolean;
}

export class DecisionResultDto {
  @ApiProperty({ format: 'uuid' }) applicationId: string;
  @ApiProperty() internalState: string;
  @ApiProperty({ nullable: true }) applicantStatus: string | null;
  @ApiProperty({ type: DecisionDto }) decision: DecisionDto;
}

export class CertificateResultDto {
  @ApiProperty({ format: 'uuid' }) applicationId: string;
  @ApiProperty() internalState: string;
  @ApiProperty({ nullable: true }) applicantStatus: string | null;
  @ApiProperty({ type: OfficerCertificateDto })
  certificate: OfficerCertificateDto;
  @ApiProperty({
    description:
      'When the compliance period began: the moment the certificate was issued.',
  })
  activatedAt: Date;
  @ApiProperty({
    description:
      'Compliance obligations created for the application by activation (zero when the department configured none for this approval).',
  })
  complianceObligationsCreated: number;
}

class ApplicantDecisionRecordDto {
  @ApiProperty({ enum: ['APPROVE', 'REJECT'] }) outcome: 'APPROVE' | 'REJECT';
  @ApiProperty({ description: 'The reason the department recorded.' })
  reason: string;
  @ApiProperty() decidedAt: Date;
  @ApiProperty({ type: DepartmentRefDto }) department: DepartmentRefDto;
}

/** The applicant's read-only view of the department's decision: the outcome
 * and reason, the certificate once issued, and nothing internal (no
 * recommendation, no officer, no observation, no audit). */
export class ApplicantDecisionViewDto {
  @ApiProperty({ format: 'uuid' }) applicationId: string;
  @ApiProperty({ nullable: true }) referenceNumber: string | null;
  @ApiProperty() applicantStatus: string;
  @ApiProperty({ type: ApplicantDecisionRecordDto, nullable: true })
  decision: ApplicantDecisionRecordDto | null;
  @ApiProperty({ type: ApplicantCertificateDto, nullable: true })
  certificate: ApplicantCertificateDto | null;
  @ApiProperty() notice: string;
}
