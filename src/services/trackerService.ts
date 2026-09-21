import {
  DepartmentDossier,
  SLATimelineStage,
  ApplicationQuery,
  ApplicationInspection,
  TrackerSummaryMetrics,
  ApplicantClarificationSubmission,
} from '../types/tracker';
import { applicationService } from './applicationService';
import { applicantService } from './applicantService';
import { documentVaultService } from './documentVaultService';
import { ApprovalApplication } from '../types/application';

const QUERIES_STORAGE_KEY = 'mahaudyam_tracker_queries';
const INSPECTIONS_STORAGE_KEY = 'mahaudyam_tracker_inspections';

class TrackerService {
  private queries: ApplicationQuery[] = [];
  private inspections: ApplicationInspection[] = [];

  constructor() {
    this.initQueries();
    this.initInspections();
  }

  private initQueries(): void {
    const saved = localStorage.getItem(QUERIES_STORAGE_KEY);
    if (saved) {
      try {
        this.queries = JSON.parse(saved);
        return;
      } catch (e) {
        console.error('Failed to parse saved queries', e);
      }
    }

    this.queries = [
      {
        id: 'QRY-2026-041',
        applicationId: 'app-fact-2026-003',
        applicationNumber: 'SW/DISH/2026/02981',
        department: 'Directorate of Industrial Safety and Health (DISH)',
        serviceName: 'Factory Building Plan Approval & Sanction',
        officerName: 'Er. Rajesh V. Patil',
        officerDesignation: 'Joint Director (Safety Inspection & Plan Scrutiny)',
        subject: 'Discrepancy in Static Fire Water Storage Tank Capacity & Hydrant Isometric Diagram',
        description:
          'During technical engineering scrutiny of your submitted factory drawings for Plot B-14/1, Chakan MIDC Phase II, it was observed that the indicated underground static fire water reservoir provides 150,000 litres capacity. Under Maharashtra Factories Rules, 1963 (Rule 65-B) read with National Building Code 2016 Part 4 (Table 7), automotive forging and component fabrication facilities with plot area > 4 Acres require a dedicated minimum static water storage capacity of 200,000 litres. Furthermore, the hydrant ring main isometric diagram lacks flow calculation nodes for the eastern assembly bay.',
        statutoryReference: 'Rule 65-B, Maharashtra Factories Rules 1963 & NBC 2016 Part IV Table 7',
        raisedAt: '16 Feb 2026, 11:30 AM IST',
        dueDate: '23 Feb 2026',
        daysRemaining: 4,
        status: 'Open',
        requestedDeliverables: [
          {
            id: 'del-01',
            requirement: 'Revised static fire water storage tank capacity calculation',
            explanation:
              'Submit stamped hydraulic sizing calculations demonstrating minimum 200,000 Litres effective suction storage dedicated exclusively to fire fighting.',
            mandatory: true,
            requiredDocumentType: 'Hydraulic & Tank Capacity Calculation Sheet',
            status: 'Pending',
          },
          {
            id: 'del-02',
            requirement: 'Updated hydrant ring main isometric engineering diagram',
            explanation:
              'Updated 1:100 scale isometric drawing showing hydrant landing valves, ring main loop diameter (minimum 150mm MS Class C), and node pressures.',
            mandatory: true,
            requiredDocumentType: 'Engineering Isometric Drawing (DWG/PDF)',
            status: 'Pending',
          },
          {
            id: 'del-03',
            requirement: 'Supporting structural stability declaration for underground tank',
            explanation:
              'Chartered structural engineer certificate confirming foundation soil bearing capacity for revised 200 KL RCC reservoir.',
            mandatory: false,
            requiredDocumentType: 'Structural Stability Certificate',
            status: 'Pending',
          },
        ],
        activityLog: [
          {
            id: 'act-q-01',
            timestamp: '16 Feb 2026, 11:30 AM',
            actor: 'Er. Rajesh V. Patil (Joint Director, DISH)',
            action: 'Query Raised',
            note: 'Technical scrutiny flagged fire reservoir sizing shortfall and incomplete hydrant loop diagram.',
          },
          {
            id: 'act-q-02',
            timestamp: '16 Feb 2026, 11:35 AM',
            actor: 'Single Window Notification Engine',
            action: 'Notice Dispatched',
            note: 'Formal clarification notice transmitted via Portal, Email & SMS to authorized signatory Priya Deshmukh.',
          },
        ],
      },
    ];
    this.persistQueries();
  }

  private initInspections(): void {
    const saved = localStorage.getItem(INSPECTIONS_STORAGE_KEY);
    if (saved) {
      try {
        this.inspections = JSON.parse(saved);
        return;
      } catch (e) {
        console.error('Failed to parse saved inspections', e);
      }
    }

    this.inspections = [
      {
        id: 'INS-2026-0814',
        applicationId: 'app-fire-2026-004',
        applicationNumber: 'SW/FIRE/2026/01140',
        department: 'Maharashtra Fire Services & DISH Joint Inspection Cell',
        inspectionType: 'Joint Statutory Physical Site Inspection',
        scheduledDate: '28 Feb 2026',
        scheduledTime: '10:30 AM - 01:00 PM IST',
        location: 'Plot B-14/1, Chakan MIDC Phase II, Taluka Khed, District Pune (PIN: 410501)',
        inspectingOfficers: [
          {
            name: 'Shri Anand M. Shinde',
            designation: 'Chief Fire Officer',
            department: 'MIDC Fire Brigade (Pune Zone)',
            phone: '+91 20 2747 4411',
          },
          {
            name: 'Er. S. B. Kulkarni',
            designation: 'Deputy Director of Industrial Safety',
            department: 'DISH Maharashtra',
            phone: '+91 20 2553 7120',
          },
        ],
        status: 'Scheduled',
        purpose:
          'Verification of site boundary setbacks, 6m wide peripheral fire vehicular driveway, water supply source proximity, hazardous material storage zones, and spatial layout compliance prior to grant of Final Fire Safety NOC and Factory Sanction.',
        preparationChecklist: [
          {
            id: 'prep-01',
            item: 'Factory building layout blueprints approved by DISH available at site in physical print (A1 Size)',
            mandatory: true,
            ready: true,
            notes: 'Printed 3 sets signed by certified architect.',
          },
          {
            id: 'prep-02',
            item: 'Structural Safety Engineer / Site In-Charge present in person during the inspection window',
            mandatory: true,
            ready: true,
            notes: 'Er. Sandeep Joshi confirmed attendance.',
          },
          {
            id: 'prep-03',
            item: '6-metre unobstructed peripheral internal driveway cleared of construction debris and materials',
            mandatory: true,
            ready: false,
            notes: 'Grading work on North-East corridor scheduled for 27 Feb.',
          },
          {
            id: 'prep-04',
            item: 'Water storage reservoir foundation pit demarcated with safety barricades',
            mandatory: true,
            ready: false,
            notes: 'Excavation perimeter barricading in progress.',
          },
          {
            id: 'prep-05',
            item: 'Personal Protective Equipment (PPE: Helmets, High-Vis Vests, Safety Shoes) for 4 visiting officers',
            mandatory: false,
            ready: true,
            notes: 'Safety kit stationed at security gate.',
          },
        ],
        documentsToKeepReady: [
          'Original MIDC Plot Possession Receipt & Demarcation Certificate',
          'MIDC Water Supply Sanction Letter (50 KLD)',
          'CPCB / MPCB Consent to Establish (CTE) Application Dossier & Receipt',
          'Licensed Architect Site Plan & Elevation Drawings with North Line Marking',
          'Electrical Substation & DG Set Layout Plan (1250 kVA)',
        ],
        applicantInstructions:
          'The applicant or an authorized representative (holding statutory Power of Attorney / Board Resolution) must accompany the inspection committee. Digital photography will be conducted. Ensure full gate access and key personnel are stationed at the main security office by 10:00 AM.',
        timeline: [
          {
            date: '10 Feb 2026',
            title: 'Joint Inspection Initiated',
            description: 'Scrutiny officer recommended physical site inspection for high-hazard forging unit.',
            status: 'completed',
          },
          {
            date: '14 Feb 2026',
            title: 'Notice of Inspection Issued',
            description: 'Statutory Inspection Call Letter ref. MFS/PUN/2026/INS-0814 issued to applicant.',
            status: 'completed',
          },
          {
            date: '28 Feb 2026',
            title: 'Physical Site Inspection',
            description: 'Joint on-ground verification by MIDC Fire Brigade and DISH officers.',
            status: 'current',
          },
          {
            date: '03 Mar 2026',
            title: 'Inspection Scrutiny Report Submission',
            description: 'Officers upload Geo-tagged inspection report to Single Window portal.',
            status: 'upcoming',
          },
        ],
      },
    ];
    this.persistInspections();
  }

  private persistQueries(): void {
    localStorage.setItem(QUERIES_STORAGE_KEY, JSON.stringify(this.queries));
  }

  private persistInspections(): void {
    localStorage.setItem(INSPECTIONS_STORAGE_KEY, JSON.stringify(this.inspections));
  }

  /**
   * Returns all connected department dossiers for the active enterprise and project.
   * Seamlessly synthesizes the live Phase 6 CTE application state!
   */
  public getDepartmentDossiers(): DepartmentDossier[] {
    const cteApp = applicationService.getOrCreateDraftApplication();
    const isSubmitted = cteApp.status === 'Submitted' || cteApp.status === 'Under Scrutiny';

    const dossiers: DepartmentDossier[] = [
      {
        id: 'dos-mpcb-01',
        department: 'Maharashtra Pollution Control Board (MPCB)',
        departmentShort: 'MPCB',
        serviceName: 'Consent to Establish (CTE - Orange Category)',
        serviceCode: 'MPCB-CTE',
        applicationNumber: cteApp.applicationNumber,
        currentStage: isSubmitted ? 'Department Scrutiny (SRO Pune II)' : 'Draft Application Incomplete',
        status: isSubmitted ? 'Under Scrutiny' : 'Draft',
        slaTargetDays: 30,
        slaDaysElapsed: isSubmitted ? 4 : 0,
        slaDueDate: isSubmitted
          ? new Date(Date.now() + 26 * 24 * 60 * 60 * 1000).toLocaleDateString('en-IN', {
              day: '2-digit',
              month: 'short',
              year: 'numeric',
            })
          : '30 days upon submission',
        submittedDate: isSubmitted ? (cteApp.submittedAt ? new Date(cteApp.submittedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '15 Feb 2026') : 'Not Submitted',
        lastAction: isSubmitted ? 'Application submitted via Single Window portal' : 'Project parameters and document linking saved as draft',
        lastActionTimestamp: cteApp.updatedAt,
        applicantActionRequired: !isSubmitted,
        actionType: !isSubmitted ? 'NONE' : 'NONE',
        actionText: !isSubmitted ? 'Complete CTE Application' : undefined,
        dependencies: ['MIDC Land Allotment', 'Company Incorporation'],
        nodalOfficer: {
          name: 'Shri V. R. Thakur',
          designation: 'Sub-Regional Officer (Pune II)',
          office: 'Jog Center, 3rd Floor, Mumbai-Pune Road, Wakdewadi, Pune',
        },
        isCTE: true,
      },
      {
        id: 'dos-dish-02',
        department: 'Directorate of Industrial Safety and Health (DISH)',
        departmentShort: 'DISH',
        serviceName: 'Factory Building Plan Approval & Sanction',
        serviceCode: 'DISH-BP',
        applicationNumber: 'SW/DISH/2026/02981',
        currentStage: 'Technical Clarification / Scrutiny Query Pending',
        status: 'Query Raised',
        slaTargetDays: 30,
        slaDaysElapsed: 26,
        slaDueDate: '23 Feb 2026',
        submittedDate: '24 Jan 2026',
        lastAction: 'Department raised formal technical query regarding static water tank capacity & hydrant loop',
        lastActionTimestamp: '16 Feb 2026, 11:30 AM',
        applicantActionRequired: true,
        actionType: 'QUERY',
        actionText: 'Respond to Technical Query QRY-2026-041',
        dependencies: ['Architectural Elevation Blueprints', 'Fire NOC'],
        nodalOfficer: {
          name: 'Er. Rajesh V. Patil',
          designation: 'Joint Director (Safety Inspection)',
          office: 'Kamgar Bhavan, Shivajinagar, Pune',
        },
      },
      {
        id: 'dos-msedcl-03',
        department: 'Maharashtra State Electricity Distribution Co. (MSEDCL)',
        departmentShort: 'MSEDCL',
        serviceName: 'High Tension Industrial Power Connection (1250 kVA)',
        serviceCode: 'MSEDCL-HT',
        applicationNumber: 'SW/MSEDCL/2026/04912',
        currentStage: 'Demand Note Paid & Sanction Order Issued',
        status: 'Approved',
        slaTargetDays: 30,
        slaDaysElapsed: 28,
        slaDueDate: '17 Feb 2026',
        submittedDate: '18 Jan 2026',
        lastAction: 'Sanction letter MSEDCL/PUN/HT-4912 issued with feeder line allotment',
        lastActionTimestamp: '15 Feb 2026',
        applicantActionRequired: false,
        dependencies: ['MIDC Possession', 'Load Test Calculation'],
        nodalOfficer: {
          name: 'Er. M. K. Deshpande',
          designation: 'Superintending Engineer (HT Circle)',
          office: 'MSEDCL Bhosari Circle, Pune',
        },
      },
      {
        id: 'dos-fire-04',
        department: 'Maharashtra Fire Services / MIDC Fire Brigade',
        departmentShort: 'Fire Services',
        serviceName: 'Provisional Fire Safety No Objection Certificate (NOC)',
        serviceCode: 'MIDC-FIRE',
        applicationNumber: 'SW/FIRE/2026/01140',
        currentStage: 'Joint Physical Site Inspection Scheduled',
        status: 'Inspection Scheduled',
        slaTargetDays: 30,
        slaDaysElapsed: 18,
        slaDueDate: '03 Mar 2026',
        submittedDate: '01 Feb 2026',
        lastAction: 'Inspection Call Letter INS-2026-0814 issued for 28 Feb 2026',
        lastActionTimestamp: '14 Feb 2026',
        applicantActionRequired: true,
        actionType: 'INSPECTION',
        actionText: 'Prepare for Site Inspection on 28 Feb',
        dependencies: ['Water Supply Sanction', 'Building Plan'],
        nodalOfficer: {
          name: 'Shri Anand M. Shinde',
          designation: 'Chief Fire Officer',
          office: 'MIDC Fire Station, Chakan Phase II',
        },
      },
      {
        id: 'dos-midc-05',
        department: 'Maharashtra Industrial Development Corporation (MIDC)',
        departmentShort: 'MIDC',
        serviceName: 'Industrial Water Connection Sanction (50 KLD)',
        serviceCode: 'MIDC-WTR',
        applicationNumber: 'SW/MIDC/2026/08821',
        currentStage: 'Water Line Connection Sanctioned & Meter Issued',
        status: 'Approved',
        slaTargetDays: 15,
        slaDaysElapsed: 14,
        slaDueDate: '25 Jan 2026',
        submittedDate: '10 Jan 2026',
        lastAction: 'Connection agreement executed and tapping point marked',
        lastActionTimestamp: '24 Jan 2026',
        applicantActionRequired: false,
        dependencies: ['Plot Possession'],
        nodalOfficer: {
          name: 'Er. P. G. Kadam',
          designation: 'Deputy Engineer (Water Works)',
          office: 'MIDC Regional Office, Chakan',
        },
      },
      {
        id: 'dos-rev-06',
        department: 'Revenue & Forest Department / District Collectorate',
        departmentShort: 'Revenue',
        serviceName: 'Non-Agricultural (NA Industrial) Zone Sanction',
        serviceCode: 'REV-NA',
        applicationNumber: 'SW/REV/2026/00388',
        currentStage: 'Deemed NA Industrial Zone Validated (MIDC Declared Area)',
        status: 'Approved',
        slaTargetDays: 21,
        slaDaysElapsed: 12,
        slaDueDate: '28 Dec 2025',
        submittedDate: '05 Dec 2025',
        lastAction: 'MIDC Statutory Gazette Notification deemed NA certification attached',
        lastActionTimestamp: '18 Dec 2025',
        applicantActionRequired: false,
        dependencies: ['7/12 Extract', 'MIDC Acquisition Award'],
        nodalOfficer: {
          name: 'Shri S. V. More',
          designation: 'Sub-Divisional Officer (Khed Division)',
          office: 'Collector Office, Pune',
        },
      },
    ];

    return dossiers;
  }

  /**
   * Returns SLA timeline stages for an application
   */
  public getSlaTimeline(applicationNumber?: string): SLATimelineStage[] {
    const cteApp = applicationService.getOrCreateDraftApplication();
    const isCte = !applicationNumber || applicationNumber === cteApp.applicationNumber || applicationNumber.includes('MPCB');
    const isSubmitted = cteApp.status === 'Submitted' || cteApp.status === 'Under Scrutiny';

    if (isCte) {
      return [
        {
          stageId: 'stg-01',
          stageName: 'Application Submission & Digital Acknowledgement',
          department: 'Maharashtra Single Window Clearance Portal',
          date: isSubmitted ? (cteApp.submittedAt ? new Date(cteApp.submittedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '15 Feb 2026') : 'Pending Submission',
          status: isSubmitted ? 'completed' : 'current',
          elapsedOrRemaining: isSubmitted ? 'Completed (Day 0)' : 'Awaiting Applicant Action',
          description: isSubmitted
            ? `Application successfully submitted by Priya Deshmukh. Formal digital acknowledgement receipt generated.`
            : 'Application draft in progress. Siting parameters and statutory documents required.',
          responsibleOfficer: 'Automated Single Window Gateway',
          remarks: isSubmitted ? `Receipt Ref: ${cteApp.submissionMetadata.submissionReceiptNumber || 'REC-MPCB-2026-91823'}` : undefined,
        },
        {
          stageId: 'stg-02',
          stageName: 'Statutory Fee Verification & Receipt Generation',
          department: 'MPCB Accounts Division (Pune II)',
          date: isSubmitted ? '16 Feb 2026' : 'Upcoming',
          status: isSubmitted ? 'completed' : 'upcoming',
          elapsedOrRemaining: isSubmitted ? 'Completed (Day 1)' : 'Pending',
          description: 'Gross Fixed Capital Investment verification. Scrutiny fee of ₹25,000 reconciled against MahaE-Seva treasury.',
          responsibleOfficer: 'Accounts Officer, MPCB Pune',
        },
        {
          stageId: 'stg-03',
          stageName: 'Desk Scrutiny & Technical Document Validation',
          department: 'Sub-Regional Office, Pune II (MPCB)',
          date: isSubmitted ? '18 Feb 2026' : 'Upcoming',
          status: isSubmitted ? 'current' : 'upcoming',
          elapsedOrRemaining: isSubmitted ? 'In Progress (Day 4 of 30)' : 'Upcoming',
          description:
            'Officer scrutiny of water balance sheet (50 KLD), trade effluent treatment plan (12.5 KLD connected to CETP Chakan), air emission chimney heights, and DigiLocker certificates.',
          responsibleOfficer: 'Shri V. R. Thakur (Sub-Regional Officer)',
          remarks: 'Initial review found all 7 mandatory statutory certificates valid and verified.',
        },
        {
          stageId: 'stg-04',
          stageName: 'Clarifications / Technical Queries (If Raised)',
          department: 'MPCB Technical Committee',
          date: 'Target: 25 Feb 2026',
          status: 'upcoming',
          elapsedOrRemaining: 'Window: 7 statutory days',
          description:
            'If the Scrutiny Officer requires additional emissions data or fuel certification, a single consolidated query will be issued through the portal.',
          responsibleOfficer: 'Regional Officer (Pune Division)',
        },
        {
          stageId: 'stg-05',
          stageName: 'Consent Committee Decision & Order Issuance',
          department: 'Maharashtra Pollution Control Board (HQ / Regional Office)',
          date: 'Target: 17 Mar 2026',
          status: 'upcoming',
          elapsedOrRemaining: 'SLA Limit: 30 Days Total',
          description:
            'Final appraisal by the Consent Committee. Generation of digital Consent to Establish (CTE) order signed via e-Sign with QR-coded authenticity seal.',
          responsibleOfficer: 'Member Secretary / Regional Officer, MPCB',
        },
      ];
    }

    // Default SLA timeline for DISH Factory Building Plan
    return [
      {
        stageId: 'stg-dish-01',
        stageName: 'Factory Plan Submission & Fee Payment',
        department: 'DISH Maharashtra',
        date: '24 Jan 2026',
        status: 'completed',
        elapsedOrRemaining: 'Completed (Day 0)',
        description: 'Submission of building layout plan and machinery layout for Chakan expansion.',
        responsibleOfficer: 'Single Window Gateway',
      },
      {
        stageId: 'stg-dish-02',
        stageName: 'Engineering Scrutiny & Safety Validation',
        department: 'DISH Safety Inspection Cell',
        date: '05 Feb 2026',
        status: 'completed',
        elapsedOrRemaining: 'Completed (Day 12)',
        description: 'Verification of floor load capacity, emergency exits, and ventilation provisions.',
        responsibleOfficer: 'Er. Rajesh V. Patil (Joint Director)',
      },
      {
        stageId: 'stg-dish-03',
        stageName: 'Statutory Query Raised (Fire Storage & Hydrant)',
        department: 'DISH Plan Scrutiny Cell',
        date: '16 Feb 2026',
        status: 'action_required',
        elapsedOrRemaining: '4 days remaining to reply',
        description: 'Discrepancy identified in static water reservoir capacity (150 KL vs 200 KL required).',
        responsibleOfficer: 'Er. Rajesh V. Patil (Joint Director)',
        applicantActionText: 'Submit revised tank sizing calculations and updated isometric drawing',
      },
      {
        stageId: 'stg-dish-04',
        stageName: 'Joint Physical Site Inspection',
        department: 'DISH & MIDC Fire Brigade',
        date: 'Scheduled: 28 Feb 2026',
        status: 'upcoming',
        elapsedOrRemaining: 'Upcoming',
        description: 'On-site verification of setback lines and fire hydrant pipeline ring main.',
        responsibleOfficer: 'Joint Inspection Committee',
      },
      {
        stageId: 'stg-dish-05',
        stageName: 'Final Factory Building Plan Sanction',
        department: 'Directorate of Industrial Safety and Health',
        date: 'Target: 10 Mar 2026',
        status: 'upcoming',
        elapsedOrRemaining: 'Final Stage',
        description: 'Issuance of stamped Factory Building Plan Sanction order with Form 1 Certificate.',
        responsibleOfficer: 'Director of Industrial Safety and Health, Maharashtra',
      },
    ];
  }

  /**
   * Returns summary metrics across all applications
   */
  public getSummaryMetrics(): TrackerSummaryMetrics {
    const dossiers = this.getDepartmentDossiers();

    const underScrutiny = dossiers.filter((d) => d.status === 'Under Scrutiny').length;
    const queryRaised = dossiers.filter((d) => d.status === 'Query Raised').length;
    const inspectionScheduled = dossiers.filter((d) => d.status === 'Inspection Scheduled').length;
    const approvedIssued = dossiers.filter((d) => d.status === 'Approved').length;
    const pendingApplicantAction = dossiers.filter((d) => d.applicantActionRequired).length;

    return {
      totalApplications: dossiers.length,
      underScrutiny,
      queryRaised,
      inspectionScheduled,
      approvedIssued,
      pendingApplicantAction,
    };
  }

  // --- Query Management ---

  public getQueries(): ApplicationQuery[] {
    return [...this.queries];
  }

  public getQueryById(id: string): ApplicationQuery | undefined {
    return this.queries.find((q) => q.id === id);
  }

  public getActiveQuery(): ApplicationQuery | undefined {
    return this.queries.find((q) => q.status === 'Open' || q.status === 'Response Draft') || this.queries[0];
  }

  /**
   * Attaches an existing Document Vault document to a query deliverable
   */
  public linkDocumentToDeliverable(
    queryId: string,
    deliverableId: string,
    documentId: string
  ): { success: boolean; message: string } {
    const query = this.queries.find((q) => q.id === queryId);
    if (!query) return { success: false, message: 'Query not found.' };

    const del = query.requestedDeliverables.find((d) => d.id === deliverableId);
    if (!del) return { success: false, message: 'Deliverable requirement not found.' };

    const doc = documentVaultService.getDocumentById(documentId);
    if (!doc) return { success: false, message: 'Document not found in Statutory Vault.' };

    if (doc.status === 'Expired' || doc.verificationStatus === 'Expired') {
      return { success: false, message: 'Cannot attach expired document as statutory evidence.' };
    }

    del.linkedDocumentId = doc.id;
    del.linkedDocumentName = doc.documentName;
    del.linkedVersion = doc.currentVersionId;
    del.linkedVerificationStatus = doc.verificationStatus;
    del.status = 'Evidence Attached';

    this.persistQueries();
    return {
      success: true,
      message: `Document "${doc.documentName}" successfully linked as evidence for "${del.requirement}".`,
    };
  }

  /**
   * Removes linked document from deliverable
   */
  public unlinkDocumentFromDeliverable(queryId: string, deliverableId: string): void {
    const query = this.queries.find((q) => q.id === queryId);
    if (!query) return;
    const del = query.requestedDeliverables.find((d) => d.id === deliverableId);
    if (!del) return;

    del.linkedDocumentId = undefined;
    del.linkedDocumentName = undefined;
    del.linkedVersion = undefined;
    del.linkedVerificationStatus = undefined;
    del.status = 'Pending';
    this.persistQueries();
  }

  /**
   * Submits applicant clarification response
   */
  public submitQueryResponse(
    queryId: string,
    submission: {
      responseText: string;
      declarationAccepted: boolean;
      submittedByName: string;
      additionalUploads?: Array<{ fileName: string; fileSize: string; deliverableId: string }>;
    }
  ): { success: boolean; message: string; receiptNumber?: string } {
    const query = this.queries.find((q) => q.id === queryId);
    if (!query) return { success: false, message: 'Query not found.' };

    if (!submission.declarationAccepted) {
      return { success: false, message: 'Statutory declaration undertaking must be accepted.' };
    }

    if (!submission.responseText.trim() || submission.responseText.trim().length < 30) {
      return {
        success: false,
        message: 'Please provide a detailed technical clarification (minimum 30 characters).',
      };
    }

    // Check mandatory deliverables
    const missingMandatory = query.requestedDeliverables.filter(
      (d) => d.mandatory && !d.linkedDocumentId && !submission.additionalUploads?.some((u) => u.deliverableId === d.id)
    );

    if (missingMandatory.length > 0) {
      return {
        success: false,
        message: `Mandatory evidence required for: ${missingMandatory.map((m) => m.requirement).join(', ')}`,
      };
    }

    const now = new Date();
    const nowStr = now.toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    const receiptNumber = `ACK-QRY-${now.getFullYear()}-${Math.floor(10000 + Math.random() * 90000)}`;

    const evidenceAttachments: ApplicantClarificationSubmission['evidenceAttachments'] = [];

    query.requestedDeliverables.forEach((d) => {
      if (d.linkedDocumentId) {
        evidenceAttachments.push({
          deliverableId: d.id,
          documentId: d.linkedDocumentId,
          documentName: d.linkedDocumentName || 'Attached Document',
          source: 'Statutory Document Vault (MahaUdyam One)',
          version: d.linkedVersion || 'v1.0',
          verificationStatus: d.linkedVerificationStatus || 'Verified',
        });
      }
    });

    if (submission.additionalUploads) {
      submission.additionalUploads.forEach((u) => {
        evidenceAttachments.push({
          deliverableId: u.deliverableId,
          documentName: u.fileName,
          source: 'Direct File Upload (Pending Department Verification)',
          version: 'v1.0 (Fresh Filing)',
          verificationStatus: 'Pending Verification',
          isNewUpload: true,
          fileSize: u.fileSize,
        });
      });
    }

    query.applicantResponse = {
      submittedAt: nowStr,
      submittedBy: submission.submittedByName,
      responseText: submission.responseText,
      declarationAccepted: true,
      evidenceAttachments,
    };

    query.status = 'Response Submitted';

    query.activityLog.unshift({
      id: `act-q-${Date.now()}`,
      timestamp: nowStr,
      actor: `${submission.submittedByName} (Authorized Signatory)`,
      action: 'Clarification Submitted',
      note: `Clarification response filed with ${evidenceAttachments.length} evidence attachments. Receipt: ${receiptNumber}.`,
    });

    this.persistQueries();

    // Log in portal activity feed
    try {
      applicantService.addActivity({
        title: `Query Response Filed: ${query.subject}`,
        description: `Submitted clarification response for ${query.department} (${query.applicationNumber}). Receipt: ${receiptNumber}.`,
        type: 'QUERY',
        refNumber: receiptNumber,
      });
    } catch (e) {
      console.warn('Could not add portal activity', e);
    }

    return {
      success: true,
      message: 'Clarification response submitted successfully. SRO Scrutiny Officer notified.',
      receiptNumber,
    };
  }

  // --- Inspection Management ---

  public getInspections(): ApplicationInspection[] {
    return [...this.inspections];
  }

  public getInspectionById(id: string): ApplicationInspection | undefined {
    return this.inspections.find((i) => i.id === id);
  }

  public getActiveInspection(): ApplicationInspection | undefined {
    return this.inspections[0];
  }

  /**
   * Toggles preparation checklist item ready state
   */
  public toggleChecklistItem(inspectionId: string, itemId: string): boolean {
    const inspection = this.inspections.find((i) => i.id === inspectionId);
    if (!inspection) return false;

    const item = inspection.preparationChecklist.find((p) => p.id === itemId);
    if (!item) return false;

    item.ready = !item.ready;
    this.persistInspections();
    return true;
  }
}

export const trackerService = new TrackerService();
