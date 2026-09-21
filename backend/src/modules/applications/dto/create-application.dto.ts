import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsObject, IsOptional, IsUUID } from 'class-validator';

/**
 * Body of `POST /enterprises/:enterpriseId/projects/:projectId/applications`.
 *
 * Deliberately absent: `enterpriseId` / `projectId` (they come from the
 * authorised route), owner or creator ids, `workflowId` (resolved from the
 * approval type), reference number and any status — with
 * `forbidNonWhitelisted`, sending any of them is a 400.
 */
export class CreateApplicationDto {
  @ApiProperty({
    format: 'uuid',
    description: 'The approval (approval type) being applied for.',
  })
  @IsUUID()
  approvalTypeId: string;

  @ApiProperty({
    format: 'uuid',
    description:
      'A stored discovery result of THIS project in which the approval was suggested (from POST …/discover-approvals or GET …/discoveries). Discovery is not re-run: the application records this exact snapshot.',
  })
  @IsUUID()
  discoverySnapshotId: string;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    description:
      'Approval-specific details as a flat map of field name → string / number / boolean / null. Enterprise and project data are never entered here.',
    example: { proposedCapacity: '500 units per month' },
  })
  @IsOptional()
  @IsObject()
  formData?: Record<string, unknown>;
}
