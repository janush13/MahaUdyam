import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RepresentativeScope } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsDate,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { Trim } from '../../../common/decorators/trim.decorator';

/**
 * Body of `POST /enterprises/:enterpriseId/representatives`. The caller is
 * always the enterprise owner (enforced by the route guard), the resulting
 * authorisation is always PENDING (the representative must accept it —
 * FRD §20.2), and there is no `status` field to set: it cannot be granted
 * as ACTIVE directly.
 */
export class AuthoriseRepresentativeDto {
  @ApiProperty({
    example: 'consultant@example.com',
    description:
      "The representative's registered email or mobile number (FRD §20.2).",
  })
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(254)
  emailOrMobile: string;

  @ApiProperty({ enum: RepresentativeScope, example: 'PREPARE_SUBMIT' })
  @IsEnum(RepresentativeScope)
  scope: RepresentativeScope;

  @ApiPropertyOptional({
    type: [String],
    description:
      "Restrict the authorisation to these of the enterprise's projects. Omit or send an empty array for every project.",
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  projectIds?: string[];

  @ApiPropertyOptional({
    example: '2027-03-31T23:59:59.000Z',
    description: 'ISO-8601 expiry (must be in the future). Omit for no expiry.',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  expiresAt?: Date;
}
