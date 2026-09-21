import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { InspectionStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Trim } from '../../../common/decorators/trim.decorator';
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  MAX_REASON_LENGTH,
  MAX_SITE_ADDRESS_LENGTH,
} from '../constants/inspection.constants';

/** An instant with an explicit UTC offset, e.g. 2026-10-01T10:30:00+05:30 —
 * a bare local time would be ambiguous. */
const WITH_OFFSET = /(Z|[+-]\d{2}:\d{2})$/;
const OFFSET_MESSAGE =
  'must be an ISO 8601 date-time with an explicit offset (e.g. 2026-10-01T10:30:00+05:30)';

/**
 * Only what the scrutiny officer decides. There is no status, department,
 * enterprise, application or actor field: the status is derived from the
 * schedule and everything else comes from the application and the caller.
 */
export class CreateInspectionDto {
  @ApiProperty({
    format: 'uuid',
    description:
      'An active Inspector of THIS application’s department. The department itself is never client-supplied.',
  })
  @IsUUID()
  inspectorUserId: string;

  @ApiProperty({
    maxLength: MAX_SITE_ADDRESS_LENGTH,
    description: 'Where the visit takes place (the site).',
  })
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_SITE_ADDRESS_LENGTH)
  siteAddress: string;

  @ApiPropertyOptional({
    example: '2026-10-01T10:30:00+05:30',
    description:
      'When the visit is scheduled; must be in the future. Omit to request the inspection without a date yet (status PENDING); giving one makes it SCHEDULED. The status itself is never sent.',
  })
  @IsOptional()
  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(WITH_OFFSET, { message: `scheduledAt ${OFFSET_MESSAGE}` })
  scheduledAt?: string;
}

/** Change an open inspection's inspector, schedule or site. At least one field
 * must differ from what is stored. */
export class UpdateInspectionDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Reassign to a different active Inspector of the same department. Needs a `reason`.',
  })
  @IsOptional()
  @IsUUID()
  inspectorUserId?: string;

  @ApiPropertyOptional({
    example: '2026-10-02T11:00:00+05:30',
    description:
      'Set (a PENDING inspection becomes SCHEDULED) or move the schedule; must be in the future. A schedule cannot be removed.',
  })
  @IsOptional()
  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(WITH_OFFSET, { message: `scheduledAt ${OFFSET_MESSAGE}` })
  scheduledAt?: string;

  @ApiPropertyOptional({ maxLength: MAX_SITE_ADDRESS_LENGTH })
  @IsOptional()
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_SITE_ADDRESS_LENGTH)
  siteAddress?: string;

  @ApiPropertyOptional({
    maxLength: MAX_REASON_LENGTH,
    description:
      'Why the inspector is being changed (required with `inspectorUserId`; kept in the audit trail).',
  })
  @IsOptional()
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_REASON_LENGTH)
  reason?: string;
}

export class ListInspectionsQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: MAX_PAGE_SIZE,
    default: DEFAULT_PAGE_SIZE,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  pageSize?: number;

  @ApiPropertyOptional({ enum: InspectionStatus })
  @IsOptional()
  @IsEnum(InspectionStatus)
  status?: InspectionStatus;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Narrow to one application. It can only narrow: access is decided from your own roles.',
  })
  @IsOptional()
  @IsUUID()
  applicationId?: string;

  @ApiPropertyOptional({
    example: '2026-10-01T00:00:00Z',
    description: 'Scheduled at or after this instant.',
  })
  @IsOptional()
  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(WITH_OFFSET, { message: `scheduledFrom ${OFFSET_MESSAGE}` })
  scheduledFrom?: string;

  @ApiPropertyOptional({
    example: '2026-10-31T23:59:59Z',
    description: 'Scheduled at or before this instant.',
  })
  @IsOptional()
  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(WITH_OFFSET, { message: `scheduledTo ${OFFSET_MESSAGE}` })
  scheduledTo?: string;
}
