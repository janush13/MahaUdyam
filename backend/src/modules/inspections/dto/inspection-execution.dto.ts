import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { InspectionFinding, InspectionStatus } from '@prisma/client';
import {
  IsEnum,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import { Trim } from '../../../common/decorators/trim.decorator';
import {
  MAX_CAPTION_LENGTH,
  MAX_REASON_LENGTH,
  MAX_REPORT_TEXT_LENGTH,
  MAX_RESULT_TEXT_LENGTH,
} from '../constants/inspection.constants';
import { InspectionDto } from './inspection-response.dto';

const WITH_OFFSET = /(Z|[+-]\d{2}:\d{2})$/;
const OFFSET_MESSAGE =
  'must be an ISO 8601 date-time with an explicit offset (e.g. 2026-10-01T10:30:00+05:30)';

// ---------------------------------------------------------------------------
// Requests. Only what the inspector decides: never a status, an inspector, an
// inspection / application / department id in the body, a timestamp the server
// sets, or a storage / scan field.
// ---------------------------------------------------------------------------

export class RescheduleInspectionDto {
  @ApiProperty({
    example: '2026-10-02T11:00:00+05:30',
    description:
      'The new date and time of the visit; must be in the future and different from the current one. Withdraws any earlier confirmation.',
  })
  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(WITH_OFFSET, { message: `scheduledAt ${OFFSET_MESSAGE}` })
  scheduledAt: string;

  @ApiProperty({
    maxLength: MAX_REASON_LENGTH,
    description: 'Why the visit is being moved (kept in the audit trail).',
  })
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_REASON_LENGTH)
  reason: string;
}

export class RecordResultDto {
  @ApiProperty({
    format: 'uuid',
    description:
      'An item of THIS inspection’s checklist (the department’s checklist for the application’s approval).',
  })
  @IsUUID()
  checklistItemId: string;

  @ApiProperty({
    maxLength: MAX_RESULT_TEXT_LENGTH,
    description: 'The inspector’s response to the checklist item.',
  })
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_RESULT_TEXT_LENGTH)
  response: string;

  @ApiProperty({ enum: InspectionFinding })
  @IsEnum(InspectionFinding)
  finding: InspectionFinding;

  @ApiPropertyOptional({ maxLength: MAX_RESULT_TEXT_LENGTH })
  @IsOptional()
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_RESULT_TEXT_LENGTH)
  notes?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Evidence already attached to THIS inspection (its `id` from the evidence upload).',
  })
  @IsOptional()
  @IsUUID()
  evidenceId?: string;
}

/** The TEXT fields of the multipart evidence upload, beside the `file` part. */
export class AttachEvidenceDto {
  @ApiPropertyOptional({
    example: '2026-10-02T11:20:00+05:30',
    description:
      'When the photo / document was captured, as declared by the inspector. No location is ever captured (TO BE VALIDATED, TRD 10.1).',
  })
  @IsOptional()
  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(WITH_OFFSET, { message: `capturedAt ${OFFSET_MESSAGE}` })
  capturedAt?: string;

  @ApiPropertyOptional({ maxLength: MAX_CAPTION_LENGTH })
  @IsOptional()
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_CAPTION_LENGTH)
  caption?: string;
}

export class AttachEvidenceBodyDoc extends AttachEvidenceDto {
  @ApiProperty({
    type: 'string',
    format: 'binary',
    description: 'The evidence: PDF, JPEG or PNG, within the size limit.',
  })
  file: unknown;
}

export class SubmitReportDto {
  @ApiProperty({
    enum: InspectionFinding,
    description:
      'The findings summary (compliant / non-compliant / conditional).',
  })
  @IsEnum(InspectionFinding)
  overallFinding: InspectionFinding;

  @ApiProperty({
    maxLength: MAX_REPORT_TEXT_LENGTH,
    description: 'The inspector’s observations.',
  })
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_REPORT_TEXT_LENGTH)
  summary: string;

  @ApiPropertyOptional({
    maxLength: MAX_REPORT_TEXT_LENGTH,
    description:
      'The corrective-action recommendation. Required when the overall finding is NON_COMPLIANT (FRD 24.2).',
  })
  @IsOptional()
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_REPORT_TEXT_LENGTH)
  correctiveAction?: string;
}

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

export class ResultDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) checklistItemId: string;
  @ApiProperty({
    description: 'The checklist item’s wording when it was answered.',
  })
  itemText: string;
  @ApiProperty() response: string;
  @ApiProperty({ enum: InspectionFinding }) finding: InspectionFinding;
  @ApiProperty({ type: String, nullable: true }) notes: string | null;
  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'The evidence (`id` of an evidence record) cited, if any.',
  })
  evidenceId: string | null;
  @ApiProperty() recordedAt: Date;
  @ApiProperty({ format: 'uuid' }) recordedByUserId: string;
}

class EvidenceScanDto {
  @ApiProperty({ enum: ['CLEAN', 'NOT_SCANNED'] }) state: string;
  @ApiProperty({ type: Date, nullable: true }) scannedAt: Date | null;
}

export class EvidenceDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({
    format: 'uuid',
    description: 'The Step 9 document (one specific version) holding the file.',
  })
  documentId: string;
  @ApiProperty() documentVersion: number;
  @ApiProperty() originalFilename: string;
  @ApiProperty() mimeType: string;
  @ApiProperty() sizeBytes: number;
  @ApiProperty({ type: Date, nullable: true }) capturedAt: Date | null;
  @ApiProperty({ type: String, nullable: true }) caption: string | null;
  @ApiProperty() attachedAt: Date;
  @ApiProperty({ format: 'uuid' }) attachedByUserId: string;
  @ApiProperty({ type: EvidenceScanDto }) scan: EvidenceScanDto;
  @ApiProperty({ description: 'The file can be downloaded.' })
  downloadable: boolean;
}

export class ChecklistItemViewDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() text: string;
  @ApiProperty() sequenceOrder: number;
  @ApiProperty({
    type: ResultDto,
    nullable: true,
    description: 'The most recently recorded result, or null if unanswered.',
  })
  current: ResultDto | null;
  @ApiProperty({
    type: [ResultDto],
    description:
      'Earlier results for this item, oldest first. Nothing is overwritten, so a correction leaves the original answer here.',
  })
  earlier: ResultDto[];
}

export class ReportDto {
  @ApiProperty({ enum: InspectionFinding }) overallFinding: InspectionFinding;
  @ApiProperty() summary: string;
  @ApiProperty({ type: String, nullable: true }) correctiveAction:
    string | null;
  @ApiProperty() submittedAt: Date;
  @ApiProperty({ format: 'uuid' }) submittedByUserId: string;
}

export class InspectionReportViewDto {
  @ApiProperty({ format: 'uuid' }) inspectionId: string;
  @ApiProperty({ enum: InspectionStatus }) status: InspectionStatus;
  @ApiProperty({
    type: [ChecklistItemViewDto],
    description:
      'The department’s checklist for this approval, with the recorded results. Empty when the department has configured none.',
  })
  checklist: ChecklistItemViewDto[];
  @ApiProperty({ type: [EvidenceDto] }) evidence: EvidenceDto[];
  @ApiProperty({
    type: ReportDto,
    nullable: true,
    description: 'The submitted report; null until the inspector submits it.',
  })
  report: ReportDto | null;
}

export class SubmitReportResultDto {
  @ApiProperty({ type: InspectionDto }) inspection: InspectionDto;
  @ApiProperty({ type: ReportDto }) report: ReportDto;
}
