import React, { useMemo, useRef, useState } from 'react';
import {
  OfficerAuditEvent,
  OfficerDecision,
  OfficerDeskStatus,
  OfficerDocStatus,
  OfficerDossier,
  OfficerQueryMessage,
  OfficerQueueRecord,
} from '../../types/officer';
import {
  DESK_STATUS_LABEL,
  FORWARD_AUTHORITY_OPTIONS,
  daysLeftLabel,
  formatDisplayDate,
} from '../../services/officerQueueService';

// ── Per-dossier working state (kept by the page so it survives switching between queue rows) ──

export interface DossierWork {
  docStatus: Record<string, OfficerDocStatus>;
  docComments: Record<string, string[]>;
  extraQueries: OfficerQueryMessage[];
  extraAudit: OfficerAuditEvent[];
  decision: OfficerDecision;
  remarks: string;
  forwardTo: string;
  draftSavedAt: string | null;
  status: OfficerDeskStatus | null;
  forwardedTo: string | null;
  /** Screen 27 (full Officer Application Workspace) state, shared through the officer session store. */
  queryClosed: boolean;
  wsForwardTo: string;
}

export const initDossierWork = (dossier: OfficerDossier): DossierWork => ({
  docStatus: Object.fromEntries(dossier.documents.map((d) => [d.id, d.status])),
  docComments: {},
  extraQueries: [],
  extraAudit: [],
  decision: dossier.defaultDecision,
  remarks: dossier.defaultRemarks,
  forwardTo: FORWARD_AUTHORITY_OPTIONS[0].value,
  draftSavedAt: null,
  status: null,
  forwardedTo: null,
  queryClosed: false,
  wsForwardTo: 'Statutory Approving Authority (Level 2)',
});

type WorkspaceTab = 'overview' | 'documents' | 'query' | 'inspection' | 'decision' | 'audit';

interface Props {
  record: OfficerQueueRecord;
  dossier: OfficerDossier;
  work: DossierWork;
  officerName: string;
  onWorkChange: (patch: Partial<DossierWork>) => void;
  onNotify: (message: string, tone?: 'success' | 'error' | 'info') => void;
  /** When provided, a header button opens the full Screen 27 workspace for this dossier. */
  onOpenFullWorkspace?: () => void;
}

const nowLabel = (): string => {
  const d = new Date();
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  const suffix = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `13 Dec 2024, ${String(h).padStart(2, '0')}:${m} ${suffix}`;
};

const riskPill: Record<OfficerQueueRecord['slaRisk'], string> = {
  BREACHED: 'bg-rose-600 text-white',
  NEAR_BREACH: 'bg-orange-500 text-white',
  APPROACHING: 'bg-amber-500 text-white',
  WITHIN_SLA: 'bg-emerald-600 text-white',
  COMPLIED: 'bg-slate-500 text-white',
};

const DOC_STATUS_LABEL: Record<OfficerDocStatus, string> = {
  VERIFIED: 'Verified',
  UNDER_VERIFICATION: 'Under Verification',
  REJECTED: 'Rejected — Resubmission',
};

export const OfficerDossierWorkspace: React.FC<Props> = ({ record, dossier, work, officerName, onWorkChange, onNotify, onOpenFullWorkspace }) => {
  const [tab, setTab] = useState<WorkspaceTab>('documents');
  const [selectedDocs, setSelectedDocs] = useState<string[]>([]);
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchNote, setBatchNote] = useState('');
  const [commentOpen, setCommentOpen] = useState(false);
  const [commentDoc, setCommentDoc] = useState('');
  const [commentText, setCommentText] = useState('');
  const [viewDocId, setViewDocId] = useState<string | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [queryText, setQueryText] = useState('');
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const decisionRef = useRef<HTMLDivElement>(null);
  const remarksRef = useRef<HTMLTextAreaElement>(null);

  const status: OfficerDeskStatus = work.status ?? record.status;
  const isClosed = status === 'APPROVED';
  const documents = dossier.documents;
  const docStatusOf = (id: string): OfficerDocStatus => work.docStatus[id] ?? 'UNDER_VERIFICATION';
  const verifiedCount = documents.filter((d) => docStatusOf(d.id) === 'VERIFIED').length;
  const thread = useMemo(() => [...dossier.queryThread, ...work.extraQueries], [dossier.queryThread, work.extraQueries]);
  const queryCount = (dossier.queryThread.length > 0 ? 1 : 0) + work.extraQueries.length;
  const awaitingApplicant = thread.length > 0 && thread[thread.length - 1].from === 'OFFICER';
  const audit = useMemo(() => [...dossier.auditTrail, ...work.extraAudit], [dossier.auditTrail, work.extraAudit]);
  const viewDoc = documents.find((d) => d.id === viewDocId) ?? null;

  const addAudit = (action: string, detail?: string): OfficerAuditEvent[] => [
    ...work.extraAudit,
    { id: `X${work.extraAudit.length + 1}`, at: nowLabel(), actor: officerName, action, detail },
  ];

  // ── Documents ──
  const toggleDoc = (id: string) =>
    setSelectedDocs((prev) => (prev.includes(id) ? prev.filter((d) => d !== id) : [...prev, id]));

  const applyBatch = (outcome: 'VERIFIED' | 'REJECTED') => {
    if (selectedDocs.length === 0) {
      onNotify('Select at least one document to verify or reject.', 'error');
      return;
    }
    if (outcome === 'REJECTED' && !batchNote.trim()) {
      onNotify('A remark is mandatory when rejecting documents.', 'error');
      return;
    }
    const nextStatus = { ...work.docStatus };
    const nextComments = { ...work.docComments };
    selectedDocs.forEach((id) => {
      nextStatus[id] = outcome;
      if (outcome === 'REJECTED') nextComments[id] = [...(nextComments[id] ?? []), `Rejected: ${batchNote.trim()}`];
    });
    onWorkChange({
      docStatus: nextStatus,
      docComments: nextComments,
      extraAudit: addAudit(
        outcome === 'VERIFIED' ? `${selectedDocs.length} document(s) verified` : `${selectedDocs.length} document(s) rejected`,
        outcome === 'REJECTED' ? batchNote.trim() : undefined
      ),
    });
    onNotify(`${selectedDocs.length} document(s) marked ${outcome === 'VERIFIED' ? 'Verified' : 'Rejected'}.`, 'success');
    setSelectedDocs([]);
    setBatchNote('');
    setBatchOpen(false);
  };

  const saveComment = () => {
    if (!commentDoc || !commentText.trim()) {
      onNotify('Choose a document and enter the comment.', 'error');
      return;
    }
    onWorkChange({
      docComments: { ...work.docComments, [commentDoc]: [...(work.docComments[commentDoc] ?? []), commentText.trim()] },
      extraAudit: addAudit('Document comment added', commentText.trim()),
    });
    setCommentText('');
    setCommentOpen(false);
    onNotify('Document comment recorded.', 'success');
  };

  // ── Query ──
  const openComposer = () => {
    setTab('query');
    setComposerOpen(true);
  };

  const sendQuery = () => {
    if (!queryText.trim()) {
      onNotify('Enter the clarification query text.', 'error');
      return;
    }
    const message: OfficerQueryMessage = {
      id: `${dossier.queryRef}-N${work.extraQueries.length + 1}`,
      from: 'OFFICER',
      author: `Officer Inquiry • ${officerName}`,
      at: nowLabel(),
      text: queryText.trim(),
    };
    onWorkChange({
      extraQueries: [...work.extraQueries, message],
      status: 'QUERY_RAISED',
      extraAudit: addAudit(`Query ${dossier.queryRef} raised`, queryText.trim()),
    });
    setQueryText('');
    setComposerOpen(false);
    onNotify('Query sent to the applicant. Status set to Query Raised.', 'success');
  };

  // ── Decision ──
  const focusDecision = () => {
    decisionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    remarksRef.current?.focus();
  };

  const saveDraft = () => {
    onWorkChange({ draftSavedAt: nowLabel() });
    onNotify('Draft scrutiny note saved.', 'success');
  };

  const submitDecision = () => {
    setDecisionError(null);
    if (!work.remarks.trim()) {
      setDecisionError('Officer scrutiny remarks & statutory note are mandatory (RTS legal record).');
      return;
    }
    if (work.decision === 'approve') {
      if (verifiedCount < documents.length) {
        setDecisionError(`Cannot recommend grant: ${documents.length - verifiedCount} of ${documents.length} mandatory documents are not verified.`);
        return;
      }
      if (awaitingApplicant) {
        setDecisionError('Cannot recommend grant while a clarification query is awaiting the applicant\'s response.');
        return;
      }
    }
    const authority = FORWARD_AUTHORITY_OPTIONS.find((o) => o.value === work.forwardTo)?.label ?? '';
    if (work.decision === 'clarification') {
      onWorkChange({
        status: 'INSPECTION_SCHEDULED',
        extraAudit: addAudit('Held for field joint inspection', work.remarks.trim()),
      });
      onNotify('Dossier held for field joint inspection.', 'success');
      return;
    }
    const label = work.decision === 'approve' ? 'Recommended for grant of licence' : 'Recommended rejection / resubmission';
    onWorkChange({
      status: 'DECISION_PENDING',
      forwardedTo: authority,
      draftSavedAt: null,
      extraAudit: addAudit(`${label} — forwarded`, `To: ${authority}`),
    });
    onNotify(`Recommendation submitted and forwarded to ${authority}.`, 'success');
  };

  const tabs: Array<{ id: WorkspaceTab; label: string; badge?: number; badgeCls?: string }> = [
    { id: 'overview', label: 'Overview (Applicant & Project)' },
    { id: 'documents', label: 'Documents', badge: documents.length, badgeCls: 'bg-blue-100 text-blue-800' },
    { id: 'query', label: 'Clarification Query', badge: queryCount || undefined, badgeCls: 'bg-amber-100 text-amber-800' },
    { id: 'inspection', label: 'Joint Inspection', badge: dossier.inspection ? 1 : undefined, badgeCls: 'bg-teal-100 text-teal-800' },
    { id: 'decision', label: 'Decision & Sign-off' },
    { id: 'audit', label: 'Audit Timeline & History' },
  ];

  const statusBadge: Record<OfficerDeskStatus, string> = {
    UNDER_SCRUTINY: 'bg-amber-400 text-[#0A1526]',
    QUERY_RAISED: 'bg-amber-600 text-white',
    INSPECTION_SCHEDULED: 'bg-teal-500 text-white',
    DECISION_PENDING: 'bg-purple-500 text-white',
    APPROVED: 'bg-emerald-500 text-white',
  };

  // ── Sub-panels ──

  const enterpriseCard = (
    <div className="bg-slate-50 border border-slate-200 rounded p-4" data-purpose="enterprise-metadata-card">
      <div className="flex justify-between items-center mb-3 pb-2 border-b border-slate-200 flex-wrap gap-1">
        <h4 className="text-xs font-bold text-[#0F2038] uppercase tracking-wide">Applicant &amp; Enterprise Dossier Data</h4>
        <span className="text-[11px] font-mono text-slate-500">Submitted: {dossier.submittedAt}</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-y-3 gap-x-4 text-xs">
        <div><span className="block text-[11px] text-slate-500">Enterprise Name</span><span className="font-bold text-slate-800">{dossier.enterpriseName}</span></div>
        <div><span className="block text-[11px] text-slate-500">UDYAM Registration</span><span className="font-mono font-bold text-slate-800">{dossier.udyam}</span></div>
        <div><span className="block text-[11px] text-slate-500">Applicant / Signatory</span><span className="font-semibold text-slate-800">{dossier.signatory}</span></div>
        <div><span className="block text-[11px] text-slate-500">Project / Site</span><span className="font-semibold text-slate-800">{dossier.projectSite}</span></div>
        <div><span className="block text-[11px] text-slate-500">Proposed Investment</span><span className="font-bold text-slate-800">{dossier.investment}</span></div>
        <div><span className="block text-[11px] text-slate-500">Proposed Workforce</span><span className="font-bold text-slate-800">{dossier.workforce}</span></div>
        <div className="sm:col-span-2"><span className="block text-[11px] text-slate-500">Location Address</span><span className="text-slate-700">{dossier.address}</span></div>
        <div><span className="block text-[11px] text-slate-500">NIC Code / Category</span><span className="text-slate-700 font-medium">{dossier.nicCategory}</span></div>
      </div>
    </div>
  );

  const documentMatrix = (
    <div className="border border-slate-200 rounded overflow-hidden" data-purpose="document-scrutiny-matrix">
      <div className="bg-slate-100 px-3.5 py-2.5 border-b border-slate-200 flex justify-between items-center flex-wrap gap-2">
        <div className="flex items-center space-x-2">
          <h4 className="text-xs font-bold text-[#0F2038] uppercase tracking-wide">Mandatory Scrutiny Documents Checklist</h4>
          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${verifiedCount === documents.length ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
            {verifiedCount} of {documents.length} Verified
          </span>
        </div>
        <button
          type="button"
          disabled={isClosed}
          onClick={() => {
            setCommentOpen((o) => !o);
            setCommentDoc(commentDoc || documents[0]?.id || '');
          }}
          className="text-xs text-blue-700 hover:underline font-semibold disabled:opacity-40"
        >
          + Add Document Comment
        </button>
      </div>

      {commentOpen && (
        <div className="p-3 bg-blue-50/60 border-b border-slate-200 flex flex-col sm:flex-row gap-2 text-xs">
          <select value={commentDoc} onChange={(e) => setCommentDoc(e.target.value)} className="rounded border border-slate-300 py-1.5 px-2 bg-white sm:w-56">
            {documents.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
          </select>
          <input
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            placeholder="Comment on the selected document"
            className="flex-1 rounded border border-slate-300 py-1.5 px-2 bg-white"
          />
          <button type="button" onClick={saveComment} className="px-3 py-1.5 bg-[#142A4A] text-white rounded font-semibold">Save</button>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 text-[11px] font-semibold text-slate-600 border-b border-slate-200">
            <tr>
              <th className="py-2 px-3">Document Title</th>
              <th className="py-2 px-3">Submitted On</th>
              <th className="py-2 px-3">Status</th>
              <th className="py-2 px-3 text-right">Verification</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {documents.map((doc) => {
              const ds = docStatusOf(doc.id);
              const comments = work.docComments[doc.id] ?? [];
              return (
                <tr key={doc.id} className={`hover:bg-slate-50/80 ${ds === 'UNDER_VERIFICATION' ? 'bg-amber-50/30' : ds === 'REJECTED' ? 'bg-rose-50/40' : ''}`}>
                  <td className="py-2.5 px-3">
                    <label className="font-semibold text-slate-800 flex items-center cursor-pointer">
                      {!isClosed && (
                        <input type="checkbox" className="mr-2 rounded border-slate-300" checked={selectedDocs.includes(doc.id)} onChange={() => toggleDoc(doc.id)} aria-label={`Select ${doc.title}`} />
                      )}
                      <span className={`mr-1.5 ${doc.fileType === 'cad' ? 'text-blue-500' : 'text-red-500'}`}>📄</span>
                      {doc.title}
                    </label>
                    <span className={`text-[10px] block ${isClosed ? 'pl-5' : 'pl-11'} ${ds === 'UNDER_VERIFICATION' ? 'text-amber-800 font-medium' : 'text-slate-500'}`}>
                      {doc.subtitle}
                    </span>
                    {comments.map((c, i) => (
                      <span key={i} className={`block text-[10px] text-slate-600 italic ${isClosed ? 'pl-5' : 'pl-11'}`}>“{c}”</span>
                    ))}
                  </td>
                  <td className="py-2.5 px-3 font-mono text-[11px] text-slate-600 whitespace-nowrap">{doc.submittedOn}</td>
                  <td className="py-2.5 px-3">
                    <span className={`inline-flex items-center text-xs font-semibold ${ds === 'VERIFIED' ? 'text-emerald-700' : ds === 'REJECTED' ? 'text-rose-700' : 'text-amber-700'}`}>
                      {ds === 'VERIFIED' ? <span className="mr-1 text-emerald-600">✔</span> : <span className={`w-2 h-2 rounded-full mr-1.5 ${ds === 'REJECTED' ? 'bg-rose-500' : 'bg-amber-500'}`} />}
                      {DOC_STATUS_LABEL[ds]}
                    </span>
                  </td>
                  <td className="py-2.5 px-3 text-right">
                    <button type="button" onClick={() => setViewDocId(doc.id)} className="text-blue-700 hover:text-blue-900 font-semibold text-xs underline whitespace-nowrap">
                      {doc.actionLabel}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {batchOpen && !isClosed && (
        <div className="p-3 bg-slate-50 border-t border-slate-200 text-xs space-y-2">
          <p className="text-slate-600">
            {selectedDocs.length} document(s) selected. Add a remark (mandatory for rejection), then choose an outcome.
          </p>
          <input value={batchNote} onChange={(e) => setBatchNote(e.target.value)} placeholder="Remark for the applicant / record" className="w-full rounded border border-slate-300 py-1.5 px-2 bg-white" />
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => setBatchOpen(false)} className="px-3 py-1 text-slate-600 font-semibold">Cancel</button>
            <button type="button" onClick={() => applyBatch('REJECTED')} className="px-3 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded font-semibold">Reject Selected</button>
            <button type="button" onClick={() => applyBatch('VERIFIED')} className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded font-semibold">Verify Selected</button>
          </div>
        </div>
      )}

      <div className="p-2.5 bg-slate-50 border-t border-slate-200 flex justify-between items-center text-xs gap-2 flex-wrap">
        <span className="text-slate-500 text-[11px]">Action: Select documents to flag or verify</span>
        <button
          type="button"
          disabled={isClosed}
          onClick={() => setBatchOpen((o) => !o)}
          className="px-3 py-1 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded font-semibold text-xs transition disabled:opacity-40"
        >
          Verify / Reject Document Batch
        </button>
      </div>
    </div>
  );

  const renderThread = (messages: OfficerQueryMessage[]) => (
    <div className="mt-2.5 space-y-2 text-xs">
      {messages.length === 0 && <p className="text-slate-500 italic">No clarification query has been raised on this dossier.</p>}
      {messages.map((m) =>
        m.from === 'OFFICER' ? (
          <div key={m.id} className="bg-amber-50/60 p-2.5 rounded border border-amber-200 text-slate-800">
            <div className="flex justify-between font-semibold text-[11px] text-amber-900 mb-1 gap-2">
              <span>{m.author.includes('•') ? m.author : `${m.author} • ${officerName}`}</span>
              <span className="font-mono text-slate-500 whitespace-nowrap">{m.at}</span>
            </div>
            <p className="text-xs text-slate-700">“{m.text}”</p>
          </div>
        ) : (
          <div key={m.id} className="bg-emerald-50/60 p-2.5 rounded border border-emerald-200 text-slate-800 ml-3">
            <div className="flex justify-between font-semibold text-[11px] text-emerald-900 mb-1 gap-2">
              <span>{m.author}</span>
              <span className="font-mono text-slate-500 whitespace-nowrap">{m.at}</span>
            </div>
            <p className="text-xs text-slate-700">“{m.text}”</p>
            {m.attachment && (
              <button type="button" onClick={() => onNotify(`Preview of ${m.attachment} is not available in the prototype.`, 'info')} className="mt-1.5 flex items-center text-[11px] text-blue-700 font-medium hover:underline">
                📎 {m.attachment}
              </button>
            )}
          </div>
        )
      )}
    </div>
  );

  const queryPanel = (full: boolean) => (
    <div className="border border-slate-200 rounded p-3.5 bg-white" data-purpose="clarification-query-thread">
      <div className="flex items-center justify-between pb-2 border-b border-slate-200 flex-wrap gap-1">
        <div className="flex items-center space-x-2">
          <span className={`w-2 h-2 rounded-full ${awaitingApplicant ? 'bg-amber-500' : 'bg-emerald-500'}`} />
          <h4 className="text-xs font-bold text-slate-900 uppercase">Applicant Clarification Thread (RTS Query Log)</h4>
        </div>
        <span className="text-[11px] text-slate-500 font-mono">Query Ref: {dossier.queryRef}</span>
      </div>
      {renderThread(full ? thread : thread.slice(-2))}
      {awaitingApplicant && <p className="mt-2 text-[11px] text-amber-800 font-semibold">⏸ Awaiting applicant response — RTS clock paused for this query.</p>}
      {composerOpen && (
        <div className="mt-3 p-2.5 bg-amber-50/50 border border-amber-200 rounded space-y-2 text-xs">
          <label className="block font-semibold text-slate-700" htmlFor="new-query-text">New clarification query</label>
          <textarea id="new-query-text" rows={3} value={queryText} onChange={(e) => setQueryText(e.target.value)} className="block w-full text-xs rounded border-slate-300 border p-2" placeholder="State the document or clarification required from the applicant" />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setComposerOpen(false)} className="px-2.5 py-1 font-semibold text-slate-600">Cancel</button>
            <button type="button" onClick={sendQuery} className="px-3 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded font-semibold">Send Query to Applicant</button>
          </div>
        </div>
      )}
      <div className="mt-2.5 pt-2 border-t border-slate-100 flex justify-end space-x-2">
        {!full && (
          <button type="button" onClick={() => setTab('query')} className="px-2.5 py-1 text-xs font-semibold text-slate-600 hover:text-slate-800">
            Query History →
          </button>
        )}
        <button type="button" disabled={isClosed} onClick={openComposer} className="px-3 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded text-xs font-semibold transition disabled:opacity-40">
          Raise Additional Query
        </button>
      </div>
    </div>
  );

  const leftContent = (() => {
    switch (tab) {
      case 'overview':
        return (
          <>
            {enterpriseCard}
            <div className="bg-white border border-slate-200 rounded p-4 text-xs" data-purpose="sla-clock-card">
              <h4 className="text-xs font-bold text-[#0F2038] uppercase tracking-wide pb-2 mb-3 border-b border-slate-200">RTS Statutory Clock</h4>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div><span className="block text-[11px] text-slate-500">Application No.</span><span className="font-mono font-bold text-blue-700">{record.applicationNo}</span></div>
                <div><span className="block text-[11px] text-slate-500">Approval</span><span className="font-semibold text-slate-800">{record.approvalName}</span></div>
                <div><span className="block text-[11px] text-slate-500">SLA Due</span><span className="font-mono font-semibold text-slate-800">{formatDisplayDate(record.dueDate)}</span></div>
                <div><span className="block text-[11px] text-slate-500">Days Left</span><span className="font-bold text-slate-800">{daysLeftLabel(record.daysLeft)}</span></div>
                <div><span className="block text-[11px] text-slate-500">Department</span><span className="font-semibold text-slate-800">{record.deptName}</span></div>
                <div><span className="block text-[11px] text-slate-500">Desk</span><span className="font-semibold text-slate-800">{record.deskName}</span></div>
                <div className="col-span-2"><span className="block text-[11px] text-slate-500">Governing Act</span><span className="font-semibold text-slate-800">{record.act}</span></div>
              </div>
            </div>
          </>
        );
      case 'query':
        return queryPanel(true);
      case 'inspection':
        return dossier.inspection ? (
          <div className="border border-slate-200 rounded bg-white" data-purpose="joint-inspection-panel">
            <div className="bg-slate-100 px-3.5 py-2.5 border-b border-slate-200 flex justify-between items-center flex-wrap gap-1">
              <h4 className="text-xs font-bold text-[#0F2038] uppercase tracking-wide">Field Inspection {dossier.inspection.ref}</h4>
              <span className={`text-[11px] font-bold ${dossier.inspection.outcomeLabel === 'Satisfactory' ? 'text-emerald-700' : 'text-teal-700'}`}>
                {dossier.inspection.outcomeLabel} • {dossier.inspection.dateLabel}
              </span>
            </div>
            <div className="p-3.5 text-xs space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div><span className="block text-[11px] text-slate-500">Inspector</span><span className="font-semibold">{dossier.inspection.inspector}</span></div>
                <div><span className="block text-[11px] text-slate-500">Location</span><span className="font-semibold">{dossier.inspection.location}</span></div>
                <div className="col-span-2"><span className="block text-[11px] text-slate-500">Clearances</span><span className="font-semibold">{dossier.inspection.clearances}</span></div>
              </div>
              <ul className="divide-y divide-slate-100 border border-slate-200 rounded">
                {dossier.inspection.checklist.map((c) => (
                  <li key={c.item} className="flex justify-between px-3 py-2">
                    <span className="text-slate-700">{c.item}</span>
                    <span className={`font-semibold ${c.result === 'Compliant' ? 'text-emerald-700' : 'text-amber-700'}`}>{c.result}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : (
          <div className="border border-dashed border-slate-300 rounded p-6 text-center text-xs text-slate-500">
            No joint inspection is linked to this dossier. Choose “Hold for Field Joint Inspection” in the decision panel to request one.
          </div>
        );
      case 'decision': {
        const checks = [
          { label: 'All mandatory documents verified', ok: verifiedCount === documents.length },
          { label: 'No clarification query awaiting applicant', ok: !awaitingApplicant },
          { label: 'Joint inspection satisfactory / not required', ok: !dossier.inspection || dossier.inspection.outcomeLabel === 'Satisfactory' },
          { label: 'Scrutiny remarks recorded', ok: work.remarks.trim().length > 0 },
        ];
        return (
          <div className="bg-white border border-slate-200 rounded p-4 text-xs space-y-3" data-purpose="sign-off-checklist">
            <h4 className="text-xs font-bold text-[#0F2038] uppercase tracking-wide pb-2 border-b border-slate-200">Sign-off Readiness</h4>
            <ul className="space-y-1.5">
              {checks.map((c) => (
                <li key={c.label} className="flex items-center gap-2">
                  <span className={c.ok ? 'text-emerald-600' : 'text-amber-600'}>{c.ok ? '✔' : '○'}</span>
                  <span className={c.ok ? 'text-slate-700' : 'text-amber-800 font-medium'}>{c.label}</span>
                </li>
              ))}
            </ul>
            <div className="pt-2 border-t border-slate-100 text-[11px] text-slate-600">
              Approval chain: <strong>Level 1 — Scrutiny Desk</strong> → Level 2 — Joint Director → Level 3 — Director (Mumbai HQ)
            </div>
            {work.forwardedTo && <p className="text-[11px] text-emerald-800 font-semibold">Forwarded to: {work.forwardedTo}</p>}
          </div>
        );
      }
      case 'audit':
        return (
          <div className="bg-white border border-slate-200 rounded p-4" data-purpose="audit-timeline">
            <h4 className="text-xs font-bold text-[#0F2038] uppercase tracking-wide pb-2 mb-3 border-b border-slate-200">Audit Timeline &amp; History</h4>
            <ol className="relative border-l-2 border-slate-200 ml-2 space-y-3 text-xs">
              {audit.map((e) => (
                <li key={e.id} className="pl-4 relative">
                  <span className="absolute -left-[7px] top-1 w-3 h-3 rounded-full bg-[#142A4A] border-2 border-white" />
                  <p className="font-semibold text-slate-800">{e.action}</p>
                  <p className="text-[11px] text-slate-500 font-mono">{e.at} • {e.actor}</p>
                  {e.detail && <p className="text-[11px] text-slate-600 mt-0.5">{e.detail}</p>}
                </li>
              ))}
            </ol>
          </div>
        );
      case 'documents':
      default:
        return (
          <>
            {enterpriseCard}
            {documentMatrix}
            {queryPanel(false)}
          </>
        );
    }
  })();

  const decisionOptions: Array<{ value: OfficerDecision; title: string; desc: string; tone: string }> = [
    { value: 'approve', title: 'Recommend for Grant of Licence', desc: 'Dossier complete. Forward to Approving Authority (Level 2 - Joint Director).', tone: 'emerald' },
    { value: 'clarification', title: 'Hold for Field Joint Inspection', desc: 'Physical safety verification report awaited from DISH Sub-division.', tone: 'amber' },
    { value: 'reject', title: 'Recommend Rejection / Resubmission', desc: 'Failure to comply with statutory clearance under Factories Act.', tone: 'rose' },
  ];
  const toneCls = {
    emerald: 'border-emerald-300 bg-emerald-50/50',
    amber: 'border-amber-300 bg-amber-50/50',
    rose: 'border-rose-300 bg-rose-50/50',
  } as const;

  return (
    <section className="bg-white rounded-lg border-2 border-[#142A4A] shadow-md overflow-hidden" data-purpose="active-application-dossier-workspace" id="dossier-workspace">
      {/* Workspace header strip */}
      <div className="bg-[#0F2038] text-white px-5 py-3.5 flex flex-wrap justify-between items-center gap-3">
        <div className="flex items-center space-x-3">
          <div className="w-7 h-7 rounded bg-amber-500 text-[#0A1526] flex items-center justify-center font-bold text-xs">01</div>
          <div>
            <div className="flex items-center space-x-2 flex-wrap">
              <span className="text-xs text-amber-300 font-semibold uppercase tracking-wider">Active Workspace Dossier</span>
              <span className="text-slate-400">•</span>
              <span className="font-mono text-sm font-bold text-white tracking-wide">{record.applicationNo}</span>
            </div>
            <h3 className="text-base font-bold text-white leading-tight">{record.approvalName} — {record.enterpriseName}</h3>
          </div>
        </div>
        <div className="flex items-center gap-2.5 flex-wrap">
          <span className={`px-2.5 py-1 rounded text-xs font-semibold flex items-center ${statusBadge[status]}`}>
            <span className="w-1.5 h-1.5 rounded-full bg-current mr-1.5 animate-pulse" />
            Status: {DESK_STATUS_LABEL[status]}
          </span>
          <span className={`px-2.5 py-1 rounded text-xs font-semibold ${riskPill[record.slaRisk]}`}>⏱ SLA: {daysLeftLabel(record.daysLeft)}</span>
          {onOpenFullWorkspace && (
            <button type="button" onClick={onOpenFullWorkspace} className="inline-flex items-center px-3 py-1 bg-white/10 hover:bg-white/20 border border-white/30 text-white rounded text-xs font-bold transition">
              Open Full Workspace ↗
            </button>
          )}
          <button type="button" disabled={isClosed} onClick={() => { setTab('decision'); focusDecision(); }} className="inline-flex items-center px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs font-bold transition shadow-sm disabled:opacity-40">
            Forward →
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-slate-100 border-b border-slate-300 px-4 flex overflow-x-auto text-xs" data-purpose="workspace-tabs-bar" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2.5 font-bold border-b-2 transition whitespace-nowrap flex items-center space-x-1.5 ${
              tab === t.id ? 'text-[#0F2038] border-[#142A4A] bg-white' : 'text-slate-700 hover:text-[#0F2038] border-transparent'
            }`}
          >
            <span>{t.label}</span>
            {t.badge !== undefined && <span className={`${t.badgeCls} text-[11px] font-bold px-1.5 rounded-full`}>{t.badge}</span>}
          </button>
        ))}
      </div>

      <div className="p-5 grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className="lg:col-span-7 space-y-5 min-w-0">{leftContent}</div>

        {/* Decision & recommendation */}
        <div className="lg:col-span-5" ref={decisionRef}>
          <div className="bg-slate-50 border border-slate-200 rounded p-4 h-full flex flex-col justify-between" data-purpose="scrutiny-decision-box">
            <div>
              <div className="flex items-center justify-between pb-2 border-b border-slate-200 mb-3">
                <h4 className="text-xs font-bold text-[#0F2038] uppercase tracking-wide">Scrutiny Officer Recommendation</h4>
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-100 text-blue-800">Level 1 Desk</span>
              </div>

              {isClosed && <div className="mb-3 p-2 rounded bg-emerald-50 border border-emerald-200 text-[11px] text-emerald-800 font-semibold">This dossier is closed (Approved). The record is read-only.</div>}
              {work.forwardedTo && !isClosed && (
                <div className="mb-3 p-2 rounded bg-purple-50 border border-purple-200 text-[11px] text-purple-900 font-semibold">
                  Forwarded to {work.forwardedTo}. Awaiting the decision of the approving authority.
                </div>
              )}

              <fieldset disabled={isClosed} className="space-y-2 mb-4">
                <legend className="sr-only">Officer recommendation</legend>
                {decisionOptions.map((o) => (
                  <label key={o.value} className={`flex items-start p-2 rounded border cursor-pointer ${work.decision === o.value ? toneCls[o.tone as keyof typeof toneCls] : 'border-slate-200 bg-white hover:bg-slate-50'}`}>
                    <input type="radio" name="officer_decision" className="mt-0.5" checked={work.decision === o.value} onChange={() => onWorkChange({ decision: o.value })} />
                    <div className="ml-2.5">
                      <span className="block text-xs font-bold text-slate-800">{o.title}</span>
                      <span className="block text-[11px] text-slate-500">{o.desc}</span>
                    </div>
                  </label>
                ))}
              </fieldset>

              <div className="mb-3">
                <div className="flex justify-between items-center mb-1">
                  <label className="block text-xs font-bold text-slate-700" htmlFor="officer-scrutiny-remarks">
                    Officer Scrutiny Remarks &amp; Statutory Note <span className="text-red-500">*</span>
                  </label>
                  <span className="text-[10px] text-slate-400">RTS Legal Record</span>
                </div>
                <textarea
                  id="officer-scrutiny-remarks"
                  ref={remarksRef}
                  rows={5}
                  disabled={isClosed}
                  value={work.remarks}
                  onChange={(e) => onWorkChange({ remarks: e.target.value })}
                  className="block w-full text-xs rounded border border-slate-300 p-2 shadow-sm text-slate-800 leading-relaxed disabled:bg-slate-100"
                />
              </div>

              <div className="mb-4">
                <label className="block text-xs font-bold text-slate-700 mb-1" htmlFor="forward-authority">Forward To Statutory Approving Authority</label>
                <select id="forward-authority" disabled={isClosed} value={work.forwardTo} onChange={(e) => onWorkChange({ forwardTo: e.target.value })} className="block w-full text-xs rounded border border-slate-300 py-1.5 px-1 bg-white font-medium">
                  {FORWARD_AUTHORITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>

              {dossier.inspection && (
                <div className="p-2.5 bg-blue-50/70 border border-blue-200 rounded text-xs">
                  <div className="flex items-center justify-between font-bold text-blue-900 text-[11px] flex-wrap gap-1">
                    <span>✔ Field Inspection {dossier.inspection.ref}</span>
                    <span className={dossier.inspection.outcomeLabel === 'Satisfactory' ? 'text-emerald-700' : 'text-teal-700'}>
                      {dossier.inspection.outcomeLabel} • {dossier.inspection.dateLabel}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-600 mt-1 leading-normal">
                    Inspector: {dossier.inspection.inspector} • Location: {dossier.inspection.location} • Clearances: {dossier.inspection.clearances}.
                  </p>
                </div>
              )}

              {decisionError && (
                <div role="alert" className="mt-3 p-2.5 bg-rose-50 border border-rose-300 rounded text-[11px] text-rose-800 font-semibold">{decisionError}</div>
              )}
              {work.draftSavedAt && <p className="mt-2 text-[10px] text-slate-500">Draft saved {work.draftSavedAt}</p>}
            </div>

            <div className="pt-4 border-t border-slate-200 mt-4 flex items-center justify-between gap-2 flex-wrap">
              <button type="button" disabled={isClosed} onClick={saveDraft} className="px-3 py-1.5 bg-white border border-slate-300 rounded text-xs font-semibold text-slate-700 hover:bg-slate-100 shadow-sm transition disabled:opacity-40">
                Save Draft Note
              </button>
              <div className="flex items-center space-x-2">
                <button type="button" disabled={isClosed} onClick={openComposer} className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded text-xs font-bold shadow-sm transition disabled:opacity-40">
                  Raise Query
                </button>
                <button type="button" disabled={isClosed || !!work.forwardedTo} onClick={submitDecision} className="px-4 py-1.5 bg-[#142A4A] hover:bg-[#0F2038] text-white rounded text-xs font-bold shadow transition flex items-center disabled:opacity-40">
                  <span>Submit &amp; Forward</span>
                  <span className="ml-1.5">→</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Document viewer (prototype) */}
      {viewDoc && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={viewDoc.title}>
          <div className="bg-white rounded-lg shadow-2xl w-full max-w-lg text-xs">
            <div className="px-4 py-3 border-b border-slate-200 flex justify-between items-center">
              <h4 className="font-bold text-[#0F2038]">{viewDoc.title}</h4>
              <button type="button" onClick={() => setViewDocId(null)} className="text-slate-500 hover:text-slate-800 text-base" aria-label="Close">✕</button>
            </div>
            <div className="p-4 space-y-3">
              <div className="h-40 bg-slate-100 border border-dashed border-slate-300 rounded flex items-center justify-center text-slate-500">
                {viewDoc.fileType === 'cad' ? 'CAD drawing viewer (prototype placeholder)' : 'PDF preview (prototype placeholder)'}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div><span className="block text-[11px] text-slate-500">Reference</span><span className="font-semibold">{viewDoc.subtitle}</span></div>
                <div><span className="block text-[11px] text-slate-500">Submitted On</span><span className="font-mono">{viewDoc.submittedOn}</span></div>
                <div><span className="block text-[11px] text-slate-500">Verification Status</span><span className="font-semibold">{DOC_STATUS_LABEL[docStatusOf(viewDoc.id)]}</span></div>
              </div>
            </div>
            <div className="px-4 py-3 border-t border-slate-200 text-right">
              <button type="button" onClick={() => setViewDocId(null)} className="px-3 py-1.5 bg-[#142A4A] text-white rounded font-semibold">Close</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
