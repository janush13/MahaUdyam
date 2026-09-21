import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ComplianceFrequency, ComplianceRecordStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { Trim } from '../../../common/decorators/trim.decorator';

export const MAX_DAYS = 3650;
export const MAX_DESCRIPTION_LENGTH = 2000;
export const MAX_SOURCE_LENGTH = 500;
export const COMPLIANCE_DEFAULT_PAGE_SIZE = 25;
export const COMPLIANCE_MAX_PAGE_SIZE = 100;

/**
 * A department's explicit obligation for an approval type (FRD 27.2 / TRD 14).
 * There is no default anywhere: the requirements define no obligation, no first
 * due date and no window, so each is the department's to supply (or, for the
 * first due date, to leave unconfigured).
 */
export class CreateComplianceRequirementDto {
  @ApiProperty({
    format: 'uuid',
    description: 'The approval type it applies to.',
  })
  @IsUUID()
  approvalTypeId: string;

  @ApiProperty({
    maxLength: MAX_DESCRIPTION_LENGTH,
    description: 'The requirement in plain language (FRD 27.1).',
  })
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_DESCRIPTION_LENGTH)
  description: string;

  @ApiProperty({
    enum: ComplianceFrequency,
    description:
      'ONE_TIME, MONTHLY or ANNUAL (Blueprint 12.6). Each occurrence of a recurring obligation is its own record.',
  })
  @IsEnum(ComplianceFrequency)
  frequency: ComplianceFrequency;

  @ApiPropertyOptional({
    default: false,
    description:
      'Whether a supporting document is required to evidence fulfilment (FRD 27.1).',
  })
  @IsOptional()
  @IsBoolean()
  evidenceRequired?: boolean;

  @ApiPropertyOptional({
    maxLength: MAX_DESCRIPTION_LENGTH,
    description: 'What the applicant must do (FRD 27.1).',
  })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(MAX_DESCRIPTION_LENGTH)
  applicantAction?: string;

  @ApiPropertyOptional({
    maxLength: MAX_SOURCE_LENGTH,
    description:
      'The source the obligation derives from (a clause, notice or order), as the department cites it.',
  })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(MAX_SOURCE_LENGTH)
  sourceReference?: string;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    minimum: 0,
    maximum: MAX_DAYS,
    description:
      'Calendar days from the start of the compliance period to the FIRST due date. Omit or null = "Due date not yet configured": no duration is assumed.',
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(0)
  @Max(MAX_DAYS)
  firstDueAfterDays?: number | null;

  @ApiPropertyOptional({
    minimum: 0,
    maximum: MAX_DAYS,
    default: 0,
    description:
      'An obligation is DUE from this many days before its due date; 0 = only on the due date itself.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_DAYS)
  dueWindowDays?: number;
}

/** A change to a requirement. Applies to occurrences created AFTER it: records
 * already created keep the version they were created under. */
export class UpdateComplianceRequirementDto {
  @ApiPropertyOptional({ maxLength: MAX_DESCRIPTION_LENGTH })
  @IsOptional()
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_DESCRIPTION_LENGTH)
  description?: string;

  @ApiPropertyOptional({ enum: ComplianceFrequency })
  @IsOptional()
  @IsEnum(ComplianceFrequency)
  frequency?: ComplianceFrequency;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  evidenceRequired?: boolean;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Trim()
  @IsString()
  @MaxLength(MAX_DESCRIPTION_LENGTH)
  applicantAction?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @Trim()
  @IsString()
  @MaxLength(MAX_SOURCE_LENGTH)
  sourceReference?: string | null;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    minimum: 0,
    maximum: MAX_DAYS,
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(0)
  @Max(MAX_DAYS)
  firstDueAfterDays?: number | null;

  @ApiPropertyOptional({ minimum: 0, maximum: MAX_DAYS })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_DAYS)
  dueWindowDays?: number;

  @ApiPropertyOptional({
    description:
      'false stops NEW occurrences from being created; existing records are kept.',
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class ListRequirementsQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  approvalTypeId?: string;
}

export class ListComplianceQueryDto {
  @ApiPropertyOptional({ enum: ComplianceRecordStatus })
  @IsOptional()
  @IsEnum(ComplianceRecordStatus)
  status?: ComplianceRecordStatus;

  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: COMPLIANCE_MAX_PAGE_SIZE,
    default: COMPLIANCE_DEFAULT_PAGE_SIZE,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(COMPLIANCE_MAX_PAGE_SIZE)
  pageSize?: number;
}
