import React, { useState, useMemo } from 'react';
import { ApplicantLayout } from '../../components/layout/ApplicantLayout';
import { useRouter, Link } from '../../router/Router';
import { trackerService } from '../../services/trackerService';
import { applicationService } from '../../services/applicationService';
import { applicantService } from '../../services/applicantService';
import { documentVaultService } from '../../services/documentVaultService';
import { DepartmentDossier, SLATimelineStage } from '../../types/tracker';

export const ApplicationTrackerPage: React.FC = () => {
  const { currentPath, navigate } = useRouter();

  // Active Tab in Tracker
  const [activeTab, setActiveTab] = useState<'timeline' | 'dossiers' | 'documents' | 'queries' | 'inspections' | 'activity'>('timeline');

  // Query parameter for application
  const appNumberParam = useMemo(() => {
    try {
      const search = currentPath.includes('?')
        ? currentPath.split('?')[1]
        : typeof window !== 'undefined'
        ? window.location.search
        : '';
      return new URLSearchParams(search).get('appNumber') || undefined;
    } catch {
      return undefined;
    }
  }, [currentPath]);

  // Services data
  const dossiers = useMemo(() => trackerService.getDepartmentDossiers(), []);
  const activeEnterprise = useMemo(() => applicantService.getActiveEnterprise(), []);
  const activeProject = useMemo(() => applicantService.getActiveProject(), []);
  const cteApp = useMemo(() => applicationService.getOrCreateDraftApplication(), []);
  const activeQuery = useMemo(() => trackerService.getActiveQuery(), []);
  const activeInspection = useMemo(() => trackerService.getActiveInspection(), []);
  const vaultDocs = useMemo(() => documentVaultService.getAllDocuments(), []);

  // Selected Dossier
  const selectedDossier = useMemo(() => {
    if (appNumberParam) {
      const match = dossiers.find((d) => d.applicationNumber === appNumberParam);
      if (match) return match;
    }
    // Default to MPCB CTE or DISH
    return dossiers.find((d) => d.isCTE) || dossiers[0];
  }, [dossiers, appNumberParam]);

  // Timeline for selected dossier
  const timelineStages = useMemo(() => {
    return trackerService.getSlaTimeline(selectedDossier?.applicationNumber);
  }, [selectedDossier]);

  // Attached documents from CTE or Vault
  const attachedDocs = useMemo(() => {
    if (selectedDossier.isCTE) {
      return cteApp.requiredDocuments;
    }
    // For other dossiers, synthesize related documents from vault
    return vaultDocs.slice(0, 5).map((d) => ({
      requirementId: d.id,
      documentType: d.documentType,
      category: 'Technical & Project' as const,
      mandatory: true,
      statutorySource: d.issuingAuthority,
      description: d.description,
      validationState: 'Ready' as const,
      linkedDocumentId: d.id,
      linkedVersionId: d.currentVersionId,
      linkedDocumentName: d.documentName,
      linkedDocumentNumber: d.documentNumber,
      linkedVerificationStatus: d.verificationStatus,
      linkedExpiryDate: d.expiryDate || undefined,
    }));
  }, [selectedDossier, cteApp, vaultDocs]);

  const percent = Math.min(
    100,
    Math.round((selectedDossier.slaDaysElapsed / selectedDossier.slaTargetDays) * 100)
  );

  return (
    <ApplicantLayout
      activeTab="applications"
      breadcrumbs={[
        { label: 'My Applications', href: '/applicant/applications' },
        { label: `${selectedDossier.serviceCode} Tracker` },
      ]}
    >
      <div className="space-y-6 max-w-7xl mx-auto" data-purpose="screen-24-detailed-tracker">
        {/* Top Header Card */}
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-2xs">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div>
              <div className="flex flex-wrap items-center gap-2 mb-1.5">
                <Link
                  to="/applicant/applications"
                  className="text-xs text-blue-700 hover:underline font-semibold flex items-center gap-1"
                >
                  &larr; Back to Applications
                </Link>
                <span className="text-slate-300">|</span>
                <span className="font-mono text-xs font-bold text-slate-800 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                  {selectedDossier.applicationNumber}
                </span>
                <span className="text-xs text-slate-500 font-medium">
                  {selectedDossier.serviceCode}
                </span>
                <span
                  className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                    selectedDossier.status === 'Approved'
                      ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                      : selectedDossier.status === 'Query Raised'
                      ? 'bg-amber-100 text-amber-900 border border-amber-300'
                      : selectedDossier.status === 'Under Scrutiny'
                      ? 'bg-blue-100 text-blue-800 border border-blue-200'
                      : 'bg-indigo-100 text-indigo-800 border border-indigo-200'
                  }`}
                >
                  {selectedDossier.status}
                </span>
              </div>

              <h1 className="text-2xl font-serif font-bold text-slate-900 leading-tight">
                {selectedDossier.serviceName}
              </h1>

              <p className="text-xs text-slate-600 mt-1">
                <span className="font-semibold text-slate-700">{selectedDossier.department}</span>
                <span className="mx-2 text-slate-300">&bull;</span>
                <span>Nodal Officer: {selectedDossier.nodalOfficer.name} ({selectedDossier.nodalOfficer.designation})</span>
              </p>
            </div>

            {/* Quick Actions */}
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              {selectedDossier.status === 'Query Raised' && (
                <Link
                  to="/applicant/compliance"
                  className="px-4 py-2 rounded-lg text-xs font-bold bg-amber-600 text-white hover:bg-amber-700 transition shadow-2xs flex items-center gap-1.5"
                >
                  <span>⚠️</span>
                  <span>Respond to Technical Query</span>
                </Link>
              )}

              {selectedDossier.status === 'Inspection Scheduled' && (
                <Link
                  to="/applicant/compliance"
                  className="px-4 py-2 rounded-lg text-xs font-bold bg-indigo-600 text-white hover:bg-indigo-700 transition shadow-2xs flex items-center gap-1.5"
                >
                  <span>🔍</span>
                  <span>Site Inspection Details</span>
                </Link>
              )}

              <button
                onClick={() => window.print()}
                className="px-3 py-2 rounded-lg text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 transition flex items-center gap-1.5"
              >
                <span>🖨️</span>
                <span>Print Dossier</span>
              </button>
            </div>
          </div>

          {/* SLA Countdown Banner */}
          <div className="mt-5 p-4 rounded-xl bg-slate-50 border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-blue-600 animate-pulse" />
                <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                  Statutory SLA Guarantee (Right to Public Services Act)
                </span>
              </div>
              <p className="text-xs text-slate-600">
                Target Timeline: <strong>{selectedDossier.slaTargetDays} Calendar Days</strong> &bull; Due Date: <strong>{selectedDossier.slaDueDate}</strong>
              </p>
            </div>

            <div className="sm:text-right min-w-[200px]">
              <div className="flex items-center justify-between sm:justify-end gap-3 text-xs mb-1">
                <span className="text-slate-500">SLA Progress:</span>
                <span className="font-bold text-slate-900">
                  Day {selectedDossier.slaDaysElapsed} of {selectedDossier.slaTargetDays}
                </span>
              </div>
              <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${
                    selectedDossier.status === 'Approved'
                      ? 'bg-emerald-500'
                      : selectedDossier.slaDaysElapsed > 25
                      ? 'bg-amber-500'
                      : 'bg-blue-600'
                  }`}
                  style={{ width: `${percent}%` }}
                />
              </div>
            </div>
          </div>

          {/* Project Context Strip */}
          <div className="mt-4 pt-4 border-t border-slate-100 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3 text-xs text-slate-600">
            <div>
              <span className="text-slate-400 block">Enterprise</span>
              <span className="font-semibold text-slate-800 truncate block">{activeEnterprise.name}</span>
            </div>
            <div>
              <span className="text-slate-400 block">Project</span>
              <span className="font-semibold text-slate-800 truncate block">{activeProject.name}</span>
            </div>
            <div>
              <span className="text-slate-400 block">Location</span>
              <span className="font-semibold text-slate-800 truncate block">Plot B-14/1, Chakan MIDC</span>
            </div>
            <div>
              <span className="text-slate-400 block">Proposed Investment</span>
              <span className="font-semibold text-slate-800">₹{activeProject.proposedInvestmentCr} Cr</span>
            </div>
            <div>
              <span className="text-slate-400 block">Power / Water</span>
              <span className="font-semibold text-slate-800">1250 kVA / 50 KLD</span>
            </div>
            <div>
              <span className="text-slate-400 block">Current Stage</span>
              <span className="font-semibold text-blue-700 truncate block">{selectedDossier.currentStage}</span>
            </div>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex border-b border-slate-200 bg-white px-5 rounded-t-xl overflow-x-auto gap-1">
          <button
            onClick={() => setActiveTab('timeline')}
            className={`py-3 px-4 text-xs font-bold border-b-2 transition whitespace-nowrap flex items-center gap-1.5 ${
              activeTab === 'timeline'
                ? 'border-blue-600 text-blue-700'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <span>⏱️</span>
            <span>Statutory SLA Timeline</span>
          </button>

          <button
            onClick={() => setActiveTab('dossiers')}
            className={`py-3 px-4 text-xs font-bold border-b-2 transition whitespace-nowrap flex items-center gap-1.5 ${
              activeTab === 'dossiers'
                ? 'border-blue-600 text-blue-700'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <span>📑</span>
            <span>Multi-Department Matrix ({dossiers.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('documents')}
            className={`py-3 px-4 text-xs font-bold border-b-2 transition whitespace-nowrap flex items-center gap-1.5 ${
              activeTab === 'documents'
                ? 'border-blue-600 text-blue-700'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <span>📁</span>
            <span>Attached Documents ({attachedDocs.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('queries')}
            className={`py-3 px-4 text-xs font-bold border-b-2 transition whitespace-nowrap flex items-center gap-1.5 ${
              activeTab === 'queries'
                ? 'border-blue-600 text-blue-700'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <span>⚠️</span>
            <span>Queries &amp; Clarifications {activeQuery && activeQuery.status === 'Open' ? '(1 Pending)' : ''}</span>
          </button>

          <button
            onClick={() => setActiveTab('inspections')}
            className={`py-3 px-4 text-xs font-bold border-b-2 transition whitespace-nowrap flex items-center gap-1.5 ${
              activeTab === 'inspections'
                ? 'border-blue-600 text-blue-700'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <span>🔍</span>
            <span>Site Inspection</span>
          </button>

          <button
            onClick={() => setActiveTab('activity')}
            className={`py-3 px-4 text-xs font-bold border-b-2 transition whitespace-nowrap flex items-center gap-1.5 ${
              activeTab === 'activity'
                ? 'border-blue-600 text-blue-700'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            <span>📜</span>
            <span>Activity History</span>
          </button>
        </div>

        {/* Tab 1: Statutory SLA Timeline */}
        {activeTab === 'timeline' && (
          <div className="bg-white rounded-b-xl border border-t-0 border-slate-200 p-6 shadow-2xs space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-4 border-b border-slate-100">
              <div>
                <h3 className="text-base font-serif font-bold text-slate-900">
                  Statutory Clearance Lifecycle &amp; Officer Scrutiny Roadmap
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Chronological progression mandated under Maharashtra Industry Citizen Charter and Ease of Doing Business framework.
                </p>
              </div>
              <span className="text-xs font-semibold px-2.5 py-1 rounded bg-blue-50 text-blue-800 border border-blue-200">
                Department: {selectedDossier.departmentShort}
              </span>
            </div>

            {/* Timeline Stepper */}
            <div className="relative pl-6 sm:pl-8 space-y-8 before:absolute before:left-3 sm:before:left-4 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-200">
              {timelineStages.map((stage, idx) => {
                const isDone = stage.status === 'completed';
                const isCur = stage.status === 'current';
                const isAction = stage.status === 'action_required';

                return (
                  <div key={stage.stageId} className="relative group">
                    {/* Circle Indicator */}
                    <div
                      className={`absolute -left-6 sm:-left-8 top-0.5 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shadow-2xs ring-4 ring-white ${
                        isDone
                          ? 'bg-emerald-600 text-white'
                          : isCur
                          ? 'bg-blue-600 text-white animate-pulse'
                          : isAction
                          ? 'bg-amber-600 text-white'
                          : 'bg-slate-200 text-slate-500'
                      }`}
                    >
                      {isDone ? '✓' : idx + 1}
                    </div>

                    <div className="bg-slate-50/70 hover:bg-slate-50 border border-slate-200 rounded-xl p-4 transition">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-2">
                            <h4 className="text-sm font-bold text-slate-900">
                              {stage.stageName}
                            </h4>
                            <span
                              className={`px-2 py-0.5 rounded text-[10.5px] font-semibold ${
                                isDone
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : isCur
                                  ? 'bg-blue-100 text-blue-800'
                                  : isAction
                                  ? 'bg-amber-100 text-amber-900'
                                  : 'bg-slate-100 text-slate-600'
                              }`}
                            >
                              {stage.elapsedOrRemaining}
                            </span>
                          </div>
                          <p className="text-xs text-slate-500 mt-0.5">
                            {stage.department} &bull; Officer: {stage.responsibleOfficer}
                          </p>
                        </div>
                        <span className="text-xs font-semibold text-slate-600 sm:text-right shrink-0">
                          {stage.date}
                        </span>
                      </div>

                      <p className="text-xs text-slate-700 mt-2 leading-relaxed">
                        {stage.description}
                      </p>

                      {stage.remarks && (
                        <p className="text-xs font-medium text-blue-700 mt-1.5 bg-blue-50/60 p-2 rounded border border-blue-100">
                          📌 {stage.remarks}
                        </p>
                      )}

                      {stage.applicantActionText && (
                        <div className="mt-3 p-3 rounded-lg bg-amber-50 border border-amber-300 flex items-center justify-between gap-3 text-xs text-amber-900">
                          <span className="font-semibold">⚠️ {stage.applicantActionText}</span>
                          <Link
                            to="/applicant/compliance"
                            className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-bold shrink-0 transition"
                          >
                            Open Action Center &rarr;
                          </Link>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Tab 2: Multi-Department Matrix */}
        {activeTab === 'dossiers' && (
          <div className="bg-white rounded-b-xl border border-t-0 border-slate-200 p-6 shadow-2xs space-y-4">
            <div>
              <h3 className="text-base font-serif font-bold text-slate-900">
                Connected Industrial Clearance Dossiers
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                All statutory filings for {activeProject.name} under Single Window synchronization.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
              {dossiers.map((d) => (
                <div
                  key={d.id}
                  className={`p-4 rounded-xl border transition ${
                    d.applicationNumber === selectedDossier.applicationNumber
                      ? 'border-blue-500 bg-blue-50/20 shadow-xs'
                      : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs font-bold text-slate-800 bg-slate-100 px-2 py-0.5 rounded">
                      {d.applicationNumber}
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded text-[11px] font-semibold ${
                        d.status === 'Approved'
                          ? 'bg-emerald-100 text-emerald-800'
                          : d.status === 'Query Raised'
                          ? 'bg-amber-100 text-amber-900'
                          : d.status === 'Inspection Scheduled'
                          ? 'bg-indigo-100 text-indigo-800'
                          : 'bg-blue-100 text-blue-800'
                      }`}
                    >
                      {d.status}
                    </span>
                  </div>

                  <h4 className="text-sm font-bold text-slate-900 mt-2">{d.serviceName}</h4>
                  <p className="text-xs text-slate-600 mt-0.5">{d.department}</p>

                  <div className="mt-3 pt-3 border-t border-slate-100 text-xs text-slate-600 space-y-1">
                    <div className="flex justify-between">
                      <span className="text-slate-500">Current Stage:</span>
                      <span className="font-semibold text-slate-800">{d.currentStage}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">SLA Progress:</span>
                      <span className="font-semibold text-slate-800">
                        Day {d.slaDaysElapsed} of {d.slaTargetDays} (Due {d.slaDueDate})
                      </span>
                    </div>
                    {d.dependencies && d.dependencies.length > 0 && (
                      <div className="flex justify-between">
                        <span className="text-slate-500">Dependencies:</span>
                        <span className="text-slate-700">{d.dependencies.join(', ')}</span>
                      </div>
                    )}
                  </div>

                  <div className="mt-3 pt-2 flex items-center justify-end gap-2">
                    <Link
                      to={`/applicant/applications/tracker?appNumber=${encodeURIComponent(
                        d.applicationNumber
                      )}`}
                      className="text-xs font-semibold text-blue-700 hover:underline"
                    >
                      Track This Approval &rarr;
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tab 3: Attached Documents */}
        {activeTab === 'documents' && (
          <div className="bg-white rounded-b-xl border border-t-0 border-slate-200 p-6 shadow-2xs space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-100">
              <div>
                <h3 className="text-base font-serif font-bold text-slate-900">
                  Statutory Locker Document Evidence Docket
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  All certificates, drawings, and corporate filings submitted to the competent authority.
                </p>
              </div>
              <Link
                to="/applicant/documents"
                className="text-xs font-semibold text-blue-700 hover:underline"
              >
                Open Statutory Document Vault &rarr;
              </Link>
            </div>

            <div className="divide-y divide-slate-200 border border-slate-200 rounded-xl overflow-hidden">
              {attachedDocs.map((doc, idx) => (
                <div key={doc.requirementId || idx} className="p-4 hover:bg-slate-50/70 transition flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-slate-900 text-sm">
                        {doc.linkedDocumentName || doc.documentType}
                      </span>
                      {doc.linkedVersionId && (
                        <span className="font-mono text-[11px] bg-slate-100 px-1.5 py-0.5 rounded text-slate-600">
                          {doc.linkedVersionId}
                        </span>
                      )}
                      <span className="px-2 py-0.5 rounded-full text-[10.5px] font-semibold bg-emerald-100 text-emerald-800 border border-emerald-300">
                        ✓ {doc.linkedVerificationStatus || 'Verified'}
                      </span>
                    </div>
                    <p className="text-slate-500">
                      Requirement: <strong>{doc.documentType}</strong> &bull; Issuing Authority: {doc.statutorySource}
                    </p>
                    {doc.linkedDocumentNumber && (
                      <p className="font-mono text-slate-600 text-[11px]">
                        Document Ref: {doc.linkedDocumentNumber}
                      </p>
                    )}
                  </div>

                  <div className="sm:text-right shrink-0">
                    <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-1 rounded border border-emerald-200 block sm:inline-block">
                      🔒 Attached to Filing Dossier
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tab 4: Queries & Clarifications */}
        {activeTab === 'queries' && (
          <div className="bg-white rounded-b-xl border border-t-0 border-slate-200 p-6 shadow-2xs space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div>
                <h3 className="text-base font-serif font-bold text-slate-900">
                  Statutory Queries &amp; Clarifications
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Technical queries raised by scrutiny officers requiring applicant response.
                </p>
              </div>
              <Link
                to="/applicant/compliance"
                className="px-3.5 py-1.5 rounded-lg text-xs font-bold bg-amber-600 text-white hover:bg-amber-700 transition"
              >
                Go to Compliance Center
              </Link>
            </div>

            {activeQuery ? (
              <div className="p-5 rounded-xl border border-amber-300 bg-amber-50/40 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-bold text-amber-950 bg-amber-100 px-2 py-0.5 rounded border border-amber-300">
                      {activeQuery.id}
                    </span>
                    <span className="px-2 py-0.5 rounded text-xs font-bold bg-amber-200 text-amber-950">
                      Status: {activeQuery.status}
                    </span>
                  </div>
                  <span className="text-xs font-semibold text-amber-900">
                    Due Date: {activeQuery.dueDate} ({activeQuery.daysRemaining} days left)
                  </span>
                </div>

                <div>
                  <h4 className="text-sm font-bold text-slate-900">{activeQuery.subject}</h4>
                  <p className="text-xs text-slate-600 mt-0.5">
                    Department: <strong>{activeQuery.department}</strong> &bull; Scrutiny Officer: {activeQuery.officerName}
                  </p>
                  <p className="text-xs text-slate-700 mt-2 bg-white p-3 rounded-lg border border-amber-200 leading-relaxed">
                    {activeQuery.description}
                  </p>
                </div>

                <div>
                  <h5 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-2">
                    Requested Deliverables &amp; Evidence ({activeQuery.requestedDeliverables.length}):
                  </h5>
                  <ul className="space-y-1.5 text-xs text-slate-700">
                    {activeQuery.requestedDeliverables.map((del) => (
                      <li key={del.id} className="flex items-start gap-2 bg-white p-2.5 rounded-lg border border-slate-200">
                        <span className="text-amber-600 font-bold shrink-0 mt-0.5">
                          {del.mandatory ? '🔴' : '⚪'}
                        </span>
                        <div>
                          <span className="font-semibold text-slate-900">{del.requirement}</span>
                          <p className="text-slate-500 text-[11px]">{del.explanation}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="pt-2 flex justify-end">
                  <Link
                    to="/applicant/compliance"
                    className="px-4 py-2 rounded-lg text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white transition shadow-2xs"
                  >
                    Respond to This Query &rarr;
                  </Link>
                </div>
              </div>
            ) : (
              <p className="text-xs text-slate-500 py-6 text-center">No active queries on this clearance.</p>
            )}
          </div>
        )}

        {/* Tab 5: Site Inspections */}
        {activeTab === 'inspections' && (
          <div className="bg-white rounded-b-xl border border-t-0 border-slate-200 p-6 shadow-2xs space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div>
                <h3 className="text-base font-serif font-bold text-slate-900">
                  Joint Statutory Physical Site Inspection
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Scheduled on-site verification by competent department officers.
                </p>
              </div>
              <Link
                to="/applicant/compliance"
                className="px-3.5 py-1.5 rounded-lg text-xs font-bold bg-indigo-600 text-white hover:bg-indigo-700 transition"
              >
                Inspection Preparation Checklist
              </Link>
            </div>

            {activeInspection ? (
              <div className="p-5 rounded-xl border border-indigo-200 bg-indigo-50/30 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-bold text-indigo-950 bg-indigo-100 px-2 py-0.5 rounded border border-indigo-300">
                      {activeInspection.id}
                    </span>
                    <span className="px-2 py-0.5 rounded text-xs font-bold bg-indigo-200 text-indigo-950">
                      Status: {activeInspection.status}
                    </span>
                  </div>
                  <span className="text-xs font-bold text-indigo-950">
                    📅 Date: {activeInspection.scheduledDate} &bull; {activeInspection.scheduledTime}
                  </span>
                </div>

                <div className="text-xs space-y-1">
                  <h4 className="text-sm font-bold text-slate-900">{activeInspection.inspectionType}</h4>
                  <p className="text-slate-600">
                    Location: <strong>{activeInspection.location}</strong>
                  </p>
                  <p className="text-slate-700 bg-white p-3 rounded-lg border border-indigo-100 mt-2">
                    {activeInspection.purpose}
                  </p>
                </div>

                <div>
                  <h5 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-2">
                    Inspecting Officers:
                  </h5>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                    {activeInspection.inspectingOfficers.map((off, i) => (
                      <div key={i} className="p-2.5 rounded-lg bg-white border border-slate-200">
                        <span className="font-bold text-slate-900">{off.name}</span>
                        <p className="text-slate-500 text-[11px]">{off.designation} &bull; {off.department}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="pt-2 flex justify-end">
                  <Link
                    to="/applicant/compliance"
                    className="px-4 py-2 rounded-lg text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white transition shadow-2xs"
                  >
                    Open Inspection Action Center &rarr;
                  </Link>
                </div>
              </div>
            ) : (
              <p className="text-xs text-slate-500 py-6 text-center">No inspection scheduled for this clearance.</p>
            )}
          </div>
        )}

        {/* Tab 6: Activity History Stream */}
        {activeTab === 'activity' && (
          <div className="bg-white rounded-b-xl border border-t-0 border-slate-200 p-6 shadow-2xs space-y-4">
            <div>
              <h3 className="text-base font-serif font-bold text-slate-900">
                Application Audit &amp; Activity Log
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Immutable statutory activity trail recorded across Single Window clearance gateway.
              </p>
            </div>

            <div className="divide-y divide-slate-200 border border-slate-200 rounded-xl overflow-hidden text-xs">
              {cteApp.timeline.map((event) => (
                <div key={event.id} className="p-4 hover:bg-slate-50/70 transition flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-slate-900">{event.title}</span>
                      <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 text-[10.5px]">
                        {event.stage}
                      </span>
                    </div>
                    <p className="text-slate-600">{event.description}</p>
                    <p className="text-slate-400 text-[11px]">Actor: {event.actor}</p>
                  </div>
                  <span className="text-slate-500 font-medium sm:text-right shrink-0">
                    {event.timestamp}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </ApplicantLayout>
  );
};
