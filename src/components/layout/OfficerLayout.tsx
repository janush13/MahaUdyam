import React, { useEffect, useState, ReactNode } from 'react';
import { Link, useRouter } from '../../router/Router';
import { useAuth } from '../../context/AuthContext';

export type OfficerNavId = 'dashboard' | 'queue' | 'sla' | 'inspections' | 'reports' | 'grievance';

interface OfficerLayoutProps {
  children: ReactNode;
  activeNav: OfficerNavId;
  searchValue: string;
  onSearchChange: (value: string) => void;
  queueCount: number;
  slaCount: number;
  inspectionCount: number;
  notifications: string[];
  /** Called for sidebar items other than the current screen so the page can react (filter / prototype notice). */
  onNavSelect: (id: OfficerNavId) => void;
  onNotice: (message: string) => void;
}

const FONT_SIZES = [14, 16, 18];

const NAV_ITEMS: Array<{ id: OfficerNavId; label: string; icon: string }> = [
  { id: 'dashboard', label: 'Dashboard Overview', icon: '🏠' },
  { id: 'queue', label: 'Application Queue', icon: '📋' },
  { id: 'sla', label: 'SLA Monitoring', icon: '⏱️' },
  { id: 'inspections', label: 'Joint Inspections', icon: '✅' },
  { id: 'reports', label: 'Statutory Reports', icon: '📊' },
  { id: 'grievance', label: 'RTS Grievance Desk', icon: '⚠️' },
];

export const OfficerLayout: React.FC<OfficerLayoutProps> = ({
  children,
  activeNav,
  searchValue,
  onSearchChange,
  queueCount,
  slaCount,
  inspectionCount,
  notifications,
  onNavSelect,
  onNotice,
}) => {
  const { user, logout } = useAuth();
  const { navigate } = useRouter();
  const [fontStep, setFontStep] = useState(1);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

  // A-/A/A+ accessibility control: Tailwind sizes are rem-based, so scale the root and restore on leave.
  useEffect(() => {
    const previous = document.documentElement.style.fontSize;
    document.documentElement.style.fontSize = `${FONT_SIZES[fontStep]}px`;
    return () => {
      document.documentElement.style.fontSize = previous;
    };
  }, [fontStep]);

  const officerName = user?.name || 'Officer';
  const initials = officerName
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const badgeFor = (id: OfficerNavId): { text: string; cls: string } | null => {
    if (id === 'queue') return { text: String(queueCount), cls: 'bg-white/20 text-white text-[11px] font-bold px-2 py-0.5 rounded-full' };
    if (id === 'sla') return { text: String(slaCount), cls: 'bg-amber-100 text-amber-800 text-[10px] font-bold px-1.5 py-0.5 rounded' };
    if (id === 'inspections') return { text: String(inspectionCount), cls: 'bg-blue-100 text-blue-800 text-[10px] font-bold px-1.5 py-0.5 rounded' };
    return null;
  };

  return (
    <div
      className="min-h-screen flex flex-col font-sans bg-[#F4F7FB] text-slate-800 antialiased"
      data-purpose="officer-portal-screen-26"
    >
      {/* Top institutional utility bar */}
      <div className="bg-[#0A1526] text-slate-300 text-xs py-1 px-4 border-b border-[#142A4A]">
        <div className="max-w-[1600px] mx-auto flex flex-wrap justify-between items-center gap-2">
          <div className="flex items-center space-x-3">
            <span className="font-medium tracking-wider text-slate-200 uppercase">Government of Maharashtra | महाराष्ट्र शासन</span>
            <span className="text-slate-500 hidden sm:inline">|</span>
            <span className="text-slate-400 hidden sm:inline">Industries, Energy, Labour and Mining Department</span>
          </div>
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2 text-[11px]">
              <button type="button" onClick={() => setFontStep(0)} className="hover:text-white cursor-pointer transition" aria-label="Decrease text size">A-</button>
              <button type="button" onClick={() => setFontStep(1)} className={`px-1 ${fontStep === 1 ? 'font-semibold text-white' : 'hover:text-white'}`} aria-label="Default text size">A</button>
              <button type="button" onClick={() => setFontStep(2)} className="hover:text-white cursor-pointer transition" aria-label="Increase text size">A+</button>
            </div>
            <span className="text-slate-600">|</span>
            <button
              aria-label="Switch Language to Marathi"
              className="text-xs font-medium text-amber-300 hover:text-amber-200 transition"
              type="button"
              onClick={() => onNotice('Marathi interface is not available in this prototype.')}
            >
              मराठी
            </button>
            <span className="text-slate-600 hidden sm:inline">|</span>
            <span className="hidden sm:inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-semibold bg-emerald-950 text-emerald-300 border border-emerald-800">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse mr-1.5" />
              Live RTS Scrutiny Node v4.8.2
            </span>
          </div>
        </div>
      </div>

      {/* Main portal header */}
      <header className="bg-white border-b border-slate-200 shadow-sm sticky top-0 z-30">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-2.5 flex items-center justify-between gap-4">
          <div className="flex items-center space-x-3.5">
            <button
              type="button"
              onClick={() => setMobileNavOpen((o) => !o)}
              className="lg:hidden p-2 rounded-md text-slate-600 border border-slate-200 hover:bg-slate-100"
              aria-label="Toggle officer navigation"
            >
              ☰
            </button>
            <div
              className="w-11 h-11 rounded-full bg-[#F0F4F9] border border-slate-300 flex items-center justify-center shadow-inner shrink-0 text-xl"
              title="Government of Maharashtra Official Seal"
            >
              🏛️
            </div>
            <div>
              <div className="flex items-baseline space-x-2">
                <h1 className="text-xl font-bold tracking-tight text-[#0F2038] leading-none">MahaUdyam One</h1>
                <span className="text-xs font-semibold px-1.5 py-0.5 rounded bg-blue-50 text-blue-800 border border-blue-200">OFFICER DESK</span>
              </div>
              <p className="text-xs text-slate-500 tracking-tight font-medium mt-0.5 hidden sm:block">
                Single Window for a Progressive Maharashtra • RTSA 2015 Scrutiny Management
              </p>
            </div>
          </div>

          {/* Quick search across the queue */}
          <div className="hidden md:flex flex-1 max-w-lg mx-6">
            <div className="relative w-full">
              <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400 text-xs">🔍</span>
              <input
                className="block w-full pl-9 pr-4 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded-md focus:bg-white focus:ring-1 focus:ring-[#1B365D] focus:border-[#1B365D] placeholder-slate-400 transition"
                placeholder="Search Application No., Enterprise, UDYAM, or Project ID..."
                type="search"
                value={searchValue}
                onChange={(e) => onSearchChange(e.target.value)}
                aria-label="Search applications"
              />
            </div>
          </div>

          <div className="flex items-center space-x-3 shrink-0 relative">
            <button
              aria-label={`Notifications (${notifications.length} new)`}
              className="relative p-2 text-slate-600 hover:text-[#0F2038] rounded-md hover:bg-slate-100 transition"
              type="button"
              onClick={() => {
                setNotifOpen((o) => !o);
                setProfileOpen(false);
              }}
            >
              <span className="text-lg">🔔</span>
              <span className="absolute top-1 right-1 w-4 h-4 bg-red-600 text-white rounded-full text-[10px] font-bold flex items-center justify-center ring-2 ring-white">
                {notifications.length}
              </span>
            </button>
            {notifOpen && (
              <div className="absolute right-0 top-11 w-80 bg-white border border-slate-200 rounded-lg shadow-xl z-40 text-xs">
                <div className="px-3 py-2 border-b border-slate-200 font-bold text-[#0F2038] uppercase text-[11px] tracking-wide">Desk Notifications</div>
                <ul className="divide-y divide-slate-100 max-h-72 overflow-y-auto">
                  {notifications.map((n, i) => (
                    <li key={i} className="px-3 py-2 text-slate-700 leading-snug">{n}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="h-6 w-px bg-slate-200" />
            <button
              type="button"
              className="flex items-center space-x-3 pl-1 text-left"
              onClick={() => {
                setProfileOpen((o) => !o);
                setNotifOpen(false);
              }}
              aria-haspopup="menu"
              aria-expanded={profileOpen}
            >
              <div className="w-9 h-9 rounded-full bg-[#142A4A] text-white flex items-center justify-center font-semibold text-xs border border-[#0F2038] shadow-sm">
                {initials}
              </div>
              <div className="hidden sm:block">
                <div className="flex items-center space-x-1">
                  <span className="text-xs font-bold text-slate-800 leading-tight">{officerName}</span>
                  <span className="text-slate-500 text-[10px]">▾</span>
                </div>
                <p className="text-[11px] text-slate-500 leading-none mt-0.5 max-w-[240px] truncate">
                  {user?.designation || 'Scrutiny Officer'}
                </p>
              </div>
            </button>
            {profileOpen && (
              <div className="absolute right-0 top-11 w-64 bg-white border border-slate-200 rounded-lg shadow-xl z-40 text-xs" role="menu">
                <div className="px-3 py-2 border-b border-slate-200">
                  <p className="font-bold text-slate-800">{officerName}</p>
                  <p className="text-[11px] text-slate-500">{user?.entityName}</p>
                  <p className="text-[11px] text-slate-500 font-mono">{user?.email}</p>
                </div>
                <Link to="/" className="block px-3 py-2 text-slate-700 hover:bg-slate-50" role="menuitem">Public Portal</Link>
                <button type="button" onClick={handleLogout} className="w-full text-left px-3 py-2 text-rose-700 hover:bg-rose-50 font-semibold" role="menuitem">
                  Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Sidebar + workspace canvas */}
      <div className="flex-1 flex flex-col lg:flex-row max-w-[1600px] w-full mx-auto">
        <aside
          className={`${mobileNavOpen ? 'flex' : 'hidden'} lg:flex w-full lg:w-64 bg-white border-b lg:border-b-0 lg:border-r border-slate-200 flex-col justify-between shrink-0 select-none py-4 px-3`}
          data-purpose="officer-sidebar-nav"
        >
          <div>
            <div className="px-3 pb-3 mb-2 border-b border-slate-100">
              <p className="text-[10px] font-bold tracking-wider uppercase text-slate-400">Jurisdiction Desk</p>
              <p className="text-xs font-semibold text-[#0F2038] mt-0.5">Directorate of Industries</p>
              <p className="text-[11px] text-slate-500">Region: Pune Division (Zone II)</p>
            </div>
            <nav aria-label="Officer Workspace Sidebar" className="space-y-1 mt-2">
              {NAV_ITEMS.map((item) => {
                const isActive = item.id === activeNav;
                const badge = badgeFor(item.id);
                return (
                  <button
                    key={item.id}
                    type="button"
                    aria-current={isActive ? 'page' : undefined}
                    onClick={() => {
                      setMobileNavOpen(false);
                      onNavSelect(item.id);
                    }}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-xs transition ${
                      isActive
                        ? 'font-semibold bg-[#142A4A] text-white shadow-sm'
                        : 'font-medium text-slate-700 hover:bg-slate-100 hover:text-slate-900'
                    }`}
                  >
                    <span className="flex items-center space-x-2.5">
                      <span className="text-sm">{item.icon}</span>
                      <span>{item.label}</span>
                    </span>
                    {badge && <span className={badge.cls}>{badge.text}</span>}
                  </button>
                );
              })}
            </nav>
          </div>
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-md text-[11px] text-slate-600 mt-6" data-purpose="rts-statutory-notice">
            <div className="flex items-center space-x-1.5 text-[#142A4A] font-bold mb-1">
              <span className="text-amber-600">ⓘ</span>
              <span>RTS Mandate Notice</span>
            </div>
            <p className="leading-relaxed">
              All scrutinies must be completed within designated timeline. Penalties apply under RTS Act Sec. 10 for unexplained delay.
            </p>
            <div className="mt-2.5 pt-2 border-t border-slate-200 flex justify-between items-center text-[10px] text-slate-500">
              <span>Appellate: Joint Director</span>
              <button type="button" className="text-blue-700 hover:underline font-semibold" onClick={() => onNotice('Appellate escalation matrix is not available in this prototype.')}>
                Matrix →
              </button>
            </div>
          </div>
        </aside>

        <main className="flex-1 min-w-0 p-4 sm:p-6 lg:p-7 overflow-x-hidden" data-purpose="workspace-main-content">
          {children}
        </main>
      </div>

      {/* Institutional footer */}
      <footer className="bg-[#0A1526] text-slate-400 text-xs mt-10 border-t border-[#0F2038] py-6">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 pb-6 border-b border-[#0F2038]">
            <div>
              <h4 className="text-white font-bold text-xs uppercase tracking-wider mb-2">MahaUdyam One Single Window</h4>
              <p className="text-[11px] leading-relaxed text-slate-400">
                Official Regulatory Approval and Scrutiny Engine of the Government of Maharashtra. Streamlining statutory clearances under Maharashtra Right to Public Services Act (RTSA) 2015.
              </p>
            </div>
            <div>
              <h4 className="text-white font-bold text-xs uppercase tracking-wider mb-2">Statutory Guidelines</h4>
              <ul className="space-y-1 text-[11px]">
                <li>Maharashtra RTS Act 2015 Guidelines</li>
                <li>Standard Operating Procedures (SOPs)</li>
                <li>Schedule of Prescribed RTS Timelines</li>
                <li>Appellate Authority Escalation Rules</li>
              </ul>
            </div>
            <div>
              <h4 className="text-white font-bold text-xs uppercase tracking-wider mb-2">Government Initiatives</h4>
              <ul className="space-y-1 text-[11px]">
                <li>Digital India • Ease of Doing Business</li>
                <li>Aaple Sarkar Maharashtra Portal</li>
                <li>National Single Window System (NSWS)</li>
                <li>MIDC &amp; MPCB Regulatory Nodes</li>
              </ul>
            </div>
            <div>
              <h4 className="text-white font-bold text-xs uppercase tracking-wider mb-2">Officer Support Desk</h4>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Technical Helpline: <strong>1800-120-8040</strong> (Toll Free)
                <br />
                Officer IT Cell: <span className="text-slate-300">desk-support@mahaudyam.gov.in</span>
                <br />
                Operating Hours: 09:45 AM - 06:15 PM (Govt Working Days)
              </p>
            </div>
          </div>
          <div className="pt-4 flex flex-col sm:flex-row justify-between items-center text-[11px] text-slate-500 gap-2">
            <p>© 2024 Directorate of Industries, Government of Maharashtra. Designed and hosted by National Informatics Centre (NIC) / MahaIT.</p>
            <div className="flex items-center space-x-3">
              <span>GIGW 3.0 Compliant</span>
              <span>•</span>
              <span>W3C WCAG 2.1 Level AA</span>
              <span>•</span>
              <span>Privacy Policy</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
};
