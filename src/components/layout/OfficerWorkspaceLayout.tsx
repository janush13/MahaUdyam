import React, { useState, ReactNode } from 'react';
import { useRouter } from '../../router/Router';
import { useAuth } from '../../context/AuthContext';

interface OfficerWorkspaceLayoutProps {
  children: ReactNode;
  queueCount: number;
  serviceId: string;
  notifications: string[];
  /** Header search: opens the first matching dossier. Returns false when nothing matched. */
  onSearch: (term: string) => boolean;
  onNotice: (message: string) => void;
}

/**
 * Screen 27 chrome (white header, dark vertical sidebar, compact footer). Screen 26 keeps OfficerLayout;
 * both share the same officer identity, notification and sign-out behaviour.
 */
export const OfficerWorkspaceLayout: React.FC<OfficerWorkspaceLayoutProps> = ({
  children,
  queueCount,
  serviceId,
  notifications,
  onSearch,
  onNotice,
}) => {
  const { user, logout } = useAuth();
  const { navigate } = useRouter();
  const [term, setTerm] = useState('');
  const [notifOpen, setNotifOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const officerName = user?.name || 'Officer';
  const initials = officerName.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!term.trim()) return;
    if (onSearch(term)) setTerm('');
    else onNotice(`No application matches “${term.trim()}”.`);
  };

  const navBase = 'w-full flex items-center gap-3 px-3 py-2 rounded text-xs font-medium text-slate-400 hover:text-white hover:bg-slate-800/50 transition text-left';
  const soon = (label: string) => () => {
    setMobileNavOpen(false);
    onNotice(`${label} is not part of Screen 27 and is not available in the prototype yet.`);
  };

  return (
    <div className="min-h-screen bg-[#f1f5f9] text-[#1e293b] font-sans flex flex-col antialiased" data-purpose="officer-portal-screen-27">
      {/* Top government header */}
      <header className="bg-white border-b border-[#e2e8f0] sticky top-0 z-30 shadow-sm" data-purpose="officer-portal-header">
        <div className="px-5 py-2.5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3.5">
            <button
              type="button"
              onClick={() => setMobileNavOpen((o) => !o)}
              className="md:hidden p-1.5 rounded-md text-slate-600 border border-slate-200 hover:bg-slate-100"
              aria-label="Toggle officer navigation"
            >
              ☰
            </button>
            <div className="w-10 h-10 rounded-full border border-amber-500/30 bg-amber-50 flex items-center justify-center text-lg shrink-0">🏛️</div>
            <div>
              <div className="flex items-center gap-1.5 leading-none flex-wrap">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-700">Government of Maharashtra</span>
                <span className="text-[11px] text-slate-400">|</span>
                <span className="text-xs font-medium text-slate-600">महाराष्ट्र शासन</span>
              </div>
              <div className="flex items-baseline gap-2 mt-0.5">
                <h1 className="text-base font-bold text-[#0f2942] tracking-tight">
                  MahaUdyam One <span className="text-xs font-semibold px-1.5 py-0.5 rounded bg-blue-100 text-blue-800 ml-1">Officer Desk</span>
                </h1>
                <span className="text-[11px] text-[#64748b] hidden lg:inline">Single Window for a Progressive Maharashtra</span>
              </div>
            </div>
          </div>

          <form onSubmit={submitSearch} className="hidden md:flex flex-1 max-w-md mx-6" role="search">
            <div className="relative w-full">
              <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400 text-xs">🔍</span>
              <input
                type="search"
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                aria-label="Search applications"
                placeholder="Search Application No., Enterprise, UDYAM..."
                className="w-full pl-9 pr-4 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded-md focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent transition-all"
              />
            </div>
          </form>

          <div className="flex items-center gap-4 relative">
            <button
              type="button"
              title="Pending Notifications"
              aria-label={`Notifications (${notifications.length})`}
              onClick={() => {
                setNotifOpen((o) => !o);
                setProfileOpen(false);
              }}
              className="relative p-1.5 text-slate-600 hover:text-slate-900 rounded-md hover:bg-slate-100 transition"
            >
              <span className="text-lg">🔔</span>
              <span className="absolute top-0.5 right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-600 text-[10px] font-bold text-white">{notifications.length}</span>
            </button>
            {notifOpen && (
              <div className="absolute right-0 top-11 w-80 bg-white border border-slate-200 rounded-lg shadow-xl z-40 text-xs">
                <div className="px-3 py-2 border-b border-slate-200 font-bold text-[#0f2942] uppercase text-[11px] tracking-wide">Pending Notifications</div>
                <ul className="divide-y divide-slate-100 max-h-72 overflow-y-auto">
                  {notifications.map((n, i) => (
                    <li key={i} className="px-3 py-2 text-slate-700 leading-snug">{n}</li>
                  ))}
                </ul>
              </div>
            )}
            <button
              type="button"
              onClick={() => {
                setProfileOpen((o) => !o);
                setNotifOpen(false);
              }}
              className="flex items-center gap-3 border-l border-slate-200 pl-4 text-left"
              aria-haspopup="menu"
              aria-expanded={profileOpen}
            >
              <div className="w-8 h-8 rounded-full bg-blue-700 text-white flex items-center justify-center font-bold text-xs shadow-sm">{initials}</div>
              <div className="hidden sm:block leading-tight">
                <p className="text-xs font-bold text-slate-800">{officerName}</p>
                <p className="text-[11px] text-slate-500 max-w-[220px] truncate">{user?.designation || 'Approving Officer (Level 1)'}</p>
              </div>
            </button>
            {profileOpen && (
              <div className="absolute right-0 top-11 w-60 bg-white border border-slate-200 rounded-lg shadow-xl z-40 text-xs" role="menu">
                <div className="px-3 py-2 border-b border-slate-200">
                  <p className="font-bold text-slate-800">{officerName}</p>
                  <p className="text-[11px] text-slate-500 font-mono">{user?.email}</p>
                </div>
                <button type="button" role="menuitem" onClick={() => navigate('/officer/queue')} className="w-full text-left px-3 py-2 text-slate-700 hover:bg-slate-50">Application Queue</button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    logout();
                    navigate('/login');
                  }}
                  className="w-full text-left px-3 py-2 text-rose-700 hover:bg-rose-50 font-semibold"
                >
                  Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="flex flex-1 min-h-0" data-purpose="officer-workspace-container">
        {/* Dark vertical sidebar */}
        <aside
          className={`${mobileNavOpen ? 'flex fixed inset-y-0 left-0 z-40 pt-16' : 'hidden'} md:flex md:static md:pt-0 w-56 bg-[#0c1f33] text-slate-300 shrink-0 flex-col justify-between border-r border-slate-800`}
          data-purpose="officer-vertical-sidebar"
        >
          <div className="py-4">
            <div className="px-4 mb-4">
              <div className="bg-slate-800/80 rounded px-2.5 py-1.5 text-[10px] border border-slate-700">
                <span className="block text-slate-400 font-medium uppercase tracking-wider">Jurisdiction Desk</span>
                <span className="block font-semibold text-white truncate">DISH Pune Circle</span>
              </div>
            </div>
            <nav className="space-y-0.5 px-2" aria-label="Officer navigation">
              <button type="button" className={navBase} onClick={soon('Dashboard')}>
                <span>▦</span>
                <span>Dashboard</span>
              </button>
              <button
                type="button"
                aria-current="page"
                onClick={() => navigate('/officer/queue')}
                className="w-full flex items-center justify-between px-3 py-2 rounded text-xs font-semibold text-white bg-blue-700/80 shadow-sm text-left"
              >
                <span className="flex items-center gap-3">
                  <span>📄</span>
                  <span>Application Queue</span>
                </span>
                <span className="bg-blue-900 text-blue-200 text-[10px] font-bold px-1.5 py-0.5 rounded-full">{queueCount}</span>
              </button>
              <button type="button" className={navBase} onClick={soon('Inspections')}>
                <span>📋</span>
                <span>Inspections</span>
              </button>
              <button type="button" className={navBase} onClick={soon('SLA Monitoring')}>
                <span>⏱</span>
                <span>SLA Monitoring</span>
              </button>
              <button type="button" className={navBase} onClick={soon('Reports')}>
                <span>📊</span>
                <span>Reports</span>
              </button>
            </nav>
          </div>
          <div className="p-3 border-t border-slate-800 text-[11px] text-slate-500">
            <p className="font-medium text-slate-400">MAHA-RTS Service ID</p>
            <p className="text-[10px] text-slate-500 font-mono">{serviceId}</p>
          </div>
        </aside>

        <main className="flex-1 min-w-0 flex flex-col bg-slate-100" data-purpose="workspace-main-panel">
          {children}
        </main>
      </div>

      <footer className="bg-white border-t border-slate-200 py-2.5 px-6 text-xs text-slate-500 flex flex-col sm:flex-row items-center justify-between gap-2" data-purpose="officer-portal-footer">
        <div className="flex items-center gap-3 flex-wrap justify-center">
          <span>Directorate of Industries, Government of Maharashtra</span>
          <span className="text-slate-300">|</span>
          <span>Maharashtra Right to Services (RTS) Act 2015 Compliant</span>
        </div>
        <div className="flex items-center gap-3 text-[11px]">
          <span className="text-slate-400">GIGW 3.0 • W3C WCAG 2.1 AA</span>
          <span className="text-slate-300">|</span>
          <span>Officer Desk Version 4.1.2</span>
        </div>
      </footer>
    </div>
  );
};
