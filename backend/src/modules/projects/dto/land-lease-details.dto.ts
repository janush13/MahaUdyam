import { ApiProperty } from '@nestjs/swagger';
import {
  IsInt,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Trim } from '../../../common/decorators/trim.decorator';

/**
 * Lease details, present only when `landStatus` is `leased` (FRD §9.2's
 * conditional field). The FRD/Schema name "lease term / lessor details" but
 * fix no structure, so this is the minimal reading of that: who the lessor
 * is and for how long. Extending it is additive (the column is JSONB).
 */
export class LandLeaseDetailsDto {
  @ApiProperty({ example: 'Maharashtra Industrial Development Corporation' })
  @Trim()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  lessorName: string;

  @ApiProperty({ example: 99, description: 'Lease term in months.' })
  @IsInt()
  @Min(1)
  @Max(1200)
  leaseTermMonths: number;
}
