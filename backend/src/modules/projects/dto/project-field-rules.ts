import { applyDecorators } from '@nestjs/common';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsPositive,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Trim } from '../../../common/decorators/trim.decorator';
import {
  CONSTRUCTION_STATUSES,
  ENTERPRISE_SIZE_BANDS,
  LAND_STATUSES,
  PRODUCTION_STATUSES,
  PROJECT_STAGES,
} from '../constants/project-values.constant';

/**
 * One definition of each field's rule, applied by both CreateProjectDto and
 * UpdateProjectDto so the two can never drift apart. Update additionally
 * wraps the mandatory ones so `null` is rejected (mandatory data can change,
 * never be cleared).
 */
export const NameRule = () =>
  applyDecorators(Trim(), IsString(), MinLength(2), MaxLength(200));
export const DistrictRule = () =>
  applyDecorators(Trim(), IsString(), MinLength(2), MaxLength(100));
export const TalukaRule = () =>
  applyDecorators(Trim(), IsString(), MinLength(2), MaxLength(100));
export const IndustrialAreaRule = () =>
  applyDecorators(Trim(), IsString(), IsNotEmpty(), MaxLength(150));

/** Sector / NIC code. The code format is still to be validated with the
 * department, so only a length limit is applied (same stance as the
 * enterprise registration number). */
export const SectorCodeRule = () =>
  applyDecorators(Trim(), IsString(), MinLength(2), MaxLength(50));

export const SizeBandRule = () => IsIn(ENTERPRISE_SIZE_BANDS);
export const ProjectStageRule = () => IsIn(PROJECT_STAGES);
export const LandStatusRule = () => IsIn(LAND_STATUSES);
export const ConstructionStatusRule = () => IsIn(CONSTRUCTION_STATUSES);
export const ProductionStatusRule = () => IsIn(PRODUCTION_STATUSES);

/** Stored as NUMERIC(16,2), but accepted only up to 15 significant digits
 * (13 integer + 2 decimal, i.e. about INR 10 trillion): a JSON/JS number is a
 * double and cannot represent 16 digits exactly, so a larger "maximum" could
 * silently round. Comfortably above any real project investment. */
export const InvestmentAmountRule = () =>
  applyDecorators(
    IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 }),
    IsPositive(),
    Max(9_999_999_999_999.99),
  );

export const EmploymentCountRule = () =>
  applyDecorators(IsInt(), Min(0), Max(1_000_000));

/** Strict boolean: the string "false" must not be coerced to a value. */
export const HazardousFlagRule = () => IsBoolean();

/** Environmental category criteria are statutory and TO-BE-VALIDATED (TRD
 * §4.2), so it is optional free text. */
export const EnvironmentalCategoryRule = () =>
  applyDecorators(Trim(), IsString(), IsNotEmpty(), MaxLength(100));
export const HazardousCategoryRule = () =>
  applyDecorators(Trim(), IsString(), IsNotEmpty(), MaxLength(100));

export const AdditionalSiteDetailsRule = () =>
  applyDecorators(Trim(), IsString(), IsNotEmpty(), MaxLength(2000));

/** Calendar date, `YYYY-MM-DD`. */
export const CommissioningDateRule = () =>
  applyDecorators(
    Trim(),
    IsString(),
    Matches(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, {
      message: 'expectedCommissioningDate must be a date in YYYY-MM-DD format',
    }),
  );
