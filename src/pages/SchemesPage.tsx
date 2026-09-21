import React, { useState, useMemo } from 'react';
import { Link, useRouter } from '../router/Router';
import { MOCK_SCHEMES } from '../data/mockData';

export const SchemesPage: React.FC = () => {
  const { navigate } = useRouter();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDept, setSelectedDept] = useState('All');
  const [selectedType, setSelectedType] = useState('All');
  const [selectedBeneficiary, setSelectedBeneficiary] = useState('All');

  const filteredSchemes = useMemo(() => {
    return MOCK_SCHEMES.filter((scheme) => {
      const query = searchQuery.toLowerCase().trim();
      const matchesSearch =
        !query ||
        scheme.title.toLowerCase().includes(query) ||
        scheme.description.toLowerCase().includes(query) ||
        scheme.department.toLowerCase().includes(query) ||
        scheme.code.toLowerCase().includes(query);

      const matchesDept = selectedDept === 'All' || scheme.department === selectedDept;
      const matchesType = selectedType === 'All' || scheme.schemeType === selectedType;
      const matchesBeneficiary = selectedBeneficiary === 'All' || scheme.beneficiary === selectedBeneficiary;

      return matchesSearch && matchesDept && matchesType && matchesBeneficiary;
    });
  }, [searchQuery, selectedDept, selectedType, selectedBeneficiary]);

  const handleResetFilters = () => {
    setSearchQuery('');
    setSelectedDept('All');
    setSelectedType('All');
    setSelectedBeneficiary('All');
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6" data-purpose="schemes-listing-screen">
      {/* Breadcrumb */}
      <nav aria-label="Breadcrumb" className="flex items-center space-x-1.5 text-xs text-slate-500 mb-4">
        <Link to="/" className="hover:text-[#0f2b48] transition-colors">Home</Link>
        <span className="text-slate-400">›</span>
        <span aria-current="page" className="text-slate-800 font-medium">Government Schemes</span>
      </nav>

      {/* Header Banner */}
      <div className="bg-white border border-slate-200 rounded-lg p-5 mb-6 shadow-2xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-[#0f2b48] tracking-tight font-serif">
              Government Schemes &amp; Incentives
            </h1>
            <p className="text-xs text-slate-600 mt-0.5">
              Financial subsidies, fiscal incentives, and infrastructure support for Maharashtra enterprises
            </p>
          </div>

          {/* Search Box */}
          <div className="w-full md:w-80 relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search schemes, benefits, keywords..."
              className="w-full text-xs bg-slate-50 border border-slate-300 rounded px-3 py-2 pl-8 text-slate-800 placeholder-slate-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-600"
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

      {/* Two Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Filter Sidebar (3 cols) */}
        <aside className="lg:col-span-3 bg-white border border-slate-200 rounded-lg p-4 shadow-2xs space-y-5">
          <div className="flex items-center justify-between pb-3 border-b border-slate-200">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-800 flex items-center gap-1.5">
              <svg className="w-3.5 h-3.5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
              </svg>
              Filter Schemes
            </span>
            {(selectedDept !== 'All' || selectedType !== 'All' || selectedBeneficiary !== 'All' || searchQuery) && (
              <button
                type="button"
                onClick={handleResetFilters}
                className="text-[11px] font-semibold text-blue-700 hover:text-blue-900"
              >
                Reset All
              </button>
            )}
          </div>

          {/* Department Filter */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-2">Department</label>
            <div className="space-y-1.5 text-xs text-slate-600">
              {['All', 'Industries Department', 'MIDC', 'Energy Department', 'Skill Development Department', 'Environment & Energy'].map((dept) => (
                <label key={dept} className="flex items-center space-x-2 cursor-pointer hover:text-slate-900">
                  <input
                    type="radio"
                    name="scheme-dept"
                    checked={selectedDept === dept}
                    onChange={() => setSelectedDept(dept)}
                    className="text-blue-600 focus:ring-blue-500 rounded border-slate-300"
                  />
                  <span>{dept === 'All' ? 'All Departments' : dept}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Beneficiary Filter */}
          <div className="pt-3 border-t border-slate-100">
            <label className="block text-xs font-bold text-slate-700 mb-2">Target Beneficiary</label>
            <div className="space-y-1.5 text-xs text-slate-600">
              {['All', 'MSME', 'All Industries', 'Manufacturing', 'Export Units'].map((ben) => (
                <label key={ben} className="flex items-center space-x-2 cursor-pointer hover:text-slate-900">
                  <input
                    type="radio"
                    name="scheme-ben"
                    checked={selectedBeneficiary === ben}
                    onChange={() => setSelectedBeneficiary(ben)}
                    className="text-blue-600 focus:ring-blue-500 rounded border-slate-300"
                  />
                  <span>{ben === 'All' ? 'All Beneficiaries' : ben}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Scheme Type Filter */}
          <div className="pt-3 border-t border-slate-100">
            <label className="block text-xs font-bold text-slate-700 mb-2">Incentive Mechanism</label>
            <div className="space-y-1.5 text-xs text-slate-600">
              {['All', 'Subsidy', 'Land Support', 'Tax Benefit', 'Capacity Building', 'Interest Subsidy', 'Green Subsidy'].map((type) => (
                <label key={type} className="flex items-center space-x-2 cursor-pointer hover:text-slate-900">
                  <input
                    type="radio"
                    name="scheme-type"
                    checked={selectedType === type}
                    onChange={() => setSelectedType(type)}
                    className="text-blue-600 focus:ring-blue-500 rounded border-slate-300"
                  />
                  <span>{type === 'All' ? 'All Types' : type}</span>
                </label>
              ))}
            </div>
          </div>
        </aside>

        {/* Right Schemes Listing (9 cols) */}
        <section className="lg:col-span-9 space-y-4">
          <div className="bg-white border border-slate-200 rounded-lg px-4 py-2.5 flex items-center justify-between text-xs text-slate-600">
            <span>
              Showing <strong className="text-slate-900 font-bold">{filteredSchemes.length}</strong> of {MOCK_SCHEMES.length} active government schemes
            </span>
            <span className="text-[11px] text-slate-500 font-medium">Direct Benefit Transfer (DBT) Ready</span>
          </div>

          {filteredSchemes.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-lg p-10 text-center space-y-3">
              <p className="text-sm font-semibold text-slate-700">No schemes found matching your criteria.</p>
              <button
                type="button"
                onClick={handleResetFilters}
                className="px-3 py-1.5 bg-blue-50 text-blue-700 rounded text-xs font-semibold hover:bg-blue-100"
              >
                Clear all filters
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filteredSchemes.map((scheme) => (
                <article
                  key={scheme.id}
                  className="bg-white border border-slate-200 rounded-lg p-4 shadow-2xs hover:border-amber-300 hover:shadow-xs transition flex flex-col justify-between"
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-50 text-amber-900 border border-amber-200 font-mono">
                        {scheme.code}
                      </span>
                      <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">
                        {scheme.shortDept}
                      </span>
                    </div>

                    <h3 className="text-sm font-bold text-slate-900 leading-snug">
                      {scheme.title}
                    </h3>
                    <p className="text-xs text-slate-600 leading-relaxed line-clamp-3">
                      {scheme.description}
                    </p>

                    <div className="flex flex-wrap gap-1.5 pt-1">
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-blue-50 text-blue-700">
                        {scheme.schemeType}
                      </span>
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-emerald-50 text-emerald-700">
                        {scheme.beneficiary}
                      </span>
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-600">
                        {scheme.scope}
                      </span>
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between">
                    <span className="text-[10px] font-bold text-emerald-700 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                      Open for Application
                    </span>

                    <Link
                      to={`/schemes/${scheme.id === 'msme-competitiveness' ? 'msme-competitiveness' : 'msme-competitiveness'}`}
                      className="inline-flex items-center space-x-1 px-3 py-1 rounded bg-amber-50 hover:bg-amber-600 text-amber-800 hover:text-white font-semibold text-xs transition border border-amber-200 hover:border-amber-600"
                    >
                      <span>View Details</span>
                      <span className="font-bold">→</span>
                    </Link>
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
