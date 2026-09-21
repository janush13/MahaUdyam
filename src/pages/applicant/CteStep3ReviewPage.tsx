import React, { useState, useEffect } from 'react';
import { useRouter } from '../../router/Router';
import { ApplicantLayout } from '../../components/layout/ApplicantLayout';
import { ApplicationStepHeader } from '../../components/applicant/ApplicationStepHeader';
import { applicationService } from '../../services/applicationService';
import { ApprovalApplication, DocumentReadinessReport } from '../../types/application';

export const CteStep3ReviewPage: React.FC = () => {
  const { navigate } = useRouter();
  const [application, setApplication] = useState<ApprovalApplication>(() =>
    applicationService.getOrCreateDraftApplication()
  );
  const [readiness, setReadiness] = useState<DocumentReadinessReport>(() =>
    applicationService.evaluateDocumentReadiness(application)
  );
  const [declarationAccepted, setDeclarationAccepted] = useState<boolean>(
    application.declaration.accepted
  );
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [submissionReceipt, setSubmissionReceipt] = useState<string | null>(
    application.submissionMetadata.submissionReceiptNumber || null
  );
  const [showConfirmationModal, setShowConfirmationModal] = useState<boolean>(false);
  const [submissionError, setSubmissionError] = useState<string | null>(null);

  useEffect(() => {
    const app = applicationService.getOrCreateDraftApplication();
    setApplication({ ...app });
    setReadiness(applicationService.evaluateDocumentReadiness(app));
    setDeclarationAccepted(app.declaration.accepted);
    if (app.status === 'Submitted' && app.submissionMetadata.submissionReceiptNumber) {
      setSubmissionReceipt(app.submissionMetadata.submissionReceiptNumber);
    }
  }, []);

  const handleDeclarationToggle = (checked: boolean) => {
    setDeclarationAccepted(checked);
    const updated = applicationService.updateDeclaration(checked);
    setApplication({ ...updated });
    setSubmissionError(null);
  };

  const handleFinalSubmit = () => {
    setSubmissionError(null);

    if (!declarationAccepted) {
      setSubmissionError('You must acknowledge and accept the statutory declaration before submitting.');
      return;
    }

    if (!readiness.isReadyForReview) {
      setSubmissionError(
        `Submission blocked: ${readiness.blockingReasons[0] || 'Mandatory documents remain unverified.'}`
      );
      return;
    }

    setIsSubmitting(true);

    setTimeout(() => {
      const result = applicationService.submitApplication();
      setIsSubmitting(false);

      if (result.success) {
        setSubmissionReceipt(result.receiptNumber || 'REC-MPCB-2026-99104');
        setShowConfirmationModal(true);
        const updated = applicationService.getOrCreateDraftApplication();
        setApplication({ ...updated });
      } else {
        setSubmissionError(result.message);
      }
    }, 600);
  };

  const isSubmitted = application.status === 'Submitted';
  const params = application.projectParameters;

  return (
    <ApplicantLayout
      activeTab="discovery"
      breadcrumbs={[
        { label: 'Applications', href: '/applicant/dashboard' },
        { label: 'Consent to Establish (CTE)', href: '/applicant/applications/cte' },
        { label: 'Step 2: Documents', href: '/applicant/applications/cte/documents' },
        { label: 'Step 3: Review & Submission' },
      ]}
    >
      <div className="space-y-6 max-w-6xl mx-auto" data-purpose="screen-23-review-submission">
        {/* Top Stepper Header */}
        <ApplicationStepHeader
          application={application}
          currentStep={3}
        />

        {/* Submitted Notification Banner if already submitted */}
        {isSubmitted && (
          <div className="p-5 bg-emerald-50 border border-emerald-300 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center text-lg font-bold">
                ✓
              </span>
              <div>
                <h3 className="text-sm font-bold text-emerald-950 font-serif">
                  Application Submitted Successfully (Prototype Docket Registered)
                </h3>
                <p className="text-xs text-emerald-800 mt-0.5">
                  Acknowledgement Receipt No: <strong className="font-mono">{submissionReceipt}</strong> • Submitted: <strong>{new Date(application.submittedAt || Date.now()).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</strong>
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowConfirmationModal(true)}
              className="px-4 py-2 bg-emerald-800 hover:bg-emerald-900 text-white rounded-xl text-xs font-bold transition cursor-pointer self-start sm:self-auto"
            >
              View Submission Receipt
            </button>
          </div>
        )}

        {/* Application Readiness Checklist Card */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs p-5 sm:p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <span className="text-[10px] uppercase font-bold text-blue-900 tracking-wider block">
                Statutory Readiness Verification
              </span>
              <h2 className="text-lg font-bold text-slate-900 font-serif">
                Pre-Submission Qualification Checklist
              </h2>
            </div>
            <span className="text-xs text-slate-500 font-mono">
              SLA Clock: 30 Days (Maharashtra RTS Act)
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
            {/* 1. Entity Credentials */}
            <div className="p-3 rounded-xl border border-emerald-200 bg-emerald-50/50 flex items-start gap-2.5">
              <span className="text-emerald-700 font-bold text-sm">✓</span>
              <div>
                <strong className="text-slate-900 block font-semibold">Entity &amp; Signatory KYC</strong>
                <span className="text-slate-500 text-[11px]">Authorized Signatory Aadhaar &amp; PAN verified</span>
              </div>
            </div>

            {/* 2. Project Siting */}
            <div className="p-3 rounded-xl border border-emerald-200 bg-emerald-50/50 flex items-start gap-2.5">
              <span className="text-emerald-700 font-bold text-sm">✓</span>
              <div>
                <strong className="text-slate-900 block font-semibold">Industrial Siting Parameters</strong>
                <span className="text-slate-500 text-[11px]">{params.plotOrSurveyNumber}, {params.midcArea}</span>
              </div>
            </div>

            {/* 3. CTE Technical Scope */}
            <div className="p-3 rounded-xl border border-emerald-200 bg-emerald-50/50 flex items-start gap-2.5">
              <span className="text-emerald-700 font-bold text-sm">✓</span>
              <div>
                <strong className="text-slate-900 block font-semibold">Environmental &amp; CPCB Scope</strong>
                <span className="text-slate-500 text-[11px]">{params.cpcbCategory} Category • ₹{params.proposedCapitalInvestmentCr} Cr Investment</span>
              </div>
            </div>

            {/* 4. Mandatory Documents */}
            <div
              className={`p-3 rounded-xl border flex items-start gap-2.5 ${
                readiness.isReadyForReview
                  ? 'border-emerald-200 bg-emerald-50/50'
                  : 'border-amber-300 bg-amber-50/70'
              }`}
            >
              <span className={`font-bold text-sm ${readiness.isReadyForReview ? 'text-emerald-700' : 'text-amber-700'}`}>
                {readiness.isReadyForReview ? '✓' : '⚠️'}
              </span>
              <div>
                <strong className="text-slate-900 block font-semibold">
                  Mandatory Statutory Documents ({readiness.verifiedAndReady}/{readiness.totalRequired})
                </strong>
                <span className={`text-[11px] ${readiness.isReadyForReview ? 'text-slate-500' : 'text-amber-800 font-medium'}`}>
                  {readiness.isReadyForReview
                    ? 'All 7 certificates pre-verified in Locker'
                    : `${readiness.pendingVerification} in scrutiny, ${readiness.missing} missing`}
                </span>
              </div>
            </div>

            {/* 5. Statutory Scrutiny Fee */}
            <div className="p-3 rounded-xl border border-emerald-200 bg-emerald-50/50 flex items-start gap-2.5">
              <span className="text-emerald-700 font-bold text-sm">✓</span>
              <div>
                <strong className="text-slate-900 block font-semibold">Estimated Scrutiny Fee</strong>
                <span className="text-slate-500 text-[11px]">
                  ₹{params.proposedCapitalInvestmentCr > 25 ? '25,000' : '10,000'} (Payment at Scrutiny Stage)
                </span>
              </div>
            </div>

            {/* 6. Declaration Status */}
            <div
              className={`p-3 rounded-xl border flex items-start gap-2.5 ${
                declarationAccepted
                  ? 'border-emerald-200 bg-emerald-50/50'
                  : 'border-slate-200 bg-slate-50'
              }`}
            >
              <span className={`font-bold text-sm ${declarationAccepted ? 'text-emerald-700' : 'text-slate-400'}`}>
                {declarationAccepted ? '✓' : '○'}
              </span>
              <div>
                <strong className="text-slate-900 block font-semibold">Statutory Undertaking</strong>
                <span className="text-slate-500 text-[11px]">
                  {declarationAccepted ? 'Affirmed by Authorized Signatory' : 'Awaiting digital acknowledgement'}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Detailed Application Dossier Summary (Accordions / Sections) */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden divide-y divide-slate-200 text-xs">
          {/* Section 1: Enterprise & Applicant Credentials */}
          <div className="p-5 sm:p-6 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900 font-serif">
                1. Legal Enterprise &amp; Authorized Signatory Profile
              </h3>
              <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-900 font-bold text-[10.5px]">
                KYC Authenticated
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
              <div>
                <span className="text-slate-400 font-semibold block uppercase text-[10px]">Enterprise Legal Name</span>
                <p className="font-bold text-slate-900 mt-0.5">{application.enterpriseName}</p>
                <p className="text-slate-500 text-[11px]">CIN: U28112PN2015PTC154892 • PAN: AABCD1234E</p>
              </div>

              <div>
                <span className="text-slate-400 font-semibold block uppercase text-[10px]">Authorized Signatory</span>
                <p className="font-bold text-slate-900 mt-0.5">{application.applicantName}</p>
                <p className="text-slate-500 text-[11px]">{application.applicantDesignation} (Aadhaar: XXXX-4819)</p>
              </div>

              <div>
                <span className="text-slate-400 font-semibold block uppercase text-[10px]">Statutory Registration</span>
                <p className="font-bold text-slate-800 mt-0.5">UDYAM-MH-26-0048123</p>
                <p className="text-slate-500 text-[11px]">Registered Address: Plot B-14, Chakan MIDC, Pune</p>
              </div>
            </div>
          </div>

          {/* Section 2: Industrial Siting & Technical Parameters */}
          <div className="p-5 sm:p-6 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900 font-serif">
                2. Siting Location &amp; Manufacturing Scope
              </h3>
              <button
                type="button"
                onClick={() => navigate('/applicant/applications/cte')}
                className="text-blue-900 hover:underline text-xs font-semibold cursor-pointer"
              >
                Edit Parameters ↗
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 pt-2">
              <div>
                <span className="text-slate-400 font-semibold block uppercase text-[10px]">Project Siting</span>
                <p className="font-bold text-slate-900 mt-0.5">{params.plotOrSurveyNumber}</p>
                <p className="text-slate-500 text-[11px]">{params.midcArea}, {params.district}</p>
              </div>

              <div>
                <span className="text-slate-400 font-semibold block uppercase text-[10px]">Capital Investment</span>
                <p className="font-bold text-blue-950 font-mono mt-0.5">₹{params.proposedCapitalInvestmentCr} Crores</p>
                <p className="text-slate-500 text-[11px]">Gross Fixed Assets</p>
              </div>

              <div>
                <span className="text-slate-400 font-semibold block uppercase text-[10px]">Area Allocation</span>
                <p className="font-bold text-slate-800 mt-0.5">{params.landAreaAcres} Acres Land</p>
                <p className="text-slate-500 text-[11px]">Built-up: {params.totalBuiltUpAreaSqMeters.toLocaleString('en-IN')} sq.m</p>
              </div>

              <div>
                <span className="text-slate-400 font-semibold block uppercase text-[10px]">Workforce &amp; Power</span>
                <p className="font-bold text-slate-800 mt-0.5">{params.numberOfWorkers} Personnel ({params.operationalShifts} Shifts)</p>
                <p className="text-slate-500 text-[11px]">Demand: {params.powerRequirementKva} kVA</p>
              </div>
            </div>

            <div className="mt-3 p-3 bg-slate-50 rounded-xl border border-slate-200">
              <span className="text-slate-500 font-bold block mb-1">Declared Manufacturing Process:</span>
              <p className="text-slate-700 leading-relaxed">{params.manufacturingActivity}</p>
            </div>
          </div>

          {/* Section 3: MPCB Environmental Profile & Controls */}
          <div className="p-5 sm:p-6 space-y-3">
            <h3 className="text-sm font-bold text-slate-900 font-serif">
              3. Water Balance, Effluent &amp; Atmospheric Emissions (MPCB Specifics)
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
              <div className="space-y-1">
                <span className="text-slate-400 font-semibold block uppercase text-[10px]">Water Balance</span>
                <p className="text-slate-700">Daily Demand: <strong className="text-slate-900">{params.waterRequirementKld} KLD</strong></p>
                <p className="text-slate-700">Trade Effluent: <strong className="text-slate-900">{params.tradeEffluentKld} KLD</strong></p>
                <p className="text-slate-700">Domestic Sewage: <strong className="text-slate-900">{params.domesticEffluentKld} KLD</strong></p>
              </div>

              <div className="space-y-1">
                <span className="text-slate-400 font-semibold block uppercase text-[10px]">Effluent Treatment Scheme</span>
                <p className="font-bold text-blue-900">{params.effluentTreatmentPlan}</p>
                <p className="text-slate-500 text-[11px]">Primary neutralization with discharge into MIDC Common ETP</p>
              </div>

              <div className="space-y-1">
                <span className="text-slate-400 font-semibold block uppercase text-[10px]">Hazardous Waste &amp; Stacks</span>
                <p className="text-slate-700">Category: <strong className="text-slate-900">{params.hazardousWasteCategory}</strong></p>
                <p className="text-slate-700">CHWTSDF: <strong className="text-slate-900">{params.chwtsdfMembership}</strong></p>
                <p className="text-slate-700">DG Set: <strong className="text-slate-900">{params.dgSetCapacityKva} kVA ({params.fuelType})</strong></p>
              </div>
            </div>
          </div>

          {/* Section 4: Attached Statutory Documents & Locker IDs */}
          <div className="p-5 sm:p-6 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900 font-serif">
                4. Statutory Documents Docket ({application.requiredDocuments.length} Records)
              </h3>
              <button
                type="button"
                onClick={() => navigate('/applicant/applications/cte/documents')}
                className="text-blue-900 hover:underline text-xs font-semibold cursor-pointer"
              >
                Modify Documents ↗
              </button>
            </div>

            <div className="border border-slate-200 rounded-xl overflow-hidden">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold uppercase text-[10px]">
                  <tr>
                    <th className="p-3">Statutory Requirement</th>
                    <th className="p-3">Attached Locker Credential</th>
                    <th className="p-3">Version</th>
                    <th className="p-3 text-right">Verification Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {application.requiredDocuments.map((req) => (
                    <tr key={req.requirementId} className="hover:bg-slate-50/50">
                      <td className="p-3 font-semibold text-slate-800">
                        {req.documentType}
                        <span className="block text-[10.5px] text-slate-400 font-normal">
                          {req.statutorySource}
                        </span>
                      </td>
                      <td className="p-3 text-slate-700">
                        {req.linkedDocumentName ? (
                          <div>
                            <span className="font-semibold text-slate-900">{req.linkedDocumentName}</span>
                            <span className="block text-[10px] text-slate-400 font-mono">
                              Doc No: {req.linkedDocumentNumber}
                            </span>
                          </div>
                        ) : (
                          <span className="text-rose-600 font-bold italic">Not Attached</span>
                        )}
                      </td>
                      <td className="p-3 font-mono text-slate-600">
                        {req.linkedVersionId || '—'}
                      </td>
                      <td className="p-3 text-right">
                        {req.validationState === 'Ready' && (
                          <span className="px-2 py-0.5 rounded-full text-[10.5px] font-bold bg-emerald-100 text-emerald-900 border border-emerald-300">
                            ✓ Verified in Locker
                          </span>
                        )}
                        {req.validationState === 'Pending Verification' && (
                          <span className="px-2 py-0.5 rounded-full text-[10.5px] font-bold bg-amber-100 text-amber-900 border border-amber-300">
                            ⏳ Pending Scrutiny
                          </span>
                        )}
                        {req.validationState === 'Missing' && (
                          <span className="px-2 py-0.5 rounded-full text-[10.5px] font-bold bg-rose-100 text-rose-900 border border-rose-300">
                            ⚠️ Missing
                          </span>
                        )}
                        {req.validationState === 'Expired' && (
                          <span className="px-2 py-0.5 rounded-full text-[10.5px] font-bold bg-red-100 text-red-900 border border-red-300">
                            ✕ Expired
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Statutory Declaration Section */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs p-5 sm:p-6 space-y-4">
          <div className="border-b border-slate-100 pb-3">
            <span className="text-[10px] uppercase font-bold text-blue-900 tracking-wider block">
              Legal Undertaking &amp; Affirmation
            </span>
            <h2 className="text-lg font-bold text-slate-900 font-serif">
              Statutory Declaration (Water Act 1974 &amp; Air Act 1981)
            </h2>
          </div>

          <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 text-xs text-slate-700 space-y-2.5 leading-relaxed">
            <div className="flex items-start gap-2">
              <span className="font-bold text-blue-950 shrink-0">1.</span>
              <p>
                <strong>Truth of Statements:</strong> I hereby solemnly affirm that the particulars furnished in this application for Consent to Establish (CTE) under Section 25 of the Water (Prevention and Control of Pollution) Act, 1974 and Section 21 of the Air (Prevention and Control of Pollution) Act, 1981 are true, complete, and correct to the best of my knowledge and belief.
              </p>
            </div>

            <div className="flex items-start gap-2">
              <span className="font-bold text-blue-950 shrink-0">2.</span>
              <p>
                <strong>Authenticity of Credentials:</strong> All drawings, process flowcharts, certificates, and board resolutions linked from the Statutory Document Locker are authentic, un-tampered, and legally binding records of {application.enterpriseName}.
              </p>
            </div>

            <div className="flex items-start gap-2">
              <span className="font-bold text-blue-950 shrink-0">3.</span>
              <p>
                <strong>Scrutiny &amp; Inspection Consent:</strong> The applicant company undertakes to permit designated field officers of the Maharashtra Pollution Control Board to enter, inspect, and verify the proposed industrial premises at all reasonable hours during the scrutiny cycle.
              </p>
            </div>

            <div className="flex items-start gap-2">
              <span className="font-bold text-blue-950 shrink-0">4.</span>
              <p>
                <strong>Liabilities for Misrepresentation:</strong> I acknowledge that any suppression of material facts, deliberate under-reporting of trade effluent or hazardous waste generation, or submission of counterfeit documents shall result in immediate summary revocation of Consent and prosecution under statutory penal provisions.
              </p>
            </div>
          </div>

          {/* Interactive Checkbox */}
          <div className="pt-2">
            <label className="flex items-start gap-3 p-4 rounded-xl border border-blue-200 bg-blue-50/50 hover:bg-blue-50 transition cursor-pointer">
              <input
                type="checkbox"
                checked={declarationAccepted}
                onChange={(e) => handleDeclarationToggle(e.target.checked)}
                disabled={isSubmitted}
                className="mt-0.5 w-4 h-4 rounded text-blue-900 focus:ring-blue-900 cursor-pointer"
              />
              <div className="text-xs">
                <strong className="text-blue-950 block font-bold">
                  I solemnly accept the Statutory Declaration and confirm my authority to execute this filing.
                </strong>
                <span className="text-slate-600 block mt-0.5">
                  Signatory: <strong>{application.applicantName}</strong> ({application.applicantDesignation}) • Entity: <strong>{application.enterpriseName}</strong>
                </span>
              </div>
            </label>
          </div>
        </div>

        {/* Submission Flow Preview Card */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs p-5 sm:p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <span className="text-[10px] uppercase font-bold text-blue-900 tracking-wider block">
                Single Window Lifecycle
              </span>
              <h3 className="text-sm font-bold text-slate-900 font-serif">
                Post-Submission Departmental Workflow Preview (Phase 7-8 Tracking)
              </h3>
            </div>
            <span className="px-2 py-0.5 rounded bg-blue-100 text-blue-900 text-[10.5px] font-bold">
              Institutional SLA: 30 Days
            </span>
          </div>

          {/* Flow Stepper Preview */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 pt-2 text-xs">
            <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-200 text-center space-y-1">
              <span className="w-6 h-6 rounded-full bg-emerald-600 text-white font-bold text-[11px] inline-flex items-center justify-center">
                1
              </span>
              <strong className="block font-bold text-emerald-950">Submitted</strong>
              <span className="text-[10.5px] text-emerald-800 block">Single Window Ingress</span>
            </div>

            <div className="p-3 bg-blue-50 rounded-xl border border-blue-200 text-center space-y-1">
              <span className="w-6 h-6 rounded-full bg-blue-900 text-white font-bold text-[11px] inline-flex items-center justify-center">
                2
              </span>
              <strong className="block font-bold text-blue-950">Officer Scrutiny</strong>
              <span className="text-[10.5px] text-blue-800 block">SRO Pune II desk check</span>
            </div>

            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-center space-y-1">
              <span className="w-6 h-6 rounded-full bg-slate-200 text-slate-700 font-bold text-[11px] inline-flex items-center justify-center">
                3
              </span>
              <strong className="block font-bold text-slate-800">Queries (if any)</strong>
              <span className="text-[10.5px] text-slate-500 block">7 days applicant SLA</span>
            </div>

            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-center space-y-1">
              <span className="w-6 h-6 rounded-full bg-slate-200 text-slate-700 font-bold text-[11px] inline-flex items-center justify-center">
                4
              </span>
              <strong className="block font-bold text-slate-800">Site Inspection</strong>
              <span className="text-[10.5px] text-slate-500 block">GPS geo-tagged visit</span>
            </div>

            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-center space-y-1 col-span-2 sm:col-span-1">
              <span className="w-6 h-6 rounded-full bg-slate-200 text-slate-700 font-bold text-[11px] inline-flex items-center justify-center">
                5
              </span>
              <strong className="block font-bold text-slate-800">Consent Order</strong>
              <span className="text-[10.5px] text-slate-500 block">Digital CTE issued</span>
            </div>
          </div>
        </div>

        {/* Error Notification if Submission Blocked */}
        {submissionError && (
          <div className="p-4 bg-rose-50 border border-rose-300 rounded-xl text-xs font-semibold text-rose-900 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="text-base">⚠️</span>
              <span>{submissionError}</span>
            </div>
            <button
              type="button"
              onClick={() => setSubmissionError(null)}
              className="text-xs font-bold text-rose-700 hover:text-rose-900 cursor-pointer"
            >
              ✕
            </button>
          </div>
        )}

        {/* Bottom Submission Action Bar */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <button
            type="button"
            onClick={() => navigate('/applicant/applications/cte/documents')}
            className="px-4 py-2.5 rounded-xl border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-semibold transition cursor-pointer self-start sm:self-auto"
          >
            ← Back to Step 2: Documents
          </button>

          <div className="flex items-center gap-3">
            {isSubmitted ? (
              <button
                type="button"
                onClick={() => setShowConfirmationModal(true)}
                className="px-6 py-2.5 rounded-xl bg-emerald-800 hover:bg-emerald-900 text-white text-xs font-bold shadow-xs transition flex items-center gap-2 cursor-pointer"
              >
                <span>View Digital Submission Receipt</span>
                <span>📄</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={handleFinalSubmit}
                disabled={isSubmitting || !declarationAccepted || !readiness.isReadyForReview}
                className={`px-7 py-3 rounded-xl text-xs font-bold shadow-xs transition flex items-center gap-2 cursor-pointer ${
                  declarationAccepted && readiness.isReadyForReview
                    ? 'bg-blue-900 hover:bg-blue-800 text-white'
                    : 'bg-slate-300 text-slate-500 cursor-not-allowed'
                }`}
              >
                <span>{isSubmitting ? 'Submitting Application...' : 'Submit Application (MahaUdyam One)'}</span>
                <span>🚀</span>
              </button>
            )}
          </div>
        </div>

        {/* Submission Acknowledgement Modal */}
        {showConfirmationModal && (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
            <div className="bg-white w-full max-w-xl rounded-3xl border border-slate-200 shadow-2xl overflow-hidden animate-in fade-in zoom-in duration-200">
              {/* Receipt Header */}
              <div className="bg-[#0f2b48] text-white p-6 text-center space-y-2">
                <div className="w-12 h-12 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-400/30 flex items-center justify-center text-2xl mx-auto">
                  ✓
                </div>
                <h3 className="text-xl font-bold font-serif">
                  Statutory Filing Formally Submitted
                </h3>
                <p className="text-xs text-blue-200">
                  Government of Maharashtra • Single Window Clearance System
                </p>
              </div>

              {/* Receipt Body */}
              <div className="p-6 space-y-4 text-xs">
                <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-3">
                  <div className="flex justify-between border-b border-slate-200 pb-2">
                    <span className="text-slate-500">Receipt Reference:</span>
                    <strong className="font-mono text-slate-900">{submissionReceipt}</strong>
                  </div>
                  <div className="flex justify-between border-b border-slate-200 pb-2">
                    <span className="text-slate-500">Application Number:</span>
                    <strong className="font-mono text-blue-950">{application.applicationNumber}</strong>
                  </div>
                  <div className="flex justify-between border-b border-slate-200 pb-2">
                    <span className="text-slate-500">Approval / Clearance:</span>
                    <span className="font-semibold text-slate-800 text-right">{application.approvalName}</span>
                  </div>
                  <div className="flex justify-between border-b border-slate-200 pb-2">
                    <span className="text-slate-500">Competent Authority:</span>
                    <span className="font-semibold text-slate-800 text-right">{application.department}</span>
                  </div>
                  <div className="flex justify-between border-b border-slate-200 pb-2">
                    <span className="text-slate-500">Nodal Sub-Regional Office:</span>
                    <span className="font-semibold text-slate-800">{application.submissionMetadata.assignedNodalOffice}</span>
                  </div>
                  <div className="flex justify-between border-b border-slate-200 pb-2">
                    <span className="text-slate-500">Authorized Signatory:</span>
                    <span className="font-semibold text-slate-800">{application.applicantName}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Statutory SLA Target:</span>
                    <span className="font-bold text-emerald-800 font-mono">30 Working Days (Maharashtra RTS Act)</span>
                  </div>
                </div>

                <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 text-[11px] text-amber-800">
                  <strong>Prototype Demonstration Notice:</strong> This application has been placed in the applicant's local dossier in `Submitted` status. In Phase 7 and 8, this record will be consumed by the Application Tracker, Scrutiny, and Inspection engines.
                </div>

                {/* Actions */}
                <div className="flex flex-col sm:flex-row items-center justify-end gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => window.print()}
                    className="w-full sm:w-auto px-4 py-2 border border-slate-300 rounded-xl text-slate-700 font-bold hover:bg-slate-50 cursor-pointer"
                  >
                    Print Acknowledgement Receipt
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowConfirmationModal(false);
                      navigate('/applicant/dashboard');
                    }}
                    className="w-full sm:w-auto px-5 py-2 bg-blue-900 hover:bg-blue-800 text-white rounded-xl font-bold cursor-pointer"
                  >
                    Go to Applicant Dashboard
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </ApplicantLayout>
  );
};
