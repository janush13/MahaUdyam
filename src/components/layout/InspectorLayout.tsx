import React, { useState, ReactNode } from 'react';
import { useRouter } from '../../router/Router';
import { useAuth } from '../../context/AuthContext';

export type InspectorNavId = 'dashboard' | 'inspections' | 'reports';

interface InspectorLayoutProps {
  children: ReactNode;
  activeNav: InspectorNavId;
  upcomingCount: number;
  notifications: string[];
  searchValue: string;
  onSearchChange: (value: string) => void;
  onNavSelect: (id: InspectorNavId) => void;
  onNotice: (message: string) => void;
}

/** Screen 28 chrome: institutional navy header, white module sidebar, four-column navy footer. */
export const InspectorLayout: React.FC<InspectorLayoutProps> = ({
  children,
  activeNav,
  upcomingCount,
  notifications,
  searchValue,
  onSearchChange,
  onNavSelect,
  onNotice,
}) => {
  const { user, logout } = useAuth();
  const { navigate } = useRouter();
  const [notifOpen, setNotifOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const inspectorName = user?.name || 'Inspector';
  const initials = inspectorName.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();

  const itemBase = 'w-full flex items-center px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 rounded transition text-left';
  const select = (id: InspectorNavId) => () => {
    setMobileNavOpen(false);
    onNavSelect(id);
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-100 text-slate-800 antialiased font-sans" data-purpose="inspector-portal-screen-28">
      {/* Institutional header */}
      <header className="bg-[#0B2265] text-white shadow-md z-40 border-b border-blue-950" data-purpose="portal-header">
        <div className="bg-[#071644] px-4 py-1 text-xs border-b border-slate-700/60 flex flex-wrap justify-between items-center gap-2 text-slate-300">
          <div className="flex items-center space-x-3 flex-wrap">
            <span className="font-medium tracking-wide">GOVERNMENT OF MAHARASHTRA | महाराष्ट्र शासन</span>
            <span className="text-slate-500 hidden sm:inline">|</span>
            <span className="hidden sm:inline">Directorate of Industrial Safety and Health (DISH)</span>
          </div>
          <div className="flex items-center space-x-4 text-xs">
            <span className="inline-flex items-center text-emerald-400 font-medium">
              <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block mr-1.5 animate-pulse" />
              RTS Act 2015 Live Compliance: 99.4%
            </span>
            <span className="text-slate-500">|</span>
            <span className="text-white font-semibold">English</span>
            <span className="text-slate-500">|</span>
            <button type="button" className="hover:text-white transition" onClick={() => onNotice('Marathi interface is not available in this prototype.')}>मराठी</button>
          </div>
        </div>
        <div className="px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center space-x-3">
            <button
              type="button"
              onClick={() => setMobileNavOpen((o) => !o)}
              className="md:hidden p-2 rounded border border-slate-600 text-slate-200 hover:bg-[#153B8A]"
              aria-label="Toggle inspector navigation"
            >
              ☰
            </button>
            <div className="w-12 h-12 rounded-full bg-white flex items-center justify-center shadow-inner shrink-0 border border-amber-400 text-2xl" title="Government of Maharashtra Official Seal">🏛️</div>
            <div>
              <div className="flex items-center space-x-2 flex-wrap">
                <h1 className="text-xl font-bold tracking-tight text-white uppercase">MahaUdyam One</h1>
                <span className="bg-blue-800 text-blue-200 text-[11px] font-semibold px-2 py-0.5 rounded border border-blue-600 tracking-wider">INSPECTOR DESK</span>
              </div>
              <p className="text-xs text-slate-300 hidden sm:block">Single Window for a Progressive Maharashtra • Statutory Field Inspection Management</p>
            </div>
          </div>

          <div className="hidden md:flex items-center w-80 lg:w-96">
            <div className="relative w-full">
              <input
                type="search"
                value={searchValue}
                onChange={(e) => onSearchChange(e.target.value)}
                aria-label="Search inspections"
                placeholder="Search Inspection No., Application No., Enterprise..."
                className="w-full text-xs pl-8 pr-3 py-1.5 rounded bg-slate-900/60 border border-slate-600 text-white placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-400 focus:border-blue-400"
              />
              <span className="text-slate-400 absolute left-2.5 top-1.5 text-xs">🔍</span>
            </div>
          </div>

          <div className="flex items-center space-x-4 relative">
            <button
              type="button"
              title="Statutory Notifications"
              aria-label={`Notifications (${notifications.length})`}
              onClick={() => {
                setNotifOpen((o) => !o);
                setProfileOpen(false);
              }}
              className="relative p-1.5 text-slate-300 hover:text-white rounded hover:bg-[#153B8A] transition"
            >
              <span className="text-lg">🔔</span>
              <span className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-red-600 text-white text-[10px] font-bold flex items-center justify-center border-2 border-[#0B2265]">{notifications.length}</span>
            </button>
            {notifOpen && (
              <div className="absolute right-0 top-11 w-80 bg-white text-slate-800 border border-slate-200 rounded-lg shadow-xl z-50 text-xs">
                <div className="px-3 py-2 border-b border-slate-200 font-bold text-[#0B2265] uppercase text-[11px] tracking-wide">Statutory Notifications</div>
                <ul className="divide-y divide-slate-100 max-h-72 overflow-y-auto">
                  {notifications.map((n, i) => <li key={i} className="px-3 py-2 leading-snug">{n}</li>)}
                </ul>
              </div>
            )}
            <div className="h-8 w-px bg-slate-700" />
            <button
              type="button"
              onClick={() => {
                setProfileOpen((o) => !o);
                setNotifOpen(false);
              }}
              className="flex items-center space-x-2.5 text-left"
              aria-haspopup="menu"
              aria-expanded={profileOpen}
            >
              <div className="w-9 h-9 rounded-full bg-amber-500 text-[#071644] font-bold flex items-center justify-center text-xs shadow border border-amber-300">{initials}</div>
              <div className="text-xs leading-tight hidden sm:block">
                <div className="font-bold text-white tracking-wide">{inspectorName}</div>
                <div className="text-slate-300 text-[10px] max-w-[220px] truncate">{user?.designation || 'Inspector (DISH / Field Unit)'}</div>
              </div>
            </button>
            {profileOpen && (
              <div className="absolute right-0 top-11 w-60 bg-white text-slate-800 border border-slate-200 rounded-lg shadow-xl z-50 text-xs" role="menu">
                <div className="px-3 py-2 border-b border-slate-200">
                  <p className="font-bold">{inspectorName}</p>
                  <p className="text-[11px] text-slate-500 font-mono">{user?.email}</p>
                </div>
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

      <div className="flex-1 flex min-h-0">
        {/* Sidebar */}
        <aside
          className={`${mobileNavOpen ? 'flex fixed inset-y-0 left-0 z-40 pt-28' : 'hidden'} md:flex md:static md:pt-0 w-64 bg-white border-r border-slate-300 flex-col justify-between shrink-0`}
          data-purpose="inspector-sidebar"
        >
          <div className="py-4">
            <div className="px-5 pb-2 text-[10px] font-bold tracking-wider uppercase text-slate-500">Inspector Modules</div>
            <nav className="space-y-1 px-3" aria-label="Inspector modules">
              <button
                type="button"
                aria-current={activeNav === 'dashboard' ? 'page' : undefined}
                className={activeNav === 'dashboard'
                  ? 'w-full flex items-center px-3 py-2 text-xs font-semibold text-[#0B2265] bg-blue-50 border-l-4 border-[#0B2265] rounded-r transition text-left'
                  : itemBase}
                onClick={select('dashboard')}
              >
                <span className="mr-3">🏠</span>Dashboard
              </button>
              <button
                type="button"
                aria-current={activeNav === 'inspections' ? 'page' : undefined}
                onClick={select('inspections')}
                className={`w-full flex items-center justify-between px-3 py-2 text-xs transition text-left ${
                  activeNav === 'inspections' ? 'font-semibold text-[#0B2265] bg-blue-50 border-l-4 border-[#0B2265] rounded-r' : 'font-medium text-slate-600 hover:bg-slate-100 rounded'
                }`}
              >
                <span className="flex items-center"><span className="mr-3">📋</span>My Inspections</span>
                <span className="bg-[#0B2265] text-white font-bold text-[10px] px-1.5 py-0.5 rounded-full">{upcomingCount}</span>
              </button>
              <button
                type="button"
                aria-current={activeNav === 'reports' ? 'page' : undefined}
                onClick={select('reports')}
                className={`w-full flex items-center px-3 py-2 text-xs transition text-left ${
                  activeNav === 'reports' ? 'font-semibold text-[#0B2265] bg-blue-50 border-l-4 border-[#0B2265] rounded-r' : 'font-medium text-slate-600 hover:bg-slate-100 rounded'
                }`}
              >
                <span className="mr-3">📊</span>Reports &amp; Archival
              </button>
            </nav>
            <div className="mt-8 px-4">
              <div className="bg-slate-50 border border-slate-200 rounded p-3 text-[11px] text-slate-700">
                <div className="font-bold text-slate-900 flex items-center mb-1">
                  <span className="w-2 h-2 rounded-full bg-blue-600 mr-1.5" />
                  Assigned Field Jurisdiction
                </div>
                <p className="text-slate-600 font-medium">Pune Division • Zone 4</p>
                <p className="text-[10px] text-slate-500 mt-1">Chakan, Pimpri-Chinchwad &amp; Talegaon Industrial Clusters</p>
              </div>
            </div>
          </div>
          <div className="p-4 border-t border-slate-200 bg-slate-50">
            <div className="text-[10px] text-slate-500 space-y-1">
              <p className="font-bold text-slate-800">Maharashtra RTS Act 2015</p>
              <p>Statutory Site Inspection Deadline: <strong>Within 5 working days</strong> from scrutiny approval.</p>
              <div className="w-full bg-slate-200 h-1.5 rounded-full overflow-hidden mt-2">
                <div className="bg-emerald-600 h-full w-4/5" />
              </div>
              <p className="text-[9px] text-slate-400 mt-0.5">Average turnaround: 3.2 days</p>
            </div>
          </div>
        </aside>

        <main className="flex-1 min-w-0 px-4 sm:px-6 py-4 space-y-5" data-purpose="inspector-workspace-main">
          {children}
        </main>
      </div>

      {/* Institutional footer */}
      <footer className="bg-[#0B2265] text-white border-t-2 border-amber-500 text-xs" data-purpose="institutional-footer">
        <div className="max-w-7xl mx-auto px-6 py-5 grid grid-cols-1 md:grid-cols-4 gap-6">
          <div>
            <div className="font-bold uppercase tracking-wider text-amber-400 mb-1 text-[11px]">Directorate of Industries</div>
            <p className="text-slate-300 text-[11px] leading-relaxed">Government of Maharashtra.<br />Single Window Clearance System enacted under Maharashtra Industry Trade and Investment Facilitation Act.</p>
          </div>
          <div>
            <div className="font-bold uppercase tracking-wider text-amber-400 mb-1 text-[11px]">Statutory Compliance</div>
            <p className="text-slate-300 text-[11px] leading-relaxed">Maharashtra Right to Public Services Act (RTS), 2015.<br />Time-bound delivery guaranteed for all field verifications and statutory NOCs.</p>
          </div>
          <div>
            <div className="font-bold uppercase tracking-wider text-amber-400 mb-1 text-[11px]">Standards &amp; Security</div>
            <p className="text-slate-300 text-[11px] leading-relaxed">Compliant with GIGW 3.0 Guidelines.<br />W3C WCAG 2.1 Level AA Accessibility Certified.<br />ISO 27001 Information Security Standard.</p>
          </div>
          <div>
            <div className="font-bold uppercase tracking-wider text-amber-400 mb-1 text-[11px]">Hosted &amp; Designed By</div>
            <p className="text-slate-300 text-[11px] leading-relaxed">Designed and Developed by MahaIT Corporation Limited &amp; National Informatics Centre (NIC), Maharashtra State Centre.</p>
          </div>
        </div>
        <div className="bg-[#071644] px-6 py-2.5 text-center text-slate-400 text-[10px] border-t border-slate-800">
          © 2024 Government of Maharashtra. All rights reserved. MahaUdyam One™ Portal Content Managed by Department of Industries, Energy &amp; Labour.
        </div>
      </footer>
    </div>
  );
};
