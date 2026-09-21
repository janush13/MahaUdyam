import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SlaStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { Trim } from '../../../common/decorators/trim.decorator';

export const MAX_SLA_DAYS = 3650;
export const MAX_HOLIDAY_DESCRIPTION_LENGTH = 200;
export const SLA_DEFAULT_PAGE_SIZE = 25;
export const SLA_MAX_PAGE_SIZE = 100;

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

const toBoolean = ({ value }: { value: unknown }) =>
  value === 'true' ? true : value === 'false' ? false : value;

/** A stage's SLA configuration (Blueprint 23.1: a plain integer editable by a
 * Department Administrator). Both fields are optional; at least one must
 * change something. */
export class UpdateSlaStageDto {
  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    minimum: 1,
    maximum: MAX_SLA_DAYS,
    description:
      'Working days for the stage, or null to return to "Timeline not yet configured". Applies to applications submitted AFTER the change; running clocks keep the value they started with.',
  })
  @ValidateIf((_, value) => value !== undefined)
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(1)
  @Max(MAX_SLA_DAYS)
  slaDays?: number | null;

  @ApiPropertyOptional({
    description:
      'Pause the clock while a query awaits the applicant (TRD 12). Applies to applications submitted after the change.',
  })
  @IsOptional()
  @IsBoolean()
  pauseOnQuery?: boolean;
}

export class AddSlaHolidayDto {
  @ApiProperty({ example: '2026-10-02', description: 'Calendar date.' })
  @IsString()
  @Matches(DATE_ONLY, { message: 'date must be YYYY-MM-DD' })
  date: string;

  @ApiProperty({ maxLength: MAX_HOLIDAY_DESCRIPTION_LENGTH })
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_HOLIDAY_DESCRIPTION_LENGTH)
  description: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'The department whose calendar this is. Required for a Department Administrator; must be omitted by a System Administrator (state-wide).',
  })
  @IsOptional()
  @IsUUID()
  departmentId?: string;
}

export class ListSlaQueryDto {
  @ApiPropertyOptional({ enum: SlaStatus })
  @IsOptional()
  @IsEnum(SlaStatus)
  status?: SlaStatus;

  @ApiPropertyOptional({
    description: 'Only breached (true) or only not-breached (false) clocks.',
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  breached?: boolean;

  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: SLA_MAX_PAGE_SIZE,
    default: SLA_DEFAULT_PAGE_SIZE,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(SLA_MAX_PAGE_SIZE)
  pageSize?: number;
}
