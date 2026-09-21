import React from 'react';
import { Link, useRouter } from '../../router/Router';
import { useAuth } from '../../context/AuthContext';

export const MainHeader: React.FC = () => {
  const { navigate } = useRouter();
  const { user, isAuthenticated, logout } = useAuth();

  const handleLogout = (e: React.MouseEvent) => {
    e.preventDefault();
    logout();
    navigate('/login');
  };

  return (
    <header className="bg-white border-b border-slate-200" data-purpose="primary-identity-header">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3.5 flex items-center justify-between gap-4">
        {/* State Seal & Portal Identity */}
        <Link to="/" className="flex items-center space-x-3.5 group focus:outline-none">
          {/* Official Seal Emblem */}
          <div className="w-12 h-12 rounded-full border-2 border-amber-600/40 bg-amber-50 flex items-center justify-center p-1 text-center shadow-xs shrink-0 group-hover:border-amber-600 transition">
            <div className="w-full h-full rounded-full border border-amber-700/60 flex flex-col items-center justify-center bg-amber-100/50">
              <span className="text-[7.5px] font-bold text-amber-900 leading-none">महाराष्ट्र</span>
              <span className="text-[6.5px] font-bold text-amber-800 leading-tight">शासन</span>
            </div>
          </div>
          <div>
            <span className="block text-[10.5px] font-bold tracking-widest text-slate-500 uppercase leading-tight">
              Government of Maharashtra
            </span>
            <div className="flex items-baseline space-x-2">
              <span className="text-xl sm:text-2xl font-black text-[#0f2b48] tracking-tight leading-none group-hover:text-blue-900 transition">
                MahaUdyam <span className="text-blue-700 font-extrabold">One</span>
              </span>
              <span className="hidden sm:inline-block text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-blue-100 text-blue-800 border border-blue-200">
                Single Window System
              </span>
            </div>
            <p className="text-xs text-slate-500 font-medium leading-none mt-0.5">
              Single Window for a Progressive Maharashtra
            </p>
          </div>
        </Link>

        {/* Toll-Free Helpdesk & Authentication Action */}
        <div className="flex items-center space-x-3 sm:space-x-5">
          <div className="hidden lg:flex flex-col text-right border-r border-slate-200 pr-5">
            <span className="text-[10.5px] uppercase font-bold text-slate-400 tracking-wider">
              Toll-Free Investor Helpline
            </span>
            <span className="text-sm font-bold text-[#0f2b48] font-mono tracking-tight flex items-center justify-end gap-1">
              <span className="text-emerald-600 text-xs">📞</span> 1800 233 4567
            </span>
            <span className="text-[10px] text-slate-400">09:00 AM - 06:00 PM (Working Days)</span>
          </div>

          {isAuthenticated && user ? (
            <div className="flex items-center space-x-2.5">
              <Link
                to="/applicant/dashboard"
                className="inline-flex items-center space-x-2 bg-blue-50 hover:bg-blue-100 border border-blue-200 text-[#0f2b48] text-xs font-semibold px-3.5 py-2 rounded shadow-2xs transition"
              >
                <span className="w-6 h-6 rounded-full bg-blue-800 text-white flex items-center justify-center text-[11px] font-bold">
                  {user.name ? user.name[0].toUpperCase() : 'U'}
                </span>
                <span className="hidden md:inline font-medium">{user.name}</span>
                <span className="px-1.5 py-0.2 rounded text-[9px] font-bold uppercase bg-blue-200 text-blue-900">
                  {user.role}
                </span>
              </Link>

              <button
                type="button"
                onClick={handleLogout}
                className="text-xs font-semibold text-rose-700 hover:text-rose-900 px-2.5 py-2 hover:bg-rose-50 rounded transition cursor-pointer"
                title="Sign out of Single Window Session"
              >
                Logout
              </button>
            </div>
          ) : (
            <div className="flex items-center space-x-2">
              <Link
                to="/login"
                className="inline-flex items-center space-x-1.5 bg-[#0f2b48] hover:bg-[#16385d] text-white text-xs font-semibold px-3.5 py-2 rounded shadow-sm hover:shadow transition focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#0f2b48] cursor-pointer"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
                </svg>
                <span>Login</span>
              </Link>
              <Link
                to="/register"
                className="hidden sm:inline-flex items-center space-x-1 border border-slate-300 hover:border-slate-400 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold px-3 py-2 rounded shadow-2xs transition"
              >
                <span>Register</span>
              </Link>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};

