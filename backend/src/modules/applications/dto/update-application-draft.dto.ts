import { ApiProperty } from '@nestjs/swagger';
import { IsObject } from 'class-validator';

/**
 * Body of `PUT …/applications/:applicationId/draft`. Replaces the draft's
 * approval-specific details. Nothing else about an application can be sent:
 * no status, no project/enterprise/approval, no discovery link.
 */
export class UpdateApplicationDraftDto {
  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description:
      'The complete set of approval-specific details (replaces the previous set). Save Draft never requires the details to be complete (FRD §13.2).',
    example: { proposedCapacity: '500 units per month' },
  })
  @IsObject()
  formData: Record<string, unknown>;
}
