import { ApplicationStatus } from './application';

export interface DepartmentDossier {
  id: string;
  department: string;
  departmentShort: string;
  serviceName: string;
  serviceCode: string;
  applicationNumber: string;
  currentStage: string;
  status: ApplicationStatus;
  slaTargetDays: number;
  slaDaysElapsed: number;
  slaDueDate: string;
  submittedDate: string;
  lastAction: string;
  lastActionTimestamp: string;
  applicantActionRequired: boolean;
  actionType?: 'QUERY' | 'INSPECTION' | 'FEE' | 'NONE';
  actionText?: string;
  dependencies?: string[];
  nodalOfficer: {
    name: string;
    designation: string;
    office: string;
  };
  isCTE?: boolean;
}

export interface SLATimelineStage {
  stageId: string;
  stageName: string;
  department: string;
  date: string;
  status: 'completed' | 'current' | 'upcoming' | 'action_required';
  elapsedOrRemaining: string;
  description: string;
  responsibleOfficer: string;
  applicantActionText?: string;
  remarks?: string;
}

export interface RequestedDeliverable {
  id: string;
  requirement: string;
  explanation: string;
  mandatory: boolean;
  requiredDocumentType: string;
  status: 'Pending' | 'Evidence Attached' | 'Clarified';
  linkedDocumentId?: string;
  linkedDocumentName?: string;
  linkedVersion?: string;
  linkedVerificationStatus?: string;
  applicantRemarks?: string;
}

export interface ApplicantClarificationSubmission {
  submittedAt: string;
  submittedBy: string;
  responseText: string;
  declarationAccepted: boolean;
  evidenceAttachments: Array<{
    deliverableId: string;
    documentId?: string;
    documentName: string;
    source: string;
    version: string;
    verificationStatus: string;
    isNewUpload?: boolean;
    fileSize?: string;
  }>;
}

export interface ApplicationQuery {
  id: string;
  applicationId: string;
  applicationNumber: string;
  department: string;
  serviceName: string;
  officerName: string;
  officerDesignation: string;
  subject: string;
  description: string;
  statutoryReference: string;
  raisedAt: string;
  dueDate: string;
  daysRemaining: number;
  status: 'Open' | 'Response Draft' | 'Response Submitted' | 'Under Review' | 'Resolved' | 'Closed';
  requestedDeliverables: RequestedDeliverable[];
  applicantResponse?: ApplicantClarificationSubmission;
  activityLog: Array<{
    id: string;
    timestamp: string;
    actor: string;
    action: string;
    note: string;
  }>;
}

export interface InspectionPreparationItem {
  id: string;
  item: string;
  mandatory: boolean;
  ready: boolean;
  notes?: string;
}

export interface ApplicationInspection {
  id: string;
  applicationId: string;
  applicationNumber: string;
  department: string;
  inspectionType: string;
  scheduledDate: string;
  scheduledTime: string;
  location: string;
  inspectingOfficers: Array<{
    name: string;
    designation: string;
    department: string;
    phone?: string;
  }>;
  status: 'Requested' | 'Scheduled' | 'Rescheduled' | 'Completed' | 'Report Pending' | 'Report Issued';
  purpose: string;
  preparationChecklist: InspectionPreparationItem[];
  documentsToKeepReady: string[];
  applicantInstructions: string;
  timeline: Array<{
    date: string;
    title: string;
    description: string;
    status: 'completed' | 'current' | 'upcoming';
  }>;
}

export interface TrackerSummaryMetrics {
  totalApplications: number;
  underScrutiny: number;
  queryRaised: number;
  inspectionScheduled: number;
  approvedIssued: number;
  pendingApplicantAction: number;
}
