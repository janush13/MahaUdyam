import {
  OfficerApprovalCode,
  OfficerAuditEvent,
  OfficerDeptCode,
  OfficerDeskStatus,
  OfficerDocStatus,
  OfficerDossier,
  OfficerDossierDocument,
  OfficerInspectionInfo,
  OfficerQueryMessage,
  OfficerQueueRecord,
  OfficerSlaRisk,
  OfficerSlaSummary,
} from '../types/officer';
import { INITIAL_ENTERPRISES, INITIAL_PROJECTS } from './applicantService';

// ── Static reference constants (Screen 26) ─────────────────────────────────────────────

/** The reference desk "today": 2 days before the 15 Dec 2024 SLA cutoff of MUO/2024/000123. */
export const OFFICER_REFERENCE_TODAY = '2024-12-13';
export const OFFICER_UPDATED_AT = '11:42 AM';
export const DEFAULT_SELECTED_APPLICATION = 'MUO/2024/000123';

export const DEPARTMENT_OPTIONS: Array<{ value: 'all' | OfficerDeptCode; label: string }> = [
  { value: 'all', label: 'Industries & Labour (All)' },
  { value: 'ind', label: 'Directorate of Industries' },
  { value: 'env', label: 'Environment (MPCB)' },
  { value: 'lab', label: 'Labour / DISH Maharashtra' },
  { value: 'midc', label: 'Urban Dev (MIDC)' },
  { value: 'fire', label: 'Fire Services (MFS)' },
  { value: 'mseb', label: 'Energy (MSEDCL)' },
];

export const APPROVAL_OPTIONS: Array<{ value: 'all' | OfficerApprovalCode; label: string }> = [
  { value: 'all', label: 'All Approval Types' },
  { value: 'fact', label: 'Factory Licence (Act 1948)' },
  { value: 'cte', label: 'Consent to Establish (CTE)' },
  { value: 'bldg', label: 'Building Plan Sanction' },
  { value: 'fire', label: 'Provisional Fire NOC' },
  { value: 'ht', label: 'HT Power Connection (33kV)' },
];

export type SlaFilterValue = 'all' | 'breached' | 'near' | 'approaching' | 'normal';
export const SLA_OPTIONS: Array<{ value: SlaFilterValue; label: string }> = [
  { value: 'all', label: 'All SLA Risks (36/12/8/4)' },
  { value: 'breached', label: 'Breached (>0 Days)' },
  { value: 'near', label: 'Near Breach (<48 Hours)' },
  { value: 'approaching', label: 'Approaching (3-5 Days)' },
  { value: 'normal', label: 'Normal / Within SLA' },
];

export type StatusFilterValue = 'all' | 'scrutiny' | 'query' | 'inspection' | 'decision' | 'closed';
export const STATUS_OPTIONS: Array<{ value: StatusFilterValue; label: string }> = [
  { value: 'all', label: 'All Active Statuses' },
  { value: 'scrutiny', label: 'Under Scrutiny' },
  { value: 'query', label: 'Query Raised / Awaited' },
  { value: 'inspection', label: 'Inspection Scheduled' },
  { value: 'decision', label: 'Decision Pending (Level 2)' },
  { value: 'closed', label: 'Approved / Closed' },
];

export const FORWARD_AUTHORITY_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'l2_jd', label: 'Joint Director of Industrial Safety & Health (Pune Region) - Level 2' },
  { value: 'l3_dir', label: 'Director of Industrial Safety (Mumbai HQ) - Level 3' },
  { value: 'l1_peer', label: 'Peer Officer for Secondary Cross-Verification' },
];

export const REASSIGN_OFFICER_OPTIONS: string[] = [
  'Anjali Bhosale — Scrutiny Officer, Pune Circle',
  'Vivek Jadhav — Scrutiny Officer, Chakan Sub-Division',
  'Meera Kulkarni — Senior Scrutiny Officer, Pimpri-Chinchwad',
  'Sameer Shinde — Scrutiny Officer, Ranjangaon Desk',
];

export const OFFICER_PAGE_SIZE = 6;

// ── Approval catalogue ──────────────────────────────────────────────────────────────────

interface ApprovalMeta {
  name: string;
  act: string;
  deptCode: OfficerDeptCode;
  deptName: string;
  deskName: string;
  docs: Array<{ title: string; subtitle: string; fileType: 'pdf' | 'cad' }>;
}

const APPROVALS: Record<OfficerApprovalCode, ApprovalMeta> = {
  fact: {
    name: 'Factory Licence & Plan Sanction',
    act: 'Under Sec 6, Factories Act 1948',
    deptCode: 'lab',
    deptName: 'Labour (DISH)',
    deskName: 'Pune Circle Desk',
    docs: [
      { title: 'Land Ownership / MIDC Allotment Letter', subtitle: 'Ref: MIDC/PUN/CHK/2023/941', fileType: 'pdf' },
      { title: 'Site Plan & Machinery Layout Blueprints', subtitle: 'Scale 1:100', fileType: 'cad' },
      { title: 'Identity Proof & Board Authorisation', subtitle: 'Director Identification Number Verified', fileType: 'pdf' },
      { title: 'Environmental Consent to Establish (CTE Copy)', subtitle: 'MPCB/RO-PUN/CONSENT/24100', fileType: 'pdf' },
    ],
  },
  cte: {
    name: 'Consent to Establish (CTE)',
    act: 'Water & Air Pollution Control Acts',
    deptCode: 'env',
    deptName: 'Environment (MPCB)',
    deskName: 'RO Pune',
    docs: [
      { title: 'Project Report & Process Flow Chart', subtitle: 'Signed by authorised signatory', fileType: 'pdf' },
      { title: 'Land Ownership / Lease Deed', subtitle: 'Registered document', fileType: 'pdf' },
      { title: 'Effluent Treatment Plant Design', subtitle: 'Layout & capacity calculations', fileType: 'cad' },
      { title: 'Consent Fee Challan (MahaE-Seva)', subtitle: 'Treasury reconciled', fileType: 'pdf' },
    ],
  },
  bldg: {
    name: 'Building Plan Approval',
    act: 'MIDC DCR Regulation 2018',
    deptCode: 'midc',
    deptName: 'Urban Dev (MIDC)',
    deskName: 'SPA Section',
    docs: [
      { title: 'Land Title / Allotment Letter', subtitle: 'MIDC allotment record', fileType: 'pdf' },
      { title: 'Architect-Certified Building Drawings', subtitle: 'Scale 1:100', fileType: 'cad' },
      { title: 'Structural Stability Certificate', subtitle: 'Licensed structural engineer', fileType: 'pdf' },
      { title: 'Fire Safety Layout Plan', subtitle: 'Emergency exits demarcated', fileType: 'cad' },
    ],
  },
  fire: {
    name: 'Fire Safety Provisional NOC',
    act: 'Maharashtra Fire Prevention Act',
    deptCode: 'fire',
    deptName: 'Fire Services (MFS)',
    deskName: 'HQ Mumbai Desk',
    docs: [
      { title: 'Fire Fighting System Layout', subtitle: 'Hydrant & sprinkler schematic', fileType: 'cad' },
      { title: 'Building Plan Sanction Copy', subtitle: 'Sanctioned drawings', fileType: 'pdf' },
      { title: 'Occupancy & Storage Statement', subtitle: 'Hazard classification', fileType: 'pdf' },
      { title: 'Fire Equipment Vendor Certificate', subtitle: 'Licensed agency', fileType: 'pdf' },
    ],
  },
  ht: {
    name: 'HT Power Connection (33 kV)',
    act: 'Electricity Act, 2003',
    deptCode: 'mseb',
    deptName: 'Energy (MSEDCL)',
    deskName: 'Bhosari Circle',
    docs: [
      { title: 'Load Sanction Application', subtitle: 'Demand: HT 33 kV', fileType: 'pdf' },
      { title: 'Site Ownership Proof', subtitle: 'Registered document', fileType: 'pdf' },
      { title: 'Single Line Diagram (SLD)', subtitle: 'Electrical inspector approved', fileType: 'cad' },
      { title: 'Consent from Local Authority', subtitle: 'Right-of-way clearance', fileType: 'pdf' },
    ],
  },
};

// ── Deterministic queue generation ──────────────────────────────────────────────────────

const shiftDate = (iso: string, days: number): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

const riskFromDays = (daysLeft: number): OfficerSlaRisk => {
  if (daysLeft < 0) return 'BREACHED';
  if (daysLeft <= 2) return 'NEAR_BREACH';
  if (daysLeft <= 5) return 'APPROACHING';
  return 'WITHIN_SLA';
};

interface Seed {
  applicationNo: string;
  enterpriseName: string;
  location: string;
  approvalCode: OfficerApprovalCode;
  deptCode?: OfficerDeptCode;
  deskName?: string;
  submittedOn: string;
  daysLeft: number | null;
  status: OfficerDeskStatus;
  dueTime?: string;
  /** Explicit due date for closed dossiers (open ones derive it from daysLeft). */
  dueDate?: string;
}

const buildRecord = (s: Seed): OfficerQueueRecord => {
  const meta = APPROVALS[s.approvalCode];
  const deptCode = s.deptCode ?? meta.deptCode;
  const deptName = deptCode === 'ind' ? 'Directorate of Industries' : meta.deptName;
  const dueDate = s.daysLeft === null ? (s.dueDate ?? shiftDate(s.submittedOn, 5)) : shiftDate(OFFICER_REFERENCE_TODAY, s.daysLeft);
  return {
    applicationNo: s.applicationNo,
    enterpriseName: s.enterpriseName,
    location: s.location,
    approvalCode: s.approvalCode,
    approvalName: meta.name,
    act: meta.act,
    deptCode,
    deptName,
    deskName: s.deskName ?? (deptCode === 'ind' ? 'Pune Region Desk' : meta.deskName),
    submittedOn: s.submittedOn,
    dueDate,
    dueTime: s.dueTime,
    daysLeft: s.daysLeft,
    slaRisk: s.daysLeft === null ? 'COMPLIED' : riskFromDays(s.daysLeft),
    status: s.status,
  };
};

const REFERENCE_SEEDS: Seed[] = [
  {
    applicationNo: 'MUO/2024/000123',
    enterpriseName: 'Deshmukh Industries Pvt. Ltd.',
    location: 'Chakan Phase-II, Tal. Khed, Pune',
    approvalCode: 'fact',
    submittedOn: '2024-12-12',
    daysLeft: 2,
    status: 'UNDER_SCRUTINY',
    dueTime: '05:00 PM cutoff',
  },
  {
    applicationNo: 'MUO/2024/00145',
    enterpriseName: 'Sahyadri Bio-Tech Solutions',
    location: 'Ranjangaon MIDC, Shirur',
    approvalCode: 'cte',
    submittedOn: '2024-12-09',
    daysLeft: 5,
    status: 'QUERY_RAISED',
  },
  {
    applicationNo: 'MUO/2024/00178',
    enterpriseName: 'Mahindra Heavy Forgings Ltd.',
    location: 'Talegaon Industrial Area',
    approvalCode: 'bldg',
    submittedOn: '2024-12-01',
    daysLeft: -3,
    status: 'DECISION_PENDING',
  },
  {
    applicationNo: 'MUO/2024/00109',
    enterpriseName: 'Bharat Logistics Hub Ltd.',
    location: 'Taloja MIDC, Raigad',
    approvalCode: 'fire',
    submittedOn: '2024-12-05',
    daysLeft: 9,
    status: 'INSPECTION_SCHEDULED',
  },
  {
    applicationNo: 'MUO/2024/00201',
    enterpriseName: 'Zenith Precision Auto Tech',
    location: 'Bhosari Industrial Estate',
    approvalCode: 'ht',
    submittedOn: '2024-12-10',
    daysLeft: 12,
    status: 'UNDER_SCRUTINY',
  },
  {
    applicationNo: 'MUO/2024/00098',
    enterpriseName: 'Kalyani Precision Works',
    location: 'Baramati MIDC Zone',
    approvalCode: 'fact',
    deskName: 'Baramati Branch',
    submittedOn: '2024-12-01',
    dueDate: '2024-12-05',
    daysLeft: null,
    status: 'APPROVED',
  },
];

const ENTERPRISE_NAMES = [
  'Sahaj Engineering Works', 'Shivneri Agro Processing Pvt. Ltd.', 'Konkan Marine Components', 'Vidarbha Steel & Alloys',
  'Godavari Polymers Ltd.', 'Pratham Textile Mills', 'Ashtvinayak Cold Storage', 'Nashik Precision Tools',
  'Krishna Valley Pharma', 'Malhar Packaging Industries', 'Rajgad Electricals Pvt. Ltd.', 'Tulja Food Products',
  'Sinhagad Castings Ltd.', 'Bhima Auto Ancillaries', 'Harihar Chemicals Pvt. Ltd.', 'Mayur Plastics & Moulds',
  'Ajanta Ceramics Ltd.', 'Warna Sugar & Allied', 'Pawana Fabricators', 'Indrayani Wire Products',
  'Kolhapur Foundry Works', 'Solapur Terry Towels Co.', 'Amba Ghat Bottlers', 'Lonavala Cable Systems',
  'Ganga Dairy Foods', 'Jalgaon Banana Chips Co.', 'Satpuda Timber Industries', 'Panchganga Forgings',
  'Bhandara Brass Craft', 'Chandrapur Cement Additives', 'Nagpur Orange Processing Ltd.', 'Latur Oilseeds Mills',
  'Sangli Turmeric Exports', 'Akola Cotton Ginning Co.', 'Wardha Khadi Udyog', 'Dhule Agro Machinery',
  'Ratnagiri Cashew Processors', 'Sindhudurg Aqua Feeds', 'Beed Solar Modules Pvt. Ltd.', 'Parbhani Bio-Fertilizers',
  'Yavatmal Textile Park Unit', 'Osmanabad Steel Rolling', 'Hingoli Turmeric Mills', 'Nanded Precision Castings',
  'Amravati Spinning Mills', 'Buldhana Herbal Extracts', 'Washim Agro Implements', 'Gondia Rice Mill Complex',
  'Palghar Marine Foods', 'Mira-Bhayandar Light Engineering', 'Khopoli Steel Structures', 'Panvel Logistics Park',
  'Ambernath Chemical Zone Unit', 'Ranjangaon Auto Electronics', 'Hinjewadi Micro Fabricators', 'Shendra Aluminium Products',
];

const LOCATIONS = [
  'Chakan Phase-I, Tal. Khed, Pune', 'Ranjangaon MIDC, Shirur', 'Talegaon MIDC, Maval', 'Bhosari MIDC, Pune',
  'Taloja MIDC, Raigad', 'Hinjewadi Phase-III, Pune', 'Shendra MIDC, Chh. Sambhajinagar', 'Ambad MIDC, Nashik',
  'Butibori MIDC, Nagpur', 'Kagal-Hatkanangale MIDC, Kolhapur', 'Baramati MIDC Zone', 'Patalganga MIDC, Raigad',
];

const NIC_CODES = [
  '2819 - Auto Components (Orange)', '1079 - Food Processing (Green)', '2599 - Fabricated Metal (Orange)',
  '2220 - Plastic Products (Orange)', '2100 - Pharmaceuticals (Red)', '1311 - Textile Spinning (Orange)',
  '2710 - Electrical Equipment (Green)', '2011 - Chemicals (Red)',
];

const SIGNATORIES = [
  'Amit Joshi (Director)', 'Neha Kulkarni (MD)', 'Sanjay Pawar (Partner)', 'Kavita Rane (Director)',
  'Rahul Gaikwad (Proprietor)', 'Sneha Thorat (MD)', 'Vikram Mane (Director)', 'Pooja Salunkhe (Partner)',
];

const APPROVAL_CYCLE: OfficerApprovalCode[] = ['fact', 'cte', 'bldg', 'fire', 'ht'];
const STATUS_CYCLE: OfficerDeskStatus[] = ['UNDER_SCRUTINY', 'QUERY_RAISED', 'DECISION_PENDING'];

/**
 * Extra dossiers so the queue totals match Screen 26: 60 active (36 within SLA / 12 approaching /
 * 8 near breach / 4 breached, of which the 5 active reference rows are the first of each group),
 * plus closed dossiers. Every value is derived from the index — nothing is random.
 */
const buildGeneratedSeeds = (): Seed[] => {
  // daysLeft plan for the generated dossiers only
  const plan: number[] = [
    ...[-1, -2, -5], // 3 more breached (reference row supplies the 4th)
    ...Array(7).fill(2), // 7 more near breach (reference row supplies the 8th)
    ...Array.from({ length: 11 }, (_, i) => [3, 4, 5][i % 3]), // 11 more approaching
    ...Array.from({ length: 34 }, (_, i) => 6 + (i % 10)), // 34 more within SLA
  ];
  const seeds: Seed[] = plan.map((daysLeft, i) => {
    const approvalCode = APPROVAL_CYCLE[i % APPROVAL_CYCLE.length];
    const inspectionSlot = i === 25 || i === 41;
    const status: OfficerDeskStatus = inspectionSlot ? 'INSPECTION_SCHEDULED' : STATUS_CYCLE[i % STATUS_CYCLE.length];
    return {
      applicationNo: `MUO/2024/${String(300 + i * 3).padStart(5, '0')}`,
      enterpriseName: ENTERPRISE_NAMES[i % ENTERPRISE_NAMES.length],
      location: LOCATIONS[(i * 5) % LOCATIONS.length],
      approvalCode,
      // Building plan scrutiny alternates between the MIDC SPA section and the Directorate of Industries desk
      deptCode: approvalCode === 'bldg' && i % 2 === 0 ? 'ind' : undefined,
      submittedOn: `2024-12-${String(1 + (i % 12)).padStart(2, '0')}`,
      daysLeft,
      status,
    };
  });
  // Two more closed dossiers
  ['00087', '00092'].forEach((no, i) => {
    seeds.push({
      applicationNo: `MUO/2024/${no}`,
      enterpriseName: ['Pune Rolling Mills Ltd.', 'Ozar Aerospace Fittings'][i],
      location: ['Chakan Phase-I, Tal. Khed, Pune', 'Ambad MIDC, Nashik'][i],
      approvalCode: (['cte', 'ht'] as OfficerApprovalCode[])[i],
      submittedOn: `2024-12-0${2 + i}`,
      daysLeft: null,
      status: 'APPROVED',
    });
  });
  return seeds;
};

const ALL_RECORDS: OfficerQueueRecord[] = [...REFERENCE_SEEDS, ...buildGeneratedSeeds()].map(buildRecord);

// ── Dossier detail generation ───────────────────────────────────────────────────────────

export const formatDisplayDate = (iso: string): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  const day = String(d.getUTCDate()).padStart(2, '0');
  const month = d.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' });
  return `${day} ${month} ${d.getUTCFullYear()}`;
};

const docStatusesFor = (status: OfficerDeskStatus): OfficerDocStatus[] => {
  switch (status) {
    case 'UNDER_SCRUTINY':
      return ['VERIFIED', 'UNDER_VERIFICATION', 'VERIFIED', 'VERIFIED'];
    case 'QUERY_RAISED':
      return ['VERIFIED', 'REJECTED', 'UNDER_VERIFICATION', 'VERIFIED'];
    default:
      return ['VERIFIED', 'VERIFIED', 'VERIFIED', 'VERIFIED'];
  }
};

const buildDocuments = (record: OfficerQueueRecord): OfficerDossierDocument[] => {
  const meta = APPROVALS[record.approvalCode];
  const statuses = docStatusesFor(record.status);
  const submitted = formatDisplayDate(record.submittedOn);
  return meta.docs.map((doc, i) => ({
    id: `${record.applicationNo}-DOC-${i + 1}`,
    title: doc.title,
    subtitle: doc.subtitle,
    submittedOn: submitted,
    status: statuses[i],
    actionLabel: doc.fileType === 'cad' ? 'Inspect (CAD)' : 'View File',
    fileType: doc.fileType,
  }));
};

const OFFICER_QUERY_TEXT: Record<OfficerApprovalCode, string> = {
  fact: 'Please provide the latest certified site layout plan with dimensions of emergency exits, as per the DISH safety checklist.',
  cte: 'Please furnish the detailed effluent characteristics and the treatment scheme for the proposed process, certified by a qualified engineer.',
  bldg: 'Kindly resubmit the structural drawings with the revised setback dimensions as per MIDC DCR Regulation 2018.',
  fire: 'Please upload the vendor-certified fire fighting layout showing hydrant coverage for the storage block.',
  ht: 'Please submit the electrical inspector-approved Single Line Diagram with the proposed 33 kV metering arrangement.',
};

const buildDeshmukhDossier = (record: OfficerQueueRecord): OfficerDossier => {
  const ent = INITIAL_ENTERPRISES.find((e) => e.id === 'ent-dipl-01');
  const project = INITIAL_PROJECTS.find((p) => p.id === 'proj-chk-01');
  const documents = buildDocuments(record).map((d, i) =>
    i === 1 ? { ...d, subtitle: 'Under Review • Scale 1:100' } : d
  );
  const inspection: OfficerInspectionInfo = {
    ref: 'INSP/2024/00045',
    outcomeLabel: 'Scheduled',
    dateLabel: 'Scheduled 18 Dec',
    inspector: 'S. Kulkarni',
    location: 'Chakan Phase II',
    clearances: 'Pending site verification',
    checklist: [
      { item: 'Machinery layout conforms to submitted drawings', result: 'Pending' },
      { item: 'Emergency exit width & marking', result: 'Pending' },
      { item: 'Fire hydrant pressure test', result: 'Pending' },
      { item: 'Ventilation & lighting', result: 'Pending' },
    ],
  };
  const queryThread: OfficerQueryMessage[] = [
    {
      id: 'QRY-001-M1',
      from: 'OFFICER',
      author: 'Officer Inquiry',
      at: '12 Dec 2024, 03:15 PM',
      text: 'Please provide the latest certified site layout plan with clear dimensions of emergency exits and fire safety isolation NOC as per DISH safety checklist.',
    },
    {
      id: 'QRY-001-M2',
      from: 'APPLICANT',
      author: 'Applicant Response • Priya Deshmukh',
      at: '13 Dec 2024, 10:20 AM',
      text: 'Updated site plan and provisional Fire NOC have been uploaded. Annexure-F attached with fire-escape passageway demarcation.',
      attachment: 'Site_Plan_Updated_v2.pdf (4.2 MB)',
    },
  ];
  const auditTrail: OfficerAuditEvent[] = [
    { id: 'A1', at: '12 Dec 2024, 11:15 AM', actor: 'Priya Deshmukh', action: 'Application submitted', detail: 'RTS clock started. Acknowledgement generated.' },
    { id: 'A2', at: '12 Dec 2024, 11:40 AM', actor: 'System', action: 'Allotted to Scrutiny Desk', detail: 'Labour (DISH) — Pune Circle Desk' },
    { id: 'A3', at: '12 Dec 2024, 03:15 PM', actor: 'Scrutiny Officer', action: 'Query QRY-001 raised', detail: 'Certified site layout and Fire NOC requested.' },
    { id: 'A4', at: '13 Dec 2024, 10:20 AM', actor: 'Priya Deshmukh', action: 'Query QRY-001 answered', detail: 'Site_Plan_Updated_v2.pdf uploaded.' },
    { id: 'A5', at: '13 Dec 2024, 02:20 PM', actor: 'System', action: 'Inspection INSP/2024/00045 scheduled', detail: 'Inspector S. Kulkarni • 18 Dec 2024, 11:00 AM IST • Chakan Phase II.' },
  ];
  return {
    applicationNo: record.applicationNo,
    submittedAt: '12 Dec 2024, 11:15 AM',
    enterpriseName: ent?.name ?? record.enterpriseName,
    udyam: ent?.udyamRegistration ?? 'UDYAM-MH-26-0048123',
    signatory: 'Priya Deshmukh (MD)',
    projectSite: project?.name ?? 'Chakan Auto Component Expansion Unit',
    investment: project ? `₹ ${(project.proposedInvestmentCr * 1e7).toLocaleString('en-IN')} (${project.proposedInvestmentCr} Cr)` : '₹ 12,50,00,000 (12.5 Cr)',
    workforce: `${project?.proposedEmployment ?? 140} Workers`,
    address: project ? `${project.location}, District ${project.district} - ${ent?.pincode ?? '410501'}` : 'Plot B-14/1, Chakan MIDC Phase II, Taluka Khed, District Pune - 410501',
    nicCategory: '2819 - Auto Components (Orange)',
    documents,
    queryRef: 'QRY-001',
    queryThread,
    inspection,
    auditTrail,
    defaultDecision: 'approve',
    defaultRemarks:
      'All mandatory documents (MIDC land allotment, building blueprints, provisional fire NOC, and CTE) verified in order. Joint site inspection INSP/2024/00045 by DISH Inspector S. Kulkarni is scheduled for 18 Dec 2024; the inspection report is awaited before the safety distance, ventilation, and machinery fencing norms are confirmed. Recommend grant of Factory Licence under Section 6 of Factories Act 1948, subject to a satisfactory report.',
  };
};

const buildGenericDossier = (record: OfficerQueueRecord, index: number): OfficerDossier => {
  const meta = APPROVALS[record.approvalCode];
  const submittedLabel = `${formatDisplayDate(record.submittedOn)}, ${String(9 + (index % 8)).padStart(2, '0')}:${String((index * 7) % 60).padStart(2, '0')} AM`;
  const investmentCr = 4 + ((index * 3) % 40);
  const workers = 40 + ((index * 17) % 260);
  const signatory = SIGNATORIES[index % SIGNATORIES.length];
  const queryRef = `QRY-${String(100 + index).padStart(3, '0')}`;
  const documents = buildDocuments(record);

  const queryThread: OfficerQueryMessage[] =
    record.status === 'QUERY_RAISED'
      ? [
          {
            id: `${queryRef}-M1`,
            from: 'OFFICER',
            author: 'Officer Inquiry',
            at: `${formatDisplayDate(shiftDate(OFFICER_REFERENCE_TODAY, -1))}, 02:30 PM`,
            text: OFFICER_QUERY_TEXT[record.approvalCode],
          },
        ]
      : [];

  const inspection: OfficerInspectionInfo | null =
    record.status === 'INSPECTION_SCHEDULED'
      ? {
          // MUO/2024/00109 is the Fire NOC inspection on the Inspector desk's schedule (Screen 28): INSP/2024/00047, 20 Dec
          ref: record.applicationNo === 'MUO/2024/00109' ? 'INSP/2024/00047' : `INSP/2024/${String(30 + index).padStart(5, '0')}`,
          outcomeLabel: 'Scheduled',
          dateLabel: record.applicationNo === 'MUO/2024/00109' ? 'Scheduled 20 Dec' : `Scheduled ${formatDisplayDate(shiftDate(OFFICER_REFERENCE_TODAY, 3)).slice(0, 6)}`,
          inspector: 'Field Inspector, Pune Division',
          location: record.location,
          clearances: 'Pending site verification',
          checklist: [
            { item: 'Site boundary & access verification', result: 'Pending' },
            { item: 'Safety systems as per approval type', result: 'Pending' },
            { item: 'Applicant representative present', result: 'Pending' },
          ],
        }
      : null;

  const auditTrail: OfficerAuditEvent[] = [
    { id: 'A1', at: submittedLabel, actor: signatory.split(' (')[0], action: 'Application submitted', detail: 'RTS clock started. Acknowledgement generated.' },
    { id: 'A2', at: submittedLabel, actor: 'System', action: 'Allotted to Scrutiny Desk', detail: `${record.deptName} — ${record.deskName}` },
  ];
  if (queryThread.length > 0) {
    auditTrail.push({ id: 'A3', at: queryThread[0].at, actor: 'Scrutiny Officer', action: `Query ${queryRef} raised`, detail: 'Awaiting applicant response (RTS clock paused).' });
  }
  if (record.status === 'DECISION_PENDING') {
    auditTrail.push({ id: 'A3', at: `${formatDisplayDate(OFFICER_REFERENCE_TODAY)}, 09:30 AM`, actor: 'Scrutiny Officer', action: 'Scrutiny completed', detail: 'Forwarded for Level 2 decision.' });
  }
  if (record.status === 'APPROVED') {
    auditTrail.push({ id: 'A3', at: `${formatDisplayDate(record.dueDate)}, 04:10 PM`, actor: 'Approving Authority', action: 'Approval issued', detail: 'Certificate generated and shared with applicant.' });
  }

  const defaultDecision = record.status === 'QUERY_RAISED' ? ('clarification' as const) : ('approve' as const);
  return {
    applicationNo: record.applicationNo,
    submittedAt: submittedLabel,
    enterpriseName: record.enterpriseName,
    udyam: `UDYAM-MH-26-${String(1000 + index * 137).padStart(7, '0')}`,
    signatory,
    projectSite: `${meta.name} — ${record.location.split(',')[0]} Unit`,
    investment: `₹ ${(investmentCr * 1e7).toLocaleString('en-IN')} (${investmentCr} Cr)`,
    workforce: `${workers} Workers`,
    address: `Plot No. ${String.fromCharCode(65 + (index % 6))}-${10 + ((index * 11) % 90)}, ${record.location}`,
    nicCategory: NIC_CODES[index % NIC_CODES.length],
    documents,
    queryRef,
    queryThread,
    inspection,
    auditTrail,
    defaultDecision,
    defaultRemarks:
      record.status === 'QUERY_RAISED'
        ? 'Clarification sought from the applicant. Scrutiny will resume on receipt of the response and revised documents.'
        : '',
  };
};

const dossierCache = new Map<string, OfficerDossier>();

// ── Public service API ──────────────────────────────────────────────────────────────────

export const officerQueueService = {
  getQueue(): OfficerQueueRecord[] {
    return ALL_RECORDS;
  },

  getRecord(applicationNo: string): OfficerQueueRecord | undefined {
    return ALL_RECORDS.find((r) => r.applicationNo === applicationNo);
  },

  getDossier(applicationNo: string): OfficerDossier | undefined {
    const cached = dossierCache.get(applicationNo);
    if (cached) return cached;
    const index = ALL_RECORDS.findIndex((r) => r.applicationNo === applicationNo);
    if (index < 0) return undefined;
    const record = ALL_RECORDS[index];
    const dossier = applicationNo === DEFAULT_SELECTED_APPLICATION ? buildDeshmukhDossier(record) : buildGenericDossier(record, index);
    dossierCache.set(applicationNo, dossier);
    return dossier;
  },

  getSlaSummary(records: OfficerQueueRecord[] = ALL_RECORDS): OfficerSlaSummary {
    const active = records.filter((r) => r.slaRisk !== 'COMPLIED');
    return {
      withinSla: active.filter((r) => r.slaRisk === 'WITHIN_SLA').length,
      approaching: active.filter((r) => r.slaRisk === 'APPROACHING').length,
      nearBreach: active.filter((r) => r.slaRisk === 'NEAR_BREACH').length,
      breached: active.filter((r) => r.slaRisk === 'BREACHED').length,
      totalActive: active.length,
      inspections: active.filter((r) => r.status === 'INSPECTION_SCHEDULED').length,
    };
  },

  /** SLA urgency: overdue first, then the earliest expiry; closed dossiers last. */
  sortByUrgency(records: OfficerQueueRecord[]): OfficerQueueRecord[] {
    const key = (r: OfficerQueueRecord) => (r.daysLeft === null ? Number.POSITIVE_INFINITY : r.daysLeft);
    return [...records].sort((a, b) => key(a) - key(b));
  },
};

// ── Label / matching helpers shared by the Screen 26 UI ─────────────────────────────────

export const slaFilterMatches = (risk: OfficerSlaRisk, filter: SlaFilterValue): boolean => {
  switch (filter) {
    case 'all':
      return true;
    case 'breached':
      return risk === 'BREACHED';
    case 'near':
      return risk === 'NEAR_BREACH';
    case 'approaching':
      return risk === 'APPROACHING';
    case 'normal':
      return risk === 'WITHIN_SLA' || risk === 'COMPLIED';
  }
};

export const statusFilterMatches = (status: OfficerDeskStatus, filter: StatusFilterValue): boolean => {
  switch (filter) {
    case 'all':
      return status !== 'APPROVED';
    case 'scrutiny':
      return status === 'UNDER_SCRUTINY';
    case 'query':
      return status === 'QUERY_RAISED';
    case 'inspection':
      return status === 'INSPECTION_SCHEDULED';
    case 'decision':
      return status === 'DECISION_PENDING';
    case 'closed':
      return status === 'APPROVED';
  }
};

export const DESK_STATUS_LABEL: Record<OfficerDeskStatus, string> = {
  UNDER_SCRUTINY: 'Under Scrutiny',
  QUERY_RAISED: 'Query Raised',
  INSPECTION_SCHEDULED: 'Inspection Scheduled',
  DECISION_PENDING: 'Decision Pending',
  APPROVED: 'Approved',
};

export const SLA_RISK_LABEL: Record<OfficerSlaRisk, string> = {
  BREACHED: 'Breached',
  NEAR_BREACH: 'Near Breach',
  APPROACHING: 'Approaching',
  WITHIN_SLA: 'Within SLA',
  COMPLIED: 'Complied',
};

export const daysLeftLabel = (daysLeft: number | null): string => {
  if (daysLeft === null) return 'Completed';
  if (daysLeft < 0) return `${daysLeft} Days Overdue`;
  if (daysLeft === 0) return 'Due Today';
  return daysLeft === 1 ? '1 Day Left' : `${daysLeft} Days Left`;
};

/** Parses "01 Dec 2024 - 31 Dec 2024" into ISO bounds; returns null when the text is not a valid range. */
export const parseDateRange = (text: string): { from: string; to: string } | null => {
  const parts = text.split(/\s+-\s+|\s+to\s+/i);
  if (parts.length !== 2) return null;
  const toIso = (s: string): string | null => {
    const d = new Date(`${s.trim()} UTC`);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  };
  const from = toIso(parts[0]);
  const to = toIso(parts[1]);
  return from && to && from <= to ? { from, to } : null;
};

