import React from 'react';
import { Link } from '../router/Router';

export const AboutPage: React.FC = () => {
  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6" data-purpose="about-page-container">
      {/* Breadcrumb */}
      <nav aria-label="Breadcrumb" className="flex items-center space-x-1.5 text-xs text-slate-500 mb-5">
        <Link to="/" className="hover:text-[#0f2b48] transition-colors">Home</Link>
        <span className="text-slate-400">›</span>
        <span aria-current="page" className="text-slate-800 font-medium">About</span>
      </nav>

      {/* Main Page Headings */}
      <section className="mb-6" data-purpose="heading-section">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#0f2b48] font-serif">
          About MahaUdyam One
        </h1>
        <p className="text-sm sm:text-base text-slate-600 font-normal mt-1">
          A unified platform for a stronger, progressive Maharashtra
        </p>
      </section>

      {/* Main Two-Column Hero Grid */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start mb-8" data-purpose="hero-overview">
        {/* Left 2/3 Content: Description & Feature Matrix */}
        <div className="lg:col-span-8 flex flex-col space-y-6">
          <p className="text-slate-700 text-sm sm:text-[15px] leading-relaxed">
            MahaUdyam One is the Government of Maharashtra&apos;s integrated single window platform, enabling seamless access to industrial approvals, government schemes and regulatory information. Enacted to uphold the principles of transparent e-governance, time-bound delivery, and simplified investor facilitation, the portal unites over 25 state agencies under a common applicant experience.
          </p>

          {/* 4 Key Core Value Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
            {/* Card 1: Ease of Doing Business */}
            <div className="bg-white border border-slate-200 rounded-md p-4 shadow-xs hover:border-blue-300 transition-all flex flex-col items-start" data-purpose="feature-card">
              <div className="w-9 h-9 rounded-full bg-blue-50 text-blue-700 flex items-center justify-center mb-3">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </div>
              <h3 className="text-xs font-bold text-slate-900 leading-snug mb-1">Ease of Doing Business</h3>
              <p className="text-xs text-slate-500 leading-normal">
                Simplified, digitized, and strictly time-bound statutory clearances under Maharashtra RTSA 2015.
              </p>
            </div>

            {/* Card 2: Transparency */}
            <div className="bg-white border border-slate-200 rounded-md p-4 shadow-xs hover:border-blue-300 transition-all flex flex-col items-start" data-purpose="feature-card">
              <div className="w-9 h-9 rounded-full bg-blue-50 text-blue-700 flex items-center justify-center mb-3">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
              <h3 className="text-xs font-bold text-slate-900 leading-snug mb-1">Transparency</h3>
              <p className="text-xs text-slate-500 leading-normal">
                Real-time tracking, statutory SLA countdown clocks, and automated deemed clearance escalations.
              </p>
            </div>

            {/* Card 3: Investor Friendly */}
            <div className="bg-white border border-slate-200 rounded-md p-4 shadow-xs hover:border-blue-300 transition-all flex flex-col items-start" data-purpose="feature-card">
              <div className="w-9 h-9 rounded-full bg-blue-50 text-blue-700 flex items-center justify-center mb-3">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
              </div>
              <h3 className="text-xs font-bold text-slate-900 leading-snug mb-1">Investor Friendly</h3>
              <p className="text-xs text-slate-500 leading-normal">
                Single-submission document locker, end-to-end guidance, and direct liaison with District Investor Facilitation Cells.
              </p>
            </div>

            {/* Card 4: Sustainable Growth */}
            <div className="bg-white border border-slate-200 rounded-md p-4 shadow-xs hover:border-emerald-300 transition-all flex flex-col items-start" data-purpose="feature-card">
              <div className="w-9 h-9 rounded-full bg-emerald-50 text-emerald-700 flex items-center justify-center mb-3">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
              </div>
              <h3 className="text-xs font-bold text-slate-900 leading-snug mb-1">Sustainable Growth</h3>
              <p className="text-xs text-slate-500 leading-normal">
                Promoting green manufacturing, renewable power incentives, and responsible environmental compliance across industrial zones.
              </p>
            </div>
          </div>
        </div>

        {/* Right 1/3 Content: Civic Architecture Card */}
        <div className="lg:col-span-4" data-purpose="civic-image-container">
          <div className="relative rounded-lg overflow-hidden border border-slate-200 shadow-sm bg-slate-900 text-white p-5 flex flex-col justify-between min-h-[260px]">
            <div className="space-y-2 relative z-10">
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/20 text-amber-300 text-[10px] font-bold uppercase tracking-wider border border-amber-400/30">
                State Secretariat
              </div>
              <h3 className="text-base font-bold text-white leading-snug font-serif">
                Directorate of Industries, Mumbai
              </h3>
              <p className="text-xs text-slate-300 leading-relaxed">
                New Administrative Building, Madam Cama Road, Opposite Mantralaya, Mumbai - 400 032.
              </p>
            </div>

            <div className="pt-4 border-t border-slate-700/80 text-xs space-y-1 relative z-10">
              <div className="flex justify-between text-slate-300 text-[11px]">
                <span>Toll-Free Hotline:</span>
                <span className="font-bold text-white font-mono">1800 233 4567</span>
              </div>
              <div className="flex justify-between text-slate-300 text-[11px]">
                <span>Grievance Nodal Officer:</span>
                <span className="font-semibold text-white">Shri A. Deshmukh</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* BEGIN: ImportantNoticeBanner */}
      <section className="mt-2 mb-4" data-purpose="statutory-disclaimer">
        <div className="bg-amber-50/90 border-l-4 border-amber-500 border border-amber-200 rounded-r-md p-4 flex items-start space-x-3.5 shadow-2xs">
          <div className="shrink-0 mt-0.5 text-amber-600">
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" clipRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" />
            </svg>
          </div>
          <div>
            <h4 className="text-xs font-bold text-amber-950 mb-0.5">Statutory Governance Notice</h4>
            <p className="text-xs text-amber-900 leading-relaxed">
              MahaUdyam One is an orchestration and applicant-experience layer. Statutory approvals, scrutiny evaluations, field inspections, and legal decisions are taken by authorised government departments in accordance with applicable state and central acts.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
};
