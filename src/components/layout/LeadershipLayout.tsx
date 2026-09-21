import React, { ReactNode, useState } from 'react';
import { useRouter } from '../../router/Router';
import { useAuth } from '../../context/AuthContext';

interface LeadershipLayoutProps {
  children: ReactNode;
  activeSection: string;
  onSectionChange: (section: string) => void;
  onNotice: (message: string) => void;
}

const NAV_ITEMS = [
  ['dashboard', 'State Dashboard', '⌂'],
  ['department', 'Department Analytics', '▥'],
  ['bottleneck', 'Bottleneck Analytics', '⚠'],
  ['sla', 'SLA Monitoring (RTS)', 'ϟ'],
  ['scheme', 'Scheme Analytics', '₹'],
  ['grievance', 'Grievance Analytics', '▢'],
  ['cabinet', 'Cabinet Briefs & Export', '▤'],
];

export const LeadershipLayout: React.FC<LeadershipLayoutProps> = ({
  children,
  activeSection,
  onSectionChange,
  onNotice,
}) => {
  const { user, logout } = useAuth();
  const { navigate } = useRouter();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const displayName = user?.name || 'A. Deshmukh';
  const initials = displayName.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase();

  const signOut = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-100 text-slate-900 font-sans antialiased" data-purpose="leadership-portal-screen-30">
      <header className="bg-[#0b2545] text-white border-b-2 border-amber-600 sticky top-0 z-50">
        <div className="max-w-[1440px] mx-auto px-4 py-2 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button type="button" className="lg:hidden p-2 rounded border border-slate-500 hover:bg-[#133e68] focus:outline-none focus:ring-2 focus:ring-amber-400" onClick={() => setMobileNavOpen((open) => !open)} aria-label="Toggle leadership navigation" aria-expanded={mobileNavOpen}>☰</button>
            <div className="w-10 h-10 rounded-full bg-white text-[#0b2545] flex items-center justify-center border-2 border-amber-500 shrink-0" title="Government of Maharashtra">🏛️</div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap"><span className="text-[11px] uppercase tracking-wider font-semibold text-amber-300">महाराष्ट्र शासन | Government of Maharashtra</span><span className="bg-amber-500/20 text-amber-300 text-[10px] px-1.5 py-0.5 rounded font-mono uppercase font-bold border border-amber-400/40">Leadership Console</span></div>
              <h1 className="text-base font-bold tracking-tight">MahaUdyam One <span className="text-xs font-normal text-slate-300">| Single Window for a Progressive Maharashtra</span></h1>
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <div className="hidden xl:flex items-center gap-2 bg-[#133e68] px-3 py-1 rounded border border-blue-900 text-xs"><span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" /> <span className="text-slate-300">RTS Act 2015 Live Compliance:</span><span className="font-bold text-emerald-400">99.4%</span></div>
            <input aria-label="Search leadership metrics" placeholder="Search clearances, SLAs, metrics... (Ctrl+K)" className="hidden lg:block w-64 bg-slate-900/60 text-white placeholder-slate-400 text-xs rounded border border-slate-600 px-2.5 py-1.5 focus:outline-none focus:border-amber-400" onChange={(event) => { if (event.target.value.trim()) onNotice('Leadership search is prototype-only.'); }} />
            <div className="hidden md:flex items-center gap-1 text-[11px] text-slate-300 border-l border-slate-700 pl-3"><button type="button" className="hover:text-white focus:outline-none focus:ring-2 focus:ring-amber-400" onClick={() => onNotice('Text size control is prototype-only.')}>A-</button><span>|</span><button type="button" className="font-bold hover:text-white focus:outline-none focus:ring-2 focus:ring-amber-400">A</button><span>|</span><button type="button" className="hover:text-white focus:outline-none focus:ring-2 focus:ring-amber-400">A+</button></div>
            <button type="button" aria-label="Leadership notifications" className="relative p-1.5 hover:bg-[#133e68] rounded focus:outline-none focus:ring-2 focus:ring-amber-400" onClick={() => { setNotificationsOpen((open) => !open); setProfileOpen(false); }}>🔔<span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-600 text-white text-[9px] font-bold flex items-center justify-center">3</span></button>
            {notificationsOpen && <div className="absolute right-20 top-14 w-72 bg-white text-slate-800 border border-slate-200 rounded-lg shadow-xl p-3 text-xs"><strong>Operational alerts</strong><p className="mt-2 text-slate-600">3 state-level review items are pending in this prototype console.</p></div>}
            <button type="button" className="flex items-center gap-2 border-l border-slate-700 pl-3 text-left focus:outline-none focus:ring-2 focus:ring-amber-400" onClick={() => { setProfileOpen((open) => !open); setNotificationsOpen(false); }} aria-label="Open leadership profile menu" aria-expanded={profileOpen}><span className="w-8 h-8 rounded-full bg-amber-600 text-white flex items-center justify-center font-bold text-xs">{initials}</span><span className="hidden sm:block leading-tight"><span className="block font-semibold text-xs">{displayName}</span><span className="block text-[10px] text-slate-300">{user?.designation || 'Addl. Chief Secretary'}</span></span></button>
            {profileOpen && <div className="absolute right-4 top-14 w-60 bg-white text-slate-800 border border-slate-200 rounded-lg shadow-xl text-xs" role="menu"><div className="px-3 py-2 border-b border-slate-200"><p className="font-bold">{displayName}</p><p className="text-[11px] text-slate-500 font-mono">{user?.email}</p></div><button type="button" role="menuitem" onClick={signOut} className="w-full text-left px-3 py-2 text-rose-700 hover:bg-rose-50 font-semibold focus:outline-none focus:ring-2 focus:ring-inset focus:ring-rose-600">Sign out</button></div>}
          </div>
        </div>
      </header>
      <div className="max-w-[1440px] w-full mx-auto flex flex-1 min-h-0 bg-slate-100 border-x border-slate-300">
        <aside className={`${mobileNavOpen ? 'flex absolute inset-y-[58px] left-0 z-40' : 'hidden'} lg:flex lg:static w-64 bg-white border-r border-slate-200 flex-col justify-between shrink-0`} data-purpose="leadership-navigation">
          <div className="py-3">
            <div className="px-3 pb-2 text-[10px] font-bold tracking-wider text-slate-500 uppercase">Apex Leadership Oversight</div>
            <nav className="space-y-0.5 px-2" aria-label="Leadership console navigation">
              {NAV_ITEMS.map(([id, label, icon]) => <button key={id} type="button" onClick={() => { setMobileNavOpen(false); onSectionChange(id); }} className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs rounded text-left focus:outline-none focus:ring-2 focus:ring-blue-600 ${activeSection === id ? 'font-semibold bg-[#0b2545] text-white shadow-sm' : 'font-medium text-slate-700 hover:bg-slate-100'}`} aria-current={activeSection === id ? 'page' : undefined}><span className={activeSection === id ? 'text-amber-400' : 'text-slate-500'} aria-hidden="true">{icon}</span><span>{label}</span></button>)}
            </nav>
            <div className="px-3 pt-5 pb-1 text-[10px] font-bold tracking-wider text-slate-500 uppercase">Operational Switcher</div>
            <div className="px-2 space-y-1"><button type="button" onClick={() => onNotice('Inspector Desk quick jump is prototype-only.')} className="w-full text-left text-xs text-blue-700 hover:bg-blue-50 px-3 py-1.5 rounded flex items-center justify-between">Inspector Desk <span className="text-[10px] bg-blue-100 px-1.5 py-0.5 rounded text-blue-800">5 New</span></button><button type="button" onClick={() => onNotice('Scrutiny Officer Desk quick jump is prototype-only.')} className="w-full text-left text-xs text-blue-700 hover:bg-blue-50 px-3 py-1.5 rounded flex items-center justify-between">Scrutiny Officer Desk <span className="text-[10px] bg-blue-100 px-1.5 py-0.5 rounded text-blue-800">12 Pending</span></button><button type="button" onClick={() => onNotice('System Master Config quick jump is prototype-only.')} className="w-full text-left text-xs text-blue-700 hover:bg-blue-50 px-3 py-1.5 rounded text-left text-blue-700">System Master Config</button></div>
          </div>
          <div className="p-3 m-2 bg-slate-50 border border-slate-200 rounded text-[11px] text-slate-600 leading-relaxed"><div className="font-bold text-slate-800 mb-1">ⓘ Statutory Oversight Scope</div>State Apex Review under Maharashtra RTS Act 2015 Sec. 19. All inter-departmental clearances are monitored with automated SLA breach escalations.</div>
        </aside>
        <div className="flex-1 min-w-0">{children}</div>
      </div>
      <footer className="bg-[#0b2545] text-slate-300 text-[11px] border-t border-slate-700 py-3"><div className="max-w-[1440px] mx-auto px-4 flex flex-col md:flex-row items-center justify-between gap-2"><div><span className="font-semibold text-white">MahaUdyam One</span><span> • Single Window System for Progressive Maharashtra</span><span className="text-slate-500"> | </span><span>Implemented under Maharashtra Right to Public Services Act, 2015</span></div><div><span>Hosted by: State Data Centre (MahaIT / NIC)</span><span className="text-slate-500"> | </span><span className="bg-slate-800 px-2 py-0.5 rounded text-[10px] text-amber-300 font-mono">STQC &amp; WCAG 2.1 AA Compliant</span><span className="ml-2 text-slate-400">Version 3.4.1 (Build 2026.09)</span></div></div></footer>
    </div>
  );
};
