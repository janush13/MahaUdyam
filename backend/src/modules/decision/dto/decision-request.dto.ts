import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { Trim } from '../../../common/decorators/trim.decorator';
import {
  MAX_CERTIFICATE_NUMBER_LENGTH,
  MAX_DECISION_REASON_LENGTH,
} from '../decision.constants';

/**
 * The Approving Authority's statutory decision. Nothing but the outcome and the
 * reason: no status, no department, no recommendation, no user id and no time
 * is ever taken from the client (the global pipe whitelists and forbids
 * unknown fields) - the recommendation being answered is the one on record.
 */
export class DecideDto {
  @ApiProperty({
    enum: ['APPROVE', 'REJECT'],
    description:
      'The statutory decision. It need not follow the scrutiny officer’s recommendation, which is advice only.',
  })
  @IsIn(['APPROVE', 'REJECT'])
  outcome: 'APPROVE' | 'REJECT';

  @ApiProperty({
    maxLength: MAX_DECISION_REASON_LENGTH,
    description:
      'The recorded reason (mandatory, FRD 4.5). The applicant sees it.',
  })
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_DECISION_REASON_LENGTH)
  reason: string;
}

/** The TEXT field of the multipart certificate upload, beside the `file`
 * part. */
export class IssueCertificateDto {
  @ApiPropertyOptional({
    maxLength: MAX_CERTIFICATE_NUMBER_LENGTH,
    description:
      'The certificate number as stated by the issuing department. Optional free text: no numbering scheme is defined by the requirements, so none is generated or enforced.',
  })
  @IsOptional()
  @Trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_CERTIFICATE_NUMBER_LENGTH)
  certificateNumber?: string;
}

export class IssueCertificateBodyDoc extends IssueCertificateDto {
  @ApiProperty({
    type: 'string',
    format: 'binary',
    description:
      'The department’s certificate document (PDF, JPEG or PNG, within the size limit). The platform does not generate one: no certificate format is defined.',
  })
  file: unknown;
}
