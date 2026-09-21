import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ApplicantStatus, InternalApplicationState } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Trim } from '../../../common/decorators/trim.decorator';
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  MAX_TEXT_LENGTH,
} from '../constants/officer.constants';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Internal states an officer can filter by (never DRAFT: drafts are the
 * applicant's private work and are invisible to every officer). */
export const FILTERABLE_STATES = Object.values(InternalApplicationState).filter(
  (s) => s !== 'DRAFT',
);

export const SORT_FIELDS = [
  'submittedAt',
  'updatedAt',
  'referenceNumber',
] as const;

const toBoolean = ({ value }: { value: unknown }) =>
  value === 'true' ? true : value === 'false' ? false : value;

/**
 * Filters for the officer queue. A closed, typed set — there is no raw query
 * language and no free-form field name. Department scope is applied by the
 * server from the caller's own roles; `departmentId` can only NARROW it.
 */
export class ListOfficerApplicationsQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({
    default: DEFAULT_PAGE_SIZE,
    minimum: 1,
    maximum: MAX_PAGE_SIZE,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  pageSize?: number;

  @ApiPropertyOptional({
    description:
      'Search: application reference, or enterprise / project name or reference number (case-insensitive, substring).',
    maxLength: 100,
  })
  @IsOptional()
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  approvalTypeId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Narrows to one of YOUR departments; a department you have no role in returns nothing.',
  })
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  enterpriseId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  projectId?: string;

  @ApiPropertyOptional({
    enum: FILTERABLE_STATES,
    description: 'The scrutiny status (internal workflow state).',
  })
  @IsOptional()
  @IsIn(FILTERABLE_STATES)
  internalState?: InternalApplicationState;

  @ApiPropertyOptional({ enum: ApplicantStatus })
  @IsOptional()
  @IsEnum(ApplicantStatus)
  applicantStatus?: ApplicantStatus;

  @ApiPropertyOptional({
    example: '2026-09-01',
    description: 'Submitted on or after (UTC date).',
  })
  @IsOptional()
  @Matches(DATE_ONLY, { message: 'submittedFrom must be YYYY-MM-DD' })
  submittedFrom?: string;

  @ApiPropertyOptional({
    example: '2026-09-30',
    description: 'Submitted on or before (UTC date).',
  })
  @IsOptional()
  @Matches(DATE_ONLY, { message: 'submittedTo must be YYYY-MM-DD' })
  submittedTo?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Assigned to this officer (meaningful for a Department Administrator’s supervisory view).',
  })
  @IsOptional()
  @IsUUID()
  assignedOfficerId?: string;

  @ApiPropertyOptional({
    description: 'Only applications with nobody assigned.',
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  unassigned?: boolean;

  @ApiPropertyOptional({
    enum: SORT_FIELDS,
    default: 'submittedAt',
    description: 'Ties are always broken by id, so ordering is stable.',
  })
  @IsOptional()
  @IsIn(SORT_FIELDS)
  sort?: (typeof SORT_FIELDS)[number];

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'asc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc';
}

export class AssignOfficerDto {
  @ApiProperty({
    format: 'uuid',
    description:
      'A Scrutiny Officer of THIS application’s department. The department itself is never client-supplied.',
  })
  @IsUUID()
  officerUserId: string;
}

export class ReassignOfficerDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  officerUserId: string;

  @ApiProperty({ minLength: 3, maxLength: 500 })
  @Trim()
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason: string;
}

export class RecordObservationDto {
  @ApiProperty({
    maxLength: MAX_TEXT_LENGTH,
    description:
      'An INTERNAL scrutiny observation — never shown to the applicant unless it is turned into a formal query.',
  })
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_TEXT_LENGTH)
  body: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'A document of THIS application the observation is about.',
  })
  @IsOptional()
  @IsUUID()
  relatedDocumentId?: string;

  @ApiPropertyOptional({
    example: 'proposedCapacity',
    description:
      'The application field (a form-data or project field name) the observation is about.',
  })
  @IsOptional()
  @Matches(/^[A-Za-z][A-Za-z0-9_.]{0,99}$/, {
    message: 'relatedField must be a field name',
  })
  relatedField?: string;
}

export class RaiseQueryDto {
  @ApiProperty({
    maxLength: MAX_TEXT_LENGTH,
    description:
      'The question / request for clarification, in plain language. Immutable once raised.',
  })
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_TEXT_LENGTH)
  question: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'An internal observation of this application this query is raised from.',
  })
  @IsOptional()
  @IsUUID()
  sourceObservationId?: string;
}

export class RecommendDto {
  @ApiProperty({
    enum: ['APPROVE', 'REJECT'],
    description:
      'A RECOMMENDATION to the Approving Authority. It is not a decision and changes no outcome.',
  })
  @IsIn(['APPROVE', 'REJECT'])
  outcome: 'APPROVE' | 'REJECT';

  @ApiProperty({
    maxLength: 2000,
    description: 'The recorded reason (mandatory).',
  })
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  reason: string;
}

export class ReviewDocumentDto {
  @ApiProperty({ enum: ['VERIFIED', 'REJECTED'] })
  @IsIn(['VERIFIED', 'REJECTED'])
  verdict: 'VERIFIED' | 'REJECTED';

  @ApiPropertyOptional({
    maxLength: 2000,
    description:
      'Mandatory when REJECTED (the reason the applicant will see); internal notes when VERIFIED.',
  })
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @ApiPropertyOptional({
    example: '2027-03-31',
    description:
      'How long a VERIFIED document remains valid, where the department states it.',
  })
  @IsOptional()
  @Matches(DATE_ONLY, { message: 'validUntil must be YYYY-MM-DD' })
  validUntil?: string;
}

/** Applicant side: the response to a query. */
export class RespondToQueryDto {
  @ApiProperty({ maxLength: MAX_TEXT_LENGTH })
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_TEXT_LENGTH)
  responseText: string;
}
