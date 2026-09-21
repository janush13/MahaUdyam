export type DocumentCategory =
  | 'Identity & Applicant'
  | 'Enterprise Registration'
  | 'Land & Siting'
  | 'Engineering & Layout'
  | 'Environmental & Health'
  | 'Safety & Utility'
  | 'Financial & Statutory'
  | 'Labour & Workforce'
  | 'Other Regulatory Documents';

export type DocumentOwnerType = 'Applicant' | 'Enterprise' | 'Project';

export type DocumentStatus = 'Current' | 'Superseded' | 'Expired';

export type VerificationStatus =
  | 'Verified'
  | 'Pending Verification'
  | 'Rejected'
  | 'Expired';

export type DocumentSource =
  | 'DigiLocker'
  | 'Direct Upload'
  | 'Department Issued'
  | 'Single Window Repository';

export interface DocumentVersion {
  id: string;
  documentId: string;
  versionNumber: string;
  fileName: string;
  fileType: string;
  fileSize: string;
  uploadedAt: string;
  uploadedBy: string;
  source: DocumentSource;
  verificationStatus: VerificationStatus;
  changeReason: string;
  isCurrent: boolean;
  filePreviewUrl?: string;
  digitalSignature?: {
    signedBy: string;
    algorithm: string;
    timestamp: string;
    certificateSerial: string;
  };
}

export interface DocumentRecord {
  id: string;
  documentType: string;
  documentName: string;
  category: DocumentCategory;
  description: string;
  ownerType: DocumentOwnerType;
  ownerId: string;
  enterpriseId?: string;
  projectIds: string[];
  issuingAuthority: string;
  documentNumber: string;
  issueDate: string;
  expiryDate?: string | null;
  status: DocumentStatus;
  verificationStatus: VerificationStatus;
  source: DocumentSource;
  currentVersionId: string;
  reusable: boolean;
  statutoryReferences: string[];
  linkedApprovals: string[]; // e.g. ['MPCB-CTE', 'MIDC-BLD', 'DISH-BP']
  uploadedAt: string;
  updatedAt: string;
  digiLockerUri?: string;
  qrVerified?: boolean;
}

export interface DigiLockerSyncState {
  isLinked: boolean;
  lastSyncedAt: string;
  linkedAadhaarMasked: string;
  linkedPan: string;
  verifiedCount: number;
  syncStatus: 'synced' | 'syncing' | 'error';
  issuerAgency: string;
}

export interface DocumentReuseRecord {
  id: string;
  documentId: string;
  documentName: string;
  versionNumber: string;
  targetClearanceCode: string;
  targetClearanceName: string;
  targetRequirementName: string;
  projectId: string;
  projectName: string;
  reusedAt: string;
  reusedBy: string;
  status: 'Active' | 'Revoked';
}

export interface DocumentFilterState {
  searchQuery: string;
  category: string;
  verificationStatus: string;
  enterpriseId: string;
  projectId: string;
  source: string;
}
