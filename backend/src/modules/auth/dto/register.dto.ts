import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, Matches, MaxLength, MinLength } from 'class-validator';

/**
 * Password policy (min 10 chars, upper+lower+digit) is a reasonable
 * default pending TRD §26's "strong password policy" being made concrete
 * by a real government standard — not a confirmed statutory requirement.
 * Mobile format (10-15 digits) is similarly a placeholder, not tied to a
 * confirmed government format (see FRD §37's TBV register, which is about
 * enterprise registration numbers specifically, not mobile format — this
 * one is an implementation default, documented as such).
 */
export class RegisterDto {
  @ApiProperty({ example: 'Asha Patil' })
  @MinLength(2)
  @MaxLength(150)
  name: string;

  @ApiProperty({ example: 'asha.patil@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: '9876543210' })
  @Matches(/^[0-9]{10,15}$/, { message: 'mobile must be 10 to 15 digits' })
  mobile: string;

  @ApiProperty({
    example: 'Str0ngPassw0rd',
    description: 'Min 10 characters, must include upper, lower and a digit.',
  })
  @MinLength(10)
  @MaxLength(128)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/, {
    message:
      'password must include an uppercase letter, a lowercase letter and a digit',
  })
  password: string;
}
