import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useRouter } from '../../router/Router';
import { OfficerLayout, OfficerNavId } from '../../components/layout/OfficerLayout';
import { DossierWork, OfficerDossierWorkspace, initDossierWork } from '../../components/officer/OfficerDossierWorkspace';
import { officerSessionStore, useOfficerSession } from '../../services/officerSessionStore';
import { OfficerQueueRecord } from '../../types/officer';
import {
  APPROVAL_OPTIONS,
  DEPARTMENT_OPTIONS,
  DESK_STATUS_LABEL,
  OFFICER_PAGE_SIZE,
  OFFICER_UPDATED_AT,
  REASSIGN_OFFICER_OPTIONS,
  SLA_OPTIONS,
  STATUS_OPTIONS,
  SlaFilterValue,
  StatusFilterValue,
  daysLeftLabel,
  formatDisplayDate,
  officerQueueService,
  parseDateRange,
  slaFilterMatches,
  statusFilterMatches,
  SLA_RISK_LABEL,
} from '../../services/officerQueueService';

interface Filters {
  dept: string;
  approval: string;
  sla: SlaFilterValue;
  status: StatusFilterValue;
  dateRange: string;
}

const DEFAULT_FILTERS: Filters = {
  dept: 'all',
  approval: 'all',
  sla: 'all',
  status: 'all',
  dateRange: '01 Dec 2024 - 31 Dec 2024',
};

const statusPill: Record<OfficerQueueRecord['status'], { cls: string; dot: string }> = {
  UNDER_SCRUTINY: { cls: 'bg-blue-100 text-blue-800 border-blue-200', dot: 'bg-blue-600' },
  QUERY_RAISED: { cls: 'bg-amber-100 text-amber-800 border-amber-200', dot: 'bg-amber-600' },
  INSPECTION_SCHEDULED: { cls: 'bg-teal-100 text-teal-800 border-teal-200', dot: 'bg-teal-600' },
  DECISION_PENDING: { cls: 'bg-purple-100 text-purple-800 border-purple-200', dot: 'bg-purple-600' },
  APPROVED: { cls: 'bg-emerald-100 text-emerald-800 border-emerald-200', dot: 'bg-emerald-600' },
};

const daysPill: Record<OfficerQueueRecord['slaRisk'], string> = {
  BREACHED: 'bg-rose-100 text-rose-800 border-rose-300',
  NEAR_BREACH: 'bg-orange-100 text-orange-800 border-orange-200',
  APPROACHING: 'bg-amber-100 text-amber-800 border-amber-200',
  WITHIN_SLA: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  COMPLIED: 'bg-slate-100 text-slate-700 border-slate-200',
};

const riskText: Record<OfficerQueueRecord['slaRisk'], { text: string; dot: string }> = {
  BREACHED: { text: 'text-rose-700', dot: 'bg-rose-600' },
  NEAR_BREACH: { text: 'text-orange-700', dot: 'bg-orange-500' },
  APPROACHING: { text: 'text-amber-700', dot: 'bg-amber-500' },
  WITHIN_SLA: { text: 'text-emerald-700', dot: 'bg-emerald-500' },
  COMPLIED: { text: 'text-slate-600', dot: 'bg-slate-400' },
};

const selectCls = 'block w-full text-xs rounded border border-slate-300 py-1.5 px-1 focus:outline-none focus:ring-1 focus:ring-[#1B365D] focus:border-[#1B365D] bg-slate-50';

export const OfficerQueuePage: React.FC = () => {
  const { user } = useAuth();
  const officerName = user?.name || 'Officer';

  const allRecords = useMemo(() => officerQueueService.getQueue(), []);
  const summary = useMemo(() => officerQueueService.getSlaSummary(allRecords), [allRecords]);

  const [draft, setDraft] = useState<Filters>(DEFAULT_FILTERS);
  const [applied, setApplied] = useState<Filters>(DEFAULT_FILTERS);
  const [dateError, setDateError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  // Selected dossier, scrutiny changes and reassignments live in the shared officer session so Screen 27 sees them too.
  const { selectedNo, workMap, assignees } = useOfficerSession();
  const { navigate } = useRouter();
  const [toast, setToast] = useState<{ message: string; tone: 'success' | 'error' | 'info' } | null>(null);
  const [reassignOpen, setReassignOpen] = useState(false);
  const [reassignTo, setReassignTo] = useState(REASSIGN_OFFICER_OPTIONS[0]);
  const [reassignScope, setReassignScope] = useState<'selected' | 'filtered'>('selected');
  const toastTimer = useRef<number | null>(null);

  const notify = (message: string, tone: 'success' | 'error' | 'info' = 'info') => {
    setToast({ message, tone });
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3500);
  };

  useEffect(() => () => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
  }, []);

  // Effective record: queue data with any status the officer has changed in this session
  const effective = (r: OfficerQueueRecord): OfficerQueueRecord => {
    const override = workMap[r.applicationNo]?.status;
    return override ? { ...r, status: override } : r;
  };

  const filtered = useMemo(() => {
    const range = parseDateRange(applied.dateRange);
    const term = search.trim().toLowerCase();
    const rows = allRecords
      .map((r) => {
        const override = workMap[r.applicationNo]?.status;
        return override ? { ...r, status: override } : r;
      })
      .filter((r) => {
        if (applied.dept !== 'all' && r.deptCode !== applied.dept) return false;
        if (applied.approval !== 'all' && r.approvalCode !== applied.approval) return false;
        if (!slaFilterMatches(r.slaRisk, applied.sla)) return false;
        if (!statusFilterMatches(r.status, applied.status)) return false;
        if (range && (r.submittedOn < range.from || r.submittedOn > range.to)) return false;
        if (term) {
          const dossier = officerQueueService.getDossier(r.applicationNo);
          const haystack = [r.applicationNo, r.enterpriseName, r.location, r.approvalName, dossier?.udyam, dossier?.projectSite]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();
          if (!haystack.includes(term)) return false;
        }
        return true;
      });
    return officerQueueService.sortByUrgency(rows);
  }, [allRecords, applied, search, workMap]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / OFFICER_PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageRows = filtered.slice((safePage - 1) * OFFICER_PAGE_SIZE, safePage * OFFICER_PAGE_SIZE);

  const selectedBase = officerQueueService.getRecord(selectedNo);
  const selectedRecord = selectedBase ? effective(selectedBase) : undefined;
  const selectedDossier = selectedBase ? officerQueueService.getDossier(selectedNo) : undefined;
  const selectedWork = selectedDossier ? workMap[selectedNo] ?? initDossierWork(selectedDossier) : undefined;

  const updateWork = (patch: Partial<DossierWork>) => {
    if (!selectedDossier) return;
    officerSessionStore.updateWork(selectedNo, patch);
  };

  const scrollToWorkspace = () => {
    window.setTimeout(() => document.getElementById('dossier-workspace')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };

  const selectRow = (no: string, scroll = false) => {
    officerSessionStore.setSelected(no);
    if (scroll) scrollToWorkspace();
  };

  const applyFilters = () => {
    if (!parseDateRange(draft.dateRange)) {
      setDateError('Enter the range as “01 Dec 2024 - 31 Dec 2024”.');
      return;
    }
    setDateError(null);
    setApplied(draft);
    setPage(1);
  };

  const resetFilters = () => {
    setDraft(DEFAULT_FILTERS);
    setApplied(DEFAULT_FILTERS);
    setDateError(null);
    setSearch('');
    setPage(1);
  };

  const setQuickFilter = (patch: Partial<Filters>) => {
    const next = { ...DEFAULT_FILTERS, ...patch };
    setDraft(next);
    setApplied(next);
    setDateError(null);
    setPage(1);
  };

  const handleNavSelect = (id: OfficerNavId) => {
    switch (id) {
      case 'queue':
        resetFilters();
        break;
      case 'sla':
        setQuickFilter({ sla: 'approaching' });
        notify('Showing dossiers approaching SLA expiry (3-5 working days).');
        break;
      case 'inspections':
        setQuickFilter({ status: 'inspection' });
        notify('Showing dossiers with a joint inspection scheduled.');
        break;
      case 'reports':
        navigate('/officer/reports');
        break;
      case 'grievance':
        navigate('/officer/grievances');
        break;
      default:
        notify('This officer module is not part of Screen 26 and is not available in the prototype yet.');
    }
  };

  const exportQueue = () => {
    const header = ['Application No', 'Enterprise', 'Location', 'Approval Type', 'Act', 'Department', 'Desk', 'Due Date', 'Days Left', 'SLA Risk', 'Status'];
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const lines = filtered.map((r) =>
      [r.applicationNo, r.enterpriseName, r.location, r.approvalName, r.act, r.deptName, r.deskName, formatDisplayDate(r.dueDate), daysLeftLabel(r.daysLeft), SLA_RISK_LABEL[r.slaRisk], DESK_STATUS_LABEL[r.status]]
        .map(esc)
        .join(',')
    );
    try {
      const blob = new Blob([[header.map(esc).join(','), ...lines].join('\r\n')], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'officer-scrutiny-queue.csv';
      a.click();
      URL.revokeObjectURL(url);
      notify(`Exported ${filtered.length} dossier(s) to CSV.`, 'success');
    } catch {
      notify('Export is not available in this browser.', 'error');
    }
  };

  const confirmReassign = () => {
    const targets = reassignScope === 'selected' ? (selectedRecord ? [selectedRecord.applicationNo] : []) : filtered.filter((r) => r.status !== 'APPROVED').map((r) => r.applicationNo);
    if (targets.length === 0) {
      notify('No active dossiers to reassign.', 'error');
      return;
    }
    const short = reassignTo.split(' — ')[0];
    officerSessionStore.assign(targets, short);
    setReassignOpen(false);
    notify(`${targets.length} dossier(s) reassigned to ${short}.`, 'success');
  };

  const notifications = useMemo(
    () => [
      `${summary.breached} dossiers breached SLA — deemed-approval alert sent to the Appellate Authority.`,
      `${summary.nearBreach} dossiers are due within 48 hours and need priority scrutiny.`,
      'MUO/2024/00145 — Sahyadri Bio-Tech Solutions has a query awaiting applicant response.',
      'MUO/2024/000123 — Deshmukh Industries responded to query QRY-001.',
      `${summary.inspections} joint inspections are scheduled with the DISH sub-division.`,
    ],
    [summary]
  );

  const filterLabel = (
    <div className="text-xs text-slate-500">
      Sort by: <strong className="text-slate-800 font-semibold">SLA Urgency (Earliest Expiry First)</strong>
    </div>
  );

  const kpis = [
    { key: 'within', label: 'Within SLA', badge: 'Healthy', value: summary.withinSla, border: 'border-l-emerald-600', badgeCls: 'bg-emerald-100 text-emerald-800', valueCls: 'text-[#0F2038]', noteCls: 'text-emerald-700', note: 'On track • >5 working days remaining', filter: 'normal' as SlaFilterValue },
    { key: 'approaching', label: 'Approaching', badge: 'Attention', value: summary.approaching, border: 'border-l-amber-500', badgeCls: 'bg-amber-100 text-amber-800', valueCls: 'text-amber-700', noteCls: 'text-amber-700', note: 'SLA due within 3 to 5 working days', filter: 'approaching' as SlaFilterValue },
    { key: 'near', label: 'Near Breach', badge: 'Critical Risk', value: summary.nearBreach, border: 'border-l-orange-500', badgeCls: 'bg-orange-100 text-orange-800', valueCls: 'text-orange-700', noteCls: 'text-orange-700', note: 'Due in <48 hours • Priority Scrutiny', filter: 'near' as SlaFilterValue },
    { key: 'breached', label: 'Breached', badge: 'Escalated', value: summary.breached, border: 'border-l-rose-600', badgeCls: 'bg-rose-100 text-rose-800', valueCls: 'text-rose-700', noteCls: 'text-rose-700', note: 'Deemed alert sent to Appellate Authority', filter: 'breached' as SlaFilterValue },
  ];

  return (
    <OfficerLayout
      activeNav="queue"
      searchValue={search}
      onSearchChange={(v) => {
        setSearch(v);
        setPage(1);
      }}
      queueCount={summary.totalActive}
      slaCount={summary.approaching}
      inspectionCount={summary.inspections}
      notifications={notifications}
      onNavSelect={handleNavSelect}
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

      {/* Breadcrumb & page header */}
      <section className="mb-5" data-purpose="page-title-and-breadcrumbs">
        <nav aria-label="Breadcrumb" className="flex text-xs text-slate-500 space-x-2 mb-1.5">
          <span>Portal</span>
          <span>›</span>
          <span>Scrutiny Workspace</span>
          <span>›</span>
          <span aria-current="page" className="text-[#0F2038] font-semibold">Application Scrutiny Queue &amp; SLA Monitoring</span>
        </nav>
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <h2 className="text-xl sm:text-2xl font-bold text-[#0F2038] tracking-tight">Application Scrutiny Queue &amp; SLA Monitoring</h2>
            <p className="text-xs text-slate-600 mt-0.5">
              Scrutiny and statutory review under Maharashtra Right to Public Services Act (RTSA) 2015 • Industries Department
            </p>
          </div>
          <div className="flex items-center space-x-2.5">
            <button type="button" onClick={exportQueue} className="inline-flex items-center px-3 py-1.5 text-xs font-semibold rounded bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 shadow-sm transition">
              ⬇ Export Queue
            </button>
            <button type="button" onClick={() => setReassignOpen(true)} className="inline-flex items-center px-3 py-1.5 text-xs font-semibold rounded bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 shadow-sm transition">
              ⇄ Batch Reassign
            </button>
            <div className="hidden sm:block text-right pl-2 border-l border-slate-300 text-[11px] text-slate-500">
              <span>Updated: <strong>{OFFICER_UPDATED_AT}</strong></span>
            </div>
          </div>
        </div>
      </section>

      {/* SLA KPI cards (click to filter) */}
      <section aria-label="SLA Compliance Status Cards" className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6" data-purpose="sla-metric-summary-cards">
        {kpis.map((k) => (
          <button
            key={k.key}
            type="button"
            onClick={() => setQuickFilter({ sla: k.filter })}
            aria-pressed={applied.sla === k.filter}
            className={`text-left bg-white rounded-lg p-4 border-l-4 ${k.border} border border-slate-200 shadow-sm hover:shadow transition ${applied.sla === k.filter ? 'ring-2 ring-[#142A4A]/40' : ''}`}
            title={`Filter queue: ${k.label}`}
          >
            <div className="flex justify-between items-start">
              <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide">{k.label}</span>
              <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold ${k.badgeCls}`}>{k.badge}</span>
            </div>
            <div className="mt-2 flex items-baseline space-x-2">
              <span className={`text-3xl font-extrabold leading-none ${k.valueCls}`}>{k.value}</span>
              <span className="text-xs text-slate-500 font-medium">dossiers</span>
            </div>
            <p className={`mt-2 text-[11px] font-medium ${k.noteCls}`}>{k.note}</p>
          </button>
        ))}
      </section>

      {/* Filters */}
      <section className="bg-white p-3.5 rounded-lg border border-slate-200 shadow-sm mb-5" data-purpose="scrutiny-filter-controls">
        <form
          className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 text-xs"
          onSubmit={(e) => {
            e.preventDefault();
            applyFilters();
          }}
        >
          <div>
            <label className="block font-semibold text-slate-700 mb-1" htmlFor="dept-select">Department</label>
            <select id="dept-select" className={selectCls} value={draft.dept} onChange={(e) => setDraft({ ...draft, dept: e.target.value })}>
              {DEPARTMENT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block font-semibold text-slate-700 mb-1" htmlFor="approval-type">Clearance / Licence</label>
            <select id="approval-type" className={selectCls} value={draft.approval} onChange={(e) => setDraft({ ...draft, approval: e.target.value })}>
              {APPROVAL_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block font-semibold text-slate-700 mb-1" htmlFor="sla-risk">SLA Risk Level</label>
            <select id="sla-risk" className={selectCls} value={draft.sla} onChange={(e) => setDraft({ ...draft, sla: e.target.value as SlaFilterValue })}>
              {SLA_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block font-semibold text-slate-700 mb-1" htmlFor="app-status">Desk Status</label>
            <select id="app-status" className={selectCls} value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as StatusFilterValue })}>
              {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block font-semibold text-slate-700 mb-1" htmlFor="date-range">RTS Submission Date</label>
            <input
              id="date-range"
              type="text"
              value={draft.dateRange}
              onChange={(e) => setDraft({ ...draft, dateRange: e.target.value })}
              aria-invalid={!!dateError}
              className={`block w-full text-[11px] rounded border py-1.5 px-2 font-mono bg-slate-50 focus:outline-none focus:ring-1 focus:ring-[#1B365D] ${dateError ? 'border-rose-400' : 'border-slate-300'}`}
            />
            {dateError && <p className="text-[10px] text-rose-600 mt-0.5">{dateError}</p>}
          </div>
          <div className="flex items-end space-x-2">
            <button type="submit" className="w-full py-1.5 px-3 bg-[#142A4A] hover:bg-[#0F2038] text-white rounded text-xs font-semibold shadow-sm transition">Apply Filter</button>
            <button type="button" onClick={resetFilters} title="Reset all filters" className="py-1.5 px-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-xs font-medium border border-slate-300 transition">Reset</button>
          </div>
        </form>
      </section>

      {/* Queue table */}
      <section className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden mb-7" data-purpose="officer-applications-datagrid">
        <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex flex-wrap justify-between items-center gap-2">
          <div className="flex items-center space-x-2 flex-wrap gap-y-1">
            <h3 className="text-xs font-bold text-[#0F2038] uppercase tracking-wide">Assigned Application Queue (Active Dossiers)</h3>
            <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-blue-100 text-blue-800">{summary.totalActive} Applications Assigned</span>
          </div>
          {filterLabel}
        </div>
        <div className="overflow-x-auto">
          <table aria-label="Official Scrutiny Queue Table" className="w-full text-left border-collapse text-[0.8125rem]" id="officer-queue-table">
            <thead>
              <tr className="bg-[#EDF2F7] text-[0.7rem] font-bold uppercase tracking-[0.03em] text-slate-700 border-b border-slate-300">
                <th className="py-2.5 px-3.5">Application No. &amp; Enterprise</th>
                <th className="py-2.5 px-3">Approval Type &amp; Act</th>
                <th className="py-2.5 px-3">Department</th>
                <th className="py-2.5 px-3">Due Date</th>
                <th className="py-2.5 px-3 text-center">Days Left</th>
                <th className="py-2.5 px-3">SLA Risk Level</th>
                <th className="py-2.5 px-3">Current Status</th>
                <th className="py-2.5 px-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-10 text-center text-xs text-slate-500">
                    No dossiers match the current filters.{' '}
                    <button type="button" onClick={resetFilters} className="text-blue-700 font-semibold underline">Reset filters</button>
                  </td>
                </tr>
              )}
              {pageRows.map((r) => {
                const isSel = r.applicationNo === selectedNo;
                const risk = riskText[r.slaRisk];
                const pill = statusPill[r.status];
                return (
                  <tr
                    key={r.applicationNo}
                    onClick={() => selectRow(r.applicationNo)}
                    aria-selected={isSel}
                    className={`border-b border-slate-200 cursor-pointer transition hover:bg-slate-50 ${isSel ? 'bg-blue-50/70 border-l-4 border-l-[#142A4A] hover:bg-blue-50' : r.slaRisk === 'BREACHED' ? 'bg-rose-50/20' : ''}`}
                  >
                    <td className="py-3 px-3.5">
                      <div className="font-bold text-xs flex items-center gap-1.5 flex-wrap">
                        <span className={`font-mono ${r.slaRisk === 'BREACHED' ? 'text-rose-700' : r.slaRisk === 'COMPLIED' ? 'text-slate-600' : 'text-blue-700'}`}>{r.applicationNo}</span>
                        {isSel && <span className="px-1.5 rounded bg-amber-100 text-amber-900 text-[10px] font-bold">Selected</span>}
                      </div>
                      <div className={`text-slate-800 text-xs mt-0.5 ${isSel ? 'font-semibold' : 'font-medium'}`}>{r.enterpriseName}</div>
                      <div className="text-[11px] text-slate-500">{r.location}</div>
                      {assignees[r.applicationNo] && <div className="text-[10px] text-blue-700 font-semibold mt-0.5">↪ Reassigned to {assignees[r.applicationNo]}</div>}
                    </td>
                    <td className="py-3 px-3">
                      <span className="font-medium text-slate-800">{r.approvalName}</span>
                      <p className="text-[11px] text-slate-500">{r.act}</p>
                    </td>
                    <td className="py-3 px-3 text-slate-700 text-xs">
                      <span className="font-medium">{r.deptName}</span>
                      <span className="block text-[11px] text-slate-500">{r.deskName}</span>
                    </td>
                    <td className={`py-3 px-3 font-mono text-xs ${r.slaRisk === 'BREACHED' ? 'text-rose-700 font-semibold' : 'text-slate-800'}`}>
                      {formatDisplayDate(r.dueDate)}
                      {r.dueTime && <span className="block text-[10px] text-slate-500 font-sans">{r.dueTime}</span>}
                    </td>
                    <td className="py-3 px-3 text-center">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold border whitespace-nowrap ${daysPill[r.slaRisk]}`}>{daysLeftLabel(r.daysLeft)}</span>
                    </td>
                    <td className="py-3 px-3">
                      <span className={`inline-flex items-center text-xs font-bold ${risk.text}`}>
                        <span className={`w-2 h-2 rounded-full mr-1.5 ${risk.dot}`} />
                        {SLA_RISK_LABEL[r.slaRisk]}
                      </span>
                    </td>
                    <td className="py-3 px-3">
                      <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border whitespace-nowrap ${pill.cls}`}>
                        <span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${pill.dot}`} />
                        {DESK_STATUS_LABEL[r.status]}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-right">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          selectRow(r.applicationNo, true);
                        }}
                        className={`inline-flex items-center px-3 py-1 rounded text-xs font-semibold transition whitespace-nowrap ${
                          isSel ? 'bg-[#142A4A] hover:bg-[#0F2038] text-white shadow-sm' : 'bg-white hover:bg-slate-100 text-slate-700 border border-slate-300'
                        }`}
                      >
                        {isSel ? 'Workspace ↓' : r.status === 'APPROVED' ? 'Dossier' : 'View'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-3 bg-white border-t border-slate-200 flex flex-col sm:flex-row justify-between items-center gap-2">
          <div className="text-xs text-slate-600">
            {filtered.length === 0 ? (
              'Showing 0 applications'
            ) : (
              <>
                Showing <span className="font-semibold text-slate-900">{(safePage - 1) * OFFICER_PAGE_SIZE + 1}</span> to{' '}
                <span className="font-semibold text-slate-900">{Math.min(safePage * OFFICER_PAGE_SIZE, filtered.length)}</span> of{' '}
                <span className="font-semibold text-slate-900">{filtered.length}</span> applications
              </>
            )}
          </div>
          <nav aria-label="Queue Pagination" className="flex items-center space-x-1">
            <button type="button" disabled={safePage === 1} onClick={() => setPage(safePage - 1)} className="px-2.5 py-1 border border-slate-300 rounded text-xs text-slate-600 bg-slate-50 hover:bg-slate-100 disabled:opacity-50" aria-label="Previous page">‹</button>
            {Array.from({ length: pageCount }, (_, i) => i + 1)
              .filter((p) => p === 1 || p === pageCount || Math.abs(p - safePage) <= 2)
              .map((p, idx, arr) => (
                <React.Fragment key={p}>
                  {idx > 0 && p - arr[idx - 1] > 1 && <span className="px-1 text-slate-400 text-xs">…</span>}
                  <button
                    type="button"
                    onClick={() => setPage(p)}
                    aria-current={p === safePage ? 'page' : undefined}
                    className={`px-2.5 py-1 border rounded text-xs ${p === safePage ? 'border-[#142A4A] bg-[#142A4A] text-white font-bold' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50 font-medium'}`}
                  >
                    {p}
                  </button>
                </React.Fragment>
              ))}
            <button type="button" disabled={safePage === pageCount} onClick={() => setPage(safePage + 1)} className="px-2.5 py-1 border border-slate-300 rounded text-xs text-slate-600 bg-white hover:bg-slate-50 disabled:opacity-50" aria-label="Next page">›</button>
          </nav>
        </div>
      </section>

      {/* Integrated scrutiny workspace for the selected dossier */}
      {selectedRecord && selectedDossier && selectedWork && (
        <OfficerDossierWorkspace
          key={selectedRecord.applicationNo}
          record={selectedRecord}
          dossier={selectedDossier}
          work={selectedWork}
          officerName={officerName}
          onWorkChange={updateWork}
          onNotify={notify}
          onOpenFullWorkspace={() => navigate('/officer/workspace')}
        />
      )}

      {/* Batch reassign modal */}
      {reassignOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Batch Reassign">
          <div className="bg-white rounded-lg shadow-2xl w-full max-w-md text-xs">
            <div className="px-4 py-3 border-b border-slate-200 flex justify-between items-center">
              <h4 className="font-bold text-[#0F2038] uppercase tracking-wide">Batch Reassign Dossiers</h4>
              <button type="button" onClick={() => setReassignOpen(false)} className="text-slate-500 hover:text-slate-800 text-base" aria-label="Close">✕</button>
            </div>
            <div className="p-4 space-y-3">
              <div>
                <span className="block font-semibold text-slate-700 mb-1">Scope</span>
                <label className="flex items-center gap-2 mb-1">
                  <input type="radio" name="reassign-scope" checked={reassignScope === 'selected'} onChange={() => setReassignScope('selected')} />
                  <span>Selected dossier ({selectedNo})</span>
                </label>
                <label className="flex items-center gap-2">
                  <input type="radio" name="reassign-scope" checked={reassignScope === 'filtered'} onChange={() => setReassignScope('filtered')} />
                  <span>All active dossiers in the current filtered view ({filtered.filter((r) => r.status !== 'APPROVED').length})</span>
                </label>
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1" htmlFor="reassign-officer">Reassign to</label>
                <select id="reassign-officer" className={selectCls} value={reassignTo} onChange={(e) => setReassignTo(e.target.value)}>
                  {REASSIGN_OFFICER_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
              <p className="text-[11px] text-slate-500">Prototype only — the reassignment is shown in this session and is not persisted.</p>
            </div>
            <div className="px-4 py-3 border-t border-slate-200 flex justify-end gap-2">
              <button type="button" onClick={() => setReassignOpen(false)} className="px-3 py-1.5 font-semibold text-slate-600">Cancel</button>
              <button type="button" onClick={confirmReassign} className="px-4 py-1.5 bg-[#142A4A] hover:bg-[#0F2038] text-white rounded font-bold">Confirm Reassign</button>
            </div>
          </div>
        </div>
      )}
    </OfficerLayout>
  );
};
