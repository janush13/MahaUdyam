import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class LoginDto {
  @ApiProperty({
    example: 'asha.patil@example.com',
    description: 'Email or mobile number.',
  })
  @IsString()
  @IsNotEmpty()
  emailOrMobile: string;

  @ApiProperty({ example: 'Str0ngPassw0rd' })
  @IsString()
  @IsNotEmpty()
  password: string;
}
