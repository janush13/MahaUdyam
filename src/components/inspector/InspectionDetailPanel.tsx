import React, { useState } from 'react';
import { ChecklistResult, InspectionFinding, InspectionRecord, InspectionReport } from '../../types/inspector';
import { CHECKLIST_LABEL } from '../../services/inspectorService';
import { formatDisplayDate } from '../../services/officerQueueService';
import { officerSessionStore } from '../../services/officerSessionStore';
import { officerQueueService } from '../../services/officerQueueService';

type DetailTab = 'overview' | 'checklist' | 'findings' | 'documents';

interface Props {
  rec: InspectionRecord;
  report: InspectionReport;
  onReportChange: (patch: Partial<InspectionReport>) => void;
  onReschedule: () => void;
  onMarkCompleted: () => void;
  onNotify: (message: string, tone?: 'success' | 'error' | 'info') => void;
}

export const STATUS_BADGE: Record<InspectionRecord['status'], { label: string; cls: string }> = {
  SCHEDULED: { label: 'Scheduled', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  COMPLETED: { label: 'Completed', cls: 'bg-slate-100 text-slate-700 border-slate-300' },
  RESCHEDULED: { label: 'Rescheduled', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
};

const RESULT_STYLE: Record<ChecklistResult, string> = {
  PENDING: '',
  COMPLIANT: 'bg-emerald-600 text-white border-emerald-600',
  NON_COMPLIANT: 'bg-red-600 text-white border-red-600',
  NOT_APPLICABLE: 'bg-slate-600 text-white border-slate-600',
};

export const InspectionDetailPanel: React.FC<Props> = ({ rec, report, onReportChange, onReschedule, onMarkCompleted, onNotify }) => {
  const [tab, setTab] = useState<DetailTab>('overview');
  const [fDesc, setFDesc] = useState('');
  const [fSeverity, setFSeverity] = useState<InspectionFinding['severity']>('Minor');
  const [fAction, setFAction] = useState('');
  const [fLimit, setFLimit] = useState('15 days');

  const locked = report.status === 'SUBMITTED';
  const badge = STATUS_BADGE[rec.status];
  const recorded = rec.checklist.filter((c) => report.checklist[c.id]?.result !== 'PENDING').length;
  const nonCompliant = rec.checklist.filter((c) => report.checklist[c.id]?.result === 'NON_COMPLIANT').length;

  const setEntry = (id: string, patch: Partial<InspectionReport['checklist'][string]>) =>
    onReportChange({ checklist: { ...report.checklist, [id]: { ...report.checklist[id], ...patch } } });

  const addFinding = () => {
    if (!fDesc.trim() || !fAction.trim()) {
      onNotify('Enter both the finding and the corrective action.', 'error');
      return;
    }
    const next: InspectionFinding = {
      id: `F${report.findings.length + 1}-${report.findings.reduce((n, f) => Math.max(n, parseInt(f.id.replace(/\D/g, ''), 10) || 0), 0) + 1}`,
      description: fDesc.trim(),
      severity: fSeverity,
      correctiveAction: fAction.trim(),
      timeLimit: fLimit,
    };
    onReportChange({ findings: [...report.findings, next] });
    setFDesc('');
    setFAction('');
    onNotify('Finding added to the report.', 'success');
  };

  const linkedDossier = rec.linkedToOfficerQueue ? officerQueueService.getDossier(rec.applicationNo) : undefined;
  const officerWork = rec.linkedToOfficerQueue ? officerSessionStore.getWork(rec.applicationNo) : undefined;
  const docLabel = { VERIFIED: 'Verified', UNDER_VERIFICATION: 'Under Verification', REJECTED: 'Rejected' } as const;

  const field = (label: string, value: React.ReactNode, span = false) => (
    <div className={span ? 'sm:col-span-2' : undefined}>
      <span className="block text-slate-500 text-[11px]">{label}</span>
      {value}
    </div>
  );

  const tabs: Array<{ id: DetailTab; label: string }> = [
    { id: 'overview', label: 'Overview' },
    { id: 'checklist', label: 'Checklist' },
    { id: 'findings', label: 'Findings' },
    { id: 'documents', label: 'Documents' },
  ];

  return (
    <section className="lg:col-span-6 bg-white border border-slate-300 rounded shadow-sm flex flex-col justify-between" data-purpose="panel-inspection-detail" id="inspection-detail">
      <div>
        <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50 gap-2">
          <div>
            <div className="text-[11px] text-slate-500 font-medium tracking-wide">STATUTORY FIELD DOSSIER</div>
            <h3 className="text-base font-bold text-[#0B2265] flex items-center flex-wrap gap-x-2">
              <span>Inspection Details</span>
              <span className="text-slate-400 font-normal">|</span>
              <span className="text-sm font-semibold text-slate-700">{rec.id}</span>
            </h3>
          </div>
          <span className={`font-semibold text-xs px-2.5 py-0.5 rounded-full border ${badge.cls}`}>{badge.label}</span>
        </div>

        <div className="flex border-b border-slate-200 bg-white px-4 text-xs font-medium overflow-x-auto" role="tablist">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`py-2.5 px-3 whitespace-nowrap ${tab === t.id ? 'border-b-2 border-[#0B2265] text-[#0B2265] font-bold' : 'text-slate-600 hover:text-[#0B2265]'}`}
            >
              {t.label}
              {t.id === 'checklist' && <span className="ml-1.5 text-[10px] font-bold bg-slate-200 text-slate-700 rounded-full px-1.5">{recorded}/{rec.checklist.length}</span>}
              {t.id === 'findings' && report.findings.length > 0 && <span className="ml-1.5 text-[10px] font-bold bg-amber-100 text-amber-800 rounded-full px-1.5">{report.findings.length}</span>}
            </button>
          ))}
        </div>

        <div className="p-4 space-y-4">
          {tab === 'overview' && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-3.5 gap-x-4 text-xs">
                {field('Inspection No.', <span className="font-bold text-slate-800">{rec.id}</span>)}
                {field('Application No.', <span className="font-bold text-slate-800">{rec.applicationNo}</span>)}
                {field('Approval Type', <span className="font-semibold text-slate-800">{rec.approvalFull}</span>)}
                {field('Enterprise', <span className="font-bold text-[#0B2265]">{rec.enterprise}</span>)}
                {field('Project Name', <span className="font-semibold text-slate-800">{rec.project}</span>)}
                {field(
                  'Scheduled Date & Time',
                  <span className="font-semibold bg-amber-50 text-amber-800 px-1.5 py-0.5 rounded border border-amber-200 inline-block">
                    {formatDisplayDate(rec.scheduledOn)}, {rec.scheduledTime} IST
                  </span>
                )}
                {field(
                  'Location',
                  <div className="flex items-start justify-between gap-3">
                    <span className="font-medium text-slate-800">{rec.address}</span>
                    <button
                      type="button"
                      onClick={() => onNotify('Map view is not available in the prototype.')}
                      className="text-[#0B2265] text-[11px] font-bold hover:underline flex items-center gap-1 shrink-0 bg-blue-50 px-2 py-1 rounded border border-blue-200"
                    >
                      <span>📍</span>
                      <span>View on Map</span>
                    </button>
                  </div>,
                  true
                )}
              </div>
              <div className="bg-blue-50/70 border border-blue-200 rounded p-3 text-xs">
                <div className="font-bold text-[#0B2265] mb-2 text-[11px] tracking-wide uppercase">⊕ Mandatory Statutory Instructions</div>
                <ul className="space-y-1.5 text-slate-700 text-[11px] list-disc list-inside">
                  <li>Carry official Government ID card &amp; statutory inspection warrant.</li>
                  <li>Verify safety compliance strictly as per NBC 2016 &amp; Maharashtra Factory Rules.</li>
                  <li>Capture geotagged photographs with clear timestamp overlay.</li>
                  <li>Discuss findings with authorized representative (<span className="font-semibold text-slate-900">{rec.representative}</span>).</li>
                </ul>
              </div>
            </>
          )}

          {tab === 'checklist' && (
            <div className="space-y-3 text-xs">
              <div className="flex items-center justify-between text-[11px] text-slate-600">
                <span>{recorded} of {rec.checklist.length} items recorded</span>
                <span className={nonCompliant > 0 ? 'text-red-700 font-semibold' : ''}>{nonCompliant} non-compliant</span>
              </div>
              {rec.checklist.map((item) => {
                const entry = report.checklist[item.id] ?? { result: 'PENDING' as ChecklistResult, remark: '' };
                return (
                  <div key={item.id} className={`border rounded p-3 ${entry.result === 'NON_COMPLIANT' ? 'border-red-200 bg-red-50/40' : 'border-slate-200'}`}>
                    <p className="font-semibold text-slate-800">{item.label}</p>
                    <p className="text-[11px] text-slate-500 mb-2">{item.requirement}</p>
                    <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={item.label}>
                      {(['COMPLIANT', 'NON_COMPLIANT', 'NOT_APPLICABLE'] as ChecklistResult[]).map((r) => (
                        <button
                          key={r}
                          type="button"
                          role="radio"
                          aria-checked={entry.result === r}
                          disabled={locked}
                          onClick={() => setEntry(item.id, { result: r })}
                          className={`px-2.5 py-1 rounded border text-[11px] font-semibold transition disabled:opacity-60 ${entry.result === r ? RESULT_STYLE[r] : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'}`}
                        >
                          {CHECKLIST_LABEL[r]}
                        </button>
                      ))}
                      {entry.result === 'PENDING' && <span className="text-[11px] text-amber-700 font-semibold self-center ml-1">Pending</span>}
                    </div>
                    <input
                      value={entry.remark}
                      disabled={locked}
                      onChange={(e) => setEntry(item.id, { remark: e.target.value })}
                      placeholder="Remark / measurement (optional)"
                      aria-label={`Remark for ${item.label}`}
                      className="mt-2 w-full text-[11px] border border-slate-300 rounded px-2 py-1.5 bg-slate-50/60 disabled:opacity-60"
                    />
                  </div>
                );
              })}
            </div>
          )}

          {tab === 'findings' && (
            <div className="space-y-3 text-xs">
              {report.findings.length === 0 && <p className="text-slate-500 italic">No findings recorded. Add one for every non-compliance observed on site.</p>}
              {report.findings.map((f, i) => (
                <div key={f.id} className="border border-slate-200 rounded p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-slate-800">Finding {i + 1}</span>
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${f.severity === 'Critical' ? 'bg-red-50 text-red-700 border-red-200' : f.severity === 'Major' ? 'bg-amber-50 text-amber-800 border-amber-200' : 'bg-slate-100 text-slate-700 border-slate-200'}`}>{f.severity}</span>
                      {!locked && (
                        <button type="button" onClick={() => onReportChange({ findings: report.findings.filter((x) => x.id !== f.id) })} className="text-slate-400 hover:text-red-600" aria-label={`Remove finding ${i + 1}`}>×</button>
                      )}
                    </div>
                  </div>
                  <p className="text-slate-700 mt-1">{f.description}</p>
                  <p className="text-[11px] text-slate-500 mt-1"><strong>Corrective action:</strong> {f.correctiveAction} <span className="font-mono">({f.timeLimit})</span></p>
                </div>
              ))}
              {!locked && (
                <div className="border border-dashed border-slate-300 rounded p-3 space-y-2 bg-slate-50/60">
                  <p className="font-bold text-slate-800 text-[11px] uppercase tracking-wide">Add Finding</p>
                  <textarea value={fDesc} onChange={(e) => setFDesc(e.target.value)} rows={2} placeholder="Describe the non-compliance observed" aria-label="Finding description" className="w-full border border-slate-300 rounded p-2 text-xs bg-white" />
                  <input value={fAction} onChange={(e) => setFAction(e.target.value)} placeholder="Corrective action required" aria-label="Corrective action" className="w-full border border-slate-300 rounded p-2 text-xs bg-white" />
                  <div className="flex flex-wrap gap-2 items-center">
                    <select value={fSeverity} onChange={(e) => setFSeverity(e.target.value as InspectionFinding['severity'])} aria-label="Severity" className="border border-slate-300 rounded px-2 py-1.5 bg-white">
                      <option>Minor</option>
                      <option>Major</option>
                      <option>Critical</option>
                    </select>
                    <select value={fLimit} onChange={(e) => setFLimit(e.target.value)} aria-label="Time limit" className="border border-slate-300 rounded px-2 py-1.5 bg-white">
                      <option>7 days</option>
                      <option>15 days</option>
                      <option>30 days</option>
                    </select>
                    <button type="button" onClick={addFinding} className="ml-auto px-3 py-1.5 bg-[#0B2265] hover:bg-[#153B8A] text-white rounded font-semibold">Add Finding</button>
                  </div>
                </div>
              )}
            </div>
          )}

          {tab === 'documents' && (
            <div className="space-y-4 text-xs">
              <div>
                <p className="font-bold text-slate-800 text-[11px] uppercase tracking-wide mb-1.5">Application Documents (read-only)</p>
                {linkedDossier ? (
                  <table className="w-full text-left border border-slate-200 rounded">
                    <thead className="bg-slate-50 text-[11px] text-slate-600">
                      <tr>
                        <th className="py-1.5 px-2">Document</th>
                        <th className="py-1.5 px-2">Scrutiny Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {linkedDossier.documents.map((d) => (
                        <tr key={d.id}>
                          <td className="py-1.5 px-2">{d.title}</td>
                          <td className="py-1.5 px-2 font-semibold">{docLabel[officerWork?.docStatus[d.id] ?? d.status]}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="text-slate-500 italic">The application documents for {rec.applicationNo} are held by another scrutiny desk.</p>
                )}
              </div>
              <div>
                <p className="font-bold text-slate-800 text-[11px] uppercase tracking-wide mb-1.5">Inspection Evidence</p>
                {report.evidence.length === 0 && !report.supportingDoc && <p className="text-slate-500 italic">No evidence uploaded yet — add photographs in the Submit Inspection Report panel.</p>}
                <ul className="space-y-1">
                  {report.evidence.map((e) => (
                    <li key={e.name} className="flex items-center"><span className="w-2 h-2 rounded-full bg-emerald-500 mr-2" />{e.name} <span className="text-slate-400 ml-1">({e.sizeLabel})</span></li>
                  ))}
                  {report.supportingDoc && <li className="flex items-center"><span className="w-2 h-2 rounded-full bg-blue-500 mr-2" />{report.supportingDoc.name} <span className="text-slate-400 ml-1">({report.supportingDoc.sizeLabel}) — supporting document</span></li>}
                </ul>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between gap-2 flex-wrap">
        <button type="button" disabled={rec.status === 'COMPLETED'} onClick={onReschedule} className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded hover:bg-slate-100 transition shadow-sm disabled:opacity-40">
          Reschedule Inspection
        </button>
        <button type="button" disabled={rec.status === 'COMPLETED'} onClick={onMarkCompleted} className="px-4 py-1.5 text-xs font-bold text-white bg-[#0B2265] hover:bg-[#153B8A] rounded transition shadow-sm flex items-center gap-1.5 disabled:opacity-40">
          <span>Mark Inspection as Completed</span>
          <span>→</span>
        </button>
      </div>
    </section>
  );
};
