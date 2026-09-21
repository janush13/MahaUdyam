import { InspectionStatus } from '@prisma/client';
import { AuditActions } from '../../infrastructure/audit/audit-actions.constant';

type InspectionAuditAction =
  | typeof AuditActions.INSPECTION_SCHEDULED
  | typeof AuditActions.INSPECTION_RESCHEDULED
  | typeof AuditActions.INSPECTION_REASSIGNED
  | typeof AuditActions.INSPECTION_SITE_UPDATED;

/**
 * The inspection status this step can produce. It is DERIVED from the
 * schedule — never chosen by a client: no date/time means the inspection is
 * PENDING (assigned, awaiting a schedule); with one it is SCHEDULED (FRD
 * 24.1 "Inspection Pending → Scheduled"). COMPLETED and CANCELLED belong to
 * the inspection-report step and are never produced here.
 */
export function statusFor(
  scheduledAt: Date | null,
): Extract<InspectionStatus, 'PENDING' | 'SCHEDULED'> {
  return scheduledAt ? 'SCHEDULED' : 'PENDING';
}

export interface InspectionSnapshot {
  inspectorId: string;
  scheduledAt: Date | null;
  siteAddress: string;
}

export interface InspectionChangeRequest {
  inspectorUserId?: string;
  scheduledAt?: Date;
  siteAddress?: string;
}

export interface InspectionChangePlan {
  /** Columns to write (only those that actually change). */
  data: {
    inspectorId?: string;
    scheduledAt?: Date;
    siteAddress?: string;
    status?: 'SCHEDULED';
  };
  /** One audit event per kind of change. */
  events: InspectionAuditAction[];
}

/**
 * What an update actually changes, and which audit events it warrants.
 *  - a different inspector          -> INSPECTION_REASSIGNED
 *  - a first schedule (was PENDING) -> INSPECTION_SCHEDULED (status -> SCHEDULED)
 *  - a moved schedule               -> INSPECTION_RESCHEDULED
 *  - a different site               -> INSPECTION_SITE_UPDATED
 * Values equal to the current ones are not changes. An empty plan means the
 * request changed nothing.
 */
export function planChange(
  current: InspectionSnapshot,
  request: InspectionChangeRequest,
): InspectionChangePlan {
  const plan: InspectionChangePlan = { data: {}, events: [] };
  if (
    request.inspectorUserId !== undefined &&
    request.inspectorUserId !== current.inspectorId
  ) {
    plan.data.inspectorId = request.inspectorUserId;
    plan.events.push(AuditActions.INSPECTION_REASSIGNED);
  }
  if (request.scheduledAt !== undefined) {
    if (current.scheduledAt === null) {
      plan.data.scheduledAt = request.scheduledAt;
      plan.data.status = 'SCHEDULED';
      plan.events.push(AuditActions.INSPECTION_SCHEDULED);
    } else if (
      request.scheduledAt.getTime() !== current.scheduledAt.getTime()
    ) {
      plan.data.scheduledAt = request.scheduledAt;
      plan.events.push(AuditActions.INSPECTION_RESCHEDULED);
    }
  }
  if (
    request.siteAddress !== undefined &&
    request.siteAddress !== current.siteAddress
  ) {
    plan.data.siteAddress = request.siteAddress;
    plan.events.push(AuditActions.INSPECTION_SITE_UPDATED);
  }
  return plan;
}
