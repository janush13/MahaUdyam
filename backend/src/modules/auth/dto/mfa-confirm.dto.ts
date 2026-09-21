import { ApiProperty } from '@nestjs/swagger';
import { Matches } from 'class-validator';

export class MfaConfirmDto {
  @ApiProperty({ example: '123456' })
  @Matches(/^[0-9]{6}$/, { message: 'code must be a 6-digit number' })
  code: string;
}
