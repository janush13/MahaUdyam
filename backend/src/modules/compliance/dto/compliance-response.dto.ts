import { ApiProperty } from '@nestjs/swagger';
import {
  ComplianceFrequency,
  ComplianceRecordStatus,
  Prisma,
} from '@prisma/client';
import { toYmd } from '../compliance-dates';

/** FRD 27.2: shown wherever an approval has no configured obligation. */
export const NO_OBLIGATIONS_NOTE =
  'No compliance obligations are configured for this approval. Obligations will appear here once confirmed by the issuing department.';

/** FRD 25.3 / 27.2 in spirit: a date the department has not configured is
 * never guessed. */
export const DUE_DATE_NOT_CONFIGURED =
  'Due date not yet configured — TO BE VALIDATED WITH GOVERNMENT DEPARTMENT';

/** What every read of a record loads. */
export const COMPLIANCE_RECORD_INCLUDE = {
  fulfilledDocument: {
    select: {
      id: true,
      originalFilename: true,
      mimeType: true,
      sizeBytes: true,
      version: true,
    },
  },
} satisfies Prisma.ComplianceRecordInclude;

export type ComplianceRecordRow = Prisma.ComplianceRecordGetPayload<{
  include: typeof COMPLIANCE_RECORD_INCLUDE;
}>;

export class ComplianceEvidenceDto {
  @ApiProperty({ format: 'uuid' }) documentId: string;
  @ApiProperty() filename: string;
  @ApiProperty() mimeType: string;
  @ApiProperty() sizeBytes: number;
  @ApiProperty() version: number;
}

/**
 * One occurrence of an obligation (FRD 27.1): the requirement, its frequency,
 * its due date, its status, the evidence (if any is required) and the action
 * the applicant must take. What is shown is the SNAPSHOT the occurrence was
 * created under - never today's configuration.
 */
export class ComplianceObligationDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) applicationId: string;
  @ApiProperty({
    description:
      '1, 2, 3... per obligation; a recurring obligation has one record per occurrence.',
  })
  occurrenceNumber: number;
  @ApiProperty({ description: 'The requirement, in plain language.' })
  description: string;
  @ApiProperty({ enum: ComplianceFrequency }) frequency: ComplianceFrequency;
  @ApiProperty({ type: String, nullable: true }) applicantAction: string | null;
  @ApiProperty({ type: String, nullable: true }) sourceReference: string | null;
  @ApiProperty({
    description:
      'The version of the requirement this occurrence was created under.',
  })
  requirementVersion: number;
  @ApiProperty({
    type: String,
    format: 'date',
    nullable: true,
    example: '2027-01-31',
  })
  dueDate: string | null;
  @ApiProperty({
    type: String,
    nullable: true,
    description: `${DUE_DATE_NOT_CONFIGURED} — present exactly when dueDate is null.`,
  })
  dueDateMessage: string | null;
  @ApiProperty({ enum: ComplianceRecordStatus }) status: ComplianceRecordStatus;
  @ApiProperty({
    description: 'Whether a supporting document is required to fulfil it.',
  })
  evidenceRequired: boolean;
  @ApiProperty({ type: Date, nullable: true }) fulfilledAt: Date | null;
  @ApiProperty({
    type: Boolean,
    nullable: true,
    description:
      'Whether it was fulfilled after its due date; null until fulfilled or without a due date.',
  })
  fulfilledLate: boolean | null;
  @ApiProperty({ type: ComplianceEvidenceDto, nullable: true })
  evidence: ComplianceEvidenceDto | null;
  @ApiProperty() createdAt: Date;
}

export class ApplicationComplianceDto {
  @ApiProperty({ format: 'uuid' }) applicationId: string;
  @ApiProperty({ type: [ComplianceObligationDto] })
  items: ComplianceObligationDto[];
  @ApiProperty({
    type: String,
    nullable: true,
    description: `${NO_OBLIGATIONS_NOTE} — present exactly when there are none.`,
  })
  note: string | null;
}

export class EnterpriseComplianceListDto {
  @ApiProperty({ type: [ComplianceObligationDto] })
  items: ComplianceObligationDto[];
  @ApiProperty() page: number;
  @ApiProperty() pageSize: number;
  @ApiProperty() total: number;
}

export class OfficerComplianceObligationDto extends ComplianceObligationDto {
  @ApiProperty() applicationReference: string;
  @ApiProperty() approvalType: string;
  @ApiProperty({ format: 'uuid' }) departmentId: string;
}

export class OfficerComplianceListDto {
  @ApiProperty({ type: [OfficerComplianceObligationDto] })
  items: OfficerComplianceObligationDto[];
  @ApiProperty() page: number;
  @ApiProperty() pageSize: number;
  @ApiProperty() total: number;
}

export class OfficerApplicationComplianceDto {
  @ApiProperty({ format: 'uuid' }) applicationId: string;
  @ApiProperty() applicationReference: string;
  @ApiProperty({ type: [ComplianceObligationDto] })
  items: ComplianceObligationDto[];
  @ApiProperty({ type: String, nullable: true }) note: string | null;
}

export class ComplianceRequirementDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) approvalTypeId: string;
  @ApiProperty() approvalTypeName: string;
  @ApiProperty({ format: 'uuid' }) departmentId: string;
  @ApiProperty() description: string;
  @ApiProperty({ enum: ComplianceFrequency }) frequency: ComplianceFrequency;
  @ApiProperty({ type: String, nullable: true }) applicantAction: string | null;
  @ApiProperty({ type: String, nullable: true }) sourceReference: string | null;
  @ApiProperty() evidenceRequired: boolean;
  @ApiProperty({ type: Number, nullable: true }) firstDueAfterDays:
    number | null;
  @ApiProperty() dueWindowDays: number;
  @ApiProperty() version: number;
  @ApiProperty() isActive: boolean;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
}

/** The late verdict is a fact of two stored dates, computed here once. */
function fulfilledLate(
  row: ComplianceRecordRow,
  utcOffsetMinutes: number,
): boolean | null {
  if (row.fulfilledAt === null || row.dueDate === null) {
    return null;
  }
  const local = new Date(row.fulfilledAt.getTime() + utcOffsetMinutes * 60_000)
    .toISOString()
    .slice(0, 10);
  return local > toYmd(row.dueDate);
}

export function toObligationDto(
  row: ComplianceRecordRow,
  utcOffsetMinutes: number,
): ComplianceObligationDto {
  return {
    id: row.id,
    applicationId: row.applicationId,
    occurrenceNumber: row.occurrenceNumber,
    description: row.description,
    frequency: row.frequency,
    applicantAction: row.applicantAction,
    sourceReference: row.sourceReference,
    requirementVersion: row.requirementVersion,
    dueDate: row.dueDate ? toYmd(row.dueDate) : null,
    dueDateMessage: row.dueDate ? null : DUE_DATE_NOT_CONFIGURED,
    status: row.status,
    evidenceRequired: row.evidenceRequired,
    fulfilledAt: row.fulfilledAt,
    fulfilledLate: fulfilledLate(row, utcOffsetMinutes),
    evidence: row.fulfilledDocument
      ? {
          documentId: row.fulfilledDocument.id,
          filename: row.fulfilledDocument.originalFilename,
          mimeType: row.fulfilledDocument.mimeType,
          sizeBytes: row.fulfilledDocument.sizeBytes,
          version: row.fulfilledDocument.version,
        }
      : null,
    createdAt: row.createdAt,
  };
}
