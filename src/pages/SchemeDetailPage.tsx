import React, { useState } from 'react';
import { Link } from '../router/Router';

export const SchemeDetailPage: React.FC = () => {
  const [showApplyModal, setShowApplyModal] = useState(false);

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6" data-purpose="scheme-detail-screen">
      {/* Breadcrumb */}
      <nav aria-label="Breadcrumb" className="flex items-center space-x-1.5 text-xs text-slate-500 mb-4">
        <Link to="/" className="hover:text-[#0f2b48] transition-colors">Home</Link>
        <span className="text-slate-400">›</span>
        <Link to="/schemes" className="hover:text-[#0f2b48] transition-colors">Government Schemes</Link>
        <span className="text-slate-400">›</span>
        <span aria-current="page" className="text-slate-800 font-medium">MSME Competitiveness Scheme</span>
      </nav>

      {/* Header Banner */}
      <div className="bg-white border border-slate-200 rounded-lg p-5 sm:p-6 mb-6 shadow-2xs">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-start space-x-4">
            <div className="w-12 h-12 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 flex items-center justify-center shrink-0">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 font-mono">
                  SCH-IND-01
                </span>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-blue-50 text-blue-800">
                  Industries Department
                </span>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                  State Fiscal Support
                </span>
              </div>
              <h1 className="text-xl sm:text-2xl font-bold text-[#0f2b48] tracking-tight font-serif">
                MSME Competitiveness Scheme
              </h1>
              <p className="text-xs text-slate-600 mt-1 max-w-2xl leading-relaxed">
                Financial assistance and capital subsidy for technology upgradation, quality certification, energy efficiency, and modern production methods for micro, small, and medium enterprises.
              </p>
            </div>
          </div>

          <div className="flex sm:flex-col items-end gap-2 shrink-0">
            <Link
              to="/login?redirect=/schemes/msme-competitiveness"
              className="px-4 py-2 bg-[#0f2b48] hover:bg-slate-800 text-white text-xs font-bold rounded shadow-xs transition"
            >
              Login to Apply
            </Link>
            <span className="text-[10px] text-slate-400 font-medium">Single Window Authentication</span>
          </div>
        </div>
      </div>

      {/* Grid: 8 cols left, 4 cols right */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Overview & Key Highlights */}
        <div className="lg:col-span-8 space-y-5">
          {/* Overview Card */}
          <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-2xs space-y-4">
            <h3 className="text-sm font-bold text-[#0f2b48] border-b border-slate-100 pb-2">
              Scheme Overview &amp; Objectives
            </h3>
            <p className="text-xs text-slate-700 leading-relaxed">
              The MSME Competitiveness Scheme is designed to catalyze industrial modernization, product innovation, and lean manufacturing standards among micro, small, and medium industrial units located within Maharashtra. By providing targeted capital subsidies, the scheme lowers the cost of acquiring clean, automated machinery and globally recognized quality certifications (ISO, CE, ZED).
            </p>

            {/* Key Highlights (Reference points) */}
            <div className="pt-2">
              <h4 className="text-xs font-bold text-slate-900 mb-2.5">Key Highlights</h4>
              <div className="space-y-2">
                {[
                  'Financial assistance for eligible micro, small, and medium enterprises (MSME)',
                  'Direct capital subsidy support for technology upgradation and plant modernization',
                  'Applicable across notified manufacturing and high-value service sectors',
                  'Subsidies disbursed directly into beneficiary business bank accounts via verified DBT',
                  'Administered under Directorate of Industries guidelines and standard operating procedures'
                ].map((highlight, idx) => (
                  <div key={idx} className="flex items-start space-x-2.5 text-xs text-slate-700">
                    <span className="text-emerald-600 font-bold mt-0.5">✓</span>
                    <span className="leading-snug">{highlight}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Indicative Notice Note */}
            <div className="bg-amber-50/80 border border-amber-200 rounded p-3.5 text-xs text-amber-900">
              <span className="font-bold">Indicative Terms Notice:</span>
              <p className="mt-0.5 text-amber-800">
                Eligibility conditions, subsidy percentages, and disbursement tranches are governed by the operational Government Resolutions (GR) issued by the Industries, Energy and Labour Department.
              </p>
            </div>
          </div>

          {/* Eligibility Criteria */}
          <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-2xs space-y-3 text-xs text-slate-700">
            <h3 className="text-sm font-bold text-[#0f2b48] border-b border-slate-100 pb-2">
              Indicative Eligibility Criteria
            </h3>
            <ul className="list-disc pl-5 space-y-1.5 text-slate-600 leading-relaxed">
              <li>Must hold a valid Udyam Registration Certificate with operational plant in Maharashtra.</li>
              <li>Unit must have been in active commercial production for at least 12 months prior to filing.</li>
              <li>Proposed plant machinery must be brand new and verifiable by technical chartered engineer.</li>
              <li>Enterprise must possess valid statutory clearances (Consent to Operate, Factory Licence where applicable).</li>
            </ul>
          </div>
        </div>

        {/* Right: Important Dates & Agency */}
        <div className="lg:col-span-4 space-y-4">
          <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-2xs space-y-3">
            <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider pb-2 border-b border-slate-200">
              Important Dates &amp; Meta
            </h3>

            <div className="space-y-2.5 text-xs">
              <div className="flex justify-between py-1 border-b border-slate-100">
                <span className="text-slate-500">Application Window:</span>
                <span className="font-bold text-slate-800">Rolling / Open</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-100">
                <span className="text-slate-500">Benefit Type:</span>
                <span className="font-semibold text-slate-800">Capital Subsidy</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-100">
                <span className="text-slate-500">Implementing Agency:</span>
                <span className="font-semibold text-slate-800 text-right">Directorate of Industries</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-100">
                <span className="text-slate-500">Disbursement Mode:</span>
                <span className="font-semibold text-emerald-700">Aadhaar/PAN DBT</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-slate-500">SLA Scrutiny:</span>
                <span className="font-semibold text-slate-800">45 Working Days</span>
              </div>
            </div>

            <div className="pt-2 space-y-2">
              <button
                type="button"
                onClick={() => setShowApplyModal(true)}
                className="w-full py-2 bg-[#f58220] hover:bg-[#e07110] text-white text-xs font-bold rounded shadow-xs transition"
              >
                Apply for Incentive
              </button>
              <button
                type="button"
                onClick={() => alert('Scheme Operational Guidelines (PDF) will be downloaded from verified Directorate repository.')}
                className="w-full py-2 bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 text-xs font-semibold rounded transition"
              >
                Download Guidelines (PDF)
              </button>
            </div>
          </div>

          <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-2 text-xs">
            <h4 className="font-bold text-slate-900">District DIC Assistance</h4>
            <p className="text-slate-600 text-[11px] leading-relaxed">
              District Industries Centre (DIC) General Managers offer free on-ground documentation validation.
            </p>
            <div className="pt-1">
              <Link to="/contact" className="text-xs font-semibold text-blue-700 hover:underline">
                View DIC Directory →
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Modal */}
      {showApplyModal && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div className="bg-white rounded-lg shadow-2xl max-w-md w-full p-6 border border-slate-200">
            <div className="flex items-start justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center space-x-2">
                <span className="text-xl">🏛️</span>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Scheme Application Gateway</h3>
                  <p className="text-[11px] text-slate-500">Authentication Required (Phase 2)</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowApplyModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1"
              >
                ✕
              </button>
            </div>
            <div className="py-4 text-xs text-slate-600 space-y-3 leading-relaxed">
              <p>
                To file an application under the <strong>MSME Competitiveness Scheme</strong>, enterprises must authenticate using an authorized signatory mobile OTP or login credentials.
              </p>
              <p>
                Full applicant login and profile registration will be live upon completion of <strong>Phase 2: Authentication</strong>.
              </p>
            </div>
            <div className="pt-3 border-t border-slate-100 flex justify-end">
              <button
                type="button"
                onClick={() => setShowApplyModal(false)}
                className="px-4 py-2 bg-[#0f2b48] text-white rounded text-xs font-semibold hover:bg-slate-800 transition"
              >
                Back to Public Portal
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
