import {
  NotificationEventType,
  NotificationEventTypes as E,
} from './notification-events.constant';

/**
 * Message content per event (TRD 13 "templated content per event type").
 * English only: the required languages are TO BE VALIDATED (TRD 13), so there
 * is no language dimension yet. Pure functions of their parameters.
 *
 * What a message may NOT carry: an officer's question or observation, an
 * inspector's identity or the site (FRD 24 discloses inspector information only
 * where the department allows - TBV), document contents, or any statutory
 * claim. It says THAT something happened and to which application, and points
 * the reader to the application for the rest.
 */
export interface NotificationParams {
  referenceNumber?: string;
  approvalTypeName?: string;
  roundNumber?: number;
  scheduledAt?: Date;
  enterpriseName?: string;
  dueAt?: Date;
  percentElapsed?: number;
  /** A calendar date, `YYYY-MM-DD`. */
  dueDate?: string;
  schemeName?: string;
  /** A scheme application's new status (a SchemeApplicationStatus). */
  schemeStatus?: string;
}

export interface RenderedNotification {
  title: string;
  message: string;
}

const SCHEME_STATUS_LABELS: Record<string, string> = {
  APPLIED: 'applied',
  UNDER_REVIEW: 'under review',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  DISBURSED: 'disbursed',
};

const schemeStatusLabel = (status: string | undefined): string =>
  (status && SCHEME_STATUS_LABELS[status]) || 'updated';

const iso = (d: Date | undefined): string =>
  d ? d.toISOString() : 'a date not yet recorded';

export function renderNotification(
  type: NotificationEventType,
  p: NotificationParams,
): RenderedNotification {
  const ref = p.referenceNumber ?? 'your application';
  switch (type) {
    case E.APPLICATION_SUBMITTED:
      return {
        title: 'Application submitted',
        message: `Application ${ref}${p.approvalTypeName ? ` (${p.approvalTypeName})` : ''} has been submitted to the department.`,
      };
    case E.QUERY_RAISED:
      return {
        title: 'Query raised on your application',
        message: `The department has raised a query (round ${p.roundNumber ?? 1}) on application ${ref}. Open the application to read it and respond.`,
      };
    case E.QUERY_RESPONDED:
      return {
        title: 'Query answered',
        message: `The applicant has responded to your query (round ${p.roundNumber ?? 1}) on application ${ref}.`,
      };
    case E.INSPECTION_SCHEDULED:
      return {
        title: 'Inspection scheduled',
        message: `An inspection has been scheduled for application ${ref} on ${iso(p.scheduledAt)}.`,
      };
    case E.INSPECTION_RESCHEDULED:
      return {
        title: 'Inspection rescheduled',
        message: `The inspection for application ${ref} has been rescheduled to ${iso(p.scheduledAt)}.`,
      };
    case E.REPRESENTATIVE_AUTHORISATION_REQUESTED:
      return {
        title: 'Authorisation request',
        message: `You have been asked to act as a representative for ${p.enterpriseName ?? 'an enterprise'}. No access is granted until you accept.`,
      };
    case E.COMPLIANCE_DEADLINE_APPROACHING:
      return {
        title: 'Compliance obligation due',
        message: `A compliance obligation on application ${ref} is due on ${p.dueDate ?? 'a date not yet recorded'}. Open the application's compliance obligations to see what is required.`,
      };
    // Decision notices say THAT the decision was made and point to the
    // application; the reason, and (for an approval) the certificate, are read
    // there. No statutory claim, no appeal or resubmission route (none is
    // defined), no officer identity.
    case E.APPROVAL_ISSUED:
      return {
        title: 'Application approved',
        message: `Application ${ref}${p.approvalTypeName ? ` (${p.approvalTypeName})` : ''} has been approved by the department. Open the application to see the decision.`,
      };
    case E.APPLICATION_REJECTED:
      return {
        title: 'Application rejected',
        message: `Application ${ref}${p.approvalTypeName ? ` (${p.approvalTypeName})` : ''} has been rejected by the department. Open the application to see the recorded reason.`,
      };
    // A scheme application status update says THAT the status moved and to what;
    // the decision's reason, and any benefit detail, are read on the application.
    case E.SCHEME_APPLICATION_STATUS_UPDATE:
      return {
        title: 'Scheme application status updated',
        message: `The status of your scheme application ${ref}${p.schemeName ? ` for ${p.schemeName}` : ''} is now ${schemeStatusLabel(p.schemeStatus)}. Open the application to see the details.`,
      };
    case E.SLA_WARNING:
      return {
        title: 'SLA deadline approaching',
        message: `Application ${ref} has used ${Math.floor(p.percentElapsed ?? 0)}% of its configured timeline; the deadline is ${iso(p.dueAt)}.`,
      };
    case E.SLA_BREACHED:
      return {
        title: 'SLA deadline breached',
        message: `Application ${ref} has passed its configured SLA deadline (${iso(p.dueAt)}).`,
      };
  }
}
