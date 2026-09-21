import React, { useState, useMemo } from 'react';
import { ApplicantLayout } from '../../components/layout/ApplicantLayout';
import { useRouter, Link } from '../../router/Router';
import { trackerService } from '../../services/trackerService';
import { applicantService } from '../../services/applicantService';
import { applicationService } from '../../services/applicationService';
import { DepartmentDossier } from '../../types/tracker';

export const MyApplicationsPage: React.FC = () => {
  const { navigate } = useRouter();

  // Fresh data from services
  const dossiers = useMemo(() => trackerService.getDepartmentDossiers(), []);
  const metrics = useMemo(() => trackerService.getSummaryMetrics(), []);
  const activeProject = useMemo(() => applicantService.getActiveProject(), []);
  const activeEnterprise = useMemo(() => applicantService.getActiveEnterprise(), []);
  const cteApp = useMemo(() => applicationService.getOrCreateDraftApplication(), []);

  // Filter States
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [deptFilter, setDeptFilter] = useState<string>('ALL');
  const [actionOnly, setActionOnly] = useState<boolean>(false);

  // Filtered dossiers
  const filteredDossiers = useMemo(() => {
    return dossiers.filter((d) => {
      // Search
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchNum = d.applicationNumber.toLowerCase().includes(q);
        const matchSvc = d.serviceName.toLowerCase().includes(q);
        const matchDept = d.department.toLowerCase().includes(q);
        const matchStage = d.currentStage.toLowerCase().includes(q);
        if (!matchNum && !matchSvc && !matchDept && !matchStage) {
          return false;
        }
      }

      // Status
      if (statusFilter !== 'ALL' && d.status !== statusFilter) {
        return false;
      }

      // Department
      if (deptFilter !== 'ALL' && d.departmentShort !== deptFilter) {
        return false;
      }

      // Action Required
      if (actionOnly && !d.applicantActionRequired) {
        return false;
      }

      return true;
    });
  }, [dossiers, searchQuery, statusFilter, deptFilter, actionOnly]);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'Approved':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 border border-emerald-300">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-600" />
            Approved &amp; Issued
          </span>
        );
      case 'Under Scrutiny':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-100 text-blue-800 border border-blue-200">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-600 animate-pulse" />
            Under Scrutiny
          </span>
        );
      case 'Query Raised':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-900 border border-amber-300">
            <span>⚠️</span> Clarification Required
          </span>
        );
      case 'Inspection Scheduled':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-indigo-100 text-indigo-800 border border-indigo-200">
            <span>🔍</span> Site Inspection
          </span>
        );
      case 'Draft':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-700 border border-slate-300">
            <span>📝</span> Draft (Incomplete)
          </span>
        );
      default:
        return (
          <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-800">
            {status}
          </span>
        );
    }
  };

  return (
    <ApplicantLayout
      activeTab="applications"
      breadcrumbs={[
        { label: 'Applicant Portal', href: '/applicant/dashboard' },
        { label: 'My Applications & Clearances' },
      ]}
    >
      <div className="space-y-6 max-w-7xl mx-auto" data-purpose="screen-24-my-applications-tracker">
        {/* Top Institutional Header */}
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-2xs">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-[#0b2540] text-white uppercase tracking-wider">
                  MahaUdyam One Single Window
                </span>
                <span className="text-xs text-slate-500 font-medium">
                  CIN: {activeEnterprise.cinOrLlpin}
                </span>
              </div>
              <h1 className="text-2xl font-serif font-bold text-slate-900 mt-1">
                My Applications &amp; Statutory Dossiers
              </h1>
              <p className="text-sm text-slate-600 mt-0.5">
                Centralized multi-department tracking, SLA countdowns, technical query response center, and inspection coordination.
              </p>
            </div>

            <div className="flex items-center gap-2.5">
              <Link
                to="/applicant/compliance"
                className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-semibold bg-amber-50 text-amber-900 border border-amber-300 hover:bg-amber-100 transition shadow-2xs"
              >
                <span>⚠️</span>
                <span>Compliance Action Center ({metrics.pendingApplicantAction})</span>
              </Link>
              <Link
                to="/applicant/applications/tracker"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold bg-[#0b2540] text-white hover:bg-[#123860] transition shadow-2xs"
              >
                <span>📊</span>
                <span>Open Project Tracker</span>
              </Link>
            </div>
          </div>

          {/* 5 Summary KPI Metrics Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mt-6">
            <div className="bg-slate-50 rounded-lg p-3.5 border border-slate-200">
              <span className="text-xs font-medium text-slate-500 block">Total Applications</span>
              <div className="flex items-baseline gap-2 mt-1">
                <span className="text-2xl font-bold text-slate-900">{metrics.totalApplications}</span>
                <span className="text-xs text-slate-500 font-medium">Clearances</span>
              </div>
            </div>

            <div className="bg-blue-50/70 rounded-lg p-3.5 border border-blue-200">
              <span className="text-xs font-medium text-blue-700 block">Under Scrutiny</span>
              <div className="flex items-baseline gap-2 mt-1">
                <span className="text-2xl font-bold text-blue-900">{metrics.underScrutiny}</span>
                <span className="text-xs text-blue-600 font-medium">In Desk Review</span>
              </div>
            </div>

            <div className="bg-amber-50/70 rounded-lg p-3.5 border border-amber-200">
              <span className="text-xs font-medium text-amber-800 block">Query Raised</span>
              <div className="flex items-baseline gap-2 mt-1">
                <span className="text-2xl font-bold text-amber-950">{metrics.queryRaised}</span>
                <span className="text-xs text-amber-700 font-medium">Action Pending</span>
              </div>
            </div>

            <div className="bg-indigo-50/70 rounded-lg p-3.5 border border-indigo-200">
              <span className="text-xs font-medium text-indigo-700 block">Site Inspection</span>
              <div className="flex items-baseline gap-2 mt-1">
                <span className="text-2xl font-bold text-indigo-950">{metrics.inspectionScheduled}</span>
                <span className="text-xs text-indigo-700 font-medium">Scheduled</span>
              </div>
            </div>

            <div className="bg-emerald-50/70 rounded-lg p-3.5 border border-emerald-200">
              <span className="text-xs font-medium text-emerald-800 block">Approved &amp; Issued</span>
              <div className="flex items-baseline gap-2 mt-1">
                <span className="text-2xl font-bold text-emerald-950">{metrics.approvedIssued}</span>
                <span className="text-xs text-emerald-700 font-medium">Within SLA</span>
              </div>
            </div>
          </div>
        </div>

        {/* Project Overview Card (Screen 24: "Project Overview - Manufacturing Unit Phase 1") */}
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-2xs">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between pb-4 border-b border-slate-100 gap-4">
            <div className="flex items-center gap-3.5">
              <div className="w-12 h-12 rounded-lg bg-blue-50 border border-blue-200 flex items-center justify-center text-2xl shrink-0">
                🏭
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-bold text-slate-900">
                    Project Overview — {activeProject.name}
                  </h2>
                  <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-amber-100 text-amber-900 border border-amber-300">
                    Pre-Establishment Stream
                  </span>
                </div>
                <p className="text-xs text-slate-600 mt-0.5">
                  {activeEnterprise.name} &bull; {activeProject.midcArea || 'Chakan MIDC Phase II'}, Plot B-14/1, {activeProject.district}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Link
                to="/applicant/applications/tracker"
                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200 transition"
              >
                View SLA Roadmap
              </Link>
              <Link
                to="/applicant/enterprises"
                className="px-3 py-1.5 rounded-lg text-xs font-semibold text-blue-700 hover:underline"
              >
                Project Details &rarr;
              </Link>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 pt-4 text-xs">
            <div>
              <span className="text-slate-500 block">Proposed Investment</span>
              <span className="font-bold text-slate-900 text-sm">₹{activeProject.proposedInvestmentCr} Crores</span>
            </div>
            <div>
              <span className="text-slate-500 block">Plot Land Area</span>
              <span className="font-bold text-slate-900 text-sm">{activeProject.landAreaAcres} Acres</span>
            </div>
            <div>
              <span className="text-slate-500 block">Power Requirement</span>
              <span className="font-bold text-slate-900 text-sm">{activeProject.powerDemandKva || 1250} kVA (HT)</span>
            </div>
            <div>
              <span className="text-slate-500 block">Industrial Water</span>
              <span className="font-bold text-slate-900 text-sm">{activeProject.waterDemandKld || 50} KLD (MIDC)</span>
            </div>
            <div>
              <span className="text-slate-500 block">CPCB Category</span>
              <span className="font-bold text-amber-800 text-sm">Orange (Industrial)</span>
            </div>
            <div>
              <span className="text-slate-500 block">Target Commissioning</span>
              <span className="font-bold text-slate-900 text-sm">{activeProject.commencementExpected}</span>
            </div>
          </div>
        </div>

        {/* Filter & Search Bar */}
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-2xs flex flex-col md:flex-row gap-3 items-center justify-between">
          <div className="w-full md:w-80 relative">
            <input
              type="text"
              placeholder="Search by application no, department, service..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600 bg-slate-50/50"
            />
            <span className="absolute left-3 top-2.5 text-slate-400 text-xs">🔍</span>
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600 text-xs"
              >
                ✕
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2.5 w-full md:w-auto">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="text-xs px-3 py-2 rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-blue-600 text-slate-700"
            >
              <option value="ALL">All Statuses</option>
              <option value="Under Scrutiny">Under Scrutiny</option>
              <option value="Query Raised">Query Raised</option>
              <option value="Inspection Scheduled">Inspection Scheduled</option>
              <option value="Approved">Approved</option>
              <option value="Draft">Draft</option>
            </select>

            <select
              value={deptFilter}
              onChange={(e) => setDeptFilter(e.target.value)}
              className="text-xs px-3 py-2 rounded-lg border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-blue-600 text-slate-700"
            >
              <option value="ALL">All Departments</option>
              <option value="MPCB">MPCB (Pollution)</option>
              <option value="DISH">DISH (Safety)</option>
              <option value="Fire Services">Fire Services</option>
              <option value="MSEDCL">MSEDCL (Power)</option>
              <option value="MIDC">MIDC (Water/Infra)</option>
              <option value="Revenue">Revenue (Land/NA)</option>
            </select>

            <button
              onClick={() => setActionOnly(!actionOnly)}
              className={`text-xs px-3 py-2 rounded-lg font-medium border transition flex items-center gap-1.5 ${
                actionOnly
                  ? 'bg-amber-600 text-white border-amber-600 shadow-2xs'
                  : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
              }`}
            >
              <span>⚡</span>
              <span>Action Required Only ({metrics.pendingApplicantAction})</span>
            </button>
          </div>
        </div>

        {/* Applications Dossiers Table & List */}
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-2xs">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/70">
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                All Industrial Applications &amp; Dossiers
              </h3>
              <p className="text-xs text-slate-500">
                Showing {filteredDossiers.length} of {dossiers.length} statutory clearance dockets
              </p>
            </div>
            <div className="text-xs text-slate-500 flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              <span>SLA Clock Monitored</span>
            </div>
          </div>

          {filteredDossiers.length === 0 ? (
            <div className="p-12 text-center">
              <span className="text-3xl block mb-2">📁</span>
              <h4 className="text-sm font-bold text-slate-800">No applications match your filter</h4>
              <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                Try adjusting your search keyword or resetting the status and department filters.
              </p>
              <button
                onClick={() => {
                  setSearchQuery('');
                  setStatusFilter('ALL');
                  setDeptFilter('ALL');
                  setActionOnly(false);
                }}
                className="mt-4 px-4 py-1.5 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg border border-blue-200 transition"
              >
                Reset All Filters
              </button>
            </div>
          ) : (
            <div className="divide-y divide-slate-200">
              {filteredDossiers.map((dossier) => {
                const percent = Math.min(100, Math.round((dossier.slaDaysElapsed / dossier.slaTargetDays) * 100));

                return (
                  <div
                    key={dossier.id}
                    className="p-5 hover:bg-slate-50/60 transition flex flex-col lg:flex-row lg:items-center justify-between gap-4"
                  >
                    {/* Left: Clearance Identity */}
                    <div className="space-y-1.5 max-w-xl">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs font-bold text-slate-900 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                          {dossier.applicationNumber}
                        </span>
                        <span className="text-[11px] font-semibold text-slate-500">
                          {dossier.serviceCode}
                        </span>
                        {getStatusBadge(dossier.status)}
                        {dossier.isCTE && (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
                            Phase 6 Live Stream
                          </span>
                        )}
                      </div>

                      <h4 className="text-sm font-bold text-slate-900 leading-snug">
                        {dossier.serviceName}
                      </h4>

                      <p className="text-xs text-slate-600">
                        <span className="font-semibold text-slate-700">{dossier.department}</span>
                        <span className="mx-1.5 text-slate-300">&bull;</span>
                        <span>Nodal Officer: {dossier.nodalOfficer.name}</span>
                      </p>

                      <div className="text-xs text-slate-500 flex flex-wrap items-center gap-x-4 gap-y-1 pt-1">
                        <span>
                          <strong>Submitted:</strong> {dossier.submittedDate}
                        </span>
                        <span>
                          <strong>Current Stage:</strong> {dossier.currentStage}
                        </span>
                      </div>

                      {/* Action Alert Callout */}
                      {dossier.applicantActionRequired && (
                        <div className="mt-2 p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-xs flex items-center justify-between gap-3 text-amber-900">
                          <div className="flex items-center gap-2">
                            <span className="text-amber-600 font-bold">⚠️ Action Required:</span>
                            <span>{dossier.actionText}</span>
                          </div>
                          {dossier.actionType === 'QUERY' && (
                            <Link
                              to="/applicant/compliance"
                              className="px-2.5 py-1 rounded bg-amber-600 hover:bg-amber-700 text-white font-semibold text-[11px] shrink-0 transition"
                            >
                              Open Query Form &rarr;
                            </Link>
                          )}
                          {dossier.actionType === 'INSPECTION' && (
                            <Link
                              to="/applicant/compliance"
                              className="px-2.5 py-1 rounded bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-[11px] shrink-0 transition"
                            >
                              Checklist &rarr;
                            </Link>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Right: SLA Progress Bar & Actions */}
                    <div className="lg:text-right shrink-0 space-y-3 min-w-[240px]">
                      {/* SLA Visual */}
                      <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200">
                        <div className="flex items-center justify-between text-[11px] text-slate-600 font-medium mb-1">
                          <span>SLA Due: {dossier.slaDueDate}</span>
                          <span className="font-bold text-slate-800">
                            {dossier.slaDaysElapsed} / {dossier.slaTargetDays} Days
                          </span>
                        </div>
                        <div className="w-full h-1.5 bg-slate-200 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${
                              dossier.status === 'Approved'
                                ? 'bg-emerald-500'
                                : dossier.slaDaysElapsed > 25
                                ? 'bg-amber-500'
                                : 'bg-blue-600'
                            }`}
                            style={{ width: `${percent}%` }}
                          />
                        </div>
                      </div>

                      {/* Action buttons */}
                      <div className="flex items-center lg:justify-end gap-2">
                        {dossier.isCTE && dossier.status === 'Draft' ? (
                          <Link
                            to="/applicant/applications/cte"
                            className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 transition"
                          >
                            Resume CTE Draft &rarr;
                          </Link>
                        ) : (
                          <Link
                            to={`/applicant/applications/tracker?appNumber=${encodeURIComponent(
                              dossier.applicationNumber
                            )}`}
                            className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-300 transition"
                          >
                            Open Detailed Tracker
                          </Link>
                        )}

                        {dossier.status === 'Query Raised' && (
                          <Link
                            to="/applicant/compliance"
                            className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-amber-600 hover:bg-amber-700 text-white transition"
                          >
                            Respond to Query
                          </Link>
                        )}

                        {dossier.status === 'Inspection Scheduled' && (
                          <Link
                            to="/applicant/compliance"
                            className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 text-white transition"
                          >
                            Site Inspection
                          </Link>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </ApplicantLayout>
  );
};
