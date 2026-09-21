import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from '../../router/Router';
import { useAuth } from '../../context/AuthContext';
import { InspectorLayout, InspectorNavId } from '../../components/layout/InspectorLayout';
import { InspectionDetailPanel, STATUS_BADGE } from '../../components/inspector/InspectionDetailPanel';
import { InspectionReportPanel } from '../../components/inspector/InspectionReportPanel';
import { InspectionReport, ReportStatus, ScheduleFilter } from '../../types/inspector';
import {
  DEFAULT_INSPECTION_ID,
  INSPECTOR_PAGE_SIZE,
  INSPECTOR_TODAY_ISO,
  OUTCOME_LABEL,
  RESCHEDULE_TIME_OPTIONS,
  hasReportContent,
  inspectorService,
  validateReport,
} from '../../services/inspectorService';
import { inspectorSessionStore, useInspectorSession } from '../../services/inspectorSessionStore';
import { formatDisplayDate } from '../../services/officerQueueService';

type Tone = 'success' | 'error' | 'info';
type Step = 1 | 2 | 3;

const REPORT_STEP_LABEL: Record<ReportStatus, string> = {
  NOT_STARTED: 'Not Started',
  IN_PROGRESS: 'In Progress',
  DRAFT_SAVED: 'Draft Saved',
  SUBMITTED: 'Submitted',
};

export const InspectorWorkspacePage: React.FC = () => {
  const { user } = useAuth();
  const { currentPath, navigate } = useRouter();
  const session = useInspectorSession();
  const inspectorName = user?.name || 'Inspector';

  // ── Route → view / selection ──
  const path = useMemo(() => {
    const p = currentPath.split('?')[0];
    return p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p;
  }, [currentPath]);
  const view: 'workspace' | 'reports' = path === '/inspector/reports' ? 'reports' : 'workspace';
  const routeSegment = path.startsWith('/inspector/inspections/') ? path.slice('/inspector/inspections/'.length) : null;
  const routeId = routeSegment ? inspectorService.resolveRouteId(routeSegment) : null;
  const unknownRoute = !!routeSegment && !routeId;

  useEffect(() => {
    if (routeId) inspectorSessionStore.setSelected(routeId);
  }, [routeId]);

  const selectedId = routeId ?? session.selectedId;
  const baseRec = inspectorService.getInspection(selectedId) ?? inspectorService.getInspection(DEFAULT_INSPECTION_ID)!;

  // ── Toasts ──
  const [toast, setToast] = useState<{ message: string; tone: Tone } | null>(null);
  const toastTimer = useRef<number | null>(null);
  const notify = (message: string, tone: Tone = 'info') => {
    setToast({ message, tone });
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3500);
  };
  useEffect(() => () => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
  }, []);
  useEffect(() => {
    if (unknownRoute) notify(`No inspection matches “${routeSegment}” — showing your default inspection.`, 'error');
  }, [unknownRoute, routeSegment]);

  // ── State derived from the session store ──
  const all = useMemo(() => inspectorService.getInspections().map((r) => inspectorSessionStore.resolve(r)), [session.overrides]);
  const counts = inspectorService.counts(all);
  const rec = inspectorSessionStore.resolve(baseRec);
  const report = session.reports[rec.id] ?? inspectorService.buildInitialReport(rec);
  const audit = [...inspectorService.buildBaseAudit(rec), ...(session.audit[rec.id] ?? [])];

  // ── Page state ──
  const [filter, setFilter] = useState<ScheduleFilter>('upcoming');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [step, setStep] = useState<Step>(2);
  const [showErrors, setShowErrors] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [rsDate, setRsDate] = useState('');
  const [rsTime, setRsTime] = useState(RESCHEDULE_TIME_OPTIONS[1]);
  const [rsReason, setRsReason] = useState('');
  const [rsError, setRsError] = useState<string | null>(null);

  useEffect(() => {
    setShowErrors(false);
  }, [selectedId]);

  const scheduleRef = useRef<HTMLElement>(null);
  const grid = useRef<HTMLDivElement>(null);

  const rows = useMemo(() => {
    const status = filter === 'upcoming' ? 'SCHEDULED' : filter === 'completed' ? 'COMPLETED' : 'RESCHEDULED';
    const term = search.trim().toLowerCase();
    return all
      .filter((r) => r.status === status)
      .filter((r) => !term || [r.id, r.applicationNo, r.enterprise, r.approvalType, r.locationShort].join(' ').toLowerCase().includes(term))
      .sort((a, b) => `${a.scheduledOn} ${a.id}`.localeCompare(`${b.scheduledOn} ${b.id}`));
  }, [all, filter, search]);
  const pageCount = Math.max(1, Math.ceil(rows.length / INSPECTOR_PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageRows = rows.slice((safePage - 1) * INSPECTOR_PAGE_SIZE, safePage * INSPECTOR_PAGE_SIZE);

  // ── Actions ──
  const openInspection = (id: string) => {
    inspectorSessionStore.setSelected(id);
    navigate(inspectorService.routeFor(id));
    setStep(2);
    window.setTimeout(() => document.getElementById('inspection-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  };

  const changeReport = (patch: Partial<InspectionReport>) => {
    if (report.status === 'SUBMITTED') return;
    inspectorSessionStore.updateReport(rec, { ...patch, status: 'IN_PROGRESS' });
  };

  const errors = showErrors ? validateReport(rec, report) : [];

  const submitReport = () => {
    setShowErrors(true);
    const problems = validateReport(rec, report);
    if (problems.length > 0) {
      notify(`Report cannot be submitted: ${problems.length} issue${problems.length === 1 ? '' : 's'} to resolve.`, 'error');
      document.getElementById('submit-report')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    inspectorSessionStore.submitReport(rec, inspectorName);
    setShowErrors(false);
    notify(`Statutory report submitted (${inspectorService.submissionRefFor(rec)}). Inspection marked Completed.`, 'success');
  };

  const saveDraft = () => {
    if (!hasReportContent(report)) {
      notify('Nothing to save yet — enter the outcome, observations or checklist results first.', 'error');
      return;
    }
    inspectorSessionStore.saveDraft(rec, inspectorName);
    notify('Draft inspection report saved.', 'success');
  };

  const cancelReport = () => {
    inspectorSessionStore.revertReport(rec);
    setShowErrors(false);
    notify('Unsaved changes discarded.');
  };

  const markCompleted = () => {
    if (rec.status === 'COMPLETED') return;
    inspectorSessionStore.markCompleted(rec, inspectorName);
    notify('Inspection marked as completed. Submit the statutory report to close it.', 'success');
  };

  const confirmReschedule = () => {
    if (!rsDate || rsDate <= INSPECTOR_TODAY_ISO) {
      setRsError('Choose a new date after today (18 Dec 2024).');
      return;
    }
    if (!rsReason.trim()) {
      setRsError('A reason is mandatory for the RTS audit record.');
      return;
    }
    inspectorSessionStore.reschedule(rec, inspectorName, rsDate, rsTime, rsReason.trim());
    setRescheduleOpen(false);
    setRsDate('');
    setRsReason('');
    setRsError(null);
    setFilter('rescheduled');
    setPage(1);
    notify(`Inspection rescheduled to ${formatDisplayDate(rsDate)}, ${rsTime}.`, 'success');
  };

  const goStep = (s: Step) => {
    setStep(s);
    const id = s === 1 ? 'inspection-schedule' : s === 2 ? 'inspection-detail' : 'submit-report';
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const handleNav = (id: InspectorNavId) => {
    if (id === 'dashboard') {
      navigate('/inspector/dashboard');
      return;
    }
    navigate(id === 'reports' ? '/inspector/reports' : '/inspector/workspace');
  };

  const notifications = [
    `${rec.id} — ${rec.status === 'SCHEDULED' ? 'scheduled' : rec.status.toLowerCase()} for ${formatDisplayDate(rec.scheduledOn)}, ${rec.scheduledTime}.`,
    `Form 7 report for ${DEFAULT_INSPECTION_ID} is ${REPORT_STEP_LABEL[(session.reports[DEFAULT_INSPECTION_ID] ?? inspectorService.buildInitialReport(inspectorService.getInspection(DEFAULT_INSPECTION_ID)!)).status].toLowerCase()}.`,
    `${counts.upcoming} inspections remain in your upcoming schedule (RTS deadline: 5 working days).`,
  ];

  // ── Reports & Archival view ──
  const reportsView = (() => {
    const withReports = all.map((r) => ({ r, rep: session.reports[r.id] ?? inspectorService.buildInitialReport(r) }));
    const submitted = withReports.filter((x) => x.rep.status === 'SUBMITTED');
    const drafts = withReports.filter((x) => x.rep.status === 'DRAFT_SAVED');
    return (
      <>
        <div className="pb-2 border-b border-slate-200">
          <div className="text-xs text-slate-500 flex items-center space-x-1.5">
            <span>Portal</span><span>&gt;</span><span className="text-[#0B2265] font-semibold">Reports &amp; Archival</span>
          </div>
          <h2 className="text-lg font-bold text-[#0B2265] tracking-tight mt-0.5">Reports &amp; Archival</h2>
        </div>
        <section className="bg-white border border-slate-300 rounded shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-200 bg-slate-50 flex justify-between items-center flex-wrap gap-2">
            <h3 className="font-bold text-sm text-slate-900 tracking-wide uppercase">Submitted Statutory Reports (Form 7)</h3>
            <span className="text-xs text-slate-500 font-medium">{submitted.length} submitted • {drafts.length} draft{drafts.length === 1 ? '' : 's'} in progress</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-100/80 border-b border-slate-200 text-slate-700 uppercase font-semibold text-[11px]">
                  <th className="py-2.5 px-3">Inspection No.</th>
                  <th className="py-2.5 px-3">Application No.</th>
                  <th className="py-2.5 px-3">Enterprise</th>
                  <th className="py-2.5 px-3">Outcome</th>
                  <th className="py-2.5 px-3">Report Ref.</th>
                  <th className="py-2.5 px-3">Submitted On</th>
                  <th className="py-2.5 px-3 text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {submitted.length === 0 && <tr><td colSpan={7} className="py-8 text-center text-slate-500">No reports have been submitted yet.</td></tr>}
                {submitted.map(({ r, rep }) => (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="py-2.5 px-3 text-[#0B2265] font-bold">{r.id}</td>
                    <td className="py-2.5 px-3 text-slate-600">{r.applicationNo}</td>
                    <td className="py-2.5 px-3">{r.enterprise}</td>
                    <td className="py-2.5 px-3 font-semibold">{rep.outcome ? OUTCOME_LABEL[rep.outcome] : '—'}</td>
                    <td className="py-2.5 px-3 font-mono">{rep.submissionRef}</td>
                    <td className="py-2.5 px-3">{rep.submittedAt}</td>
                    <td className="py-2.5 px-3 text-center"><button type="button" onClick={() => openInspection(r.id)} className="text-[#0B2265] hover:underline font-semibold text-[11px]">Open</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        {drafts.length > 0 && (
          <section className="bg-white border border-slate-300 rounded shadow-sm p-4 text-xs">
            <h3 className="font-bold text-sm text-slate-900 tracking-wide uppercase mb-2">Drafts in Progress</h3>
            <ul className="divide-y divide-slate-100">
              {drafts.map(({ r, rep }) => (
                <li key={r.id} className="py-2 flex items-center justify-between gap-2">
                  <span><span className="font-bold text-[#0B2265]">{r.id}</span> — {r.enterprise} <span className="text-slate-500">(saved {rep.savedAt})</span></span>
                  <button type="button" onClick={() => openInspection(r.id)} className="text-[#0B2265] hover:underline font-semibold">Resume</button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </>
    );
  })();

  // ── Workspace view ──
  const filterTabs: Array<{ id: ScheduleFilter; label: string; count: number }> = [
    { id: 'upcoming', label: 'Upcoming', count: counts.upcoming },
    { id: 'completed', label: 'Completed', count: counts.completed },
    { id: 'rescheduled', label: 'Rescheduled', count: counts.rescheduled },
  ];

  const workspaceView = (
    <>
      {/* Breadcrumbs and flow quick-switch */}
      <div className="flex flex-col md:flex-row md:items-center justify-between pb-2 border-b border-slate-200 gap-3">
        <div>
          <div className="text-xs text-slate-500 flex items-center flex-wrap gap-x-1.5">
            <span>Portal</span>
            <span>&gt;</span>
            <span className="text-slate-600 font-medium">My Inspections</span>
            <span>&gt;</span>
            <span className="text-[#0B2265] font-semibold">{rec.id} ({rec.approvalType} Inspection)</span>
          </div>
          <h2 className="text-lg font-bold text-[#0B2265] tracking-tight mt-0.5">Inspector Statutory Workflow Cockpit</h2>
        </div>
        <div className="inline-flex flex-wrap rounded-md shadow-sm border border-slate-300 bg-white p-0.5 text-xs" role="tablist" aria-label="Inspection workflow">
          {([
            [1, `1. Inspection Schedule (${counts.upcoming})`],
            [2, '2. Inspection Detail (Active)'],
            [3, `3. Submit Report (${REPORT_STEP_LABEL[report.status]})`],
          ] as Array<[Step, string]>).map(([s, label]) => (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={step === s}
              onClick={() => goStep(s)}
              className={`px-3 py-1 rounded ${step === s ? 'font-bold text-white bg-[#0B2265] shadow-sm' : 'font-semibold text-slate-700 hover:text-[#0B2265] hover:bg-slate-100'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Read-only regulatory compliance banner */}
      <div className="bg-blue-50 border-l-4 border-[#0B2265] p-3 rounded text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-1 shadow-sm">
        <div className="flex items-center space-x-2.5">
          <span className="text-[#0B2265] text-lg leading-none">ⓘ</span>
          <div>
            <span className="font-bold text-[#0B2265]">Statutory Notice: </span>
            <span className="text-slate-700">Digital submission generates an immutable RTS Audit entry. Photographs must carry timestamp &amp; Geo-coordinates under DISH Circular No. 2024/G-12.</span>
          </div>
        </div>
        <span className="text-[11px] font-mono font-medium text-slate-500">ID: DISH-INSP-SYS-2024</span>
      </div>

      {/* Section 1: My Inspections Schedule */}
      <section ref={scheduleRef} id="inspection-schedule" className="bg-white border border-slate-300 rounded shadow-sm overflow-hidden" data-purpose="panel-inspection-schedule">
        <div className="px-5 py-3 border-b border-slate-200 flex flex-wrap items-center justify-between bg-slate-50 gap-2">
          <div className="flex items-center flex-wrap gap-x-4 gap-y-1">
            <h3 className="font-bold text-sm text-slate-900 tracking-wide uppercase">My Inspections Schedule</h3>
            <div className="flex space-x-1" role="tablist" aria-label="Schedule state">
              {filterTabs.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={filter === t.id}
                  onClick={() => {
                    setFilter(t.id);
                    setPage(1);
                  }}
                  className={`px-2.5 py-1 text-xs rounded ${filter === t.id ? 'font-bold bg-[#0B2265] text-white' : 'font-medium text-slate-600 hover:bg-slate-200'}`}
                >
                  {t.label} ({t.count})
                </button>
              ))}
            </div>
          </div>
          <div className="text-xs text-slate-500 font-medium">
            {rows.length === 0 ? 'Showing 0 Inspections' : `Showing ${(safePage - 1) * INSPECTOR_PAGE_SIZE + 1} - ${Math.min(safePage * INSPECTOR_PAGE_SIZE, rows.length)} of ${rows.length} Inspections`}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-100/80 border-b border-slate-200 text-slate-700 uppercase font-semibold text-[11px]">
                <th className="py-2.5 px-3">Inspection No.</th>
                <th className="py-2.5 px-3">Application No.</th>
                <th className="py-2.5 px-3">Approval Type</th>
                <th className="py-2.5 px-3">Date &amp; Time</th>
                <th className="py-2.5 px-3">Location</th>
                <th className="py-2.5 px-3">Status</th>
                <th className="py-2.5 px-3 text-center">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-slate-800">
              {pageRows.length === 0 && <tr><td colSpan={7} className="py-8 text-center text-slate-500">No inspections in this view{search ? ' match your search' : ''}.</td></tr>}
              {pageRows.map((r) => {
                const isSel = r.id === rec.id;
                const badge = STATUS_BADGE[r.status];
                return (
                  <tr key={r.id} onClick={() => openInspection(r.id)} className={`cursor-pointer transition ${isSel ? 'bg-blue-50/60 font-medium hover:bg-blue-50' : 'hover:bg-slate-50'}`}>
                    <td className="py-2.5 px-3 text-[#0B2265] font-bold">{r.id}</td>
                    <td className="py-2.5 px-3 text-slate-600">{r.applicationNo}</td>
                    <td className="py-2.5 px-3">{r.approvalType}</td>
                    <td className="py-2.5 px-3">{formatDisplayDate(r.scheduledOn)}, {r.scheduledTime}</td>
                    <td className="py-2.5 px-3">{r.locationShort}</td>
                    <td className="py-2.5 px-3"><span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full inline-block border ${badge.cls}`}>{badge.label}</span></td>
                    <td className="py-2.5 px-3 text-center">
                      {isSel ? (
                        <button type="button" onClick={(e) => { e.stopPropagation(); openInspection(r.id); }} className="bg-[#0B2265] hover:bg-[#153B8A] text-white font-medium px-2.5 py-1 rounded text-[11px] shadow-sm">Active Dossier</button>
                      ) : (
                        <button type="button" onClick={(e) => { e.stopPropagation(); openInspection(r.id); }} className="text-[#0B2265] hover:underline font-semibold text-[11px]">View</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-2 border-t border-slate-200 bg-slate-50 flex items-center justify-between text-xs text-slate-500">
          <span>{rows.length === 0 ? 'Showing 0 inspections' : `Showing ${(safePage - 1) * INSPECTOR_PAGE_SIZE + 1}-${Math.min(safePage * INSPECTOR_PAGE_SIZE, rows.length)} of ${rows.length} inspections`}</span>
          <div className="inline-flex space-x-1">
            <button type="button" disabled={safePage === 1} onClick={() => setPage(safePage - 1)} aria-label="Previous page" className="px-2 py-0.5 bg-white border border-slate-300 rounded hover:bg-slate-100 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed">&lt;</button>
            {Array.from({ length: pageCount }, (_, i) => i + 1).map((p) => (
              <button key={p} type="button" onClick={() => setPage(p)} aria-current={p === safePage ? 'page' : undefined} className={`px-2 py-0.5 rounded ${p === safePage ? 'bg-[#0B2265] text-white font-bold' : 'bg-white border border-slate-300 hover:bg-slate-100'}`}>{p}</button>
            ))}
            <button type="button" disabled={safePage === pageCount} onClick={() => setPage(safePage + 1)} aria-label="Next page" className="px-2 py-0.5 bg-white border border-slate-300 rounded hover:bg-slate-100 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed">&gt;</button>
          </div>
        </div>
      </section>

      {/* Panels 3 & 4: detail + submit report */}
      <div ref={grid} className="grid grid-cols-1 lg:grid-cols-12 gap-5" data-purpose="two-column-workspace">
        <InspectionDetailPanel
          key={rec.id}
          rec={rec}
          report={report}
          onReportChange={changeReport}
          onReschedule={() => setRescheduleOpen(true)}
          onMarkCompleted={markCompleted}
          onNotify={notify}
        />
        <InspectionReportPanel key={`r-${rec.id}`} rec={rec} report={report} errors={errors} onChange={changeReport} onSaveDraft={saveDraft} onCancel={cancelReport} onSubmit={submitReport} onNotify={notify} />
      </div>

      {/* Statutory audit strip */}
      <section className="bg-white border border-slate-300 rounded p-3 text-xs shadow-sm" data-purpose="statutory-audit-summary">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-2">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 rounded bg-emerald-50 border border-emerald-300 flex items-center justify-center text-emerald-700 font-bold">✓</div>
            <div>
              <div className="font-bold text-slate-900 text-xs">Immutable Inspection Audit Trail Active</div>
              <div className="text-[11px] text-slate-500">
                Inspector GPS Coordinate Lock: <span className="font-mono text-slate-700 font-medium">18.7561° N, 73.8427° E</span> | Aadhaar e-Sign Token: <span className="font-mono text-slate-700 font-medium">DISH-PUN-ESIGN-8831</span>
              </div>
            </div>
          </div>
          <div className="text-right text-[11px] text-slate-500 flex items-center gap-3">
            <button type="button" onClick={() => setAuditOpen((o) => !o)} aria-expanded={auditOpen} className="text-[#0B2265] font-semibold hover:underline">{auditOpen ? 'Hide Audit Trail' : 'View Audit Trail'} ({audit.length})</button>
            <span>Last Synced: <span className="font-semibold text-slate-700">{session.lastSynced}</span></span>
          </div>
        </div>
        {auditOpen && (
          <ol className="mt-3 pt-3 border-t border-slate-200 relative border-l-2 border-l-slate-200 ml-2 space-y-2.5">
            {audit.map((a) => (
              <li key={a.id} className="pl-4 relative">
                <span className="absolute -left-[7px] top-1 w-3 h-3 rounded-full bg-[#0B2265] border-2 border-white" />
                <p className="font-semibold text-slate-800">{a.action}</p>
                <p className="text-[11px] text-slate-500 font-mono">{a.at} • {a.actor}</p>
                {a.detail && <p className="text-[11px] text-slate-600">{a.detail}</p>}
              </li>
            ))}
          </ol>
        )}
      </section>

      {rescheduleOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Reschedule Inspection">
          <div className="bg-white rounded-lg shadow-2xl w-full max-w-md text-xs">
            <div className="px-4 py-3 border-b border-slate-200 flex justify-between items-center">
              <h4 className="font-bold text-[#0B2265] uppercase tracking-wide">Reschedule {rec.id}</h4>
              <button type="button" onClick={() => setRescheduleOpen(false)} className="text-slate-500 hover:text-slate-800 text-base" aria-label="Close">✕</button>
            </div>
            <div className="p-4 space-y-3">
              <p className="text-slate-600">Currently scheduled: <strong>{formatDisplayDate(rec.scheduledOn)}, {rec.scheduledTime} IST</strong></p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="rs-date" className="block font-semibold text-slate-700 mb-1">New date</label>
                  <input id="rs-date" type="date" min="2024-12-19" value={rsDate} onChange={(e) => setRsDate(e.target.value)} className="w-full border border-slate-300 rounded px-2 py-1.5" />
                </div>
                <div>
                  <label htmlFor="rs-time" className="block font-semibold text-slate-700 mb-1">Time</label>
                  <select id="rs-time" value={rsTime} onChange={(e) => setRsTime(e.target.value)} className="w-full border border-slate-300 rounded px-2 py-1.5 bg-white">
                    {RESCHEDULE_TIME_OPTIONS.map((t) => <option key={t}>{t}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label htmlFor="rs-reason" className="block font-semibold text-slate-700 mb-1">Reason <span className="text-red-600">*</span></label>
                <textarea id="rs-reason" rows={3} value={rsReason} onChange={(e) => setRsReason(e.target.value)} className="w-full border border-slate-300 rounded p-2" placeholder="Reason recorded in the RTS audit trail" />
              </div>
              {rsError && <p role="alert" className="text-red-700 font-semibold">{rsError}</p>}
            </div>
            <div className="px-4 py-3 border-t border-slate-200 flex justify-end gap-2">
              <button type="button" onClick={() => setRescheduleOpen(false)} className="px-3 py-1.5 font-semibold text-slate-600">Cancel</button>
              <button type="button" onClick={confirmReschedule} className="px-4 py-1.5 bg-[#0B2265] hover:bg-[#153B8A] text-white rounded font-bold">Confirm Reschedule</button>
            </div>
          </div>
        </div>
      )}
    </>
  );

  return (
    <InspectorLayout
      activeNav={view === 'reports' ? 'reports' : 'inspections'}
      upcomingCount={counts.upcoming}
      notifications={notifications}
      searchValue={search}
      onSearchChange={(v) => {
        setSearch(v);
        setPage(1);
      }}
      onNavSelect={handleNav}
      onNotice={(m) => notify(m)}
    >
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
      {view === 'reports' ? reportsView : workspaceView}
    </InspectorLayout>
  );
};
