import React, { useState, useMemo } from 'react';
import { Link, useRouter } from '../router/Router';
import { MOCK_APPROVALS } from '../data/mockData';
import { ApprovalItem } from '../types';

export const ApprovalsPage: React.FC = () => {
  const { navigate } = useRouter();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDept, setSelectedDept] = useState('All');
  const [selectedStage, setSelectedStage] = useState('All');
  const [selectedMode, setSelectedMode] = useState('All');
  const [sortBy, setSortBy] = useState<'sla' | 'name' | 'code'>('sla');

  // Filter & Sort Logic
  const filteredApprovals = useMemo(() => {
    return MOCK_APPROVALS.filter((item) => {
      // Search
      const query = searchQuery.toLowerCase().trim();
      const matchesSearch =
        !query ||
        item.name.toLowerCase().includes(query) ||
        item.department.toLowerCase().includes(query) ||
        item.serviceCode.toLowerCase().includes(query) ||
        item.description.toLowerCase().includes(query);

      // Dept
      const matchesDept = selectedDept === 'All' || item.category === selectedDept;

      // Stage
      const matchesStage = selectedStage === 'All' || item.stage === selectedStage;

      // Mode
      const matchesMode = selectedMode === 'All' || item.mode === selectedMode;

      return matchesSearch && matchesDept && matchesStage && matchesMode;
    }).sort((a, b) => {
      if (sortBy === 'sla') return a.slaDays - b.slaDays;
      if (sortBy === 'name') return a.name.localeCompare(b.name);
      return a.serviceCode.localeCompare(b.serviceCode);
    });
  }, [searchQuery, selectedDept, selectedStage, selectedMode, sortBy]);

  const handleResetFilters = () => {
    setSearchQuery('');
    setSelectedDept('All');
    setSelectedStage('All');
    setSelectedMode('All');
    setSortBy('sla');
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6" data-purpose="approvals-listing-screen">
      {/* Breadcrumb */}
      <nav aria-label="Breadcrumb" className="flex items-center space-x-1.5 text-xs text-slate-500 mb-4">
        <Link to="/" className="hover:text-[#0f2b48] transition-colors">Home</Link>
        <span className="text-slate-400">›</span>
        <span aria-current="page" className="text-slate-800 font-medium">Industrial Approvals</span>
      </nav>

      {/* Page Header & Search Banner */}
      <div className="bg-white border border-slate-200 rounded-lg p-5 mb-6 shadow-2xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-[#0f2b48] tracking-tight font-serif">
              Industrial Approvals &amp; Clearances
            </h1>
            <p className="text-xs text-slate-600 mt-0.5">
              Statutory permits, licences, and NOCs available via single-window digital filing
            </p>
          </div>

          {/* Search Box */}
          <div className="w-full md:w-80 relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by name, department, code..."
              className="w-full text-xs bg-slate-50 border border-slate-300 rounded px-3 py-2 pl-8 text-slate-800 placeholder-slate-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-600 focus:border-blue-600"
            />
            <svg
              className="w-4 h-4 text-slate-400 absolute left-2.5 top-2.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-2 text-slate-400 hover:text-slate-600 text-xs"
              >
                ✕
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Two Column Layout: Filters (left) & Cards List (right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Filter Sidebar (3 cols) */}
        <aside className="lg:col-span-3 bg-white border border-slate-200 rounded-lg p-4 shadow-2xs space-y-5">
          <div className="flex items-center justify-between pb-3 border-b border-slate-200">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-800 flex items-center gap-1.5">
              <svg className="w-3.5 h-3.5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
              </svg>
              Filter Approvals
            </span>
            {(selectedDept !== 'All' || selectedStage !== 'All' || selectedMode !== 'All' || searchQuery) && (
              <button
                type="button"
                onClick={handleResetFilters}
                className="text-[11px] font-semibold text-blue-700 hover:text-blue-900"
              >
                Reset All
              </button>
            )}
          </div>

          {/* Filter: Department */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-2">Department / Category</label>
            <div className="space-y-1.5 text-xs text-slate-600">
              {['All', 'Environment', 'Urban Development', 'Labour', 'Fire Services', 'Energy', 'Water'].map((cat) => (
                <label key={cat} className="flex items-center space-x-2 cursor-pointer hover:text-slate-900">
                  <input
                    type="radio"
                    name="dept-filter"
                    checked={selectedDept === cat}
                    onChange={() => setSelectedDept(cat)}
                    className="text-blue-600 focus:ring-blue-500 rounded border-slate-300"
                  />
                  <span>{cat === 'All' ? 'All Departments' : cat}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Filter: Lifecycle Stage */}
          <div className="pt-3 border-t border-slate-100">
            <label className="block text-xs font-bold text-slate-700 mb-2">Lifecycle Stage</label>
            <div className="space-y-1.5 text-xs text-slate-600">
              {['All', 'Pre-Establishment', 'Pre-Operation', 'Operational'].map((stage) => (
                <label key={stage} className="flex items-center space-x-2 cursor-pointer hover:text-slate-900">
                  <input
                    type="radio"
                    name="stage-filter"
                    checked={selectedStage === stage}
                    onChange={() => setSelectedStage(stage)}
                    className="text-blue-600 focus:ring-blue-500 rounded border-slate-300"
                  />
                  <span>{stage === 'All' ? 'All Stages' : stage}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Filter: Mode */}
          <div className="pt-3 border-t border-slate-100">
            <label className="block text-xs font-bold text-slate-700 mb-2">Filing Mode</label>
            <div className="space-y-1.5 text-xs text-slate-600">
              {['All', 'Online', 'Hybrid'].map((mode) => (
                <label key={mode} className="flex items-center space-x-2 cursor-pointer hover:text-slate-900">
                  <input
                    type="radio"
                    name="mode-filter"
                    checked={selectedMode === mode}
                    onChange={() => setSelectedMode(mode)}
                    className="text-blue-600 focus:ring-blue-500 rounded border-slate-300"
                  />
                  <span>{mode === 'All' ? 'All Modes' : mode}</span>
                </label>
              ))}
            </div>
          </div>
        </aside>

        {/* Right Approvals Listing (9 cols) */}
        <section className="lg:col-span-9 space-y-4">
          {/* Results Summary Bar */}
          <div className="bg-white border border-slate-200 rounded-lg px-4 py-2.5 flex items-center justify-between text-xs text-slate-600">
            <span>
              Showing <strong className="text-slate-900 font-bold">{filteredApprovals.length}</strong> of {MOCK_APPROVALS.length} statutory clearances
            </span>

            {/* Sort Controls */}
            <div className="flex items-center space-x-2">
              <span className="text-slate-500">Sort by:</span>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className="bg-slate-50 border border-slate-200 rounded px-2 py-1 text-slate-700 font-medium focus:outline-none focus:ring-1 focus:ring-blue-600"
              >
                <option value="sla">Fastest SLA (Days)</option>
                <option value="name">Alphabetical (A–Z)</option>
                <option value="code">Service Code</option>
              </select>
            </div>
          </div>

          {/* Approvals Cards Grid */}
          {filteredApprovals.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-lg p-10 text-center space-y-3">
              <p className="text-sm font-semibold text-slate-700">No clearances match your active filters.</p>
              <button
                type="button"
                onClick={handleResetFilters}
                className="px-3 py-1.5 bg-blue-50 text-blue-700 rounded text-xs font-semibold hover:bg-blue-100"
              >
                Clear all filters
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredApprovals.map((app) => (
                <article
                  key={app.id}
                  className="bg-white border border-slate-200 rounded-lg p-4 shadow-2xs hover:border-blue-300 hover:shadow-xs transition"
                >
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                    <div className="space-y-1 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">
                          {app.serviceCode}
                        </span>
                        <span className="text-[11px] font-semibold text-blue-800 bg-blue-50 px-2 py-0.5 rounded border border-blue-100">
                          {app.department}
                        </span>
                        {app.subDepartment && (
                          <span className="text-[10px] text-slate-500">
                            • {app.subDepartment}
                          </span>
                        )}
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                          app.applicability === 'Mandatory' ? 'bg-amber-50 text-amber-800 border border-amber-200' : 'bg-slate-100 text-slate-600'
                        }`}>
                          {app.applicability}
                        </span>
                      </div>

                      <h3 className="text-sm font-bold text-slate-900 leading-snug">
                        {app.name}
                      </h3>
                      <p className="text-xs text-slate-600 leading-relaxed max-w-3xl">
                        {app.description}
                      </p>

                      <div className="text-[11px] text-slate-500 pt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
                        <span><strong>Act:</strong> {app.act}</span>
                        <span>•</span>
                        <span><strong>Stage:</strong> {app.stage}</span>
                      </div>
                    </div>

                    {/* Right Meta & Action */}
                    <div className="sm:text-right shrink-0 flex sm:flex-col justify-between sm:justify-start items-center sm:items-end gap-2 border-t sm:border-t-0 pt-2 sm:pt-0 border-slate-100">
                      <div className="flex sm:flex-col items-center sm:items-end gap-2 sm:gap-1">
                        <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded">
                          ⏱ {app.slaDays} Days SLA
                        </span>
                        <span className="text-xs text-slate-600 font-semibold">
                          Fee: {app.feeText}
                        </span>
                      </div>

                      <Link
                        to={app.id === 'cte-01' ? '/approvals/consent-to-establish' : `/approvals/consent-to-establish`}
                        className="inline-flex items-center space-x-1 px-3 py-1.5 rounded bg-blue-50 hover:bg-blue-600 text-blue-700 hover:text-white font-semibold text-xs transition border border-blue-200 hover:border-blue-600"
                      >
                        <span>View Details</span>
                        <span className="font-bold">→</span>
                      </Link>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
