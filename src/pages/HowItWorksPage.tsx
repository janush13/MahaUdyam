import React from 'react';
import { Link } from '../router/Router';

export const HowItWorksPage: React.FC = () => {
  const stepsCol1 = [
    {
      num: '01',
      title: 'Register Profile',
      desc: 'Create an investor account using your mobile number, PAN, and Aadhaar-linked OTP for immediate verification.',
    },
    {
      num: '02',
      title: 'Add Enterprise',
      desc: 'Link your business identity, Udyam Registration, GSTIN, and company incorporation documents in a secure digital vault.',
    },
    {
      num: '03',
      title: 'Define Industrial Project',
      desc: 'Input proposed manufacturing activity, capital investment, land zone (MIDC / Non-MIDC), power load, and water requirements.',
    },
    {
      num: '04',
      title: 'Discover Approvals',
      desc: 'Our statutory rules engine automatically identifies every mandatory permit, licence, and NOC needed for your specific unit.',
    },
    {
      num: '05',
      title: 'Prepare Single Checklist',
      desc: 'Review the unified list of required drawings, CA certificates, and architectural plans with zero duplicate submissions.',
    },
    {
      num: '06',
      title: 'Apply via Combined Form',
      desc: 'Submit the Combined Application Form (CAF) with a single-click consolidated statutory fee payment via integrated payment gateway.',
    },
  ];

  const stepsCol2 = [
    {
      num: '07',
      title: 'Departmental Scrutiny',
      desc: 'All 25+ onboarded departments scrutinize your filings simultaneously under legally binding Maharashtra RTSA timelines.',
    },
    {
      num: '08',
      title: 'Central Joint Inspection',
      desc: 'If physical verification is mandated, a computerized randomized joint inspection is scheduled with 48-hour prior notification.',
    },
    {
      num: '09',
      title: 'Query Resolution & Hearing',
      desc: 'Respond to departmental clarifications in a unified query window within statutory SLA countdown clocks.',
    },
    {
      num: '10',
      title: 'Department Decision',
      desc: 'Competent authorities grant approvals. Deemed approval escalations trigger automatically if time limits expire.',
    },
    {
      num: '11',
      title: 'Receive Digital Certificate',
      desc: 'Download digitally signed, QR-code verifiable certificates and licences directly into your portal document locker.',
    },
    {
      num: '12',
      title: 'Compliance & Renewal Alerts',
      desc: 'Automated SMS and dashboard reminders for periodic environmental monitoring reports, factory returns, and licence renewals.',
    },
  ];

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6" data-purpose="how-it-works-screen">
      {/* Breadcrumb */}
      <nav aria-label="Breadcrumb" className="flex items-center space-x-1.5 text-xs text-slate-500 mb-4">
        <Link to="/" className="hover:text-[#0f2b48] transition-colors">Home</Link>
        <span className="text-slate-400">›</span>
        <span aria-current="page" className="text-slate-800 font-medium">How It Works</span>
      </nav>

      {/* Header Banner */}
      <div className="bg-white border border-slate-200 rounded-lg p-5 sm:p-6 mb-8 shadow-2xs">
        <div className="max-w-3xl">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-800 text-[11px] font-semibold mb-2">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-600"></span>
            End-to-End Digital Single Window Journey
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#0f2b48] font-serif">
            How MahaUdyam One Works
          </h1>
          <p className="text-xs sm:text-sm text-slate-600 mt-1.5 leading-relaxed">
            A transparent, time-bound, 12-step guided journey designed to eliminate physical departmental visits, bureaucratic delays, and redundant documentation across Maharashtra.
          </p>
        </div>
      </div>

      {/* 12-Step 2-Column Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
        {/* Column 1: Pre-Filing & Application (Steps 01 - 06) */}
        <div className="space-y-4">
          <div className="flex items-center justify-between pb-2 border-b-2 border-blue-600">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-900">
              Phase A: Discovery &amp; Application Filing
            </h2>
            <span className="text-[11px] font-semibold text-blue-700">Steps 01–06</span>
          </div>

          <div className="space-y-3.5">
            {stepsCol1.map((step) => (
              <div
                key={step.num}
                className="bg-white border border-slate-200 rounded-lg p-4 shadow-2xs hover:border-blue-300 transition flex items-start space-x-3.5"
              >
                <div className="w-8 h-8 rounded-full bg-blue-50 text-blue-800 border border-blue-200 flex items-center justify-center font-bold text-xs shrink-0 font-mono">
                  {step.num}
                </div>
                <div>
                  <h3 className="text-xs font-bold text-slate-900 leading-snug">
                    {step.title}
                  </h3>
                  <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                    {step.desc}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Column 2: Scrutiny, Decision & Lifecycle (Steps 07 - 12) */}
        <div className="space-y-4">
          <div className="flex items-center justify-between pb-2 border-b-2 border-emerald-600">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-900">
              Phase B: Scrutiny, Approval &amp; Lifecycle
            </h2>
            <span className="text-[11px] font-semibold text-emerald-700">Steps 07–12</span>
          </div>

          <div className="space-y-3.5">
            {stepsCol2.map((step) => (
              <div
                key={step.num}
                className="bg-white border border-slate-200 rounded-lg p-4 shadow-2xs hover:border-emerald-300 transition flex items-start space-x-3.5"
              >
                <div className="w-8 h-8 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 flex items-center justify-center font-bold text-xs shrink-0 font-mono">
                  {step.num}
                </div>
                <div>
                  <h3 className="text-xs font-bold text-slate-900 leading-snug">
                    {step.title}
                  </h3>
                  <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                    {step.desc}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Callout Strip */}
      <div className="bg-[#0f2b48] text-white rounded-lg p-5 flex flex-col sm:flex-row items-center justify-between gap-4 shadow-sm">
        <div>
          <h3 className="text-sm font-bold text-white">Ready to begin your business clearance journey?</h3>
          <p className="text-xs text-slate-300 mt-0.5">
            Explore statutory approvals and checklist requirements without registering.
          </p>
        </div>
        <div className="flex items-center space-x-3 shrink-0">
          <Link
            to="/approvals"
            className="px-4 py-2 bg-[#f58220] hover:bg-[#e07110] text-white text-xs font-bold rounded transition"
          >
            Explore Approvals
          </Link>
          <Link
            to="/contact"
            className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white text-xs font-semibold rounded border border-white/20 transition"
          >
            Contact Helpdesk
          </Link>
        </div>
      </div>
    </div>
  );
};
