import { ApiProperty } from '@nestjs/swagger';
import { InspectionStatus } from '@prisma/client';

class NamedRefDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() name: string;
}

class InspectorRefDto {
  @ApiProperty({ format: 'uuid' }) userId: string;
  @ApiProperty() name: string;
}

/**
 * An inspection as one caller may see it. The enterprise, project and
 * department are reached through the application; nothing is copied. For an
 * Inspector this is the MINIMUM needed to conduct the visit (FRD 4.4): no form
 * data, documents, scrutiny notes, queries or enterprise details, and no
 * assignment metadata (`assignedBy` is null). Never a storage key, token or
 * internal id of anything else.
 */
export class InspectionDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) applicationId: string;
  @ApiProperty({ description: 'The application reference number.' })
  applicationReference: string;
  @ApiProperty({ type: NamedRefDto }) approvalType: NamedRefDto;
  @ApiProperty({ type: NamedRefDto }) department: NamedRefDto;
  @ApiProperty({ type: NamedRefDto, description: 'The project (site owner).' })
  project: NamedRefDto;
  @ApiProperty({
    enum: InspectionStatus,
    description:
      'PENDING (assigned, no date yet) or SCHEDULED. Derived from the schedule; never written directly. COMPLETED / CANCELLED arrive with the inspection-report step.',
  })
  status: InspectionStatus;
  @ApiProperty({ type: Date, nullable: true }) scheduledAt: Date | null;
  @ApiProperty({
    type: Date,
    nullable: true,
    description:
      'When the assigned inspector confirmed the current schedule (null until they do; withdrawn if the date or inspector changes). Not a status.',
  })
  confirmedAt: Date | null;
  @ApiProperty() siteAddress: string;
  @ApiProperty({ type: InspectorRefDto }) inspector: InspectorRefDto;
  @ApiProperty({ description: 'When the current inspector was assigned.' })
  assignedAt: Date;
  @ApiProperty({
    type: InspectorRefDto,
    nullable: true,
    description:
      'Who assigned the current inspector — officer roles only (null for an Inspector).',
  })
  assignedBy: InspectorRefDto | null;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
}

export class InspectionListDto {
  @ApiProperty({ type: [InspectionDto] }) items: InspectionDto[];
  @ApiProperty() page: number;
  @ApiProperty() pageSize: number;
  @ApiProperty({ description: 'Total matching inspections (all pages).' })
  total: number;
}
