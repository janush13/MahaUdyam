import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { OfficerWorkspaceLayout } from '../../components/layout/OfficerWorkspaceLayout';
import { DossierWork, initDossierWork } from '../../components/officer/OfficerDossierWorkspace';
import { OfficerAuditEvent, OfficerDecision, OfficerDeskStatus, OfficerDocStatus, OfficerDossier, OfficerQueryMessage, OfficerQueueRecord } from '../../types/officer';
import {
  DEFAULT_SELECTED_APPLICATION,
  DESK_STATUS_LABEL,
  OFFICER_UPDATED_AT,
  officerQueueService,
} from '../../services/officerQueueService';
import { officerSessionStore, useOfficerSession } from '../../services/officerSessionStore';
import { WORKSPACE_FORWARD_OPTIONS, getWorkspaceProfile, validateRecommendation } from '../../services/officerWorkspaceService';

type TabId = 'overview' | 'applicant' | 'documents' | 'query' | 'inspection' | 'decision' | 'history';
type Tone = 'success' | 'error' | 'info';

const DOC_STATUS_LABEL: Record<OfficerDocStatus, string> = {
  VERIFIED: 'Verified',
  UNDER_VERIFICATION: 'Under Verification',
  REJECTED: 'Rejected',
};

const STATUS_BADGE: Record<OfficerDeskStatus, string> = {
  UNDER_SCRUTINY: 'bg-amber-50 text-amber-800 border-amber-300',
  QUERY_RAISED: 'bg-orange-50 text-orange-800 border-orange-300',
  INSPECTION_SCHEDULED: 'bg-teal-50 text-teal-800 border-teal-300',
  DECISION_PENDING: 'bg-purple-50 text-purple-800 border-purple-300',
  APPROVED: 'bg-emerald-50 text-emerald-800 border-emerald-300',
};

const SLA_BADGE: Record<OfficerQueueRecord['slaRisk'], string> = {
  BREACHED: 'text-rose-700 bg-rose-50 border-rose-200',
  NEAR_BREACH: 'text-orange-700 bg-orange-50 border-orange-200',
  APPROACHING: 'text-amber-700 bg-amber-50 border-amber-200',
  WITHIN_SLA: 'text-emerald-700 bg-emerald-50 border-emerald-200',
  COMPLIED: 'text-slate-700 bg-slate-50 border-slate-200',
};

const nowLabel = (): string => {
  const d = new Date();
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  const suffix = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `13 Dec 2024, ${String(h).padStart(2, '0')}:${m} ${suffix}`;
};

const slaText = (r: OfficerQueueRecord): string => {
  if (r.daysLeft === null) return 'SLA: Completed';
  if (r.daysLeft < 0) return `SLA: ${Math.abs(r.daysLeft)} days overdue`;
  if (r.daysLeft === 0) return 'SLA: due today';
  return `SLA: ${r.daysLeft} day${r.daysLeft === 1 ? '' : 's'} remaining`;
};

const DocIcon: React.FC<{ danger?: boolean }> = ({ danger }) => (
  <span className={`${danger ? 'text-red-500' : 'text-blue-600'} shrink-0`} aria-hidden>📄</span>
);

const inputCls = 'w-full text-xs border border-slate-300 rounded-md p-2.5 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent';

interface ViewProps {
  record: OfficerQueueRecord;
  dossier: OfficerDossier;
  work: DossierWork;
  officerName: string;
  notify: (message: string, tone?: Tone) => void;
}

const WorkspaceView: React.FC<ViewProps> = ({ record, dossier, work, officerName, notify }) => {
  const [tab, setTab] = useState<TabId>('overview');
  const [selectedDocs, setSelectedDocs] = useState<string[]>([]);
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchNote, setBatchNote] = useState('');
  const [commentOpen, setCommentOpen] = useState(false);
  const [commentDoc, setCommentDoc] = useState(dossier.documents[0]?.id ?? '');
  const [commentText, setCommentText] = useState('');
  const [viewDocId, setViewDocId] = useState<string | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [queryText, setQueryText] = useState('');
  const [showReport, setShowReport] = useState(false);
  const [decisionError, setDecisionError] = useState<string | null>(null);

  const profile = useMemo(() => getWorkspaceProfile(record, dossier), [record, dossier]);
  const patch = (p: Partial<DossierWork>) => officerSessionStore.updateWork(record.applicationNo, p);

  const status: OfficerDeskStatus = work.status ?? record.status;
  const isClosed = status === 'APPROVED';
  const documents = dossier.documents;
  const docStatusOf = (id: string): OfficerDocStatus => work.docStatus[id] ?? 'UNDER_VERIFICATION';
  const verified = documents.filter((d) => docStatusOf(d.id) === 'VERIFIED').length;
  const rejected = documents.filter((d) => docStatusOf(d.id) === 'REJECTED').length;
  const scrutinised = documents.filter((d) => docStatusOf(d.id) !== 'UNDER_VERIFICATION').length;
  const thread = useMemo(() => [...dossier.queryThread, ...work.extraQueries], [dossier.queryThread, work.extraQueries]);
  const queryCount = (dossier.queryThread.length > 0 ? 1 : 0) + work.extraQueries.length;
  const awaitingApplicant = thread.length > 0 && thread[thread.length - 1].from === 'OFFICER' && !work.queryClosed;
  const audit = useMemo(() => [...dossier.auditTrail, ...work.extraAudit], [dossier.auditTrail, work.extraAudit]);
  const inspection = dossier.inspection;
  const inspectionConducted = !!inspection && inspection.dateLabel.startsWith('Conducted');
  const inspectionDate = inspection ? `${inspection.dateLabel.replace(/^\w+ /, '')} 2024` : '';
  const viewDoc = documents.find((d) => d.id === viewDocId) ?? null;

  const addAudit = (action: string, detail?: string): OfficerAuditEvent[] => [
    ...work.extraAudit,
    { id: `X${work.extraAudit.length + 1}`, at: nowLabel(), actor: officerName, action, detail },
  ];

  // ── Documents ──
  const toggleDoc = (id: string) => setSelectedDocs((p) => (p.includes(id) ? p.filter((d) => d !== id) : [...p, id]));

  const applyBatch = (outcome: 'VERIFIED' | 'REJECTED') => {
    if (selectedDocs.length === 0) return notify('Select at least one document to verify or reject.', 'error');
    if (outcome === 'REJECTED' && !batchNote.trim()) return notify('A remark is mandatory when rejecting documents.', 'error');
    const nextStatus = { ...work.docStatus };
    const nextComments = { ...work.docComments };
    selectedDocs.forEach((id) => {
      nextStatus[id] = outcome;
      if (outcome === 'REJECTED') nextComments[id] = [...(nextComments[id] ?? []), `Rejected: ${batchNote.trim()}`];
    });
    patch({
      docStatus: nextStatus,
      docComments: nextComments,
      extraAudit: addAudit(outcome === 'VERIFIED' ? `${selectedDocs.length} document(s) verified` : `${selectedDocs.length} document(s) rejected`, outcome === 'REJECTED' ? batchNote.trim() : undefined),
    });
    notify(`${selectedDocs.length} document(s) marked ${DOC_STATUS_LABEL[outcome]}.`, 'success');
    setSelectedDocs([]);
    setBatchNote('');
    setBatchOpen(false);
  };

  const saveComment = () => {
    if (!commentDoc || !commentText.trim()) return notify('Choose a document and enter the comment.', 'error');
    patch({
      docComments: { ...work.docComments, [commentDoc]: [...(work.docComments[commentDoc] ?? []), commentText.trim()] },
      extraAudit: addAudit('Document comment added', commentText.trim()),
    });
    setCommentText('');
    setCommentOpen(false);
    notify('Comment recorded against the document.', 'success');
  };

  // ── Query ──
  const raiseQuery = (text: string, source: string) => {
    const message: OfficerQueryMessage = {
      id: `${dossier.queryRef}-N${work.extraQueries.length + 1}`,
      from: 'OFFICER',
      author: `Officer Inquiry • ${officerName}`,
      at: nowLabel(),
      text: text.trim(),
    };
    patch({
      extraQueries: [...work.extraQueries, message],
      queryClosed: false,
      status: 'QUERY_RAISED',
      extraAudit: addAudit(`Query ${dossier.queryRef} raised`, source),
    });
  };

  const sendQuery = () => {
    if (!queryText.trim()) return notify('Enter the query text for the applicant.', 'error');
    raiseQuery(queryText, queryText.trim());
    setQueryText('');
    setComposerOpen(false);
    notify('Query sent to the applicant. Status set to Query Raised.', 'success');
  };

  const closeQuery = () => {
    if (thread.length === 0) return notify('There is no query to close on this application.', 'error');
    if (work.queryClosed) return notify('The query is already closed.', 'info');
    patch({ queryClosed: true, extraAudit: addAudit(`Query ${dossier.queryRef} closed`) });
    notify('Query closed.', 'success');
  };

  // ── Decision ──
  const saveDraft = () => {
    patch({ draftSavedAt: nowLabel() });
    notify('Draft recommendation saved.', 'success');
  };

  const submitRecommendation = (e: React.FormEvent) => {
    e.preventDefault();
    setDecisionError(null);
    const error = validateRecommendation({
      decision: work.decision,
      comments: work.remarks,
      verifiedDocs: verified,
      totalDocs: documents.length,
      rejectedDocs: rejected,
      awaitingApplicant,
    });
    if (error) {
      setDecisionError(error);
      return;
    }
    if (work.decision === 'clarification') {
      raiseQuery(work.remarks, `Further clarification requested: ${work.remarks.trim()}`);
      notify('Further clarification requested from the applicant.', 'success');
      return;
    }
    const label = work.decision === 'approve' ? 'Recommended approval' : 'Recommended rejection';
    patch({
      status: 'DECISION_PENDING',
      forwardedTo: work.wsForwardTo,
      draftSavedAt: null,
      extraAudit: addAudit(`${label} — forwarded`, `To: ${work.wsForwardTo}`),
    });
    notify(`Recommendation submitted and forwarded to ${work.wsForwardTo}.`, 'success');
  };

  const tabs: Array<{ id: TabId; label: string; badge?: number; badgeCls?: string }> = [
    { id: 'overview', label: 'Overview' },
    { id: 'applicant', label: 'Applicant & Project Data' },
    { id: 'documents', label: 'Documents', badge: documents.length, badgeCls: 'bg-slate-200 text-slate-700' },
    { id: 'query', label: 'Query', badge: queryCount || undefined, badgeCls: 'bg-amber-100 text-amber-800' },
    { id: 'inspection', label: 'Inspection', badge: inspection ? 1 : undefined, badgeCls: 'bg-blue-100 text-blue-800' },
    { id: 'decision', label: 'Decision' },
    { id: 'history', label: 'History' },
  ];

  const cardHead = (title: string, right?: React.ReactNode) => (
    <div className="bg-slate-50/80 px-4 py-2.5 border-b border-slate-200 flex justify-between items-center">
      <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">{title}</h3>
      {right}
    </div>
  );
  const dl = (label: string, value: string, opts?: { mono?: boolean; span?: boolean }) => (
    <div className={opts?.span ? 'col-span-2' : undefined}>
      <dt className="text-slate-500 font-medium">{label}</dt>
      <dd className={`text-slate-900 font-semibold mt-0.5 ${opts?.mono ? 'font-mono' : ''}`}>{value}</dd>
    </div>
  );

  // ── Tab panels ──
  const overviewTab = (
    <div className="space-y-5">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
          {cardHead(
            'Applicant & Enterprise Details',
            <button type="button" onClick={() => notify(`UDYAM ${dossier.udyam} verified against the UDYAM portal (prototype).`, 'success')} className="text-[11px] text-blue-600 hover:underline">
              Verify UDYAM
            </button>
          )}
          <div className="p-4">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
              {dl('Applicant Name', profile.applicantName)}
              {dl('Designation', profile.designation)}
              {dl('Enterprise Name', dossier.enterpriseName)}
              {dl('Udyam Reg. No.', dossier.udyam, { mono: true })}
              {dl('Project Name', profile.projectName)}
              {dl('Location', profile.locationLabel)}
              {dl('Application Date', profile.applicationDate)}
              {dl('Constitution of Business', profile.constitution)}
            </dl>
          </div>
        </div>
        <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
          {cardHead('Application Summary', <span className="text-[11px] text-slate-500">Statutory Clearances</span>)}
          <div className="p-4">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
              {dl('Approval Type', profile.approvalTypeLabel)}
              {dl('Competent Department', profile.competentDepartment)}
              {dl('Proposed Investment', dossier.investment)}
              {dl('Proposed Employment', dossier.workforce)}
              {dl('Proposed Date of Commencement', profile.commencement)}
              {dl('Power Requirement', profile.powerRequirement)}
              {dl('Activity Code / NIC', profile.activityCode, { span: true })}
            </dl>
          </div>
        </div>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center shrink-0 text-sm">ⓘ</div>
          <div>
            <p className="text-xs font-bold text-blue-900">
              {isClosed
                ? 'Application Closed: Approved'
                : work.forwardedTo
                ? `Recommendation Submitted: Awaiting ${work.forwardedTo}`
                : 'Current Action Required: Document Scrutiny & Inspection Cross-verification'}
            </p>
            <p className="text-[11px] text-blue-700">
              {verified === documents.length ? 'All statutory documents are verified.' : `${documents.length - verified} document${documents.length - verified === 1 ? '' : 's'} need${documents.length - verified === 1 ? 's' : ''} correction or verification.`}{' '}
              {inspection
                ? inspectionConducted
                  ? `Inspection ${inspection.ref} report is available (${inspection.outcomeLabel}).`
                  : `Site inspection is scheduled for ${inspectionDate}.`
                : 'No inspection is linked to this application.'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button type="button" onClick={() => setTab('documents')} className="px-3 py-1.5 text-xs font-medium text-blue-700 bg-white border border-blue-300 rounded hover:bg-blue-50 transition">Review Documents</button>
          <button type="button" onClick={() => setTab('decision')} className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 rounded hover:bg-blue-700 transition">Prepare Recommendation</button>
        </div>
      </div>
    </div>
  );

  const applicantTab = (
    <div className="bg-white rounded-lg border border-slate-200 p-5 shadow-sm">
      <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-4 border-b pb-2">Factory Technical Specifications</h3>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
        <div className="p-3 bg-slate-50 rounded border border-slate-200"><p className="text-slate-500 font-medium">Installed Horsepower (HP)</p><p className="text-base font-bold text-slate-900 mt-1">{profile.installedHp}</p></div>
        <div className="p-3 bg-slate-50 rounded border border-slate-200"><p className="text-slate-500 font-medium">Max Number of Workers</p><p className="text-base font-bold text-slate-900 mt-1">{profile.maxWorkers}</p></div>
        <div className="p-3 bg-slate-50 rounded border border-slate-200"><p className="text-slate-500 font-medium">Hazardous Chemical Classification</p><p className="text-base font-bold text-amber-700 mt-1">{profile.hazardClass}</p></div>
      </div>
      <div className="mt-5">
        <h4 className="text-xs font-bold text-slate-700 mb-2">Factory Land &amp; Plot Demarcation</h4>
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs text-left border border-slate-200 rounded">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="p-2 border-b">Plot No</th>
                <th className="p-2 border-b">Industrial Area</th>
                <th className="p-2 border-b">Total Area (Sq. Mtr.)</th>
                <th className="p-2 border-b">Built-Up Area</th>
                <th className="p-2 border-b">Survey / Gut No</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {profile.plots.map((p) => (
                <tr key={p.plotNo}>
                  <td className="p-2 font-mono">{p.plotNo}</td>
                  <td className="p-2">{p.industrialArea}</td>
                  <td className="p-2">{p.totalArea}</td>
                  <td className="p-2">{p.builtUpArea}</td>
                  <td className="p-2">{p.survey}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );

  const documentsTab = (
    <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
      <div className="p-4 bg-white border-b border-slate-200 flex flex-col sm:flex-row justify-between sm:items-center gap-3">
        <div>
          <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">Mandatory Uploaded Documents</h3>
          <p className="text-xs text-slate-500">Scrutinize attachments against statutory checklists under Maharashtra Factories Rules</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" disabled={isClosed} onClick={() => setCommentOpen((o) => !o)} className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-50 transition shadow-sm disabled:opacity-40">+ Add Comment</button>
          <button type="button" disabled={isClosed} onClick={() => setBatchOpen((o) => !o)} className="px-3.5 py-1.5 text-xs font-semibold text-white bg-blue-700 rounded hover:bg-blue-800 transition shadow-sm disabled:opacity-40">Verify / Reject</button>
        </div>
      </div>

      {commentOpen && (
        <div className="p-3 bg-blue-50/60 border-b border-slate-200 flex flex-col sm:flex-row gap-2 text-xs">
          <select value={commentDoc} onChange={(e) => setCommentDoc(e.target.value)} aria-label="Document" className="rounded border border-slate-300 py-1.5 px-2 bg-white sm:w-64">
            {documents.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
          </select>
          <input value={commentText} onChange={(e) => setCommentText(e.target.value)} placeholder="Comment on the selected document" className="flex-1 rounded border border-slate-300 py-1.5 px-2 bg-white" />
          <button type="button" onClick={saveComment} className="px-3 py-1.5 bg-blue-700 text-white rounded font-semibold">Save</button>
        </div>
      )}
      {batchOpen && (
        <div className="p-3 bg-slate-50 border-b border-slate-200 text-xs space-y-2">
          <p className="text-slate-600">{selectedDocs.length} document(s) selected. Add a remark (mandatory for rejection), then choose an outcome.</p>
          <input value={batchNote} onChange={(e) => setBatchNote(e.target.value)} placeholder="Remark for the applicant / record" className="w-full rounded border border-slate-300 py-1.5 px-2 bg-white" />
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={() => setBatchOpen(false)} className="px-3 py-1 text-slate-600 font-semibold">Cancel</button>
            <button type="button" onClick={() => applyBatch('REJECTED')} className="px-3 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded font-semibold">Reject Selected</button>
            <button type="button" onClick={() => applyBatch('VERIFIED')} className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded font-semibold">Verify Selected</button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-xs text-left" id="documents-table">
          <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
            <tr>
              <th className="py-3 px-4">Document Name</th>
              <th className="py-3 px-4">Submitted On</th>
              <th className="py-3 px-4">Status</th>
              <th className="py-3 px-4 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {documents.map((doc) => {
              const ds = docStatusOf(doc.id);
              const notes = work.docComments[doc.id] ?? [];
              return (
                <tr key={doc.id} className={`hover:bg-slate-50/70 transition ${ds === 'REJECTED' ? 'bg-red-50/20' : ''}`}>
                  <td className="py-3.5 px-4">
                    <label className="flex items-center gap-2.5 cursor-pointer">
                      {!isClosed && <input type="checkbox" checked={selectedDocs.includes(doc.id)} onChange={() => toggleDoc(doc.id)} aria-label={`Select ${doc.title}`} className="rounded border-slate-300" />}
                      <DocIcon danger={ds === 'REJECTED'} />
                      <span className="font-medium text-slate-900">{doc.title}</span>
                    </label>
                    {notes.map((n, i) => <p key={i} className="text-[11px] text-slate-500 italic mt-1 pl-8">“{n}”</p>)}
                  </td>
                  <td className="py-3.5 px-4 text-slate-600 whitespace-nowrap">{doc.submittedOn}</td>
                  <td className="py-3.5 px-4">
                    <span
                      className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${
                        ds === 'VERIFIED' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : ds === 'REJECTED' ? 'bg-red-50 text-red-700 border-red-200' : 'bg-amber-50 text-amber-800 border-amber-300'
                      }`}
                    >
                      {ds === 'VERIFIED' ? '✓' : ds === 'REJECTED' ? '✕' : <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />}
                      {DOC_STATUS_LABEL[ds]}
                    </span>
                  </td>
                  <td className="py-3.5 px-4 text-right">
                    <button type="button" onClick={() => setViewDocId(doc.id)} className="px-2.5 py-1 text-xs font-semibold text-blue-700 bg-blue-50 border border-blue-200 rounded hover:bg-blue-100 transition">View</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="p-3 bg-slate-50 border-t border-slate-200 text-slate-500 text-[11px] flex flex-col sm:flex-row justify-between sm:items-center gap-1">
        <span>Accepted formats: PDF, JPG, PNG (Max 10 MB per file)</span>
        <span>{scrutinised} of {documents.length} statutory documents scrutinised</span>
      </div>
    </div>
  );

  const personName = (m: OfficerQueryMessage) => (m.author.includes('•') ? m.author.split('•').pop()!.trim() : officerName);

  const queryTab = (
    <div className="bg-white rounded-lg border border-slate-200 p-5 shadow-sm">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b pb-3 mb-4">
        <div>
          <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">Query Management</h3>
          <p className="text-xs text-slate-500">Official RTS inquiry communications and clarifications thread{thread.length > 0 && <span className="font-mono"> • Ref: {dossier.queryRef}</span>}</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" disabled={isClosed} onClick={() => setComposerOpen((o) => !o)} className="px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded hover:bg-blue-100 transition disabled:opacity-40">Raise New Query</button>
          <button type="button" disabled={isClosed || thread.length === 0 || work.queryClosed} onClick={closeQuery} className="px-3 py-1.5 text-xs font-medium text-slate-600 bg-slate-100 border border-slate-200 rounded hover:bg-slate-200 transition disabled:opacity-40">Close Query</button>
        </div>
      </div>

      {composerOpen && (
        <div className="mb-4 p-3 bg-amber-50/50 border border-amber-200 rounded space-y-2 text-xs">
          <label className="block font-semibold text-slate-700" htmlFor="ws-new-query">New query to applicant</label>
          <textarea id="ws-new-query" rows={3} value={queryText} onChange={(e) => setQueryText(e.target.value)} className={inputCls} placeholder="State the document or clarification required" />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setComposerOpen(false)} className="px-2.5 py-1 font-semibold text-slate-600">Cancel</button>
            <button type="button" onClick={sendQuery} className="px-3 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded font-semibold">Send Query</button>
          </div>
        </div>
      )}

      {thread.length === 0 && <p className="text-xs text-slate-500 italic">No query has been raised on this application.</p>}
      <div className="space-y-4">
        {thread.map((m) =>
          m.from === 'OFFICER' ? (
            <div key={m.id} className="border border-amber-200 bg-amber-50/40 rounded-lg p-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 mb-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="p-1 rounded bg-amber-100 text-amber-800 text-[10px] font-bold uppercase">Query Raised by Officer</span>
                  <span className="text-xs font-semibold text-slate-800">{personName(m)} (Approving Officer)</span>
                </div>
                <span className="text-[11px] text-slate-500 font-mono">{m.at}</span>
              </div>
              <p className="text-xs text-slate-700 leading-relaxed bg-white p-3 rounded border border-amber-100">{m.text}</p>
            </div>
          ) : (
            <div key={m.id} className="border border-emerald-200 bg-emerald-50/40 rounded-lg p-4 ml-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 mb-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="p-1 rounded bg-emerald-100 text-emerald-800 text-[10px] font-bold uppercase">Response from Applicant</span>
                  <span className="text-xs font-semibold text-slate-800">{personName(m)}</span>
                </div>
                <span className="text-[11px] text-slate-500 font-mono">{m.at}</span>
              </div>
              <p className="text-xs text-slate-700 leading-relaxed bg-white p-3 rounded border border-emerald-100">{m.text}</p>
              {m.attachment && (
                <button type="button" onClick={() => notify(`Preview of ${m.attachment} is not available in the prototype.`)} className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 bg-white border border-slate-300 rounded text-xs text-slate-800 hover:border-blue-400">
                  <span className="text-red-600">📄</span>
                  <span className="font-medium">{m.attachment}</span>
                </button>
              )}
            </div>
          )
        )}
      </div>
      {work.queryClosed && <p className="mt-4 text-[11px] font-semibold text-slate-600 bg-slate-100 border border-slate-200 rounded px-3 py-2">This query has been closed by the officer.</p>}
      {awaitingApplicant && <p className="mt-4 text-[11px] font-semibold text-amber-800">⏸ Awaiting applicant response.</p>}
    </div>
  );

  const inspectionTab = (
    <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
        <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">Inspection Details</h3>
        <span className="text-xs text-blue-700 font-medium">Field Survey Schedule</span>
      </div>
      {inspection ? (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left" id="inspection-table">
              <thead className="bg-white text-slate-600 font-semibold border-b border-slate-200">
                <tr>
                  <th className="py-3 px-4">Inspection No.</th>
                  <th className="py-3 px-4">Scheduled Date</th>
                  <th className="py-3 px-4">Location</th>
                  <th className="py-3 px-4">Inspecting Officer</th>
                  <th className="py-3 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                <tr>
                  <td className="py-3 px-4 font-mono font-medium text-slate-800">{inspection.ref}</td>
                  <td className="py-3 px-4 text-slate-700">{inspectionDate}</td>
                  <td className="py-3 px-4 text-slate-700">{inspection.location}</td>
                  <td className="py-3 px-4 font-medium text-slate-900">{inspection.inspector}</td>
                  <td className="py-3 px-4 text-right">
                    <button
                      type="button"
                      onClick={() => (inspectionConducted ? setShowReport((s) => !s) : notify(`Report will be available after inspection on ${inspectionDate}.`))}
                      className="px-2.5 py-1 text-xs font-semibold text-blue-700 hover:text-blue-900 bg-blue-50 border border-blue-200 rounded"
                    >
                      View Report
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          {inspectionConducted && showReport ? (
            <div className="p-5 border-t border-slate-200 text-xs space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-1">
                <h4 className="font-bold text-slate-800">Latest Inspection Report — {inspection.ref}</h4>
                <span className="font-semibold text-emerald-700">{inspection.outcomeLabel} • Clearances: {inspection.clearances}</span>
              </div>
              <ul className="divide-y divide-slate-100 border border-slate-200 rounded">
                {inspection.checklist.map((c) => (
                  <li key={c.item} className="flex justify-between px-3 py-2">
                    <span className="text-slate-700">{c.item}</span>
                    <span className={`font-semibold ${c.result === 'Compliant' ? 'text-emerald-700' : 'text-amber-700'}`}>{c.result}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="p-8 text-center bg-slate-50/50 border-t border-slate-200">
              <div className="w-12 h-12 rounded-full bg-slate-200/80 mx-auto flex items-center justify-center text-slate-400 mb-2 text-xl">📄</div>
              <h4 className="text-xs font-bold text-slate-700">Latest Inspection Report</h4>
              <p className="text-xs text-slate-500 mt-1">
                {inspectionConducted ? `Inspection completed on ${inspectionDate} (${inspection.outcomeLabel}). Use View Report to open the findings.` : `Report will be available after inspection on ${inspectionDate}.`}
              </p>
            </div>
          )}
        </>
      ) : (
        <div className="p-8 text-center text-xs text-slate-500">No inspection is linked to this application.</div>
      )}
    </div>
  );

  const decisionOptions: Array<{ value: OfficerDecision; label: string }> = [
    { value: 'approve', label: 'Recommend Approval' },
    { value: 'reject', label: 'Recommend Rejection' },
    { value: 'clarification', label: 'Request Further Clarification' },
  ];

  const decisionTab = (
    <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-5 max-w-3xl">
      <div className="border-b border-slate-200 pb-3 mb-4">
        <h3 className="text-sm font-bold text-slate-900 tracking-tight">Statutory Scrutiny Recommendation</h3>
        <p className="text-xs text-slate-500 mt-0.5">Level 1 Scrutiny Officer Recommendation to Statutory Approving Authority</p>
      </div>
      {isClosed && <div className="mb-4 p-2.5 rounded bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 font-semibold">This application is closed (Approved). The record is read-only.</div>}
      {work.forwardedTo && !isClosed && <div className="mb-4 p-2.5 rounded bg-purple-50 border border-purple-200 text-xs text-purple-900 font-semibold">Recommendation forwarded to {work.forwardedTo}. Awaiting the decision of the approving authority.</div>}
      <form className="space-y-5" onSubmit={submitRecommendation}>
        <fieldset disabled={isClosed || !!work.forwardedTo}>
          <legend className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">Recommendation</legend>
          <div className="space-y-2 text-xs">
            {decisionOptions.map((o) => (
              <label key={o.value} className={`flex items-center gap-3 p-2.5 rounded border cursor-pointer ${work.decision === o.value ? 'border-blue-300 bg-blue-50/40' : 'border-slate-200 hover:bg-slate-50'}`}>
                <input type="radio" name="recommendation" className="h-4 w-4" checked={work.decision === o.value} onChange={() => patch({ decision: o.value })} />
                <span className="font-medium text-slate-800">{o.label}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <div>
          <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1" htmlFor="ws-comments">Comments <span className="text-red-500">*</span></label>
          <textarea id="ws-comments" rows={4} disabled={isClosed || !!work.forwardedTo} value={work.remarks} onChange={(e) => patch({ remarks: e.target.value })} className={`${inputCls} disabled:bg-slate-100`} placeholder="Enter scrutiny notes and justification..." />
        </div>
        <div>
          <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1" htmlFor="ws-forward">Forward To <span className="text-red-500">*</span></label>
          <select id="ws-forward" disabled={isClosed || !!work.forwardedTo} value={work.wsForwardTo} onChange={(e) => patch({ wsForwardTo: e.target.value })} className={`${inputCls} bg-white`}>
            {WORKSPACE_FORWARD_OPTIONS.map((o) => <option key={o}>{o}</option>)}
          </select>
          <span className="text-[11px] text-slate-400 mt-1 block">Officer cannot make direct grant; case is escalated to Level 2 for final digital signature.</span>
        </div>
        {decisionError && <div role="alert" className="p-2.5 bg-rose-50 border border-rose-300 rounded text-xs text-rose-800 font-semibold">{decisionError}</div>}
        {work.draftSavedAt && <p className="text-[11px] text-slate-500">Draft saved {work.draftSavedAt}</p>}
        <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-3">
          <button type="button" disabled={isClosed || !!work.forwardedTo} onClick={saveDraft} className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-50 transition disabled:opacity-40">Save as Draft</button>
          <button type="submit" disabled={isClosed || !!work.forwardedTo} className="px-4 py-2 text-xs font-bold text-white bg-blue-700 rounded hover:bg-blue-800 shadow-sm transition disabled:opacity-40">Submit Recommendation</button>
        </div>
      </form>
    </div>
  );

  const dotColor = (a: OfficerAuditEvent): string => {
    if (/submitted|answered|response/i.test(a.action)) return 'bg-emerald-600';
    if (/raised|rejected|held/i.test(a.action)) return 'bg-amber-500';
    return 'bg-blue-600';
  };

  const historyTab = (
    <div className="bg-white rounded-lg border border-slate-200 p-5 shadow-sm max-w-2xl">
      <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-4 border-b pb-2">Application Timeline &amp; Audit Trail</h3>
      <div className="relative pl-6 space-y-6 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-200">
        {audit.map((a) => (
          <div key={a.id} className="relative flex items-start gap-3">
            <div className={`absolute -left-6 mt-1 w-3.5 h-3.5 rounded-full ring-4 ring-white ${dotColor(a)}`} />
            <div>
              <p className="text-xs font-bold text-slate-800">{a.action}</p>
              <p className="text-[11px] text-slate-500 font-mono">{a.at} • {a.actor}</p>
              {a.detail && <p className="text-[11px] text-slate-600 mt-0.5">{a.detail}</p>}
            </div>
          </div>
        ))}
        <div className="relative flex items-start gap-3">
          <div className="absolute -left-6 mt-1 w-3.5 h-3.5 rounded-full bg-amber-500 ring-4 ring-white animate-pulse" />
          <div>
            <p className="text-xs font-bold text-amber-800">{DESK_STATUS_LABEL[status]}</p>
            <p className="text-[11px] text-slate-500 font-mono">13 Dec 2024, {OFFICER_UPDATED_AT}</p>
          </div>
        </div>
      </div>
    </div>
  );

  const panels: Record<TabId, React.ReactNode> = {
    overview: overviewTab,
    applicant: applicantTab,
    documents: documentsTab,
    query: queryTab,
    inspection: inspectionTab,
    decision: decisionTab,
    history: historyTab,
  };

  return (
    <>
      {/* Application header summary */}
      <section className="bg-white border-b border-slate-200 px-6 pt-4 shadow-sm" data-purpose="application-header-summary">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center flex-wrap gap-2.5">
              <span className="text-xs font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-mono">ID: {record.applicationNo}</span>
              <span className="text-slate-300">|</span>
              <h2 className="text-base font-bold text-slate-900 tracking-tight">{record.approvalName}</h2>
              <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold border ${STATUS_BADGE[status]}`}>
                <span className="h-1.5 w-1.5 rounded-full bg-current animate-pulse" />
                {DESK_STATUS_LABEL[status]}
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-1">{dossier.enterpriseName} • {profile.projectName}, {record.location}</p>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <div className={`flex items-center gap-1.5 text-xs font-bold border px-2.5 py-1 rounded ${SLA_BADGE[record.slaRisk]}`}>
                <span>⏱</span>
                <span>{slaText(record)}</span>
              </div>
              <span className="text-[10px] text-slate-400 block mt-0.5">Statutory RTS Deadline: {profile.statutoryDeadline}</span>
            </div>
            <button type="button" disabled={isClosed} onClick={() => setTab('decision')} className="inline-flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium px-4 py-2 rounded shadow-sm transition focus:ring-2 focus:ring-blue-500 disabled:opacity-40">
              <span>Forward</span>
              <span>→</span>
            </button>
          </div>
        </div>
        <div className="mt-4 border-b border-slate-200 flex gap-1 overflow-x-auto text-xs font-medium text-slate-600" data-purpose="tab-navigation-bar" role="tablist">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`tab-btn-${t.id}`}
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`px-3.5 py-2.5 border-b-2 focus:outline-none transition whitespace-nowrap flex items-center gap-1.5 ${
                tab === t.id ? 'border-blue-600 text-blue-700 font-semibold' : 'border-transparent hover:text-slate-900 hover:border-slate-300'
              }`}
            >
              <span>{t.label}</span>
              {t.badge !== undefined && <span className={`${t.badgeCls} text-[10px] font-bold px-1.5 rounded-full`}>{t.badge}</span>}
            </button>
          ))}
        </div>
      </section>

      <div className="p-6 space-y-6" role="tabpanel" aria-labelledby={`tab-btn-${tab}`}>
        {panels[tab]}
      </div>

      {viewDoc && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={viewDoc.title}>
          <div className="bg-white rounded-lg shadow-2xl w-full max-w-lg text-xs">
            <div className="px-4 py-3 border-b border-slate-200 flex justify-between items-center">
              <h4 className="font-bold text-slate-900">{viewDoc.title}</h4>
              <button type="button" onClick={() => setViewDocId(null)} className="text-slate-500 hover:text-slate-800 text-base" aria-label="Close">✕</button>
            </div>
            <div className="p-4 space-y-3">
              <div className="h-40 bg-slate-100 border border-dashed border-slate-300 rounded flex items-center justify-center text-slate-500">
                {viewDoc.fileType === 'cad' ? 'CAD drawing viewer (prototype placeholder)' : 'Document preview (prototype placeholder)'}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div><span className="block text-[11px] text-slate-500">Reference</span><span className="font-semibold">{viewDoc.subtitle}</span></div>
                <div><span className="block text-[11px] text-slate-500">Submitted On</span><span className="font-mono">{viewDoc.submittedOn}</span></div>
                <div><span className="block text-[11px] text-slate-500">Status</span><span className="font-semibold">{DOC_STATUS_LABEL[docStatusOf(viewDoc.id)]}</span></div>
              </div>
            </div>
            <div className="px-4 py-3 border-t border-slate-200 text-right">
              <button type="button" onClick={() => setViewDocId(null)} className="px-3 py-1.5 bg-blue-700 text-white rounded font-semibold">Close</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export const OfficerWorkspacePage: React.FC = () => {
  const { user } = useAuth();
  const officerName = user?.name || 'Officer';
  const { selectedNo, workMap } = useOfficerSession();
  const [toast, setToast] = useState<{ message: string; tone: Tone } | null>(null);
  const timer = useRef<number | null>(null);

  const notify = (message: string, tone: Tone = 'info') => {
    setToast({ message, tone });
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToast(null), 3500);
  };
  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current);
  }, []);

  // Direct navigation (or a stale selection) always lands on a valid dossier
  const baseRecord = officerQueueService.getRecord(selectedNo) ?? officerQueueService.getRecord(DEFAULT_SELECTED_APPLICATION)!;
  const dossier = officerQueueService.getDossier(baseRecord.applicationNo)!;
  const work = workMap[baseRecord.applicationNo] ?? initDossierWork(dossier);
  const record: OfficerQueueRecord = work.status ? { ...baseRecord, status: work.status } : baseRecord;

  const summary = useMemo(() => officerQueueService.getSlaSummary(), []);
  const profile = getWorkspaceProfile(baseRecord, dossier);

  const notifications = [
    `${summary.breached} dossiers breached SLA — deemed-approval alert sent to the Appellate Authority.`,
    `${summary.nearBreach} dossiers are due within 48 hours and need priority scrutiny.`,
    'MUO/2024/00145 — Sahyadri Bio-Tech Solutions has a query awaiting applicant response.',
    'MUO/2024/000123 — Deshmukh Industries responded to query QRY-001.',
    `${summary.inspections} joint inspections are scheduled with the DISH sub-division.`,
  ];

  const handleSearch = (term: string): boolean => {
    const t = term.trim().toLowerCase();
    const hit = officerQueueService.getQueue().find((r) => {
      const d = officerQueueService.getDossier(r.applicationNo);
      return [r.applicationNo, r.enterpriseName, d?.udyam, d?.projectSite].filter(Boolean).join(' ').toLowerCase().includes(t);
    });
    if (!hit) return false;
    officerSessionStore.setSelected(hit.applicationNo);
    notify(`Opened ${hit.applicationNo} — ${hit.enterpriseName}.`, 'success');
    return true;
  };

  return (
    <OfficerWorkspaceLayout queueCount={summary.totalActive} serviceId={profile.serviceId} notifications={notifications} onSearch={handleSearch} onNotice={(m) => notify(m)}>
      {toast && (
        <div
          role="status"
          className={`fixed top-4 right-4 z-[60] max-w-sm px-4 py-2.5 rounded-lg shadow-lg text-xs font-semibold border ${
            toast.tone === 'success' ? 'bg-emerald-50 text-emerald-900 border-emerald-300' : toast.tone === 'error' ? 'bg-rose-50 text-rose-900 border-rose-300' : 'bg-white text-slate-800 border-slate-300'
          }`}
        >
          {toast.message}
        </div>
      )}
      <WorkspaceView key={record.applicationNo} record={record} dossier={dossier} work={work} officerName={officerName} notify={notify} />
    </OfficerWorkspaceLayout>
  );
};

