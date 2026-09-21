export type ApplicationStatus =
  | 'Draft'
  | 'Documents Pending'
  | 'Ready for Review'
  | 'Submitted'
  | 'Under Scrutiny'
  | 'Query Raised'
  | 'Clarification Submitted'
  | 'Inspection Scheduled'
  | 'Inspection Completed'
  | 'Decision Pending'
  | 'Approved'
  | 'Rejected';

export type DocumentValidationState =
  | 'Ready'
  | 'Missing'
  | 'Pending Verification'
  | 'Expired'
  | 'Invalid'
  | 'Optional'
  | 'Conditional';

export interface ApplicationRequiredDocument {
  requirementId: string;
  documentType: string;
  category: 'Identity & Entity' | 'Land & Siting' | 'Technical & Project' | 'Statutory & Environmental' | 'Finance & Valuation';
  mandatory: boolean;
  statutorySource: string;
  description: string;
  validationState: DocumentValidationState;
  linkedDocumentId?: string;
  linkedVersionId?: string;
  linkedDocumentName?: string;
  linkedDocumentNumber?: string;
  linkedVerificationStatus?: string;
  linkedExpiryDate?: string;
  reuseRecordId?: string;
  validationNotes?: string;
}

export interface CTEProjectParameters {
  industrialActivity: string;
  sector: string;
  cpcbCategory: 'Red' | 'Orange' | 'Green' | 'White';
  cpcbIndustryType: string;
  manufacturingActivity: string;
  proposedCapitalInvestmentCr: number;
  landAreaAcres: number;
  totalBuiltUpAreaSqMeters: number;
  plotOrSurveyNumber: string;
  midcArea: string;
  district: string;
  taluka: string;
  powerRequirementKva: number;
  waterRequirementKld: number;
  tradeEffluentKld: number;
  domesticEffluentKld: number;
  effluentTreatmentPlan: 'CETP Connected' | 'Standalone ETP' | 'Zero Liquid Discharge (ZLD)' | 'Soak Pit / Septic Tank';
  airEmissions: string[];
  fuelType: string;
  dgSetCapacityKva: number;
  hazardousWasteCategory: string;
  hazardousWasteQuantityTpa: number;
  chwtsdfMembership: 'MEPL Ranjangaon' | 'TCG Transi' | 'Standalone Treatment' | 'Not Applicable';
  numberOfWorkers: number;
  operationalShifts: number;
  expectedCommissioningDate: string;
  derivedFromPhase4: boolean;
}

export interface ApplicationTimelineEvent {
  id: string;
  timestamp: string;
  stage: string;
  title: string;
  description: string;
  actor: string;
  status: 'completed' | 'current' | 'upcoming';
}

export interface ApprovalApplication {
  id: string;
  applicationNumber: string;
  approvalId: string;
  approvalName: string;
  serviceCode: string;
  department: string;
  enterpriseId: string;
  enterpriseName: string;
  projectId: string;
  projectName: string;
  applicantId: string;
  applicantName: string;
  applicantDesignation: string;
  applicationType: string;
  status: ApplicationStatus;
  currentStep: 1 | 2 | 3;
  createdAt: string;
  updatedAt: string;
  submittedAt?: string;
  statutoryCategory: 'Red' | 'Orange' | 'Green' | 'White';
  projectParameters: CTEProjectParameters;
  requiredDocuments: ApplicationRequiredDocument[];
  declaration: {
    accepted: boolean;
    acceptedAt?: string;
    signatoryName: string;
    designation: string;
    statements: {
      accurateInformation: boolean;
      authenticDocuments: boolean;
      statutoryScrutinyConsent: boolean;
      competentAuthorityClarification: boolean;
    };
  };
  submissionMetadata: {
    submittedAt?: string;
    submissionReceiptNumber?: string;
    ipAddress?: string;
    isPrototype: boolean;
    assignedNodalOffice?: string;
    scrutinyFeeAmount?: number;
    scrutinyFeeStatus?: 'Exempt' | 'Pay at Scrutiny' | 'Paid';
  };
  timeline: ApplicationTimelineEvent[];
}

export interface DocumentReadinessReport {
  totalRequired: number;
  verifiedAndReady: number;
  pendingVerification: number;
  missing: number;
  expired: number;
  conditional: number;
  isReadyForReview: boolean;
  blockingReasons: string[];
}
