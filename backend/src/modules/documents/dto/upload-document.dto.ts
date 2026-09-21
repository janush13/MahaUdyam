import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID, Matches } from 'class-validator';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The TEXT fields of `POST …/documents` (multipart/form-data, alongside the
 * `file` part).
 *
 * Deliberately absent: enterprise / project / application ids (they come from
 * the authorised URL), owner, uploader, status, scan state, storage key,
 * checksum and version — with `forbidNonWhitelisted`, sending any of them is
 * a 400.
 */
export class UploadDocumentDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'The department-configured document requirement this file is for. Must belong to the approval of this application. Omit for a supporting document that is not tied to a requirement.',
  })
  @IsOptional()
  @IsUUID()
  documentRequirementId?: string;

  @ApiPropertyOptional({
    example: '2027-03-31',
    description:
      'Expiry date of the document, where applicable (a calendar date). Never guessed by the system.',
  })
  @IsOptional()
  @Matches(DATE_ONLY, {
    message: 'expiryDate must be a date in YYYY-MM-DD form',
  })
  expiryDate?: string;
}

/** The TEXT fields of `POST …/documents/:documentId/replace`. The replacement
 * always inherits the requirement, owner and chain of the version it
 * replaces; nothing about identity can be sent. */
export class ReplaceDocumentDto {
  @ApiPropertyOptional({
    example: '2027-03-31',
    description:
      'Expiry date of the NEW file, where applicable. Not inherited from the replaced version.',
  })
  @IsOptional()
  @Matches(DATE_ONLY, {
    message: 'expiryDate must be a date in YYYY-MM-DD form',
  })
  expiryDate?: string;
}

/** Documents the multipart body in Swagger (the real body is parsed by the
 * upload interceptor; these classes are never instantiated). */
export class UploadDocumentBodyDoc extends UploadDocumentDto {
  @ApiProperty({
    type: 'string',
    format: 'binary',
    description: 'The document: PDF, JPEG or PNG, within the size limit.',
  })
  file: unknown;
}

export class ReplaceDocumentBodyDoc extends ReplaceDocumentDto {
  @ApiProperty({
    type: 'string',
    format: 'binary',
    description: 'The replacement document: PDF, JPEG or PNG.',
  })
  file: unknown;
}
