import React, { useState } from 'react';
import { DocumentRecord } from '../../types/documentVault';
import { documentVaultService } from '../../services/documentVaultService';
import { applicantService } from '../../services/applicantService';

interface DocumentReuseModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (reusedDoc: DocumentRecord, targetName: string) => void;
  preselectedRequirement?: {
    requirementName: string;
    clearanceCode: string;
    clearanceName: string;
    category?: string;
  };
}

export const DocumentReuseModal: React.FC<DocumentReuseModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  preselectedRequirement,
}) => {
  const [selectedDocId, setSelectedDocId] = useState<string>('');
  const [selectedProjectId, setSelectedProjectId] = useState<string>('proj-chk-01');
  const [customRequirementName, setCustomRequirementName] = useState<string>(
    preselectedRequirement?.requirementName || ''
  );
  const [customClearanceCode, setCustomClearanceCode] = useState<string>(
    preselectedRequirement?.clearanceCode || 'MPCB-CTE'
  );
  const [customClearanceName, setCustomClearanceName] = useState<string>(
    preselectedRequirement?.clearanceName || 'Consent to Establish (CTE) under Water & Air Acts'
  );
  const [categoryFilter, setCategoryFilter] = useState<string>(
    preselectedRequirement?.category || 'All'
  );
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  if (!isOpen) return null;

  const eligibleDocs = documentVaultService.getEligibleVerifiedDocuments(
    categoryFilter === 'All' ? undefined : categoryFilter
  );

  const filteredDocs = eligibleDocs.filter((doc) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      doc.documentName.toLowerCase().includes(q) ||
      doc.documentType.toLowerCase().includes(q) ||
      doc.documentNumber.toLowerCase().includes(q) ||
      doc.issuingAuthority.toLowerCase().includes(q)
    );
  });

  const selectedDoc = documentVaultService.getDocumentById(selectedDocId);
  const currentVersion = selectedDoc ? documentVaultService.getCurrentVersion(selectedDoc.id) : undefined;
  const projects = applicantService.getProjects();
  const targetProject = projects.find((p) => p.id === selectedProjectId) || projects[0];

  const handleConfirmReuse = () => {
    if (!selectedDoc) {
      setFeedback({ type: 'error', message: 'Please select a verified document from the list below.' });
      return;
    }

    setIsSubmitting(true);
    setFeedback(null);

    const result = documentVaultService.reuseDocument(selectedDoc.id, {
      targetClearanceCode: preselectedRequirement?.clearanceCode || customClearanceCode,
      targetClearanceName: preselectedRequirement?.clearanceName || customClearanceName,
      targetRequirementName: preselectedRequirement?.requirementName || customRequirementName || selectedDoc.documentType,
      projectId: targetProject?.id || 'proj-chk-01',
      projectName: targetProject?.name || 'Chakan Auto Component Expansion Unit',
      reusedBy: 'Priya Deshmukh (Managing Director)',
    });

    setIsSubmitting(false);

    if (result.success) {
      setFeedback({ type: 'success', message: result.message });
      if (onSuccess) {
        onSuccess(selectedDoc, customRequirementName || selectedDoc.documentType);
      }
      setTimeout(() => {
        onClose();
        setFeedback(null);
        setSelectedDocId('');
      }, 1500);
    } else {
      setFeedback({ type: 'error', message: result.message });
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs overflow-y-auto animate-in fade-in duration-150"
      role="dialog"
      aria-modal="true"
      aria-labelledby="reuse-modal-title"
    >
      <div className="bg-white rounded-2xl max-w-3xl w-full max-h-[90vh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden my-auto">
        {/* Modal Header */}
        <div className="bg-[#0f2b48] text-white px-6 py-4 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-lg bg-white/10 border border-white/20 flex items-center justify-center text-lg">
              🔗
            </div>
            <div>
              <h3 id="reuse-modal-title" className="text-base font-bold font-serif leading-tight">
                Use Existing Verified Document (Statutory Locker)
              </h3>
              <p className="text-[11px] text-blue-200 mt-0.5">
                Link pre-authenticated credentials to statutory filings without physical re-uploading
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-white/70 hover:text-white p-1.5 rounded-lg hover:bg-white/10 transition cursor-pointer"
            aria-label="Close dialog"
          >
            ✕
          </button>
        </div>

        {/* Target Clearance Bar */}
        <div className="bg-blue-50/80 border-b border-blue-100 px-6 py-3 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <span className="font-semibold text-blue-900 block">
                Target Statutory Requirement:
              </span>
              <span className="text-slate-700 font-medium">
                {preselectedRequirement?.requirementName || customRequirementName || 'General Application Clearance'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded bg-blue-100 text-blue-800 font-mono text-[10px] font-bold border border-blue-200">
                {preselectedRequirement?.clearanceCode || customClearanceCode}
              </span>
              <span className="text-[11px] text-slate-500">
                ({targetProject?.name || 'Chakan Unit'})
              </span>
            </div>
          </div>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto flex-1 space-y-5 text-xs text-slate-600">
          {/* Feedback banner */}
          {feedback && (
            <div
              className={`p-3.5 rounded-xl border flex items-start gap-2.5 ${
                feedback.type === 'success'
                  ? 'bg-emerald-50 text-emerald-900 border-emerald-200'
                  : 'bg-rose-50 text-rose-900 border-rose-200'
              }`}
            >
              <span className="text-sm mt-0.5">{feedback.type === 'success' ? '✓' : '⚠️'}</span>
              <span className="leading-snug">{feedback.message}</span>
            </div>
          )}

          {/* Statutory Safeguard Note */}
          <div className="p-3 bg-amber-50/80 border border-amber-200 rounded-xl flex items-start gap-2.5 text-amber-900">
            <span className="text-base">🛡️</span>
            <div className="text-[11.5px] leading-relaxed">
              <span className="font-bold">Statutory Integrity Guarantee:</span> Only documents with verified digital signatures, non-expired validity, and authorized signatory endorsement are eligible for reuse. Linking creates an audit reference without duplicating records.
            </div>
          </div>

          {/* Filters & Search */}
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
            <div className="sm:col-span-7">
              <label htmlFor="reuse-search" className="font-semibold text-slate-700 mb-1 block">
                Search Verified Locker
              </label>
              <input
                id="reuse-search"
                type="text"
                placeholder="Search by document name, authority, or number..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-slate-50/50"
              />
            </div>
            <div className="sm:col-span-5">
              <label htmlFor="reuse-category" className="font-semibold text-slate-700 mb-1 block">
                Category
              </label>
              <select
                id="reuse-category"
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              >
                <option value="All">All Categories ({eligibleDocs.length})</option>
                <option value="Identity & Applicant">Identity &amp; Applicant</option>
                <option value="Enterprise Registration">Enterprise Registration</option>
                <option value="Land & Siting">Land &amp; Siting</option>
                <option value="Engineering & Layout">Engineering &amp; Layout</option>
                <option value="Safety & Utility">Safety &amp; Utility</option>
                <option value="Financial & Statutory">Financial &amp; Statutory</option>
              </select>
            </div>
          </div>

          {/* List of Eligible Documents */}
          <div className="space-y-2.5 max-h-72 overflow-y-auto pr-1">
            {filteredDocs.length === 0 ? (
              <div className="p-8 text-center bg-slate-50 rounded-xl border border-dashed border-slate-200">
                <span className="text-2xl block mb-2">🗂️</span>
                <p className="font-semibold text-slate-700 text-xs">No matching verified documents found</p>
                <p className="text-[11px] text-slate-400 mt-1">
                  Ensure the document exists in your Statutory Locker and is marked as 'Verified'.
                </p>
              </div>
            ) : (
              filteredDocs.map((doc) => {
                const isSelected = selectedDocId === doc.id;
                const v = documentVaultService.getCurrentVersion(doc.id);
                return (
                  <label
                    key={doc.id}
                    htmlFor={`doc-radio-${doc.id}`}
                    className={`block p-3.5 rounded-xl border transition cursor-pointer ${
                      isSelected
                        ? 'border-blue-600 bg-blue-50/60 ring-2 ring-blue-500/20 shadow-xs'
                        : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50/70'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <input
                        id={`doc-radio-${doc.id}`}
                        type="radio"
                        name="selectedDocument"
                        checked={isSelected}
                        onChange={() => setSelectedDocId(doc.id)}
                        className="mt-1 w-4 h-4 text-blue-600 focus:ring-blue-500 cursor-pointer"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <h4 className="font-bold text-slate-900 text-xs leading-snug">
                            {doc.documentName}
                          </h4>
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200 shrink-0">
                            ✓ Verified ({v?.versionNumber || 'v1.0'})
                          </span>
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-y-1 gap-x-2 mt-2 text-[11px] text-slate-500">
                          <div>
                            <span className="text-slate-400">Authority: </span>
                            <span className="font-medium text-slate-700 truncate block">
                              {doc.issuingAuthority}
                            </span>
                          </div>
                          <div>
                            <span className="text-slate-400">Doc No: </span>
                            <span className="font-mono font-medium text-slate-700">
                              {doc.documentNumber}
                            </span>
                          </div>
                          <div>
                            <span className="text-slate-400">Source: </span>
                            <span className="font-medium text-blue-900">
                              {doc.source === 'DigiLocker' ? '🏛️ DigiLocker' : '📄 Direct Upload'}
                            </span>
                          </div>
                        </div>

                        {doc.statutoryReferences && doc.statutoryReferences.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {doc.statutoryReferences.slice(0, 2).map((ref, idx) => (
                              <span
                                key={idx}
                                className="px-1.5 py-0.2 rounded text-[9.5px] bg-slate-100 text-slate-600 font-mono"
                              >
                                {ref}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </label>
                );
              })
            )}
          </div>

          {/* Selected Document Preview Summary */}
          {selectedDoc && (
            <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-slate-800">Selected for Reference Linkage:</span>
                <span className="font-mono text-[11px] text-blue-800 bg-blue-100/80 px-2 py-0.5 rounded">
                  Ref ID: {selectedDoc.id}
                </span>
              </div>
              <p className="text-[11.5px] text-slate-600">{selectedDoc.description}</p>
              <div className="flex items-center gap-3 text-[10.5px] text-slate-500 pt-1 border-t border-slate-200">
                <span>Current File: <strong className="text-slate-700">{currentVersion?.fileName || 'document.pdf'}</strong></span>
                <span>•</span>
                <span>Size: <strong className="text-slate-700">{currentVersion?.fileSize || '1.5 MB'}</strong></span>
                <span>•</span>
                <span>Signed: <strong className="text-emerald-700">Valid Digital Signature</strong></span>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="bg-slate-50 border-t border-slate-200 px-6 py-3.5 flex items-center justify-between">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:text-slate-800 hover:bg-slate-200/60 transition cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirmReuse}
            disabled={!selectedDocId || isSubmitting}
            className={`px-5 py-2 rounded-xl text-xs font-bold text-white transition flex items-center gap-1.5 cursor-pointer shadow-xs ${
              !selectedDocId || isSubmitting
                ? 'bg-slate-300 cursor-not-allowed text-slate-500'
                : 'bg-emerald-600 hover:bg-emerald-700'
            }`}
          >
            {isSubmitting ? (
              <span>Linking Reference...</span>
            ) : (
              <>
                <span>✓ Confirm Statutory Reuse</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
