import {
  ApplicantProfile,
  Enterprise,
  EnterpriseProject,
  Representative,
  ApplicantApplication,
  PortalActivity,
} from '../types/applicant';

const STORAGE_PROFILE_KEY = 'mahaudyam_applicant_profile';
const STORAGE_ENTERPRISES_KEY = 'mahaudyam_applicant_enterprises';
const STORAGE_PROJECTS_KEY = 'mahaudyam_applicant_projects';
const STORAGE_REPRESENTATIVES_KEY = 'mahaudyam_applicant_representatives';

// 1. Initial Prototype Applicant Profile
export const INITIAL_APPLICANT_PROFILE: ApplicantProfile = {
  id: 'USR-MH-2026-08140',
  name: 'Priya Deshmukh',
  designation: 'Managing Director & Authorized Signatory',
  email: 'applicant@mahaudyam.in',
  mobile: '9823012345',
  singleBusinessId: 'MH-SWS-2026-08140',
  kycStatus: 'VERIFIED',
  aadhaarNumberMasked: 'XXXX-XXXX-4819',
  panNumber: 'AAACD5120K',
  address: {
    line1: 'Deshmukh Tower, Sector 4, Baner Business Park',
    city: 'Pune',
    district: 'Pune',
    state: 'Maharashtra',
    pincode: '411045',
  },
  notifications: {
    smsAlerts: true,
    emailAlerts: true,
    whatsappUpdates: true,
    slaWarningDays: 3,
  },
  security: {
    twoFactorEnabled: true,
    lastLogin: 'Today, 09:14 AM (IST) from Pune, MH',
    activeSessionsCount: 1,
  },
};

// 2. Initial Reference Enterprises
export const INITIAL_ENTERPRISES: Enterprise[] = [
  {
    id: 'ent-dipl-01',
    name: 'Deshmukh Industries Pvt. Ltd.',
    type: 'Private Limited',
    category: 'Medium',
    cinOrLlpin: 'U28112PN2015PTC154892',
    udyamRegistration: 'UDYAM-MH-26-0048123',
    gstin: '27AABCD1234E1Z5',
    pan: 'AABCD1234E',
    registeredAddress: 'Plot No. B-14, Chakan MIDC Phase II, Taluka Khed',
    district: 'Pune',
    state: 'Maharashtra',
    pincode: '410501',
    turnoverCr: 48.5,
    capitalInvestmentCr: 22.8,
    status: 'Active',
    incorporationDate: '14 May 2015',
    isPrimary: true,
    projectsCount: 3,
  },
  {
    id: 'ent-dabv-02',
    name: 'Deshmukh Agro Bio-Ventures LLP',
    type: 'LLP',
    category: 'Small',
    cinOrLlpin: 'LLPIN: AAB-4921',
    udyamRegistration: 'UDYAM-MH-26-0079144',
    gstin: '27AAEFD5678J1Z2',
    pan: 'AAEFD5678J',
    registeredAddress: 'Gat No. 118, Paithan Road, Shendra MIDC',
    district: 'Chhatrapati Sambhajinagar',
    state: 'Maharashtra',
    pincode: '431007',
    turnoverCr: 14.2,
    capitalInvestmentCr: 8.5,
    status: 'Active',
    incorporationDate: '22 August 2021',
    isPrimary: false,
    projectsCount: 1,
  },
];

// 3. Initial Reference Industrial Projects (Tethered to Enterprise)
export const INITIAL_PROJECTS: EnterpriseProject[] = [
  {
    id: 'proj-chk-01',
    enterpriseId: 'ent-dipl-01',
    name: 'Chakan Auto Component Expansion Unit',
    sector: 'Automobile Components & Advanced Engineering',
    district: 'Pune',
    location: 'Plot B-14/1, Chakan MIDC Phase II, Taluka Khed',
    midcArea: 'Chakan MIDC Phase II',
    proposedInvestmentCr: 12.5,
    proposedEmployment: 140,
    landAreaAcres: 4.5,
    powerDemandKva: 1250,
    waterDemandKld: 50,
    status: 'In Setup',
    commencementExpected: 'December 2026',
    createdAt: '2026-01-15T10:00:00Z',
    description: 'High precision transmission gear forging and CNC automated machining facility.',
  },
  {
    id: 'proj-supa-02',
    enterpriseId: 'ent-dipl-01',
    name: 'Supa Heavy Forging Plant',
    sector: 'Heavy Metallurgical & Die Casting',
    district: 'Ahmednagar',
    location: 'Plot 42, Supa Parner Industrial Area',
    midcArea: 'Supa MIDC',
    proposedInvestmentCr: 8.2,
    proposedEmployment: 85,
    landAreaAcres: 3.2,
    powerDemandKva: 800,
    waterDemandKld: 25,
    status: 'Proposed',
    commencementExpected: 'March 2027',
    createdAt: '2026-02-10T14:30:00Z',
    description: 'Specialized closed die heavy drop forging unit for commercial vehicular chassis components.',
  },
  {
    id: 'proj-bho-03',
    enterpriseId: 'ent-dipl-01',
    name: 'Bhosari Tool Room',
    sector: 'Precision Tooling, Dies & Moulds',
    district: 'Pune',
    location: 'W-88, MIDC Industrial Area Bhosari',
    midcArea: 'Bhosari MIDC',
    proposedInvestmentCr: 2.1,
    proposedEmployment: 30,
    landAreaAcres: 0.8,
    powerDemandKva: 250,
    waterDemandKld: 10,
    status: 'Operational',
    commencementExpected: 'Operational since 2018',
    createdAt: '2025-11-01T09:00:00Z',
    description: 'Tool and die maintenance facility serving automotive original equipment manufacturers.',
  },
  {
    id: 'proj-aur-04',
    enterpriseId: 'ent-dabv-02',
    name: 'Aurangabad Bio-Energy Plant',
    sector: 'Bio-Fuels, Pelletization & Renewable Energy',
    district: 'Chhatrapati Sambhajinagar',
    location: 'Plot C-5, Shendra Industrial Park',
    midcArea: 'Shendra MIDC',
    proposedInvestmentCr: 8.5,
    proposedEmployment: 65,
    landAreaAcres: 5.0,
    powerDemandKva: 650,
    waterDemandKld: 35,
    status: 'In Setup',
    commencementExpected: 'January 2027',
    createdAt: '2026-02-20T11:15:00Z',
    description: 'Agro-waste briquetting and compressed bio-gas (CBG) generation unit utilizing regional cane bagasse.',
  },
];

// 4. Initial Reference Representatives & Consultants
export const INITIAL_REPRESENTATIVES: Representative[] = [
  {
    id: 'rep-01',
    name: 'Advocate Rajeshwar Kulkarni',
    role: 'Legal Counsel & Statutory Compliance Advisor',
    organization: 'Kulkarni & Associates Legal Chambers, Pune',
    email: 'adv.kulkarni@lawchambers.co.in',
    mobile: '9822187654',
    delegationScope: 'Corporate Statutory Clearances, Factory Registrations & Disputed Hearing Representation',
    delegatedPowers: [
      'Draft & Sign Statutory Clearance Applications',
      'Submit Regulatory Filings to DISH & Labour Dept',
      'Appear Before Appellate Authority & Single Window Council',
    ],
    authorizationRef: 'Board Resolution DIPL/BR/2026/04',
    validUntil: '31 March 2027',
    status: 'Active',
    assignedEnterpriseIds: ['ent-dipl-01', 'ent-dabv-02'],
  },
  {
    id: 'rep-02',
    name: 'Dr. Sneha Kulkarni-Patil',
    role: 'Environmental Auditor & Green Consultant',
    organization: 'EnviroTech Green Solutions LLP, Navi Mumbai',
    email: 'sneha.patil@envirotech.org',
    mobile: '9819234567',
    delegationScope: 'MPCB Consents (CTE/CTO), Hazardous Waste Authorizations & Environmental Statements',
    delegatedPowers: [
      'Prepare Environmental Impact & Adequacy Reports',
      'Upload Air & Water Pollution Monitoring Statements',
      'Submit Form 1 & Form 2 Applications on MPCB IMIS',
    ],
    authorizationRef: 'Power of Attorney Reg. No. MH-PUN-2025-9921',
    validUntil: '31 December 2026',
    status: 'Active',
    assignedEnterpriseIds: ['ent-dipl-01'],
  },
  {
    id: 'rep-03',
    name: 'CA Nitin Mahajan',
    role: 'Chartered Accountant & Fiscal Incentives Advisor',
    organization: 'Mahajan & Phadke Chartered Accountants, Pune',
    email: 'nitin@mp-ca.in',
    mobile: '9850112233',
    delegationScope: 'Package Scheme of Incentives (PSI 2019) Claims, Capital Subsidy & GST Refund Filings',
    delegatedPowers: [
      'Certify Fixed Capital Investment (FCI) Statements',
      'Upload Statutory Audit & Valuation Certificates',
      'Track Directorate of Industries Subsidy Sanctions',
    ],
    authorizationRef: 'Board Resolution DIPL/BR/2025/11',
    validUntil: '30 September 2026',
    status: 'Active',
    assignedEnterpriseIds: ['ent-dipl-01', 'ent-dabv-02'],
  },
];

// 5. Initial Reference Applications
export const INITIAL_APPLICATIONS: ApplicantApplication[] = [
  {
    id: 'app-cte-2026-001',
    appRefNumber: 'SW/MPCB/2026/10842',
    approvalName: 'Consent to Establish (CTE - Orange Category)',
    department: 'Maharashtra Pollution Control Board (MPCB)',
    enterpriseId: 'ent-dipl-01',
    enterpriseName: 'Deshmukh Industries Pvt. Ltd.',
    projectId: 'proj-chk-01',
    projectName: 'Chakan Auto Component Expansion Unit',
    stage: 'Pre-Establishment',
    status: 'Under Scrutiny',
    submittedDate: '12 Feb 2026',
    slaTargetDate: '14 Mar 2026',
    slaDaysRemaining: 18,
    slaTotalDays: 30,
    currentOfficer: 'Sub-Regional Officer (Pune II)',
  },
  {
    id: 'app-ht-2026-002',
    appRefNumber: 'SW/MSEDCL/2026/04912',
    approvalName: 'High Tension Industrial Power Connection (1250 kVA)',
    department: 'MSEDCL (Maharashtra State Electricity Distribution Co.)',
    enterpriseId: 'ent-dipl-01',
    enterpriseName: 'Deshmukh Industries Pvt. Ltd.',
    projectId: 'proj-chk-01',
    projectName: 'Chakan Auto Component Expansion Unit',
    stage: 'Pre-Establishment',
    status: 'Approved',
    submittedDate: '18 Jan 2026',
    slaTargetDate: '17 Feb 2026',
    slaDaysRemaining: 0,
    slaTotalDays: 30,
    currentOfficer: 'Executive Engineer (Chakan Circle)',
  },
  {
    id: 'app-fact-2026-003',
    appRefNumber: 'SW/DISH/2026/02981',
    approvalName: 'Factory Building Plan Approval & Sanction',
    department: 'Directorate of Industrial Safety and Health (DISH)',
    enterpriseId: 'ent-dipl-01',
    enterpriseName: 'Deshmukh Industries Pvt. Ltd.',
    projectId: 'proj-chk-01',
    projectName: 'Chakan Auto Component Expansion Unit',
    stage: 'Pre-Establishment',
    status: 'Query Raised',
    submittedDate: '24 Jan 2026',
    slaTargetDate: '23 Feb 2026',
    slaDaysRemaining: 4,
    slaTotalDays: 30,
    currentOfficer: 'Joint Director (Safety Inspection)',
  },
  {
    id: 'app-fire-2026-004',
    appRefNumber: 'SW/FIRE/2026/01140',
    approvalName: 'Provisional Fire Safety No Objection Certificate (NOC)',
    department: 'Maharashtra Fire Services / MIDC Fire Brigade',
    enterpriseId: 'ent-dipl-01',
    enterpriseName: 'Deshmukh Industries Pvt. Ltd.',
    projectId: 'proj-chk-01',
    projectName: 'Chakan Auto Component Expansion Unit',
    stage: 'Pre-Establishment',
    status: 'Under Scrutiny',
    submittedDate: '01 Feb 2026',
    slaTargetDate: '03 Mar 2026',
    slaDaysRemaining: 12,
    slaTotalDays: 30,
    currentOfficer: 'Chief Fire Officer (MIDC Pune Zone)',
  },
  {
    id: 'app-water-2026-005',
    appRefNumber: 'SW/MIDC/2026/08821',
    approvalName: 'Industrial Water Connection Sanction (50 KLD)',
    department: 'Maharashtra Industrial Development Corporation (MIDC)',
    enterpriseId: 'ent-dipl-01',
    enterpriseName: 'Deshmukh Industries Pvt. Ltd.',
    projectId: 'proj-chk-01',
    projectName: 'Chakan Auto Component Expansion Unit',
    stage: 'Pre-Establishment',
    status: 'Approved',
    submittedDate: '10 Jan 2026',
    slaTargetDate: '25 Jan 2026',
    slaDaysRemaining: 0,
    slaTotalDays: 15,
    currentOfficer: 'Deputy Engineer (Water Works, Chakan)',
  },
  {
    id: 'app-na-2026-006',
    appRefNumber: 'SW/REV/2026/00388',
    approvalName: 'Non-Agricultural (NA Industrial) Zone Sanction',
    department: 'Revenue & Forest Department / District Collector',
    enterpriseId: 'ent-dipl-01',
    enterpriseName: 'Deshmukh Industries Pvt. Ltd.',
    projectId: 'proj-supa-02',
    projectName: 'Supa Heavy Forging Plant',
    stage: 'Pre-Establishment',
    status: 'Under Scrutiny',
    submittedDate: '15 Feb 2026',
    slaTargetDate: '31 Mar 2026',
    slaDaysRemaining: 32,
    slaTotalDays: 45,
    currentOfficer: 'Sub-Divisional Magistrate (Parner)',
  },
  {
    id: 'app-boiler-2026-007',
    appRefNumber: 'SW/BOILER/2026/00049',
    approvalName: 'Annual Boiler Economizer Inspection Certificate',
    department: 'Directorate of Steam Boilers',
    enterpriseId: 'ent-dipl-01',
    enterpriseName: 'Deshmukh Industries Pvt. Ltd.',
    projectId: 'proj-bho-03',
    projectName: 'Bhosari Tool Room',
    stage: 'Pre-Operation',
    status: 'Approved',
    submittedDate: '05 Jan 2026',
    slaTargetDate: '20 Jan 2026',
    slaDaysRemaining: 0,
    slaTotalDays: 15,
    currentOfficer: 'Inspector of Steam Boilers (Pune)',
  },
];

// 6. Initial Reference Activities
export const INITIAL_PORTAL_ACTIVITIES: PortalActivity[] = [
  {
    id: 'act-01',
    title: 'Departmental Clarification Notice Dispatched',
    description: 'DISH raised a technical observation regarding stairwell fire egress width on Building Plan (SW/DISH/2026/02981).',
    timestamp: 'Today, 11:42 AM',
    type: 'QUERY',
    refNumber: 'SW/DISH/2026/02981',
  },
  {
    id: 'act-02',
    title: 'Pre-Scrutiny Verification Approved',
    description: 'MPCB Sub-Regional Officer marked technical scrutiny complete for Chakan CTE (SW/MPCB/2026/10842).',
    timestamp: 'Yesterday, 04:15 PM',
    type: 'SUBMISSION',
    refNumber: 'SW/MPCB/2026/10842',
  },
  {
    id: 'act-03',
    title: 'Digital Sanction Order Issued',
    description: 'Executive Engineer MSEDCL generated digitally signed HT Connection Sanction Letter (SW/MSEDCL/2026/04912).',
    timestamp: '17 Feb 2026, 02:30 PM',
    type: 'APPROVAL',
    refNumber: 'SW/MSEDCL/2026/04912',
  },
  {
    id: 'act-04',
    title: 'Field Verification Scheduled',
    description: 'MIDC Fire Department assigned Station Officer for site layout verification on 26 Feb 2026.',
    timestamp: '14 Feb 2026, 10:20 AM',
    type: 'INSPECTION',
    refNumber: 'SW/FIRE/2026/01140',
  },
  {
    id: 'act-05',
    title: 'Representative Authorization Recorded',
    description: 'Adv. Rajeshwar Kulkarni confirmed authorization for statutory clearance hearings under Board Resolution DIPL/BR/2026/04.',
    timestamp: '08 Feb 2026, 03:55 PM',
    type: 'SECURITY',
    refNumber: 'BR/2026/04',
  },
];

class ApplicantService {
  private profile: ApplicantProfile;
  private enterprises: Enterprise[];
  private projects: EnterpriseProject[];
  private representatives: Representative[];
  private applications: ApplicantApplication[];
  private activities: PortalActivity[];

  constructor() {
    this.profile = this.loadFromStorage(STORAGE_PROFILE_KEY, INITIAL_APPLICANT_PROFILE);
    this.enterprises = this.loadFromStorage(STORAGE_ENTERPRISES_KEY, INITIAL_ENTERPRISES);
    this.projects = this.loadFromStorage(STORAGE_PROJECTS_KEY, INITIAL_PROJECTS);
    this.representatives = this.loadFromStorage(STORAGE_REPRESENTATIVES_KEY, INITIAL_REPRESENTATIVES);
    this.applications = INITIAL_APPLICATIONS;
    this.activities = INITIAL_PORTAL_ACTIVITIES;
  }

  private loadFromStorage<T>(key: string, defaultVal: T): T {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const stored = window.localStorage.getItem(key);
        if (stored) return JSON.parse(stored);
      }
    } catch {
      // ignore
    }
    return defaultVal;
  }

  private saveToStorage<T>(key: string, val: T): void {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(key, JSON.stringify(val));
      }
    } catch {
      // ignore
    }
  }

  // --- Profile Methods ---
  public getProfile(): ApplicantProfile {
    return { ...this.profile };
  }

  public updateProfile(updated: Partial<ApplicantProfile>): ApplicantProfile {
    this.profile = {
      ...this.profile,
      ...updated,
      address: {
        ...this.profile.address,
        ...(updated.address || {}),
      },
      notifications: {
        ...this.profile.notifications,
        ...(updated.notifications || {}),
      },
      security: {
        ...this.profile.security,
        ...(updated.security || {}),
      },
    };
    this.saveToStorage(STORAGE_PROFILE_KEY, this.profile);
    return { ...this.profile };
  }

  public resetProfile(): ApplicantProfile {
    this.profile = { ...INITIAL_APPLICANT_PROFILE };
    this.saveToStorage(STORAGE_PROFILE_KEY, this.profile);
    return { ...this.profile };
  }

  // --- Enterprises Methods ---
  public getEnterprises(): Enterprise[] {
    return [...this.enterprises];
  }

  public getEnterpriseById(id: string): Enterprise | undefined {
    return this.enterprises.find((e) => e.id === id);
  }

  public getPrimaryEnterprise(): Enterprise {
    return this.enterprises.find((e) => e.isPrimary) || this.enterprises[0];
  }

  public getActiveEnterprise(): Enterprise {
    return this.getPrimaryEnterprise();
  }

  // --- Projects Methods ---
  public getProjects(): EnterpriseProject[] {
    return [...this.projects];
  }

  public getActiveProject(): EnterpriseProject {
    return this.projects[0];
  }

  public getProjectsByEnterprise(enterpriseId: string): EnterpriseProject[] {
    return this.projects.filter((p) => p.enterpriseId === enterpriseId);
  }

  public getProjectById(id: string): EnterpriseProject | undefined {
    return this.projects.find((p) => p.id === id);
  }

  public addProject(
    data: Omit<EnterpriseProject, 'id' | 'createdAt'>
  ): EnterpriseProject {
    const newProj: EnterpriseProject = {
      ...data,
      id: `proj-${Date.now().toString(36)}`,
      createdAt: new Date().toISOString(),
    };
    this.projects = [newProj, ...this.projects];
    this.saveToStorage(STORAGE_PROJECTS_KEY, this.projects);

    // Update projectsCount on parent enterprise
    this.enterprises = this.enterprises.map((ent) => {
      if (ent.id === newProj.enterpriseId) {
        return {
          ...ent,
          projectsCount: (ent.projectsCount || 0) + 1,
        };
      }
      return ent;
    });
    this.saveToStorage(STORAGE_ENTERPRISES_KEY, this.enterprises);

    // Log Activity
    this.addActivity({
      title: 'New Industrial Project Registered',
      description: `${newProj.name} created under ${this.getEnterpriseById(newProj.enterpriseId)?.name || 'Enterprise'}.`,
      type: 'SUBMISSION',
      refNumber: newProj.id,
    });

    return newProj;
  }

  public updateProject(id: string, data: Partial<EnterpriseProject>): EnterpriseProject | undefined {
    const idx = this.projects.findIndex((p) => p.id === id);
    if (idx === -1) return undefined;
    this.projects[idx] = { ...this.projects[idx], ...data };
    this.saveToStorage(STORAGE_PROJECTS_KEY, this.projects);
    return this.projects[idx];
  }

  public deleteProject(id: string): boolean {
    const target = this.projects.find((p) => p.id === id);
    if (!target) return false;
    this.projects = this.projects.filter((p) => p.id !== id);
    this.saveToStorage(STORAGE_PROJECTS_KEY, this.projects);

    this.enterprises = this.enterprises.map((ent) => {
      if (ent.id === target.enterpriseId && ent.projectsCount) {
        return {
          ...ent,
          projectsCount: Math.max(0, ent.projectsCount - 1),
        };
      }
      return ent;
    });
    this.saveToStorage(STORAGE_ENTERPRISES_KEY, this.enterprises);
    return true;
  }

  // --- Representatives Methods ---
  public getRepresentatives(): Representative[] {
    return [...this.representatives];
  }

  public addRepresentative(
    repData: Omit<Representative, 'id'>
  ): Representative {
    const newRep: Representative = {
      ...repData,
      id: `rep-${Date.now().toString(36)}`,
    };
    this.representatives = [newRep, ...this.representatives];
    this.saveToStorage(STORAGE_REPRESENTATIVES_KEY, this.representatives);

    this.addActivity({
      title: 'Representative Authorized',
      description: `Delegation granted to ${newRep.name} (${newRep.role}).`,
      type: 'SECURITY',
      refNumber: newRep.authorizationRef,
    });

    return newRep;
  }

  public updateRepresentative(id: string, data: Partial<Representative>): Representative | undefined {
    const idx = this.representatives.findIndex((r) => r.id === id);
    if (idx === -1) return undefined;
    this.representatives[idx] = { ...this.representatives[idx], ...data };
    this.saveToStorage(STORAGE_REPRESENTATIVES_KEY, this.representatives);
    return this.representatives[idx];
  }

  public toggleRepresentativeStatus(id: string): Representative | undefined {
    const rep = this.representatives.find((r) => r.id === id);
    if (!rep) return undefined;
    const nextStatus = rep.status === 'Active' ? 'Suspended' : 'Active';
    return this.updateRepresentative(id, { status: nextStatus });
  }

  public revokeRepresentative(id: string): boolean {
    const rep = this.representatives.find((r) => r.id === id);
    if (!rep) return false;
    this.updateRepresentative(id, { status: 'Revoked' });
    this.addActivity({
      title: 'Representative Power Revoked',
      description: `Delegation for ${rep.name} has been revoked by applicant.`,
      type: 'SECURITY',
      refNumber: rep.authorizationRef,
    });
    return true;
  }

  // --- Applications & KPIs ---
  public getApplications(): ApplicantApplication[] {
    return [...this.applications];
  }

  public getDashboardKPIs() {
    return {
      totalApplications: 7,
      underScrutiny: 3,
      approvedIssued: 3,
      clarificationsRequired: 1,
    };
  }

  public getActivities(): PortalActivity[] {
    return [...this.activities];
  }

  public addActivity(act: Omit<PortalActivity, 'id' | 'timestamp'>): void {
    const newAct: PortalActivity = {
      ...act,
      id: `act-${Date.now().toString(36)}`,
      timestamp: 'Just now',
    };
    this.activities = [newAct, ...this.activities];
  }
}

export const applicantService = new ApplicantService();
