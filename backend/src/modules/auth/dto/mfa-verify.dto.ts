import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Matches } from 'class-validator';

export class MfaVerifyDto {
  @ApiProperty({
    description:
      'The challengeToken returned by POST /auth/login when status is MFA_REQUIRED.',
  })
  @IsString()
  @IsNotEmpty()
  challengeToken: string;

  @ApiProperty({ example: '123456' })
  @Matches(/^[0-9]{6}$/, { message: 'code must be a 6-digit number' })
  code: string;
}
