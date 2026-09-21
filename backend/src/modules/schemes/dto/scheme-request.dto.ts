import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SchemeApplicationStatus, SchemePublishStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { Trim } from '../../../common/decorators/trim.decorator';
import { SUPPORTED_DOCUMENT_TYPES } from '../../documents/constants/document.constants';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '../scheme.constants';

export const MAX_SCHEME_NAME = 200;
export const MAX_SCHEME_TEXT = 5000;
export const MAX_SCHEME_SHORT = 200;
export const MAX_SCHEME_SOURCE = 500;
export const MAX_FACET_VALUES = 50;
export const MAX_DECISION_REASON = 2000;
const MAX_RULE_PRIORITY = 10_000;

const SUPPORTED_MIMES = SUPPORTED_DOCUMENT_TYPES.map((t) => t.mime);

/** Trims each string of a list (leaving anything else for the validator to
 * refuse), and drops repeats. */
const cleanList = ({ value }: { value: unknown }) =>
  Array.isArray(value)
    ? [
        ...new Set(
          value.map((v) => (typeof v === 'string' ? v.trim() : v) as unknown),
        ),
      ]
    : value;

/**
 * A scheme catalogue entry as the Scheme Officer drafts it (FRD 29.2 / 34). Only
 * the fields the requirements define. Absent by design: publish status, version,
 * activity, creator, publisher (all set by the server) and any benefit amount,
 * threshold or deadline default - the department supplies every value.
 */
export class CreateSchemeDto {
  @ApiProperty({
    format: 'uuid',
    description:
      'The administering department. You must hold the Scheme Officer role for it.',
  })
  @IsUUID()
  departmentId: string;

  @ApiProperty({ maxLength: MAX_SCHEME_NAME })
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_SCHEME_NAME)
  name: string;

  @ApiProperty({ maxLength: MAX_SCHEME_TEXT })
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_SCHEME_TEXT)
  description: string;

  @ApiProperty({
    maxLength: MAX_SCHEME_TEXT,
    description: 'The benefits offered, in the department’s own words.',
  })
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_SCHEME_TEXT)
  benefits: string;

  @ApiProperty({
    maxLength: MAX_SCHEME_TEXT,
    description:
      'The eligibility criteria in plain language (FRD 29.2). What the applicant reads; the recommendation itself is decided by the eligibility rules.',
  })
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_SCHEME_TEXT)
  eligibilityCriteria: string;

  @ApiPropertyOptional({
    maxLength: MAX_SCHEME_SHORT,
    description:
      'The benefit type the catalogue can be filtered by (FRD 29.1). Free text: the requirements define no vocabulary.',
  })
  @IsOptional()
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_SCHEME_SHORT)
  benefitType?: string;

  @ApiPropertyOptional({
    type: [String],
    description:
      'Sectors the scheme applies to (FRD 29.2), for browsing and filtering. Empty / omitted = not restricted. Display only: eligibility rules decide the recommendation.',
  })
  @IsOptional()
  @Transform(cleanList)
  @IsArray()
  @ArrayMaxSize(MAX_FACET_VALUES)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(MAX_SCHEME_SHORT, { each: true })
  applicableSectors?: string[];

  @ApiPropertyOptional({
    type: [String],
    description:
      'Districts (locations) the scheme applies to. Empty / omitted = not restricted. Display only.',
  })
  @IsOptional()
  @Transform(cleanList)
  @IsArray()
  @ArrayMaxSize(MAX_FACET_VALUES)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(MAX_SCHEME_SHORT, { each: true })
  applicableDistricts?: string[];

  @ApiPropertyOptional({
    type: [String],
    description:
      'Enterprise sizes the scheme applies to. Empty / omitted = not restricted. Display only.',
  })
  @IsOptional()
  @Transform(cleanList)
  @IsArray()
  @ArrayMaxSize(MAX_FACET_VALUES)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(MAX_SCHEME_SHORT, { each: true })
  applicableEnterpriseSizes?: string[];

  @ApiPropertyOptional({
    example: '2027-03-31T18:29:59.000Z',
    description:
      'The application deadline (FRD 29.2 "if any"), an ISO 8601 instant. Omitted = no deadline. Applications are refused after it.',
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  applicationDeadline?: string;

  @ApiPropertyOptional({
    maxLength: MAX_SCHEME_SOURCE,
    description:
      'Where the scheme comes from, as the department cites it (a notification, GR or portal). Omitted = not supplied; never guessed.',
  })
  @IsOptional()
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_SCHEME_SOURCE)
  sourceReference?: string;
}

/** Edits to a DRAFT scheme. Every field optional; a nullable one accepts `null`
 * to clear it. The department cannot be changed. */
export class UpdateSchemeDto {
  @ApiPropertyOptional({ maxLength: MAX_SCHEME_NAME })
  @IsOptional()
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_SCHEME_NAME)
  name?: string;

  @ApiPropertyOptional({ maxLength: MAX_SCHEME_TEXT })
  @IsOptional()
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_SCHEME_TEXT)
  description?: string;

  @ApiPropertyOptional({ maxLength: MAX_SCHEME_TEXT })
  @IsOptional()
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_SCHEME_TEXT)
  benefits?: string;

  @ApiPropertyOptional({ maxLength: MAX_SCHEME_TEXT })
  @IsOptional()
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_SCHEME_TEXT)
  eligibilityCriteria?: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_SCHEME_SHORT)
  benefitType?: string | null;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @Transform(cleanList)
  @IsArray()
  @ArrayMaxSize(MAX_FACET_VALUES)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(MAX_SCHEME_SHORT, { each: true })
  applicableSectors?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @Transform(cleanList)
  @IsArray()
  @ArrayMaxSize(MAX_FACET_VALUES)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(MAX_SCHEME_SHORT, { each: true })
  applicableDistricts?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @Transform(cleanList)
  @IsArray()
  @ArrayMaxSize(MAX_FACET_VALUES)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  @MaxLength(MAX_SCHEME_SHORT, { each: true })
  applicableEnterpriseSizes?: string[];

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'ISO 8601 instant; null removes the deadline.',
  })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsISO8601({ strict: true })
  applicationDeadline?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_SCHEME_SOURCE)
  sourceReference?: string | null;
}

/** A new version of the scheme's eligibility rule (TRD 15 / Blueprint 12.7). */
export class AddSchemeRuleDto {
  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description:
      'The eligibility condition, in the same closed grammar as approval discovery: { "all": [...] } / { "any": [...] } / { "field", "op", "value" } over the project characteristics (sector_code, district, enterprise_size_band, investment_amount, ...). Validated against the grammar; an invalid rule is refused.',
  })
  @IsObject()
  conditions: Record<string, unknown>;

  @ApiPropertyOptional({
    description: 'When this version takes effect. Default: now.',
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  effectiveFrom?: string;

  @ApiPropertyOptional({ description: 'When it stops applying, if it does.' })
  @IsOptional()
  @IsISO8601({ strict: true })
  effectiveTo?: string;

  @ApiPropertyOptional({
    default: true,
    description:
      'false retires the rule: the scheme is then not recommended (an older version is not used instead).',
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({
    default: 100,
    minimum: 0,
    maximum: MAX_RULE_PRIORITY,
    description:
      'Order in the recommendation list (lower first). The requirements define no ranking criterion, so this is the department’s own ordering.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_RULE_PRIORITY)
  priority?: number;

  @ApiProperty({
    minLength: 3,
    maxLength: MAX_SCHEME_SOURCE,
    description:
      'Evidence for the rule. Use the literal "TBD" if the department has not supplied one - never a guessed citation.',
  })
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_SCHEME_SOURCE)
  sourceReference: string;
}

const MIME_DESCRIPTION =
  'Accepted content types; empty / omitted = every supported type. One of: ' +
  SUPPORTED_MIMES.join(', ');

/** A document the scheme requires (FRD 29.2 "required documents"). */
export class CreateSchemeDocumentRequirementDto {
  @ApiProperty({ maxLength: MAX_SCHEME_SHORT })
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_SCHEME_SHORT)
  name: string;

  @ApiProperty({
    description:
      'Whether an application can be approved without a usable document for it.',
  })
  @IsBoolean()
  isMandatory: boolean;

  @ApiPropertyOptional({ maxLength: MAX_SCHEME_TEXT })
  @IsOptional()
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_SCHEME_TEXT)
  description?: string;

  @ApiPropertyOptional({
    minimum: 1,
    description:
      'A size limit for this document, in bytes. It can only lower the platform ceiling. Omitted = platform default.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxSizeBytes?: number;

  @ApiPropertyOptional({ type: [String], description: MIME_DESCRIPTION })
  @IsOptional()
  @Transform(cleanList)
  @IsArray()
  @ArrayMaxSize(SUPPORTED_MIMES.length)
  @IsIn(SUPPORTED_MIMES, { each: true })
  allowedMimeTypes?: string[];
}

export class UpdateSchemeDocumentRequirementDto {
  @ApiPropertyOptional({ maxLength: MAX_SCHEME_SHORT })
  @IsOptional()
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_SCHEME_SHORT)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isMandatory?: boolean;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_SCHEME_TEXT)
  description?: string | null;

  @ApiPropertyOptional({ type: Number, nullable: true, minimum: 1 })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(1)
  maxSizeBytes?: number | null;

  @ApiPropertyOptional({ type: [String], description: MIME_DESCRIPTION })
  @IsOptional()
  @Transform(cleanList)
  @IsArray()
  @ArrayMaxSize(SUPPORTED_MIMES.length)
  @IsIn(SUPPORTED_MIMES, { each: true })
  allowedMimeTypes?: string[];
}

export class SetSchemeActiveDto {
  @ApiProperty({
    description:
      'false hides the scheme from applicants and stops new applications; existing applications are unaffected. Does not change its published content.',
  })
  @IsBoolean()
  isActive: boolean;
}

/** Officer catalogue list filters. Scope is applied from the caller's own roles. */
export class ListSchemesAdminQueryDto {
  @ApiPropertyOptional({ enum: SchemePublishStatus })
  @IsOptional()
  @IsEnum(SchemePublishStatus)
  publishStatus?: SchemePublishStatus;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  departmentId?: string;
}

/** Public / applicant catalogue browsing (FRD 29.1). */
export class BrowseSchemesQueryDto {
  @ApiPropertyOptional({
    maxLength: 100,
    description:
      'Keyword: matches the name, description, benefits and eligibility text (case-insensitive).',
  })
  @IsOptional()
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({
    description:
      'Sector. Schemes that list sectors are shown when one matches; a scheme that lists none is not restricted and stays listed.',
  })
  @IsOptional()
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_SCHEME_SHORT)
  sector?: string;

  @ApiPropertyOptional({
    description: 'Location / district, matched like `sector`.',
  })
  @IsOptional()
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_SCHEME_SHORT)
  district?: string;

  @ApiPropertyOptional({
    description: 'Enterprise size, matched like `sector`.',
  })
  @IsOptional()
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_SCHEME_SHORT)
  enterpriseSize?: string;

  @ApiPropertyOptional({
    description: 'Benefit type (exact, case-insensitive).',
  })
  @IsOptional()
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_SCHEME_SHORT)
  benefitType?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  departmentId?: string;

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
}

export class ListRecommendationsQueryDto {
  @ApiPropertyOptional({
    minimum: 1,
    maximum: MAX_PAGE_SIZE,
    description:
      'Return only the first N of the ranked list. The requirements call it a "short" list but define no length, so there is no default cap.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  limit?: number;
}

export class ListSchemeApplicationsQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  projectId?: string;

  @ApiPropertyOptional({ enum: SchemeApplicationStatus })
  @IsOptional()
  @IsEnum(SchemeApplicationStatus)
  status?: SchemeApplicationStatus;
}

export class ListOfficerSchemeApplicationsQueryDto {
  @ApiPropertyOptional({ enum: SchemeApplicationStatus })
  @IsOptional()
  @IsEnum(SchemeApplicationStatus)
  status?: SchemeApplicationStatus;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  schemeId?: string;

  @ApiPropertyOptional({
    maxLength: 100,
    description:
      'Reference number, or enterprise / project name or reference (case-insensitive substring).',
  })
  @IsOptional()
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  q?: string;

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
}

/**
 * The Scheme Officer's final decision (FRD 34 "record final decisions with a
 * reason"). Nothing but the outcome and the reason: no status, no user, no
 * time, no amount is ever taken from the client.
 */
export class DecideSchemeApplicationDto {
  @ApiProperty({ enum: ['APPROVE', 'REJECT'] })
  @IsIn(['APPROVE', 'REJECT'])
  outcome: 'APPROVE' | 'REJECT';

  @ApiProperty({
    maxLength: MAX_DECISION_REASON,
    description: 'The recorded reason (mandatory). The applicant sees it.',
  })
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_DECISION_REASON)
  reason: string;
}
