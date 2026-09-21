import React, { ReactNode, useState } from 'react';
import { useRouter } from '../../router/Router';
import { useAuth } from '../../context/AuthContext';
import { RULE_VERSION, AdminWorkspaceTab } from '../../services/adminConfigService';

interface AdminLayoutProps {
  children: ReactNode;
  activeTab: AdminWorkspaceTab;
  onTabChange: (tab: AdminWorkspaceTab) => void;
  onNotice: (message: string) => void;
}

const NAV_ITEMS: Array<{ id: AdminWorkspaceTab; label: string; icon: string }> = [
  { id: 'users', label: 'Users', icon: '👥' },
  { id: 'roles', label: 'Roles & Permissions', icon: '🔑' },
  { id: 'approval-rules', label: 'Approval Rules', icon: '⚙️' },
  { id: 'workflow', label: 'Workflow Configuration', icon: '▦' },
  { id: 'master-data', label: 'Master Data', icon: '▤' },
];

export const AdminLayout: React.FC<AdminLayoutProps> = ({
  children,
  activeTab,
  onTabChange,
  onNotice,
}) => {
  const { user, logout } = useAuth();
  const { navigate } = useRouter();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);

  const adminName = user?.name || 'Admin User';
  const initials = adminName.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase();

  const selectTab = (tab: AdminWorkspaceTab) => {
    setMobileNavOpen(false);
    onTabChange(tab);
  };

  const signOut = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#f8fafc] text-slate-800 font-sans antialiased" data-purpose="admin-portal-screen-29">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-50 shadow-sm" data-purpose="admin-masthead">
        <div className="h-1 bg-gradient-to-r from-[#ff9933] via-white to-[#138808] border-b border-slate-200" />
        <div className="max-w-[1440px] mx-auto px-4 py-2 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              className="lg:hidden p-2 rounded border border-slate-300 text-slate-600 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
              onClick={() => setMobileNavOpen((open) => !open)}
              aria-label="Toggle administration navigation"
              aria-expanded={mobileNavOpen}
            >
              ☰
            </button>
            <div className="w-11 h-11 rounded-full border border-amber-600 bg-amber-50 flex items-center justify-center text-xl shrink-0" title="Government of Maharashtra official seal">🏛️</div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10.5px] font-bold text-[#0f2b5c] tracking-wider uppercase">Government of Maharashtra</span>
                <span className="text-[10px] text-slate-400">|</span>
                <span className="text-[11px] font-medium text-slate-600">महाराष्ट्र शासन</span>
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <h1 className="text-base font-bold text-[#0f2b5c] tracking-tight">MahaUdyam One</h1>
                <span className="bg-slate-800 text-amber-300 text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded border border-slate-700">ADMIN CONSOLE</span>
              </div>
              <p className="text-[10.5px] text-slate-500 hidden md:block leading-none mt-0.5">
                Single Window for a Progressive Maharashtra • System Administration &amp; Statutory Rule Engine
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0 relative">
            <div className="relative hidden xl:block w-64">
              <input
                type="search"
                aria-label="Search administration workspace"
                placeholder="Search users, rules, workflows..."
                className="w-full text-xs pl-8 pr-3 py-1.5 rounded border border-slate-300 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#0f2b5c]"
                onChange={(event) => {
                  if (event.target.value.trim()) onNotice('Global administration search is prototype-only.');
                }}
              />
              <span className="absolute left-2.5 top-1.5 text-slate-400" aria-hidden="true">⌕</span>
            </div>
            <button
              type="button"
              className="relative p-1.5 text-slate-600 hover:text-[#0f2b5c] hover:bg-slate-100 rounded focus:outline-none focus:ring-2 focus:ring-blue-600"
              aria-label="Statutory alerts"
              onClick={() => {
                setNotificationsOpen((open) => !open);
                setProfileOpen(false);
              }}
            >
              🔔
              <span className="absolute -top-1 -right-1 w-4 h-4 text-[9px] font-bold bg-red-600 text-white rounded-full flex items-center justify-center border border-white">3</span>
            </button>
            {notificationsOpen && (
              <div className="absolute right-20 top-12 w-72 bg-white border border-slate-200 rounded-lg shadow-xl z-50 text-xs">
                <div className="px-3 py-2 border-b border-slate-200 font-bold text-[#0f2b5c]">Statutory Alerts</div>
                <p className="px-3 py-3 text-slate-600">3 governance items require review in the prototype workspace.</p>
              </div>
            )}
            <div className="flex items-center gap-2 pl-2 border-l border-slate-200">
              <button
                type="button"
                className="w-8 h-8 rounded-full bg-[#0f2b5c] text-white font-semibold text-xs flex items-center justify-center border border-[#0a1d3f] focus:outline-none focus:ring-2 focus:ring-blue-600"
                onClick={() => {
                  setProfileOpen((open) => !open);
                  setNotificationsOpen(false);
                }}
                aria-label="Open administrator profile menu"
                aria-expanded={profileOpen}
              >
                {initials}
              </button>
              <div className="text-left hidden sm:block">
                <div className="font-semibold text-xs text-[#0f2b5c]">{adminName}</div>
                <div className="text-[10px] text-slate-500">System Administrator (Govt. of Maharashtra)</div>
              </div>
            </div>
            {profileOpen && (
              <div className="absolute right-0 top-12 w-56 bg-white border border-slate-200 rounded-lg shadow-xl z-50 text-xs" role="menu">
                <div className="px-3 py-2 border-b border-slate-200">
                  <p className="font-bold text-slate-800">{adminName}</p>
                  <p className="text-[11px] text-slate-500 font-mono">{user?.email}</p>
                </div>
                <button type="button" role="menuitem" onClick={signOut} className="w-full text-left px-3 py-2 text-rose-700 hover:bg-rose-50 font-semibold focus:outline-none focus:ring-2 focus:ring-inset focus:ring-rose-600">
                  Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="max-w-[1440px] w-full mx-auto flex flex-1 min-h-0">
        <aside
          className={`${mobileNavOpen ? 'flex absolute inset-y-[61px] left-0 z-40' : 'hidden'} lg:flex lg:static w-[230px] bg-white border-r border-slate-200 shrink-0 flex-col justify-between`}
          data-purpose="admin-navigation"
        >
          <div className="p-3 space-y-4">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider px-2">Administration Modules</div>
            <nav className="space-y-1" aria-label="Administration modules">
              <button type="button" onClick={() => selectTab('approval-rules')} className={`w-full flex items-center gap-2.5 px-3 py-2 rounded font-medium text-left text-xs focus:outline-none focus:ring-2 focus:ring-blue-600 ${activeTab === 'approval-rules' ? 'bg-[#0f2b5c] text-white shadow-sm' : 'text-slate-700 hover:bg-slate-100 hover:text-[#0f2b5c]'}`}>
                <span aria-hidden="true">⌂</span><span>Dashboard</span>
              </button>
              {NAV_ITEMS.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  onClick={() => selectTab(item.id)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded font-medium text-left text-xs focus:outline-none focus:ring-2 focus:ring-blue-600 ${activeTab === item.id ? 'bg-[#0f2b5c] text-white shadow-sm' : 'text-slate-700 hover:bg-slate-100 hover:text-[#0f2b5c]'}`}
                  aria-current={activeTab === item.id ? 'page' : undefined}
                >
                  <span aria-hidden="true">{item.icon}</span><span>{item.label}</span>
                  {item.id === 'approval-rules' && <span className={`ml-auto text-[10px] font-mono px-1.5 py-0.5 rounded border ${activeTab === item.id ? 'bg-amber-400/20 text-amber-200 border-amber-400/40' : 'bg-slate-100 text-slate-600 border-slate-200'}`}>{RULE_VERSION}</span>}
                </button>
              ))}
              <button type="button" onClick={() => selectTab('audit-logs')} className={`w-full flex items-center gap-2.5 px-3 py-2 rounded font-medium text-left text-xs focus:outline-none focus:ring-2 focus:ring-blue-600 ${activeTab === 'audit-logs' ? 'bg-[#0f2b5c] text-white shadow-sm' : 'text-slate-700 hover:bg-slate-100 hover:text-[#0f2b5c]'}`}>
                <span aria-hidden="true">▧</span><span>Audit Logs</span>
              </button>
            </nav>
          </div>
          <div className="p-3 m-2 bg-amber-50 border border-amber-200 rounded text-[11px] text-amber-900 leading-normal" data-purpose="statutory-notice">
            <div className="font-bold text-[10.5px] uppercase tracking-wide text-amber-950 mb-1">⚠ Governance Notice</div>
            <p className="text-[10px] text-amber-800 leading-tight">
              System Admin credentials permit rule and workflow definition. Under the Maharashtra RTS Act 2015, Admins hold <em>no quasi-judicial approval</em> authority over applications.
            </p>
          </div>
        </aside>

        <div className="flex-1 min-w-0">{children}</div>
      </div>

      <footer className="bg-slate-900 text-slate-300 border-t-2 border-amber-500" data-purpose="statutory-footer">
        <div className="max-w-[1440px] mx-auto px-6 py-5 grid grid-cols-1 md:grid-cols-4 gap-5 text-xs">
          <div>
            <div className="font-bold text-white uppercase tracking-wider text-xs mb-2">Directorate of Industries</div>
            <p className="text-slate-400 text-[11px] leading-relaxed">Government of Maharashtra<br />New Administrative Building, 2nd Floor, Madam Cama Road, Opposite Mantralaya, Mumbai - 400 032.</p>
            <p className="text-[11px] text-slate-400 mt-2">Helpdesk: 1800-120-8040 (Toll Free)<br />Support: <span className="text-amber-400">admin-support.mahait@gov.in</span></p>
          </div>
          <div>
            <div className="font-bold text-white uppercase tracking-wider text-xs mb-2">Statutory Compliance</div>
            <ul className="space-y-1 text-slate-400 text-[11px]">
              <li>• Maharashtra RTS Act 2015 Guidelines</li><li>• Deemed Approval Notified Time Limits</li><li>• State Industrial Policy 2019-2024</li><li>• Statutory Grievance Redressal SOP</li>
            </ul>
          </div>
          <div>
            <div className="font-bold text-white uppercase tracking-wider text-xs mb-2">Standards &amp; Security</div>
            <ul className="space-y-1 text-slate-400 text-[11px]">
              <li>• GIGW 3.0 compliant design</li><li>• WCAG 2.1 Level AA accessible</li><li>• ISO 27001:2022 certified architecture</li><li>• CERT-In audited portal</li>
            </ul>
          </div>
          <div>
            <div className="font-bold text-white uppercase tracking-wider text-xs mb-2">Technical Administration</div>
            <p className="text-slate-400 text-[11px] leading-relaxed">Designed, developed, hosted and maintained by Maharashtra Information Technology Corporation Limited (MahaIT) &amp; National Informatics Centre (NIC).</p>
            <div className="mt-3 flex flex-wrap items-center gap-2"><span className="bg-slate-800 text-amber-300 font-mono text-[10px] px-2 py-0.5 rounded border border-slate-700">Node: BOM-PROD-ADM-04</span><span className="bg-emerald-950 text-emerald-400 font-mono text-[10px] px-2 py-0.5 rounded border border-emerald-800">Latency: 18ms</span></div>
          </div>
        </div>
        <div className="border-t border-slate-800 bg-slate-950 px-6 py-2.5 text-[10.5px] text-slate-400 text-center">© 2024 Government of Maharashtra. All rights reserved. MahaUdyam One Single Window Administration Console.</div>
      </footer>
    </div>
  );
};
