import { ApiProperty } from '@nestjs/swagger';
import {
  ApplicantStatus,
  InternalApplicationState,
  QueryStatus,
} from '@prisma/client';
import { ProjectResponseDto } from '../../projects/dto/project-response.dto';
import { DocumentResponseDto } from '../../documents/dto/document-response.dto';
import {
  DecisionDto,
  OfficerCertificateDto,
} from '../../decision/dto/decision-response.dto';

export class OfficerDepartmentDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() code: string;
  @ApiProperty() name: string;
}

class ApprovalRefDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() name: string;
}

class EnterpriseRefDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() referenceNumber: string;
  @ApiProperty() name: string;
}

class ProjectRefDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() referenceNumber: string;
  @ApiProperty() name: string;
  @ApiProperty() district: string;
}

export class AssignedOfficerDto {
  @ApiProperty({ format: 'uuid' }) userId: string;
  @ApiProperty() name: string;
  @ApiProperty() assignedAt: Date;
}

export class OfficerApplicationSummaryDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() referenceNumber: string;
  @ApiProperty({ type: ApprovalRefDto }) approvalType: ApprovalRefDto;
  @ApiProperty({ type: OfficerDepartmentDto }) department: OfficerDepartmentDto;
  @ApiProperty({ type: EnterpriseRefDto }) enterprise: EnterpriseRefDto;
  @ApiProperty({ type: ProjectRefDto }) project: ProjectRefDto;
  @ApiProperty({
    enum: InternalApplicationState,
    description: 'The scrutiny status (internal workflow state).',
  })
  internalState: InternalApplicationState;
  @ApiProperty({
    enum: ApplicantStatus,
    description: 'What the applicant sees.',
  })
  applicantStatus: ApplicantStatus;
  @ApiProperty() submittedAt: Date;
  @ApiProperty() updatedAt: Date;
  @ApiProperty({ type: AssignedOfficerDto, nullable: true })
  assignedOfficer: AssignedOfficerDto | null;
  @ApiProperty({ description: 'A query is waiting on the applicant.' })
  awaitingApplicant: boolean;
}

export class OfficerApplicationListDto {
  @ApiProperty({ type: [OfficerApplicationSummaryDto] })
  items: OfficerApplicationSummaryDto[];
  @ApiProperty() page: number;
  @ApiProperty() pageSize: number;
  @ApiProperty({ description: 'Total matching applications (all pages).' })
  total: number;
}

class RoleGrantDto {
  @ApiProperty() role: string;
  @ApiProperty({ format: 'uuid' }) departmentId: string;
}

export class OfficerDashboardDto {
  @ApiProperty({ type: [RoleGrantDto] }) roles: RoleGrantDto[];
  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'number' },
    description:
      'Applications you can see, by scrutiny status (a status with none is omitted).',
  })
  byState: Record<string, number>;
  @ApiProperty({ description: 'Assigned to you.' }) assignedToMe: number;
  @ApiProperty({
    description:
      'Department-wide applications with nobody assigned (Department Administrators only; 0 otherwise).',
  })
  unassigned: number;
  @ApiProperty({
    description: 'Queries waiting on an applicant, within your view.',
  })
  awaitingApplicant: number;
  @ApiProperty({
    description:
      'Recommendations awaiting the Approving Authority, within your view.',
  })
  awaitingDecision: number;
}

export class ObservationDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) authorUserId: string;
  @ApiProperty() body: string;
  @ApiProperty({ format: 'uuid', nullable: true })
  relatedDocumentId: string | null;
  @ApiProperty({ nullable: true }) relatedField: string | null;
  @ApiProperty() createdAt: Date;
}

class QueryResponseDto {
  @ApiProperty() text: string;
  @ApiProperty() respondedAt: Date;
  @ApiProperty({ format: 'uuid' }) respondedByUserId: string;
}

/** The officer's view of a query. */
export class OfficerQueryDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() roundNumber: number;
  @ApiProperty({ enum: QueryStatus }) status: QueryStatus;
  @ApiProperty({ format: 'uuid' }) raisedByUserId: string;
  @ApiProperty() question: string;
  @ApiProperty({ format: 'uuid', nullable: true })
  sourceObservationId: string | null;
  @ApiProperty() raisedAt: Date;
  @ApiProperty({ type: QueryResponseDto, nullable: true })
  response: QueryResponseDto | null;
  @ApiProperty({ nullable: true }) closedAt: Date | null;
}

/** The applicant's view of a query: department only (FRD 19.1 leaves officer
 * identity to department policy, TBV), no internal links. */
export class ApplicantQueryDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() roundNumber: number;
  @ApiProperty({ enum: QueryStatus }) status: QueryStatus;
  @ApiProperty({ type: OfficerDepartmentDto }) department: OfficerDepartmentDto;
  @ApiProperty() question: string;
  @ApiProperty() raisedAt: Date;
  @ApiProperty({ type: QueryResponseDto, nullable: true })
  response: QueryResponseDto | null;
  @ApiProperty({ nullable: true }) closedAt: Date | null;
}

export class RecommendationDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ enum: ['APPROVE', 'REJECT'] }) outcome: 'APPROVE' | 'REJECT';
  @ApiProperty() reason: string;
  @ApiProperty({ format: 'uuid' }) recommendedByUserId: string;
  @ApiProperty() createdAt: Date;
  @ApiProperty({
    description:
      'Always true: this is a recommendation, never a statutory decision.',
  })
  isRecommendationOnly: boolean;
}

export class AssignmentHistoryDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) officerUserId: string;
  @ApiProperty({ format: 'uuid' }) assignedByUserId: string;
  @ApiProperty() assignedAt: Date;
  @ApiProperty({ nullable: true }) endedAt: Date | null;
  @ApiProperty({ nullable: true }) endReason: string | null;
}

class EnterpriseDetailDto extends EnterpriseRefDto {
  @ApiProperty({ nullable: true }) tradeName: string | null;
  @ApiProperty() businessType: string;
  @ApiProperty() registrationNumber: string;
  @ApiProperty() registrationNumberType: string;
  @ApiProperty() sector: string;
  @ApiProperty() address: string;
  @ApiProperty({ nullable: true }) website: string | null;
  @ApiProperty({ nullable: true }) contactPersonName: string | null;
}

export class OfficerDiscoveryDto {
  @ApiProperty({
    format: 'uuid',
    description:
      'The immutable Step 7 snapshot. Discovery is never re-run here.',
  })
  snapshotId: string;
  @ApiProperty() snapshotEvaluatedAt: string;
  @ApiProperty() engineVersion: string;
  @ApiProperty({ type: ApprovalRefDto }) approvalType: ApprovalRefDto;
  @ApiProperty({ type: OfficerDepartmentDto }) department: OfficerDepartmentDto;
  @ApiProperty({
    enum: ['POTENTIALLY_APPLICABLE', 'OFFICIALLY_REQUIRED'],
    description:
      'A recommendation label — never a statutory determination. "Officially Required" only where the department flagged the rule authoritative.',
  })
  recommendationLabel: string;
  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description: 'The exact rule version that suggested the approval.',
  })
  rule: Record<string, unknown>;
  @ApiProperty() explanation: string;
  @ApiProperty({
    type: 'array',
    items: { type: 'object', additionalProperties: true },
    description: 'Prerequisite approvals recorded at discovery time.',
  })
  dependsOn: Array<Record<string, unknown>>;
  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description: 'The evaluated condition tree, as stored.',
  })
  trace: Record<string, unknown>;
  @ApiProperty() notice: string;
}

/** A completed inspection's submitted outcome, as scrutiny sees it (FRD 24.2
 * "feeds directly into the application's scrutiny record"). The full checklist
 * and evidence are at GET /inspections/:id/report. */
export class InspectionOutcomeDto {
  @ApiProperty({ format: 'uuid' }) inspectionId: string;
  @ApiProperty({ type: Date, nullable: true }) scheduledAt: Date | null;
  @ApiProperty({ enum: ['COMPLIANT', 'NON_COMPLIANT', 'CONDITIONAL'] })
  overallFinding: string;
  @ApiProperty() summary: string;
  @ApiProperty({ type: String, nullable: true }) correctiveAction:
    string | null;
  @ApiProperty() submittedAt: Date;
  @ApiProperty({ format: 'uuid' }) submittedByUserId: string;
}

/** Where the application stands on inspection, for the scrutiny screen. The
 * configured requirement (required) and what has actually happened
 * (open, completed, outcomes) are kept apart. */
export class OfficerInspectionSummaryDto {
  @ApiProperty({
    description:
      'The approval workflow calls for an inspection (configuration — not whether one has happened).',
  })
  required: boolean;
  @ApiProperty({ description: 'Inspections still pending or scheduled.' })
  open: number;
  @ApiProperty({ description: 'Inspections completed with a report.' })
  completed: number;
  @ApiProperty({
    enum: ['INSPECTION_OPEN', 'INSPECTION_REQUIRED'],
    nullable: true,
    description:
      'Why a recommendation cannot be made yet because of inspection; null when inspection is not in the way (advisory — re-checked by the server).',
  })
  recommendationBlockedBy: string | null;
  @ApiProperty({
    type: [InspectionOutcomeDto],
    description:
      'Completed inspections, oldest first. History is never replaced.',
  })
  outcomes: InspectionOutcomeDto[];
}

export class OfficerApplicationDetailDto extends OfficerApplicationSummaryDto {
  @ApiProperty({ description: 'The role you are acting under here.' })
  actingRole: string;
  @ApiProperty({
    type: [String],
    description:
      'Actions your role could take from the current state (advisory — every one is re-checked by the server).',
  })
  availableActions: string[];
  @ApiProperty({ type: 'object', additionalProperties: true })
  formData: Record<string, unknown>;
  @ApiProperty({ nullable: true }) declarationAcceptedAt: Date | null;
  @ApiProperty({ format: 'uuid', nullable: true })
  submittedByUserId: string | null;
  @ApiProperty({ type: EnterpriseDetailDto })
  enterpriseDetails: EnterpriseDetailDto;
  @ApiProperty({ type: ProjectResponseDto }) projectDetails: ProjectResponseDto;
  @ApiProperty({
    type: 'array',
    items: { type: 'object', additionalProperties: true },
    nullable: true,
    description:
      'The document versions that were current at submission (frozen). Later changes never alter it.',
  })
  submittedDocuments: Array<Record<string, unknown>> | null;
  @ApiProperty({
    type: [DocumentResponseDto],
    description: 'Current versions.',
  })
  documents: DocumentResponseDto[];
  @ApiProperty({
    type: [ObservationDto],
    description: 'Internal — never applicant-visible.',
  })
  observations: ObservationDto[];
  @ApiProperty({ type: [OfficerQueryDto] }) queries: OfficerQueryDto[];
  @ApiProperty({ type: [RecommendationDto] })
  recommendations: RecommendationDto[];
  @ApiProperty({
    type: DecisionDto,
    nullable: true,
    description:
      'The Approving Authority’s statutory decision, once made — distinct from the recommendations above, which are advice.',
  })
  decision: DecisionDto | null;
  @ApiProperty({
    type: OfficerCertificateDto,
    nullable: true,
    description: 'The certificate record, once issued.',
  })
  certificate: OfficerCertificateDto | null;
  @ApiProperty({ type: OfficerInspectionSummaryDto })
  inspection: OfficerInspectionSummaryDto;
  @ApiProperty({
    type: [AssignmentHistoryDto],
    nullable: true,
    description: 'Department Administrators only.',
  })
  assignmentHistory: AssignmentHistoryDto[] | null;
}

export class HistoryEntryDto {
  @ApiProperty() at: Date;
  @ApiProperty() action: string;
  @ApiProperty({ description: 'A plain-language description.' })
  summary: string;
  @ApiProperty({ nullable: true }) actorRole: string | null;
  @ApiProperty({ format: 'uuid', nullable: true }) actorUserId: string | null;
  @ApiProperty({
    nullable: true,
    description: 'Internal state before, where the action changed it.',
  })
  from: string | null;
  @ApiProperty({
    nullable: true,
    description: 'Internal state after, where the action changed it.',
  })
  to: string | null;
}

export class AssigneeDto {
  @ApiProperty({ format: 'uuid' }) userId: string;
  @ApiProperty() name: string;
  @ApiProperty({ format: 'uuid' }) departmentId: string;
  @ApiProperty({
    description: 'Open (un-finished) applications currently assigned.',
  })
  openAssignments: number;
}

export class AssignmentResultDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) applicationId: string;
  @ApiProperty({ format: 'uuid' }) officerUserId: string;
  @ApiProperty({ format: 'uuid' }) assignedByUserId: string;
  @ApiProperty() assignedAt: Date;
}
