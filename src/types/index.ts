export interface ApprovalItem {
  id: string;
  serviceCode: string;
  name: string;
  department: string;
  subDepartment?: string;
  act: string;
  description: string;
  slaDays: number;
  feeText: string;
  feeAmount?: number;
  mode: 'Online' | 'Hybrid';
  applicability: 'Mandatory' | 'Conditional';
  stage: 'Pre-Establishment' | 'Pre-Operation' | 'Operational';
  category: 'Environment' | 'Urban Development' | 'Labour' | 'Fire Services' | 'Energy' | 'Water' | 'Revenue';
  location: string;
  requiredDocumentsCount: number;
  prerequisites?: string;
  whyApplicable?: string;
}

export interface SchemeItem {
  id: string;
  code: string;
  title: string;
  department: string;
  shortDept: string;
  description: string;
  schemeType: 'Subsidy' | 'Land Support' | 'Tax Benefit' | 'Capacity Building' | 'Interest Subsidy' | 'Green Subsidy';
  beneficiary: 'MSME' | 'All Industries' | 'Manufacturing' | 'Export Units' | 'Startups';
  scope: 'State Scheme' | 'Central-State';
  status: 'Open' | 'Upcoming' | 'Closed';
  highlights: string[];
  importantDates?: {
    startDate?: string;
    endDate?: string;
  };
  benefitTypeDescription?: string;
}

export interface NoticeItem {
  id: string;
  refNo: string;
  date: string;
  title: string;
  department: string;
  category: 'Notification' | 'Circular' | 'Update' | 'Guideline' | 'Order';
  pdfSize: string;
  effectiveDate: string;
  summary: string;
  relatedActs?: string[];
}

export interface FaqItem {
  id: string;
  category: string;
  question: string;
  answer: string;
}

export interface ContactTicket {
  id: string;
  category: string;
  status: 'Resolved' | 'In Progress' | 'Under Review';
  lastUpdated: string;
}

export type AuthRole = 'APPLICANT' | 'OFFICER' | 'INSPECTOR' | 'ADMINISTRATOR' | 'LEADERSHIP';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  mobile: string;
  entityName?: string;
  role: AuthRole;
  sessionStatus: 'ACTIVE' | 'EXPIRED';
  token: string;
  createdAt: string;
  singleBusinessId?: string;
  kycStatus?: 'VERIFIED' | 'PENDING' | 'REJECTED';
  designation?: string;
}

export interface AuthSession {
  isAuthenticated: boolean;
  user: AuthUser | null;
}

export interface RegistrationPayload {
  fullName: string;
  entityName: string;
  email: string;
  mobile: string;
  password?: string;
  declarationAccepted: boolean;
}

export * from './applicant';
