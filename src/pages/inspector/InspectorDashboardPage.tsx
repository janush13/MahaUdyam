import React, { useMemo, useState } from 'react';
import { useRouter } from '../../router/Router';
import { useAuth } from '../../context/AuthContext';
import { InspectorLayout, InspectorNavId } from '../../components/layout/InspectorLayout';
import { formatDisplayDate } from '../../services/officerQueueService';
import { INSPECTOR_LAST_SYNC, INSPECTOR_PAGE_SIZE, inspectorService } from '../../services/inspectorService';

type StatusFilter = 'all' | 'SCHEDULED' | 'COMPLETED' | 'RESCHEDULED';

const statusLabel: Record<StatusFilter, string> = {
  all: 'All Inspections',
  SCHEDULED: 'Upcoming',
  COMPLETED: 'Completed',
  RESCHEDULED: 'Rescheduled',
};

const statusClasses: Record<string, string> = {
  SCHEDULED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  COMPLETED: 'bg-blue-50 text-blue-700 border-blue-200',
  RESCHEDULED: 'bg-amber-50 text-amber-700 border-amber-200',
};

export const InspectorDashboardPage: React.FC = () => {
  const { user } = useAuth();
  const { navigate } = useRouter();
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');
  const [notice, setNotice] = useState('');

  const inspections = useMemo(() => inspectorService.getInspections(), []);
  const filteredInspections = useMemo(() => {
    const term = search.trim().toLowerCase();
    return inspections.filter((inspection) => {
      const matchesStatus = filter === 'all' || inspection.status === filter;
      const matchesSearch = !term || [
        inspection.id,
        inspection.applicationNo,
        inspection.enterprise,
        inspection.approvalType,
        inspection.locationShort,
      ].join(' ').toLowerCase().includes(term);
      return matchesStatus && matchesSearch;
    });
  }, [filter, inspections, search]);
  const counts = inspectorService.counts(inspections);
  const recentActivity = inspections.filter((inspection) => inspection.status === 'COMPLETED').slice(0, 3);
  const inspectorName = user?.name || 'Inspector';
  const notifications = [
    `${counts.upcoming} inspections are scheduled in your current field jurisdiction.`,
    'Digital submission generates an immutable RTS audit entry.',
    'Photographs must include timestamp and geo-coordinates under DISH Circular No. 2024/G-12.',
  ];

  const notify = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(''), 3000);
  };

  const openInspection = (id: string) => {
    navigate(inspectorService.routeFor(id));
  };

  const handleNavigation = (id: InspectorNavId) => {
    if (id === 'dashboard') return;
    if (id === 'reports') {
      navigate('/inspector/reports');
      return;
    }
    navigate('/inspector/workspace');
  };

  return (
    <InspectorLayout
      activeNav="dashboard"
      upcomingCount={counts.upcoming}
      notifications={notifications}
      searchValue={search}
      onSearchChange={setSearch}
      onNavSelect={handleNavigation}
      onNotice={notify}
    >
      <div className="flex flex-col md:flex-row md:items-center justify-between pb-2 border-b border-slate-200 gap-3">
        <div>
          <div className="text-xs text-slate-500 flex items-center space-x-1.5">
            <span>Portal</span><span>&gt;</span><span className="text-[#0B2265] font-semibold">Dashboard</span>
          </div>
          <h2 className="text-lg font-bold text-[#0B2265] tracking-tight mt-0.5">Inspector Desk Dashboard</h2>
          <p className="text-xs text-slate-500 mt-0.5">Statutory Field Inspection Management • Pune Division, Zone 4</p>
        </div>
        <div className="text-right text-[11px] text-slate-500">
          <div className="font-semibold text-slate-700">Welcome, {inspectorName}</div>
          <div>Last sync: {INSPECTOR_LAST_SYNC}</div>
        </div>
      </div>

      <div className="bg-blue-50 border-l-4 border-[#0B2265] p-3 rounded text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2 shadow-sm">
        <div><span className="font-bold text-[#0B2265]">Statutory Notice: </span><span className="text-slate-700">Digital submission generates an immutable RTS Audit entry. Photographs must carry timestamp &amp; Geo-coordinates under DISH Circular No. 2024/G-12.</span></div>
        <span className="text-[11px] font-mono font-medium text-slate-500">ID: DISH-INSP-SYS-2024</span>
      </div>

      <section aria-labelledby="workload-heading">
        <div className="flex items-center justify-between mb-2">
          <h3 id="workload-heading" className="font-bold text-sm text-slate-900 tracking-wide uppercase">Inspection Workload Summary</h3>
          <button type="button" onClick={() => navigate('/inspector/workspace')} className="text-xs font-semibold text-[#0B2265] hover:underline focus:outline-none focus:ring-2 focus:ring-[#0B2265] rounded">Open statutory workflow cockpit →</button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          {[
            ['Pending / Upcoming Inspections', counts.upcoming, 'Assigned for field verification', 'text-[#0B2265]'],
            ['Completed Inspections', counts.completed, 'Reports submitted to the RTS trail', 'text-emerald-700'],
            ['Rescheduled Inspections', counts.rescheduled, 'Require schedule follow-up', 'text-amber-700'],
            ['SLA Target', '5 Days', 'Site inspection deadline from scrutiny approval', 'text-[#0B2265]'],
          ].map(([label, value, detail, tone]) => (
            <div key={label} className="bg-white border border-slate-300 rounded shadow-sm p-4">
              <div className="text-[11px] uppercase tracking-wider font-semibold text-slate-500">{label}</div>
              <div className={`text-2xl font-bold mt-1 ${tone}`}>{value}</div>
              <div className="text-[11px] text-slate-500 mt-1">{detail}</div>
            </div>
          ))}
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <section className="lg:col-span-8 bg-white border border-slate-300 rounded shadow-sm overflow-hidden" data-purpose="inspector-queue">
          <div className="px-5 py-3 border-b border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-bold text-sm text-slate-900 tracking-wide uppercase">Inspection Queue</h3>
              <p className="text-[11px] text-slate-500 mt-0.5">Assigned statutory inspections for your field jurisdiction</p>
            </div>
            <div className="flex gap-1" role="tablist" aria-label="Inspection status filter">
              {(['all', 'SCHEDULED', 'COMPLETED', 'RESCHEDULED'] as StatusFilter[]).map((item) => (
                <button key={item} type="button" role="tab" aria-selected={filter === item} onClick={() => setFilter(item)} className={`px-2 py-1 text-[11px] rounded ${filter === item ? 'bg-[#0B2265] text-white font-bold' : 'text-slate-600 hover:bg-slate-200'}`}>{statusLabel[item]}</button>
              ))}
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-xs">
              <thead className="bg-slate-100/80 border-b border-slate-200 text-slate-700 uppercase font-semibold text-[11px]">
                <tr><th className="py-2.5 px-3">Inspection No.</th><th className="py-2.5 px-3">Enterprise</th><th className="py-2.5 px-3">Approval Type</th><th className="py-2.5 px-3">Date &amp; Time</th><th className="py-2.5 px-3">Status</th><th className="py-2.5 px-3 text-center">Action</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {filteredInspections.slice(0, INSPECTOR_PAGE_SIZE).map((inspection) => (
                  <tr key={inspection.id} className="hover:bg-slate-50">
                    <td className="py-2.5 px-3 font-bold text-[#0B2265]">{inspection.id}</td>
                    <td className="py-2.5 px-3"><div className="font-semibold text-slate-800">{inspection.enterprise}</div><div className="text-[10px] text-slate-500">{inspection.locationShort}</div></td>
                    <td className="py-2.5 px-3">{inspection.approvalType}</td>
                    <td className="py-2.5 px-3">{formatDisplayDate(inspection.scheduledOn)}, {inspection.scheduledTime}</td>
                    <td className="py-2.5 px-3"><span className={`inline-block px-2 py-0.5 rounded-full border text-[11px] font-semibold ${statusClasses[inspection.status]}`}>{statusLabel[inspection.status]}</span></td>
                    <td className="py-2.5 px-3 text-center"><button type="button" onClick={() => openInspection(inspection.id)} className="text-[#0B2265] hover:underline font-semibold text-[11px] focus:outline-none focus:ring-2 focus:ring-[#0B2265] rounded">View</button></td>
                  </tr>
                ))}
                {filteredInspections.length === 0 && <tr><td colSpan={6} className="py-8 text-center text-slate-500">No inspections match the selected filter.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-2 border-t border-slate-200 bg-slate-50 text-xs text-slate-500">Showing {Math.min(filteredInspections.length, INSPECTOR_PAGE_SIZE)} of {filteredInspections.length} inspections</div>
        </section>

        <section className="lg:col-span-4 bg-white border border-slate-300 rounded shadow-sm p-4" data-purpose="inspector-sla-summary">
          <div className="flex items-center justify-between border-b border-slate-200 pb-2 mb-3"><div><h3 className="font-bold text-sm text-slate-900">SLA Monitoring</h3><p className="text-[11px] text-slate-500">Maharashtra RTS Act 2015</p></div><span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">On Track</span></div>
          <div className="flex items-end justify-between"><div><div className="text-3xl font-bold text-emerald-700">3.2</div><div className="text-[11px] text-slate-500">Average turnaround days</div></div><div className="text-right"><div className="text-xl font-bold text-[#0B2265]">5 days</div><div className="text-[11px] text-slate-500">Statutory deadline</div></div></div>
          <div className="mt-4"><div className="flex justify-between text-[11px] font-semibold text-slate-600 mb-1"><span>Field verification compliance</span><span>80%</span></div><div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden"><div className="h-full w-4/5 bg-emerald-600" /></div></div>
          <div className="mt-4 p-3 bg-slate-50 border border-slate-200 rounded text-[11px] text-slate-600 leading-relaxed"><strong className="text-slate-800">Assigned Field Jurisdiction</strong><br />Pune Division • Zone 4<br /><span className="text-slate-500">Chakan, Pimpri-Chinchwad &amp; Talegaon Industrial Clusters</span></div>
        </section>
      </div>

      <section className="bg-white border border-slate-300 rounded shadow-sm p-4" data-purpose="recent-inspection-activity">
        <div className="flex items-center justify-between border-b border-slate-200 pb-2 mb-3"><div><h3 className="font-bold text-sm text-slate-900">Recent Inspection Activity</h3><p className="text-[11px] text-slate-500">Statutory reports and field verification actions</p></div><button type="button" onClick={() => navigate('/inspector/reports')} className="text-xs text-[#0B2265] font-semibold hover:underline focus:outline-none focus:ring-2 focus:ring-[#0B2265] rounded">Reports &amp; Archival →</button></div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">{recentActivity.map((inspection) => <button type="button" key={inspection.id} onClick={() => openInspection(inspection.id)} className="text-left border border-slate-200 rounded p-3 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-[#0B2265]"><div className="flex items-center justify-between"><span className="font-bold text-xs text-[#0B2265]">{inspection.id}</span><span className="text-[10px] font-semibold text-emerald-700">Completed</span></div><div className="text-xs font-semibold text-slate-800 mt-2">{inspection.approvalType}</div><div className="text-[11px] text-slate-500 mt-1">{inspection.enterprise}</div><div className="text-[10px] text-slate-400 mt-2">Report submitted {formatDisplayDate(inspection.scheduledOn)}</div></button>)}</div>
      </section>
    </InspectorLayout>
  );
};
