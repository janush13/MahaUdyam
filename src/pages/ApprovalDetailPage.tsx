import React, { useState } from 'react';
import { Link, useRouter } from '../router/Router';
import { useAuth } from '../context/AuthContext';
import { applicationService } from '../services/applicationService';

const CTE_APPLICATION_PATH = '/applicant/applications/cte';

export const ApprovalDetailPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'overview' | 'eligibility' | 'documents' | 'process'>('overview');
  const { isAuthenticated, user } = useAuth();
  const { navigate } = useRouter();

  const handleStartApplication = () => {
    if (isAuthenticated && user?.role === 'APPLICANT') {
      applicationService.getOrCreateDraftApplication();
      applicationService.setCurrentStep(1);
      navigate(CTE_APPLICATION_PATH);
      return;
    }

    navigate(`/login?redirect=${encodeURIComponent(CTE_APPLICATION_PATH)}`);
  };

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6" data-purpose="approval-detail-screen">
      {/* Breadcrumb */}
      <nav aria-label="Breadcrumb" className="flex items-center space-x-1.5 text-xs text-slate-500 mb-4">
        <Link to="/" className="hover:text-[#0f2b48] transition-colors">Home</Link>
        <span className="text-slate-400">›</span>
        <Link to="/approvals" className="hover:text-[#0f2b48] transition-colors">Industrial Approvals</Link>
        <span className="text-slate-400">›</span>
        <span aria-current="page" className="text-slate-800 font-medium">Consent to Establish (CTE)</span>
      </nav>

      {/* Detail Header Hero Card */}
      <div className="bg-white border border-slate-200 rounded-lg p-5 sm:p-6 mb-6 shadow-2xs">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-start space-x-4">
            <div className="w-12 h-12 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 flex items-center justify-center shrink-0">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-100 text-blue-800 font-mono">
                  SERVICE CODE: CTE-01
                </span>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-700">
                  Environment Department
                </span>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
                  MPCB Integrated
                </span>
              </div>
              <h1 className="text-xl sm:text-2xl font-bold text-[#0f2b48] tracking-tight font-serif">
                Consent to Establish (CTE)
              </h1>
              <p className="text-xs text-slate-600 mt-1 max-w-2xl leading-relaxed">
                Statutory permission under Water (Prevention &amp; Control of Pollution) Act 1974 and Air (Prevention &amp; Control of Pollution) Act 1981 to construct or establish an industrial plant in Maharashtra.
              </p>
            </div>
          </div>

          <div className="flex sm:flex-col items-end gap-2 shrink-0">
            <button
              type="button"
              onClick={handleStartApplication}
              className="px-4 py-2 bg-[#f58220] hover:bg-[#e07110] text-white text-xs font-bold rounded shadow-xs transition"
            >
              Start Application
            </button>
            <span className="text-[10px] text-slate-400 font-medium">Phase 6 Workflow</span>
          </div>
        </div>
      </div>

      {/* Content Layout: 8 cols left, 4 cols right */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Tabs & Body Details */}
        <div className="lg:col-span-8 space-y-5">
          {/* Tab Navigation */}
          <div className="bg-white border border-slate-200 rounded-lg p-1.5 flex items-center space-x-1 shadow-2xs">
            {[
              { id: 'overview', label: 'Overview' },
              { id: 'eligibility', label: 'Eligibility' },
              { id: 'documents', label: 'Required Documents' },
              { id: 'process', label: 'Process Steps' },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id as any)}
                className={`flex-1 py-2 text-xs font-semibold rounded transition text-center ${
                  activeTab === tab.id
                    ? 'bg-blue-800 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Tab Content Box */}
          <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-2xs space-y-4">
            {activeTab === 'overview' && (
              <div className="space-y-4 text-xs text-slate-700 leading-relaxed">
                <h3 className="text-sm font-bold text-[#0f2b48]">Service Overview</h3>
                <p>
                  Any person or enterprise intending to establish an industrial plant, manufacturing unit, or operation likely to discharge effluents or emit pollutants into the atmosphere is required to obtain prior statutory Consent to Establish (CTE) from the Maharashtra Pollution Control Board (MPCB).
                </p>
                <div className="bg-slate-50 border border-slate-200 rounded p-3.5 space-y-2">
                  <h4 className="text-xs font-bold text-slate-900">Legislative Mandate:</h4>
                  <ul className="list-disc pl-5 space-y-1 text-slate-600 text-xs">
                    <li>Section 25 of the Water (Prevention and Control of Pollution) Act, 1974</li>
                    <li>Section 21 of the Air (Prevention and Control of Pollution) Act, 1981</li>
                    <li>Environment (Protection) Act, 1986 &amp; hazardous waste management rules</li>
                  </ul>
                </div>
                <div className="pt-2">
                  <h4 className="text-xs font-bold text-slate-900 mb-2">Category Classification:</h4>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-xs">
                    <div className="p-2 rounded bg-red-50 text-red-800 border border-red-200 font-semibold">
                      Red Category
                      <span className="block text-[10px] text-red-600 font-normal">Score &gt; 60</span>
                    </div>
                    <div className="p-2 rounded bg-amber-50 text-amber-800 border border-amber-200 font-semibold">
                      Orange Category
                      <span className="block text-[10px] text-amber-600 font-normal">Score 41 - 59</span>
                    </div>
                    <div className="p-2 rounded bg-emerald-50 text-emerald-800 border border-emerald-200 font-semibold">
                      Green Category
                      <span className="block text-[10px] text-emerald-600 font-normal">Score 21 - 40</span>
                    </div>
                    <div className="p-2 rounded bg-slate-50 text-slate-700 border border-slate-200 font-semibold">
                      White Category
                      <span className="block text-[10px] text-slate-500 font-normal">Score up to 20</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'eligibility' && (
              <div className="space-y-4 text-xs text-slate-700 leading-relaxed">
                <h3 className="text-sm font-bold text-[#0f2b48]">Eligibility Criteria</h3>
                <ul className="list-disc pl-5 space-y-2 text-slate-600">
                  <li>Valid title / allotment letter / registered lease agreement for proposed industrial plot.</li>
                  <li>Proposed land zone must conform to Industrial Classification under Local Planning Authority / MIDC.</li>
                  <li>Clear manufacturing process flow sheet indicating raw materials, water balance, and emissions.</li>
                  <li>Proposed effluent treatment plant (ETP) or sewage treatment plant (STP) design specifications.</li>
                </ul>
              </div>
            )}

            {activeTab === 'documents' && (
              <div className="space-y-4 text-xs text-slate-700 leading-relaxed">
                <h3 className="text-sm font-bold text-[#0f2b48]">Mandatory Document Checklist</h3>
                <div className="space-y-2">
                  {[
                    'Land possession receipt / MIDC Allotment letter / Sale deed',
                    'Detailed Project Report (DPR) with process flow diagram',
                    'Plant layout plan clearly demarcating proposed ETP / STP location',
                    'Capital Investment certificate certified by Chartered Accountant (CA)',
                    'Water balance sheet and source confirmation letter',
                  ].map((doc, idx) => (
                    <div key={idx} className="flex items-center space-x-2.5 p-2 bg-slate-50 rounded border border-slate-200">
                      <span className="w-5 h-5 rounded-full bg-blue-100 text-blue-800 text-[10px] font-bold flex items-center justify-center shrink-0">
                        {idx + 1}
                      </span>
                      <span className="text-slate-800 font-medium">{doc}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {activeTab === 'process' && (
              <div className="space-y-4 text-xs text-slate-700 leading-relaxed">
                <h3 className="text-sm font-bold text-[#0f2b48]">Step-by-Step Procedure</h3>
                <div className="space-y-3">
                  <div className="border-l-2 border-blue-600 pl-3">
                    <span className="text-blue-700 font-bold block">Step 1: Online Application Filing</span>
                    <span className="text-slate-600">Submit Combined Application Form (CAF) along with uploaded documents.</span>
                  </div>
                  <div className="border-l-2 border-blue-600 pl-3">
                    <span className="text-blue-700 font-bold block">Step 2: Department Scrutiny</span>
                    <span className="text-slate-600">MPCB Sub-Regional Officer examines technical drawings within 7 days.</span>
                  </div>
                  <div className="border-l-2 border-blue-600 pl-3">
                    <span className="text-blue-700 font-bold block">Step 3: Joint Inspection (if applicable)</span>
                    <span className="text-slate-600">Site verification conducted by appointed field officer under CIS guidelines.</span>
                  </div>
                  <div className="border-l-2 border-blue-600 pl-3">
                    <span className="text-blue-700 font-bold block">Step 4: Digital Approval &amp; Certificate Issue</span>
                    <span className="text-slate-600">Digitally signed CTE issued directly to applicant portal locker within 30 days.</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Official Advisory Banner */}
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3.5 flex items-start space-x-3 text-xs text-amber-900">
            <span className="text-amber-600 text-sm font-bold shrink-0">ℹ️</span>
            <div>
              <span className="font-bold">Official Statutory Advisory:</span>
              <p className="mt-0.5 text-amber-800">
                This service description is provided for investor guidance. Applicants must not commence civil construction on-site until the formal Consent to Establish is granted by MPCB under Section 25/26 of the Water Act.
              </p>
            </div>
          </div>
        </div>

        {/* Right Column: Key Information & Quick Actions */}
        <div className="lg:col-span-4 space-y-4">
          <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-2xs space-y-3">
            <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider pb-2 border-b border-slate-200">
              Key Information
            </h3>

            <div className="space-y-2.5 text-xs">
              <div className="flex justify-between py-1 border-b border-slate-100">
                <span className="text-slate-500">Department:</span>
                <span className="font-semibold text-slate-800 text-right">Environment Department</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-100">
                <span className="text-slate-500">Executing Board:</span>
                <span className="font-semibold text-slate-800 text-right">MPCB</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-100">
                <span className="text-slate-500">Statutory SLA:</span>
                <span className="font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded">30 Days</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-100">
                <span className="text-slate-500">Processing Fee:</span>
                <span className="font-semibold text-slate-800">Graded by Capital Inv.</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-100">
                <span className="text-slate-500">Application Mode:</span>
                <span className="font-semibold text-blue-700">100% Online</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-slate-500">Validity:</span>
                <span className="font-semibold text-slate-800">5 Years / Commissioning</span>
              </div>
            </div>

            <div className="pt-2">
              <button
                type="button"
                onClick={handleStartApplication}
                className="w-full py-2 bg-[#0f2b48] hover:bg-slate-800 text-white text-xs font-semibold rounded shadow-xs transition"
              >
                Apply Online (Single Window)
              </button>
            </div>
          </div>

          {/* Need Help Card */}
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-2 text-xs">
            <h4 className="font-bold text-slate-900">Have Questions?</h4>
            <p className="text-slate-600 text-[11px] leading-relaxed">
              Connect with our MPCB technical liaison desk for industrial classification guidance.
            </p>
            <div className="pt-1">
              <Link to="/contact" className="text-xs font-semibold text-blue-700 hover:underline">
                Contact Environment Helpdesk →
              </Link>
            </div>
          </div>
        </div>
      </div>

    </div>
  );
};
