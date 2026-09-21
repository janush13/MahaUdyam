import React, { useState, useRef } from 'react';
import { DocumentRecord, DocumentCategory, DocumentSource } from '../../types/documentVault';
import { documentVaultService } from '../../services/documentVaultService';
import { applicantService } from '../../services/applicantService';

interface DocumentUploadModalProps {
  isOpen: boolean;
  documentToRevise?: DocumentRecord | null;
  onClose: () => void;
  onSuccess: () => void;
}

export const DocumentUploadModal: React.FC<DocumentUploadModalProps> = ({
  isOpen,
  documentToRevise,
  onClose,
  onSuccess,
}) => {
  const isRevisionMode = Boolean(documentToRevise);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Form states
  const [selectedFile, setSelectedFile] = useState<{
    name: string;
    size: string;
    type: string;
  } | null>(null);
  const [isDragging, setIsDragging] = useState<boolean>(false);

  // Document fields (for new document mode)
  const [documentType, setDocumentType] = useState<string>('');
  const [documentName, setDocumentName] = useState<string>('');
  const [category, setCategory] = useState<DocumentCategory>('Land & Siting');
  const [issuingAuthority, setIssuingAuthority] = useState<string>('');
  const [documentNumber, setDocumentNumber] = useState<string>('');
  const [issueDate, setIssueDate] = useState<string>(
    new Date().toISOString().split('T')[0]
  );
  const [hasExpiry, setHasExpiry] = useState<boolean>(false);
  const [expiryDate, setExpiryDate] = useState<string>('');
  const [selectedEnterpriseId, setSelectedEnterpriseId] = useState<string>('ent-dipl-01');
  const [selectedProjectId, setSelectedProjectId] = useState<string>('proj-chk-01');
  const [changeReason, setChangeReason] = useState<string>('');
  const [source, setSource] = useState<DocumentSource>('Direct Upload');

  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  const enterprises = applicantService.getEnterprises();
  const projects = applicantService.getProjects();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const f = e.target.files[0];
      const sizeMb = (f.size / (1024 * 1024)).toFixed(2);
      setSelectedFile({
        name: f.name,
        size: `${sizeMb} MB`,
        type: f.type || 'application/pdf',
      });
      if (!documentName && !isRevisionMode) {
        setDocumentName(f.name.replace(/\.[^/.]+$/, '').replace(/_/g, ' '));
      }
      setErrorMessage(null);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const f = e.dataTransfer.files[0];
      const sizeMb = (f.size / (1024 * 1024)).toFixed(2);
      setSelectedFile({
        name: f.name,
        size: `${sizeMb} MB`,
        type: f.type || 'application/pdf',
      });
      if (!documentName && !isRevisionMode) {
        setDocumentName(f.name.replace(/\.[^/.]+$/, '').replace(/_/g, ' '));
      }
      setErrorMessage(null);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!selectedFile) {
      setErrorMessage('Please choose or drag a PDF/document file to upload.');
      return;
    }

    if (isRevisionMode && documentToRevise) {
      if (!changeReason.trim()) {
        setErrorMessage('Please state the statutory revision reason (e.g. modified drawings or renewal).');
        return;
      }

      setIsSubmitting(true);
      setErrorMessage(null);

      const res = documentVaultService.uploadNewVersion(documentToRevise.id, {
        fileName: selectedFile.name,
        fileType: selectedFile.type,
        fileSize: selectedFile.size,
        uploadedBy: 'Priya Deshmukh (Authorized Signatory)',
        changeReason: changeReason.trim(),
      });

      setIsSubmitting(false);

      if (res.success) {
        onSuccess();
        onClose();
      } else {
        setErrorMessage(res.message);
      }
    } else {
      // New Document Mode
      if (!documentName.trim()) {
        setErrorMessage('Please provide an official document title.');
        return;
      }
      if (!issuingAuthority.trim()) {
        setErrorMessage('Please specify the competent issuing authority.');
        return;
      }

      setIsSubmitting(true);
      setErrorMessage(null);

      const res = documentVaultService.createDocument(
        {
          documentType: documentType.trim() || 'Statutory Filing Document',
          documentName: documentName.trim(),
          category,
          ownerType: 'Project',
          enterpriseId: selectedEnterpriseId,
          projectIds: selectedProjectId ? [selectedProjectId] : [],
          issuingAuthority: issuingAuthority.trim(),
          documentNumber: documentNumber.trim() || `MH-DOC-${Date.now().toString().slice(-6)}`,
          issueDate,
          expiryDate: hasExpiry && expiryDate ? expiryDate : null,
          source,
          statutoryReferences: ['MahaUdyam One Statutory Vault'],
        },
        {
          fileName: selectedFile.name,
          fileType: selectedFile.type,
          fileSize: selectedFile.size,
          uploadedBy: 'Priya Deshmukh',
          changeReason: changeReason || 'Initial statutory document filing in locker.',
        }
      );

      setIsSubmitting(false);

      if (res.success) {
        onSuccess();
        onClose();
      } else {
        setErrorMessage(res.message);
      }
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs overflow-y-auto animate-in fade-in duration-150"
      role="dialog"
      aria-modal="true"
      aria-labelledby="upload-modal-title"
    >
      <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[92vh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden my-auto">
        {/* Header */}
        <div className="bg-[#0f2b48] text-white px-6 py-4 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-lg bg-white/10 border border-white/20 flex items-center justify-center text-lg">
              {isRevisionMode ? '📤' : '📄'}
            </div>
            <div>
              <h3 id="upload-modal-title" className="text-base font-bold font-serif leading-tight">
                {isRevisionMode
                  ? 'Upload Revised Document Version'
                  : 'Add Statutory Document to Vault'}
              </h3>
              <p className="text-[11px] text-blue-200 mt-0.5">
                {isRevisionMode
                  ? `Submitting new revision for: ${documentToRevise?.documentName}`
                  : 'Deposit verified or certified records for single window reuse'}
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

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="flex-1 flex flex-col overflow-hidden">
          <div className="p-6 overflow-y-auto flex-1 space-y-5 text-xs text-slate-600">
            {/* Error Message */}
            {errorMessage && (
              <div className="p-3.5 rounded-xl bg-rose-50 text-rose-900 border border-rose-200 flex items-start gap-2">
                <span className="text-base">⚠️</span>
                <span className="leading-snug">{errorMessage}</span>
              </div>
            )}

            {/* Prototype Safeguard Banner */}
            <div className="p-3 bg-blue-50/70 border border-blue-200 rounded-xl text-blue-900 flex items-start gap-2.5">
              <span className="text-base">ℹ️</span>
              <div className="text-[11px] leading-relaxed">
                <span className="font-bold">Prototype Integrity Notice:</span> Newly uploaded documents enter the <strong>'Pending Verification'</strong> queue for departmental officer scrutiny. They are not falsely marked as government-verified until approved.
              </div>
            </div>

            {/* Drag and drop zone */}
            <div>
              <label className="font-semibold text-slate-700 mb-1.5 block">
                Select or Drag Document File <span className="text-rose-500">*</span>
              </label>
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`p-6 border-2 border-dashed rounded-2xl text-center cursor-pointer transition ${
                  isDragging
                    ? 'border-blue-500 bg-blue-50/50'
                    : selectedFile
                    ? 'border-emerald-400 bg-emerald-50/30'
                    : 'border-slate-300 hover:border-blue-400 bg-slate-50/60'
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  onChange={handleFileChange}
                  accept=".pdf,.png,.jpg,.jpeg,.dwg"
                  className="hidden"
                />

                {selectedFile ? (
                  <div className="space-y-1">
                    <span className="text-3xl block">📄</span>
                    <p className="font-bold text-xs text-slate-900 truncate max-w-sm mx-auto">
                      {selectedFile.name}
                    </p>
                    <p className="text-[11px] text-emerald-700 font-semibold">
                      {selectedFile.size} • Ready for statutory deposit
                    </p>
                    <span className="text-[10px] text-blue-600 underline block pt-1">
                      Click to choose a different file
                    </span>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <span className="text-3xl block text-slate-400">📁</span>
                    <p className="font-bold text-xs text-slate-800">
                      Click to browse or drag and drop document
                    </p>
                    <p className="text-[11px] text-slate-400">
                      Supported formats: PDF, DWG / CAD, Signed Scan (Max 25 MB)
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Revision Mode: Details */}
            {isRevisionMode && documentToRevise && (
              <div className="space-y-4">
                <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200">
                  <span className="text-[10.5px] font-semibold text-slate-400 block uppercase">
                    Target Document
                  </span>
                  <p className="font-bold text-slate-800 text-xs mt-0.5">
                    {documentToRevise.documentName}
                  </p>
                  <p className="text-[11px] text-slate-500 mt-1">
                    Issuing Authority: {documentToRevise.issuingAuthority} • No: {documentToRevise.documentNumber}
                  </p>
                </div>

                <div>
                  <label htmlFor="rev-reason" className="font-semibold text-slate-700 mb-1 block">
                    Statutory Reason for Revision <span className="text-rose-500">*</span>
                  </label>
                  <textarea
                    id="rev-reason"
                    rows={3}
                    placeholder="e.g. Revised layout to provide 12m clear peripheral fire access as directed by MIDC Chief Fire Officer; or Renewal deed extension..."
                    value={changeReason}
                    onChange={(e) => setChangeReason(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 text-xs"
                    required
                  />
                  <span className="text-[10.5px] text-slate-400 block mt-1">
                    This remark is permanently recorded in the version history audit trail.
                  </span>
                </div>
              </div>
            )}

            {/* New Document Mode: Full metadata form */}
            {!isRevisionMode && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="new-doc-type" className="font-semibold text-slate-700 mb-1 block">
                      Document Type
                    </label>
                    <input
                      id="new-doc-type"
                      type="text"
                      placeholder="e.g. Factory Layout Plan, ETP Scheme"
                      value={documentType}
                      onChange={(e) => setDocumentType(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <div>
                    <label htmlFor="new-doc-category" className="font-semibold text-slate-700 mb-1 block">
                      Category
                    </label>
                    <select
                      id="new-doc-category"
                      value={category}
                      onChange={(e) => setCategory(e.target.value as DocumentCategory)}
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                    >
                      <option value="Land & Siting">Land &amp; Siting</option>
                      <option value="Engineering & Layout">Engineering &amp; Layout</option>
                      <option value="Environmental & Health">Environmental &amp; Health</option>
                      <option value="Safety & Utility">Safety &amp; Utility</option>
                      <option value="Labour & Workforce">Labour &amp; Workforce</option>
                      <option value="Enterprise Registration">Enterprise Registration</option>
                      <option value="Financial & Statutory">Financial &amp; Statutory</option>
                      <option value="Other Regulatory Documents">Other Regulatory Documents</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label htmlFor="new-doc-title" className="font-semibold text-slate-700 mb-1 block">
                    Official Document Title <span className="text-rose-500">*</span>
                  </label>
                  <input
                    id="new-doc-title"
                    type="text"
                    placeholder="e.g. Zero Liquid Discharge ETP Engineering Schematics"
                    value={documentName}
                    onChange={(e) => setDocumentName(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    required
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="new-doc-auth" className="font-semibold text-slate-700 mb-1 block">
                      Issuing Authority <span className="text-rose-500">*</span>
                    </label>
                    <input
                      id="new-doc-auth"
                      type="text"
                      placeholder="e.g. MPCB, MIDC, DISH, Chartered Architect"
                      value={issuingAuthority}
                      onChange={(e) => setIssuingAuthority(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      required
                    />
                  </div>

                  <div>
                    <label htmlFor="new-doc-num" className="font-semibold text-slate-700 mb-1 block">
                      Certificate / Document Number
                    </label>
                    <input
                      id="new-doc-num"
                      type="text"
                      placeholder="e.g. MIDC/RO-PUN/2026/102"
                      value={documentNumber}
                      onChange={(e) => setDocumentNumber(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="new-issue-date" className="font-semibold text-slate-700 mb-1 block">
                      Date of Issue
                    </label>
                    <input
                      id="new-issue-date"
                      type="date"
                      value={issueDate}
                      onChange={(e) => setIssueDate(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label htmlFor="has-exp-check" className="font-semibold text-slate-700">
                        Has Expiry / Validity Period?
                      </label>
                      <input
                        id="has-exp-check"
                        type="checkbox"
                        checked={hasExpiry}
                        onChange={(e) => setHasExpiry(e.target.checked)}
                        className="rounded text-blue-600 focus:ring-blue-500"
                      />
                    </div>
                    {hasExpiry ? (
                      <input
                        type="date"
                        value={expiryDate}
                        onChange={(e) => setExpiryDate(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    ) : (
                      <div className="px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 text-slate-400 text-[11px]">
                        Perpetual / Nil Expiry (e.g. Title Deed / Reg. Certificate)
                      </div>
                    )}
                  </div>
                </div>

                {/* Linking Context */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="new-ent-select" className="font-semibold text-slate-700 mb-1 block">
                      Enterprise
                    </label>
                    <select
                      id="new-ent-select"
                      value={selectedEnterpriseId}
                      onChange={(e) => setSelectedEnterpriseId(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                    >
                      {enterprises.map((ent) => (
                        <option key={ent.id} value={ent.id}>
                          {ent.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label htmlFor="new-proj-select" className="font-semibold text-slate-700 mb-1 block">
                      Industrial Project
                    </label>
                    <select
                      id="new-proj-select"
                      value={selectedProjectId}
                      onChange={(e) => setSelectedProjectId(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                    >
                      <option value="">Global / All Projects</option>
                      {projects.map((proj) => (
                        <option key={proj.id} value={proj.id}>
                          {proj.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="bg-slate-50 border-t border-slate-200 px-6 py-4 flex items-center justify-between">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:text-slate-800 transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !selectedFile}
              className={`px-5 py-2 rounded-xl text-xs font-bold text-white transition flex items-center gap-1.5 shadow-xs cursor-pointer ${
                isSubmitting || !selectedFile
                  ? 'bg-slate-300 cursor-not-allowed text-slate-500'
                  : 'bg-[#0f2b48] hover:bg-[#0b1f33]'
              }`}
            >
              {isSubmitting ? (
                <span>Depositing Document...</span>
              ) : (
                <span>{isRevisionMode ? 'Confirm Revision Deposit' : 'Deposit in Locker'}</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
