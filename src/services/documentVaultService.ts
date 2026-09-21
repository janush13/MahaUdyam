import {
  DocumentRecord,
  DocumentVersion,
  DocumentCategory,
  VerificationStatus,
  DigiLockerSyncState,
  DocumentReuseRecord,
} from '../types/documentVault';
import { approvalRuleEngine } from './approvalRuleEngine';
import { applicantService } from './applicantService';
import { DocumentRequirement } from '../types/approvalDiscovery';

const STORAGE_DOCS_KEY = 'mahaudyam_docvault_documents';
const STORAGE_VERSIONS_KEY = 'mahaudyam_docvault_versions';
const STORAGE_REUSE_KEY = 'mahaudyam_docvault_reuse';
const STORAGE_DIGILOCKER_KEY = 'mahaudyam_docvault_digilocker';

// 1. Initial Reference Document Records
export const INITIAL_DOCUMENTS: DocumentRecord[] = [
  {
    id: 'doc-mca-inc-01',
    documentType: 'Certificate of Incorporation',
    documentName: 'Certificate of Incorporation — Deshmukh Industries Pvt. Ltd.',
    category: 'Enterprise Registration',
    description: 'Statutory certificate issued under Section 7 of the Companies Act, 2013 establishing corporate identity.',
    ownerType: 'Enterprise',
    ownerId: 'ent-dipl-01',
    enterpriseId: 'ent-dipl-01',
    projectIds: ['proj-chk-01', 'proj-supa-02', 'proj-bho-03'],
    issuingAuthority: 'Registrar of Companies (RoC Pune), Ministry of Corporate Affairs',
    documentNumber: 'U28112PN2015PTC154892',
    issueDate: '14 May 2015',
    expiryDate: null, // Perpetual
    status: 'Current',
    verificationStatus: 'Verified',
    source: 'DigiLocker',
    currentVersionId: 'ver-inc-01',
    reusable: true,
    statutoryReferences: ['Companies Act 2013, Section 7', 'MCA21 Digital Registry'],
    linkedApprovals: ['MPCB-CTE', 'MIDC-BLD', 'DISH-BP', 'DFS-FNOC', 'MSEDCL-HT', 'MIDC-WTR', 'LAB-CLRA'],
    uploadedAt: '2026-01-10T10:00:00Z',
    updatedAt: '2026-01-10T10:00:00Z',
    digiLockerUri: 'in.gov.mca-cert-inc-U28112PN2015PTC154892',
    qrVerified: true,
  },
  {
    id: 'doc-msme-udyam-02',
    documentType: 'Udyam Registration Certificate',
    documentName: 'Udyam MSME Registration Certificate (Medium Enterprise)',
    category: 'Enterprise Registration',
    description: 'Central MSME registration certificate recognizing manufacturing operations with NIC Code 29301.',
    ownerType: 'Enterprise',
    ownerId: 'ent-dipl-01',
    enterpriseId: 'ent-dipl-01',
    projectIds: ['proj-chk-01', 'proj-supa-02'],
    issuingAuthority: 'Ministry of Micro, Small and Medium Enterprises, Govt. of India',
    documentNumber: 'UDYAM-MH-26-0048123',
    issueDate: '18 October 2021',
    expiryDate: null,
    status: 'Current',
    verificationStatus: 'Verified',
    source: 'DigiLocker',
    currentVersionId: 'ver-udyam-01',
    reusable: true,
    statutoryReferences: ['MSMED Act 2006', 'Gazette Notification S.O. 2119(E)'],
    linkedApprovals: ['MPCB-CTE', 'MIDC-BLD', 'MSEDCL-HT'],
    uploadedAt: '2026-01-10T10:05:00Z',
    updatedAt: '2026-01-10T10:05:00Z',
    digiLockerUri: 'in.gov.msme-udyam-UDYAM-MH-26-0048123',
    qrVerified: true,
  },
  {
    id: 'doc-ent-pan-03',
    documentType: 'Permanent Account Number (PAN Card)',
    documentName: 'Enterprise PAN Card — Deshmukh Industries Pvt. Ltd.',
    category: 'Financial & Statutory',
    description: 'Income Tax Department PAN registration for corporate entity.',
    ownerType: 'Enterprise',
    ownerId: 'ent-dipl-01',
    enterpriseId: 'ent-dipl-01',
    projectIds: ['proj-chk-01', 'proj-supa-02', 'proj-bho-03'],
    issuingAuthority: 'Income Tax Department, Govt. of India',
    documentNumber: 'AABCD1234E',
    issueDate: '22 May 2015',
    expiryDate: null,
    status: 'Current',
    verificationStatus: 'Verified',
    source: 'DigiLocker',
    currentVersionId: 'ver-pan-01',
    reusable: true,
    statutoryReferences: ['Income Tax Act 1961, Section 139A'],
    linkedApprovals: ['MPCB-CTE', 'MIDC-BLD', 'DISH-BP', 'DFS-FNOC', 'MSEDCL-HT', 'MIDC-WTR', 'LAB-CLRA'],
    uploadedAt: '2026-01-10T10:10:00Z',
    updatedAt: '2026-01-10T10:10:00Z',
    digiLockerUri: 'in.gov.incometax-pan-AABCD1234E',
    qrVerified: true,
  },
  {
    id: 'doc-signatory-aadhaar-04',
    documentType: 'Aadhaar e-KYC Verification Certificate',
    documentName: 'Authorized Signatory Aadhaar e-KYC — Priya Deshmukh',
    category: 'Identity & Applicant',
    description: 'Digitally signed Aadhaar offline XML credential verified via UIDAI OTP.',
    ownerType: 'Applicant',
    ownerId: 'USR-MH-2026-08140',
    enterpriseId: 'ent-dipl-01',
    projectIds: ['proj-chk-01', 'proj-supa-02', 'proj-bho-03', 'proj-aur-04'],
    issuingAuthority: 'Unique Identification Authority of India (UIDAI)',
    documentNumber: 'XXXX-XXXX-4819',
    issueDate: '12 January 2026',
    expiryDate: null,
    status: 'Current',
    verificationStatus: 'Verified',
    source: 'DigiLocker',
    currentVersionId: 'ver-aadhaar-01',
    reusable: true,
    statutoryReferences: ['Aadhaar Act 2016', 'IT Act 2000 Section 3A'],
    linkedApprovals: ['MPCB-CTE', 'MIDC-BLD', 'DISH-BP', 'DFS-FNOC', 'MSEDCL-HT', 'LAB-CLRA'],
    uploadedAt: '2026-01-12T09:15:00Z',
    updatedAt: '2026-01-12T09:15:00Z',
    digiLockerUri: 'in.gov.uidai-aadhaar-offline-4819',
    qrVerified: true,
  },
  {
    id: 'doc-midc-allot-05',
    documentType: 'MIDC Land Allotment Letter & Possession Receipt',
    documentName: 'MIDC Plot Allotment Letter & Handover Possession Receipt',
    category: 'Land & Siting',
    description: 'Formal industrial plot allotment order and official demarcation handover for Plot B-14/1 Chakan Phase II.',
    ownerType: 'Project',
    ownerId: 'proj-chk-01',
    enterpriseId: 'ent-dipl-01',
    projectIds: ['proj-chk-01'],
    issuingAuthority: 'Maharashtra Industrial Development Corporation (Regional Office Pune)',
    documentNumber: 'MIDC/RO-PUN/ALLOT/2021/8849',
    issueDate: '19 November 2021',
    expiryDate: null,
    status: 'Current',
    verificationStatus: 'Verified',
    source: 'Department Issued',
    currentVersionId: 'ver-allot-01',
    reusable: true,
    statutoryReferences: ['MIDC Act 1961, Section 32', 'MIDC Disposal of Land Regulations 1975'],
    linkedApprovals: ['MPCB-CTE', 'MIDC-BLD', 'DISH-BP', 'DFS-FNOC', 'MSEDCL-HT', 'MIDC-WTR'],
    uploadedAt: '2026-01-15T11:00:00Z',
    updatedAt: '2026-01-15T11:00:00Z',
    digiLockerUri: 'in.gov.maharashtra.midc-allot-8849',
    qrVerified: true,
  },
  {
    id: 'doc-lease-deed-06',
    documentType: 'MIDC 95-Year Industrial Lease Deed',
    documentName: 'Registered 95-Year Industrial Lease Deed & Stamp Duty Challan',
    category: 'Land & Siting',
    description: 'Registered statutory lease deed executed with MIDC Pune at Sub-Registrar Office Khed.',
    ownerType: 'Project',
    ownerId: 'proj-chk-01',
    enterpriseId: 'ent-dipl-01',
    projectIds: ['proj-chk-01'],
    issuingAuthority: 'Joint Sub-Registrar Class II, Taluka Khed, Inspector General of Registration',
    documentNumber: 'REG-KHED-2021-4190',
    issueDate: '08 December 2021',
    expiryDate: '07 December 2116',
    status: 'Current',
    verificationStatus: 'Verified',
    source: 'Department Issued',
    currentVersionId: 'ver-lease-01',
    reusable: true,
    statutoryReferences: ['Registration Act 1908', 'Maharashtra Stamp Act 1958'],
    linkedApprovals: ['MPCB-CTE', 'MIDC-BLD', 'DISH-BP', 'DFS-FNOC'],
    uploadedAt: '2026-01-15T11:10:00Z',
    updatedAt: '2026-01-15T11:10:00Z',
    qrVerified: true,
  },
  {
    id: 'doc-arch-plan-07',
    documentType: 'Architectural Factory Layout Plan',
    documentName: 'Factory Layout, Site Elevation & Cross-Section Plan (AutoCAD PDF)',
    category: 'Engineering & Layout',
    description: 'Comprehensive architectural drawing displaying machinery footprint, 12m clear roadway, fire exits, and ventilation shafts.',
    ownerType: 'Project',
    ownerId: 'proj-chk-01',
    enterpriseId: 'ent-dipl-01',
    projectIds: ['proj-chk-01'],
    issuingAuthority: 'Council of Architecture Licensed Architect (Reg. CA/2008/42918)',
    documentNumber: 'DWG-CA-2026-7712/REV-B',
    issueDate: '24 February 2026',
    expiryDate: null,
    status: 'Current',
    verificationStatus: 'Verified',
    source: 'Direct Upload',
    currentVersionId: 'ver-arch-02',
    reusable: true,
    statutoryReferences: ['Factories Act 1948, Rule 3(1)', 'MIDC Standard Development Control Regulations (DCR)'],
    linkedApprovals: ['MIDC-BLD', 'DISH-BP', 'DFS-FNOC', 'MPCB-CTE'],
    uploadedAt: '2026-01-20T14:00:00Z',
    updatedAt: '2026-02-24T16:30:00Z',
    qrVerified: true,
  },
  {
    id: 'doc-structural-cert-08',
    documentType: 'Structural Stability & Seismic Design Certificate',
    documentName: 'Structural Stability Certificate & Heavy Gantry Crane Load Analysis',
    category: 'Engineering & Layout',
    description: 'Certified civil stability analysis validating IS 1893 seismic compliance and 20-ton overhead gantry crane load endurance.',
    ownerType: 'Project',
    ownerId: 'proj-chk-01',
    enterpriseId: 'ent-dipl-01',
    projectIds: ['proj-chk-01'],
    issuingAuthority: 'Chartered Structural Engineer / CoEP Empanelled Consultant',
    documentNumber: 'CE-STR-2026-0194',
    issueDate: '05 February 2026',
    expiryDate: null,
    status: 'Current',
    verificationStatus: 'Verified',
    source: 'Direct Upload',
    currentVersionId: 'ver-str-01',
    reusable: true,
    statutoryReferences: ['Maharashtra Factories Rules 1963, Rule 3A', 'Bureau of Indian Standards IS 456 & IS 1893'],
    linkedApprovals: ['MIDC-BLD', 'DISH-BP'],
    uploadedAt: '2026-02-06T10:00:00Z',
    updatedAt: '2026-02-06T10:00:00Z',
    qrVerified: true,
  },
  {
    id: 'doc-msedcl-ht-09',
    documentType: 'HT Power Feasibility & Sanction Order',
    documentName: 'MSEDCL 1250 kVA High Tension (22 kV) Power Feasibility & Sanction',
    category: 'Safety & Utility',
    description: 'Technical feasibility confirmation and dedicated 22 kV express feeder sanction from Chakan 220/22 kV sub-station.',
    ownerType: 'Project',
    ownerId: 'proj-chk-01',
    enterpriseId: 'ent-dipl-01',
    projectIds: ['proj-chk-01'],
    issuingAuthority: 'Superintending Engineer (O&M), MSEDCL Circle Office Bhosari',
    documentNumber: 'MSEDCL/HT-SANC/2026/1250KVA-881',
    issueDate: '15 January 2026',
    expiryDate: '14 January 2027',
    status: 'Current',
    verificationStatus: 'Verified',
    source: 'Department Issued',
    currentVersionId: 'ver-ht-01',
    reusable: true,
    statutoryReferences: ['Electricity Act 2003, Section 43', 'Maharashtra Electricity Regulatory Commission (MERC) Code'],
    linkedApprovals: ['MSEDCL-HT', 'MPCB-CTE', 'DISH-BP'],
    uploadedAt: '2026-01-16T12:00:00Z',
    updatedAt: '2026-01-16T12:00:00Z',
    qrVerified: true,
  },
  {
    id: 'doc-midc-water-10',
    documentType: 'Industrial Water Supply Agreement',
    documentName: 'MIDC 50 KLD Industrial Piped Water Connection Sanction Letter',
    category: 'Safety & Utility',
    description: 'Official allocation of 50,000 Litres/Day piped treated industrial water from Chakan MIDC Water Works scheme.',
    ownerType: 'Project',
    ownerId: 'proj-chk-01',
    enterpriseId: 'ent-dipl-01',
    projectIds: ['proj-chk-01'],
    issuingAuthority: 'Executive Engineer (Water Supply Division), MIDC Pune',
    documentNumber: 'MIDC/EE-WTR/2026/0491',
    issueDate: '22 January 2026',
    expiryDate: null,
    status: 'Current',
    verificationStatus: 'Verified',
    source: 'Department Issued',
    currentVersionId: 'ver-wtr-01',
    reusable: true,
    statutoryReferences: ['MIDC Water Supply Regulations 1973'],
    linkedApprovals: ['MIDC-WTR', 'MPCB-CTE'],
    uploadedAt: '2026-01-23T09:30:00Z',
    updatedAt: '2026-01-23T09:30:00Z',
    qrVerified: true,
  },
  {
    id: 'doc-fire-prop-11',
    documentType: 'Provisional Fire Fighting & Evacuation Scheme',
    documentName: 'Preliminary Fire Safety Scheme & Fire Hydrant Piping Network Layout',
    category: 'Safety & Utility',
    description: 'Provisional fire layout showing dedicated 150,000 litre underground water static tank, diesel pumps, and risers.',
    ownerType: 'Project',
    ownerId: 'proj-chk-01',
    enterpriseId: 'ent-dipl-01',
    projectIds: ['proj-chk-01'],
    issuingAuthority: 'Directorate of Maharashtra Fire Services / MIDC Chief Fire Officer',
    documentNumber: 'DFS/PUNE/FIR-REC/2026/088',
    issueDate: '10 February 2026',
    expiryDate: '09 February 2027',
    status: 'Current',
    verificationStatus: 'Verified',
    source: 'Direct Upload',
    currentVersionId: 'ver-fire-01',
    reusable: true,
    statutoryReferences: ['Maharashtra Fire Prevention & Life Safety Measures Act 2006, Section 3'],
    linkedApprovals: ['DFS-FNOC', 'MIDC-BLD', 'DISH-BP'],
    uploadedAt: '2026-02-11T15:00:00Z',
    updatedAt: '2026-02-11T15:00:00Z',
    qrVerified: true,
  },
  {
    id: 'doc-etp-proposal-12',
    documentType: 'Effluent Treatment Plant (ETP) Scheme',
    documentName: 'Zero Liquid Discharge (ZLD) ETP Schematics & Mass Balance Report',
    category: 'Environmental & Health',
    description: 'Detailed engineering proposal for 35 KLD trade effluent neutralization, settling, and RO recycling unit.',
    ownerType: 'Project',
    ownerId: 'proj-chk-01',
    enterpriseId: 'ent-dipl-01',
    projectIds: ['proj-chk-01'],
    issuingAuthority: 'National Environmental Engineering Research Institute (NEERI) Accredited Consultant',
    documentNumber: 'ENV-ETP-2026-0921',
    issueDate: '01 March 2026',
    expiryDate: null,
    status: 'Current',
    verificationStatus: 'Pending Verification',
    source: 'Direct Upload',
    currentVersionId: 'ver-etp-01',
    reusable: false, // Pending verification, not yet reusable
    statutoryReferences: ['Water (Prevention and Control of Pollution) Act 1974, Section 25', 'Environment (Protection) Act 1986'],
    linkedApprovals: ['MPCB-CTE'],
    uploadedAt: '2026-03-02T11:00:00Z',
    updatedAt: '2026-03-02T11:00:00Z',
    qrVerified: false,
  },
  {
    id: 'doc-mpcb-exp-13',
    documentType: 'Previous MPCB Consent to Establish',
    documentName: 'Legacy MPCB Consent to Establish (Orange Category - 2021)',
    category: 'Environmental & Health',
    description: 'Previous initial establishment consent granted for Bhosari tooling unit. Has expired and superseded by expansion.',
    ownerType: 'Enterprise',
    ownerId: 'ent-dipl-01',
    enterpriseId: 'ent-dipl-01',
    projectIds: ['proj-bho-03'],
    issuingAuthority: 'Maharashtra Pollution Control Board (Sub-Regional Office Pune-II)',
    documentNumber: 'MPCB/SRO-PUN2/CTE/2021/4409',
    issueDate: '15 June 2021',
    expiryDate: '14 June 2025', // Expired!
    status: 'Expired',
    verificationStatus: 'Expired',
    source: 'Single Window Repository',
    currentVersionId: 'ver-mpcb-exp-01',
    reusable: false, // Expired, not reusable!
    statutoryReferences: ['Water Act 1974', 'Air Act 1981'],
    linkedApprovals: ['MPCB-CTE'],
    uploadedAt: '2026-01-10T12:00:00Z',
    updatedAt: '2026-01-10T12:00:00Z',
    qrVerified: false,
  },
  {
    id: 'doc-board-resolution-14',
    documentType: 'Board Resolution for Authorized Signatory',
    documentName: 'Certified Board Resolution Appointing Smt. Priya Deshmukh as Signatory',
    category: 'Identity & Applicant',
    description: 'Certified extract of the resolution passed by Board of Directors authorizing Priya Deshmukh for single window portal.',
    ownerType: 'Enterprise',
    ownerId: 'ent-dipl-01',
    enterpriseId: 'ent-dipl-01',
    projectIds: ['proj-chk-01', 'proj-supa-02', 'proj-bho-03'],
    issuingAuthority: 'Board of Directors, Deshmukh Industries Pvt. Ltd.',
    documentNumber: 'BR-2025/11/04',
    issueDate: '04 November 2025',
    expiryDate: null,
    status: 'Current',
    verificationStatus: 'Verified',
    source: 'Direct Upload',
    currentVersionId: 'ver-br-01',
    reusable: true,
    statutoryReferences: ['Companies Act 2013, Section 179(3)'],
    linkedApprovals: ['MPCB-CTE', 'MIDC-BLD', 'DISH-BP', 'DFS-FNOC', 'MSEDCL-HT', 'MIDC-WTR', 'LAB-CLRA'],
    uploadedAt: '2026-01-11T16:00:00Z',
    updatedAt: '2026-01-11T16:00:00Z',
    qrVerified: true,
  },
  {
    id: 'doc-clra-undertaking-15',
    documentType: 'Contract Labour Welfare Undertaking',
    documentName: 'Form-I Principal Employer Contract Labour Undertaking & Contractor List',
    category: 'Labour & Workforce',
    description: 'Statutory undertaking detailing provision of canteens, rest-rooms, first-aid and wage payment guarantees under CLRA.',
    ownerType: 'Project',
    ownerId: 'proj-chk-01',
    enterpriseId: 'ent-dipl-01',
    projectIds: ['proj-chk-01'],
    issuingAuthority: 'Office of the Commissioner of Labour, Maharashtra',
    documentNumber: 'CLRA-PE-2026-0932',
    issueDate: '12 February 2026',
    expiryDate: null,
    status: 'Current',
    verificationStatus: 'Pending Verification',
    source: 'Direct Upload',
    currentVersionId: 'ver-clra-01',
    reusable: false,
    statutoryReferences: ['Contract Labour (Regulation & Abolition) Act 1970, Section 7'],
    linkedApprovals: ['LAB-CLRA'],
    uploadedAt: '2026-02-12T14:30:00Z',
    updatedAt: '2026-02-12T14:30:00Z',
    qrVerified: false,
  },
];

// 2. Initial Reference Document Versions
export const INITIAL_VERSIONS: DocumentVersion[] = [
  // Certificate of Incorporation
  {
    id: 'ver-inc-01',
    documentId: 'doc-mca-inc-01',
    versionNumber: 'v1.0',
    fileName: 'MCA_Incorporation_Cert_U28112PN2015PTC154892.pdf',
    fileType: 'application/pdf',
    fileSize: '1.42 MB',
    uploadedAt: '2026-01-10T10:00:00Z',
    uploadedBy: 'DigiLocker Auto-Sync',
    source: 'DigiLocker',
    verificationStatus: 'Verified',
    changeReason: 'Initial verified fetch from MCA21 database via DigiLocker Government Gateway.',
    isCurrent: true,
    digitalSignature: {
      signedBy: 'RoC Pune Digital Signing Authority',
      algorithm: 'SHA256withRSA',
      timestamp: '2015-05-14T14:20:00Z',
      certificateSerial: 'MCA21-PUN-2015-998124',
    },
  },
  // Udyam
  {
    id: 'ver-udyam-01',
    documentId: 'doc-msme-udyam-02',
    versionNumber: 'v1.0',
    fileName: 'UDYAM_Certificate_MH_26_0048123.pdf',
    fileType: 'application/pdf',
    fileSize: '840 KB',
    uploadedAt: '2026-01-10T10:05:00Z',
    uploadedBy: 'DigiLocker Auto-Sync',
    source: 'DigiLocker',
    verificationStatus: 'Verified',
    changeReason: 'Synchronized with Ministry of MSME national portal via DigiLocker repository.',
    isCurrent: true,
    digitalSignature: {
      signedBy: 'Govt of India MSME Portal Server Signer',
      algorithm: 'SHA256withRSA',
      timestamp: '2021-10-18T16:10:00Z',
      certificateSerial: 'MSME-UDYAM-GOI-44102',
    },
  },
  // PAN
  {
    id: 'ver-pan-01',
    documentId: 'doc-ent-pan-03',
    versionNumber: 'v1.0',
    fileName: 'Enterprise_PAN_AABCD1234E_ePAN.pdf',
    fileType: 'application/pdf',
    fileSize: '620 KB',
    uploadedAt: '2026-01-10T10:10:00Z',
    uploadedBy: 'DigiLocker Auto-Sync',
    source: 'DigiLocker',
    verificationStatus: 'Verified',
    changeReason: 'e-PAN pulled from Income Tax Department (ITD) e-Filing vault.',
    isCurrent: true,
  },
  // Aadhaar
  {
    id: 'ver-aadhaar-01',
    documentId: 'doc-signatory-aadhaar-04',
    versionNumber: 'v1.0',
    fileName: 'Aadhaar_eKYC_XML_Deshmukh_Priya.pdf',
    fileType: 'application/pdf',
    fileSize: '512 KB',
    uploadedAt: '2026-01-12T09:15:00Z',
    uploadedBy: 'DigiLocker Auto-Sync',
    source: 'DigiLocker',
    verificationStatus: 'Verified',
    changeReason: 'Digitally authenticated via UIDAI OTP e-KYC handshake.',
    isCurrent: true,
  },
  // MIDC Allotment
  {
    id: 'ver-allot-01',
    documentId: 'doc-midc-allot-05',
    versionNumber: 'v1.0',
    fileName: 'MIDC_Plot_Allotment_Chakan_B14_1.pdf',
    fileType: 'application/pdf',
    fileSize: '3.10 MB',
    uploadedAt: '2026-01-15T11:00:00Z',
    uploadedBy: 'Priya Deshmukh (Managing Director)',
    source: 'Department Issued',
    verificationStatus: 'Verified',
    changeReason: 'Original scanned allotment letter with official receipt seal.',
    isCurrent: true,
  },
  // MIDC Lease Deed
  {
    id: 'ver-lease-01',
    documentId: 'doc-lease-deed-06',
    versionNumber: 'v1.0',
    fileName: 'MIDC_Registered_Lease_Deed_Khed_4190.pdf',
    fileType: 'application/pdf',
    fileSize: '8.45 MB',
    uploadedAt: '2026-01-15T11:10:00Z',
    uploadedBy: 'Priya Deshmukh (Managing Director)',
    source: 'Department Issued',
    verificationStatus: 'Verified',
    changeReason: 'Full registered copy with IGR Maharashtra index-II stamp.',
    isCurrent: true,
  },
  // Architectural Plan - MULTI-VERSION (v1.0 Superseded, v2.0 Current)
  {
    id: 'ver-arch-01',
    documentId: 'doc-arch-plan-07',
    versionNumber: 'v1.0',
    fileName: 'Factory_Layout_Plan_RevA_Jan2026.pdf',
    fileType: 'application/pdf',
    fileSize: '6.20 MB',
    uploadedAt: '2026-01-20T14:00:00Z',
    uploadedBy: 'Ar. Sunil Joshi (Authorized Consultant)',
    source: 'Direct Upload',
    verificationStatus: 'Verified',
    changeReason: 'Initial architectural submission for DISH and MIDC scrutiny.',
    isCurrent: false, // Superseded
  },
  {
    id: 'ver-arch-02',
    documentId: 'doc-arch-plan-07',
    versionNumber: 'v2.0',
    fileName: 'Factory_Layout_Plan_RevB_12mRoad_Feb2026.pdf',
    fileType: 'application/pdf',
    fileSize: '6.85 MB',
    uploadedAt: '2026-02-24T16:30:00Z',
    uploadedBy: 'Ar. Sunil Joshi (Authorized Consultant)',
    source: 'Direct Upload',
    verificationStatus: 'Verified',
    changeReason: 'Revision B: Modified rear setbacks to maintain mandatory 12m clear peripheral roadway for fire tenders as advised by MIDC Fire Officer.',
    isCurrent: true,
  },
  // Structural Stability
  {
    id: 'ver-str-01',
    documentId: 'doc-structural-cert-08',
    versionNumber: 'v1.0',
    fileName: 'Structural_Stability_Certificate_CoEP_0194.pdf',
    fileType: 'application/pdf',
    fileSize: '2.30 MB',
    uploadedAt: '2026-02-06T10:00:00Z',
    uploadedBy: 'Er. Anand Kulkarni (Chartered Engineer)',
    source: 'Direct Upload',
    verificationStatus: 'Verified',
    changeReason: 'Chartered structural stability certificate with mathematical stress analysis.',
    isCurrent: true,
  },
  // MSEDCL HT
  {
    id: 'ver-ht-01',
    documentId: 'doc-msedcl-ht-09',
    versionNumber: 'v1.0',
    fileName: 'MSEDCL_1250kVA_Sanction_Order_881.pdf',
    fileType: 'application/pdf',
    fileSize: '1.80 MB',
    uploadedAt: '2026-01-16T12:00:00Z',
    uploadedBy: 'Priya Deshmukh',
    source: 'Department Issued',
    verificationStatus: 'Verified',
    changeReason: 'Issued sanction order with commercial load commitment deposit receipt.',
    isCurrent: true,
  },
  // MIDC Water
  {
    id: 'ver-wtr-01',
    documentId: 'doc-midc-water-10',
    versionNumber: 'v1.0',
    fileName: 'MIDC_Water_Connection_Order_50KLD_0491.pdf',
    fileType: 'application/pdf',
    fileSize: '1.15 MB',
    uploadedAt: '2026-01-23T09:30:00Z',
    uploadedBy: 'Priya Deshmukh',
    source: 'Department Issued',
    verificationStatus: 'Verified',
    changeReason: 'Sanction letter from MIDC Water Works Chakan division.',
    isCurrent: true,
  },
  // Fire Preliminary
  {
    id: 'ver-fire-01',
    documentId: 'doc-fire-prop-11',
    versionNumber: 'v1.0',
    fileName: 'Provisional_Fire_Fighting_Scheme_088.pdf',
    fileType: 'application/pdf',
    fileSize: '4.40 MB',
    uploadedAt: '2026-02-11T15:00:00Z',
    uploadedBy: 'Ar. Sunil Joshi',
    source: 'Direct Upload',
    verificationStatus: 'Verified',
    changeReason: 'Provisional fire protection schematics endorsed by licensed fire agency.',
    isCurrent: true,
  },
  // ETP Scheme (Pending)
  {
    id: 'ver-etp-01',
    documentId: 'doc-etp-proposal-12',
    versionNumber: 'v1.0',
    fileName: 'ZLD_ETP_Scheme_Design_Report_35KLD.pdf',
    fileType: 'application/pdf',
    fileSize: '7.10 MB',
    uploadedAt: '2026-03-02T11:00:00Z',
    uploadedBy: 'EnviroTech Solutions Pvt Ltd',
    source: 'Direct Upload',
    verificationStatus: 'Pending Verification',
    changeReason: 'Initial design document submitted for MPCB Sub-Regional scrutiny.',
    isCurrent: true,
  },
  // Previous MPCB (Expired)
  {
    id: 'ver-mpcb-exp-01',
    documentId: 'doc-mpcb-exp-13',
    versionNumber: 'v1.0',
    fileName: 'MPCB_CTE_Orange_2021_Expired.pdf',
    fileType: 'application/pdf',
    fileSize: '2.10 MB',
    uploadedAt: '2026-01-10T12:00:00Z',
    uploadedBy: 'System Migration',
    source: 'Single Window Repository',
    verificationStatus: 'Expired',
    changeReason: 'Statutory validity period expired on 14 June 2025. Listed for historical audit only.',
    isCurrent: true,
  },
  // Board Resolution
  {
    id: 'ver-br-01',
    documentId: 'doc-board-resolution-14',
    versionNumber: 'v1.0',
    fileName: 'Board_Resolution_Authorized_Signatory_PriyaDeshmukh.pdf',
    fileType: 'application/pdf',
    fileSize: '950 KB',
    uploadedAt: '2026-01-11T16:00:00Z',
    uploadedBy: 'Priya Deshmukh',
    source: 'Direct Upload',
    verificationStatus: 'Verified',
    changeReason: 'Certified true copy signed by Directors on company letterhead.',
    isCurrent: true,
  },
  // CLRA Undertaking (Pending)
  {
    id: 'ver-clra-01',
    documentId: 'doc-clra-undertaking-15',
    versionNumber: 'v1.0',
    fileName: 'CLRA_Form_I_Principal_Employer_Undertaking.pdf',
    fileType: 'application/pdf',
    fileSize: '1.25 MB',
    uploadedAt: '2026-02-12T14:30:00Z',
    uploadedBy: 'Priya Deshmukh',
    source: 'Direct Upload',
    verificationStatus: 'Pending Verification',
    changeReason: 'Signed declaration for 65 contract labourers engaged during setup phase.',
    isCurrent: true,
  },
];

// 3. Initial Reference Reused Document Linkages
export const INITIAL_REUSE_RECORDS: DocumentReuseRecord[] = [
  {
    id: 'reuse-01',
    documentId: 'doc-mca-inc-01',
    documentName: 'Certificate of Incorporation',
    versionNumber: 'v1.0',
    targetClearanceCode: 'MPCB-CTE',
    targetClearanceName: 'Consent to Establish (CTE) under Water & Air Acts',
    targetRequirementName: 'Company Registration / Incorporation Certificate & MOA/AOA',
    projectId: 'proj-chk-01',
    projectName: 'Chakan Auto Component Expansion Unit',
    reusedAt: '2026-02-15T11:20:00Z',
    reusedBy: 'Priya Deshmukh',
    status: 'Active',
  },
  {
    id: 'reuse-02',
    documentId: 'doc-msme-udyam-02',
    documentName: 'Udyam MSME Registration Certificate',
    versionNumber: 'v1.0',
    targetClearanceCode: 'MPCB-CTE',
    targetClearanceName: 'Consent to Establish (CTE) under Water & Air Acts',
    targetRequirementName: 'Udyam Registration Certificate (MSME) or IEM Part-B',
    projectId: 'proj-chk-01',
    projectName: 'Chakan Auto Component Expansion Unit',
    reusedAt: '2026-02-15T11:22:00Z',
    reusedBy: 'Priya Deshmukh',
    status: 'Active',
  },
  {
    id: 'reuse-03',
    documentId: 'doc-midc-allot-05',
    documentName: 'MIDC Land Allotment Letter & Possession Receipt',
    versionNumber: 'v1.0',
    targetClearanceCode: 'MPCB-CTE',
    targetClearanceName: 'Consent to Establish (CTE) under Water & Air Acts',
    targetRequirementName: 'Land Ownership / Lease Agreement / MIDC Possession Letter',
    projectId: 'proj-chk-01',
    projectName: 'Chakan Auto Component Expansion Unit',
    reusedAt: '2026-02-15T11:25:00Z',
    reusedBy: 'Priya Deshmukh',
    status: 'Active',
  },
  {
    id: 'reuse-04',
    documentId: 'doc-midc-allot-05',
    documentName: 'MIDC Land Allotment Letter & Possession Receipt',
    versionNumber: 'v1.0',
    targetClearanceCode: 'MIDC-BLD',
    targetClearanceName: 'Building Plan Approval & Development Permission (MIDC SPA)',
    targetRequirementName: 'Allotment Letter & Lease Deed with MIDC',
    projectId: 'proj-chk-01',
    projectName: 'Chakan Auto Component Expansion Unit',
    reusedAt: '2026-02-16T14:10:00Z',
    reusedBy: 'Priya Deshmukh',
    status: 'Active',
  },
];

// 4. Initial DigiLocker State
export const INITIAL_DIGILOCKER_STATE: DigiLockerSyncState = {
  isLinked: true,
  lastSyncedAt: '18 Sep 2026, 04:30 PM (IST)',
  linkedAadhaarMasked: 'XXXX-XXXX-4819',
  linkedPan: 'AAACD5120K',
  verifiedCount: 8,
  syncStatus: 'synced',
  issuerAgency: 'National e-Governance Division (NeGD) & MahaOnline Citizen Cloud',
};

class DocumentVaultService {
  private documents: DocumentRecord[] = [];
  private versions: DocumentVersion[] = [];
  private reuseRecords: DocumentReuseRecord[] = [];
  private digiLockerState: DigiLockerSyncState = INITIAL_DIGILOCKER_STATE;

  constructor() {
    this.init();
  }

  private init() {
    try {
      const storedDocs = localStorage.getItem(STORAGE_DOCS_KEY);
      this.documents = storedDocs ? JSON.parse(storedDocs) : [...INITIAL_DOCUMENTS];

      const storedVers = localStorage.getItem(STORAGE_VERSIONS_KEY);
      this.versions = storedVers ? JSON.parse(storedVers) : [...INITIAL_VERSIONS];

      const storedReuse = localStorage.getItem(STORAGE_REUSE_KEY);
      this.reuseRecords = storedReuse ? JSON.parse(storedReuse) : [...INITIAL_REUSE_RECORDS];

      const storedDl = localStorage.getItem(STORAGE_DIGILOCKER_KEY);
      this.digiLockerState = storedDl ? JSON.parse(storedDl) : { ...INITIAL_DIGILOCKER_STATE };
    } catch (e) {
      console.warn('Error reading document vault from localStorage, using initial mock data', e);
      this.documents = [...INITIAL_DOCUMENTS];
      this.versions = [...INITIAL_VERSIONS];
      this.reuseRecords = [...INITIAL_REUSE_RECORDS];
      this.digiLockerState = { ...INITIAL_DIGILOCKER_STATE };
    }
  }

  private persistDocs() {
    try {
      localStorage.setItem(STORAGE_DOCS_KEY, JSON.stringify(this.documents));
    } catch (e) {
      console.error('Failed to persist documents to localStorage', e);
    }
  }

  private persistVersions() {
    try {
      localStorage.setItem(STORAGE_VERSIONS_KEY, JSON.stringify(this.versions));
    } catch (e) {
      console.error('Failed to persist versions to localStorage', e);
    }
  }

  private persistReuse() {
    try {
      localStorage.setItem(STORAGE_REUSE_KEY, JSON.stringify(this.reuseRecords));
    } catch (e) {
      console.error('Failed to persist reuse records to localStorage', e);
    }
  }

  private persistDigiLocker() {
    try {
      localStorage.setItem(STORAGE_DIGILOCKER_KEY, JSON.stringify(this.digiLockerState));
    } catch (e) {
      console.error('Failed to persist digilocker state to localStorage', e);
    }
  }

  // --- Document Query APIs ---

  public getAllDocuments(): DocumentRecord[] {
    return [...this.documents];
  }

  public getDocumentById(id: string): DocumentRecord | undefined {
    return this.documents.find((d) => d.id === id);
  }

  public getDocumentVersions(documentId: string): DocumentVersion[] {
    return this.versions
      .filter((v) => v.documentId === documentId)
      .sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());
  }

  public getCurrentVersion(documentId: string): DocumentVersion | undefined {
    return this.versions.find((v) => v.documentId === documentId && v.isCurrent);
  }

  public getDigiLockerState(): DigiLockerSyncState {
    return { ...this.digiLockerState };
  }

  public getReuseRecords(): DocumentReuseRecord[] {
    return [...this.reuseRecords];
  }

  public getReuseRecordsForDocument(documentId: string): DocumentReuseRecord[] {
    return this.reuseRecords.filter((r) => r.documentId === documentId && r.status === 'Active');
  }

  // --- Statutory Safeguards & Eligible Reusable Docs ---

  public getEligibleVerifiedDocuments(category?: string, projectId?: string): DocumentRecord[] {
    return this.documents.filter((doc) => {
      // Must be Verified, Current, non-expired, and marked reusable
      const isEligibleStatus =
        doc.verificationStatus === 'Verified' &&
        doc.status === 'Current' &&
        doc.reusable === true;

      if (!isEligibleStatus) return false;

      // Expiry check
      if (doc.expiryDate) {
        const exp = new Date(doc.expiryDate);
        if (!isNaN(exp.getTime()) && exp.getTime() < Date.now()) {
          return false;
        }
      }

      if (category && category !== 'All' && doc.category !== category) {
        return false;
      }

      if (projectId && projectId !== 'All') {
        // Document must be owned by applicant (globally reusable) or match project
        if (doc.ownerType !== 'Applicant' && !doc.projectIds.includes(projectId)) {
          // If owned by enterprise, check if enterprise owns project
          const project = applicantService.getProjectById(projectId);
          if (!project || project.enterpriseId !== doc.enterpriseId) {
            return false;
          }
        }
      }

      return true;
    });
  }

  // --- Reusable Document Action: Link into a Project / Application Requirement ---

  public reuseDocument(
    documentId: string,
    target: {
      targetClearanceCode: string;
      targetClearanceName: string;
      targetRequirementName: string;
      projectId: string;
      projectName: string;
      reusedBy: string;
    }
  ): { success: boolean; message: string; record?: DocumentReuseRecord } {
    const doc = this.getDocumentById(documentId);
    if (!doc) {
      return { success: false, message: 'Document not found in statutory vault.' };
    }

    // Safeguard checks
    if (doc.verificationStatus !== 'Verified') {
      return {
        success: false,
        message: `Document is currently ${doc.verificationStatus}. Only 'Verified' documents can be reused for statutory filings.`,
      };
    }
    if (doc.status === 'Expired') {
      return {
        success: false,
        message: 'This document has expired. Re-upload a current valid certificate to proceed.',
      };
    }
    if (!doc.reusable) {
      return {
        success: false,
        message: 'This document record is not marked for multi-application statutory reuse.',
      };
    }

    const currentVer = this.getCurrentVersion(documentId);

    // Create reuse link
    const reuseRecord: DocumentReuseRecord = {
      id: `reuse-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      documentId: doc.id,
      documentName: doc.documentName,
      versionNumber: currentVer?.versionNumber || 'v1.0',
      targetClearanceCode: target.targetClearanceCode,
      targetClearanceName: target.targetClearanceName,
      targetRequirementName: target.targetRequirementName,
      projectId: target.projectId,
      projectName: target.projectName,
      reusedAt: new Date().toISOString(),
      reusedBy: target.reusedBy || 'Priya Deshmukh',
      status: 'Active',
    };

    this.reuseRecords.unshift(reuseRecord);
    this.persistReuse();

    // Also link project to document if not present
    if (!doc.projectIds.includes(target.projectId)) {
      doc.projectIds.push(target.projectId);
    }
    if (!doc.linkedApprovals.includes(target.targetClearanceCode)) {
      doc.linkedApprovals.push(target.targetClearanceCode);
    }
    doc.updatedAt = new Date().toISOString();
    this.persistDocs();

    return {
      success: true,
      message: `Verified document successfully linked to ${target.targetClearanceName} (${target.targetClearanceCode}) without duplicating physical records.`,
      record: reuseRecord,
    };
  }

  // --- Upload New Version (Mock/Local Browser simulation with prototype safeguards) ---

  public uploadNewVersion(
    documentId: string,
    data: {
      fileName: string;
      fileType: string;
      fileSize: string;
      uploadedBy: string;
      changeReason: string;
    }
  ): { success: boolean; message: string; version?: DocumentVersion } {
    const doc = this.getDocumentById(documentId);
    if (!doc) {
      return { success: false, message: 'Document not found.' };
    }

    const currentVersions = this.getDocumentVersions(documentId);
    const prevNumber = currentVersions[0]?.versionNumber || 'v1.0';
    const nextNum = (parseFloat(prevNumber.replace('v', '')) + 1.0).toFixed(1);

    // Set all previous versions isCurrent = false
    this.versions.forEach((v) => {
      if (v.documentId === documentId) {
        v.isCurrent = false;
      }
    });

    const newVersion: DocumentVersion = {
      id: `ver-${Date.now()}`,
      documentId,
      versionNumber: `v${nextNum}`,
      fileName: data.fileName,
      fileType: data.fileType,
      fileSize: data.fileSize,
      uploadedAt: new Date().toISOString(),
      uploadedBy: data.uploadedBy,
      source: 'Direct Upload',
      // MANDATORY PROTOCOL: Do not falsely mark newly uploaded files as government verified
      verificationStatus: 'Pending Verification',
      changeReason: data.changeReason || 'Uploaded revised document version.',
      isCurrent: true,
    };

    this.versions.unshift(newVersion);
    this.persistVersions();

    // Update parent doc
    doc.currentVersionId = newVersion.id;
    doc.verificationStatus = 'Pending Verification'; // Enters verification queue
    doc.reusable = false; // Cannot be reused until verified
    doc.updatedAt = new Date().toISOString();
    this.persistDocs();

    return {
      success: true,
      message: `New version ${newVersion.versionNumber} uploaded. Document status set to 'Pending Verification' pending statutory officer scrutiny.`,
      version: newVersion,
    };
  }

  // --- Create New Document (Mock/Local simulation) ---

  public createDocument(
    docInput: Partial<DocumentRecord>,
    fileData: {
      fileName: string;
      fileType: string;
      fileSize: string;
      uploadedBy: string;
      changeReason?: string;
    }
  ): { success: boolean; message: string; document?: DocumentRecord } {
    const newId = `doc-${Date.now()}`;
    const versionId = `ver-${Date.now()}`;

    const newVersion: DocumentVersion = {
      id: versionId,
      documentId: newId,
      versionNumber: 'v1.0',
      fileName: fileData.fileName,
      fileType: fileData.fileType || 'application/pdf',
      fileSize: fileData.fileSize || '1.8 MB',
      uploadedAt: new Date().toISOString(),
      uploadedBy: fileData.uploadedBy || 'Priya Deshmukh',
      source: (docInput.source as any) || 'Direct Upload',
      // Prototype rule: New manual uploads start as Pending Verification
      verificationStatus: docInput.source === 'DigiLocker' ? 'Verified' : 'Pending Verification',
      changeReason: fileData.changeReason || 'Initial document upload to statutory locker.',
      isCurrent: true,
    };

    const newDoc: DocumentRecord = {
      id: newId,
      documentType: docInput.documentType || 'Statutory Filing Document',
      documentName: docInput.documentName || fileData.fileName.replace(/\.[^/.]+$/, ''),
      category: docInput.category || 'Other Regulatory Documents',
      description: docInput.description || 'Uploaded statutory document in MahaUdyam One locker.',
      ownerType: docInput.ownerType || 'Enterprise',
      ownerId: docInput.ownerId || 'ent-dipl-01',
      enterpriseId: docInput.enterpriseId || 'ent-dipl-01',
      projectIds: docInput.projectIds || [],
      issuingAuthority: docInput.issuingAuthority || 'Competent Authority / Government of Maharashtra',
      documentNumber: docInput.documentNumber || `MH-DOC-${Date.now().toString().slice(-6)}`,
      issueDate: docInput.issueDate || new Date().toISOString().split('T')[0],
      expiryDate: docInput.expiryDate || null,
      status: 'Current',
      verificationStatus: docInput.source === 'DigiLocker' ? 'Verified' : 'Pending Verification',
      source: (docInput.source as any) || 'Direct Upload',
      currentVersionId: versionId,
      reusable: docInput.source === 'DigiLocker',
      statutoryReferences: docInput.statutoryReferences || ['MahaUdyam One Single Window'],
      linkedApprovals: docInput.linkedApprovals || [],
      uploadedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      qrVerified: docInput.source === 'DigiLocker',
    };

    this.versions.unshift(newVersion);
    this.documents.unshift(newDoc);

    this.persistVersions();
    this.persistDocs();

    return {
      success: true,
      message: `Document '${newDoc.documentName}' stored in statutory vault with initial status: ${newDoc.verificationStatus}.`,
      document: newDoc,
    };
  }

  public verifyDocumentForPrototype(docId: string): { success: boolean; message: string } {
    const doc = this.documents.find((d) => d.id === docId);
    if (!doc) return { success: false, message: 'Document not found' };
    doc.verificationStatus = 'Verified';
    doc.reusable = true;
    doc.updatedAt = new Date().toISOString();
    const currentVer = this.versions.find((v) => v.id === doc.currentVersionId);
    if (currentVer) {
      currentVer.verificationStatus = 'Verified';
    }
    this.persistVersions();
    this.persistDocs();
    return { success: true, message: `Document '${doc.documentName}' verified for prototype demonstration.` };
  }

  // --- DigiLocker Simulation ---

  public syncDigiLocker(): { success: boolean; countSynced: number; message: string } {
    const verifiedCount = this.documents.filter((d) => d.source === 'DigiLocker').length;
    const nowStr = new Date().toLocaleString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }) + ' (IST)';

    this.digiLockerState = {
      ...this.digiLockerState,
      lastSyncedAt: nowStr,
      verifiedCount,
      syncStatus: 'synced',
    };

    this.persistDigiLocker();

    return {
      success: true,
      countSynced: verifiedCount,
      message: `DigiLocker synchronization completed. ${verifiedCount} statutory certificates verified against National DigiLocker Gateway.`,
    };
  }

  // --- Phase 4 Integration: Calculate Document Readiness for a Project ---

  public getPhase4Readiness(projectId?: string): {
    totalRequired: number;
    verifiedCount: number;
    pendingCount: number;
    missingCount: number;
    readinessPercentage: number;
    requirementsMap: Array<{
      requirement: DocumentRequirement;
      matchedDocument?: DocumentRecord;
      currentVersion?: DocumentVersion;
      status: 'VERIFIED_AVAILABLE' | 'PENDING_VERIFICATION' | 'EXPIRED' | 'MISSING';
      statusLabel: string;
      clearancesTriggered: string[];
    }>;
  } {
    // 1. Get or evaluate discovery summary
    let summary = approvalRuleEngine.getDiscoverySummary();

    if (!summary || (projectId && summary.projectContext.projectId !== projectId)) {
      // Evaluate for target or primary project
      const enterprises = applicantService.getEnterprises();
      const primaryEnt = enterprises.find((e) => e.isPrimary) || enterprises[0];
      const projects = applicantService.getProjectsByEnterprise(primaryEnt.id);
      const targetProj = (projectId ? projects.find((p) => p.id === projectId) : null) || projects[0];

      if (primaryEnt && targetProj) {
        const initialCtx = approvalRuleEngine.createInitialContext(primaryEnt, targetProj);
        summary = approvalRuleEngine.evaluateProject(initialCtx);
      }
    }

    const requirements = summary?.requiredDocuments || [];
    const allVaultDocs = this.getAllDocuments();

    let verifiedCount = 0;
    let pendingCount = 0;
    let missingCount = 0;

    const requirementsMap = requirements.map((req) => {
      // Search for best matching document in vault by normalized keywords
      const reqName = req.name.toLowerCase();
      let matchedDoc: DocumentRecord | undefined;

      matchedDoc = allVaultDocs.find((doc) => {
        const docName = doc.documentName.toLowerCase();
        const docType = doc.documentType.toLowerCase();

        // Exact or strong match checks
        if (reqName.includes('incorporation') || reqName.includes('moa') || reqName.includes('aoa')) {
          return docType.includes('incorporation') || docName.includes('incorporation');
        }
        if (reqName.includes('udyam') || reqName.includes('msme') || reqName.includes('iem')) {
          return docType.includes('udyam') || docName.includes('udyam');
        }
        if (reqName.includes('pan')) {
          return docType.includes('pan') || docName.includes('pan');
        }
        if (reqName.includes('land') || reqName.includes('allotment') || reqName.includes('possession') || reqName.includes('7/12') || reqName.includes('lease')) {
          return docType.includes('allotment') || docType.includes('lease') || docName.includes('allotment');
        }
        if (reqName.includes('layout') || reqName.includes('architect') || reqName.includes('drawing') || reqName.includes('elevation')) {
          return docType.includes('layout') || docName.includes('layout');
        }
        if (reqName.includes('structural') || reqName.includes('stability')) {
          return docType.includes('structural') || docName.includes('stability');
        }
        if (reqName.includes('power') || reqName.includes('electricity') || reqName.includes('msedcl') || reqName.includes('ht load')) {
          return docType.includes('power') || docName.includes('msedcl') || docType.includes('ht');
        }
        if (reqName.includes('water') || reqName.includes('piped supply')) {
          return docType.includes('water') || docName.includes('water');
        }
        if (reqName.includes('fire') || reqName.includes('hydrant') || reqName.includes('evacuation')) {
          return docType.includes('fire') || docName.includes('fire');
        }
        if (reqName.includes('etp') || reqName.includes('effluent') || reqName.includes('pollution') || reqName.includes('waste')) {
          return docType.includes('effluent') || docName.includes('etp');
        }
        if (reqName.includes('contract labour') || reqName.includes('clra') || reqName.includes('form-i')) {
          return docType.includes('contract labour') || docName.includes('clra');
        }
        if (reqName.includes('board resolution') || reqName.includes('authorized signatory') || reqName.includes('power of attorney')) {
          return docType.includes('resolution') || docName.includes('resolution');
        }

        return false;
      });

      let status: 'VERIFIED_AVAILABLE' | 'PENDING_VERIFICATION' | 'EXPIRED' | 'MISSING' = 'MISSING';
      let statusLabel = 'Missing in Vault';

      if (matchedDoc) {
        if (matchedDoc.status === 'Expired' || matchedDoc.verificationStatus === 'Expired') {
          status = 'EXPIRED';
          statusLabel = 'Expired (Needs Renewal)';
        } else if (matchedDoc.verificationStatus === 'Verified') {
          status = 'VERIFIED_AVAILABLE';
          statusLabel = 'Verified & Ready to Reuse';
          verifiedCount++;
        } else {
          status = 'PENDING_VERIFICATION';
          statusLabel = 'Pending Scrutiny Verification';
          pendingCount++;
        }
      } else {
        missingCount++;
      }

      const currentVer = matchedDoc ? this.getCurrentVersion(matchedDoc.id) : undefined;

      return {
        requirement: req,
        matchedDocument: matchedDoc,
        currentVersion: currentVer,
        status,
        statusLabel,
        clearancesTriggered: req.mandatoryForClearanceIds,
      };
    });

    const totalRequired = requirements.length;
    const readinessPercentage = totalRequired > 0 ? Math.round((verifiedCount / totalRequired) * 100) : 0;

    return {
      totalRequired,
      verifiedCount,
      pendingCount,
      missingCount,
      readinessPercentage,
      requirementsMap,
    };
  }

  // --- Reset to Initial Mock Data ---
  public resetToDefaults(): void {
    this.documents = [...INITIAL_DOCUMENTS];
    this.versions = [...INITIAL_VERSIONS];
    this.reuseRecords = [...INITIAL_REUSE_RECORDS];
    this.digiLockerState = { ...INITIAL_DIGILOCKER_STATE };
    this.persistDocs();
    this.persistVersions();
    this.persistReuse();
    this.persistDigiLocker();
  }
}

export const documentVaultService = new DocumentVaultService();
