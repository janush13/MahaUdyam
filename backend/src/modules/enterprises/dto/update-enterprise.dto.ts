import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { Trim } from '../../../common/decorators/trim.decorator';

/** Mandatory columns can be changed but never cleared: `null` is rejected,
 * while an omitted (undefined) field is simply left unchanged. */
const whenProvided = () => ValidateIf((_o, value) => value !== undefined);

/**
 * Body of `PUT /enterprises/:enterpriseId` (Blueprint §13.2). Fields that
 * are omitted are left unchanged; optional fields may be set to `null` to
 * clear them. Same field rules as CreateEnterpriseDto. Ownership and the
 * reference number can never be changed (they are not accepted at all).
 */
export class UpdateEnterpriseDto {
  @ApiPropertyOptional({ example: 'Sahyadri Precision Components Pvt Ltd' })
  @whenProvided()
  @Trim()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional({ example: 'Private Limited Company' })
  @whenProvided()
  @Trim()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  businessType?: string;

  @ApiPropertyOptional({ example: 'UDYAM-MH-26-0012345' })
  @whenProvided()
  @Trim()
  @IsString()
  @MinLength(3)
  @MaxLength(50)
  registrationNumber?: string;

  @ApiPropertyOptional({ example: 'UDYAM' })
  @whenProvided()
  @Trim()
  @IsString()
  @MinLength(2)
  @MaxLength(30)
  registrationNumberType?: string;

  @ApiPropertyOptional({ example: 'Plot 14, MIDC Chakan, Pune 410501' })
  @whenProvided()
  @Trim()
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  address?: string;

  @ApiPropertyOptional({ example: 'Engineering & Auto Components' })
  @whenProvided()
  @Trim()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  sector?: string;

  @ApiPropertyOptional({ nullable: true, example: 'Sahyadri Precision' })
  @IsOptional()
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  tradeName?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    example: 'https://sahyadri-precision.example.com',
  })
  @IsOptional()
  @Trim()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(300)
  website?: string | null;

  @ApiPropertyOptional({ nullable: true, example: 'Meera Kulkarni' })
  @IsOptional()
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  contactPersonName?: string | null;

  @ApiPropertyOptional({ nullable: true, example: '9123456780' })
  @IsOptional()
  @Trim()
  @Matches(/^[0-9]{10,15}$/, { message: 'mobile must be 10 to 15 digits' })
  contactPersonMobile?: string | null;
}
