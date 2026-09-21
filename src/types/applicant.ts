export interface ApplicantProfile {
  id: string;
  name: string;
  designation: string;
  email: string;
  mobile: string;
  singleBusinessId: string;
  kycStatus: 'VERIFIED' | 'PENDING' | 'REJECTED';
  aadhaarNumberMasked: string;
  panNumber: string;
  address: {
    line1: string;
    city: string;
    district: string;
    state: string;
    pincode: string;
  };
  notifications: {
    smsAlerts: boolean;
    emailAlerts: boolean;
    whatsappUpdates: boolean;
    slaWarningDays: number;
  };
  security: {
    twoFactorEnabled: boolean;
    lastLogin: string;
    activeSessionsCount: number;
  };
}

export interface EnterpriseProject {
  id: string;
  enterpriseId: string;
  name: string;
  sector: string;
  district: string;
  location: string;
  midcArea?: string;
  proposedInvestmentCr: number;
  proposedEmployment: number;
  landAreaAcres: number;
  powerDemandKva?: number;
  waterDemandKld?: number;
  status: 'Proposed' | 'In Setup' | 'Operational' | 'Under Review';
  commencementExpected: string;
  createdAt: string;
  description?: string;
}

export interface Enterprise {
  id: string;
  name: string;
  type: 'Private Limited' | 'LLP' | 'Proprietorship' | 'Public Limited';
  category: 'Micro' | 'Small' | 'Medium' | 'Large';
  cinOrLlpin: string;
  udyamRegistration: string;
  gstin: string;
  pan: string;
  registeredAddress: string;
  district: string;
  state: string;
  pincode: string;
  turnoverCr: number;
  capitalInvestmentCr: number;
  status: 'Active' | 'Inactive';
  incorporationDate: string;
  isPrimary: boolean;
  projectsCount?: number;
}

export interface Representative {
  id: string;
  name: string;
  role: string;
  organization?: string;
  email: string;
  mobile: string;
  delegationScope: string;
  delegatedPowers: string[];
  authorizationRef: string;
  validUntil: string;
  status: 'Active' | 'Suspended' | 'Revoked';
  assignedEnterpriseIds: string[];
}

export interface ApplicantApplication {
  id: string;
  appRefNumber: string;
  approvalName: string;
  department: string;
  enterpriseId: string;
  enterpriseName: string;
  projectId: string;
  projectName: string;
  stage: 'Pre-Establishment' | 'Pre-Operation';
  status: 'Under Scrutiny' | 'Approved' | 'Query Raised' | 'Pending Fee' | 'Inspection Scheduled';
  submittedDate: string;
  slaTargetDate: string;
  slaDaysRemaining: number;
  slaTotalDays: number;
  currentOfficer?: string;
}

export interface PortalActivity {
  id: string;
  title: string;
  description: string;
  timestamp: string;
  type: 'SUBMISSION' | 'APPROVAL' | 'QUERY' | 'INSPECTION' | 'DOCUMENT' | 'SECURITY';
  refNumber?: string;
}
