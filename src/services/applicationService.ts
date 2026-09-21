import {
  ApprovalApplication,
  CTEProjectParameters,
  ApplicationRequiredDocument,
  DocumentReadinessReport,
  ApplicationTimelineEvent,
} from '../types/application';
import { applicantService } from './applicantService';
import { approvalRuleEngine } from './approvalRuleEngine';
import { documentVaultService } from './documentVaultService';

const DRAFT_STORAGE_KEY = 'mahaudyam_cte_application_draft';
const ALL_APPS_STORAGE_KEY = 'mahaudyam_applications_registry';

export class ApplicationService {
  private currentDraft: ApprovalApplication | null = null;

  constructor() {
    this.loadDraft();
  }

  private loadDraft(): ApprovalApplication | null {
    try {
      const saved = localStorage.getItem(DRAFT_STORAGE_KEY);
      if (saved) {
        this.currentDraft = JSON.parse(saved);
        return this.currentDraft;
      }
    } catch (e) {
      console.error('Failed to load application draft from localStorage', e);
    }
    return null;
  }

  private persistDraft(app: ApprovalApplication): void {
    try {
      this.currentDraft = app;
      localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(app));
    } catch (e) {
      console.error('Failed to persist application draft to localStorage', e);
    }
  }

  /**
   * Generates or fetches the active CTE draft application
   */
  public getOrCreateDraftApplication(targetProjectId?: string): ApprovalApplication {
    if (this.currentDraft && (!targetProjectId || this.currentDraft.projectId === targetProjectId)) {
      // Re-evaluate document validation states against the live vault
      this.syncDocumentsWithVault(this.currentDraft);
      return this.currentDraft;
    }

    const projects = applicantService.getProjects();
    const enterprises = applicantService.getEnterprises();
    const profile = applicantService.getProfile();

    const project = targetProjectId
      ? projects.find((p) => p.id === targetProjectId) || projects[0]
      : projects[0];

    const enterprise = enterprises.find((e) => e.id === project.enterpriseId) || enterprises[0];

    // Compute initial Phase 4 rule context for parameters
    const ruleCtx = approvalRuleEngine.createInitialContext(enterprise, project);

    // Initial CTE parameters derived from Phase 3 & 4
    const projectParameters: CTEProjectParameters = {
      industrialActivity: project.sector,
      sector: project.sector,
      cpcbCategory: ruleCtx.pollutionCategory,
      cpcbIndustryType: 'Automobile and Automotive Component Manufacturing (Code: 2014)',
      manufacturingActivity: 'Forging, precision CNC turning, heat treatment and gear component assembly',
      proposedCapitalInvestmentCr: project.proposedInvestmentCr,
      landAreaAcres: project.landAreaAcres,
      totalBuiltUpAreaSqMeters: ruleCtx.totalBuiltUpAreaSqMeters || 6200,
      plotOrSurveyNumber: ruleCtx.plotOrSurveyNumber || 'Plot B-14/1',
      midcArea: project.midcArea || 'Chakan MIDC Phase II',
      district: project.district,
      taluka: 'Khed',
      powerRequirementKva: project.powerDemandKva || 1250,
      waterRequirementKld: project.waterDemandKld || 50,
      tradeEffluentKld: ruleCtx.effluentDischargeKld || 12.5,
      domesticEffluentKld: 8.0,
      effluentTreatmentPlan: 'CETP Connected',
      airEmissions: ['DG Set Stack (7.5m above roof)', 'Induction Furnace Exhaust', 'Paint Spray Booth Wet Scrubber'],
      fuelType: 'High Speed Diesel (HSD) & Electrical Grid',
      dgSetCapacityKva: 750,
      hazardousWasteCategory: 'Category 5.1 (Used/Spent Oil) & Category 35.3 (Chemical Sludge)',
      hazardousWasteQuantityTpa: 4.8,
      chwtsdfMembership: 'MEPL Ranjangaon',
      numberOfWorkers: project.proposedEmployment || 140,
      operationalShifts: 2,
      expectedCommissioningDate: project.commencementExpected || 'December 2026',
      derivedFromPhase4: true,
    };

    // Build standard statutory CTE required documents (from Phase 4 MPCB clearance specification)
    const requiredDocuments: ApplicationRequiredDocument[] = [
      {
        requirementId: 'req-dpr',
        documentType: 'Detailed Project Report (DPR) with Manufacturing Process Flow',
        category: 'Technical & Project',
        mandatory: true,
        statutorySource: 'Water Act 1974 Sec 25(2) / Air Act 1981 Sec 21(2)',
        description: 'Comprehensive techno-commercial project report detailing manufacturing process flowcharts, input materials, machinery, and production capacities.',
        validationState: 'Missing',
      },
      {
        requirementId: 'req-site-plan',
        documentType: 'Site Layout Plan with ETP / STP Proposed Locations',
        category: 'Land & Siting',
        mandatory: true,
        statutorySource: 'MPCB Circular No. B-2834 on Siting & Effluent Demarcation',
        description: 'Scaled plot boundary plan highlighting built-up structures, internal roads, green belt allocation (33%), and proposed ETP/STP civil foundations.',
        validationState: 'Missing',
      },
      {
        requirementId: 'req-land-possession',
        documentType: 'Land Possession Receipt / MIDC Allotment Letter',
        category: 'Land & Siting',
        mandatory: true,
        statutorySource: 'Maharashtra Land Revenue Code & MIDC Allotment Regulations',
        description: 'Official title deed, registered lease agreement, or MIDC execution letter establishing legal possession of the industrial parcel.',
        validationState: 'Missing',
      },
      {
        requirementId: 'req-water-balance',
        documentType: 'Water Balance & Effluent Treatment Scheme',
        category: 'Statutory & Environmental',
        mandatory: true,
        statutorySource: 'Water (Prevention and Control of Pollution) Act, 1974',
        description: 'Mathematical water intake vs. consumption balance chart, segregation of trade vs. sewage effluent, and CETP/ETP discharge calculations.',
        validationState: 'Missing',
      },
      {
        requirementId: 'req-apc-drawings',
        documentType: 'Air Pollution Control (APC) Equipment Drawings',
        category: 'Statutory & Environmental',
        mandatory: true,
        statutorySource: 'Air (Prevention and Control of Pollution) Act, 1981 Sec 21',
        description: 'Engineering design diagrams of dust collectors, bag filters, stack heights (as per CPCB formula), and sampling port specifications.',
        validationState: 'Missing',
      },
      {
        requirementId: 'req-board-resolution',
        documentType: 'Board Resolution / Power of Attorney for Authorized Signatory',
        category: 'Identity & Entity',
        mandatory: true,
        statutorySource: 'Companies Act 2013 / Maharashtra Single Window Act 2016',
        description: 'Certified extract of the enterprise board resolution authorizing the applicant to submit and execute statutory filings on MahaUdyam One.',
        validationState: 'Missing',
      },
      {
        requirementId: 'req-incorporation-cert',
        documentType: 'Certificate of Incorporation & Enterprise PAN Card',
        category: 'Identity & Entity',
        mandatory: true,
        statutorySource: 'Ministry of Corporate Affairs / Income Tax Department',
        description: 'Permanent corporate legal identity certificate issued by ROC / Ministry of Corporate Affairs, and legal entity PAN.',
        validationState: 'Missing',
      },
    ];

    const initialTimeline: ApplicationTimelineEvent[] = [
      {
        id: 'evt-1',
        timestamp: new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
        stage: 'Draft Created',
        title: 'Draft CTE Application Initiated',
        description: `Application dossier initialized for ${project.name} under ${enterprise.name}.`,
        actor: `${profile.name} (${profile.designation})`,
        status: 'completed',
      },
    ];

    const newApp: ApprovalApplication = {
      id: 'app-draft-cte-01',
      applicationNumber: 'CTE/MH/2026/00001',
      approvalId: 'cte-01',
      approvalName: 'Consent to Establish (CTE) under Water & Air Acts',
      serviceCode: 'MPCB-CTE-01',
      department: 'Maharashtra Pollution Control Board (MPCB)',
      enterpriseId: enterprise.id,
      enterpriseName: enterprise.name,
      projectId: project.id,
      projectName: project.name,
      applicantId: profile.id,
      applicantName: profile.name,
      applicantDesignation: profile.designation,
      applicationType: 'New Consent to Establish',
      status: 'Draft',
      currentStep: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      statutoryCategory: ruleCtx.pollutionCategory,
      projectParameters,
      requiredDocuments,
      declaration: {
        accepted: false,
        signatoryName: profile.name,
        designation: profile.designation,
        statements: {
          accurateInformation: false,
          authenticDocuments: false,
          statutoryScrutinyConsent: false,
          competentAuthorityClarification: false,
        },
      },
      submissionMetadata: {
        isPrototype: true,
        assignedNodalOffice: `Sub-Regional Office, Pune II (MPCB)`,
        scrutinyFeeAmount: ruleCtx.proposedCapitalInvestmentCr > 25 ? 25000 : 10000,
        scrutinyFeeStatus: 'Pay at Scrutiny',
      },
      timeline: initialTimeline,
    };

    // Auto-link matching verified documents already deposited in Phase 5 Document Vault
    this.autoMatchVaultDocuments(newApp);

    this.persistDraft(newApp);
    return newApp;
  }

  /**
   * Intelligently links verified documents from Phase 5 Locker if available
   */
  private autoMatchVaultDocuments(app: ApprovalApplication): void {
    const vaultDocs = documentVaultService.getAllDocuments();

    app.requiredDocuments.forEach((req) => {
      let matchedDoc = null;

      if (req.requirementId === 'req-dpr') {
        matchedDoc = vaultDocs.find((d) => d.id === 'doc-07');
      } else if (req.requirementId === 'req-land-possession') {
        matchedDoc = vaultDocs.find((d) => d.id === 'doc-04' || d.id === 'doc-05');
      } else if (req.requirementId === 'req-water-balance') {
        matchedDoc = vaultDocs.find((d) => d.id === 'doc-08');
      } else if (req.requirementId === 'req-apc-drawings') {
        matchedDoc = vaultDocs.find((d) => d.id === 'doc-09');
      } else if (req.requirementId === 'req-board-resolution') {
        matchedDoc = vaultDocs.find((d) => d.id === 'doc-06');
      } else if (req.requirementId === 'req-incorporation-cert') {
        matchedDoc = vaultDocs.find((d) => d.id === 'doc-01');
      } else if (req.requirementId === 'req-site-plan') {
        matchedDoc = vaultDocs.find((d) => d.id === 'doc-10');
      }

      if (matchedDoc) {
        req.linkedDocumentId = matchedDoc.id;
        req.linkedVersionId = matchedDoc.currentVersionId;
        req.linkedDocumentName = matchedDoc.documentName;
        req.linkedDocumentNumber = matchedDoc.documentNumber;
        req.linkedVerificationStatus = matchedDoc.verificationStatus;
        req.linkedExpiryDate = matchedDoc.expiryDate || undefined;

        if (matchedDoc.status === 'Expired' || matchedDoc.verificationStatus === 'Expired') {
          req.validationState = 'Expired';
          req.validationNotes = 'Certificate has expired. Fresh renewal required.';
        } else if (matchedDoc.verificationStatus === 'Verified') {
          req.validationState = 'Ready';
          req.validationNotes = 'Statutory DigiLocker / Department pre-verified credential linked.';
        } else if (matchedDoc.verificationStatus === 'Pending Verification') {
          req.validationState = 'Pending Verification';
          req.validationNotes = 'Document deposited in locker is currently under officer scrutiny.';
        } else {
          req.validationState = 'Invalid';
        }
      }
    });
  }

  /**
   * Synchronizes linked documents against the live vault state
   */
  public syncDocumentsWithVault(app: ApprovalApplication): void {
    app.requiredDocuments.forEach((req) => {
      if (req.linkedDocumentId) {
        const doc = documentVaultService.getDocumentById(req.linkedDocumentId);
        if (doc) {
          req.linkedVersionId = doc.currentVersionId;
          req.linkedDocumentName = doc.documentName;
          req.linkedDocumentNumber = doc.documentNumber;
          req.linkedVerificationStatus = doc.verificationStatus;
          req.linkedExpiryDate = doc.expiryDate || undefined;

          if (doc.status === 'Expired' || doc.verificationStatus === 'Expired') {
            req.validationState = 'Expired';
            req.validationNotes = 'Certificate has expired. Fresh renewal required.';
          } else if (doc.verificationStatus === 'Verified') {
            req.validationState = 'Ready';
            req.validationNotes = 'Statutory DigiLocker / Department pre-verified credential linked.';
          } else if (doc.verificationStatus === 'Pending Verification') {
            req.validationState = 'Pending Verification';
            req.validationNotes = 'Document deposited in locker is currently under officer scrutiny.';
          } else {
            req.validationState = 'Invalid';
          }
        } else {
          // Document was deleted from vault
          req.linkedDocumentId = undefined;
          req.linkedVersionId = undefined;
          req.linkedDocumentName = undefined;
          req.linkedDocumentNumber = undefined;
          req.linkedVerificationStatus = undefined;
          req.linkedExpiryDate = undefined;
          req.validationState = 'Missing';
          req.validationNotes = undefined;
        }
      }
    });
  }

  /**
   * Links a verified document from Document Vault to a requirement
   */
  public linkDocumentToRequirement(
    requirementId: string,
    documentId: string,
    reusedByName: string = 'Priya Deshmukh (Managing Director)'
  ): { success: boolean; message: string } {
    if (!this.currentDraft) {
      this.getOrCreateDraftApplication();
    }
    const app = this.currentDraft!;
    const req = app.requiredDocuments.find((r) => r.requirementId === requirementId);
    if (!req) {
      return { success: false, message: 'Requirement not found.' };
    }

    const doc = documentVaultService.getDocumentById(documentId);
    if (!doc) {
      return { success: false, message: 'Document not found in vault.' };
    }

    if (doc.status === 'Expired' || doc.verificationStatus === 'Expired') {
      return { success: false, message: 'Cannot attach an expired document.' };
    }

    // Register reuse record in Document Vault audit trail
    const reuseResult = documentVaultService.reuseDocument(doc.id, {
      targetClearanceCode: app.serviceCode,
      targetClearanceName: app.approvalName,
      targetRequirementName: req.documentType,
      projectId: app.projectId,
      projectName: app.projectName,
      reusedBy: reusedByName,
    });

    req.linkedDocumentId = doc.id;
    req.linkedVersionId = doc.currentVersionId;
    req.linkedDocumentName = doc.documentName;
    req.linkedDocumentNumber = doc.documentNumber;
    req.linkedVerificationStatus = doc.verificationStatus;
    req.linkedExpiryDate = doc.expiryDate || undefined;
    req.reuseRecordId = reuseResult.record?.id;

    if (doc.verificationStatus === 'Verified') {
      req.validationState = 'Ready';
      req.validationNotes = 'Pre-authenticated statutory credential linked via Document Vault.';
    } else if (doc.verificationStatus === 'Pending Verification') {
      req.validationState = 'Pending Verification';
      req.validationNotes = 'Locker document is awaiting officer verification.';
    } else {
      req.validationState = 'Invalid';
    }

    app.updatedAt = new Date().toISOString();
    this.persistDraft(app);

    return {
      success: true,
      message: `Document "${doc.documentName}" successfully attached to "${req.documentType}".`,
    };
  }

  /**
   * Unlinks a document from a requirement
   */
  public unlinkDocumentFromRequirement(requirementId: string): void {
    if (!this.currentDraft) return;
    const req = this.currentDraft.requiredDocuments.find((r) => r.requirementId === requirementId);
    if (req) {
      req.linkedDocumentId = undefined;
      req.linkedVersionId = undefined;
      req.linkedDocumentName = undefined;
      req.linkedDocumentNumber = undefined;
      req.linkedVerificationStatus = undefined;
      req.linkedExpiryDate = undefined;
      req.reuseRecordId = undefined;
      req.validationState = 'Missing';
      req.validationNotes = undefined;

      this.currentDraft.updatedAt = new Date().toISOString();
      this.persistDraft(this.currentDraft);
    }
  }

  /**
   * Evaluates document readiness for the application
   */
  public evaluateDocumentReadiness(app: ApprovalApplication): DocumentReadinessReport {
    let totalRequired = 0;
    let verifiedAndReady = 0;
    let pendingVerification = 0;
    let missing = 0;
    let expired = 0;
    let conditional = 0;
    const blockingReasons: string[] = [];

    app.requiredDocuments.forEach((doc) => {
      if (doc.mandatory) {
        totalRequired++;
        if (doc.validationState === 'Ready') {
          verifiedAndReady++;
        } else if (doc.validationState === 'Pending Verification') {
          pendingVerification++;
          blockingReasons.push(`${doc.documentType} is in Pending Verification status in the Locker.`);
        } else if (doc.validationState === 'Expired') {
          expired++;
          blockingReasons.push(`${doc.documentType} has expired and cannot be submitted.`);
        } else if (doc.validationState === 'Missing') {
          missing++;
          blockingReasons.push(`${doc.documentType} has not been attached.`);
        } else {
          blockingReasons.push(`${doc.documentType} is invalid.`);
        }
      } else {
        conditional++;
      }
    });

    const isReadyForReview = totalRequired > 0 && verifiedAndReady === totalRequired;

    return {
      totalRequired,
      verifiedAndReady,
      pendingVerification,
      missing,
      expired,
      conditional,
      isReadyForReview,
      blockingReasons,
    };
  }

  /**
   * Switches project and updates draft context
   */
  public changeProject(projectId: string): ApprovalApplication {
    const projects = applicantService.getProjects();
    const enterprises = applicantService.getEnterprises();
    const profile = applicantService.getProfile();

    const project = projects.find((p) => p.id === projectId) || projects[0];
    const enterprise = enterprises.find((e) => e.id === project.enterpriseId) || enterprises[0];

    // Build fresh draft for this project
    const newDraft = this.getOrCreateDraftApplication(projectId);
    newDraft.projectId = project.id;
    newDraft.projectName = project.name;
    newDraft.enterpriseId = enterprise.id;
    newDraft.enterpriseName = enterprise.name;
    newDraft.projectParameters.sector = project.sector;
    newDraft.projectParameters.industrialActivity = project.sector;
    newDraft.projectParameters.district = project.district;
    newDraft.projectParameters.midcArea = project.midcArea || 'MIDC Area';
    newDraft.projectParameters.proposedCapitalInvestmentCr = project.proposedInvestmentCr;
    newDraft.projectParameters.landAreaAcres = project.landAreaAcres;
    newDraft.projectParameters.powerRequirementKva = project.powerDemandKva || 1250;
    newDraft.projectParameters.waterRequirementKld = project.waterDemandKld || 50;
    newDraft.updatedAt = new Date().toISOString();

    this.persistDraft(newDraft);
    return newDraft;
  }

  /**
   * Updates project parameters inline
   */
  public updateParameters(params: Partial<CTEProjectParameters>): ApprovalApplication {
    if (!this.currentDraft) {
      this.getOrCreateDraftApplication();
    }
    this.currentDraft!.projectParameters = {
      ...this.currentDraft!.projectParameters,
      ...params,
      derivedFromPhase4: false,
    };
    this.currentDraft!.updatedAt = new Date().toISOString();
    this.persistDraft(this.currentDraft!);
    return this.currentDraft!;
  }

  /**
   * Updates declaration
   */
  public updateDeclaration(
    accepted: boolean,
    statements?: {
      accurateInformation: boolean;
      authenticDocuments: boolean;
      statutoryScrutinyConsent: boolean;
      competentAuthorityClarification: boolean;
    }
  ): ApprovalApplication {
    if (!this.currentDraft) {
      this.getOrCreateDraftApplication();
    }
    this.currentDraft!.declaration.accepted = accepted;
    this.currentDraft!.declaration.acceptedAt = accepted ? new Date().toISOString() : undefined;
    if (statements) {
      this.currentDraft!.declaration.statements = statements;
    } else if (accepted) {
      this.currentDraft!.declaration.statements = {
        accurateInformation: true,
        authenticDocuments: true,
        statutoryScrutinyConsent: true,
        competentAuthorityClarification: true,
      };
    }
    this.currentDraft!.updatedAt = new Date().toISOString();
    this.persistDraft(this.currentDraft!);
    return this.currentDraft!;
  }

  /**
   * Sets current step (1, 2, or 3)
   */
  public setCurrentStep(step: 1 | 2 | 3): ApprovalApplication {
    if (!this.currentDraft) {
      this.getOrCreateDraftApplication();
    }
    this.currentDraft!.currentStep = step;
    this.currentDraft!.updatedAt = new Date().toISOString();
    this.persistDraft(this.currentDraft!);
    return this.currentDraft!;
  }

  /**
   * Submits application in prototype mode
   */
  public submitApplication(): { success: boolean; message: string; receiptNumber?: string } {
    if (!this.currentDraft) {
      return { success: false, message: 'No draft application found to submit.' };
    }

    const app = this.currentDraft;
    const readiness = this.evaluateDocumentReadiness(app);

    if (!readiness.isReadyForReview) {
      return {
        success: false,
        message: `Submission blocked: ${readiness.blockingReasons[0] || 'Mandatory documents are unresolved.'}`,
      };
    }

    if (!app.declaration.accepted) {
      return {
        success: false,
        message: 'Submission blocked: Statutory declaration must be acknowledged by authorized signatory.',
      };
    }

    const now = new Date();
    const receiptNum = `REC-MPCB-2026-${Math.floor(10000 + Math.random() * 90000)}`;
    const submissionTimeFormatted = now.toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    app.status = 'Submitted';
    app.submittedAt = now.toISOString();
    app.submissionMetadata = {
      ...app.submissionMetadata,
      submittedAt: now.toISOString(),
      submissionReceiptNumber: receiptNum,
      ipAddress: '103.228.156.42 (Maharashtra SDC Gateway)',
      isPrototype: true,
    };

    app.timeline.push({
      id: `evt-${Date.now()}`,
      timestamp: submissionTimeFormatted,
      stage: 'Submitted',
      title: 'Application Formally Submitted via Single Window',
      description: `Application ${app.applicationNumber} digitally signed by ${app.applicantName} and placed in MPCB Sub-Regional Office queue.`,
      actor: `${app.applicantName} (${app.applicantDesignation})`,
      status: 'completed',
    });

    app.timeline.push({
      id: `evt-upcoming-1`,
      timestamp: 'Pending Allocation',
      stage: 'Department Scrutiny',
      title: 'Scrutiny by Sub-Regional Officer (Pune II)',
      description: 'Institutional verification of water balance, air emissions, and zoning compliance.',
      actor: 'MPCB Scrutiny Officer',
      status: 'current',
    });

    app.updatedAt = now.toISOString();
    this.persistDraft(app);

    // Also register in applicantService activities list so other dashboards reflect it
    try {
      applicantService.addActivity({
        title: 'Application Submitted: MPCB CTE',
        description: `Submitted Consent to Establish (CTE) application ${app.applicationNumber} for ${app.projectName}`,
        type: 'SUBMISSION',
        refNumber: app.applicationNumber,
      });
    } catch (e) {
      console.warn('Could not record activity in applicantService', e);
    }

    return {
      success: true,
      message: 'Application successfully submitted to Maharashtra Pollution Control Board (MPCB).',
      receiptNumber: receiptNum,
    };
  }

  /**
   * Resets draft to clean prototype initial state
   */
  public resetDraft(): void {
    localStorage.removeItem(DRAFT_STORAGE_KEY);
    this.currentDraft = null;
    this.getOrCreateDraftApplication();
  }
}

export const applicationService = new ApplicationService();
