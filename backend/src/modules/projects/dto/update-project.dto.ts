import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsOptional, ValidateIf, ValidateNested } from 'class-validator';
import { applyDecorators } from '@nestjs/common';
import {
  CONSTRUCTION_STATUSES,
  ENTERPRISE_SIZE_BANDS,
  LAND_STATUSES,
  PRODUCTION_STATUSES,
  PROJECT_STAGES,
} from '../constants/project-values.constant';
import { LandLeaseDetailsDto } from './land-lease-details.dto';
import {
  AdditionalSiteDetailsRule,
  CommissioningDateRule,
  ConstructionStatusRule,
  DistrictRule,
  EmploymentCountRule,
  EnvironmentalCategoryRule,
  HazardousCategoryRule,
  HazardousFlagRule,
  IndustrialAreaRule,
  InvestmentAmountRule,
  LandStatusRule,
  NameRule,
  ProductionStatusRule,
  ProjectStageRule,
  SectorCodeRule,
  SizeBandRule,
  TalukaRule,
} from './project-field-rules';

/** Mandatory columns can be changed but never cleared: `null` is rejected,
 * while an omitted (undefined) field is simply left unchanged. */
const provided = (...rules: PropertyDecorator[]) =>
  applyDecorators(
    ValidateIf((_o, value) => value !== undefined),
    ...rules,
  );

/**
 * Body of `PUT /enterprises/:enterpriseId/projects/:projectId`. Omitted
 * fields are unchanged; optional fields may be set to `null` to clear them.
 * Same field rules as creation. There is no status field: the requirements
 * define no project lifecycle, so nothing here can move a project between
 * states. `enterpriseId` and `referenceNumber` can never be changed.
 *
 * Cross-field rules are checked against the RESULTING project (see
 * ProjectsService): lease details only with land status `leased`, and a
 * hazardous category only when `hazardousFlag` is true.
 */
export class UpdateProjectDto {
  @ApiPropertyOptional()
  @provided(NameRule())
  name?: string;

  @ApiPropertyOptional()
  @provided(DistrictRule())
  district?: string;

  @ApiPropertyOptional()
  @provided(TalukaRule())
  taluka?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IndustrialAreaRule()
  industrialArea?: string | null;

  @ApiPropertyOptional()
  @provided(SectorCodeRule())
  sectorCode?: string;

  @ApiPropertyOptional({ enum: ENTERPRISE_SIZE_BANDS })
  @provided(SizeBandRule())
  enterpriseSizeBand?: string;

  @ApiPropertyOptional()
  @provided(InvestmentAmountRule())
  investmentAmount?: number;

  @ApiPropertyOptional()
  @provided(EmploymentCountRule())
  employmentCount?: number;

  @ApiPropertyOptional({ enum: PROJECT_STAGES })
  @provided(ProjectStageRule())
  projectStage?: string;

  @ApiPropertyOptional({ enum: LAND_STATUSES })
  @provided(LandStatusRule())
  landStatus?: string;

  @ApiPropertyOptional({
    type: LandLeaseDetailsDto,
    nullable: true,
    description:
      'Only while landStatus is "leased". Changing landStatus away from "leased" requires sending null here explicitly.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => LandLeaseDetailsDto)
  landLeaseDetails?: LandLeaseDetailsDto | null;

  @ApiPropertyOptional({ enum: CONSTRUCTION_STATUSES })
  @provided(ConstructionStatusRule())
  constructionStatus?: string;

  @ApiPropertyOptional({ enum: PRODUCTION_STATUSES })
  @provided(ProductionStatusRule())
  productionStatus?: string;

  @ApiPropertyOptional()
  @provided(HazardousFlagRule())
  hazardousFlag?: boolean;

  @ApiPropertyOptional({
    nullable: true,
    description:
      'Only while hazardousFlag is true. Setting hazardousFlag to false requires sending null here explicitly.',
  })
  @IsOptional()
  @HazardousCategoryRule()
  hazardousCategory?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @EnvironmentalCategoryRule()
  environmentalCategory?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @AdditionalSiteDetailsRule()
  additionalSiteDetails?: string | null;

  @ApiPropertyOptional({ nullable: true, example: '2027-04-01' })
  @IsOptional()
  @CommissioningDateRule()
  expectedCommissioningDate?: string | null;
}
