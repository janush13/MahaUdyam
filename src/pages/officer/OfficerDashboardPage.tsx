import React, { useMemo, useState } from 'react';
import { useRouter } from '../../router/Router';
import { useAuth } from '../../context/AuthContext';
import { OfficerLayout, OfficerNavId } from '../../components/layout/OfficerLayout';
import {
  DESK_STATUS_LABEL,
  OFFICER_UPDATED_AT,
  SLA_RISK_LABEL,
  daysLeftLabel,
  officerQueueService,
} from '../../services/officerQueueService';
import { OfficerQueueRecord } from '../../types/officer';

type QueueFilter = 'all' | 'urgent' | 'inspection' | 'decision';

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

export const OfficerDashboardPage: React.FC = () => {
  const { user: authUser } = useAuth();
  const { navigate } = useRouter();
  const allRecords = useMemo(() => officerQueueService.getQueue(), []);
  const summary = useMemo(() => officerQueueService.getSlaSummary(allRecords), [allRecords]);
  const [filter, setFilter] = useState<QueueFilter>('all');
  const [search, setSearch] = useState('');
  const [notice, setNotice] = useState('');

  const filteredRecords = useMemo(() => {
    const term = search.trim().toLowerCase();
    return officerQueueService.sortByUrgency(allRecords).filter((record) => {
      const matchesFilter =
        filter === 'all' ||
        (filter === 'urgent' && (record.slaRisk === 'BREACHED' || record.slaRisk === 'NEAR_BREACH')) ||
        (filter === 'inspection' && record.status === 'INSPECTION_SCHEDULED') ||
        (filter === 'decision' && record.status === 'DECISION_PENDING');
      const matchesSearch = !term || [
        record.applicationNo,
        record.enterpriseName,
        record.location,
        record.approvalName,
        record.deptName,
      ].join(' ').toLowerCase().includes(term);
      return matchesFilter && matchesSearch;
    });
  }, [allRecords, filter, search]);

  const notify = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(''), 2800);
  };

  const handleNav = (id: OfficerNavId) => {
    if (id === 'dashboard') return;
    if (id === 'queue') {
      navigate('/officer/queue');
      return;
    }
    if (id === 'inspections') {
      navigate('/officer/queue');
      notify('Application Queue opened with the inspection workload available for review.');
      return;
    }
    if (id === 'reports') {
      navigate('/officer/reports');
      return;
    }
    if (id === 'grievance') {
      navigate('/officer/grievances');
      return;
    }
    notify(`${id === 'sla' ? 'SLA Monitoring' : id === 'reports' ? 'Statutory Reports' : 'RTS Grievance Desk'} is available through the existing Officer workspace.`);
  };

  const openRecord = (applicationNo: string) => {
    navigate(`/officer/workspace?application=${encodeURIComponent(applicationNo)}`);
  };

  const officerName = authUser?.name || 'Officer';
  const notifications = [
    `${summary.nearBreach + summary.breached} application(s) require urgent SLA attention.`,
    `${summary.inspections} application(s) have a joint inspection scheduled.`,
    'RTS scrutiny timelines remain governed by Maharashtra RTS Act 2015.',
  ];

  return (
    <OfficerLayout
      activeNav="dashboard"
      searchValue={search}
      onSearchChange={setSearch}
      queueCount={summary.totalActive}
      slaCount={summary.approaching + summary.nearBreach + summary.breached}
      inspectionCount={summary.inspections}
      notifications={notifications}
      onNavSelect={handleNav}
      onNotice={notify}
    >
      <div className="mb-5" data-purpose="officer-dashboard-header">
        <nav aria-label="Breadcrumb" className="flex text-xs text-slate-500 space-x-2 mb-1.5">
          <span>Portal</span><span>›</span><span className="text-[#0F2038] font-semibold">Dashboard Overview</span>
        </nav>
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <h2 className="text-xl sm:text-2xl font-bold text-[#0F2038] tracking-tight">Officer Desk Dashboard</h2>
            <p className="text-xs text-slate-600 mt-0.5">Scrutiny and statutory review under Maharashtra Right to Public Services Act (RTSA) 2015 • Industries Department</p>
          </div>
          <div className="text-right text-[11px] text-slate-500">Welcome, <strong className="text-slate-700">{officerName}</strong><br />Updated: <strong>{OFFICER_UPDATED_AT}</strong></div>
        </div>
      </div>

      <section aria-label="Officer workload summary" className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-5">
        {[
          ['Active Applications', summary.totalActive, 'Assigned to this scrutiny desk', 'text-[#0F2038]'],
          ['Within SLA', summary.withinSla, 'Normal / compliant timeline', 'text-emerald-700'],
          ['Approaching SLA', summary.approaching, '3–5 working days remaining', 'text-amber-700'],
          ['Near Breach / Breached', summary.nearBreach + summary.breached, 'Requires immediate action', 'text-rose-700'],
          ['Joint Inspections', summary.inspections, 'Inspection scheduled', 'text-teal-700'],
        ].map(([label, value, detail, tone]) => (
          <div key={label} className="bg-white border border-slate-200 rounded-md shadow-sm p-3">
            <div className="text-[10px] font-bold tracking-wider uppercase text-slate-500">{label}</div>
            <div className={`text-2xl font-bold mt-1 ${tone}`}>{value}</div>
            <div className="text-[10px] text-slate-500 mt-1">{detail}</div>
          </div>
        ))}
      </section>

      <section className="bg-white border border-slate-200 rounded-md shadow-sm p-4 mb-5" aria-labelledby="sla-heading">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <h3 id="sla-heading" className="font-bold text-sm text-[#0F2038]">SLA Compliance Status</h3>
            <p className="text-[11px] text-slate-500">Application scrutiny risk across the Pune Division (Zone II) desk</p>
          </div>
          <button type="button" onClick={() => navigate('/officer/queue')} className="text-xs font-semibold text-blue-700 hover:underline focus:outline-none focus:ring-2 focus:ring-[#1B365D] rounded">Open Application Queue →</button>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
          {[
            ['Within SLA', summary.withinSla, 'bg-emerald-600'],
            ['Approaching', summary.approaching, 'bg-amber-500'],
            ['Near Breach', summary.nearBreach, 'bg-orange-500'],
            ['Breached', summary.breached, 'bg-rose-600'],
          ].map(([label, value, bar]) => (
            <div key={label} className="border border-slate-200 rounded p-2.5">
              <div className="flex justify-between text-xs font-semibold text-slate-700"><span>{label}</span><span>{value}</span></div>
              <div className="h-1.5 bg-slate-200 rounded-full mt-2 overflow-hidden"><div className={`h-full ${bar}`} style={{ width: `${summary.totalActive ? Math.max(8, Number(value) / summary.totalActive * 100) : 0}%` }} /></div>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-white border border-slate-200 rounded-md shadow-sm overflow-hidden" data-purpose="officer-dashboard-queue">
        <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div><h3 className="font-bold text-sm text-[#0F2038]">Priority Application Queue</h3><p className="text-[11px] text-slate-500">Applications requiring scrutiny, clarification, inspection, or decision action</p></div>
          <div className="flex flex-wrap gap-1" role="tablist" aria-label="Dashboard queue filters">
            {([
              ['all', 'All Active'],
              ['urgent', 'Urgent SLA'],
              ['inspection', 'Inspections'],
              ['decision', 'Decision Pending'],
            ] as Array<[QueueFilter, string]>).map(([value, label]) => (
              <button key={value} type="button" role="tab" aria-selected={filter === value} onClick={() => setFilter(value)} className={`px-2.5 py-1 text-[11px] rounded ${filter === value ? 'bg-[#142A4A] text-white font-bold' : 'text-slate-600 hover:bg-slate-200'}`}>{label}</button>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-xs">
            <thead className="bg-slate-100 text-[11px] uppercase font-bold text-slate-700">
              <tr><th className="py-2.5 px-3">Application No.</th><th className="py-2.5 px-3">Enterprise / Location</th><th className="py-2.5 px-3">Approval &amp; Department</th><th className="py-2.5 px-3">SLA Risk</th><th className="py-2.5 px-3">Status</th><th className="py-2.5 px-3 text-center">Action</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {filteredRecords.slice(0, 6).map((record) => (
                <tr key={record.applicationNo} className="hover:bg-slate-50">
                  <td className="py-2.5 px-3 font-bold text-[#142A4A]">{record.applicationNo}</td>
                  <td className="py-2.5 px-3"><div className="font-semibold text-slate-800">{record.enterpriseName}</div><div className="text-[10px] text-slate-500">{record.location}</div></td>
                  <td className="py-2.5 px-3"><div>{record.approvalName}</div><div className="text-[10px] text-slate-500">{record.deptName}</div></td>
                  <td className="py-2.5 px-3"><span className={`inline-block border rounded px-2 py-0.5 text-[10px] font-bold ${riskClasses[record.slaRisk]}`}>{SLA_RISK_LABEL[record.slaRisk]} · {daysLeftLabel(record.daysLeft)}</span></td>
                  <td className="py-2.5 px-3"><span className={`inline-block border rounded-full px-2 py-0.5 text-[10px] font-semibold ${statusClasses[record.status]}`}>{DESK_STATUS_LABEL[record.status]}</span></td>
                  <td className="py-2.5 px-3 text-center"><button type="button" onClick={() => openRecord(record.applicationNo)} className="text-blue-700 font-semibold hover:underline focus:outline-none focus:ring-2 focus:ring-[#1B365D] rounded">Open</button></td>
                </tr>
              ))}
              {filteredRecords.length === 0 && <tr><td colSpan={6} className="py-8 text-center text-slate-500">No applications match this dashboard filter.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-2 bg-slate-50 border-t border-slate-200 flex justify-between text-[11px] text-slate-500"><span>Showing {Math.min(6, filteredRecords.length)} of {filteredRecords.length} matching applications</span><button type="button" onClick={() => navigate('/officer/queue')} className="text-blue-700 font-semibold hover:underline">View full queue →</button></div>
      </section>

      {notice && <div role="status" className="fixed right-5 bottom-5 z-50 bg-[#142A4A] text-white rounded-lg shadow-xl px-4 py-3 text-xs font-semibold">{notice}</div>}
    </OfficerLayout>
  );
};
