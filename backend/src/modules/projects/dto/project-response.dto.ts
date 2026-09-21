import { ApiProperty } from '@nestjs/swagger';
import { LandLeaseDetailsDto } from './land-lease-details.dto';

/**
 * Hand-built from selected fields (never a spread of the Prisma row), like
 * the enterprise and auth DTOs. There is deliberately no `status` field: the
 * requirements define no project lifecycle.
 */
export class ProjectResponseDto {
  @ApiProperty() id: string;
  @ApiProperty({ example: 'PRJ-2026-000001' }) referenceNumber: string;
  @ApiProperty() enterpriseId: string;
  @ApiProperty() name: string;
  @ApiProperty() district: string;
  @ApiProperty() taluka: string;
  @ApiProperty({ nullable: true }) industrialArea: string | null;
  @ApiProperty() sectorCode: string;
  @ApiProperty() enterpriseSizeBand: string;
  @ApiProperty({ description: 'INR' }) investmentAmount: number;
  @ApiProperty() employmentCount: number;
  @ApiProperty() projectStage: string;
  @ApiProperty() landStatus: string;
  @ApiProperty({ type: LandLeaseDetailsDto, nullable: true })
  landLeaseDetails: LandLeaseDetailsDto | null;
  @ApiProperty() constructionStatus: string;
  @ApiProperty() productionStatus: string;
  @ApiProperty() hazardousFlag: boolean;
  @ApiProperty({ nullable: true }) hazardousCategory: string | null;
  @ApiProperty({ nullable: true }) environmentalCategory: string | null;
  @ApiProperty({ nullable: true }) additionalSiteDetails: string | null;
  @ApiProperty({ nullable: true, example: '2027-04-01' })
  expectedCommissioningDate: string | null;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
}
