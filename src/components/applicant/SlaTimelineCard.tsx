import React from 'react';
import { ApplicantApplication } from '../../types/applicant';

export interface SlaTimelineCardProps {
  application: ApplicantApplication;
  onViewDetails?: (appId: string) => void;
  compact?: boolean;
}

export const SlaTimelineCard: React.FC<SlaTimelineCardProps> = ({
  application,
  onViewDetails,
  compact = false,
}) => {
  const {
    appRefNumber,
    approvalName,
    department,
    projectName,
    stage,
    status,
    submittedDate,
    slaTargetDate,
    slaDaysRemaining,
    slaTotalDays,
    currentOfficer,
  } = application;

  // Calculate elapsed percentage safely
  const elapsedDays = Math.max(0, slaTotalDays - slaDaysRemaining);
  const progressPercent = Math.min(100, Math.round((elapsedDays / slaTotalDays) * 100));

  // SLA Indicator Color and Label
  let slaBadgeBg = 'bg-emerald-50 text-emerald-700 border-emerald-200';
  let slaLabel = `${slaDaysRemaining} Days Left`;
  let progressBarColor = 'bg-emerald-500';

  if (status === 'Approved') {
    slaBadgeBg = 'bg-emerald-100 text-emerald-800 border-emerald-300';
    slaLabel = 'Completed within SLA';
    progressBarColor = 'bg-emerald-600';
  } else if (slaDaysRemaining <= 5 && slaDaysRemaining > 0) {
    slaBadgeBg = 'bg-amber-50 text-amber-700 border-amber-300 animate-pulse';
    slaLabel = `Critical: ${slaDaysRemaining} Days Left`;
    progressBarColor = 'bg-amber-500';
  } else if (slaDaysRemaining === 0) {
    slaBadgeBg = 'bg-rose-50 text-rose-700 border-rose-300';
    slaLabel = 'SLA Breached / Escalated';
    progressBarColor = 'bg-rose-500';
  }

  // Status Badge formatting
  const getStatusBadge = () => {
    switch (status) {
      case 'Approved':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 border border-emerald-300">
            <span>✓</span> Approved &amp; Issued
          </span>
        );
      case 'Under Scrutiny':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-800 border border-blue-200">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-600 animate-ping" />
            Under Scrutiny
          </span>
        );
      case 'Query Raised':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-900 border border-amber-300">
            <span>⚠️</span> Clarification Required
          </span>
        );
      case 'Pending Fee':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-purple-100 text-purple-800 border border-purple-200">
            <span>💳</span> Payment Pending
          </span>
        );
      case 'Inspection Scheduled':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-100 text-indigo-800 border border-indigo-200">
            <span>🔍</span> Site Inspection
          </span>
        );
      default:
        return (
          <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-800 border border-slate-300">
            {status}
          </span>
        );
    }
  };

  return (
    <div
      className="bg-white rounded-xl border border-slate-200 shadow-2xs hover:shadow-xs transition p-4 sm:p-5 flex flex-col justify-between"
      data-ref-number={appRefNumber}
    >
      {/* Header */}
      <div>
        <div className="flex flex-wrap items-start justify-between gap-2 mb-2">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs font-bold text-blue-900 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
              {appRefNumber}
            </span>
            <span className="text-[11px] font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
              {stage}
            </span>
          </div>
          <div>{getStatusBadge()}</div>
        </div>

        {/* Title and Project */}
        <h4 className="text-sm sm:text-base font-bold text-slate-900 leading-snug">
          {approvalName}
        </h4>
        <p className="text-xs text-slate-600 mt-0.5">
          <span className="font-medium text-slate-700">{department}</span>
        </p>
        <p className="text-[11px] text-slate-500 mt-1 flex items-center gap-1">
          <span>🏭 Project:</span>
          <span className="font-medium text-slate-800 truncate">{projectName}</span>
        </p>
      </div>

      {/* SLA & Progress Section */}
      <div className="mt-4 pt-3 border-t border-slate-100 space-y-2.5">
        <div className="flex items-center justify-between text-xs">
          <span className="text-slate-500 flex items-center gap-1">
            <span>⏱️ Statutory SLA:</span>
            <span className="font-bold text-slate-800">{slaTotalDays} Working Days</span>
          </span>
          <span className={`px-2 py-0.5 rounded text-[11px] font-bold border ${slaBadgeBg}`}>
            {slaLabel}
          </span>
        </div>

        {/* Progress Bar */}
        <div>
          <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
            <div
              className={`h-full ${progressBarColor} transition-all duration-500`}
              style={{ width: `${progressPercent}%` }}
              role="progressbar"
              aria-valuenow={progressPercent}
              aria-valuemin={0}
              aria-valuemax={100}
            />
          </div>
          <div className="flex items-center justify-between text-[10.5px] text-slate-500 mt-1">
            <span>Submitted: {submittedDate}</span>
            <span>Target SLA Date: {slaTargetDate}</span>
          </div>
        </div>

        {/* Officer in charge (if present) & Details CTA */}
        {!compact && (
          <div className="flex items-center justify-between pt-2 text-xs border-t border-slate-50">
            <span className="text-slate-500 text-[11px] truncate max-w-[240px]">
              Assigned: <span className="text-slate-700 font-medium">{currentOfficer || 'Single Window Cell'}</span>
            </span>
            {onViewDetails && (
              <button
                type="button"
                onClick={() => onViewDetails(application.id)}
                className="text-blue-700 hover:text-blue-900 font-semibold text-xs hover:underline cursor-pointer"
              >
                View Tracker ›
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
