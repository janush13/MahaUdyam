import { ApiProperty } from '@nestjs/swagger';
import { RepresentativeScope, RepresentativeStatus } from '@prisma/client';

/** Owner's view of one authorisation (FRD §20.2: representative name, scope,
 * projects covered, start and expiry). The representative's email/mobile and
 * user id are deliberately not returned. */
export class RepresentativeResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() enterpriseId: string;
  @ApiProperty() representativeName: string;
  @ApiProperty({ enum: RepresentativeScope }) scope: RepresentativeScope;
  @ApiProperty({
    type: [String],
    description: 'Empty = every project of the enterprise.',
  })
  scopedProjectIds: string[];
  @ApiProperty({ enum: RepresentativeStatus }) status: RepresentativeStatus;
  @ApiProperty({
    description:
      'True once expiresAt has passed. An expired authorisation grants no access even though its stored status is unchanged.',
  })
  isExpired: boolean;
  @ApiProperty({ nullable: true }) authorisedAt: Date | null;
  @ApiProperty({ nullable: true }) expiresAt: Date | null;
  @ApiProperty({ nullable: true }) revokedAt: Date | null;
  @ApiProperty() createdAt: Date;
}

class InvitationEnterpriseDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty() referenceNumber: string;
}

/** The representative's own view of an authorisation offered to them. */
export class MyAuthorisationResponseDto {
  @ApiProperty() id: string;
  @ApiProperty({ type: InvitationEnterpriseDto })
  enterprise: InvitationEnterpriseDto;
  @ApiProperty({ enum: RepresentativeScope }) scope: RepresentativeScope;
  @ApiProperty({ type: [String] }) scopedProjectIds: string[];
  @ApiProperty({ enum: RepresentativeStatus }) status: RepresentativeStatus;
  @ApiProperty() isExpired: boolean;
  @ApiProperty({ nullable: true }) authorisedAt: Date | null;
  @ApiProperty({ nullable: true }) expiresAt: Date | null;
  @ApiProperty() createdAt: Date;
}
