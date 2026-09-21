import React from 'react';
import { useRouter } from '../../router/Router';
import { ApprovalApplication } from '../../types/application';

interface ApplicationStepHeaderProps {
  application: ApprovalApplication;
  currentStep: 1 | 2 | 3;
  onSaveDraft?: () => void;
  isSaving?: boolean;
  saveMessage?: string | null;
}

export const ApplicationStepHeader: React.FC<ApplicationStepHeaderProps> = ({
  application,
  currentStep,
  onSaveDraft,
  isSaving,
  saveMessage,
}) => {
  const { navigate } = useRouter();

  const steps = [
    { number: 1, label: 'CTE Parameters', path: '/applicant/applications/cte' },
    { number: 2, label: 'Document Validation', path: '/applicant/applications/cte/documents' },
    { number: 3, label: 'Review & Submission', path: '/applicant/applications/cte/review' },
  ];

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden mb-6">
      {/* Top Bar with Prototype Notice & Identifiers */}
      <div className="bg-[#0f2b48] text-white px-5 py-3 flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2.5 flex-wrap">
          <span className="px-2 py-0.5 rounded bg-blue-500/20 text-blue-200 font-mono font-bold border border-blue-400/30 text-[11px]">
            {application.applicationNumber}
          </span>
          <span className="text-slate-400">•</span>
          <span className="font-semibold text-slate-200">
            {application.approvalName} ({application.serviceCode})
          </span>
          <span className="text-slate-400 hidden sm:inline">•</span>
          <span className="text-slate-300 hidden sm:inline">
            {application.department}
          </span>
        </div>

        <div className="flex items-center gap-3">
          <span className="px-2 py-0.5 rounded-full text-[10.5px] font-bold tracking-wide uppercase bg-amber-400/20 text-amber-300 border border-amber-400/40">
            {application.status === 'Submitted' ? 'Submitted' : 'Draft In Progress'}
          </span>
          <span className="text-[11px] text-slate-300 font-mono">
            {isSaving ? 'Saving...' : saveMessage || 'Draft Auto-Saved'}
          </span>
          {onSaveDraft && application.status !== 'Submitted' && (
            <button
              type="button"
              onClick={onSaveDraft}
              disabled={isSaving}
              className="px-3 py-1 bg-white/10 hover:bg-white/20 text-white rounded-lg text-xs font-semibold transition border border-white/20 cursor-pointer"
            >
              {isSaving ? 'Saving...' : 'Save Draft'}
            </button>
          )}
        </div>
      </div>

      {/* Sub Header with Stepper */}
      <div className="p-5 sm:p-6 bg-slate-50/60 border-b border-slate-200">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs text-slate-500 mb-1">
              <span>Entity: <strong className="text-slate-800">{application.enterpriseName}</strong></span>
              <span>•</span>
              <span>Project: <strong className="text-slate-800">{application.projectName}</strong></span>
            </div>
            <h1 className="text-xl sm:text-2xl font-bold font-serif text-[#0f2b48]">
              {currentStep === 1 && 'Step 1: Project Profile & Statutory Parameters'}
              {currentStep === 2 && 'Step 2: Statutory Document Validation & Locker Reuse'}
              {currentStep === 3 && 'Step 3: Comprehensive Review & Digital Submission'}
            </h1>
            <p className="text-xs text-slate-500 mt-1">
              Statutory filing under Water (Prevention & Control of Pollution) Act 1974 and Air Act 1981 via Maharashtra Single Window.
            </p>
          </div>

          {/* Prototype Simulation Warning Badge */}
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-[11px] text-amber-800 max-w-xs shrink-0">
            <span className="font-bold">⚠️ Prototype Simulation:</span> Filings made in this sandbox do not trigger physical government inspections or statutory notices.
          </div>
        </div>

        {/* 3-Step Interactive Stepper */}
        <div className="mt-6 pt-5 border-t border-slate-200">
          <div className="grid grid-cols-3 gap-2 sm:gap-4">
            {steps.map((s) => {
              const isActive = currentStep === s.number;
              const isPast = currentStep > s.number;
              return (
                <button
                  key={s.number}
                  type="button"
                  onClick={() => {
                    // Allow navigating between steps
                    navigate(s.path);
                  }}
                  className={`flex items-center gap-2.5 p-2 sm:p-3 rounded-xl border text-left transition cursor-pointer ${
                    isActive
                      ? 'bg-white border-blue-900 shadow-2xs ring-2 ring-blue-900/10'
                      : isPast
                      ? 'bg-emerald-50/60 border-emerald-200 hover:bg-emerald-50'
                      : 'bg-white/60 border-slate-200 hover:bg-white text-slate-400'
                  }`}
                >
                  <div
                    className={`w-7 h-7 sm:w-8 sm:h-8 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 ${
                      isActive
                        ? 'bg-[#0f2b48] text-white'
                        : isPast
                        ? 'bg-emerald-600 text-white'
                        : 'bg-slate-200 text-slate-600'
                    }`}
                  >
                    {isPast ? '✓' : s.number}
                  </div>
                  <div className="min-w-0">
                    <span className="text-[10px] uppercase font-bold block tracking-wider text-slate-400">
                      Step 0{s.number}
                    </span>
                    <span
                      className={`text-xs sm:text-sm font-semibold truncate block ${
                        isActive
                          ? 'text-[#0f2b48]'
                          : isPast
                          ? 'text-emerald-900'
                          : 'text-slate-600'
                      }`}
                    >
                      {s.label}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
