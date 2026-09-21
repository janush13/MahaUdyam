import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsOptional, ValidateNested } from 'class-validator';
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

/**
 * Body of `POST /enterprises/:enterpriseId/projects`. Mandatory and optional
 * fields follow FRD §9.2 Step 6-7.
 *
 * Deliberately absent: `enterpriseId` (comes from the authorised route),
 * `id`, `referenceNumber` (generated) and any `status` — the requirements
 * define no project lifecycle. With `forbidNonWhitelisted`, sending any of
 * them is a 400.
 */
export class CreateProjectDto {
  @ApiProperty({ example: 'Chakan Unit 2 — Precision Machining Expansion' })
  @NameRule()
  name: string;

  @ApiProperty({ example: 'Pune' })
  @DistrictRule()
  district: string;

  @ApiProperty({ example: 'Khed' })
  @TalukaRule()
  taluka: string;

  @ApiPropertyOptional({ example: 'MIDC Chakan Phase II' })
  @IsOptional()
  @IndustrialAreaRule()
  industrialArea?: string;

  @ApiProperty({
    example: '25910',
    description: 'Activity / sector code (NIC). Format still to be validated.',
  })
  @SectorCodeRule()
  sectorCode: string;

  @ApiProperty({ enum: ENTERPRISE_SIZE_BANDS, example: 'small' })
  @SizeBandRule()
  enterpriseSizeBand: string;

  @ApiProperty({ example: 25000000.5, description: 'Investment in INR.' })
  @InvestmentAmountRule()
  investmentAmount: number;

  @ApiProperty({ example: 40, description: 'Proposed headcount.' })
  @EmploymentCountRule()
  employmentCount: number;

  @ApiProperty({ enum: PROJECT_STAGES, example: 'expansion' })
  @ProjectStageRule()
  projectStage: string;

  @ApiProperty({ enum: LAND_STATUSES, example: 'leased' })
  @LandStatusRule()
  landStatus: string;

  @ApiPropertyOptional({
    type: LandLeaseDetailsDto,
    description: 'Allowed only when landStatus is "leased".',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => LandLeaseDetailsDto)
  landLeaseDetails?: LandLeaseDetailsDto;

  @ApiProperty({ enum: CONSTRUCTION_STATUSES, example: 'not_started' })
  @ConstructionStatusRule()
  constructionStatus: string;

  @ApiProperty({ enum: PRODUCTION_STATUSES, example: 'pre_production' })
  @ProductionStatusRule()
  productionStatus: string;

  @ApiProperty({ example: false })
  @HazardousFlagRule()
  hazardousFlag: boolean;

  @ApiPropertyOptional({
    example: 'Chemical processing',
    description: 'Allowed only when hazardousFlag is true.',
  })
  @IsOptional()
  @HazardousCategoryRule()
  hazardousCategory?: string;

  @ApiPropertyOptional({
    example: 'Category B',
    description:
      'Environmental category — criteria are statutory and still to be validated, so free text.',
  })
  @IsOptional()
  @EnvironmentalCategoryRule()
  environmentalCategory?: string;

  @ApiPropertyOptional({
    example: 'Adjoins the existing Unit 1 boundary wall.',
  })
  @IsOptional()
  @AdditionalSiteDetailsRule()
  additionalSiteDetails?: string;

  @ApiPropertyOptional({ example: '2027-04-01', description: 'YYYY-MM-DD' })
  @IsOptional()
  @CommissioningDateRule()
  expectedCommissioningDate?: string;
}
