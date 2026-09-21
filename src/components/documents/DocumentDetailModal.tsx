import React from 'react';
import { DocumentRecord } from '../../types/documentVault';
import { documentVaultService } from '../../services/documentVaultService';
import { applicantService } from '../../services/applicantService';

interface DocumentDetailModalProps {
  isOpen: boolean;
  document: DocumentRecord | null;
  onClose: () => void;
  onOpenReuseModal: (doc: DocumentRecord) => void;
  onOpenVersionHistory: (doc: DocumentRecord) => void;
  onOpenUploadRevision: (doc: DocumentRecord) => void;
}

export const DocumentDetailModal: React.FC<DocumentDetailModalProps> = ({
  isOpen,
  document,
  onClose,
  onOpenReuseModal,
  onOpenVersionHistory,
  onOpenUploadRevision,
}) => {
  if (!isOpen || !document) return null;

  const currentVersion = documentVaultService.getCurrentVersion(document.id);
  const versions = documentVaultService.getDocumentVersions(document.id);
  const reuseRecords = documentVaultService.getReuseRecordsForDocument(document.id);
  const enterprise = document.enterpriseId
    ? applicantService.getEnterpriseById(document.enterpriseId)
    : undefined;
  const projects = applicantService.getProjects();
  const linkedProjectObjects = projects.filter((p) => document.projectIds.includes(p.id));

  const isExpired =
    document.status === 'Expired' ||
    document.verificationStatus === 'Expired' ||
    (document.expiryDate && new Date(document.expiryDate).getTime() < Date.now());

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs overflow-y-auto animate-in fade-in duration-150"
      role="dialog"
      aria-modal="true"
      aria-labelledby="doc-detail-title"
    >
      <div className="bg-white rounded-2xl max-w-3xl w-full max-h-[92vh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden my-auto">
        {/* Header */}
        <div className="bg-[#0f2b48] text-white px-6 py-4 flex items-start justify-between border-b border-slate-800">
          <div className="flex items-start space-x-3">
            <div className="w-10 h-10 rounded-xl bg-white/10 border border-white/20 flex items-center justify-center text-xl shrink-0 mt-0.5">
              📜
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-blue-500/20 text-blue-200 border border-blue-400/30">
                  {document.category}
                </span>
                <span className="text-slate-400 text-xs">•</span>
                <span className="text-[11px] font-mono text-slate-300">
                  ID: {document.id}
                </span>
              </div>
              <h2 id="doc-detail-title" className="text-base sm:text-lg font-bold font-serif leading-tight">
                {document.documentName}
              </h2>
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

        {/* Status Ribbon */}
        <div className="bg-slate-50 border-b border-slate-200 px-6 py-3 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-3">
            <span className="text-slate-500 font-semibold">Verification:</span>
            {document.verificationStatus === 'Verified' && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                ✓ Verified &amp; Digitally Authenticated
              </span>
            )}
            {document.verificationStatus === 'Pending Verification' && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-900 border border-amber-200">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                ⏳ Pending Scrutiny Verification
              </span>
            )}
            {document.verificationStatus === 'Expired' && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-rose-100 text-rose-800 border border-rose-200">
                <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                ⚠️ Expired Statutory Record
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <span className="text-slate-500 font-semibold">Source:</span>
            <span className="font-bold text-slate-700">
              {document.source === 'DigiLocker' && '🏛️ DigiLocker Verified'}
              {document.source === 'Direct Upload' && '📄 Direct Upload'}
              {document.source === 'Department Issued' && '🏢 Department Issued'}
              {document.source === 'Single Window Repository' && '🗄️ Single Window Repo'}
            </span>
          </div>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto flex-1 space-y-6 text-xs text-slate-600">
          {/* Statutory Description */}
          <div className="p-3.5 bg-blue-50/50 rounded-xl border border-blue-100">
            <h4 className="font-bold text-blue-900 text-xs mb-1">Official Description</h4>
            <p className="text-slate-700 leading-relaxed text-[12px]">{document.description}</p>
          </div>

          {/* Primary Metadata Grid */}
          <div>
            <h4 className="font-bold text-slate-900 text-xs uppercase tracking-wider mb-3">
              Document Credentials
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 bg-slate-50 p-4 rounded-xl border border-slate-200">
              <div>
                <span className="text-slate-400 block text-[10.5px]">Document Type</span>
                <span className="font-bold text-slate-800 text-[12px]">{document.documentType}</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[10.5px]">Document / Certificate No.</span>
                <span className="font-mono font-bold text-blue-900 text-[12px]">{document.documentNumber}</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[10.5px]">Issuing Authority</span>
                <span className="font-medium text-slate-800 text-[11.5px]">{document.issuingAuthority}</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[10.5px]">Issue Date</span>
                <span className="font-medium text-slate-800 text-[11.5px]">{document.issueDate}</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[10.5px]">Statutory Validity / Expiry</span>
                <span className={`font-semibold text-[11.5px] ${isExpired ? 'text-rose-600' : 'text-slate-800'}`}>
                  {document.expiryDate ? document.expiryDate : 'Perpetual / Nil Expiry'}
                </span>
              </div>
              <div>
                <span className="text-slate-400 block text-[10.5px]">Current Version</span>
                <div className="flex items-center gap-2">
                  <span className="font-mono font-bold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                    {currentVersion?.versionNumber || 'v1.0'}
                  </span>
                  <span className="text-[10.5px] text-slate-400">
                    ({versions.length} total revision{versions.length > 1 ? 's' : ''})
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Statutory References */}
          {document.statutoryReferences && document.statutoryReferences.length > 0 && (
            <div>
              <h4 className="font-bold text-slate-900 text-xs uppercase tracking-wider mb-2">
                Statutory Legal Provisions &amp; Rules
              </h4>
              <div className="flex flex-wrap gap-2">
                {document.statutoryReferences.map((ref, idx) => (
                  <span
                    key={idx}
                    className="px-2.5 py-1 rounded-lg text-xs bg-slate-100 text-slate-800 border border-slate-200 font-mono"
                  >
                    ⚖️ {ref}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Linked Undertaking & Projects */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="p-3.5 rounded-xl border border-slate-200 bg-white">
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block mb-1.5">
                🏢 Linked Enterprise
              </span>
              <p className="font-bold text-slate-800 text-xs">{enterprise?.name || 'Priya Deshmukh (Personal / Signatory)'}</p>
              <p className="text-[10.5px] text-slate-400 font-mono mt-0.5">
                {enterprise?.udyamRegistration || enterprise?.cinOrLlpin || 'Applicant Level Record'}
              </p>
            </div>

            <div className="p-3.5 rounded-xl border border-slate-200 bg-white">
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block mb-1.5">
                🏭 Linked Industrial Projects ({linkedProjectObjects.length})
              </span>
              {linkedProjectObjects.length === 0 ? (
                <p className="text-[11.5px] text-slate-400">Available globally across all projects</p>
              ) : (
                <ul className="space-y-1">
                  {linkedProjectObjects.map((proj) => (
                    <li key={proj.id} className="text-xs text-slate-700 font-medium truncate">
                      • {proj.name}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* Active Reuse Linkages */}
          {reuseRecords.length > 0 && (
            <div>
              <h4 className="font-bold text-slate-900 text-xs uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <span>🔗</span> Active Statutory Filings Using This Document ({reuseRecords.length})
              </h4>
              <div className="space-y-2">
                {reuseRecords.map((r) => (
                  <div
                    key={r.id}
                    className="p-3 rounded-xl border border-emerald-200 bg-emerald-50/40 flex items-center justify-between text-xs"
                  >
                    <div>
                      <span className="font-bold text-slate-800 block">{r.targetClearanceName}</span>
                      <span className="text-[11px] text-slate-500">
                        Requirement: <strong className="text-slate-700">{r.targetRequirementName}</strong> • {r.projectName}
                      </span>
                    </div>
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                      Linked ({r.versionNumber})
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Ineligible Explanation if applicable */}
          {!document.reusable && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-900 text-xs flex items-start gap-2">
              <span className="text-sm">⚠️</span>
              <div>
                <strong className="block font-semibold">Statutory Reuse Restricted:</strong>
                {document.verificationStatus === 'Pending Verification' &&
                  'This document is currently under scrutiny review. It can be viewed and audited, but cannot be linked to new statutory applications until verified.'}
                {isExpired &&
                  'This statutory certificate has passed its validity date. Upload a renewed certificate to re-enable statutory linking.'}
              </div>
            </div>
          )}
        </div>

        {/* Modal Actions Footer */}
        <div className="bg-slate-50 border-t border-slate-200 px-6 py-4 flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenVersionHistory(document);
              }}
              className="px-3.5 py-2 rounded-xl text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 transition flex items-center gap-1.5 cursor-pointer shadow-2xs"
            >
              <span>🕒 Version History ({versions.length})</span>
            </button>
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenUploadRevision(document);
              }}
              className="px-3.5 py-2 rounded-xl text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 transition flex items-center gap-1.5 cursor-pointer shadow-2xs"
            >
              <span>📤 Upload Revision</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:text-slate-800 transition cursor-pointer"
            >
              Close
            </button>
            {document.reusable && !isExpired && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenReuseModal(document);
                }}
                className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-xs transition flex items-center gap-1.5 cursor-pointer"
              >
                <span>🔗 Use in Clearance</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
