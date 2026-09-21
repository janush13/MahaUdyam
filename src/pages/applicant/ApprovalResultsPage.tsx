import React, { useState } from 'react';
import { ApplicantLayout } from '../../components/layout/ApplicantLayout';
import { useRouter } from '../../router/Router';
import { approvalRuleEngine } from '../../services/approvalRuleEngine';
import { ApprovalResult, DiscoverySummary } from '../../types/approvalDiscovery';
import { applicantService } from '../../services/applicantService';

export const ApprovalResultsPage: React.FC = () => {
  const { navigate } = useRouter();

  // Load evaluated summary from engine
  const [summary, setSummary] = useState<DiscoverySummary>(() => {
    const existing = approvalRuleEngine.getDiscoverySummary();
    if (existing) return existing;

    // If direct navigation without questionnaire, evaluate default context
    const enterprises = applicantService.getEnterprises();
    const primaryEnt = enterprises.find((e) => e.isPrimary) || enterprises[0];
    const projects = applicantService.getProjectsByEnterprise(primaryEnt?.id || '');
    const project = projects[0] || applicantService.getProjects()[0];

    const fallbackCtx = approvalRuleEngine.createInitialContext(primaryEnt, project);
    return approvalRuleEngine.evaluateProject(fallbackCtx);
  });

  // UI States
  const [activeView, setActiveView] = useState<'matrix' | 'roadmap' | 'documents'>('matrix');
  const [stageFilter, setStageFilter] = useState<'All' | 'Pre-Establishment' | 'Pre-Operation'>('All');
  const [applicabilityFilter, setApplicabilityFilter] = useState<'All' | 'Mandatory' | 'Conditional'>('All');
  const [departmentFilter, setDepartmentFilter] = useState<string>('All');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [expandedApprovalId, setExpandedApprovalId] = useState<string | null>(null);
  const [copiedNotification, setCopiedNotification] = useState<string | null>(null);

  const { projectContext, results, metrics, requiredDocuments, evaluatedAt } = summary;

  // Filtered results
  const filteredResults = results.filter((item) => {
    if (stageFilter !== 'All' && item.stage !== stageFilter) return false;
    if (applicabilityFilter !== 'All' && item.applicability !== applicabilityFilter) return false;
    if (departmentFilter !== 'All' && !item.department.toLowerCase().includes(departmentFilter.toLowerCase()) && !item.subDepartment.toLowerCase().includes(departmentFilter.toLowerCase())) {
      return false;
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchName = item.name.toLowerCase().includes(q);
      const matchCode = item.serviceCode.toLowerCase().includes(q);
      const matchDept = item.department.toLowerCase().includes(q) || item.subDepartment.toLowerCase().includes(q);
      const matchTrigger = item.triggerReason.toLowerCase().includes(q);
      if (!matchName && !matchCode && !matchDept && !matchTrigger) return false;
    }
    return true;
  });

  // Unique departments for filter
  const departments = ['All', 'MPCB', 'MIDC', 'Fire', 'DISH', 'Energy', 'Water', 'Labour'];

  const toggleExpand = (id: string) => {
    setExpandedApprovalId(expandedApprovalId === id ? null : id);
  };

  const handleCopyChecklist = () => {
    const text = requiredDocuments
      .map((d, i) => `${i + 1}. [${d.category}] ${d.name} (Required for: ${d.mandatoryForClearanceIds.join(', ')})`)
      .join('\n');
    navigator.clipboard?.writeText(text);
    setCopiedNotification('Checklist copied to clipboard!');
    setTimeout(() => setCopiedNotification(null), 3000);
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <ApplicantLayout
      activeTab="discovery"
      breadcrumbs={[
        { label: 'Find Approvals', href: '/applicant/approvals/find' },
        { label: 'Questionnaire', href: '/applicant/approvals/questionnaire' },
        { label: 'Clearance Matrix' },
      ]}
    >
      <div className="space-y-6" data-purpose="screen-19-approval-results">
        {/* Header Dossier Banner */}
        <div className="bg-white p-5 sm:p-6 rounded-2xl border border-slate-200 shadow-2xs">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 flex-wrap mb-1.5">
                <span className="px-2 py-0.5 rounded text-[10.5px] font-mono font-bold bg-blue-100 text-blue-900 border border-blue-200 uppercase">
                  Statutory Clearance Docket
                </span>
                <span className={`px-2 py-0.5 rounded text-[10.5px] font-bold border ${
                  projectContext.pollutionCategory === 'Red'
                    ? 'bg-rose-50 text-rose-800 border-rose-300'
                    : projectContext.pollutionCategory === 'Orange'
                    ? 'bg-amber-50 text-amber-800 border-amber-300'
                    : 'bg-emerald-50 text-emerald-800 border-emerald-300'
                }`}>
                  {projectContext.pollutionCategory} Category
                </span>
                <span className="text-xs text-slate-400">•</span>
                <span className="text-xs font-semibold text-slate-500">
                  Evaluated: {evaluatedAt}
                </span>
              </div>

              <h1 className="text-xl sm:text-2xl font-bold font-serif text-[#0f2b48]">
                {projectContext.projectName}
              </h1>
              <p className="text-xs text-slate-600 mt-1 max-w-3xl">
                Entity: <strong className="text-slate-800">{projectContext.enterpriseName}</strong> • Siting: <strong className="text-slate-800">{projectContext.plotOrSurveyNumber}, {projectContext.district}</strong> ({projectContext.landType}) • Investment: <strong className="text-blue-900 font-mono">₹{projectContext.proposedCapitalInvestmentCr} Cr</strong>
              </p>
            </div>

            {/* Quick Action Toolbar */}
            <div className="flex items-center gap-2 flex-wrap self-start lg:self-center">
              <button
                type="button"
                onClick={handlePrint}
                className="px-3 py-1.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-bold transition flex items-center gap-1.5 shadow-2xs cursor-pointer"
                title="Print or Save as PDF"
              >
                <span>🖨️ Print Docket</span>
              </button>

              <button
                type="button"
                onClick={() => navigate('/applicant/approvals/questionnaire')}
                className="px-3.5 py-1.5 rounded-xl border border-blue-200 bg-blue-50 hover:bg-blue-100 text-blue-900 text-xs font-bold transition flex items-center gap-1.5 shadow-2xs cursor-pointer"
              >
                <span>⚙️ Re-evaluate Parameters</span>
              </button>
            </div>
          </div>
        </div>

        {/* Statutory Legal Safeguard Ribbon */}
        <div className="bg-amber-50/80 border border-amber-200 p-3.5 sm:p-4 rounded-xl flex items-start gap-3 text-xs text-amber-950 shadow-2xs">
          <span className="text-lg">⚖️</span>
          <div>
            <span className="font-bold block">
              Official Statutory Disclaimer &amp; Verification Rule:
            </span>
            <p className="text-amber-900/90 mt-0.5 leading-relaxed">
              This clearance matrix is generated by the MahaUdyam One algorithmic clearance rule engine based on declared project parameters. All statutory requirements, fees, and clearance timelines are subject to formal verification by competent authorities (MPCB, DISH, MIDC, Fire Services, MSEDCL) upon submission of statutory applications.
              <span className="font-bold text-amber-950 ml-1">
                (Prototype rule — statutory validation required).
              </span>
            </p>
          </div>
        </div>

        {/* Key Composite Metrics Bar */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs">
            <span className="text-[11px] font-semibold text-slate-400 block uppercase tracking-wider">
              Total Clearances
            </span>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-2xl font-bold font-serif text-[#0f2b48]">
                {metrics.totalApprovals}
              </span>
              <span className="text-xs font-medium text-slate-500">
                Approvals Triggered
              </span>
            </div>
            <div className="mt-2 text-[10.5px] text-slate-500 flex items-center gap-2">
              <span className="font-bold text-rose-700">{metrics.mandatoryCount} Mandatory</span>
              <span>•</span>
              <span className="font-medium text-amber-700">{metrics.conditionalCount} Conditional</span>
            </div>
          </div>

          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs">
            <span className="text-[11px] font-semibold text-slate-400 block uppercase tracking-wider">
              Critical Path SLA
            </span>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-2xl font-bold font-serif text-blue-900">
                {metrics.criticalPathSla}
              </span>
              <span className="text-xs font-medium text-slate-500">
                Working Days Max
              </span>
            </div>
            <p className="mt-2 text-[10.5px] text-slate-500">
              Parallel processing under Maharashtra Single Window Act 2016.
            </p>
          </div>

          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs">
            <span className="text-[11px] font-semibold text-slate-400 block uppercase tracking-wider">
              Est. Statutory Scrutiny Fees
            </span>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-2xl font-bold font-serif text-emerald-800 font-mono">
                ₹{metrics.totalEstimatedFee.toLocaleString('en-IN')}
              </span>
            </div>
            <p className="mt-2 text-[10.5px] text-slate-500">
              Excludes capital security deposits and connection charges.
            </p>
          </div>

          <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs">
            <span className="text-[11px] font-semibold text-slate-400 block uppercase tracking-wider">
              Consolidated Documents
            </span>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-2xl font-bold font-serif text-purple-900">
                {requiredDocuments.length}
              </span>
              <span className="text-xs font-medium text-slate-500">
                Unique Attachments
              </span>
            </div>
            <p className="mt-2 text-[10.5px] text-slate-500">
              Reuse across departments via Single Window Document Vault.
            </p>
          </div>
        </div>

        {/* View Switcher Tabs */}
        <div className="flex items-center justify-between border-b border-slate-200">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveView('matrix')}
              className={`pb-3 px-3 text-xs font-bold border-b-2 transition ${
                activeView === 'matrix'
                  ? 'border-blue-900 text-blue-950 font-serif'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              📋 Statutory Clearances Matrix ({results.length})
            </button>

            <button
              type="button"
              onClick={() => setActiveView('roadmap')}
              className={`pb-3 px-3 text-xs font-bold border-b-2 transition ${
                activeView === 'roadmap'
                  ? 'border-blue-900 text-blue-950 font-serif'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              🗺️ Siting &amp; Execution Roadmap
            </button>

            <button
              type="button"
              onClick={() => setActiveView('documents')}
              className={`pb-3 px-3 text-xs font-bold border-b-2 transition ${
                activeView === 'documents'
                  ? 'border-blue-900 text-blue-950 font-serif'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              📁 Consolidated Document Checklist ({requiredDocuments.length})
            </button>
          </div>
        </div>

        {/* VIEW 1: STATUTORY CLEARANCES MATRIX */}
        {activeView === 'matrix' && (
          <div className="space-y-4">
            {/* Filter & Search Bar */}
            <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2 flex-wrap">
                {/* Stage Filter */}
                <div className="flex items-center bg-slate-100 p-1 rounded-xl">
                  {(['All', 'Pre-Establishment', 'Pre-Operation'] as const).map((stg) => (
                    <button
                      key={stg}
                      type="button"
                      onClick={() => setStageFilter(stg)}
                      className={`px-2.5 py-1 rounded-lg font-bold transition ${
                        stageFilter === stg
                          ? 'bg-white text-blue-950 shadow-2xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {stg === 'All' ? 'All Stages' : stg}
                    </button>
                  ))}
                </div>

                {/* Applicability Filter */}
                <select
                  value={applicabilityFilter}
                  onChange={(e) => setApplicabilityFilter(e.target.value as any)}
                  className="px-2.5 py-1.5 rounded-xl border border-slate-300 bg-white font-semibold text-slate-700"
                >
                  <option value="All">All Types (Mandatory &amp; Conditional)</option>
                  <option value="Mandatory">Mandatory Only</option>
                  <option value="Conditional">Conditional Only</option>
                </select>

                {/* Department Filter */}
                <select
                  value={departmentFilter}
                  onChange={(e) => setDepartmentFilter(e.target.value)}
                  className="px-2.5 py-1.5 rounded-xl border border-slate-300 bg-white font-semibold text-slate-700"
                >
                  {departments.map((d) => (
                    <option key={d} value={d}>
                      {d === 'All' ? 'All Departments' : `Dept: ${d}`}
                    </option>
                  ))}
                </select>
              </div>

              {/* Search Box */}
              <div className="relative w-full md:w-64">
                <input
                  type="text"
                  placeholder="Filter by name, act, code..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 rounded-xl border border-slate-300 font-medium focus:ring-2 focus:ring-blue-900 focus:outline-none"
                />
                <span className="absolute left-2.5 top-2 text-slate-400 text-xs">🔍</span>
              </div>
            </div>

            {/* Results Counter */}
            <div className="flex items-center justify-between text-xs text-slate-500 px-1">
              <span>Showing <strong>{filteredResults.length}</strong> of <strong>{results.length}</strong> statutory clearances</span>
              <span className="text-[11px]">Click any card to inspect statutory requirements &amp; legal prerequisites</span>
            </div>

            {/* Approvals Cards Grid */}
            <div className="space-y-3">
              {filteredResults.map((item) => {
                const isExpanded = expandedApprovalId === item.id;
                return (
                  <div
                    key={item.id}
                    className={`bg-white rounded-2xl border transition shadow-2xs overflow-hidden ${
                      isExpanded ? 'border-blue-900 ring-1 ring-blue-900/20' : 'border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    {/* Main Row */}
                    <div
                      onClick={() => toggleExpand(item.id)}
                      className="p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4 cursor-pointer"
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          toggleExpand(item.id);
                        }
                      }}
                    >
                      <div className="flex items-start gap-3.5">
                        <div className="w-9 h-9 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center font-bold text-xs shrink-0 font-mono">
                          #{item.sequenceOrder}
                        </div>

                        <div className="space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="px-2 py-0.2 rounded font-mono font-bold text-[10px] bg-blue-50 text-blue-900 border border-blue-200">
                              {item.serviceCode}
                            </span>
                            <span
                              className={`px-2 py-0.2 rounded font-bold text-[10px] ${
                                item.stage === 'Pre-Establishment'
                                  ? 'bg-purple-50 text-purple-900 border border-purple-200'
                                  : 'bg-emerald-50 text-emerald-900 border border-emerald-200'
                              }`}
                            >
                              {item.stage}
                            </span>
                            <span
                              className={`px-2 py-0.2 rounded font-bold text-[10px] ${
                                item.applicability === 'Mandatory'
                                  ? 'bg-rose-50 text-rose-800 border border-rose-200'
                                  : 'bg-amber-50 text-amber-800 border border-amber-200'
                              }`}
                            >
                              {item.applicability}
                            </span>
                            <span className="text-[11px] text-slate-400 font-medium">
                              • {item.category}
                            </span>
                          </div>

                          <h3 className="text-sm sm:text-base font-bold text-slate-900 font-serif">
                            {item.name}
                          </h3>

                          <p className="text-xs text-slate-500">
                            Department: <span className="font-semibold text-slate-700">{item.department}</span> • Authority: <span className="font-semibold text-slate-700">{item.subDepartment}</span>
                          </p>

                          {/* Trigger Reason */}
                          <div className="mt-1.5 p-2 bg-slate-50 rounded-lg border border-slate-100 text-xs text-slate-700">
                            <span className="font-semibold text-blue-950">Reason: </span>
                            <span>{item.triggerReason}</span>
                          </div>
                        </div>
                      </div>

                      {/* Right Specs & Toggle */}
                      <div className="flex items-center justify-between lg:justify-end gap-6 shrink-0 border-t lg:border-t-0 pt-3 lg:pt-0 border-slate-100">
                        <div className="text-right">
                          <span className="text-[10px] text-slate-400 block uppercase font-bold">
                            Statutory SLA
                          </span>
                          <span className="text-xs font-bold text-blue-900">
                            {item.slaDays} Working Days
                          </span>
                        </div>

                        <div className="text-right">
                          <span className="text-[10px] text-slate-400 block uppercase font-bold">
                            Est. Scrutiny Fee
                          </span>
                          <span className="text-xs font-bold font-mono text-emerald-800">
                            ₹{item.feeEstimate.toLocaleString('en-IN')}
                          </span>
                        </div>

                        <div className="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center text-xs text-slate-500">
                          {isExpanded ? '▲' : '▼'}
                        </div>
                      </div>
                    </div>

                    {/* Expanded Details Drawer */}
                    {isExpanded && (
                      <div className="p-5 bg-slate-50/70 border-t border-slate-200 space-y-4 text-xs">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {/* Governing Act & Statutory Prerequisites */}
                          <div className="space-y-3">
                            <div>
                              <span className="font-bold text-slate-800 block text-[11px] uppercase tracking-wider">
                                Governing Statutory Act &amp; Regulation
                              </span>
                              <p className="text-slate-700 font-medium mt-0.5">
                                ⚖️ {item.act}
                              </p>
                            </div>

                            <div>
                              <span className="font-bold text-slate-800 block text-[11px] uppercase tracking-wider">
                                Statutory Pre-requisites &amp; Sequencing
                              </span>
                              <p className="text-slate-600 mt-0.5">
                                🔗 {item.prerequisites}
                              </p>
                            </div>

                            <div>
                              <span className="font-bold text-slate-800 block text-[11px] uppercase tracking-wider">
                                Scrutiny Fee Calculation Basis
                              </span>
                              <p className="text-slate-600 font-mono text-[11px] mt-0.5">
                                💰 {item.feeFormulaText}
                              </p>
                            </div>

                            <div>
                              <span className="font-bold text-slate-800 block text-[11px] uppercase tracking-wider">
                                Nodal Competent Authority Office
                              </span>
                              <p className="text-slate-700 mt-0.5">
                                🏢 {item.authorityContactOffice} ({item.applicationMode})
                              </p>
                            </div>
                          </div>

                          {/* Required Documents for this clearance */}
                          <div className="bg-white p-4 rounded-xl border border-slate-200 space-y-2">
                            <span className="font-bold text-slate-900 block text-[11px] uppercase tracking-wider">
                              Required Documents for {item.serviceCode}
                            </span>
                            <ul className="space-y-1.5 text-slate-700">
                              {item.requiredDocuments.map((doc, idx) => (
                                <li key={idx} className="flex items-start gap-2">
                                  <span className="text-emerald-600 font-bold">✓</span>
                                  <span>{doc}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        </div>

                        {/* Statutory Disclaimer & Action Buttons */}
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-3 border-t border-slate-200">
                          <span className="text-[10.5px] text-slate-500 italic">
                            ⚠️ {item.statutoryDisclaimer}
                          </span>

                          <div className="flex items-center gap-2 flex-wrap">
                            {(item.id === 'cte-01' || item.serviceCode === 'CTE-01') && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  navigate('/applicant/applications/cte');
                                }}
                                className="px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-2xs"
                              >
                                <span>🚀 Apply for CTE (MahaUdyam One)</span>
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                navigate(`/services/${item.id}`);
                              }}
                              className="px-4 py-2 bg-blue-900 hover:bg-blue-800 text-white rounded-xl text-xs font-bold transition cursor-pointer"
                            >
                              Inspect Statutory Service Definition →
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* VIEW 2: SITING & EXECUTION ROADMAP */}
        {activeView === 'roadmap' && (
          <div className="bg-white p-5 sm:p-7 rounded-2xl border border-slate-200 shadow-2xs space-y-6">
            <div>
              <h2 className="text-base font-bold font-serif text-slate-900">
                Statutory Execution Sequencing Roadmap
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Clearances structured in chronological parallel processing tracks under the Maharashtra Single Window Act 2016.
              </p>
            </div>

            {/* Stage 1: Pre-Establishment Phase */}
            <div className="border border-purple-200 rounded-2xl bg-purple-50/20 p-5 space-y-4">
              <div className="flex items-center justify-between border-b border-purple-100 pb-3">
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-purple-900 text-white text-xs font-bold flex items-center justify-center">
                    1
                  </span>
                  <div>
                    <h3 className="text-sm font-bold text-purple-950">
                      Phase I: Pre-Establishment Clearances (Prior to Ground Breaking)
                    </h3>
                    <p className="text-[11px] text-purple-800">
                      Must be obtained before initiating physical civil construction or plant erection on site.
                    </p>
                  </div>
                </div>
                <span className="text-xs font-mono font-bold text-purple-900 bg-purple-100 px-2.5 py-1 rounded-lg">
                  Critical Path: {metrics.criticalPathSla} Working Days
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {results
                  .filter((r) => r.stage === 'Pre-Establishment')
                  .map((r) => (
                    <div key={r.id} className="bg-white p-3.5 rounded-xl border border-purple-200/80 shadow-2xs space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-[10px] font-bold text-purple-900 bg-purple-50 px-1.5 py-0.5 rounded">
                          {r.serviceCode}
                        </span>
                        <span className="text-[10px] text-slate-400">{r.slaDays} Days SLA</span>
                      </div>
                      <h4 className="text-xs font-bold text-slate-900 font-serif">
                        {r.name}
                      </h4>
                      <p className="text-[11px] text-slate-500 font-medium">
                        {r.subDepartment}
                      </p>
                      <div className="pt-2 border-t border-slate-100 text-[10.5px] text-slate-600 flex items-center justify-between">
                        <span>Fee: ₹{r.feeEstimate.toLocaleString('en-IN')}</span>
                        <span className="text-purple-900 font-bold">Parallel Track</span>
                      </div>
                    </div>
                  ))}
              </div>
            </div>

            {/* Stage 2: Pre-Operation Phase */}
            <div className="border border-emerald-200 rounded-2xl bg-emerald-50/20 p-5 space-y-4">
              <div className="flex items-center justify-between border-b border-emerald-100 pb-3">
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-emerald-800 text-white text-xs font-bold flex items-center justify-center">
                    2
                  </span>
                  <div>
                    <h3 className="text-sm font-bold text-emerald-950">
                      Phase II: Pre-Operation Clearances (Prior to Commercial Trial Run)
                    </h3>
                    <p className="text-[11px] text-emerald-800">
                      Applied after civil completion and machinery installation, prior to workforce deployment and power energization.
                    </p>
                  </div>
                </div>
                <span className="text-xs font-mono font-bold text-emerald-900 bg-emerald-100 px-2.5 py-1 rounded-lg">
                  SLA: 15–45 Working Days
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {results
                  .filter((r) => r.stage === 'Pre-Operation')
                  .map((r) => (
                    <div key={r.id} className="bg-white p-3.5 rounded-xl border border-emerald-200/80 shadow-2xs space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-[10px] font-bold text-emerald-800 bg-emerald-50 px-1.5 py-0.5 rounded">
                          {r.serviceCode}
                        </span>
                        <span className="text-[10px] text-slate-400">{r.slaDays} Days SLA</span>
                      </div>
                      <h4 className="text-xs font-bold text-slate-900 font-serif">
                        {r.name}
                      </h4>
                      <p className="text-[11px] text-slate-500 font-medium">
                        {r.subDepartment}
                      </p>
                      <div className="pt-2 border-t border-slate-100 text-[10.5px] text-slate-600 flex items-center justify-between">
                        <span>Fee: ₹{r.feeEstimate.toLocaleString('en-IN')}</span>
                        <span className="text-emerald-800 font-bold">Commissioning Track</span>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          </div>
        )}

        {/* VIEW 3: CONSOLIDATED DOCUMENT CHECKLIST */}
        {activeView === 'documents' && (
          <div className="bg-white p-5 sm:p-7 rounded-2xl border border-slate-200 shadow-2xs space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
              <div>
                <h2 className="text-base font-bold font-serif text-slate-900">
                  Consolidated Document Repository Checklist
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Prepare these {requiredDocuments.length} unique statutory documents to file all {results.length} clearances simultaneously.
                </p>
              </div>

              <button
                type="button"
                onClick={handleCopyChecklist}
                className="px-4 py-2 bg-blue-50 text-blue-900 border border-blue-200 rounded-xl text-xs font-bold hover:bg-blue-100 transition flex items-center gap-1.5 self-start sm:self-center cursor-pointer"
              >
                <span>📋 Copy Master Checklist</span>
              </button>
            </div>

            {copiedNotification && (
              <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-300 text-emerald-800 text-xs font-semibold flex items-center gap-2">
                <span>✓</span>
                <span>{copiedNotification}</span>
              </div>
            )}

            {/* Categorized Document Groups */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              {(['Land & Siting', 'Engineering & Layout', 'Environmental & Health', 'Safety & Utility', 'Legal & Identity'] as const).map((cat) => {
                const docs = requiredDocuments.filter((d) => d.category === cat);
                if (docs.length === 0) return null;

                return (
                  <div key={cat} className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 space-y-3">
                    <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                      <span className="font-bold text-slate-900 font-serif text-xs uppercase tracking-wider">
                        📁 {cat}
                      </span>
                      <span className="text-[11px] font-semibold text-slate-500">
                        {docs.length} Document{docs.length > 1 ? 's' : ''}
                      </span>
                    </div>

                    <div className="space-y-2.5">
                      {docs.map((doc) => (
                        <div key={doc.id} className="bg-white p-3 rounded-lg border border-slate-200 shadow-2xs space-y-1.5">
                          <div className="flex items-start justify-between gap-2">
                            <span className="font-semibold text-slate-800 leading-snug">
                              {doc.name}
                            </span>
                          </div>

                          <div className="flex items-center gap-1.5 flex-wrap pt-1">
                            <span className="text-[10px] text-slate-400">Required by:</span>
                            {doc.mandatoryForClearanceIds.map((cid) => (
                              <span
                                key={cid}
                                className="px-1.5 py-0.2 rounded text-[9.5px] font-mono font-bold bg-blue-50 text-blue-900 border border-blue-200"
                              >
                                {cid}
                              </span>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Bottom Call to Action Docket Card */}
        <div className="bg-gradient-to-br from-[#0f2b48] to-[#1e3a5f] p-5 sm:p-6 rounded-2xl text-white shadow-md flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-white/20 text-white border border-white/30 uppercase">
              Next Step in MahaUdyam One
            </span>
            <h3 className="text-base sm:text-lg font-bold font-serif">
              Ready to submit applications for {projectContext.projectName}?
            </h3>
            <p className="text-xs text-blue-100 max-w-2xl leading-relaxed">
              Upload the identified documents to your Document Vault or proceed directly to the Combined Pre-Establishment Application form (CTE &amp; allied clearances).
            </p>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => navigate('/applicant/dashboard')}
              className="px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-bold transition border border-white/20 cursor-pointer"
            >
              Back to Dashboard
            </button>
            <button
              type="button"
              onClick={() => navigate('/services/cte-01')}
              className="px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold transition shadow-sm cursor-pointer"
            >
              Begin Pre-Establishment Filing →
            </button>
          </div>
        </div>
      </div>
    </ApplicantLayout>
  );
};
