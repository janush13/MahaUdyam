import React, { useState } from 'react';
import { Link, useRouter } from '../../router/Router';

export const PrimaryNavigation: React.FC = () => {
  const { currentPath } = useRouter();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [resourcesOpen, setResourcesOpen] = useState(false);

  const isActive = (path: string) => {
    if (path === '/') return currentPath === '/';
    return currentPath.startsWith(path);
  };

  const navLinks = [
    { name: 'Home', path: '/' },
    { name: 'About', path: '/about' },
    { name: 'Industrial Approvals', path: '/approvals' },
    { name: 'Government Schemes', path: '/schemes' },
    { name: 'How It Works', path: '/how-it-works' },
    { name: 'Notices & Circulars', path: '/notices' },
    { name: 'Help & Support', path: '/help' },
    { name: 'Contact', path: '/contact' },
  ];

  return (
    <nav className="bg-[#0f2b48] text-white sticky top-0 z-40 shadow-md" data-purpose="primary-navbar">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-11">
          {/* Desktop Navigation Links */}
          <div className="hidden md:flex items-center space-x-1 text-xs font-medium h-full overflow-x-auto">
            {navLinks.map((link) => {
              const active = isActive(link.path);
              return (
                <Link
                  key={link.path}
                  to={link.path}
                  className={`px-3.5 py-3 h-full flex items-center transition-colors whitespace-nowrap ${
                    active
                      ? 'bg-[#183d63] text-white font-bold border-b-[3px] border-[#ea580c]'
                      : 'text-slate-200 hover:text-white hover:bg-white/10'
                  }`}
                >
                  {link.name}
                </Link>
              );
            })}
          </div>

          {/* Operational Live Indicator */}
          <div className="hidden lg:flex items-center space-x-2 text-[11px] text-slate-300 font-medium">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            <span>Portal Live &amp; Functional</span>
          </div>

          {/* Mobile Menu Button */}
          <div className="md:hidden flex items-center justify-between w-full py-1">
            <span className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
              MahaUdyam One
            </span>
            <button
              type="button"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="p-1.5 rounded text-slate-300 hover:text-white hover:bg-white/10 focus:outline-none"
              aria-label="Toggle navigation menu"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {mobileMenuOpen ? (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" />
                )}
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Menu Drawer */}
      {mobileMenuOpen && (
        <div className="md:hidden bg-[#0a1e35] border-t border-slate-700 px-4 py-3 space-y-1">
          {navLinks.map((link) => {
            const active = isActive(link.path);
            return (
              <Link
                key={link.path}
                to={link.path}
                onClick={() => setMobileMenuOpen(false)}
                className={`block px-3 py-2 rounded text-xs font-medium transition ${
                  active
                    ? 'bg-blue-800 text-white font-bold border-l-4 border-[#ea580c]'
                    : 'text-slate-300 hover:bg-white/5 hover:text-white'
                }`}
              >
                {link.name}
              </Link>
            );
          })}
          <div className="pt-2 border-t border-slate-700/60 flex items-center justify-between text-[11px] text-slate-300">
            <Link
              to="/login"
              onClick={() => setMobileMenuOpen(false)}
              className="text-xs font-bold text-amber-400 hover:text-amber-300"
            >
              Sign In / Applicant Access →
            </Link>
            <span className="text-[10px] text-slate-400">1800 233 4567</span>
          </div>
        </div>
      )}
    </nav>
  );
};
