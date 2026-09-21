import { ApiProperty } from '@nestjs/swagger';

/**
 * Every response shape below is hand-built from selected fields — never a
 * spread/direct return of a Prisma User row — so password_hash, MFA
 * secrets, and other internal fields can never leak through, even if the
 * User model gains new sensitive columns later.
 */
export class AuthenticatedUserDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty() email: string;
  @ApiProperty() mobile: string;
  @ApiProperty() isVerified: boolean;
  @ApiProperty() mfaEnabled: boolean;
  @ApiProperty({ type: [String] }) roles: string[];
}

export class LoginResponseDto {
  @ApiProperty({
    enum: ['AUTHENTICATED', 'MFA_REQUIRED', 'MFA_SETUP_REQUIRED'],
  })
  status: 'AUTHENTICATED' | 'MFA_REQUIRED' | 'MFA_SETUP_REQUIRED';

  @ApiProperty({
    required: false,
    description: 'Present only when status is AUTHENTICATED.',
  })
  accessToken?: string;

  @ApiProperty({
    required: false,
    description:
      'Present only when status is MFA_REQUIRED or MFA_SETUP_REQUIRED — submit to POST /auth/mfa/verify (or use as a Bearer token against /auth/mfa/enroll|confirm) within 5 minutes.',
  })
  challengeToken?: string;

  @ApiProperty({ required: false, type: AuthenticatedUserDto })
  user?: AuthenticatedUserDto;
}

export class RegisterResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty() email: string;
  @ApiProperty() mobile: string;
  @ApiProperty() isVerified: boolean;
}

export class MfaEnrollResponseDto {
  @ApiProperty({
    description:
      'otpauth:// provisioning URI for an authenticator app. Contains the raw TOTP secret — transmitted once, over TLS, to the authenticated owner only. Never logged, cached, or re-exposed by any other endpoint.',
  })
  provisioningUri: string;
}

export class SimpleSuccessResponseDto {
  @ApiProperty({ example: true }) success: boolean;
}
