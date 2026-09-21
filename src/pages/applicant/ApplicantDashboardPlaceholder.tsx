import React from 'react';
import { Link, useRouter } from '../../router/Router';
import { useAuth } from '../../context/AuthContext';

export const ApplicantDashboardPlaceholder: React.FC = () => {
  const { user, logout } = useAuth();
  const { navigate } = useRouter();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8" data-purpose="applicant-dashboard-phase2-target">
      {/* Breadcrumb */}
      <div className="flex items-center justify-between text-xs text-slate-500 mb-6 pb-3 border-b border-slate-200">
        <div className="flex items-center space-x-2">
          <span className="text-slate-800 font-semibold">MahaUdyam One</span>
          <span>›</span>
          <span className="text-blue-700 font-medium">Applicant Portal</span>
          <span>›</span>
          <span className="text-slate-500">Dashboard Target</span>
        </div>
        <button
          type="button"
          onClick={handleLogout}
          className="text-rose-700 hover:text-rose-900 font-bold flex items-center gap-1.5 px-3 py-1 bg-rose-50 border border-rose-200 rounded transition"
        >
          <span>Sign Out / Logout</span>
          <span>🚪</span>
        </button>
      </div>

      {/* Authenticated Session Confirmation Banner */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden mb-6">
        <div className="bg-[#0f2b48] text-white p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center space-x-4">
            <div className="w-12 h-12 rounded-full bg-blue-800 border-2 border-blue-400 flex items-center justify-center text-xl font-bold">
              👤
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg sm:text-xl font-bold tracking-tight">
                  Welcome, {user?.name || 'Authorized Applicant'}
                </h1>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-emerald-500/20 text-emerald-300 border border-emerald-400/30">
                  {user?.role || 'APPLICANT'}
                </span>
              </div>
              <p className="text-xs text-slate-300 mt-0.5">
                {user?.entityName || 'Industrial Enterprise Representative'}
              </p>
            </div>
          </div>

          <div className="sm:text-right border-t sm:border-t-0 border-white/10 pt-3 sm:pt-0">
            <span className="text-[11px] text-slate-300 block">Session Status</span>
            <span className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-400">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              ACTIVE (Authenticated)
            </span>
            <span className="block font-mono text-[10px] text-slate-400 mt-0.5">
              ID: {user?.id || 'USR-MH-2026-0891'}
            </span>
          </div>
        </div>

        {/* User Dossier Quick Details */}
        <div className="p-6 bg-slate-50/70 grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs border-b border-slate-200">
          <div>
            <span className="text-slate-400 text-[10px] uppercase font-bold block mb-0.5">Registered Email</span>
            <span className="font-semibold text-slate-800 font-mono">{user?.email}</span>
          </div>
          <div>
            <span className="text-slate-400 text-[10px] uppercase font-bold block mb-0.5">Contact Mobile</span>
            <span className="font-semibold text-slate-800 font-mono">+91 {user?.mobile}</span>
          </div>
          <div>
            <span className="text-slate-400 text-[10px] uppercase font-bold block mb-0.5">Role Authority</span>
            <span className="font-semibold text-blue-900">{user?.role} Access</span>
          </div>
        </div>

        {/* Phase 3 Scope Notice */}
        <div className="p-6 text-xs text-slate-600 space-y-4">
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <h2 className="text-xs font-bold text-blue-950 uppercase tracking-wider mb-1 flex items-center gap-1.5">
              <span>🚀</span> Phase 2 Target Achieved: Authentication Session Established
            </h2>
            <p className="text-xs text-blue-900 leading-relaxed">
              You have successfully completed the <strong>Phase 2 Authentication &amp; Registration flow</strong>. The session token, user identity, and route protection mechanisms are now active.
            </p>
          </div>

          <div className="border border-slate-200 rounded-lg p-4 bg-white space-y-2">
            <h3 className="text-xs font-bold text-slate-900">
              Scheduled for Phase 3: Applicant Portal (Screens 13–16)
            </h3>
            <p className="text-[11px] text-slate-500 leading-relaxed">
              Full workspace features including Active Applications, Common Application Form (CAF) progress, Clearance Tracker, and Scheme Claims will be implemented in Phase 3.
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 text-[11px] font-medium text-slate-700">
              <span className="p-2 bg-slate-100 rounded border border-slate-200 text-center">Screen 13: Dashboard</span>
              <span className="p-2 bg-slate-100 rounded border border-slate-200 text-center">Screen 14: My Clearances</span>
              <span className="p-2 bg-slate-100 rounded border border-slate-200 text-center">Screen 15: Document Locker</span>
              <span className="p-2 bg-slate-100 rounded border border-slate-200 text-center">Screen 16: Profile &amp; Unit</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
            <Link
              to="/approvals"
              className="text-xs font-bold text-blue-800 hover:text-blue-950 underline"
            >
              ← Explore Approvals Catalog
            </Link>

            <button
              type="button"
              onClick={handleLogout}
              className="px-4 py-2 bg-[#0f2b48] hover:bg-slate-800 text-white rounded text-xs font-bold transition shadow-xs"
            >
              Sign Out &amp; Return to Login
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
