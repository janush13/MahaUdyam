import { ApiProperty } from '@nestjs/swagger';
import { SlaPauseReason, SlaStatus, WorkflowStageType } from '@prisma/client';

/** FRD 25.3: shown wherever no timeline has been officially configured. */
export const TIMELINE_NOT_CONFIGURED =
  'Timeline not yet configured — TO BE VALIDATED WITH GOVERNMENT DEPARTMENT';

/** NOT_TRACKED: the application's workflow has no SLA-tracked stage (or the
 * application has not been submitted), so there is no clock at all. */
export const APPLICANT_SLA_STATUSES = [
  'NOT_TRACKED',
  'NOT_CONFIGURED',
  'RUNNING',
  'PAUSED',
  'COMPLETED',
] as const;
export type ApplicantSlaStatus = (typeof APPLICANT_SLA_STATUSES)[number];

class SlaStageRefDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() name: string;
  @ApiProperty({ enum: WorkflowStageType }) type: WorkflowStageType;
}

/**
 * The applicant's SLA information (FRD 25.1): submission date, current stage,
 * the expected timeline ONLY where the department has configured one, elapsed
 * time since submission and current status. It never contains a breach flag,
 * warnings, the working-day arithmetic, pause internals, officer names or
 * anything about the department's workload (FRD 25.2 keeps those officer-facing).
 */
export class ApplicantSlaDto {
  @ApiProperty({ format: 'uuid' }) applicationId: string;
  @ApiProperty({ type: Date, nullable: true }) submittedAt: Date | null;
  @ApiProperty({ type: SlaStageRefDto, nullable: true })
  currentStage: SlaStageRefDto | null;
  @ApiProperty({ enum: APPLICANT_SLA_STATUSES }) status: ApplicantSlaStatus;
  @ApiProperty({
    description:
      'Whether the owning department has officially configured a timeline for this stage.',
  })
  timelineConfigured: boolean;
  @ApiProperty({
    type: String,
    nullable: true,
    description: `${TIMELINE_NOT_CONFIGURED} — present exactly when timelineConfigured is false.`,
  })
  timelineMessage: string | null;
  @ApiProperty({
    type: Date,
    nullable: true,
    description:
      'The stage deadline (working days from submission, extended by any time the department waited for your response). Null unless a timeline is configured. It is not an approval date.',
  })
  expectedBy: Date | null;
  @ApiProperty({
    description:
      'True while the clock is stopped because a query is waiting for your response.',
  })
  waitingForApplicant: boolean;
  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Milliseconds since submission; null before submission.',
  })
  elapsedSinceSubmissionMs: number | null;
}

class SlaPauseDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ enum: SlaPauseReason }) reason: SlaPauseReason;
  @ApiProperty({ format: 'uuid' }) queryId: string;
  @ApiProperty() pausedAt: Date;
  @ApiProperty({ type: Date, nullable: true }) resumedAt: Date | null;
  @ApiProperty({
    description: 'Milliseconds paused (to now, while still paused).',
  })
  durationMs: number;
}

/** The clock's numbers, shared by the officer detail and the queue. */
export class OfficerSlaMetricsDto {
  @ApiProperty({ enum: SlaStatus }) status: SlaStatus;
  @ApiProperty({ description: 'A deadline is configured for this clock.' })
  configured: boolean;
  @ApiProperty({ type: Date, nullable: true }) dueAt: Date | null;
  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'Milliseconds to the deadline (negative once past it); frozen while paused; null when not configured or completed.',
  })
  remainingMs: number | null;
  @ApiProperty({
    description:
      'The deadline has passed (or the clock finished after it): the FRD 25.2 "Breached" indicator.',
  })
  breached: boolean;
  @ApiProperty({
    description:
      'The configured warning threshold has been reached (never true when no threshold is configured).',
  })
  warning: boolean;
  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Percent of the original working window elapsed.',
  })
  percentElapsed: number | null;
}

export class OfficerSlaDto extends OfficerSlaMetricsDto {
  @ApiProperty({ format: 'uuid' }) applicationId: string;
  @ApiProperty() applicationReference: string;
  @ApiProperty({ type: SlaStageRefDto, nullable: true })
  stage: SlaStageRefDto | null;
  @ApiProperty({
    type: String,
    nullable: true,
    description: `${TIMELINE_NOT_CONFIGURED} — present when no timeline is configured.`,
  })
  timelineMessage: string | null;
  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'The stage duration snapshotted when the clock started.',
  })
  slaDays: number | null;
  @ApiProperty({
    description:
      'Whether the stage pauses while a query is out (snapshotted at start).',
  })
  pauseOnQuery: boolean;
  @ApiProperty({ type: Date, nullable: true }) startedAt: Date | null;
  @ApiProperty({
    type: Date,
    nullable: true,
    description: 'The deadline as first calculated (never changes).',
  })
  originalDueAt: Date | null;
  @ApiProperty({ type: Date, nullable: true }) pausedAt: Date | null;
  @ApiProperty({ type: Date, nullable: true }) completedAt: Date | null;
  @ApiProperty({ type: Date, nullable: true }) breachedAt: Date | null;
  @ApiProperty({ description: 'Milliseconds the clock has actually run.' })
  elapsedMs: number;
  @ApiProperty({ description: 'Milliseconds spent paused, in total.' })
  totalPausedMs: number;
  @ApiProperty({
    type: [SlaPauseDto],
    description:
      'Every pause period, oldest first — history is never replaced.',
  })
  pauses: SlaPauseDto[];
}

export class OfficerSlaItemDto extends OfficerSlaMetricsDto {
  @ApiProperty({ format: 'uuid' }) applicationId: string;
  @ApiProperty() applicationReference: string;
  @ApiProperty() approvalType: string;
  @ApiProperty({ format: 'uuid' }) departmentId: string;
  @ApiProperty() stageName: string;
  @ApiProperty({ type: Date }) startedAt: Date;
}

export class OfficerSlaListDto {
  @ApiProperty({ type: [OfficerSlaItemDto] }) items: OfficerSlaItemDto[];
  @ApiProperty() page: number;
  @ApiProperty() pageSize: number;
  @ApiProperty({ description: 'Total matching clocks (all pages).' })
  total: number;
}

// ---- configuration (department administrator) ---------------------------------

export class SlaStageConfigDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() name: string;
  @ApiProperty({ enum: WorkflowStageType }) stageType: WorkflowStageType;
  @ApiProperty() sequenceOrder: number;
  @ApiProperty({ format: 'uuid' }) departmentId: string;
  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'Working days; null = "Timeline not yet configured" (never defaulted).',
  })
  slaDays: number | null;
  @ApiProperty({
    description:
      'Pause the clock while a query awaits the applicant (TRD 12: not assumed uniformly true, so off until a department sets it).',
  })
  pauseOnQuery: boolean;
  @ApiProperty({ format: 'uuid' }) workflowId: string;
  @ApiProperty() workflowName: string;
  @ApiProperty() workflowVersion: number;
  @ApiProperty() workflowActive: boolean;
  @ApiProperty({ format: 'uuid' }) approvalTypeId: string;
  @ApiProperty() approvalTypeName: string;
}

export class SlaHolidayDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'Null = state-wide.',
  })
  departmentId: string | null;
  @ApiProperty({ example: '2026-10-02' }) date: string;
  @ApiProperty() description: string;
  @ApiProperty({ format: 'uuid' }) createdByUserId: string;
  @ApiProperty() createdAt: Date;
}
