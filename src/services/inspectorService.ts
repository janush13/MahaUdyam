import {
  ApprovalKind,
  ChecklistEntry,
  ChecklistResult,
  ChecklistTemplateItem,
  EvidenceFile,
  InspectionFinding,
  InspectionOutcome,
  InspectionRecord,
  InspectionReport,
  InspectorAuditEvent,
} from '../types/inspector';
import { formatDisplayDate, officerQueueService } from './officerQueueService';

// ── Reference constants (Screen 28) ─────────────────────────────────────────────────────

/** The inspector desk "today" on Screen 28: the last sync is 18 Dec 2024, 11:42 AM IST. */
export const INSPECTOR_TODAY_ISO = '2024-12-18';
export const INSPECTOR_LAST_SYNC = '18 Dec 2024, 11:42 AM IST';
export const DEFAULT_INSPECTION_ID = 'INSP/2024/00045';
export const INSPECTION_FORM_NO = 'DISH/PUN/2024/R1';
export const INSPECTOR_PAGE_SIZE = 5;
export const MAX_OBSERVATION_CHARS = 2000;

export const RESCHEDULE_TIME_OPTIONS = ['10:00 AM', '11:00 AM', '11:30 AM', '02:00 PM', '03:00 PM', '04:00 PM'];

export const SAMPLE_EVIDENCE: EvidenceFile[] = [
  { name: 'Site_Rear_Boundary_Geotagged.jpg', sizeLabel: '2.4 MB' },
  { name: 'Emergency_Exit_Width_Measure.jpg', sizeLabel: '3.0 MB' },
  { name: 'Machinery_Guarding_Bay2.jpg', sizeLabel: '2.6 MB' },
];

// ── Checklists per approval kind ────────────────────────────────────────────────────────

const CHECKLISTS: Record<ApprovalKind, ChecklistTemplateItem[]> = {
  fact: [
    { id: 'c1', label: 'Machinery layout conforms to submitted drawings', requirement: 'Layout matches the sanctioned site plan' },
    { id: 'c2', label: 'Emergency exit width & marking', requirement: 'Secondary exit width 1.8 m for a high-occupancy workshop bay' },
    { id: 'c3', label: 'Fire hydrant pressure test', requirement: 'Residual pressure available at the hydrant point' },
    { id: 'c4', label: 'Ventilation & lighting', requirement: 'Ventilation shafts operational; adequate lighting' },
    { id: 'c5', label: 'Machinery fencing & guarding', requirement: 'Dangerous parts securely fenced' },
    { id: 'c6', label: 'First-aid & safety signage', requirement: 'First-aid box and statutory notices displayed' },
  ],
  cte: [
    { id: 'c1', label: 'Site boundary & layout as per consent application', requirement: 'Plant layout matches the submitted plan' },
    { id: 'c2', label: 'Effluent treatment plant readiness', requirement: 'ETP capacity as declared' },
    { id: 'c3', label: 'Stack / emission point provisions', requirement: 'Sampling ports and stack height provided' },
    { id: 'c4', label: 'Hazardous waste storage area', requirement: 'Designated, covered storage area' },
    { id: 'c5', label: 'Green belt provision', requirement: 'Green belt as committed in the application' },
  ],
  fire: [
    { id: 'c1', label: 'Fire fighting system as per approved layout', requirement: 'Hydrants and sprinklers installed as drawn' },
    { id: 'c2', label: 'Fire hydrant pressure test', requirement: 'Adequate residual pressure at test point' },
    { id: 'c3', label: 'Extinguishers & fire alarm', requirement: 'Serviceable and within inspection date' },
    { id: 'c4', label: 'Emergency exits & escape routes', requirement: 'Unobstructed, marked and lit' },
    { id: 'c5', label: 'Storage & hazard segregation', requirement: 'Combustibles segregated as declared' },
  ],
  ht: [
    { id: 'c1', label: 'Single line diagram matches installation', requirement: 'Installed equipment conforms to the SLD' },
    { id: 'c2', label: 'Earthing system', requirement: 'Earth resistance within limits' },
    { id: 'c3', label: 'Protection & metering arrangement', requirement: 'Relays and metering as approved' },
    { id: 'c4', label: 'Clearances & safety distances', requirement: 'Statutory clearances maintained' },
    { id: 'c5', label: 'Fire extinguishers in substation', requirement: 'CO2 / DCP extinguishers available' },
  ],
  bldg: [
    { id: 'c1', label: 'Construction as per sanctioned plan', requirement: 'Built-up area and setbacks per sanction' },
    { id: 'c2', label: 'Structural elements', requirement: 'Structure matches certified drawings' },
    { id: 'c3', label: 'Fire escape & staircase provisions', requirement: 'Escape staircase dimensions as sanctioned' },
    { id: 'c4', label: 'Parking & internal roads', requirement: 'As per the approved layout' },
    { id: 'c5', label: 'Rainwater harvesting & drainage', requirement: 'Provided as per regulation' },
  ],
};

// ── Seed data ───────────────────────────────────────────────────────────────────────────

interface Seed {
  n: string;
  applicationNo: string;
  kind: ApprovalKind;
  approvalType: string;
  approvalFull: string;
  enterprise: string;
  project: string;
  scheduledOn: string;
  scheduledTime: string;
  locationShort: string;
  address: string;
  status: InspectionRecord['status'];
  representative: string;
}

const APPROVAL_FULL: Record<ApprovalKind, string> = {
  fact: 'Factory Licence (Sec 6, Factories Act 1948)',
  cte: 'Consent to Establish (Water & Air Pollution Control Acts)',
  fire: 'Fire Safety Provisional NOC (Maharashtra Fire Prevention Act)',
  ht: 'HT Power Connection 33 kV (Electricity Act, 2003)',
  bldg: 'Building Plan Approval (MIDC DCR Regulation 2018)',
};

const link = (applicationNo: string) => {
  const record = officerQueueService.getRecord(applicationNo);
  const dossier = officerQueueService.getDossier(applicationNo);
  return record && dossier ? { record, dossier } : null;
};

const buildUpcomingSeeds = (): Seed[] => {
  const deshmukh = link('MUO/2024/000123');
  const bharat = link('MUO/2024/00109');
  const zenith = link('MUO/2024/00201');
  return [
    {
      n: '00045', applicationNo: 'MUO/2024/000123', kind: 'fact', approvalType: 'Factory Licence', approvalFull: APPROVAL_FULL.fact,
      enterprise: deshmukh?.dossier.enterpriseName ?? 'Deshmukh Industries Pvt. Ltd.',
      project: deshmukh?.dossier.projectSite ?? 'Chakan Auto Component Expansion Unit',
      scheduledOn: '2024-12-18', scheduledTime: '11:00 AM', locationShort: 'Pune (MIDC Chakan)',
      address: deshmukh?.dossier.address ?? 'Plot B-14/1, Chakan MIDC Phase II, Taluka Khed, District Pune - 410501',
      status: 'SCHEDULED', representative: (deshmukh?.dossier.signatory ?? 'Priya Deshmukh (MD)').replace(/ \((.+)\)/, ', $1'),
    },
    {
      n: '00046', applicationNo: 'MUO/2024/00156', kind: 'cte', approvalType: 'CTE (Consent to Establish)', approvalFull: APPROVAL_FULL.cte,
      enterprise: 'Vaishnavi Chemicals Pvt. Ltd.', project: 'Specialty Chemicals Blending Unit',
      scheduledOn: '2024-12-19', scheduledTime: '02:00 PM', locationShort: 'Chakan Phase-I',
      address: 'Plot No. D-27, Chakan MIDC Phase I, Taluka Khed, District Pune - 410501',
      status: 'SCHEDULED', representative: 'Anil Kadam, Director',
    },
    {
      n: '00047', applicationNo: 'MUO/2024/00109', kind: 'fire', approvalType: 'Fire NOC Verification', approvalFull: APPROVAL_FULL.fire,
      enterprise: bharat?.record.enterpriseName ?? 'Bharat Logistics Hub Ltd.',
      project: 'Warehousing & Logistics Hub',
      scheduledOn: '2024-12-20', scheduledTime: '11:30 AM', locationShort: 'Taloja MIDC',
      address: `Plot No. L-8, ${bharat?.record.location ?? 'Taloja MIDC, Raigad'}`,
      status: 'SCHEDULED', representative: (bharat?.dossier.signatory ?? 'Rahul Gaikwad (Proprietor)').replace(/ \((.+)\)/, ', $1'),
    },
    {
      n: '00048', applicationNo: 'MUO/2024/00201', kind: 'ht', approvalType: 'Power Connection Safety', approvalFull: APPROVAL_FULL.ht,
      enterprise: zenith?.record.enterpriseName ?? 'Zenith Precision Auto Tech',
      project: 'Precision Machining Facility',
      scheduledOn: '2024-12-21', scheduledTime: '11:00 AM', locationShort: 'Bhosari',
      address: `Gat No. 41, ${zenith?.record.location ?? 'Bhosari Industrial Estate'}, Pune`,
      status: 'SCHEDULED', representative: (zenith?.dossier.signatory ?? 'Sneha Thorat (MD)').replace(/ \((.+)\)/, ', $1'),
    },
    {
      n: '00052', applicationNo: 'MUO/2024/00210', kind: 'bldg', approvalType: 'Building Plan Compliance', approvalFull: APPROVAL_FULL.bldg,
      enterprise: 'Pune Alloy Castings Ltd.', project: 'Foundry Shed Extension',
      scheduledOn: '2024-12-23', scheduledTime: '03:00 PM', locationShort: 'Pune II',
      address: 'Plot No. F-63, Talegaon MIDC, Taluka Maval, District Pune - 410507',
      status: 'SCHEDULED', representative: 'Vikram Mane, Director',
    },
  ];
};

const KINDS: ApprovalKind[] = ['fact', 'cte', 'fire', 'ht', 'bldg'];
const KIND_SHORT: Record<ApprovalKind, string> = {
  fact: 'Factory Licence', cte: 'CTE (Consent to Establish)', fire: 'Fire NOC Verification', ht: 'Power Connection Safety', bldg: 'Building Plan Compliance',
};

const COMPLETED_ROWS: Array<[string, string, string, string]> = [
  ['00030', 'MUO/2024/00087', 'Pune Rolling Mills Ltd.', 'Chakan Phase-I'],
  ['00031', 'MUO/2024/00092', 'Ozar Aerospace Fittings', 'Ambad'],
  ['00032', 'MUO/2024/00098', 'Kalyani Precision Works', 'Baramati'],
  ['00033', 'MUO/2024/00101', 'Shivneri Cold Chain Pvt. Ltd.', 'Ranjangaon'],
  ['00035', 'MUO/2024/00114', 'Bhima Auto Ancillaries', 'Bhosari'],
  ['00036', 'MUO/2024/00118', 'Malhar Packaging Industries', 'Pimpri'],
  ['00038', 'MUO/2024/00127', 'Sinhagad Castings Ltd.', 'Talegaon'],
  ['00040', 'MUO/2024/00131', 'Indrayani Wire Products', 'Chakan Phase-II'],
];

const buildOtherSeeds = (): Seed[] => {
  const completed: Seed[] = COMPLETED_ROWS.map(([n, app, enterprise, loc], i) => ({
    n, applicationNo: app, kind: KINDS[i % 5], approvalType: KIND_SHORT[KINDS[i % 5]], approvalFull: APPROVAL_FULL[KINDS[i % 5]],
    enterprise, project: `${enterprise.split(' ')[0]} Manufacturing Unit`,
    scheduledOn: `2024-12-${String(2 + i).padStart(2, '0')}`, scheduledTime: i % 2 === 0 ? '11:00 AM' : '02:30 PM',
    locationShort: loc, address: `Plot No. ${'ABCDEFGH'[i]}-${20 + i * 7}, ${loc} Industrial Area, District Pune`,
    status: 'COMPLETED', representative: 'Authorised Signatory',
  }));
  const rescheduled: Seed[] = [
    {
      n: '00050', applicationNo: 'MUO/2024/00133', kind: 'bldg', approvalType: KIND_SHORT.bldg, approvalFull: APPROVAL_FULL.bldg,
      enterprise: 'Nashik Precision Tools', project: 'Tool Room Extension', scheduledOn: '2024-12-24', scheduledTime: '11:00 AM',
      locationShort: 'Pimpri', address: 'Plot No. K-12, Pimpri-Chinchwad MIDC, Pune', status: 'RESCHEDULED', representative: 'Sanjay Pawar, Partner',
    },
    {
      n: '00051', applicationNo: 'MUO/2024/00139', kind: 'fire', approvalType: KIND_SHORT.fire, approvalFull: APPROVAL_FULL.fire,
      enterprise: 'Konkan Marine Components', project: 'Marine Fittings Plant', scheduledOn: '2024-12-26', scheduledTime: '02:00 PM',
      locationShort: 'Talegaon', address: 'Plot No. M-31, Talegaon MIDC, Taluka Maval, District Pune', status: 'RESCHEDULED', representative: 'Kavita Rane, Director',
    },
  ];
  return [...completed, ...rescheduled];
};

const toRecord = (s: Seed): InspectionRecord => ({
  id: `INSP/2024/${s.n}`,
  applicationNo: s.applicationNo,
  kind: s.kind,
  approvalType: s.approvalType,
  approvalFull: s.approvalFull,
  enterprise: s.enterprise,
  project: s.project,
  scheduledOn: s.scheduledOn,
  scheduledTime: s.scheduledTime,
  locationShort: s.locationShort,
  address: s.address,
  status: s.status,
  representative: s.representative,
  formNo: INSPECTION_FORM_NO,
  checklist: CHECKLISTS[s.kind],
  linkedToOfficerQueue: !!officerQueueService.getRecord(s.applicationNo),
});

const INSPECTIONS: InspectionRecord[] = [...buildUpcomingSeeds(), ...buildOtherSeeds()].map(toRecord);

// ── Reports & audit seeds ───────────────────────────────────────────────────────────────

const emptyChecklist = (items: ChecklistTemplateItem[]): Record<string, ChecklistEntry> =>
  Object.fromEntries(items.map((i) => [i.id, { result: 'PENDING' as ChecklistResult, remark: '' }]));

/** The Screen 28 in-progress report for INSP/2024/00045, pre-filled exactly as the reference shows it. */
const buildDefaultReport = (rec: InspectionRecord): InspectionReport => {
  const checklist = emptyChecklist(rec.checklist);
  checklist.c1 = { result: 'COMPLIANT', remark: 'Layout conforms to the submitted drawings.' };
  checklist.c2 = { result: 'NON_COMPLIANT', remark: 'Measured 1.2 m against 1.8 m required.' };
  checklist.c3 = { result: 'COMPLIANT', remark: 'Passed at 7.2 bar.' };
  checklist.c4 = { result: 'COMPLIANT', remark: 'Ventilation shafts operational.' };
  const finding: InspectionFinding = {
    id: 'F1',
    description: 'Secondary emergency exit width is 1.2 m against 1.8 m required for the high-occupancy workshop bay.',
    severity: 'Major',
    correctiveAction: 'Widen the secondary exit to 1.8 m and furnish geotagged photographs of the corrected exit.',
    timeLimit: '15 days',
  };
  return {
    outcome: 'partially-compliant',
    observations: `Physical site inspection conducted at ${rec.address.split(',').slice(0, 2).join(',')} on 18 Dec 2024 in presence of factory manager. Machinery layout conforms to submitted drawings. Discrepancy observed in secondary emergency exit width (1.2m vs 1.8m required for high-occupancy workshop bay). Fire hydrant pressure test passed at 7.2 bar. Ventilation shafts operational.`,
    checklist,
    findings: [finding],
    evidence: [
      { name: 'Site_Front_Entry_Geotagged.jpg', sizeLabel: '3.2 MB' },
      { name: 'Hydrant_Pressure_Gauge.jpg', sizeLabel: '2.8 MB' },
    ],
    supportingDoc: null,
    status: 'IN_PROGRESS',
    savedAt: null,
    submittedAt: null,
    submissionRef: null,
  };
};

const submissionRefFor = (rec: InspectionRecord) => `RPT/2024/${rec.id.split('/').pop()}`;

const buildSubmittedReport = (rec: InspectionRecord, index: number): InspectionReport => {
  const outcome: InspectionOutcome = index % 3 === 1 ? 'partially-compliant' : 'compliant';
  const checklist = Object.fromEntries(
    rec.checklist.map((c, i) => [c.id, { result: (outcome === 'partially-compliant' && i === 1 ? 'NON_COMPLIANT' : 'COMPLIANT') as ChecklistResult, remark: '' }])
  );
  return {
    outcome,
    observations:
      outcome === 'compliant'
        ? 'Site inspected in presence of the authorised representative. All checklist items found in order.'
        : 'Site inspected in presence of the authorised representative. One item requires corrective action as recorded in the findings.',
    checklist,
    findings:
      outcome === 'partially-compliant'
        ? [{ id: 'F1', description: `${rec.checklist[1].label}: non-conformity noted.`, severity: 'Minor', correctiveAction: 'Rectify and confirm through the portal.', timeLimit: '30 days' }]
        : [],
    evidence: [{ name: `Site_Photo_${rec.id.split('/').pop()}_A.jpg`, sizeLabel: '2.9 MB' }, { name: `Site_Photo_${rec.id.split('/').pop()}_B.jpg`, sizeLabel: '3.1 MB' }],
    supportingDoc: null,
    status: 'SUBMITTED',
    savedAt: null,
    submittedAt: `${formatDisplayDate(rec.scheduledOn)}, 05:30 PM IST`,
    submissionRef: submissionRefFor(rec),
  };
};

const buildEmptyReport = (rec: InspectionRecord): InspectionReport => ({
  outcome: '',
  observations: '',
  checklist: emptyChecklist(rec.checklist),
  findings: [],
  evidence: [],
  supportingDoc: null,
  status: 'NOT_STARTED',
  savedAt: null,
  submittedAt: null,
  submissionRef: null,
});

export const inspectorService = {
  getInspections(): InspectionRecord[] {
    return INSPECTIONS;
  },

  getInspection(id: string): InspectionRecord | undefined {
    return INSPECTIONS.find((i) => i.id === id);
  },

  /** Resolves a route segment such as "00046" (or the URL-encoded full number) to an inspection id. */
  resolveRouteId(segment: string): string | null {
    let decoded = segment;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      // keep the raw segment
    }
    return INSPECTIONS.find((i) => i.id === decoded || i.id.endsWith(`/${decoded}`))?.id ?? null;
  },

  routeFor(id: string): string {
    return `/inspector/inspections/${id.split('/').pop()}`;
  },

  buildInitialReport(rec: InspectionRecord): InspectionReport {
    if (rec.id === DEFAULT_INSPECTION_ID) return buildDefaultReport(rec);
    if (rec.status === 'COMPLETED') return buildSubmittedReport(rec, INSPECTIONS.indexOf(rec));
    return buildEmptyReport(rec);
  },

  buildBaseAudit(rec: InspectionRecord): InspectorAuditEvent[] {
    const events: InspectorAuditEvent[] = [
      { id: 'B1', at: '13 Dec 2024, 02:15 PM', actor: 'Scrutiny Officer', action: 'Joint inspection requested', detail: `Application ${rec.applicationNo} — ${rec.approvalFull}` },
      { id: 'B2', at: '13 Dec 2024, 02:20 PM', actor: 'System', action: `Inspection ${rec.id} assigned to inspector`, detail: `Scheduled for ${formatDisplayDate(rec.scheduledOn)}, ${rec.scheduledTime} IST` },
    ];
    if (rec.status === 'COMPLETED') {
      events.push({ id: 'B3', at: `${formatDisplayDate(rec.scheduledOn)}, 05:30 PM IST`, actor: 'Inspector', action: 'Statutory report submitted', detail: submissionRefFor(rec) });
    }
    if (rec.status === 'RESCHEDULED') {
      events.push({ id: 'B3', at: '17 Dec 2024, 04:00 PM IST', actor: 'Inspector', action: 'Inspection rescheduled', detail: 'Applicant representative unavailable on the original date.' });
    }
    return events;
  },

  submissionRefFor,

  counts(records: InspectionRecord[]) {
    return {
      upcoming: records.filter((r) => r.status === 'SCHEDULED').length,
      completed: records.filter((r) => r.status === 'COMPLETED').length,
      rescheduled: records.filter((r) => r.status === 'RESCHEDULED').length,
    };
  },
};

// ── Report helpers ──────────────────────────────────────────────────────────────────────

export const CHECKLIST_LABEL: Record<ChecklistResult, string> = {
  PENDING: 'Pending',
  COMPLIANT: 'Compliant',
  NON_COMPLIANT: 'Non-Compliant',
  NOT_APPLICABLE: 'Not Applicable',
};

export const OUTCOME_LABEL: Record<InspectionOutcome, string> = {
  compliant: 'Compliant',
  'non-compliant': 'Non-Compliant',
  'partially-compliant': 'Partially Compliant',
};

export const hasReportContent = (r: InspectionReport): boolean =>
  !!r.outcome || r.observations.trim().length > 0 || r.evidence.length > 0 || r.findings.length > 0 || Object.values(r.checklist).some((c) => c.result !== 'PENDING');

/** Blocking rules for "Submit Statutory Report". Returns one message per problem (empty = ready to submit). */
export const validateReport = (rec: InspectionRecord, report: InspectionReport): string[] => {
  const errors: string[] = [];
  if (!report.outcome) errors.push('Select the Inspection Outcome.');
  if (!report.observations.trim()) errors.push('Enter the Observations & Statutory Remarks.');
  if (report.evidence.length === 0) errors.push('Upload at least one Evidence Photo (geotagged JPG/PNG).');
  const pending = rec.checklist.filter((c) => report.checklist[c.id]?.result === 'PENDING');
  if (pending.length > 0) errors.push(`Record a result for every checklist item — ${pending.length} pending (${pending.map((p) => p.label).join('; ')}).`);
  const nonCompliant = rec.checklist.filter((c) => report.checklist[c.id]?.result === 'NON_COMPLIANT').length;
  if (report.outcome === 'compliant' && nonCompliant > 0) errors.push(`Outcome “Compliant” conflicts with ${nonCompliant} Non-Compliant checklist item(s).`);
  if (report.outcome && report.outcome !== 'compliant' && nonCompliant === 0) errors.push(`Outcome “${OUTCOME_LABEL[report.outcome]}” requires at least one Non-Compliant checklist item.`);
  if ((report.outcome === 'partially-compliant' || report.outcome === 'non-compliant') && report.findings.length === 0) errors.push('Add at least one finding (Findings tab) describing the non-compliance.');
  return errors;
};
