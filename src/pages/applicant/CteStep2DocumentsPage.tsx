import React, { useState, useEffect } from 'react';
import { useRouter } from '../../router/Router';
import { ApplicantLayout } from '../../components/layout/ApplicantLayout';
import { ApplicationStepHeader } from '../../components/applicant/ApplicationStepHeader';
import { DocumentReuseModal } from '../../components/documents/DocumentReuseModal';
import { applicationService } from '../../services/applicationService';
import { documentVaultService } from '../../services/documentVaultService';
import { ApprovalApplication, ApplicationRequiredDocument, DocumentReadinessReport } from '../../types/application';
import { DocumentRecord } from '../../types/documentVault';

export const CteStep2DocumentsPage: React.FC = () => {
  const { navigate } = useRouter();
  const [application, setApplication] = useState<ApprovalApplication>(() =>
    applicationService.getOrCreateDraftApplication()
  );
  const [readiness, setReadiness] = useState<DocumentReadinessReport>(() =>
    applicationService.evaluateDocumentReadiness(application)
  );
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [activeReuseRequirement, setActiveReuseRequirement] = useState<ApplicationRequiredDocument | null>(null);
  const [isReuseModalOpen, setIsReuseModalOpen] = useState<boolean>(false);
  const [feedbackAlert, setFeedbackAlert] = useState<{ type: 'success' | 'warning' | 'error'; message: string } | null>(null);

  useEffect(() => {
    refreshData();
  }, []);

  const refreshData = () => {
    const app = applicationService.getOrCreateDraftApplication();
    setApplication({ ...app });
    setReadiness(applicationService.evaluateDocumentReadiness(app));
  };

  const showFeedback = (type: 'success' | 'warning' | 'error', message: string) => {
    setFeedbackAlert({ type, message });
    setTimeout(() => setFeedbackAlert(null), 5000);
  };

  const handleSaveDraft = () => {
    setIsSaving(true);
    applicationService.syncDocumentsWithVault(application);
    const updated = applicationService.getOrCreateDraftApplication();
    setApplication({ ...updated });
    setReadiness(applicationService.evaluateDocumentReadiness(updated));
    setIsSaving(false);
    setSaveMessage('Draft saved at ' + new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }));
    setTimeout(() => setSaveMessage(null), 3000);
  };

  const handleOpenReuseModal = (req: ApplicationRequiredDocument) => {
    setActiveReuseRequirement(req);
    setIsReuseModalOpen(true);
  };

  const handleReuseSuccess = (reusedDoc: DocumentRecord) => {
    if (!activeReuseRequirement) return;

    const res = applicationService.linkDocumentToRequirement(
      activeReuseRequirement.requirementId,
      reusedDoc.id
    );

    if (res.success) {
      showFeedback('success', `Attached "${reusedDoc.documentName}" from Statutory Locker.`);
      refreshData();
    } else {
      showFeedback('error', res.message);
    }
    setIsReuseModalOpen(false);
    setActiveReuseRequirement(null);
  };

  const handleUnlink = (reqId: string, docName?: string) => {
    applicationService.unlinkDocumentFromRequirement(reqId);
    showFeedback('warning', `Detached "${docName || 'document'}". Requirement marked as Missing.`);
    refreshData();
  };

  /**
   * Prototype Sandbox helper: Fast-tracks verification of pending locker document
   * to demonstrate full submission qualification without modifying real government records.
   */
  const handleSimulateLockerApproval = (docId?: string) => {
    if (!docId) return;
    const res = documentVaultService.verifyDocumentForPrototype(docId);
    if (res.success) {
      applicationService.syncDocumentsWithVault(application);
      refreshData();
      showFeedback('success', res.message);
    } else {
      showFeedback('error', res.message);
    }
  };

  const handleContinue = () => {
    applicationService.setCurrentStep(3);
    navigate('/applicant/applications/cte/review');
  };

  return (
    <ApplicantLayout
      activeTab="discovery"
      breadcrumbs={[
        { label: 'Applications', href: '/applicant/dashboard' },
        { label: 'Consent to Establish (CTE)', href: '/applicant/applications/cte' },
        { label: 'Step 2: Document Validation' },
      ]}
    >
      <div className="space-y-6 max-w-6xl mx-auto" data-purpose="screen-22-document-validation">
        {/* Top Stepper Header */}
        <ApplicationStepHeader
          application={application}
          currentStep={2}
          onSaveDraft={handleSaveDraft}
          isSaving={isSaving}
          saveMessage={saveMessage}
        />

        {/* Feedback Alert if triggered */}
        {feedbackAlert && (
          <div
            className={`p-4 rounded-xl border text-xs font-semibold flex items-center justify-between gap-3 ${
              feedbackAlert.type === 'success'
                ? 'bg-emerald-50 text-emerald-900 border-emerald-300'
                : feedbackAlert.type === 'warning'
                ? 'bg-amber-50 text-amber-900 border-amber-300'
                : 'bg-rose-50 text-rose-900 border-rose-300'
            }`}
          >
            <span>{feedbackAlert.message}</span>
            <button
              type="button"
              onClick={() => setFeedbackAlert(null)}
              className="text-xs font-bold text-slate-500 hover:text-slate-800 cursor-pointer"
            >
              ✕
            </button>
          </div>
        )}

        {/* Document Readiness Summary Metrics Card */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs p-5 sm:p-6 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
            <div>
              <span className="text-[10.5px] font-bold uppercase tracking-wider text-blue-900 block mb-0.5">
                Statutory Document Readiness Audit
              </span>
              <h2 className="text-lg font-bold text-slate-900 font-serif">
                Clearance Document Validation Matrix (MPCB CTE)
              </h2>
            </div>

            {/* Overall State Badge */}
            <div>
              {readiness.isReadyForReview ? (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-900 border border-emerald-300">
                  <span className="w-2 h-2 rounded-full bg-emerald-600 animate-pulse" />
                  Ready for Review ({readiness.verifiedAndReady}/{readiness.totalRequired})
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-900 border border-amber-300">
                  <span className="w-2 h-2 rounded-full bg-amber-600" />
                  Action Required ({readiness.verifiedAndReady}/{readiness.totalRequired} Ready)
                </span>
              )}
            </div>
          </div>

          {/* KPI Metrics Strip */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
              <span className="text-[10px] text-slate-400 font-bold uppercase block">
                Total Required
              </span>
              <span className="text-xl font-bold font-mono text-slate-900">
                {readiness.totalRequired}
              </span>
            </div>

            <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-200">
              <span className="text-[10px] text-emerald-700 font-bold uppercase block">
                Verified &amp; Ready
              </span>
              <span className="text-xl font-bold font-mono text-emerald-800">
                {readiness.verifiedAndReady}
              </span>
            </div>

            <div className="p-3 bg-amber-50 rounded-xl border border-amber-200">
              <span className="text-[10px] text-amber-700 font-bold uppercase block">
                Pending Scrutiny
              </span>
              <span className="text-xl font-bold font-mono text-amber-800">
                {readiness.pendingVerification}
              </span>
            </div>

            <div className="p-3 bg-rose-50 rounded-xl border border-rose-200">
              <span className="text-[10px] text-rose-700 font-bold uppercase block">
                Missing Attachments
              </span>
              <span className="text-xl font-bold font-mono text-rose-800">
                {readiness.missing}
              </span>
            </div>

            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 col-span-2 sm:col-span-1">
              <span className="text-[10px] text-slate-400 font-bold uppercase block">
                Expired Certificates
              </span>
              <span className="text-xl font-bold font-mono text-slate-600">
                {readiness.expired}
              </span>
            </div>
          </div>

          {/* Readiness Status Explanation */}
          {readiness.isReadyForReview ? (
            <div className="p-4 bg-emerald-50/80 rounded-xl border border-emerald-200 text-xs text-emerald-900 flex items-start gap-3">
              <span className="text-lg shrink-0">✅</span>
              <div>
                <strong className="font-bold block mb-0.5">
                  All Mandatory Statutory Documents Pre-Authenticated!
                </strong>
                <span>
                  Every required certificate and technical plan has been pre-verified through your Statutory Document Locker (NeGD DigiLocker / MahaOnline). No re-upload or physical gazetted attestation is required.
                </span>
              </div>
            </div>
          ) : (
            <div className="p-4 bg-amber-50/90 rounded-xl border border-amber-300 text-xs text-amber-900 flex items-start gap-3">
              <span className="text-lg shrink-0">⚠️</span>
              <div className="space-y-1">
                <strong className="font-bold block">
                  Statutory Submission Blocked until Requirements are Resolved:
                </strong>
                <ul className="list-disc list-inside space-y-0.5 text-[11.5px]">
                  {readiness.blockingReasons.map((reason, idx) => (
                    <li key={idx}>{reason}</li>
                  ))}
                </ul>
                <span className="text-[11px] text-amber-800 block pt-1 italic">
                  Note: You may proceed to review the application summary, but final digital submission will require all mandatory documents to be verified.
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Required Documents Interactive List */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-600">
              Statutory Docket Requirements (Water Act Sec 25 &amp; Air Act Sec 21)
            </h3>
            <span className="text-xs text-slate-400">
              Auto-linked from Phase 5 Statutory Document Locker
            </span>
          </div>

          {application.requiredDocuments.map((req, idx) => {
            const isReady = req.validationState === 'Ready';
            const isPending = req.validationState === 'Pending Verification';
            const isMissing = req.validationState === 'Missing';
            const isExpired = req.validationState === 'Expired';

            return (
              <div
                key={req.requirementId}
                className={`bg-white rounded-2xl border transition shadow-2xs overflow-hidden ${
                  isReady
                    ? 'border-slate-200'
                    : isPending
                    ? 'border-amber-300 bg-amber-50/20'
                    : isExpired
                    ? 'border-rose-300 bg-rose-50/20'
                    : 'border-slate-300'
                }`}
              >
                <div className="p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                  {/* Left Column: Requirement Metadata */}
                  <div className="space-y-2 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="w-5 h-5 rounded-full bg-slate-100 flex items-center justify-center text-[10px] font-bold text-slate-600">
                        {idx + 1}
                      </span>
                      <span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-700">
                        {req.category}
                      </span>
                      {req.mandatory && (
                        <span className="text-[10.5px] font-bold px-2 py-0.5 rounded bg-rose-100 text-rose-800 border border-rose-200">
                          Mandatory
                        </span>
                      )}
                      <span className="text-xs text-slate-400">•</span>
                      <span className="text-xs text-slate-500 font-medium italic">
                        ⚖️ {req.statutorySource}
                      </span>
                    </div>

                    <h4 className="text-sm sm:text-base font-bold text-slate-900">
                      {req.documentType}
                    </h4>

                    <p className="text-xs text-slate-600 leading-relaxed max-w-3xl">
                      {req.description}
                    </p>

                    {/* Attached Document Details Badge */}
                    {req.linkedDocumentId && (
                      <div className="mt-2.5 p-3 rounded-xl bg-slate-50 border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-slate-900">
                              📄 {req.linkedDocumentName}
                            </span>
                            <span className="px-1.5 py-0.5 bg-blue-100 text-blue-900 rounded font-mono font-bold text-[10px]">
                              {req.linkedVersionId}
                            </span>
                          </div>
                          <p className="text-slate-500 text-[11px]">
                            Document No: <strong className="text-slate-700">{req.linkedDocumentNumber}</strong>
                            {req.linkedExpiryDate && (
                              <span> • Expiry: <strong className="text-slate-700">{req.linkedExpiryDate}</strong></span>
                            )}
                          </p>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {isReady && (
                            <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-900 border border-emerald-300">
                              ✓ Verified in Locker
                            </span>
                          )}
                          {isPending && (
                            <div className="flex items-center gap-2">
                              <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-100 text-amber-900 border border-amber-300">
                                ⏳ Pending Scrutiny
                              </span>
                              {/* Sandbox Simulation button */}
                              <button
                                type="button"
                                onClick={() => handleSimulateLockerApproval(req.linkedDocumentId)}
                                className="px-2 py-1 bg-amber-700 hover:bg-amber-800 text-white rounded text-[10.5px] font-bold transition cursor-pointer"
                                title="Accelerate verification for prototype demonstration"
                              >
                                Accelerate in Sandbox
                              </button>
                            </div>
                          )}
                          {isExpired && (
                            <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-rose-100 text-rose-900 border border-rose-300">
                              ⚠️ Expired
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Right Column: Actions */}
                  <div className="flex flex-row lg:flex-col items-center lg:items-end justify-between lg:justify-center gap-2 shrink-0 border-t lg:border-t-0 pt-3 lg:pt-0 border-slate-100">
                    {/* Reuse Button */}
                    <button
                      type="button"
                      onClick={() => handleOpenReuseModal(req)}
                      className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                        isReady
                          ? 'bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-300'
                          : 'bg-blue-900 hover:bg-blue-800 text-white shadow-xs'
                      }`}
                    >
                      <span>📁</span>
                      <span>{req.linkedDocumentId ? 'Change Attached File' : 'Use Existing Verified Document'}</span>
                    </button>

                    {req.linkedDocumentId && (
                      <button
                        type="button"
                        onClick={() => handleUnlink(req.requirementId, req.linkedDocumentName)}
                        className="text-[11px] font-semibold text-slate-500 hover:text-rose-600 transition cursor-pointer"
                      >
                        Detach Record
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Statutory Rule Disclaimer */}
        <div className="p-4 bg-slate-100 rounded-xl border border-slate-200 text-xs text-slate-600 text-center italic">
          Prototype rule — statutory validation required by competent authority (Maharashtra Pollution Control Board).
        </div>

        {/* Bottom Navigation Toolbar */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <button
            type="button"
            onClick={() => navigate('/applicant/applications/cte')}
            className="px-4 py-2.5 rounded-xl border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-semibold transition cursor-pointer self-start sm:self-auto"
          >
            ← Back to Step 1: Parameters
          </button>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleSaveDraft}
              disabled={isSaving}
              className="px-4 py-2.5 rounded-xl border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-bold transition cursor-pointer"
            >
              {isSaving ? 'Saving...' : '💾 Save Draft'}
            </button>

            <button
              type="button"
              onClick={handleContinue}
              className="px-6 py-2.5 rounded-xl bg-blue-900 hover:bg-blue-800 text-white text-xs font-bold shadow-xs transition flex items-center gap-2 cursor-pointer"
            >
              <span>Continue to Step 3: Review &amp; Submission</span>
              <span>→</span>
            </button>
          </div>
        </div>

        {/* Document Reuse Modal from Phase 5 */}
        <DocumentReuseModal
          isOpen={isReuseModalOpen}
          onClose={() => {
            setIsReuseModalOpen(false);
            setActiveReuseRequirement(null);
          }}
          onSuccess={handleReuseSuccess}
          preselectedRequirement={
            activeReuseRequirement
              ? {
                  requirementName: activeReuseRequirement.documentType,
                  clearanceCode: application.serviceCode,
                  clearanceName: application.approvalName,
                  category: activeReuseRequirement.category,
                }
              : undefined
          }
        />
      </div>
    </ApplicantLayout>
  );
};
