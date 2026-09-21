import React, { useState, useMemo } from 'react';
import { Link } from '../router/Router';
import { MOCK_NOTICES } from '../data/mockData';
import { NoticeItem } from '../types';

export const NoticesPage: React.FC = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [selectedNotice, setSelectedNotice] = useState<NoticeItem | null>(null);

  const categories = ['All', 'Notification', 'Circular', 'Update', 'Guideline', 'Order'];

  const filteredNotices = useMemo(() => {
    return MOCK_NOTICES.filter((item) => {
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch =
        !q ||
        item.title.toLowerCase().includes(q) ||
        item.refNo.toLowerCase().includes(q) ||
        item.department.toLowerCase().includes(q) ||
        item.summary.toLowerCase().includes(q);

      const matchesCat = selectedCategory === 'All' || item.category === selectedCategory;

      return matchesSearch && matchesCat;
    });
  }, [searchQuery, selectedCategory]);

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6" data-purpose="notices-screen">
      {/* Breadcrumb */}
      <nav aria-label="Breadcrumb" className="flex items-center space-x-1.5 text-xs text-slate-500 mb-4">
        <Link to="/" className="hover:text-[#0f2b48] transition-colors">Home</Link>
        <span className="text-slate-400">›</span>
        <span aria-current="page" className="text-slate-800 font-medium">Notices &amp; Circulars</span>
      </nav>

      {/* Header Banner */}
      <div className="bg-white border border-slate-200 rounded-lg p-5 sm:p-6 mb-6 shadow-2xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-[#0f2b48] tracking-tight font-serif">
              Notices &amp; Circulars Repository
            </h1>
            <p className="text-xs text-slate-600 mt-1">
              Official Government Resolutions, statutory notifications, and operational directives
            </p>
          </div>

          {/* Search Box */}
          <div className="w-full md:w-80 relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search circulars, GR number, keywords..."
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

        {/* Filter Category Chips */}
        <div className="flex flex-wrap gap-2 mt-4 pt-3 border-t border-slate-100">
          {categories.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setSelectedCategory(cat)}
              className={`px-3 py-1 text-xs font-semibold rounded-full transition ${
                selectedCategory === cat
                  ? 'bg-blue-800 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {cat === 'All' ? 'All Gazettes & Notices' : cat}
            </button>
          ))}
        </div>
      </div>

      {/* 3 Callout Cards: Gazette Verification, Historical Archive, Authenticity Seal */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-white border border-slate-200 rounded-lg p-3.5 shadow-2xs flex items-start space-x-3">
          <span className="text-xl">📜</span>
          <div>
            <h3 className="text-xs font-bold text-slate-900">Gazette Verification</h3>
            <p className="text-[11px] text-slate-500 mt-0.5 leading-tight">
              Directly cross-referenced with Maharashtra Government Extraordinary Gazette.
            </p>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-3.5 shadow-2xs flex items-start space-x-3">
          <span className="text-xl">🗄️</span>
          <div>
            <h3 className="text-xs font-bold text-slate-900">Historical Archive</h3>
            <p className="text-[11px] text-slate-500 mt-0.5 leading-tight">
              Repository preserved under State Archives digital preservation mandate.
            </p>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-3.5 shadow-2xs flex items-start space-x-3">
          <span className="text-xl">🛡️</span>
          <div>
            <h3 className="text-xs font-bold text-slate-900">Authenticity Seal</h3>
            <p className="text-[11px] text-slate-500 mt-0.5 leading-tight">
              Cryptographically verified PDF downloads with digital time-stamping.
            </p>
          </div>
        </div>
      </div>

      {/* Notices Table / List */}
      <div className="bg-white border border-slate-200 rounded-lg shadow-2xs overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between text-xs text-slate-600">
          <span>
            Displaying <strong className="text-slate-900 font-bold">{filteredNotices.length}</strong> official records
          </span>
          <span className="text-[11px] text-slate-400">Click any entry to view full summary</span>
        </div>

        <div className="divide-y divide-slate-200">
          {filteredNotices.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500">
              No notices found matching your search.
            </div>
          ) : (
            filteredNotices.map((notice) => (
              <div
                key={notice.id}
                onClick={() => setSelectedNotice(notice)}
                className="p-4 hover:bg-blue-50/40 transition cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-3 group"
              >
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-mono text-[11px] font-bold text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">
                      {notice.refNo}
                    </span>
                    <span className="text-slate-400 font-mono text-[11px]">
                      {notice.date}
                    </span>
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-100 text-blue-800">
                      {notice.category}
                    </span>
                  </div>

                  <h3 className="text-xs sm:text-sm font-bold text-slate-900 group-hover:text-blue-700 transition">
                    {notice.title}
                  </h3>
                  <p className="text-xs text-slate-500">
                    {notice.department} • Effective: {notice.effectiveDate}
                  </p>
                </div>

                <div className="flex items-center space-x-3 shrink-0 sm:text-right">
                  <span className="text-[11px] text-slate-400 font-mono">
                    {notice.pdfSize}
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedNotice(notice);
                    }}
                    className="px-3 py-1 bg-white border border-slate-300 group-hover:border-blue-500 text-slate-700 group-hover:text-blue-700 rounded text-xs font-semibold shadow-2xs transition"
                  >
                    View Record
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Notice Detail Modal */}
      {selectedNotice && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div className="bg-white rounded-lg shadow-2xl max-w-lg w-full p-6 border border-slate-200">
            <div className="flex items-start justify-between pb-3 border-b border-slate-200">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] font-bold font-mono px-1.5 py-0.5 rounded bg-blue-100 text-blue-800">
                    {selectedNotice.refNo}
                  </span>
                  <span className="text-[10px] text-slate-500 font-mono">
                    {selectedNotice.date}
                  </span>
                </div>
                <h3 className="text-sm font-bold text-slate-900 leading-snug">
                  {selectedNotice.title}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedNotice(null)}
                className="text-slate-400 hover:text-slate-600 p-1"
              >
                ✕
              </button>
            </div>

            <div className="py-4 space-y-3 text-xs text-slate-700">
              <div>
                <span className="font-bold text-slate-900 block mb-0.5">Issuing Department:</span>
                <span className="text-slate-600">{selectedNotice.department}</span>
              </div>

              <div>
                <span className="font-bold text-slate-900 block mb-0.5">Executive Summary:</span>
                <p className="leading-relaxed text-slate-600 bg-slate-50 p-2.5 rounded border border-slate-200">
                  {selectedNotice.summary}
                </p>
              </div>

              {selectedNotice.relatedActs && (
                <div>
                  <span className="font-bold text-slate-900 block mb-1">Associated Acts &amp; Regulations:</span>
                  <ul className="list-disc pl-4 space-y-0.5 text-slate-600 text-[11px]">
                    {selectedNotice.relatedActs.map((act, i) => (
                      <li key={i}>{act}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="flex justify-between items-center text-[11px] text-slate-500 pt-2 border-t border-slate-100">
                <span>Effective Date: <strong>{selectedNotice.effectiveDate}</strong></span>
                <span>File Size: <strong>{selectedNotice.pdfSize}</strong></span>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
              <span className="text-[10px] text-emerald-700 font-semibold flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                Official Gazette Certified
              </span>

              <div className="flex items-center space-x-2">
                <button
                  type="button"
                  onClick={() => alert(`Verified Gazette Document ${selectedNotice.refNo} (PDF) will be downloaded from the state archive.`)}
                  className="px-3 py-1.5 bg-blue-50 text-blue-700 hover:bg-blue-100 rounded text-xs font-semibold transition"
                >
                  Download Gazette (PDF)
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedNotice(null)}
                  className="px-3 py-1.5 bg-[#0f2b48] text-white rounded text-xs font-semibold hover:bg-slate-800 transition"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
