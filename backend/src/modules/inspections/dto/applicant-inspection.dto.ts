import { ApiProperty } from '@nestjs/swagger';
import { InspectionFinding, InspectionStatus } from '@prisma/client';

/** The result of a completed inspection, as the applicant sees it (FRD 24.1
 * "the result/outcome once recorded"): the overall finding and, for a
 * non-compliant one, the recommended corrective action. The inspector's
 * checklist answers, observations, notes and evidence stay with the
 * department. */
export class ApplicantInspectionOutcomeDto {
  @ApiProperty({ enum: InspectionFinding }) overallFinding: InspectionFinding;
  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'The corrective action the inspector recommended (always present for NON_COMPLIANT).',
  })
  correctiveAction: string | null;
  @ApiProperty({ description: 'When the report was submitted.' })
  recordedAt: Date;
}

/**
 * One inspection of the applicant's own application (FRD 24.1). It carries
 * the live status (PENDING -> SCHEDULED -> COMPLETED), the proposed / scheduled
 * date and the outcome once recorded. It deliberately omits everything else:
 * the inspector's identity (disclosure is "TO BE VALIDATED" in FRD 24.1),
 * assignment and conflict-of-interest data, checklist results, observations,
 * evidence and audit detail.
 */
export class ApplicantInspectionDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({
    enum: InspectionStatus,
    description:
      'PENDING (requested, no date yet), SCHEDULED, COMPLETED or CANCELLED.',
  })
  status: InspectionStatus;
  @ApiProperty({
    type: Date,
    nullable: true,
    description: 'The date and time of the visit; null until it is scheduled.',
  })
  scheduledAt: Date | null;
  @ApiProperty({
    type: Date,
    nullable: true,
    description:
      'When the department confirmed the current schedule; null until it does, and withdrawn whenever the date changes.',
  })
  scheduleConfirmedAt: Date | null;
  @ApiProperty() siteAddress: string;
  @ApiProperty({
    type: ApplicantInspectionOutcomeDto,
    nullable: true,
    description: 'Null until the inspection is completed.',
  })
  outcome: ApplicantInspectionOutcomeDto | null;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
}

export class ApplicantInspectionsDto {
  @ApiProperty({ format: 'uuid' }) applicationId: string;
  @ApiProperty({
    description:
      'Whether the approval’s workflow calls for an inspection (FRD 18.2: the inspection step is shown only if the approval type requires one). A configured requirement — independent of whether an inspection has happened.',
  })
  inspectionRequired: boolean;
  @ApiProperty({
    type: [ApplicantInspectionDto],
    description: 'Oldest first; earlier inspections are never removed.',
  })
  inspections: ApplicantInspectionDto[];
}
