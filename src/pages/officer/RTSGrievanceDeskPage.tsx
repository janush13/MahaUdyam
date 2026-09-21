import React, { useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useRouter } from '../../router/Router';
import { OfficerLayout, OfficerNavId } from '../../components/layout/OfficerLayout';
import { DEPARTMENT_OPTIONS, officerQueueService } from '../../services/officerQueueService';

type GrievanceStatus = 'PENDING_SCRUTINY' | 'ASSIGNED' | 'APPROACHING_SLA' | 'OVERDUE' | 'RESOLVED' | 'ESCALATED';
type GrievanceFilter = 'all' | GrievanceStatus;

interface GrievanceRecord {
  id: string;
  applicant: string;
  applicationNo: string;
  enterprise: string;
  department: string;
  service: string;
  category: string;
  receivedOn: string;
  dueOn: string;
  status: GrievanceStatus;
  assignee: string;
}

const STATUS_LABEL: Record<GrievanceStatus, string> = {
  PENDING_SCRUTINY: 'Pending Scrutiny',
  ASSIGNED: 'Assigned',
  APPROACHING_SLA: 'Approaching SLA',
  OVERDUE: 'Overdue',
  RESOLVED: 'Resolved',
  ESCALATED: 'Reopened / Escalated',
};

const STATUS_CLASS: Record<GrievanceStatus, string> = {
  PENDING_SCRUTINY: 'bg-amber-100 text-amber-800 border-amber-200',
  ASSIGNED: 'bg-blue-100 text-blue-800 border-blue-200',
  APPROACHING_SLA: 'bg-orange-100 text-orange-800 border-orange-200',
  OVERDUE: 'bg-rose-100 text-rose-800 border-rose-200',
  RESOLVED: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  ESCALATED: 'bg-purple-100 text-purple-800 border-purple-200',
};

const CATEGORY_OPTIONS = ['All Categories', 'RTS Delay / Non-disposal', 'Service Quality', 'Document / Query Concern', 'Escalation / Appeal'];
const GRIEVANCE_PAGE_SIZE = 6;

export const RTSGrievanceDeskPage: React.FC = () => {
  const { user } = useAuth();
  const { navigate } = useRouter();
  const queue = useMemo(() => officerQueueService.getQueue(), []);
  const grievances = useMemo<GrievanceRecord[]>(() => {
    const statuses: GrievanceStatus[] = ['OVERDUE', 'APPROACHING_SLA', 'ASSIGNED', 'PENDING_SCRUTINY', 'RESOLVED', 'ESCALATED', 'RESOLVED', 'ASSIGNED'];
    const categories = ['RTS Delay / Non-disposal', 'Service Quality', 'Document / Query Concern', 'Escalation / Appeal'];
    const applicants = ['Maharashtra Industrial Applicant', 'Pune Enterprise Representative', 'MIDC Project Applicant', 'District Investor Facilitation Desk'];
    return queue.slice(0, 8).map((record, index) => ({
      id: `RTS/2024/${String(1041 + index).padStart(4, '0')}`,
      applicant: applicants[index % applicants.length],
      applicationNo: record.applicationNo,
      enterprise: record.enterpriseName,
      department: record.deptName,
      service: record.approvalName,
      category: categories[index % categories.length],
      receivedOn: `2024-12-${String(2 + index).padStart(2, '0')}`,
      dueOn: record.dueDate,
      status: statuses[index],
      assignee: index === 0 || index === 5 ? 'Rajesh Kulkarni' : index === 4 ? 'Appellate Review Cell' : 'Unassigned',
    }));
  }, [queue]);
  const { name = 'Officer' } = user || {};
  const [filter, setFilter] = useState<GrievanceFilter>('all');
  const [category, setCategory] = useState('All Categories');
  const [department, setDepartment] = useState('all');
  const [slaView, setSlaView] = useState('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [notice, setNotice] = useState('');

  const notify = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(''), 2800);
  };

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return grievances.filter((item) => (
      (filter === 'all' || item.status === filter) &&
      (slaView === 'all' ||
        (slaView === 'urgent' && (item.status === 'APPROACHING_SLA' || item.status === 'OVERDUE')) ||
        (slaView === 'resolved' && item.status === 'RESOLVED')) &&
      (category === 'All Categories' || item.category === category) &&
      (department === 'all' || queue.find((record) => record.applicationNo === item.applicationNo)?.deptCode === department) &&
      (!term || [item.id, item.applicant, item.applicationNo, item.enterprise, item.service].join(' ').toLowerCase().includes(term))
    ));
  }, [category, department, filter, grievances, queue, search, slaView]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / GRIEVANCE_PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const rows = filtered.slice((safePage - 1) * GRIEVANCE_PAGE_SIZE, safePage * GRIEVANCE_PAGE_SIZE);
  const counts = {
    total: grievances.length,
    pending: grievances.filter((item) => item.status === 'PENDING_SCRUTINY' || item.status === 'ASSIGNED').length,
    urgent: grievances.filter((item) => item.status === 'APPROACHING_SLA' || item.status === 'OVERDUE').length,
    resolved: grievances.filter((item) => item.status === 'RESOLVED').length,
  };

  const handleNav = (id: OfficerNavId) => {
    if (id === 'dashboard') navigate('/officer/dashboard');
    else if (id === 'queue') navigate('/officer/queue');
    else if (id === 'reports') navigate('/officer/reports');
    else if (id === 'grievance') return;
    else notify(`${id === 'sla' ? 'SLA Monitoring' : 'Joint Inspections'} remains available through the existing Officer workspace.`);
  };

  return (
    <OfficerLayout
      activeNav="grievance"
      searchValue={search}
      onSearchChange={(value) => { setSearch(value); setPage(1); }}
      queueCount={queue.length}
      slaCount={counts.urgent}
      inspectionCount={queue.filter((record) => record.status === 'INSPECTION_SCHEDULED').length}
      notifications={[
        `${counts.urgent} grievance(s) require SLA attention.`,
        `${counts.pending} grievance(s) are pending desk review.`,
        'Prototype records are not live government grievances.',
      ]}
      onNavSelect={handleNav}
      onNotice={notify}
    >
      <div className="mb-5">
        <nav aria-label="Breadcrumb" className="flex text-xs text-slate-500 space-x-2 mb-1.5"><span>Portal</span><span>›</span><span className="text-[#0F2038] font-semibold">RTS Grievance Desk</span></nav>
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <h2 className="text-xl sm:text-2xl font-bold text-[#0F2038] tracking-tight">RTS Grievance Desk</h2>
            <p className="text-xs text-slate-600 mt-0.5">Grievance redressal and first / second appellate authority review under RTS Sec. 19</p>
            <p className="text-[10px] text-amber-700 font-semibold mt-1">Deterministic prototype records — not live government grievances</p>
          </div>
          <div className="text-right text-[11px] text-slate-500">Officer: <strong className="text-slate-700">{name}</strong><br />Reference desk: <strong>13 Dec 2024</strong></div>
        </div>
      </div>

      <section aria-label="Grievance summary" className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        {[
          ['Total Grievances', counts.total, 'Current RTS register', 'text-[#0F2038]'],
          ['Pending / Assigned', counts.pending, 'Awaiting desk action', 'text-amber-700'],
          ['Approaching / Overdue', counts.urgent, 'SLA escalation queue', 'text-rose-700'],
          ['Resolved', counts.resolved, 'Closed after review', 'text-emerald-700'],
        ].map(([label, value, detail, tone]) => <div key={label} className="bg-white rounded-lg p-4 border border-slate-200 shadow-sm"><div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</div><div className={`text-2xl font-bold mt-1 ${tone}`}>{value}</div><p className="text-[10px] text-slate-500 mt-1">{detail}</p></div>)}
      </section>

      <section className="bg-white rounded-lg border border-slate-200 shadow-sm mb-5">
        <div className="flex flex-wrap border-b border-slate-200 px-3" role="tablist" aria-label="Grievance status filters">
          {([['all', 'All Grievances'], ['PENDING_SCRUTINY', 'Pending Scrutiny'], ['APPROACHING_SLA', 'SLA Attention'], ['RESOLVED', 'Resolved'], ['ESCALATED', 'Appeals / Escalated']] as Array<[GrievanceFilter, string]>).map(([value, label]) => <button key={value} type="button" role="tab" aria-selected={filter === value} onClick={() => { setFilter(value); setPage(1); }} className={`px-3 py-2.5 text-xs font-semibold border-b-2 ${filter === value ? 'border-[#142A4A] text-[#142A4A]' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>{label}</button>)}
        </div>
        <div className="p-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
          <label className="block font-semibold text-slate-700">Category<select aria-label="Grievance category" value={category} onChange={(e) => { setCategory(e.target.value); setPage(1); }} className="block w-full mt-1 rounded border border-slate-300 py-1.5 px-1 bg-slate-50">{CATEGORY_OPTIONS.map((option) => <option key={option}>{option}</option>)}</select></label>
          <label className="block font-semibold text-slate-700">Department<select aria-label="Grievance department" value={department} onChange={(e) => { setDepartment(e.target.value); setPage(1); }} className="block w-full mt-1 rounded border border-slate-300 py-1.5 px-1 bg-slate-50">{DEPARTMENT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          <label className="block font-semibold text-slate-700">SLA view<select aria-label="Grievance SLA view" value={slaView} onChange={(e) => { setSlaView(e.target.value); setPage(1); }} className="block w-full mt-1 rounded border border-slate-300 py-1.5 px-1 bg-slate-50"><option value="all">All SLA states</option><option value="urgent">Approaching / Overdue</option><option value="resolved">Resolved / Closed</option></select></label>
          <div className="flex items-end"><button type="button" onClick={() => notify('Grievance detail remains a manual Officer review prototype.')} className="w-full rounded bg-[#142A4A] text-white px-3 py-2 font-semibold hover:bg-[#1B365D] focus:outline-none focus:ring-2 focus:ring-[#1B365D]">Review Queue</button></div>
        </div>
      </section>

      <section className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden" data-purpose="rts-grievance-queue">
        <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-3"><div><h3 className="font-bold text-sm text-[#0F2038]">RTS Grievance &amp; Appeal Queue</h3><p className="text-[11px] text-slate-500">Applicant references, service concerns, statutory due dates and current desk status</p></div><span className="text-[10px] font-semibold text-slate-500">RTS Sec. 19 review</span></div>
        <div className="overflow-x-auto"><table className="w-full min-w-[1100px] text-left text-xs"><thead className="bg-slate-100 text-[11px] uppercase font-bold text-slate-700"><tr><th className="py-2.5 px-3">Grievance Ref.</th><th className="py-2.5 px-3">Applicant / Enterprise</th><th className="py-2.5 px-3">Service / Department</th><th className="py-2.5 px-3">Category</th><th className="py-2.5 px-3">Received / Due</th><th className="py-2.5 px-3">Status</th><th className="py-2.5 px-3">Officer</th><th className="py-2.5 px-3 text-center">Action</th></tr></thead><tbody className="divide-y divide-slate-200">{rows.map((item) => <tr key={item.id} className="hover:bg-slate-50"><td className="py-2.5 px-3 font-bold text-[#142A4A]">{item.id}<div className="text-[10px] font-normal text-slate-500">{item.applicationNo}</div></td><td className="py-2.5 px-3"><div className="font-semibold">{item.applicant}</div><div className="text-[10px] text-slate-500">{item.enterprise}</div></td><td className="py-2.5 px-3"><div>{item.service}</div><div className="text-[10px] text-slate-500">{item.department}</div></td><td className="py-2.5 px-3">{item.category}</td><td className="py-2.5 px-3 font-mono text-[11px]">{item.receivedOn}<br /><span className="text-slate-500">{item.dueOn}</span></td><td className="py-2.5 px-3"><span className={`px-2 py-0.5 rounded-full border text-[10px] font-semibold ${STATUS_CLASS[item.status]}`}>{STATUS_LABEL[item.status]}</span></td><td className="py-2.5 px-3">{item.assignee}</td><td className="py-2.5 px-3 text-center"><button type="button" onClick={() => notify(`${item.id} selected for manual Officer review.`)} className="text-blue-700 font-semibold hover:underline focus:outline-none focus:ring-2 focus:ring-[#1B365D] rounded">View</button></td></tr>)}{rows.length === 0 && <tr><td colSpan={8} className="py-8 text-center text-slate-500">No grievances match the selected filters.</td></tr>}</tbody></table></div>
        <div className="px-4 py-2 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-[11px] text-slate-500"><span>Showing {rows.length ? (safePage - 1) * GRIEVANCE_PAGE_SIZE + 1 : 0}-{Math.min(safePage * GRIEVANCE_PAGE_SIZE, filtered.length)} of {filtered.length} records</span><div className="flex gap-1"><button type="button" disabled={safePage === 1} onClick={() => setPage(safePage - 1)} className="px-2 py-0.5 border rounded disabled:text-slate-300">Previous</button><span className="px-2 py-0.5 bg-[#142A4A] text-white rounded">{safePage}</span><button type="button" disabled={safePage === pageCount} onClick={() => setPage(safePage + 1)} className="px-2 py-0.5 border rounded disabled:text-slate-300">Next</button></div></div>
      </section>
      {notice && <div role="status" className="fixed right-5 bottom-5 z-50 bg-[#142A4A] text-white rounded-lg shadow-xl px-4 py-3 text-xs font-semibold">{notice}</div>}
    </OfficerLayout>
  );
};
