import React, { useState, ReactNode } from 'react';
import { Link, useRouter } from '../../router/Router';
import { useAuth } from '../../context/AuthContext';
import { applicantService } from '../../services/applicantService';

interface ApplicantLayoutProps {
  children: ReactNode;
  activeTab: 'dashboard' | 'enterprises' | 'representatives' | 'profile' | 'discovery' | 'documents' | 'applications' | 'compliance';
  pageTitle?: string;
  breadcrumbs?: Array<{ label: string; href?: string }>;
}

export const ApplicantLayout: React.FC<ApplicantLayoutProps> = ({
  children,
  activeTab,
  pageTitle,
  breadcrumbs,
}) => {
  const { user, logout } = useAuth();
  const { navigate } = useRouter();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const profile = applicantService.getProfile();

  const handleLogout = (e: React.MouseEvent) => {
    e.preventDefault();
    logout();
    navigate('/login');
  };

  const navItems = [
    {
      id: 'dashboard',
      label: 'Dashboard',
      icon: '📊',
      href: '/applicant/dashboard',
    },
    {
      id: 'applications',
      label: 'My Applications',
      icon: '📋',
      href: '/applicant/applications',
    },
    {
      id: 'compliance',
      label: 'Compliance Center',
      icon: '⚠️',
      href: '/applicant/compliance',
    },
    {
      id: 'discovery',
      label: 'Find Approvals',
      icon: '⚡',
      href: '/applicant/approvals/find',
    },
    {
      id: 'documents',
      label: 'My Documents',
      icon: '📁',
      href: '/applicant/documents',
    },
    {
      id: 'enterprises',
      label: 'Enterprises & Projects',
      icon: '🏭',
      href: '/applicant/enterprises',
    },
    {
      id: 'representatives',
      label: 'Representatives & Consultants',
      icon: '👥',
      href: '/applicant/representatives',
    },
    {
      id: 'profile',
      label: 'Profile & Account Settings',
      icon: '⚙️',
      href: '/applicant/profile',
    },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-slate-100/70 text-slate-800 font-sans" data-purpose="applicant-portal-phase3">
      {/* 1. Top Accessibility / Security Ribbon */}
      <div className="bg-[#0b1f33] text-slate-300 text-[11px] px-4 sm:px-6 py-1.5 flex items-center justify-between border-b border-slate-700/60">
        <div className="flex items-center space-x-3">
          <span className="font-semibold text-slate-200">Government of Maharashtra</span>
          <span className="text-slate-500">|</span>
          <span className="hidden sm:inline text-slate-400">Industry, Energy, Labour &amp; Mining Department</span>
        </div>
        <div className="flex items-center space-x-4">
          <span className="inline-flex items-center gap-1 text-emerald-400 text-[10.5px]">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span>Authenticated Single Window Session</span>
          </span>
          <span className="text-slate-500 hidden md:inline">|</span>
          <Link
            to="/"
            className="text-[11px] text-slate-300 hover:text-white underline decoration-slate-500 hover:decoration-white transition"
          >
            Public Portal
          </Link>
        </div>
      </div>

      {/* 2. Applicant Header Identity Bar */}
      <header className="bg-white border-b border-slate-200 shadow-2xs sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          {/* Brand + Single Business ID */}
          <div className="flex items-center space-x-3">
            <Link to="/applicant/dashboard" className="flex items-center space-x-2.5">
              <div className="w-10 h-10 rounded-full bg-[#0f2b48] border border-blue-900 flex items-center justify-center text-white font-serif font-bold text-base shadow-inner">
                🏛️
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-base tracking-tight text-[#0f2b48] font-serif">
                    MahaUdyam One
                  </span>
                  <span className="px-1.5 py-0.2 rounded text-[10px] font-mono font-bold bg-blue-100 text-blue-900 border border-blue-200">
                    Applicant
                  </span>
                </div>
                <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                  <span className="font-semibold text-slate-700">Single Business ID:</span>
                  <span className="font-mono text-blue-900 font-bold bg-slate-100 px-1.5 py-0.5 rounded text-[10px]">
                    {profile.singleBusinessId || user?.singleBusinessId || 'MH-SWS-2026-08140'}
                  </span>
                </div>
              </div>
            </Link>
          </div>

          {/* User Dossier & Actions */}
          <div className="flex items-center space-x-3 sm:space-x-5">
            {/* Applicant Profile Pill */}
            <Link
              to="/applicant/profile"
              className="flex items-center space-x-2.5 px-3 py-1.5 rounded-lg border border-slate-200 hover:border-slate-300 bg-slate-50 hover:bg-slate-100/80 transition"
              title="View & Edit Applicant Profile"
            >
              <div className="w-8 h-8 rounded-full bg-[#0f2b48] text-white flex items-center justify-center font-bold text-xs shadow-2xs">
                {(profile.name || user?.name || 'PD')
                  .split(' ')
                  .map((n) => n[0])
                  .join('')
                  .slice(0, 2)
                  .toUpperCase()}
              </div>
              <div className="hidden sm:block text-left">
                <div className="flex items-center gap-1.5 leading-tight">
                  <span className="text-xs font-bold text-slate-800">
                    {profile.name || user?.name || 'Priya Deshmukh'}
                  </span>
                  <span className="inline-flex items-center px-1.5 py-0.2 rounded-full text-[9px] font-bold uppercase tracking-wider bg-emerald-100 text-emerald-800 border border-emerald-300">
                    ✓ Verified
                  </span>
                </div>
                <span className="text-[10.5px] text-slate-500 block truncate max-w-[190px]">
                  {profile.designation || 'Managing Director'}
                </span>
              </div>
            </Link>

            {/* Logout Button */}
            <button
              type="button"
              onClick={handleLogout}
              className="inline-flex items-center space-x-1 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:text-rose-900 bg-rose-50 hover:bg-rose-100/80 border border-rose-200 rounded-lg transition cursor-pointer"
              title="Sign out of applicant session"
            >
              <span>Logout</span>
              <span className="text-sm">🚪</span>
            </button>

            {/* Mobile Nav Toggle */}
            <button
              type="button"
              onClick={() => setMobileNavOpen(!mobileNavOpen)}
              className="md:hidden p-2 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100 border border-slate-200"
              aria-label="Toggle navigation menu"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {mobileNavOpen ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" />
                )}
              </svg>
            </button>
          </div>
        </div>

        {/* 3. Applicant Sub-Navigation Tabs (Desktop) */}
        <div className="bg-[#0f2b48] text-white hidden md:block">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 flex items-center justify-between">
            <nav className="flex space-x-1" aria-label="Applicant Portal Navigation">
              {navItems.map((item) => {
                const isActive = activeTab === item.id;
                return (
                  <Link
                    key={item.id}
                    to={item.href}
                    className={`inline-flex items-center space-x-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition ${
                      isActive
                        ? 'border-[#f58220] bg-white/10 text-white shadow-inner'
                        : 'border-transparent text-slate-300 hover:text-white hover:bg-white/5'
                    }`}
                  >
                    <span>{item.icon}</span>
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </nav>

            <div className="flex items-center space-x-3 text-[11px] text-slate-300">
              <span className="text-slate-400">Primary Enterprise:</span>
              <span className="font-semibold text-white truncate max-w-[220px]">
                {user?.entityName || 'Deshmukh Industries Pvt. Ltd.'}
              </span>
            </div>
          </div>
        </div>

        {/* 4. Mobile Navigation Drawer */}
        {mobileNavOpen && (
          <div className="md:hidden bg-[#0f2b48] border-t border-slate-700 px-4 py-3 space-y-1">
            {navItems.map((item) => {
              const isActive = activeTab === item.id;
              return (
                <Link
                  key={item.id}
                  to={item.href}
                  onClick={() => setMobileNavOpen(false)}
                  className={`flex items-center space-x-2.5 px-3 py-2 rounded-lg text-xs font-semibold ${
                    isActive
                      ? 'bg-[#f58220] text-white'
                      : 'text-slate-200 hover:bg-white/10'
                  }`}
                >
                  <span className="text-sm">{item.icon}</span>
                  <span>{item.label}</span>
                </Link>
              );
            })}
            <div className="pt-2 border-t border-slate-700 text-xs text-slate-300 flex items-center justify-between">
              <span>Primary: Deshmukh Industries</span>
              <button
                type="button"
                onClick={handleLogout}
                className="text-amber-400 font-bold"
              >
                Sign Out
              </button>
            </div>
          </div>
        )}
      </header>

      {/* 5. Breadcrumb & Page Banner (if present) */}
      <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 pt-4 pb-2">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-200 pb-3">
          <div className="flex items-center space-x-2 text-xs text-slate-500 flex-wrap">
            <Link to="/applicant/dashboard" className="hover:text-blue-900 font-medium">
              Applicant Portal
            </Link>
            {breadcrumbs &&
              breadcrumbs.map((b, idx) => (
                <React.Fragment key={idx}>
                  <span className="text-slate-400">›</span>
                  {b.href ? (
                    <Link to={b.href} className="hover:text-blue-900 font-medium">
                      {b.label}
                    </Link>
                  ) : (
                    <span className="text-slate-800 font-semibold">{b.label}</span>
                  )}
                </React.Fragment>
              ))}
          </div>

          <div className="flex items-center gap-2 text-xs text-slate-600">
            <span className="text-[11px] text-slate-500">Aadhaar e-KYC:</span>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
              Verified (UIDAI)
            </span>
          </div>
        </div>
      </div>

      {/* 6. Main Content Area */}
      <main className="max-w-7xl mx-auto w-full px-4 sm:px-6 py-4 flex-1">
        {children}
      </main>

      {/* 7. Institutional Applicant Footer */}
      <footer className="bg-slate-800 text-slate-300 text-xs mt-12 border-t border-slate-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 flex flex-col md:flex-row items-center justify-between gap-4 text-center md:text-left">
          <div>
            <p className="font-semibold text-white">MahaUdyam One — Government of Maharashtra Single Window Portal</p>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Administered under the Maharashtra Right to Public Services Act, 2015 &amp; Directorate of Industries.
            </p>
          </div>
          <div className="flex items-center gap-4 text-[11px] text-slate-400">
            <span>Toll-Free Helpline: 1800 233 4567</span>
            <span>•</span>
            <span>256-Bit SSL Encrypted Session</span>
            <span>•</span>
            <span className="font-mono text-[10px] text-slate-400">v3.0.0-PROTOTYPE</span>
          </div>
        </div>
      </footer>
    </div>
  );
};
