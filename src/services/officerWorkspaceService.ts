import {
  OfficerApprovalCode,
  OfficerDecision,
  OfficerDossier,
  OfficerQueueRecord,
  OfficerWorkspaceProfile,
} from '../types/officer';
import { INITIAL_ENTERPRISES, INITIAL_PROJECTS } from './applicantService';
import { DEFAULT_SELECTED_APPLICATION, formatDisplayDate } from './officerQueueService';

// Screen 27 reference options for the "Forward To" control on the Decision tab.
export const WORKSPACE_FORWARD_OPTIONS: string[] = [
  'Statutory Approving Authority (Level 2)',
  'Joint Director of Industries (Pune Circle)',
  'Chief Inspector of Factories (Labour Dept)',
];

const APPROVAL_TYPE_LABEL: Record<OfficerApprovalCode, string> = {
  fact: 'Factory Licence (Sec 6)',
  cte: 'Consent to Establish (CTE)',
  bldg: 'Building Plan Approval',
  fire: 'Fire Safety Provisional NOC',
  ht: 'HT Power Connection (33 kV)',
};

const SERVICE_ID: Record<OfficerApprovalCode, string> = {
  fact: 'DISH-FL-2024-RTS',
  cte: 'MPCB-CTE-2024-RTS',
  bldg: 'MIDC-BP-2024-RTS',
  fire: 'MFS-NOC-2024-RTS',
  ht: 'MSEDCL-HT-2024-RTS',
};

const numericSeed = (applicationNo: string): number => parseInt(applicationNo.replace(/\D/g, ''), 10) || 0;
const inr = (n: number): string => n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const hazardFromNic = (nic: string): string => {
  if (nic.includes('(Red)')) return 'Major Hazard (Category A)';
  if (nic.includes('(Green)')) return 'Non-Hazardous (Category C)';
  return 'Non-Major Hazard (Category B)';
};

const profileCache = new Map<string, OfficerWorkspaceProfile>();

/**
 * Screen 27's extra technical/project fields for a dossier. The Deshmukh dossier is built from the same
 * applicant enterprise/project records as the applicant portal; everything else is derived deterministically.
 */
export const getWorkspaceProfile = (record: OfficerQueueRecord, dossier: OfficerDossier): OfficerWorkspaceProfile => {
  const cached = profileCache.get(record.applicationNo);
  if (cached) return cached;

  const seed = numericSeed(record.applicationNo);
  const workers = parseInt(dossier.workforce, 10) || 100;
  const dayShift = Math.round(workers * 0.7);
  const isDeshmukh = record.applicationNo === DEFAULT_SELECTED_APPLICATION;
  const ent = isDeshmukh ? INITIAL_ENTERPRISES.find((e) => e.id === 'ent-dipl-01') : undefined;
  const project = isDeshmukh ? INITIAL_PROJECTS.find((p) => p.id === 'proj-chk-01') : undefined;

  const nic = isDeshmukh ? '2819 - Manufacture of other general-purpose machinery' : dossier.nicCategory;
  const plotMatch = dossier.address.match(/Plot No\. ([A-Z]-\d+)/);
  const totalArea = project ? project.landAreaAcres * 4046.86 : 2000 + ((seed * 97) % 6000);

  const profile: OfficerWorkspaceProfile = {
    applicantName: dossier.signatory.split(' (')[0],
    designation: isDeshmukh ? 'Managing Director' : (dossier.signatory.match(/\((.+)\)/)?.[1] ?? 'Director'),
    constitution: ent ? `${ent.type} Company` : 'Private Limited Company',
    projectName: dossier.projectSite,
    locationLabel: project ? `${project.midcArea}, ${project.district}` : record.location,
    applicationDate: formatDisplayDate(record.submittedOn),
    approvalTypeLabel: APPROVAL_TYPE_LABEL[record.approvalCode],
    competentDepartment: record.deptName,
    commencement: isDeshmukh ? '01 Apr 2025' : `01 ${['Apr', 'May', 'Jun', 'Jul'][seed % 4]} 2025`,
    powerRequirement: `${project ? project.powerDemandKva : 200 + ((seed * 13) % 800)} KVA (MSEDCL)`,
    activityCode: nic,
    installedHp: `${isDeshmukh ? 350 : 120 + ((seed * 35) % 400)} HP`,
    maxWorkers: `${workers} (Day: ${dayShift}, Night: ${workers - dayShift})`,
    hazardClass: hazardFromNic(nic),
    plots: [
      {
        plotNo: project ? 'Plot B-14/1' : `Plot ${plotMatch?.[1] ?? 'C-24'}`,
        industrialArea: project?.midcArea ?? record.location.split(',')[0],
        totalArea: inr(totalArea),
        builtUpArea: inr(Math.round(totalArea * 0.51)),
        survey: isDeshmukh ? 'Survey 88/2A' : `Survey ${10 + (seed % 80)}/${'ABC'[seed % 3]}`,
      },
    ],
    serviceId: SERVICE_ID[record.approvalCode],
    statutoryDeadline: formatDisplayDate(record.dueDate),
  };
  profileCache.set(record.applicationNo, profile);
  return profile;
};

/** Blocking rules for "Submit Recommendation"; returns an error message or null when the action may proceed. */
export const validateRecommendation = (input: {
  decision: OfficerDecision;
  comments: string;
  verifiedDocs: number;
  totalDocs: number;
  rejectedDocs: number;
  awaitingApplicant: boolean;
}): string | null => {
  if (!input.comments.trim()) return 'Comments are mandatory — enter the scrutiny notes and justification.';
  if (input.decision === 'approve') {
    if (input.rejectedDocs > 0) return `Cannot recommend approval: ${input.rejectedDocs} document(s) are rejected and need resubmission.`;
    if (input.verifiedDocs < input.totalDocs) return `Cannot recommend approval: ${input.totalDocs - input.verifiedDocs} of ${input.totalDocs} statutory documents are not verified yet.`;
    if (input.awaitingApplicant) return 'Cannot recommend approval while a query is awaiting the applicant\'s response.';
  }
  return null;
};
