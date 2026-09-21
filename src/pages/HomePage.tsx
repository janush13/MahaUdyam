import React from 'react';
import { Link, useRouter } from '../router/Router';

export const HomePage: React.FC = () => {
  const { navigate } = useRouter();

  const handleTrackApplication = (e: React.MouseEvent) => {
    e.preventDefault();
    navigate('/help');
  };

  return (
    <div className="flex-1 flex flex-col" data-purpose="public-home-screen">
      {/* BEGIN: HeroSection */}
      <section className="text-white relative overflow-hidden bg-gradient-to-r from-[#08284e] via-[#0d4177] to-[#155592] border-b border-slate-700">
        {/* Subtle dot pattern background */}
        <div
          aria-hidden="true"
          className="absolute inset-0 opacity-15 pointer-events-none"
          style={{
            backgroundImage: 'radial-gradient(rgba(255, 255, 255, 0.15) 1px, transparent 0)',
            backgroundSize: '24px 24px',
          }}
        />

        {/* Right side decorative silhouette motif */}
        <div
          aria-hidden="true"
          className="absolute right-0 bottom-0 top-0 w-1/3 opacity-15 pointer-events-none hidden md:block"
        >
          <svg className="w-full h-full object-cover" fill="currentColor" viewBox="0 0 400 400">
            <path d="M40 380 L40 180 L80 180 L80 120 L90 80 L100 120 L100 180 L140 180 L140 380 Z" opacity="0.4" />
            <path d="M130 380 L130 220 L160 220 L160 140 L190 80 L220 140 L220 220 L250 220 L250 380 Z" opacity="0.6" />
            <path d="M240 380 L240 160 L280 160 L280 110 L300 60 L320 110 L320 160 L360 160 L360 380 Z" opacity="0.4" />
            <circle cx="200" cy="60" fill="#f58220" opacity="0.3" r="14" />
          </svg>
        </div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-10 pb-7 relative z-10">
          <div className="max-w-2xl py-4">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 text-amber-300 text-xs font-semibold mb-3 border border-white/10">
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse"></span>
              Government of Maharashtra Enterprise Gateway
            </div>
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight leading-tight text-white mb-3 font-serif">
              Empowering Enterprises<br />
              Building a Prosperous<br />
              Maharashtra
            </h1>
            <p className="text-sm sm:text-base text-slate-200 font-normal leading-relaxed mb-6 max-w-xl">
              Your single window for industrial approvals, government schemes and business support services across 25+ integrated departments.
            </p>

            {/* Action Buttons */}
            <div className="flex flex-wrap items-center gap-3 mb-8">
              <Link
                to="/approvals"
                className="px-5 py-2.5 bg-[#f58220] hover:bg-[#e07110] text-white font-bold text-xs rounded shadow hover:shadow-md transition focus:ring-2 focus:ring-amber-400 focus:outline-none"
              >
                Apply for Approvals
              </Link>
              <Link
                to="/schemes"
                className="px-5 py-2.5 bg-transparent hover:bg-white/10 text-white font-semibold text-xs border border-white/80 rounded transition focus:ring-2 focus:ring-white focus:outline-none"
              >
                Explore Schemes
              </Link>
              <Link
                to="/how-it-works"
                className="px-4 py-2.5 text-slate-200 hover:text-white font-semibold text-xs flex items-center gap-1 hover:underline"
              >
                <span>How It Works</span>
                <span>→</span>
              </Link>
            </div>
          </div>

          {/* Integrated Statistics Strip */}
          <div className="pt-6 border-t border-white/15 grid grid-cols-2 md:grid-cols-4 gap-4 sm:gap-6">
            <div className="flex items-center space-x-3.5 bg-white/5 border border-white/10 rounded-md p-3">
              <div className="p-2 rounded bg-blue-500/20 text-sky-300">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                </svg>
              </div>
              <div>
                <div className="text-xl font-extrabold text-white tracking-tight leading-none font-mono">25+</div>
                <div className="text-xs text-slate-300 font-medium mt-1">Departments Onboarded</div>
              </div>
            </div>

            <div className="flex items-center space-x-3.5 bg-white/5 border border-white/10 rounded-md p-3">
              <div className="p-2 rounded bg-blue-500/20 text-sky-300">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <div className="text-xl font-extrabold text-white tracking-tight leading-none font-mono">100+</div>
                <div className="text-xs text-slate-300 font-medium mt-1">Approvals &amp; Clearances</div>
              </div>
            </div>

            <div className="flex items-center space-x-3.5 bg-white/5 border border-white/10 rounded-md p-3">
              <div className="p-2 rounded bg-blue-500/20 text-sky-300">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <div className="text-xl font-extrabold text-white tracking-tight leading-none font-mono">50+</div>
                <div className="text-xs text-slate-300 font-medium mt-1">Government Schemes</div>
              </div>
            </div>

            <div className="flex items-center space-x-3.5 bg-white/5 border border-white/10 rounded-md p-3">
              <div className="p-2 rounded bg-blue-500/20 text-sky-300">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <div>
                <div className="text-sm font-bold text-white tracking-tight leading-none">Single Window</div>
                <div className="text-xs text-slate-300 font-medium mt-1">Simpler, Faster, Transparent</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* BEGIN: KeyServicesSection */}
      <section className="py-10 bg-[#f8fafc]" data-purpose="key-services-section">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="mb-6 flex items-center justify-between border-b border-slate-200 pb-3">
            <div>
              <h2 className="text-xl font-bold text-[#0f2b48] tracking-tight">Key Services</h2>
              <p className="text-xs text-slate-500 mt-0.5">Direct portals and facilitation modules for industrial units in Maharashtra</p>
            </div>
            <Link to="/how-it-works" className="text-xs font-semibold text-blue-700 hover:underline flex items-center gap-1">
              <span>View 12-Step Process Flow</span>
              <span>→</span>
            </Link>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {/* Service 1: Industrial Approvals */}
            <div className="bg-white p-5 rounded-lg border border-slate-200 shadow-xs hover:border-blue-300 hover:shadow-md transition flex flex-col justify-between group">
              <div>
                <div className="w-11 h-11 rounded-lg bg-blue-50 border border-blue-100 text-blue-700 flex items-center justify-center mb-3.5 group-hover:bg-blue-600 group-hover:text-white transition">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                  </svg>
                </div>
                <h3 className="text-sm font-bold text-slate-900 mb-1 group-hover:text-blue-700 transition">
                  Industrial Approvals
                </h3>
                <p className="text-xs text-slate-600 leading-normal">
                  Apply, track and manage clearances from MPCB, DISH, MIDC, Fire, and MSEDCL online.
                </p>
              </div>
              <div className="mt-5 pt-3 border-t border-slate-100">
                <Link to="/approvals" className="text-xs font-semibold text-blue-700 hover:text-blue-900 inline-flex items-center gap-1">
                  <span>Access Service</span>
                  <span className="font-bold">→</span>
                </Link>
              </div>
            </div>

            {/* Service 2: Government Schemes */}
            <div className="bg-white p-5 rounded-lg border border-slate-200 shadow-xs hover:border-blue-300 hover:shadow-md transition flex flex-col justify-between group">
              <div>
                <div className="w-11 h-11 rounded-lg bg-amber-50 border border-amber-100 text-amber-700 flex items-center justify-center mb-3.5 group-hover:bg-amber-600 group-hover:text-white transition">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <h3 className="text-sm font-bold text-slate-900 mb-1 group-hover:text-amber-700 transition">
                  Government Schemes
                </h3>
                <p className="text-xs text-slate-600 leading-normal">
                  Explore capital subsidies, electricity duty waivers, and MSME competitiveness incentives.
                </p>
              </div>
              <div className="mt-5 pt-3 border-t border-slate-100">
                <Link to="/schemes" className="text-xs font-semibold text-blue-700 hover:text-blue-900 inline-flex items-center gap-1">
                  <span>Access Service</span>
                  <span className="font-bold">→</span>
                </Link>
              </div>
            </div>

            {/* Service 3: Regulatory Information */}
            <div className="bg-white p-5 rounded-lg border border-slate-200 shadow-xs hover:border-blue-300 hover:shadow-md transition flex flex-col justify-between group">
              <div>
                <div className="w-11 h-11 rounded-lg bg-indigo-50 border border-indigo-100 text-indigo-700 flex items-center justify-center mb-3.5 group-hover:bg-indigo-600 group-hover:text-white transition">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <h3 className="text-sm font-bold text-slate-900 mb-1 group-hover:text-indigo-700 transition">
                  Regulatory Information
                </h3>
                <p className="text-xs text-slate-600 leading-normal">
                  Official gazettes, standard operating procedures (SOP), statutory RTS timelines &amp; circulars.
                </p>
              </div>
              <div className="mt-5 pt-3 border-t border-slate-100">
                <Link to="/notices" className="text-xs font-semibold text-blue-700 hover:text-blue-900 inline-flex items-center gap-1">
                  <span>Access Service</span>
                  <span className="font-bold">→</span>
                </Link>
              </div>
            </div>

            {/* Service 4: Track Application */}
            <div className="bg-white p-5 rounded-lg border border-slate-200 shadow-xs hover:border-blue-300 hover:shadow-md transition flex flex-col justify-between group">
              <div>
                <div className="w-11 h-11 rounded-lg bg-emerald-50 border border-emerald-100 text-emerald-700 flex items-center justify-center mb-3.5 group-hover:bg-emerald-600 group-hover:text-white transition">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                  </svg>
                </div>
                <h3 className="text-sm font-bold text-slate-900 mb-1 group-hover:text-emerald-700 transition">
                  Track Application
                </h3>
                <p className="text-xs text-slate-600 leading-normal">
                  Check real-time statutory status and SLA countdown of your industrial application filings.
                </p>
              </div>
              <div className="mt-5 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={handleTrackApplication}
                  className="text-xs font-semibold text-blue-700 hover:text-blue-900 inline-flex items-center gap-1 cursor-pointer"
                >
                  <span>Track Status</span>
                  <span className="font-bold">→</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* BEGIN: LatestUpdatesSection */}
      <section className="py-8 bg-white border-t border-slate-200" data-purpose="latest-updates-section">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-lg font-bold text-[#0f2b48]">Latest Updates &amp; Gazettes</h2>
              <p className="text-xs text-slate-500">Government Resolutions, notifications, and departmental circulars</p>
            </div>
            <Link to="/notices" className="text-xs font-semibold text-blue-700 hover:underline inline-flex items-center gap-1">
              <span>View All Circulars</span>
              <span>→</span>
            </Link>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {/* Update 1 */}
            <article className="p-4 rounded-lg border border-slate-200 bg-slate-50/50 hover:bg-slate-50 transition flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-semibold text-slate-500 font-mono">12 Sep 2024</span>
                  <span className="px-2 py-0.5 text-[10px] font-semibold bg-blue-100 text-blue-800 rounded">Notices</span>
                </div>
                <h3 className="text-xs font-bold text-slate-900 leading-snug">
                  New environmental clearance guidelines notified
                </h3>
                <p className="text-[11px] text-slate-600 mt-1 leading-relaxed">
                  Revised statutory checklists and time limits under Water and Air prevention Acts for industrial clusters.
                </p>
              </div>
              <div className="mt-4 pt-2 border-t border-slate-200/60">
                <Link to="/notices" className="text-[11px] font-semibold text-blue-700 hover:underline inline-flex items-center gap-1">
                  <span>Read Circular</span>
                  <span>→</span>
                </Link>
              </div>
            </article>

            {/* Update 2 */}
            <article className="p-4 rounded-lg border border-slate-200 bg-slate-50/50 hover:bg-slate-50 transition flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-semibold text-slate-500 font-mono">08 Sep 2024</span>
                  <span className="px-2 py-0.5 text-[10px] font-semibold bg-amber-100 text-amber-800 rounded">Schemes</span>
                </div>
                <h3 className="text-xs font-bold text-slate-900 leading-snug">
                  MSME infrastructure scheme applications open
                </h3>
                <p className="text-[11px] text-slate-600 mt-1 leading-relaxed">
                  Call for expressions of interest for common effluent treatment plants and technological modernization subsidies.
                </p>
              </div>
              <div className="mt-4 pt-2 border-t border-slate-200/60">
                <Link to="/schemes" className="text-[11px] font-semibold text-blue-700 hover:underline inline-flex items-center gap-1">
                  <span>Read Circular</span>
                  <span>→</span>
                </Link>
              </div>
            </article>

            {/* Update 3 */}
            <article className="p-4 rounded-lg border border-slate-200 bg-slate-50/50 hover:bg-slate-50 transition flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-semibold text-slate-500 font-mono">01 Sep 2024</span>
                  <span className="px-2 py-0.5 text-[10px] font-semibold bg-emerald-100 text-emerald-800 rounded">Portal</span>
                </div>
                <h3 className="text-xs font-bold text-slate-900 leading-snug">
                  MahaUdyam One integrates 5 new departments
                </h3>
                <p className="text-[11px] text-slate-600 mt-1 leading-relaxed">
                  Seamless Single Sign-On and digital API handshake for town planning and municipal water works bodies.
                </p>
              </div>
              <div className="mt-4 pt-2 border-t border-slate-200/60">
                <Link to="/notices" className="text-[11px] font-semibold text-blue-700 hover:underline inline-flex items-center gap-1">
                  <span>Read Circular</span>
                  <span>→</span>
                </Link>
              </div>
            </article>
          </div>
        </div>
      </section>
    </div>
  );
};
