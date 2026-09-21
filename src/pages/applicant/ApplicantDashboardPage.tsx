import React, { useState } from 'react';
import { ApplicantLayout } from '../../components/layout/ApplicantLayout';
import { SlaTimelineCard } from '../../components/applicant/SlaTimelineCard';
import { applicantService } from '../../services/applicantService';
import { ApplicantApplication } from '../../types/applicant';
import { Link, useRouter } from '../../router/Router';

export const ApplicantDashboardPage: React.FC = () => {
  const { navigate } = useRouter();
  const profile = applicantService.getProfile();
  const kpis = applicantService.getDashboardKPIs();
  const applications = applicantService.getApplications();
  const enterprises = applicantService.getEnterprises();
  const activities = applicantService.getActivities();

  const [statusFilter, setStatusFilter] = useState<'ALL' | 'UNDER_SCRUTINY' | 'APPROVED' | 'QUERY'>('ALL');
  const [selectedApp, setSelectedApp] = useState<ApplicantApplication | null>(null);

  const filteredApplications = applications.filter((app) => {
    if (statusFilter === 'UNDER_SCRUTINY') return app.status === 'Under Scrutiny';
    if (statusFilter === 'APPROVED') return app.status === 'Approved';
    if (statusFilter === 'QUERY') return app.status === 'Query Raised';
    return true;
  });

  return (
    <ApplicantLayout
      activeTab="dashboard"
      breadcrumbs={[{ label: 'Dashboard' }]}
    >
      <div className="space-y-6">
        {/* 1. Applicant Identity & Welcome Banner */}
        <section
          className="bg-gradient-to-r from-[#0f2b48] via-[#163a5f] to-[#1e4d7d] rounded-2xl text-white p-5 sm:p-7 shadow-sm relative overflow-hidden"
          aria-label="Applicant Welcome Dossier"
        >
          {/* Background watermark badge */}
          <div className="absolute -right-8 -bottom-8 opacity-10 text-9xl font-serif select-none pointer-events-none">
            🏛️
          </div>

          <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-5">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-400/30 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  Aadhaar e-KYC Verified
                </span>
                <span className="text-slate-300 text-xs">•</span>
                <span className="text-xs text-slate-200">
                  Single Business ID:{' '}
                  <strong className="font-mono text-amber-300 bg-white/10 px-2 py-0.5 rounded">
                    {profile.singleBusinessId}
                  </strong>
                </span>
              </div>

              <h1 className="text-2xl sm:text-3xl font-bold font-serif tracking-tight text-white">
                Welcome, {profile.name}
              </h1>

              <p className="text-sm text-slate-200 max-w-2xl leading-relaxed">
                Authorized Signatory &amp; {profile.designation} of{' '}
                <strong className="text-white underline decoration-amber-400/60 font-semibold">
                  {enterprises[0]?.name || 'Deshmukh Industries Pvt. Ltd.'}
                </strong>
                . Manage your industrial projects, statutory clearings, and delegated legal representatives.
              </p>
            </div>

            {/* Quick Actions Bar */}
            <div className="flex flex-wrap items-center gap-2.5 sm:self-start lg:self-center">
              <button
                type="button"
                onClick={() => navigate('/applicant/applications')}
                className="px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow transition flex items-center gap-1.5 cursor-pointer"
              >
                <span>📋 Track Applications</span>
              </button>
              <button
                type="button"
                onClick={() => navigate('/applicant/approvals/find')}
                className="px-4 py-2.5 rounded-xl bg-[#f58220] hover:bg-[#e07210] text-white text-xs font-bold shadow transition flex items-center gap-1.5 cursor-pointer"
              >
                <span>⚡ Find Approvals</span>
              </button>
              <button
                type="button"
                onClick={() => navigate('/applicant/applications/cte')}
                className="px-4 py-2.5 rounded-xl bg-white/25 hover:bg-white/35 text-white text-xs font-bold border border-white/30 transition flex items-center gap-1.5 cursor-pointer shadow-2xs"
              >
                <span>📝 Apply for CTE</span>
              </button>
              <button
                type="button"
                onClick={() => navigate('/applicant/compliance')}
                className="px-4 py-2.5 rounded-xl bg-amber-500/80 hover:bg-amber-500 text-white text-xs font-bold border border-amber-300/30 transition flex items-center gap-1.5 cursor-pointer shadow-2xs"
              >
                <span>⚠️ Compliance Center</span>
              </button>
              <button
                type="button"
                onClick={() => navigate('/applicant/documents')}
                className="px-4 py-2.5 rounded-xl bg-white/20 hover:bg-white/30 text-white text-xs font-bold border border-white/30 transition flex items-center gap-1.5 cursor-pointer"
              >
                <span>📁 Document Vault</span>
              </button>
              <button
                type="button"
                onClick={() => navigate('/applicant/enterprises')}
                className="px-4 py-2.5 rounded-xl bg-white/15 hover:bg-white/25 text-white text-xs font-semibold border border-white/20 transition flex items-center gap-1.5 cursor-pointer"
              >
                <span>🏭 Manage Projects</span>
              </button>
              <button
                type="button"
                onClick={() => navigate('/applicant/representatives')}
                className="px-3.5 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-semibold border border-white/20 transition flex items-center gap-1.5 cursor-pointer"
              >
                <span>👥 Delegates</span>
              </button>
              <button
                type="button"
                onClick={() => navigate('/applicant/profile')}
                className="px-3 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-semibold border border-white/20 transition flex items-center gap-1 cursor-pointer"
                title="Account Settings"
              >
                <span>⚙️ Profile</span>
              </button>
            </div>
          </div>
        </section>

        {/* 2. Deterministic KPI Summary Cards */}
        <section aria-label="Key Performance Indicators" className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          {/* Card 1: Total Applications */}
          <div className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5 shadow-2xs hover:border-slate-300 transition">
            <div className="flex items-center justify-between text-slate-500 mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider">Total Filings</span>
              <span className="p-2 rounded-lg bg-blue-50 text-blue-700 text-sm">📂</span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl sm:text-3xl font-extrabold text-slate-900 font-serif">
                {kpis.totalApplications}
              </span>
              <span className="text-xs font-medium text-slate-500">Applications</span>
            </div>
            <p className="text-[11px] text-slate-500 mt-2">Across 2 Industrial Undertakings</p>
          </div>

          {/* Card 2: Under Scrutiny */}
          <div className="bg-white rounded-xl border border-blue-200 p-4 sm:p-5 shadow-2xs hover:border-blue-300 transition bg-gradient-to-br from-white to-blue-50/40">
            <div className="flex items-center justify-between text-blue-700 mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider">Under Scrutiny</span>
              <span className="p-2 rounded-lg bg-blue-100 text-blue-800 text-sm">⏳</span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl sm:text-3xl font-extrabold text-blue-900 font-serif">
                {kpis.underScrutiny}
              </span>
              <span className="text-xs font-semibold text-blue-700">In Process</span>
            </div>
            <p className="text-[11px] text-blue-600/90 mt-2">MPCB, DISH, Revenue Cell</p>
          </div>

          {/* Card 3: Approved / Issued */}
          <div className="bg-white rounded-xl border border-emerald-200 p-4 sm:p-5 shadow-2xs hover:border-emerald-300 transition bg-gradient-to-br from-white to-emerald-50/40">
            <div className="flex items-center justify-between text-emerald-700 mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider">Approved &amp; Issued</span>
              <span className="p-2 rounded-lg bg-emerald-100 text-emerald-800 text-sm">✓</span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl sm:text-3xl font-extrabold text-emerald-900 font-serif">
                {kpis.approvedIssued}
              </span>
              <span className="text-xs font-semibold text-emerald-700">Granted</span>
            </div>
            <p className="text-[11px] text-emerald-600/90 mt-2">MSEDCL, MIDC Water, Boilers</p>
          </div>

          {/* Card 4: Clarifications Required */}
          <div className="bg-white rounded-xl border border-amber-200 p-4 sm:p-5 shadow-2xs hover:border-amber-300 transition bg-gradient-to-br from-white to-amber-50/40">
            <div className="flex items-center justify-between text-amber-700 mb-2">
              <span className="text-xs font-semibold uppercase tracking-wider">Clarifications</span>
              <span className="p-2 rounded-lg bg-amber-100 text-amber-800 text-sm">⚠️</span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl sm:text-3xl font-extrabold text-amber-900 font-serif">
                {kpis.clarificationsRequired}
              </span>
              <span className="text-xs font-bold text-amber-700 animate-pulse">Action Needed</span>
            </div>
            <p className="text-[11px] text-amber-700 mt-2">DISH Building Plan Inquiry</p>
          </div>
        </section>

        {/* 3. Main Dashboard Two-Column Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left 2 Cols: Statutory Timelines & Recent Applications */}
          <div className="lg:col-span-2 space-y-6">
            {/* Section A: Active Statutory Timelines & Scrutiny (Reusable SLA Card) */}
            <section className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 shadow-2xs">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-5">
                <div>
                  <h2 className="text-lg font-bold text-slate-900 font-serif flex items-center gap-2">
                    <span>⏱️</span> Statutory SLA &amp; Scrutiny Tracker
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Guaranteed processing under the Maharashtra Right to Public Services Act, 2015.
                  </p>
                </div>
                <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-50 text-blue-800 border border-blue-200 self-start">
                  Active Monitoring
                </span>
              </div>

              <div className="grid grid-cols-1 gap-4">
                {applications
                  .filter((a) => a.status === 'Under Scrutiny' || a.status === 'Query Raised')
                  .slice(0, 3)
                  .map((app) => (
                    <SlaTimelineCard
                      key={app.id}
                      application={app}
                      onViewDetails={() => setSelectedApp(app)}
                    />
                  ))}
              </div>
            </section>

            {/* Section B: All Recent Applications & Status Filter */}
            <section className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 shadow-2xs">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-bold text-slate-900 font-serif">
                      Recent Applications &amp; Clearances
                    </h2>
                    <Link
                      to="/applicant/applications"
                      className="text-xs font-semibold text-blue-700 hover:underline"
                    >
                      (Open Multi-Department Tracker &rarr;)
                    </Link>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Complete statutory filings registered under Single Business ID.
                  </p>
                </div>

                {/* Filter Tabs */}
                <div className="flex items-center bg-slate-100 p-1 rounded-lg text-xs font-semibold">
                  <button
                    type="button"
                    onClick={() => setStatusFilter('ALL')}
                    className={`px-3 py-1.5 rounded-md transition ${
                      statusFilter === 'ALL'
                        ? 'bg-white text-slate-900 shadow-2xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    All ({applications.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setStatusFilter('UNDER_SCRUTINY')}
                    className={`px-3 py-1.5 rounded-md transition ${
                      statusFilter === 'UNDER_SCRUTINY'
                        ? 'bg-white text-blue-900 shadow-2xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Scrutiny ({kpis.underScrutiny})
                  </button>
                  <button
                    type="button"
                    onClick={() => setStatusFilter('APPROVED')}
                    className={`px-3 py-1.5 rounded-md transition ${
                      statusFilter === 'APPROVED'
                        ? 'bg-white text-emerald-900 shadow-2xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Approved ({kpis.approvedIssued})
                  </button>
                  <button
                    type="button"
                    onClick={() => setStatusFilter('QUERY')}
                    className={`px-3 py-1.5 rounded-md transition ${
                      statusFilter === 'QUERY'
                        ? 'bg-white text-amber-900 shadow-2xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Query ({kpis.clarificationsRequired})
                  </button>
                </div>
              </div>

              {/* Table / List */}
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs text-slate-600">
                  <thead className="bg-slate-50 text-slate-700 font-semibold border-y border-slate-200">
                    <tr>
                      <th className="py-2.5 px-3">Application Ref</th>
                      <th className="py-2.5 px-3">Approval Name &amp; Dept</th>
                      <th className="py-2.5 px-3">Project</th>
                      <th className="py-2.5 px-3">Status</th>
                      <th className="py-2.5 px-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredApplications.map((app) => (
                      <tr key={app.id} className="hover:bg-slate-50/80 transition">
                        <td className="py-3 px-3">
                          <span className="font-mono font-bold text-blue-900 block">
                            {app.appRefNumber}
                          </span>
                          <span className="text-[10px] text-slate-400">{app.submittedDate}</span>
                        </td>
                        <td className="py-3 px-3">
                          <span className="font-semibold text-slate-900 block max-w-[220px] truncate">
                            {app.approvalName}
                          </span>
                          <span className="text-[11px] text-slate-500 block max-w-[220px] truncate">
                            {app.department}
                          </span>
                        </td>
                        <td className="py-3 px-3 max-w-[150px] truncate text-slate-700">
                          {app.projectName}
                        </td>
                        <td className="py-3 px-3">
                          {app.status === 'Approved' && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-[10.5px] font-bold bg-emerald-100 text-emerald-800">
                              Approved
                            </span>
                          )}
                          {app.status === 'Under Scrutiny' && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-[10.5px] font-bold bg-blue-100 text-blue-800">
                              Under Scrutiny
                            </span>
                          )}
                          {app.status === 'Query Raised' && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-[10.5px] font-bold bg-amber-100 text-amber-900">
                              Query Raised
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-3 text-right">
                          <button
                            type="button"
                            onClick={() => setSelectedApp(app)}
                            className="px-2.5 py-1 text-xs font-semibold text-blue-700 hover:text-blue-900 hover:bg-blue-50 rounded border border-blue-200 transition cursor-pointer"
                          >
                            View
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>

          {/* Right Col: Registered Enterprises Summary & Portal Activity */}
          <div className="space-y-6">
            {/* Section C: Registered Enterprises Quick Cards */}
            <section className="bg-white rounded-2xl border border-slate-200 p-5 shadow-2xs">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold text-slate-900 font-serif text-base flex items-center gap-1.5">
                  <span>🏭</span> Registered Enterprises
                </h3>
                <Link
                  to="/applicant/enterprises"
                  className="text-xs font-bold text-blue-700 hover:underline"
                >
                  Manage All ›
                </Link>
              </div>

              <div className="space-y-3">
                {enterprises.map((ent) => (
                  <div
                    key={ent.id}
                    className="p-3.5 rounded-xl border border-slate-200 hover:border-blue-300 hover:bg-blue-50/20 transition cursor-pointer"
                    onClick={() => navigate('/applicant/enterprises')}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <h4 className="font-bold text-xs text-slate-900 leading-snug">
                        {ent.name}
                      </h4>
                      {ent.isPrimary && (
                        <span className="px-1.5 py-0.2 rounded text-[9.5px] font-bold bg-amber-100 text-amber-800 border border-amber-200 shrink-0">
                          Primary
                        </span>
                      )}
                    </div>

                    <div className="mt-2 text-[11px] text-slate-500 space-y-1">
                      <div className="flex justify-between">
                        <span>Classification:</span>
                        <span className="font-medium text-slate-700">{ent.category} Enterprise</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Industrial Projects:</span>
                        <span className="font-bold text-blue-900">{ent.projectsCount || 0} Registered</span>
                      </div>
                      <div className="flex justify-between">
                        <span>District:</span>
                        <span className="font-medium text-slate-700">{ent.district}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <button
                type="button"
                onClick={() => navigate('/applicant/enterprises')}
                className="w-full mt-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition flex items-center justify-center gap-1 cursor-pointer"
              >
                <span>+ Register New Industrial Project</span>
              </button>
            </section>

            {/* Section D: Recent Portal Activity Log */}
            <section className="bg-white rounded-2xl border border-slate-200 p-5 shadow-2xs">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold text-slate-900 font-serif text-base flex items-center gap-1.5">
                  <span>🔔</span> Portal Activity Stream
                </h3>
                <span className="text-[11px] text-slate-400 font-medium">Real-time</span>
              </div>

              <div className="flow-root">
                <ul className="-mb-4 divide-y divide-slate-100 text-xs">
                  {activities.map((act) => (
                    <li key={act.id} className="py-3 flex gap-3">
                      <div className="mt-0.5">
                        {act.type === 'QUERY' && <span className="text-amber-500 text-sm">⚠️</span>}
                        {act.type === 'APPROVAL' && <span className="text-emerald-600 text-sm">✓</span>}
                        {act.type === 'SUBMISSION' && <span className="text-blue-600 text-sm">📋</span>}
                        {act.type === 'INSPECTION' && <span className="text-purple-600 text-sm">🔍</span>}
                        {act.type === 'SECURITY' && <span className="text-slate-600 text-sm">🛡️</span>}
                      </div>
                      <div className="flex-1 space-y-0.5">
                        <p className="font-semibold text-slate-800 leading-tight">
                          {act.title}
                        </p>
                        <p className="text-[11px] text-slate-500 leading-normal">
                          {act.description}
                        </p>
                        <p className="text-[10px] text-slate-400 pt-0.5 font-medium">
                          {act.timestamp}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          </div>
        </div>

        {/* 4. Application Details Modal */}
        {selectedApp && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs"
            role="dialog"
            aria-modal="true"
          >
            <div className="bg-white rounded-2xl max-w-xl w-full p-6 shadow-2xl border border-slate-200 space-y-5 animate-in fade-in duration-200">
              <div className="flex items-start justify-between border-b border-slate-100 pb-3">
                <div>
                  <span className="font-mono text-xs font-bold text-blue-900 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
                    {selectedApp.appRefNumber}
                  </span>
                  <h3 className="text-base font-bold text-slate-900 mt-1.5 font-serif">
                    {selectedApp.approvalName}
                  </h3>
                  <p className="text-xs text-slate-500">{selectedApp.department}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedApp(null)}
                  className="text-slate-400 hover:text-slate-700 p-1 rounded-lg"
                  aria-label="Close modal"
                >
                  ✕
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs bg-slate-50 p-3.5 rounded-xl border border-slate-100">
                <div>
                  <span className="text-slate-500 block">Enterprise:</span>
                  <span className="font-semibold text-slate-800">{selectedApp.enterpriseName}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Project:</span>
                  <span className="font-semibold text-slate-800">{selectedApp.projectName}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Submission Date:</span>
                  <span className="font-semibold text-slate-800">{selectedApp.submittedDate}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">SLA Target Date:</span>
                  <span className="font-semibold text-slate-800">{selectedApp.slaTargetDate}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Current Officer:</span>
                  <span className="font-semibold text-slate-800">{selectedApp.currentOfficer || 'Single Window Cell'}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Statutory SLA:</span>
                  <span className="font-semibold text-slate-800">{selectedApp.slaTotalDays} Working Days</span>
                </div>
              </div>

              <div className="text-xs text-slate-600 bg-blue-50/50 p-3 rounded-xl border border-blue-100">
                <p className="font-semibold text-blue-950 mb-1">Status Summary</p>
                <p>
                  Current filing status is marked as <strong>{selectedApp.status}</strong>. All inter-departmental queries and clearances are bound by Section 10 of the Maharashtra Right to Public Services Act.
                </p>
              </div>

              <div className="flex justify-end space-x-3 pt-2">
                <button
                  type="button"
                  onClick={() => setSelectedApp(null)}
                  className="px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded-xl transition"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedApp(null);
                    navigate('/applicant/enterprises');
                  }}
                  className="px-4 py-2 text-xs font-bold text-white bg-[#0f2b48] hover:bg-[#163a5f] rounded-xl transition shadow"
                >
                  Go to Project Details ›
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </ApplicantLayout>
  );
};
