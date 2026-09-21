import { ApiPropertyOptional } from '@nestjs/swagger';
import { RepresentativeScope } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsDate,
  IsEnum,
  IsOptional,
  IsUUID,
} from 'class-validator';

/**
 * Body of `PATCH /enterprises/:enterpriseId/representatives/:representativeId`
 * (owner only). Omitted fields are unchanged; `expiresAt: null` removes the
 * expiry. Increasing the scope or widening the project list sends an
 * already-accepted authorisation back to PENDING for re-acceptance.
 */
export class UpdateRepresentativeDto {
  @ApiPropertyOptional({ enum: RepresentativeScope })
  @IsOptional()
  @IsEnum(RepresentativeScope)
  scope?: RepresentativeScope;

  @ApiPropertyOptional({
    type: [String],
    description:
      'Replaces the project restriction. Empty array = every project.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  projectIds?: string[];

  @ApiPropertyOptional({
    nullable: true,
    example: '2027-03-31T23:59:59.000Z',
    description: 'New expiry (must be in the future), or null to remove it.',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  expiresAt?: Date | null;
}
