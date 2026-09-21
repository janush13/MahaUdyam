import React, { useState, useMemo } from 'react';
import { Link } from '../router/Router';
import { MOCK_FAQS } from '../data/mockData';

export const HelpPage: React.FC = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [expandedFaq, setExpandedFaq] = useState<string | null>('faq-1');
  const [activeNoticeModal, setActiveNoticeModal] = useState<string | null>(null);

  const categories = ['All', 'General Overview', 'Registration & Login', 'Approvals & Applications', 'Schemes & Incentives'];

  const filteredFaqs = useMemo(() => {
    return MOCK_FAQS.filter((faq) => {
      const q = searchQuery.toLowerCase();
      const matchesSearch =
        !q ||
        faq.question.toLowerCase().includes(q) ||
        faq.answer.toLowerCase().includes(q);

      const matchesCat = selectedCategory === 'All' || faq.category === selectedCategory;

      return matchesSearch && matchesCat;
    });
  }, [searchQuery, selectedCategory]);

  const toggleFaq = (id: string) => {
    setExpandedFaq(expandedFaq === id ? null : id);
  };

  const handleResourceClick = (name: string) => {
    setActiveNoticeModal(`The authoritative resource "${name}" is scheduled for full document repository integration in future releases. For current guidance, refer to the Notices & Circulars repository.`);
  };

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6" data-purpose="help-support-screen">
      {/* Breadcrumb */}
      <nav aria-label="Breadcrumb" className="flex items-center space-x-1.5 text-xs text-slate-500 mb-4">
        <Link to="/" className="hover:text-[#0f2b48] transition-colors">Home</Link>
        <span className="text-slate-400">›</span>
        <span aria-current="page" className="text-slate-800 font-medium">Help &amp; Support</span>
      </nav>

      {/* Header & Search */}
      <div className="bg-white border border-slate-200 rounded-lg p-6 mb-6 shadow-2xs">
        <div className="max-w-2xl">
          <h1 className="text-2xl font-bold text-[#0f2b48] tracking-tight font-serif">
            Help &amp; Investor Support
          </h1>
          <p className="text-xs text-slate-600 mt-1">
            Browse user guides, frequently asked questions, statutory forms, and procedural manuals
          </p>

          <div className="mt-4 relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search help topics, questions, procedures..."
              className="w-full text-xs bg-slate-50 border border-slate-300 rounded-md px-3.5 py-2.5 pl-9 text-slate-800 placeholder-slate-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-600 shadow-2xs"
            />
            <svg
              className="w-4 h-4 text-slate-400 absolute left-3 top-3"
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
                className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600 text-xs"
              >
                ✕
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 4 Interactive Resource Tiles */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <button
          type="button"
          onClick={() => handleResourceClick('User Manual & Single Window Walkthrough')}
          className="text-left bg-white border border-slate-200 rounded-lg p-4 shadow-2xs hover:border-blue-300 hover:shadow-xs transition group cursor-pointer"
        >
          <div className="w-10 h-10 rounded-md bg-blue-50 text-blue-700 flex items-center justify-center mb-2.5 group-hover:bg-blue-600 group-hover:text-white transition">
            📖
          </div>
          <h3 className="text-xs font-bold text-slate-900 group-hover:text-blue-700">User Guides</h3>
          <p className="text-[11px] text-slate-500 mt-1">
            Step-by-step PDF manuals for applicant registration and CAF filing.
          </p>
          <span className="text-[10px] text-blue-700 font-semibold mt-2.5 block">Explore Manuals →</span>
        </button>

        <button
          type="button"
          onClick={() => handleResourceClick('Statutory Standard Forms & Affidavits')}
          className="text-left bg-white border border-slate-200 rounded-lg p-4 shadow-2xs hover:border-blue-300 hover:shadow-xs transition group cursor-pointer"
        >
          <div className="w-10 h-10 rounded-md bg-emerald-50 text-emerald-700 flex items-center justify-center mb-2.5 group-hover:bg-emerald-600 group-hover:text-white transition">
            📝
          </div>
          <h3 className="text-xs font-bold text-slate-900 group-hover:text-emerald-700">Forms &amp; Templates</h3>
          <p className="text-[11px] text-slate-500 mt-1">
            Downloadable formats for CA investment certificates and affidavits.
          </p>
          <span className="text-[10px] text-emerald-700 font-semibold mt-2.5 block">View Templates →</span>
        </button>

        <Link
          to="/notices"
          className="text-left bg-white border border-slate-200 rounded-lg p-4 shadow-2xs hover:border-blue-300 hover:shadow-xs transition group"
        >
          <div className="w-10 h-10 rounded-md bg-amber-50 text-amber-700 flex items-center justify-center mb-2.5 group-hover:bg-amber-600 group-hover:text-white transition">
            ⚖️
          </div>
          <h3 className="text-xs font-bold text-slate-900 group-hover:text-amber-700">Regulatory Info</h3>
          <p className="text-[11px] text-slate-500 mt-1">
            Maharashtra RTS Act 2015, statutory SLA schedules and orders.
          </p>
          <span className="text-[10px] text-amber-700 font-semibold mt-2.5 block">Browse Acts →</span>
        </Link>

        <Link
          to="/contact"
          className="text-left bg-white border border-slate-200 rounded-lg p-4 shadow-2xs hover:border-blue-300 hover:shadow-xs transition group"
        >
          <div className="w-10 h-10 rounded-md bg-purple-50 text-purple-700 flex items-center justify-center mb-2.5 group-hover:bg-purple-600 group-hover:text-white transition">
            🎧
          </div>
          <h3 className="text-xs font-bold text-slate-900 group-hover:text-purple-700">Investor Helpdesk</h3>
          <p className="text-[11px] text-slate-500 mt-1">
            Submit a support query or contact regional DIC grievance officers.
          </p>
          <span className="text-[10px] text-purple-700 font-semibold mt-2.5 block">Get in Touch →</span>
        </Link>
      </div>

      {/* FAQ Section */}
      <div className="bg-white border border-slate-200 rounded-lg p-6 shadow-2xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-200 gap-3">
          <div>
            <h2 className="text-base font-bold text-[#0f2b48]">Frequently Asked Questions</h2>
            <p className="text-xs text-slate-500 mt-0.5">Quick answers to common investor questions</p>
          </div>

          {/* Category Chips */}
          <div className="flex flex-wrap gap-1.5">
            {categories.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setSelectedCategory(cat)}
                className={`px-2.5 py-1 text-xs font-medium rounded-full transition ${
                  selectedCategory === cat
                    ? 'bg-blue-800 text-white font-semibold'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* Accordion Items */}
        <div className="divide-y divide-slate-100 mt-2">
          {filteredFaqs.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-500">
              No answers matched your query. Please try searching different keywords or contact our helpdesk.
            </div>
          ) : (
            filteredFaqs.map((faq) => {
              const isOpen = expandedFaq === faq.id;
              return (
                <div key={faq.id} className="py-3.5">
                  <button
                    type="button"
                    onClick={() => toggleFaq(faq.id)}
                    className="w-full flex items-center justify-between text-left group focus:outline-none"
                  >
                    <span className="text-xs sm:text-sm font-bold text-slate-800 group-hover:text-blue-700 transition">
                      {faq.question}
                    </span>
                    <span className="text-slate-400 group-hover:text-slate-700 text-sm ml-2 font-mono">
                      {isOpen ? '−' : '+'}
                    </span>
                  </button>
                  {isOpen && (
                    <div className="mt-2 text-xs text-slate-600 leading-relaxed pl-2 border-l-2 border-blue-600 whitespace-pre-line">
                      {faq.answer}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Future Resource Modal */}
      {activeNoticeModal && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-5 border border-slate-200">
            <h3 className="text-sm font-bold text-slate-900 mb-2">Resource Repository Notice</h3>
            <p className="text-xs text-slate-600 leading-relaxed mb-4">
              {activeNoticeModal}
            </p>
            <div className="flex justify-end space-x-2">
              <button
                type="button"
                onClick={() => setActiveNoticeModal(null)}
                className="px-4 py-1.5 bg-[#0f2b48] text-white text-xs font-semibold rounded"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
