import React from 'react';
import { DocumentRecord, DocumentVersion } from '../../types/documentVault';
import { documentVaultService } from '../../services/documentVaultService';

interface DocumentVersionDrawerProps {
  isOpen: boolean;
  document: DocumentRecord | null;
  onClose: () => void;
  onUploadNewRevision?: (doc: DocumentRecord) => void;
}

export const DocumentVersionDrawer: React.FC<DocumentVersionDrawerProps> = ({
  isOpen,
  document,
  onClose,
  onUploadNewRevision,
}) => {
  if (!isOpen || !document) return null;

  const versions: DocumentVersion[] = documentVaultService.getDocumentVersions(document.id);
  const currentVersion = versions.find((v) => v.isCurrent) || versions[0];

  return (
    <div
      className="fixed inset-0 z-50 overflow-hidden bg-black/50 backdrop-blur-2xs transition-opacity animate-in fade-in duration-150"
      role="dialog"
      aria-modal="true"
      aria-labelledby="version-drawer-title"
    >
      <div className="absolute inset-y-0 right-0 max-w-full flex pl-10">
        <div className="w-screen max-w-xl bg-white shadow-2xl flex flex-col border-l border-slate-200">
          {/* Drawer Header */}
          <div className="bg-[#0f2b48] text-white px-6 py-5 flex items-start justify-between border-b border-slate-800">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="p-1 rounded bg-blue-500/20 text-blue-300 text-xs">🕒</span>
                <span className="text-[11px] font-bold uppercase tracking-wider text-blue-300">
                  Statutory Audit Trail
                </span>
              </div>
              <h2 id="version-drawer-title" className="text-lg font-bold font-serif leading-tight">
                Document Version History
              </h2>
              <p className="text-xs text-slate-300 mt-1 line-clamp-1">
                {document.documentName}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="text-white/70 hover:text-white p-2 rounded-lg hover:bg-white/10 transition cursor-pointer"
              aria-label="Close drawer"
            >
              ✕
            </button>
          </div>

          {/* Current Version Summary Card */}
          <div className="bg-slate-50 border-b border-slate-200 px-6 py-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-slate-500">Active Baseline</span>
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Current Active: {currentVersion?.versionNumber || 'v1.0'}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <span className="text-slate-400 block text-[10.5px]">Doc Reference</span>
                <span className="font-mono font-bold text-slate-800 truncate block">
                  {document.documentNumber}
                </span>
              </div>
              <div>
                <span className="text-slate-400 block text-[10.5px]">Issuing Authority</span>
                <span className="font-medium text-slate-800 truncate block">
                  {document.issuingAuthority}
                </span>
              </div>
            </div>
          </div>

          {/* Version Timeline */}
          <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
            <div className="relative border-l-2 border-slate-200 ml-4 pl-6 space-y-8">
              {versions.map((ver) => {
                const isCurrent = ver.isCurrent;
                return (
                  <div key={ver.id} className="relative group">
                    {/* Circle Node */}
                    <div
                      className={`absolute -left-[31px] top-1.5 w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                        isCurrent
                          ? 'bg-emerald-500 border-white ring-4 ring-emerald-100 shadow-xs'
                          : 'bg-slate-300 border-white ring-2 ring-slate-100'
                      }`}
                    />

                    {/* Version Card */}
                    <div
                      className={`rounded-xl border p-4 transition ${
                        isCurrent
                          ? 'bg-emerald-50/40 border-emerald-300 ring-1 ring-emerald-200 shadow-xs'
                          : 'bg-white border-slate-200 hover:border-slate-300 shadow-2xs'
                      }`}
                    >
                      {/* Version Header */}
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-extrabold px-2 py-0.5 rounded bg-slate-100 text-slate-800 border border-slate-200">
                            {ver.versionNumber}
                          </span>
                          {isCurrent ? (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                              Current Active Version
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-600">
                              Superseded / Archived
                            </span>
                          )}
                        </div>

                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            ver.verificationStatus === 'Verified'
                              ? 'bg-emerald-100 text-emerald-800'
                              : ver.verificationStatus === 'Pending Verification'
                              ? 'bg-amber-100 text-amber-900'
                              : 'bg-rose-100 text-rose-800'
                          }`}
                        >
                          {ver.verificationStatus === 'Verified' ? '✓ Verified' : ver.verificationStatus}
                        </span>
                      </div>

                      {/* File Details */}
                      <div className="flex items-center gap-2 p-2.5 rounded-lg bg-slate-50/80 border border-slate-200/70 mb-3">
                        <span className="text-xl">📄</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-slate-800 truncate">
                            {ver.fileName}
                          </p>
                          <p className="text-[10.5px] text-slate-500">
                            {ver.fileSize} • {ver.fileType}
                          </p>
                        </div>
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-white border border-slate-200 text-slate-600">
                          {ver.source}
                        </span>
                      </div>

                      {/* Change Reason & Remarks */}
                      <div className="text-xs mb-3">
                        <span className="font-semibold text-slate-700 block text-[11px] mb-0.5">
                          Change / Scrutiny Reason:
                        </span>
                        <p className="text-slate-600 bg-white/70 p-2 rounded border border-slate-100 text-[11.5px] leading-relaxed">
                          {ver.changeReason || 'Initial baseline record.'}
                        </p>
                      </div>

                      {/* Digital Signature Audit if present */}
                      {ver.digitalSignature && (
                        <div className="p-2.5 rounded-lg bg-blue-50/60 border border-blue-100 text-[10.5px] text-blue-900 space-y-1 mb-3">
                          <div className="flex items-center gap-1 font-bold">
                            <span>🔏 Digital Signature Certified</span>
                          </div>
                          <div>Signer: {ver.digitalSignature.signedBy}</div>
                          <div className="font-mono text-[9.5px] text-blue-700">
                            Serial: {ver.digitalSignature.certificateSerial}
                          </div>
                        </div>
                      )}

                      {/* Metadata Footer */}
                      <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[10.5px] text-slate-400">
                        <span>Uploaded by: <strong className="text-slate-600">{ver.uploadedBy}</strong></span>
                        <span>
                          {new Date(ver.uploadedAt).toLocaleDateString('en-IN', {
                            day: '2-digit',
                            month: 'short',
                            year: 'numeric',
                          })}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Drawer Actions Footer */}
          <div className="bg-slate-50 border-t border-slate-200 px-6 py-4 flex items-center justify-between">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:text-slate-800 hover:bg-slate-200/60 transition cursor-pointer"
            >
              Close History
            </button>
            {onUploadNewRevision && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onUploadNewRevision(document);
                }}
                className="px-4 py-2 rounded-xl bg-blue-700 hover:bg-blue-800 text-white text-xs font-bold shadow-xs transition flex items-center gap-1.5 cursor-pointer"
              >
                <span>📤 Upload Revision</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
