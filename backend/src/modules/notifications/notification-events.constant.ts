/**
 * The notification events this build raises. Each is either in the FRD 26.1
 * event catalogue / TRD 13 trigger list AND backed by an already-implemented
 * transition, or (SLA) defined by Blueprint 23.3. Everything else in those
 * lists (registration, draft saved, department acknowledgement, query deadline,
 * renewal, grievance) has no implemented flow behind it yet and is NOT raised.
 * (Scheme application status updates are raised since Step 16.)
 */
export const NotificationEventTypes = {
  /** FRD 26.1 "application submitted". */
  APPLICATION_SUBMITTED: 'APPLICATION_SUBMITTED',
  /** FRD 26.1 "query raised". */
  QUERY_RAISED: 'QUERY_RAISED',
  /** FRD 26.1 "query responded" / TRD 13 "response received". */
  QUERY_RESPONDED: 'QUERY_RESPONDED',
  /** FRD 26.1 "inspection scheduled". */
  INSPECTION_SCHEDULED: 'INSPECTION_SCHEDULED',
  /** FRD 26.1 "inspection rescheduled". */
  INSPECTION_RESCHEDULED: 'INSPECTION_RESCHEDULED',
  /** FRD 20.2: "the representative receives a notification and must accept". */
  REPRESENTATIVE_AUTHORISATION_REQUESTED:
    'REPRESENTATIVE_AUTHORISATION_REQUESTED',
  /** FRD 26.1 "compliance deadline approaching": an obligation became DUE. */
  COMPLIANCE_DEADLINE_APPROACHING: 'COMPLIANCE_DEADLINE_APPROACHING',
  /** FRD 26.1 "approval issued" / TRD 13 "approval/rejection": the Approving
   * Authority approved the application. Applicant side; legally significant,
   * so always delivered in-app (FRD 26.3). */
  APPROVAL_ISSUED: 'APPROVAL_ISSUED',
  /** FRD 26.1 "application rejected" / TRD 13 "approval/rejection": the
   * Approving Authority rejected it. Applicant side; legally significant
   * (FRD 26.3). */
  APPLICATION_REJECTED: 'APPLICATION_REJECTED',
  /** FRD 26.1 "scheme application status update": a Scheme Officer moved a
   * scheme application to its next status (under review, approved, rejected,
   * disbursed). Applicant side. */
  SCHEME_APPLICATION_STATUS_UPDATE: 'SCHEME_APPLICATION_STATUS_UPDATE',
  /** Blueprint 23.3: the configured warning threshold (officer-facing). */
  SLA_WARNING: 'SLA_WARNING',
  /** Blueprint 23.3 / FRD 26.1 "SLA escalation (officer-facing)": a breach. */
  SLA_BREACHED: 'SLA_BREACHED',
} as const;

export type NotificationEventType =
  (typeof NotificationEventTypes)[keyof typeof NotificationEventTypes];
