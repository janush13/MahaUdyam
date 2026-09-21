// Phase 8B — Screen 26: Officer Application Queue & SLA Scrutiny Workspace

export type OfficerSlaRisk = 'BREACHED' | 'NEAR_BREACH' | 'APPROACHING' | 'WITHIN_SLA' | 'COMPLIED';

export type OfficerDeskStatus =
  | 'UNDER_SCRUTINY'
  | 'QUERY_RAISED'
  | 'INSPECTION_SCHEDULED'
  | 'DECISION_PENDING'
  | 'APPROVED';

export type OfficerDeptCode = 'ind' | 'env' | 'lab' | 'midc' | 'fire' | 'mseb';
export type OfficerApprovalCode = 'fact' | 'cte' | 'bldg' | 'fire' | 'ht';

/** One row of the officer's assigned application queue. */
export interface OfficerQueueRecord {
  applicationNo: string;
  enterpriseName: string;
  location: string;
  approvalCode: OfficerApprovalCode;
  approvalName: string;
  act: string;
  deptCode: OfficerDeptCode;
  deptName: string;
  deskName: string;
  /** ISO date (YYYY-MM-DD) the application was submitted under RTS. */
  submittedOn: string;
  /** ISO date (YYYY-MM-DD) the statutory SLA expires. */
  dueDate: string;
  dueTime?: string;
  /** Working days left; negative when overdue; null once the dossier is closed. */
  daysLeft: number | null;
  slaRisk: OfficerSlaRisk;
  status: OfficerDeskStatus;
}

export type OfficerDocStatus = 'VERIFIED' | 'UNDER_VERIFICATION' | 'REJECTED';

export interface OfficerDossierDocument {
  id: string;
  title: string;
  subtitle: string;
  submittedOn: string;
  status: OfficerDocStatus;
  actionLabel: 'View File' | 'Inspect (CAD)';
  fileType: 'pdf' | 'cad';
}

export interface OfficerQueryMessage {
  id: string;
  from: 'OFFICER' | 'APPLICANT';
  author: string;
  at: string;
  text: string;
  attachment?: string;
}

export interface OfficerInspectionInfo {
  ref: string;
  outcomeLabel: string;
  dateLabel: string;
  inspector: string;
  location: string;
  clearances: string;
  checklist: Array<{ item: string; result: 'Compliant' | 'Pending' }>;
}

export interface OfficerAuditEvent {
  id: string;
  at: string;
  actor: string;
  action: string;
  detail?: string;
}

export type OfficerDecision = 'approve' | 'clarification' | 'reject';

export interface OfficerDossier {
  applicationNo: string;
  submittedAt: string;
  enterpriseName: string;
  udyam: string;
  signatory: string;
  projectSite: string;
  investment: string;
  workforce: string;
  address: string;
  nicCategory: string;
  documents: OfficerDossierDocument[];
  queryRef: string;
  queryThread: OfficerQueryMessage[];
  inspection: OfficerInspectionInfo | null;
  auditTrail: OfficerAuditEvent[];
  defaultDecision: OfficerDecision;
  defaultRemarks: string;
}

export interface OfficerSlaSummary {
  withinSla: number;
  approaching: number;
  nearBreach: number;
  breached: number;
  totalActive: number;
  inspections: number;
}

// Phase 8C — Screen 27: Officer Application Workspace

export interface OfficerWorkspacePlot {
  plotNo: string;
  industrialArea: string;
  totalArea: string;
  builtUpArea: string;
  survey: string;
}

/** Screen 27-only technical/project fields layered over the shared Screen 26 dossier. */
export interface OfficerWorkspaceProfile {
  applicantName: string;
  designation: string;
  constitution: string;
  projectName: string;
  locationLabel: string;
  applicationDate: string;
  approvalTypeLabel: string;
  competentDepartment: string;
  commencement: string;
  powerRequirement: string;
  activityCode: string;
  installedHp: string;
  maxWorkers: string;
  hazardClass: string;
  plots: OfficerWorkspacePlot[];
  serviceId: string;
  statutoryDeadline: string;
}
