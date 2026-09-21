import React, { useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useRouter } from '../../router/Router';
import { OfficerLayout, OfficerNavId } from '../../components/layout/OfficerLayout';
import {
  APPROVAL_OPTIONS,
  DEPARTMENT_OPTIONS,
  DESK_STATUS_LABEL,
  OFFICER_UPDATED_AT,
  SLA_RISK_LABEL,
  officerQueueService,
} from '../../services/officerQueueService';
import { inspectorService } from '../../services/inspectorService';
import { OfficerQueueRecord } from '../../types/officer';

type ReportType = 'disposal' | 'sla' | 'inspection';
type ReportFilter = 'all' | OfficerQueueRecord['status'];

const statusClasses: Record<OfficerQueueRecord['status'], string> = {
  UNDER_SCRUTINY: 'bg-blue-100 text-blue-800 border-blue-200',
  QUERY_RAISED: 'bg-amber-100 text-amber-800 border-amber-200',
  INSPECTION_SCHEDULED: 'bg-teal-100 text-teal-800 border-teal-200',
  DECISION_PENDING: 'bg-purple-100 text-purple-800 border-purple-200',
  APPROVED: 'bg-emerald-100 text-emerald-800 border-emerald-200',
};

const riskClasses: Record<OfficerQueueRecord['slaRisk'], string> = {
  BREACHED: 'bg-rose-100 text-rose-800 border-rose-200',
  NEAR_BREACH: 'bg-orange-100 text-orange-800 border-orange-200',
  APPROACHING: 'bg-amber-100 text-amber-800 border-amber-200',
  WITHIN_SLA: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  COMPLIED: 'bg-slate-100 text-slate-700 border-slate-200',
};

export const StatutoryReportsPage: React.FC = () => {
  const { user } = useAuth();
  const { navigate } = useRouter();
  const allRecords = useMemo(() => officerQueueService.getQueue(), []);
  const inspections = useMemo(() => inspectorService.getInspections(), []);
  const summary = useMemo(() => officerQueueService.getSlaSummary(allRecords), [allRecords]);
  const [reportType, setReportType] = useState<ReportType>('disposal');
  const [department, setDepartment] = useState('all');
  const [approval, setApproval] = useState('all');
  const [status, setStatus] = useState<ReportFilter>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [notice, setNotice] = useState('');
  const pageSize = 6;

  const filteredRecords = useMemo(() => {
    const term = search.trim().toLowerCase();
    return allRecords.filter((record) => {
      const matchesDepartment = department === 'all' || record.deptCode === department;
      const matchesApproval = approval === 'all' || record.approvalCode === approval;
      const matchesStatus = status === 'all' || record.status === status;
      const matchesSearch = !term || [record.applicationNo, record.enterpriseName, record.approvalName, record.deptName].join(' ').toLowerCase().includes(term);
      return matchesDepartment && matchesApproval && matchesStatus && matchesSearch;
    });
  }, [allRecords, approval, department, search, status]);

  const pageCount = Math.max(1, Math.ceil(filteredRecords.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const pageRows = filteredRecords.slice((safePage - 1) * pageSize, safePage * pageSize);
  const completedInspections = inspections.filter((inspection) => inspection.status === 'COMPLETED');

  const notify = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(''), 2800);
  };

  const handleNav = (id: OfficerNavId) => {
    if (id === 'dashboard') navigate('/officer/dashboard');
    else if (id === 'queue') navigate('/officer/queue');
    else if (id === 'reports') return;
    else if (id === 'grievance') navigate('/officer/grievances');
    else notify(`${id === 'sla' ? 'SLA Monitoring' : id === 'inspections' ? 'Joint Inspections' : 'RTS Grievance Desk'} remains in the existing Officer prototype.`);
  };

  const exportReport = () => {
    const rows = filteredRecords.map((record) => [
      record.applicationNo,
      record.enterpriseName,
      record.approvalName,
      record.deptName,
      DESK_STATUS_LABEL[record.status],
      SLA_RISK_LABEL[record.slaRisk],
    ].join(','));
    const csv = ['Application No,Enterprise,Approval,Department,Status,SLA Risk', ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `mahaudyam-${reportType}-report.csv`;
    link.click();
    URL.revokeObjectURL(url);
    notify('Deterministic prototype report export generated.');
  };

  return (
    <OfficerLayout
      activeNav="reports"
      searchValue={search}
      onSearchChange={(value) => { setSearch(value); setPage(1); }}
      queueCount={summary.totalActive}
      slaCount={summary.approaching + summary.nearBreach + summary.breached}
      inspectionCount={summary.inspections}
      notifications={[
        `${summary.breached} application(s) are currently breached.`,
        `${completedInspections.length} statutory inspection report(s) are archived.`,
        'Report data is generated from the local prototype records.',
      ]}
      onNavSelect={handleNav}
      onNotice={notify}
    >
      <div className="mb-5">
        <nav aria-label="Breadcrumb" className="flex text-xs text-slate-500 space-x-2 mb-1.5"><span>Portal</span><span>›</span><span className="text-[#0F2038] font-semibold">Statutory Reports</span></nav>
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div><h2 className="text-xl sm:text-2xl font-bold text-[#0F2038] tracking-tight">Statutory Reports</h2><p className="text-xs text-slate-600 mt-0.5">RTSA 2015 scrutiny, disposal and field inspection reporting • Industries Department</p><p className="text-[10px] text-amber-700 font-semibold mt-1">Prototype report data — not live government statistics</p></div>
          <div className="text-right text-[11px] text-slate-500">Officer: <strong className="text-slate-700">{user?.name || 'Officer'}</strong><br />Updated: <strong>{OFFICER_UPDATED_AT}</strong></div>
        </div>
      </div>

      <section aria-label="Report summary" className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        {[
          ['Total Active Dossiers', summary.totalActive, 'Current scrutiny queue', 'text-[#0F2038]'],
          ['Applications Within SLA', summary.withinSla, 'Within designated timeline', 'text-emerald-700'],
          ['SLA Breach Alerts', summary.nearBreach + summary.breached, 'Near breach or breached', 'text-rose-700'],
          ['Inspection Reports', completedInspections.length, 'Completed statutory reports', 'text-teal-700'],
        ].map(([label, value, detail, tone]) => <div key={label} className="bg-white rounded-lg p-4 border border-slate-200 shadow-sm"><div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</div><div className={`text-2xl font-bold mt-1 ${tone}`}>{value}</div><p className="text-[10px] text-slate-500 mt-1">{detail}</p></div>)}
      </section>

      <section className="bg-white rounded-lg border border-slate-200 shadow-sm mb-5">
        <div className="flex flex-wrap border-b border-slate-200 px-3" role="tablist" aria-label="Statutory report types">
          {([
            ['disposal', 'Application Disposal Report'],
            ['sla', 'SLA Compliance Report'],
            ['inspection', 'Inspection & Statutory Report'],
          ] as Array<[ReportType, string]>).map(([value, label]) => <button key={value} type="button" role="tab" aria-selected={reportType === value} onClick={() => { setReportType(value); setPage(1); }} className={`px-3 py-2.5 text-xs font-semibold border-b-2 ${reportType === value ? 'border-[#142A4A] text-[#142A4A]' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>{label}</button>)}
        </div>
        <div className="p-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 text-xs">
          <label className="block font-semibold text-slate-700">Reporting Period<input aria-label="Reporting period" value="01 Dec 2024 - 31 Dec 2024" readOnly className="block w-full mt-1 rounded border border-slate-300 py-1.5 px-2 bg-slate-50 font-mono text-[11px]" /></label>
          <label className="block font-semibold text-slate-700">Department<select aria-label="Report department" value={department} onChange={(e) => { setDepartment(e.target.value); setPage(1); }} className="block w-full mt-1 rounded border border-slate-300 py-1.5 px-1 bg-slate-50">{DEPARTMENT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          <label className="block font-semibold text-slate-700">Clearance / Licence<select aria-label="Report approval type" value={approval} onChange={(e) => { setApproval(e.target.value); setPage(1); }} className="block w-full mt-1 rounded border border-slate-300 py-1.5 px-1 bg-slate-50">{APPROVAL_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          <label className="block font-semibold text-slate-700">Desk Status<select aria-label="Report desk status" value={status} onChange={(e) => { setStatus(e.target.value as ReportFilter); setPage(1); }} className="block w-full mt-1 rounded border border-slate-300 py-1.5 px-1 bg-slate-50"><option value="all">All Statuses</option>{Object.entries(DESK_STATUS_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <div className="flex items-end gap-2"><button type="button" onClick={exportReport} className="w-full rounded bg-[#142A4A] text-white px-3 py-2 font-semibold hover:bg-[#1B365D] focus:outline-none focus:ring-2 focus:ring-[#1B365D]">Export CSV</button></div>
        </div>
      </section>

      {reportType === 'inspection' ? (
        <section className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden" data-purpose="inspection-report-table">
          <div className="px-4 py-3 bg-slate-50 border-b border-slate-200"><h3 className="font-bold text-sm text-[#0F2038]">Inspection &amp; Statutory Report Register</h3><p className="text-[11px] text-slate-500">Field verification assignments and submitted inspection reports</p></div>
          <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-xs"><thead className="bg-slate-100 text-[11px] uppercase font-bold text-slate-700"><tr><th className="py-2.5 px-3">Inspection No.</th><th className="py-2.5 px-3">Application No.</th><th className="py-2.5 px-3">Approval Type</th><th className="py-2.5 px-3">Date &amp; Location</th><th className="py-2.5 px-3">Status</th><th className="py-2.5 px-3 text-center">Action</th></tr></thead><tbody className="divide-y divide-slate-200">{inspections.map((inspection) => <tr key={inspection.id} className="hover:bg-slate-50"><td className="py-2.5 px-3 font-bold text-[#142A4A]">{inspection.id}</td><td className="py-2.5 px-3">{inspection.applicationNo}</td><td className="py-2.5 px-3">{inspection.approvalType}</td><td className="py-2.5 px-3">{inspection.scheduledOn} • {inspection.locationShort}</td><td className="py-2.5 px-3"><span className="px-2 py-0.5 rounded-full border bg-slate-100 text-slate-700">{inspection.status === 'COMPLETED' ? 'Report Submitted' : inspection.status}</span></td><td className="py-2.5 px-3 text-center"><button type="button" onClick={() => notify(`Inspection ${inspection.id} is available in the Inspector statutory workspace.`)} className="text-blue-700 font-semibold hover:underline">View Register</button></td></tr>)}</tbody></table></div>
        </section>
      ) : (
        <section className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden" data-purpose="application-report-table">
          <div className="px-4 py-3 bg-slate-50 border-b border-slate-200"><h3 className="font-bold text-sm text-[#0F2038]">{reportType === 'sla' ? 'SLA Compliance Report' : 'Application Disposal &amp; Processing Report'}</h3><p className="text-[11px] text-slate-500">{reportType === 'sla' ? 'RTS risk levels, due dates and statutory timeline compliance' : 'Application scrutiny status and disposal information for the selected period'}</p></div>
          <div className="overflow-x-auto"><table className="w-full min-w-[980px] text-left text-xs"><thead className="bg-slate-100 text-[11px] uppercase font-bold text-slate-700"><tr><th className="py-2.5 px-3">Application No.</th><th className="py-2.5 px-3">Enterprise</th><th className="py-2.5 px-3">Approval / Department</th><th className="py-2.5 px-3">Submitted</th><th className="py-2.5 px-3">Status</th><th className="py-2.5 px-3">SLA</th><th className="py-2.5 px-3 text-center">Action</th></tr></thead><tbody className="divide-y divide-slate-200">{pageRows.map((record) => <tr key={record.applicationNo} className="hover:bg-slate-50"><td className="py-2.5 px-3 font-bold text-[#142A4A]">{record.applicationNo}</td><td className="py-2.5 px-3"><div className="font-semibold">{record.enterpriseName}</div><div className="text-[10px] text-slate-500">{record.location}</div></td><td className="py-2.5 px-3"><div>{record.approvalName}</div><div className="text-[10px] text-slate-500">{record.deptName}</div></td><td className="py-2.5 px-3 font-mono">{record.submittedOn}</td><td className="py-2.5 px-3"><span className={`px-2 py-0.5 rounded-full border text-[10px] font-semibold ${statusClasses[record.status]}`}>{DESK_STATUS_LABEL[record.status]}</span></td><td className="py-2.5 px-3"><span className={`px-2 py-0.5 rounded border text-[10px] font-bold ${riskClasses[record.slaRisk]}`}>{SLA_RISK_LABEL[record.slaRisk]}</span></td><td className="py-2.5 px-3 text-center"><button type="button" onClick={() => notify(`Report detail for ${record.applicationNo} is available in the Officer Workspace.`)} className="text-blue-700 font-semibold hover:underline focus:outline-none focus:ring-2 focus:ring-[#1B365D] rounded">View</button></td></tr>)}{pageRows.length === 0 && <tr><td colSpan={7} className="py-8 text-center text-slate-500">No records match the selected report filters.</td></tr>}</tbody></table></div>
          <div className="px-4 py-2 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-[11px] text-slate-500"><span>Showing {pageRows.length ? (safePage - 1) * pageSize + 1 : 0}-{Math.min(safePage * pageSize, filteredRecords.length)} of {filteredRecords.length} records</span><div className="flex gap-1"><button type="button" disabled={safePage === 1} onClick={() => setPage(safePage - 1)} className="px-2 py-0.5 border rounded disabled:text-slate-300">Previous</button><span className="px-2 py-0.5 bg-[#142A4A] text-white rounded">{safePage}</span><button type="button" disabled={safePage === pageCount} onClick={() => setPage(safePage + 1)} className="px-2 py-0.5 border rounded disabled:text-slate-300">Next</button></div></div>
        </section>
      )}
      {notice && <div role="status" className="fixed right-5 bottom-5 z-50 bg-[#142A4A] text-white rounded-lg shadow-xl px-4 py-3 text-xs font-semibold">{notice}</div>}
    </OfficerLayout>
  );
};
