// Phase 8D — Screen 28: Inspector Workspace (Schedule, Inspection Detail & Submit Report)

export type InspectionStatus = 'SCHEDULED' | 'COMPLETED' | 'RESCHEDULED';
export type ScheduleFilter = 'upcoming' | 'completed' | 'rescheduled';
export type ReportStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'DRAFT_SAVED' | 'SUBMITTED';
export type InspectionOutcome = 'compliant' | 'non-compliant' | 'partially-compliant';
export type ChecklistResult = 'PENDING' | 'COMPLIANT' | 'NON_COMPLIANT' | 'NOT_APPLICABLE';
export type ApprovalKind = 'fact' | 'cte' | 'fire' | 'ht' | 'bldg';

export interface ChecklistTemplateItem {
  id: string;
  label: string;
  requirement: string;
}

/** One inspection in the inspector's "My Inspections Schedule". */
export interface InspectionRecord {
  id: string;
  applicationNo: string;
  kind: ApprovalKind;
  /** Short label used in the schedule table (Screen 28: "Factory Licence"). */
  approvalType: string;
  /** Full label used in the detail panel (Screen 28: "Factory Licence (Sec 6, Factories Act 1948)"). */
  approvalFull: string;
  enterprise: string;
  project: string;
  /** ISO date (YYYY-MM-DD). */
  scheduledOn: string;
  scheduledTime: string;
  locationShort: string;
  address: string;
  status: InspectionStatus;
  representative: string;
  formNo: string;
  checklist: ChecklistTemplateItem[];
  /** Enquiry: true when the application also exists in the Officer queue (Screens 26/27). */
  linkedToOfficerQueue: boolean;
}

export interface ChecklistEntry {
  result: ChecklistResult;
  remark: string;
}

export interface InspectionFinding {
  id: string;
  description: string;
  severity: 'Minor' | 'Major' | 'Critical';
  correctiveAction: string;
  timeLimit: string;
}

export interface EvidenceFile {
  name: string;
  sizeLabel: string;
}

/** Working copy of the statutory report (Form 7) for one inspection. */
export interface InspectionReport {
  outcome: InspectionOutcome | '';
  observations: string;
  checklist: Record<string, ChecklistEntry>;
  findings: InspectionFinding[];
  evidence: EvidenceFile[];
  supportingDoc: EvidenceFile | null;
  status: ReportStatus;
  savedAt: string | null;
  submittedAt: string | null;
  submissionRef: string | null;
}

export interface InspectorAuditEvent {
  id: string;
  at: string;
  actor: string;
  action: string;
  detail?: string;
}

export interface InspectionOverride {
  status?: InspectionStatus;
  scheduledOn?: string;
  scheduledTime?: string;
}
