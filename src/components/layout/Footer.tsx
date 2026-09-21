import React from 'react';
import { Link } from '../../router/Router';

export const Footer: React.FC = () => {
  return (
    <footer className="bg-[#091c30] text-slate-300 text-xs border-t-4 border-[#ea580c] mt-auto" data-purpose="site-footer">
      {/* Top 4 Columns Section */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 pb-8 border-b border-slate-800">
          {/* Column 1: Government Authority */}
          <div className="space-y-3">
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 rounded-full border border-amber-500/50 bg-amber-900/30 flex items-center justify-center text-[7px] text-amber-300 font-bold">
                महा शासन
              </div>
              <div>
                <span className="font-bold text-white text-sm">MahaUdyam One</span>
                <span className="block text-[10px] text-slate-400">Government of Maharashtra</span>
              </div>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Integrated Single Window digital platform under the Directorate of Industries, Industries, Energy and Labour Department, Government of Maharashtra.
            </p>
            <div className="text-[11px] text-slate-400">
              <p>New Administrative Building, 2nd Floor, Madam Cama Road, Opposite Mantralaya, Mumbai - 400 032.</p>
              <p className="mt-1">Helpdesk: <span className="text-white font-semibold">1800 233 4567</span></p>
              <p>Email: <span className="text-amber-400 font-medium">support@mahaudyam.gov.in</span></p>
            </div>
          </div>

          {/* Column 2: Quick Links */}
          <div>
            <h4 className="text-white font-semibold text-xs uppercase tracking-wider mb-3 pb-1 border-b border-slate-800">
              Portal Navigation
            </h4>
            <ul className="space-y-2 text-[11px] text-slate-400">
              <li><Link to="/" className="hover:text-white transition">Home</Link></li>
              <li><Link to="/about" className="hover:text-white transition">About MahaUdyam One</Link></li>
              <li><Link to="/approvals" className="hover:text-white transition">Industrial Approvals &amp; Clearances</Link></li>
              <li><Link to="/schemes" className="hover:text-white transition">Government Schemes &amp; Subsidies</Link></li>
              <li><Link to="/how-it-works" className="hover:text-white transition">How Single Window Works</Link></li>
              <li><Link to="/notices" className="hover:text-white transition">Notices, Circulars &amp; GRs</Link></li>
              <li><Link to="/contact" className="hover:text-white transition">Contact &amp; Support Directory</Link></li>
            </ul>
          </div>

          {/* Column 3: Help & Statutory Compliance */}
          <div>
            <h4 className="text-white font-semibold text-xs uppercase tracking-wider mb-3 pb-1 border-b border-slate-800">
              Statutory &amp; Legal
            </h4>
            <ul className="space-y-2 text-[11px] text-slate-400">
              <li><Link to="/help" className="hover:text-white transition">Help &amp; Frequently Asked Questions</Link></li>
              <li><Link to="/notices" className="hover:text-white transition">Maharashtra RTS Act 2015 Citizen Charter</Link></li>
              <li><span className="text-slate-400">Right to Information (RTI) Portal</span></li>
              <li><span className="text-slate-400">Privacy Policy &amp; Data Protection</span></li>
              <li><span className="text-slate-400">Terms of Service &amp; Legal Disclaimer</span></li>
              <li><span className="text-slate-400">Hyperlinking &amp; Copyright Policy</span></li>
            </ul>
          </div>

          {/* Column 4: Digital Governance Initiatives */}
          <div className="space-y-3">
            <h4 className="text-white font-semibold text-xs uppercase tracking-wider mb-3 pb-1 border-b border-slate-800">
              Digital Governance
            </h4>
            <div className="space-y-2">
              <div className="p-2.5 rounded bg-slate-800/80 border border-slate-700/80">
                <div className="flex items-center gap-1.5 text-white font-semibold text-[11px]">
                  <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                  <span>Aaple Sarkar Integrated</span>
                </div>
                <p className="text-[10px] text-slate-400 mt-0.5 leading-tight">Connected with Maharashtra Public Service Guarantee Commission.</p>
              </div>
              <div className="p-2.5 rounded bg-slate-800/80 border border-slate-700/80">
                <div className="flex items-center gap-1.5 text-white font-semibold text-[11px]">
                  <span className="w-2 h-2 rounded-full bg-sky-400"></span>
                  <span>Digital India Initiative</span>
                </div>
                <p className="text-[10px] text-slate-400 mt-0.5 leading-tight">Empowering business with transparent paperless single-window e-governance.</p>
              </div>
            </div>
            <div className="flex items-center gap-2 pt-1 text-[10px] text-slate-400">
              <span className="bg-slate-800 px-2 py-0.5 rounded border border-slate-700">GIGW 3.0</span>
              <span className="bg-slate-800 px-2 py-0.5 rounded border border-slate-700">W3C WCAG 2.1 AA</span>
              <span className="bg-slate-800 px-2 py-0.5 rounded border border-slate-700">CERT-In Audited</span>
            </div>
          </div>
        </div>

        {/* Bottom Copyright & Compliance Strip */}
        <div className="pt-6 flex flex-col md:flex-row items-center justify-between text-[11px] text-slate-400 gap-3">
          <div>
            © 2026 Government of Maharashtra. All rights reserved. Content managed by Directorate of Industries, Mumbai.
          </div>
          <div className="flex items-center space-x-4">
            <span>Screen Reader Accessible</span>
            <span>•</span>
            <span>Node: BOM-PROD-PUB-01</span>
            <span>•</span>
            <span>Build: v4.8.2-gov</span>
          </div>
        </div>
      </div>
    </footer>
  );
};
