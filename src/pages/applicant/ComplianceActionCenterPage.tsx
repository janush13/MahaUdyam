import React, { useState, useMemo } from 'react';
import { ApplicantLayout } from '../../components/layout/ApplicantLayout';
import { useRouter, Link } from '../../router/Router';
import { trackerService } from '../../services/trackerService';
import { documentVaultService } from '../../services/documentVaultService';
import { applicantService } from '../../services/applicantService';
import { ApplicationQuery, ApplicationInspection, RequestedDeliverable } from '../../types/tracker';
import { DocumentRecord } from '../../types/documentVault';

export const ComplianceActionCenterPage: React.FC = () => {
  const { navigate } = useRouter();

  // Queries & Inspections from service
  const [activeQuery, setActiveQuery] = useState<ApplicationQuery | undefined>(() =>
    trackerService.getActiveQuery()
  );
  const [activeInspection, setActiveInspection] = useState<ApplicationInspection | undefined>(() =>
    trackerService.getActiveInspection()
  );
  const vaultDocuments = useMemo(() => documentVaultService.getAllDocuments(), []);
  const activeEnterprise = useMemo(() => applicantService.getActiveEnterprise(), []);
  const profile = useMemo(() => applicantService.getProfile(), []);

  // Section Toggle: 'query' | 'inspection'
  const [activeSection, setActiveSection] = useState<'query' | 'inspection'>('query');

  // Response Form State
  const [responseText, setResponseText] = useState<string>(
    activeQuery?.applicantResponse?.responseText || ''
  );
  const [declarationAccepted, setDeclarationAccepted] = useState<boolean>(
    activeQuery?.applicantResponse?.declarationAccepted || false
  );

  // Vault Selection Modal State
  const [isVaultModalOpen, setIsVaultModalOpen] = useState<boolean>(false);
  const [targetDeliverableId, setTargetDeliverableId] = useState<string | null>(null);

  // Direct Mock File Upload Simulation State
  const [simulatedUploads, setSimulatedUploads] = useState<
    Array<{ fileName: string; fileSize: string; deliverableId: string }>
  >([]);

  // Submission feedback state
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error' | 'info';
    message: string;
    receiptNumber?: string;
  } | null>(null);

  const refreshData = () => {
    setActiveQuery(trackerService.getActiveQuery());
    setActiveInspection(trackerService.getActiveInspection());
  };

  // Open vault selector for deliverable
  const handleOpenVaultPicker = (delId: string) => {
    setTargetDeliverableId(delId);
    setIsVaultModalOpen(true);
  };

  // Attach document from vault
  const handleSelectVaultDoc = (doc: DocumentRecord) => {
    if (!activeQuery || !targetDeliverableId) return;

    const res = trackerService.linkDocumentToDeliverable(activeQuery.id, targetDeliverableId, doc.id);
    if (res.success) {
      refreshData();
      setIsVaultModalOpen(false);
      setTargetDeliverableId(null);
      setFeedback({ type: 'success', message: res.message });
    } else {
      setFeedback({ type: 'error', message: res.message });
    }
  };

  // Detach document
  const handleUnlinkDoc = (delId: string) => {
    if (!activeQuery) return;
    trackerService.unlinkDocumentFromDeliverable(activeQuery.id, delId);
    refreshData();
  };

  // Quick-fill standard engineering response for testing
  const handleQuickFill = () => {
    setResponseText(
      'In reference to query QRY-2026-041 under Maharashtra Factories Rules 1963 Rule 65-B, we have revised the underground static fire water reservoir design from 150 KL to 220 KL capacity (exceeding the statutory 200 KL threshold). Stamped hydraulic sizing calculations prepared by Er. Sandeep Joshi (Chartered Fire Safety Engineer) are attached. Furthermore, the hydrant ring main isometric diagram (DWG No. DIPL-HYD-2026-R2) has been updated to incorporate 150mm MS Class C loop piping with pressure node calculations for the eastern assembly bay.'
    );
    setDeclarationAccepted(true);

    // Auto-link eligible vault drawings if not already linked
    if (activeQuery) {
      const dwgDoc = vaultDocuments.find((d) => d.id === 'doc-09') || vaultDocuments[0];
      const certDoc = vaultDocuments.find((d) => d.id === 'doc-08') || vaultDocuments[1];

      if (dwgDoc && activeQuery.requestedDeliverables[1]) {
        trackerService.linkDocumentToDeliverable(activeQuery.id, 'del-02', dwgDoc.id);
      }
      if (certDoc && activeQuery.requestedDeliverables[0]) {
        trackerService.linkDocumentToDeliverable(activeQuery.id, 'del-01', certDoc.id);
      }
      refreshData();
    }
  };

  // Submit Clarification
  const handleSubmitResponse = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeQuery) return;

    const res = trackerService.submitQueryResponse(activeQuery.id, {
      responseText,
      declarationAccepted,
      submittedByName: profile.name,
      additionalUploads: simulatedUploads,
    });

    if (res.success) {
      refreshData();
      setFeedback({
        type: 'success',
        message: res.message,
        receiptNumber: res.receiptNumber,
      });
    } else {
      setFeedback({
        type: 'error',
        message: res.message,
      });
    }
  };

  // Toggle inspection checklist item
  const handleToggleChecklist = (itemId: string) => {
    if (!activeInspection) return;
    trackerService.toggleChecklistItem(activeInspection.id, itemId);
    refreshData();
  };

  // Count ready checklist items
  const checklistReadyCount = activeInspection?.preparationChecklist.filter((i) => i.ready).length || 0;
  const checklistTotalCount = activeInspection?.preparationChecklist.length || 5;
  const checklistPercent = Math.round((checklistReadyCount / checklistTotalCount) * 100);

  return (
    <ApplicantLayout
      activeTab="compliance"
      breadcrumbs={[
        { label: 'Applications', href: '/applicant/applications' },
        { label: 'Compliance Action Center' },
      ]}
    >
      <div className="space-y-6 max-w-6xl mx-auto" data-purpose="screen-25-regulatory-compliance-center">
        {/* Top Header Banner */}
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-2xs">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-amber-600 text-white uppercase tracking-wider">
                  Compliance Action Center
                </span>
                <span className="text-xs text-slate-500">
                  Ref: Single Window Clearance Portal &bull; Pune Zone
                </span>
              </div>
              <h1 className="text-2xl font-serif font-bold text-slate-900 mt-1">
                Technical Queries &amp; Site Inspection Center
              </h1>
              <p className="text-xs text-slate-600 mt-0.5">
                Official applicant interface for responding to statutory departmental clarifications and preparing for joint on-site physical inspections.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <Link
                to="/applicant/applications/tracker"
                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 transition"
              >
                &larr; Project SLA Roadmap
              </Link>
              <Link
                to="/applicant/documents"
                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 transition"
              >
                Document Locker &rarr;
              </Link>
            </div>
          </div>

          {/* Section Switcher Tabs */}
          <div className="grid grid-cols-2 gap-3 mt-6 pt-4 border-t border-slate-100">
            <button
              onClick={() => setActiveSection('query')}
              className={`p-3.5 rounded-xl border text-left transition flex items-center justify-between ${
                activeSection === 'query'
                  ? 'border-amber-500 bg-amber-50/40 ring-1 ring-amber-500'
                  : 'border-slate-200 bg-slate-50/60 hover:bg-slate-50'
              }`}
            >
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <span className="text-amber-600 font-bold text-xs uppercase tracking-wider">
                    Technical Clarification
                  </span>
                  {activeQuery?.status === 'Open' && (
                    <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-200 text-amber-950 animate-pulse">
                      Action Required
                    </span>
                  )}
                  {activeQuery?.status === 'Response Submitted' && (
                    <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                      ✓ Response Filed
                    </span>
                  )}
                </div>
                <h4 className="text-xs font-bold text-slate-900 truncate max-w-xs sm:max-w-md">
                  {activeQuery?.subject || 'Statutory Department Clarification'}
                </h4>
              </div>
              <span className="text-xl">⚠️</span>
            </button>

            <button
              onClick={() => setActiveSection('inspection')}
              className={`p-3.5 rounded-xl border text-left transition flex items-center justify-between ${
                activeSection === 'inspection'
                  ? 'border-indigo-500 bg-indigo-50/40 ring-1 ring-indigo-500'
                  : 'border-slate-200 bg-slate-50/60 hover:bg-slate-50'
              }`}
            >
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <span className="text-indigo-600 font-bold text-xs uppercase tracking-wider">
                    Physical Site Inspection
                  </span>
                  <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-indigo-100 text-indigo-800">
                    28 Feb 2026
                  </span>
                </div>
                <h4 className="text-xs font-bold text-slate-900">
                  {activeInspection?.inspectionType || 'Joint Statutory Physical Inspection'}
                </h4>
              </div>
              <span className="text-xl">🔍</span>
            </button>
          </div>
        </div>

        {/* Feedback Banner */}
        {feedback && (
          <div
            className={`p-4 rounded-xl border text-xs flex items-start justify-between gap-3 shadow-2xs ${
              feedback.type === 'success'
                ? 'bg-emerald-50 text-emerald-950 border-emerald-300'
                : 'bg-rose-50 text-rose-950 border-rose-300'
            }`}
          >
            <div>
              <p className="font-bold">{feedback.message}</p>
              {feedback.receiptNumber && (
                <p className="font-mono mt-1 text-[11px] text-emerald-800 font-semibold">
                  Official Clarification Receipt: {feedback.receiptNumber}
                </p>
              )}
            </div>
            <button
              onClick={() => setFeedback(null)}
              className="text-slate-400 hover:text-slate-600 font-bold text-sm"
            >
              ✕
            </button>
          </div>
        )}

        {/* SECTION A: Technical Query Response Workspace */}
        {activeSection === 'query' && activeQuery && (
          <div className="space-y-6" data-purpose="screen-25-query-response">
            {/* Query Dossier Card */}
            <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-2xs space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-slate-100 gap-2">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-bold text-amber-950 bg-amber-100 px-2 py-0.5 rounded border border-amber-300">
                    {activeQuery.id}
                  </span>
                  <span className="font-mono text-xs text-slate-600 bg-slate-100 px-2 py-0.5 rounded">
                    App Ref: {activeQuery.applicationNumber}
                  </span>
                  <span
                    className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                      activeQuery.status === 'Response Submitted'
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-amber-100 text-amber-900'
                    }`}
                  >
                    {activeQuery.status}
                  </span>
                </div>

                <div className="text-xs text-slate-500">
                  Raised: <strong>{activeQuery.raisedAt}</strong> &bull; Due Date:{' '}
                  <strong className="text-amber-800 font-bold">
                    {activeQuery.dueDate} ({activeQuery.daysRemaining} days left)
                  </strong>
                </div>
              </div>

              <div>
                <h2 className="text-base font-bold text-slate-900">
                  {activeQuery.subject}
                </h2>
                <p className="text-xs text-slate-600 mt-1">
                  Department: <strong>{activeQuery.department}</strong> &bull; Scrutiny Officer:{' '}
                  <strong>{activeQuery.officerName}</strong> ({activeQuery.officerDesignation})
                </p>
                <p className="text-xs text-slate-500 font-mono mt-0.5">
                  Statutory Mandate: {activeQuery.statutoryReference}
                </p>
              </div>

              {/* Department Notice Box */}
              <div className="bg-amber-50/70 border border-amber-200 rounded-xl p-4 text-xs leading-relaxed text-slate-800 space-y-2">
                <div className="flex items-center gap-1.5 font-bold text-amber-900">
                  <span>🏛️ Official Scrutiny Observation:</span>
                </div>
                <p>{activeQuery.description}</p>
              </div>

              {/* Requested Deliverables & Evidence Checklist */}
              <div className="space-y-3 pt-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                    Requested Deliverables &amp; Evidence ({activeQuery.requestedDeliverables.length}):
                  </h3>
                  <span className="text-[11px] text-slate-500">
                    Mandatory items must have verified evidence attached prior to submission
                  </span>
                </div>

                <div className="space-y-3">
                  {activeQuery.requestedDeliverables.map((del) => (
                    <div
                      key={del.id}
                      className={`p-4 rounded-xl border transition ${
                        del.linkedDocumentId
                          ? 'border-emerald-300 bg-emerald-50/30'
                          : del.mandatory
                          ? 'border-amber-300 bg-amber-50/20'
                          : 'border-slate-200 bg-white'
                      }`}
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span
                              className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wider ${
                                del.mandatory
                                  ? 'bg-rose-100 text-rose-800'
                                  : 'bg-slate-100 text-slate-600'
                              }`}
                            >
                              {del.mandatory ? 'Mandatory' : 'Optional'}
                            </span>
                            <h4 className="text-xs font-bold text-slate-900">
                              {del.requirement}
                            </h4>
                          </div>
                          <p className="text-xs text-slate-600">{del.explanation}</p>
                          <p className="text-[11px] text-slate-500">
                            Required Document Type: <em>{del.requiredDocumentType}</em>
                          </p>
                        </div>

                        {/* Evidence Attachment State / Action */}
                        <div className="shrink-0 flex items-center gap-2">
                          {del.linkedDocumentId ? (
                            <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-lg border border-emerald-300 text-xs">
                              <span className="text-emerald-600 font-bold">✓ Attached:</span>
                              <span className="font-semibold text-slate-800 max-w-[160px] truncate">
                                {del.linkedDocumentName}
                              </span>
                              {activeQuery.status === 'Open' && (
                                <button
                                  type="button"
                                  onClick={() => handleUnlinkDoc(del.id)}
                                  className="text-slate-400 hover:text-rose-600 font-bold ml-1"
                                  title="Detach document"
                                >
                                  ✕
                                </button>
                              )}
                            </div>
                          ) : (
                            activeQuery.status === 'Open' && (
                              <button
                                type="button"
                                onClick={() => handleOpenVaultPicker(del.id)}
                                className="px-3 py-1.5 rounded-lg text-xs font-bold bg-[#0b2540] text-white hover:bg-[#123860] transition shadow-2xs flex items-center gap-1.5"
                              >
                                <span>📁</span>
                                <span>Attach from Vault</span>
                              </button>
                            )
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Applicant Clarification Response Form */}
            <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-2xs">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    Applicant Clarification &amp; Technical Justification
                  </h3>
                  <p className="text-xs text-slate-500">
                    Provide precise engineering explanation for the SRO scrutiny desk.
                  </p>
                </div>

                {activeQuery.status === 'Open' && (
                  <button
                    type="button"
                    onClick={handleQuickFill}
                    className="px-3 py-1 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg border border-blue-200 transition"
                  >
                    ⚡ Quick-Fill Standard Technical Response
                  </button>
                )}
              </div>

              {activeQuery.status === 'Response Submitted' ? (
                /* Submitted State Summary */
                <div className="mt-4 p-5 rounded-xl bg-emerald-50/70 border border-emerald-300 space-y-3 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-600" />
                    <span className="font-bold text-emerald-950 text-sm">
                      Clarification Response Filed Successfully
                    </span>
                    <span className="text-slate-500">
                      &bull; {activeQuery.applicantResponse?.submittedAt}
                    </span>
                  </div>

                  <div className="bg-white p-3.5 rounded-lg border border-emerald-200 text-slate-800 leading-relaxed">
                    {activeQuery.applicantResponse?.responseText}
                  </div>

                  <div>
                    <span className="font-bold text-emerald-950 block mb-1">
                      Submitted Evidence Attachments ({activeQuery.applicantResponse?.evidenceAttachments.length}):
                    </span>
                    <ul className="space-y-1">
                      {activeQuery.applicantResponse?.evidenceAttachments.map((att, idx) => (
                        <li key={idx} className="flex items-center gap-2 bg-white px-3 py-1.5 rounded border border-slate-200">
                          <span className="text-emerald-600 font-bold">✓</span>
                          <span className="font-semibold text-slate-900">{att.documentName}</span>
                          <span className="text-slate-400">&bull;</span>
                          <span className="text-slate-500 font-mono text-[11px]">{att.version}</span>
                          <span className="text-slate-400">&bull;</span>
                          <span className="text-slate-500 text-[11px]">{att.source}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <p className="text-[11px] text-emerald-800 font-medium pt-1">
                    Receipt Ref: ACK-QRY-2026-94812 &bull; Transmitted to Joint Director Rajesh V. Patil for final clearance review.
                  </p>
                </div>
              ) : (
                /* Editable Form */
                <form onSubmit={handleSubmitResponse} className="mt-4 space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-800 mb-1">
                      Detailed Technical Clarification Note <span className="text-rose-600">*</span>
                    </label>
                    <textarea
                      rows={5}
                      required
                      value={responseText}
                      onChange={(e) => setResponseText(e.target.value)}
                      placeholder="Explain the engineering revisions, static fire water reservoir hydraulic calculations, and updated isometric piping loop details..."
                      className="w-full text-xs p-3 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-600 bg-slate-50/40 text-slate-900 leading-relaxed font-sans"
                    />
                    <span className="text-[11px] text-slate-500">
                      Minimum 30 characters required. Currently: {responseText.trim().length} chars.
                    </span>
                  </div>

                  {/* Statutory Undertaking */}
                  <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 flex items-start gap-2.5">
                    <input
                      type="checkbox"
                      id="statutoryUndertaking"
                      required
                      checked={declarationAccepted}
                      onChange={(e) => setDeclarationAccepted(e.target.checked)}
                      className="mt-0.5 w-4 h-4 rounded text-blue-600 focus:ring-blue-500 border-slate-300"
                    />
                    <label htmlFor="statutoryUndertaking" className="text-xs text-slate-700 leading-snug cursor-pointer">
                      <strong>Statutory Declaration Undertaking:</strong> I hereby certify under Rule 65-B of the
                      Maharashtra Factories Rules, 1963 and National Building Code 2016 Part IV that the revised static
                      tank capacity calculations and engineering isometric drawings submitted herein are authentic and
                      vetted by a certified Chartered Safety Engineer.
                    </label>
                  </div>

                  <div className="flex items-center justify-between pt-2">
                    <span className="text-xs text-slate-500">
                      Authorizing Signatory: <strong>{profile.name}</strong> ({profile.designation})
                    </span>

                    <button
                      type="submit"
                      className="px-6 py-2.5 rounded-lg text-xs font-bold bg-[#0b2540] text-white hover:bg-[#123860] transition shadow-2xs flex items-center gap-2"
                    >
                      <span>🚀</span>
                      <span>Submit Clarification &amp; Evidence</span>
                    </button>
                  </div>
                </form>
              )}
            </div>

            {/* Query Audit Trail */}
            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-2xs space-y-3">
              <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                Clarification Audit Trail
              </h3>
              <div className="divide-y divide-slate-100 text-xs">
                {activeQuery.activityLog.map((log) => (
                  <div key={log.id} className="py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                    <div>
                      <span className="font-bold text-slate-800">{log.action}</span>
                      <span className="text-slate-400 mx-1.5">&bull;</span>
                      <span className="text-slate-600">{log.note}</span>
                    </div>
                    <span className="text-slate-400 text-[11px] shrink-0">{log.timestamp}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* SECTION B: Joint Statutory Physical Site Inspection */}
        {activeSection === 'inspection' && activeInspection && (
          <div className="space-y-6" data-purpose="screen-25-inspection-detail">
            {/* Inspection Identity Card */}
            <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-2xs space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-slate-100 gap-2">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-bold text-indigo-950 bg-indigo-100 px-2 py-0.5 rounded border border-indigo-300">
                    {activeInspection.id}
                  </span>
                  <span className="font-mono text-xs text-slate-600 bg-slate-100 px-2 py-0.5 rounded">
                    App Ref: {activeInspection.applicationNumber}
                  </span>
                  <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-indigo-100 text-indigo-900">
                    Status: {activeInspection.status}
                  </span>
                </div>

                <div className="text-xs text-indigo-900 font-bold bg-indigo-50 px-3 py-1 rounded-lg border border-indigo-200">
                  📅 Scheduled Date: {activeInspection.scheduledDate} &bull; {activeInspection.scheduledTime}
                </div>
              </div>

              <div>
                <h2 className="text-base font-bold text-slate-900">
                  {activeInspection.inspectionType}
                </h2>
                <p className="text-xs text-slate-600 mt-1">
                  Department: <strong>{activeInspection.department}</strong>
                </p>
                <p className="text-xs text-slate-700 mt-2 bg-slate-50 p-3 rounded-lg border border-slate-200 leading-relaxed">
                  <strong>Inspection Purpose:</strong> {activeInspection.purpose}
                </p>
              </div>

              {/* Inspecting Officers */}
              <div>
                <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-2">
                  Visiting Inspection Committee:
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  {activeInspection.inspectingOfficers.map((off, idx) => (
                    <div key={idx} className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                      <span className="font-bold text-slate-900 block">{off.name}</span>
                      <span className="text-slate-600 text-[11px] block">{off.designation}</span>
                      <span className="text-slate-500 text-[11px] block">{off.department}</span>
                      {off.phone && (
                        <span className="text-blue-700 text-[11px] font-mono mt-1 block">
                          📞 {off.phone}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Applicant Preparation Checklist Card */}
            <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-2xs space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-slate-100 gap-2">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    Site Preparation Checklist (Applicant Mandatory Compliance)
                  </h3>
                  <p className="text-xs text-slate-500">
                    Ensure the physical plant site conforms to all items prior to the inspecting officers' arrival.
                  </p>
                </div>

                <div className="text-right">
                  <span className="text-xs font-bold text-slate-900">
                    Readiness: {checklistReadyCount} of {checklistTotalCount} Items Ready ({checklistPercent}%)
                  </span>
                  <div className="w-36 h-2 bg-slate-200 rounded-full overflow-hidden mt-1">
                    <div
                      className={`h-full rounded-full transition-all ${
                        checklistPercent === 100 ? 'bg-emerald-500' : 'bg-indigo-600'
                      }`}
                      style={{ width: `${checklistPercent}%` }}
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-2.5">
                {activeInspection.preparationChecklist.map((item) => (
                  <div
                    key={item.id}
                    onClick={() => handleToggleChecklist(item.id)}
                    className={`p-3.5 rounded-xl border transition cursor-pointer flex items-start justify-between gap-3 text-xs ${
                      item.ready
                        ? 'bg-emerald-50/40 border-emerald-300'
                        : 'bg-slate-50/70 border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        checked={item.ready}
                        onChange={() => {}} // handled by parent div
                        className="mt-0.5 w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 border-slate-300 cursor-pointer"
                      />
                      <div>
                        <span className={`font-semibold ${item.ready ? 'text-emerald-950' : 'text-slate-800'}`}>
                          {item.item}
                        </span>
                        {item.notes && (
                          <p className="text-slate-500 text-[11px] mt-0.5">Note: {item.notes}</p>
                        )}
                      </div>
                    </div>

                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider shrink-0 ${
                        item.ready
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-amber-100 text-amber-900'
                      }`}
                    >
                      {item.ready ? '✓ Ready' : 'Pending'}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Documents to Keep Ready at Site */}
            <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-2xs space-y-3">
              <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                Original Physical Documents to Station at Site Office:
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                {activeInspection.documentsToKeepReady.map((docName, idx) => (
                  <div key={idx} className="p-3 rounded-lg bg-slate-50 border border-slate-200 flex items-center gap-2">
                    <span className="text-blue-600 font-bold">📄</span>
                    <span className="font-semibold text-slate-800">{docName}</span>
                  </div>
                ))}
              </div>

              <div className="mt-4 p-4 rounded-xl bg-blue-50/60 border border-blue-200 text-xs text-blue-900 leading-relaxed space-y-1">
                <span className="font-bold block">📌 Mandatory Applicant Protocol:</span>
                <p>{activeInspection.applicantInstructions}</p>
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => alert('Official Statutory Inspection Notice PDF (MFS/PUN/2026/INS-0814) downloaded.')}
                  className="px-4 py-2 rounded-lg text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-300 transition flex items-center gap-1.5"
                >
                  <span>📥</span>
                  <span>Download Formal Inspection Call Letter</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Modal: Select Document from Statutory Document Vault */}
        {isVaultModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
            <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[85vh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden">
              <div className="px-6 py-4 bg-[#0b2540] text-white flex items-center justify-between">
                <div>
                  <h3 className="font-serif font-bold text-base">
                    Select Evidence Document from Statutory Vault
                  </h3>
                  <p className="text-xs text-slate-300">
                    Attach pre-verified certificates and drawings from DigiLocker or statutory locker.
                  </p>
                </div>
                <button
                  onClick={() => {
                    setIsVaultModalOpen(false);
                    setTargetDeliverableId(null);
                  }}
                  className="text-slate-300 hover:text-white font-bold text-lg"
                >
                  ✕
                </button>
              </div>

              <div className="p-6 overflow-y-auto divide-y divide-slate-100 space-y-3">
                {vaultDocuments.map((doc) => (
                  <div
                    key={doc.id}
                    className="pt-3 first:pt-0 flex items-center justify-between gap-3 text-xs"
                  >
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-900">{doc.documentName}</span>
                        <span className="font-mono text-[11px] bg-slate-100 px-1.5 py-0.5 rounded text-slate-600">
                          {doc.currentVersionId}
                        </span>
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-100 text-emerald-800">
                          ✓ {doc.verificationStatus}
                        </span>
                      </div>
                      <p className="text-slate-500 text-[11px]">
                        {doc.issuingAuthority} &bull; Ref: {doc.documentNumber}
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleSelectVaultDoc(doc)}
                      className="px-3 py-1.5 rounded-lg text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white shrink-0 transition"
                    >
                      Attach
                    </button>
                  </div>
                ))}
              </div>

              <div className="px-6 py-3 bg-slate-50 border-t border-slate-200 flex justify-end">
                <button
                  type="button"
                  onClick={() => {
                    setIsVaultModalOpen(false);
                    setTargetDeliverableId(null);
                  }}
                  className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-200 transition"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </ApplicantLayout>
  );
};
