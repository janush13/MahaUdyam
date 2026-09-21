import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RepresentativeScope } from '@prisma/client';

/**
 * Hand-built from selected fields (never a spread of the Prisma row), like
 * the auth DTOs — `ownerUserId` and any future internal column can never
 * leak through by accident.
 */
export class EnterpriseResponseDto {
  @ApiProperty() id: string;
  @ApiProperty({ example: 'ENT-2026-000001' }) referenceNumber: string;
  @ApiProperty() name: string;
  @ApiProperty({ nullable: true }) tradeName: string | null;
  @ApiProperty() businessType: string;
  @ApiProperty() registrationNumber: string;
  @ApiProperty() registrationNumberType: string;
  @ApiProperty() sector: string;
  @ApiProperty() address: string;
  @ApiProperty({ nullable: true }) website: string | null;
  @ApiProperty({ nullable: true }) contactPersonName: string | null;
  @ApiProperty({ nullable: true }) contactPersonMobile: string | null;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;

  @ApiProperty({
    enum: ['OWNER', 'REPRESENTATIVE'],
    description: "The caller's relationship to this enterprise.",
  })
  accessType: 'OWNER' | 'REPRESENTATIVE';

  @ApiPropertyOptional({
    enum: RepresentativeScope,
    description: 'Present only when accessType is REPRESENTATIVE.',
  })
  representativeScope?: RepresentativeScope;
}
