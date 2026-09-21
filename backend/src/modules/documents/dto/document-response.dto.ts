import { ApiProperty } from '@nestjs/swagger';
import { DocumentStatus } from '@prisma/client';

class DocumentRequirementRefDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() name: string;
  @ApiProperty() isMandatory: boolean;
}

class DocumentScanDto {
  @ApiProperty({
    enum: ['CLEAN', 'NOT_SCANNED'],
    description:
      'CLEAN: the configured scanner cleared the file before it was stored. Infected or unscannable uploads are rejected and never stored, so they do not appear here.',
  })
  state: 'CLEAN' | 'NOT_SCANNED';
  @ApiProperty({ nullable: true }) scannedAt: Date | null;
  @ApiProperty({
    nullable: true,
    description:
      'Which scanner cleared it. The development stand-in is named as such — it is not antivirus.',
  })
  scanner: string | null;
}

class DocumentReviewDto {
  @ApiProperty({ enum: ['VERIFIED', 'REJECTED'] })
  verdict: 'VERIFIED' | 'REJECTED';
  @ApiProperty() reviewedAt: Date;
  @ApiProperty({
    nullable: true,
    description:
      'The reason, when the document was REJECTED — for the applicant to act on.',
  })
  reason: string | null;
  @ApiProperty({
    required: false,
    description: 'Officer view only: the reviewer’s internal notes.',
  })
  notes?: string | null;
  @ApiProperty({ required: false, format: 'uuid' })
  reviewedByUserId?: string;
}

export class DocumentResponseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) applicationId: string;
  @ApiProperty({
    format: 'uuid',
    description: 'Shared by every version of the same document.',
  })
  lineageId: string;
  @ApiProperty({ description: '1 for the first upload, +1 per replacement.' })
  version: number;
  @ApiProperty({
    description:
      'False once a replacement exists; the version is then history.',
  })
  isCurrent: boolean;
  @ApiProperty({ format: 'uuid', nullable: true })
  previousVersionId: string | null;
  @ApiProperty({ format: 'uuid', nullable: true })
  replacedByVersionId: string | null;
  @ApiProperty({ type: DocumentRequirementRefDto, nullable: true })
  requirement: DocumentRequirementRefDto | null;
  @ApiProperty({
    description: 'As uploaded (metadata only — never a path).',
  })
  originalFilename: string;
  @ApiProperty({ description: 'Detected from the file content.' })
  mimeType: string;
  @ApiProperty() sizeBytes: number;
  @ApiProperty({ enum: DocumentStatus }) status: DocumentStatus;
  @ApiProperty({ nullable: true, example: '2027-03-31' })
  expiryDate: string | null;
  @ApiProperty({ type: DocumentScanDto }) scan: DocumentScanDto;
  @ApiProperty({
    description: 'Whether the normal download endpoint will serve it.',
  })
  downloadable: boolean;
  @ApiProperty({
    type: DocumentReviewDto,
    nullable: true,
    description:
      'The department’s review of this version, once made. Set only by the officer review action.',
  })
  review: DocumentReviewDto | null;
  @ApiProperty({ format: 'uuid' }) uploadedByUserId: string;
  @ApiProperty() uploadedAt: Date;
}

class CurrentDocumentRefDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() version: number;
  @ApiProperty({ enum: DocumentStatus }) status: DocumentStatus;
}

export class DocumentRequirementStatusDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() name: string;
  @ApiProperty({ nullable: true }) description: string | null;
  @ApiProperty({
    description: 'As configured by the department — never assumed.',
  })
  isMandatory: boolean;
  @ApiProperty({
    type: [String],
    description: 'File types accepted for this requirement.',
  })
  acceptedMimeTypes: string[];
  @ApiProperty({ description: 'Effective per-file size limit in bytes.' })
  maxSizeBytes: number;
  @ApiProperty({
    description:
      'True when the current version is scanned, usable and not expired.',
  })
  satisfied: boolean;
  @ApiProperty({ type: CurrentDocumentRefDto, nullable: true })
  currentDocument: CurrentDocumentRefDto | null;
}
