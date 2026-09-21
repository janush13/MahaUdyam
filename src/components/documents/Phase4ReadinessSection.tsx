import React, { useState } from 'react';
import { documentVaultService } from '../../services/documentVaultService';
import { applicantService } from '../../services/applicantService';
import { DocumentRecord } from '../../types/documentVault';
import { DocumentRequirement } from '../../types/approvalDiscovery';

interface Phase4ReadinessSectionProps {
  onOpenReuseModal: (req: {
    requirementName: string;
    clearanceCode: string;
    clearanceName: string;
    category?: string;
  }) => void;
  onOpenUploadForRequirement: (req: DocumentRequirement) => void;
  onViewDocDetails: (doc: DocumentRecord) => void;
}

export const Phase4ReadinessSection: React.FC<Phase4ReadinessSectionProps> = ({
  onOpenReuseModal,
  onOpenUploadForRequirement,
  onViewDocDetails,
}) => {
  const projects = applicantService.getProjects();
  const [selectedProjectId, setSelectedProjectId] = useState<string>(
    projects[0]?.id || 'proj-chk-01'
  );
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'READY' | 'PENDING' | 'MISSING'>('ALL');

  const readiness = documentVaultService.getPhase4Readiness(selectedProjectId);
  const activeProject = projects.find((p) => p.id === selectedProjectId) || projects[0];

  const filteredRequirements = readiness.requirementsMap.filter((item) => {
    if (statusFilter === 'READY') return item.status === 'VERIFIED_AVAILABLE';
    if (statusFilter === 'PENDING') return item.status === 'PENDING_VERIFICATION' || item.status === 'EXPIRED';
    if (statusFilter === 'MISSING') return item.status === 'MISSING';
    return true;
  });

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 shadow-2xs space-y-6">
      {/* Section Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-100 pb-5">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-blue-100 text-blue-900 border border-blue-200">
              ⚡ Phase 4 Clearance Rule Engine Sync
            </span>
            <span className="text-slate-400 text-xs">•</span>
            <span className="text-[11px] text-slate-500">
              Statutory Single Window Readiness
            </span>
          </div>
          <h3 className="text-base sm:text-lg font-bold text-slate-900 font-serif">
            Statutory Clearance Document Readiness Matrix
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Cross-references clearances identified in Phase 4 against verified credentials deposited in your locker.
          </p>
        </div>

        {/* Project Selector */}
        <div className="flex items-center gap-2">
          <label htmlFor="project-readiness-select" className="text-xs font-semibold text-slate-600 shrink-0">
            Project Dossier:
          </label>
          <select
            id="project-readiness-select"
            value={selectedProjectId}
            onChange={(e) => setSelectedProjectId(e.target.value)}
            className="px-3 py-1.5 rounded-xl border border-slate-300 text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-slate-50"
          >
            {projects.map((proj) => (
              <option key={proj.id} value={proj.id}>
                {proj.name} ({proj.district})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Readiness Metrics Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {/* Progress Gauge */}
        <div className="p-4 rounded-xl border border-blue-200 bg-blue-50/50 flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs text-blue-900 font-semibold mb-1">
            <span>Readiness Score</span>
            <span className="text-sm font-bold font-mono">{readiness.readinessPercentage}%</span>
          </div>
          <div className="w-full bg-blue-200/70 h-2.5 rounded-full overflow-hidden mb-2">
            <div
              className="bg-blue-600 h-full rounded-full transition-all duration-500"
              style={{ width: `${readiness.readinessPercentage}%` }}
            />
          </div>
          <span className="text-[10.5px] text-blue-700">
            {readiness.verifiedCount} of {readiness.totalRequired} documents verified
          </span>
        </div>

        {/* Total Required */}
        <div className="p-4 rounded-xl border border-slate-200 bg-white">
          <span className="text-[10.5px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
            Total Required
          </span>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-extrabold text-slate-900 font-serif">
              {readiness.totalRequired}
            </span>
            <span className="text-xs text-slate-500">Certificates</span>
          </div>
          <span className="text-[10.5px] text-slate-400 mt-1 block truncate">
            Across active clearances
          </span>
        </div>

        {/* Verified & Ready */}
        <div className="p-4 rounded-xl border border-emerald-200 bg-emerald-50/40">
          <span className="text-[10.5px] font-bold text-emerald-800 uppercase tracking-wider block mb-1">
            Verified in Locker
          </span>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-extrabold text-emerald-900 font-serif">
              {readiness.verifiedCount}
            </span>
            <span className="text-xs font-bold text-emerald-700">Ready to Reuse</span>
          </div>
          <span className="text-[10.5px] text-emerald-600/90 mt-1 block">
            Statutorily authenticated
          </span>
        </div>

        {/* Under Scrutiny / Expired */}
        <div className="p-4 rounded-xl border border-amber-200 bg-amber-50/40">
          <span className="text-[10.5px] font-bold text-amber-900 uppercase tracking-wider block mb-1">
            Pending / Expired
          </span>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-extrabold text-amber-900 font-serif">
              {readiness.pendingCount}
            </span>
            <span className="text-xs text-amber-800">Under Review</span>
          </div>
          <span className="text-[10.5px] text-amber-700 mt-1 block">
            In officer verification
          </span>
        </div>

        {/* Missing Required */}
        <div className="p-4 rounded-xl border border-rose-200 bg-rose-50/40">
          <span className="text-[10.5px] font-bold text-rose-800 uppercase tracking-wider block mb-1">
            Missing in Vault
          </span>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-extrabold text-rose-900 font-serif">
              {readiness.missingCount}
            </span>
            <span className="text-xs font-bold text-rose-700">Action Needed</span>
          </div>
          <span className="text-[10.5px] text-rose-600 mt-1 block">
            Must upload to complete
          </span>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-100 pb-2 text-xs">
        <button
          type="button"
          onClick={() => setStatusFilter('ALL')}
          className={`px-3 py-1.5 rounded-lg font-semibold transition cursor-pointer ${
            statusFilter === 'ALL'
              ? 'bg-slate-900 text-white'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          All Requirements ({readiness.requirementsMap.length})
        </button>
        <button
          type="button"
          onClick={() => setStatusFilter('READY')}
          className={`px-3 py-1.5 rounded-lg font-semibold transition cursor-pointer flex items-center gap-1 ${
            statusFilter === 'READY'
              ? 'bg-emerald-600 text-white'
              : 'text-emerald-700 hover:bg-emerald-50'
          }`}
        >
          <span>✓ Verified Ready ({readiness.verifiedCount})</span>
        </button>
        <button
          type="button"
          onClick={() => setStatusFilter('PENDING')}
          className={`px-3 py-1.5 rounded-lg font-semibold transition cursor-pointer flex items-center gap-1 ${
            statusFilter === 'PENDING'
              ? 'bg-amber-600 text-white'
              : 'text-amber-800 hover:bg-amber-50'
          }`}
        >
          <span>⏳ In Verification ({readiness.pendingCount})</span>
        </button>
        <button
          type="button"
          onClick={() => setStatusFilter('MISSING')}
          className={`px-3 py-1.5 rounded-lg font-semibold transition cursor-pointer flex items-center gap-1 ${
            statusFilter === 'MISSING'
              ? 'bg-rose-600 text-white'
              : 'text-rose-700 hover:bg-rose-50'
          }`}
        >
          <span>⚠️ Missing in Locker ({readiness.missingCount})</span>
        </button>
      </div>

      {/* Requirements Mapping Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs text-slate-600">
          <thead className="bg-slate-50 text-slate-700 font-semibold border-y border-slate-200">
            <tr>
              <th className="py-2.5 px-3">Statutory Document Requirement</th>
              <th className="py-2.5 px-3">Category</th>
              <th className="py-2.5 px-3">Mandatory Clearances</th>
              <th className="py-2.5 px-3">Locker Status</th>
              <th className="py-2.5 px-3">Matched Locker Certificate</th>
              <th className="py-2.5 px-3 text-right">Statutory Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredRequirements.map((item) => {
              const req = item.requirement;
              const matched = item.matchedDocument;
              const ver = item.currentVersion;

              return (
                <tr key={req.id} className="hover:bg-slate-50/70 transition">
                  <td className="py-3 px-3">
                    <span className="font-bold text-slate-900 block leading-snug">
                      {req.name}
                    </span>
                    <span className="text-[10.5px] text-slate-400 mt-0.5 block max-w-sm truncate">
                      {req.description}
                    </span>
                  </td>

                  <td className="py-3 px-3">
                    <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-700 border border-slate-200 shrink-0">
                      {req.category}
                    </span>
                  </td>

                  <td className="py-3 px-3">
                    <div className="flex flex-wrap gap-1 max-w-[170px]">
                      {item.clearancesTriggered.map((code) => (
                        <span
                          key={code}
                          className="px-1.5 py-0.2 rounded font-mono text-[9.5px] font-bold bg-blue-50 text-blue-900 border border-blue-200"
                        >
                          {code}
                        </span>
                      ))}
                    </div>
                  </td>

                  <td className="py-3 px-3">
                    {item.status === 'VERIFIED_AVAILABLE' && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10.5px] font-bold bg-emerald-100 text-emerald-800">
                        <span>✓</span> Verified Ready
                      </span>
                    )}
                    {item.status === 'PENDING_VERIFICATION' && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10.5px] font-bold bg-amber-100 text-amber-900">
                        <span>⏳</span> In Scrutiny
                      </span>
                    )}
                    {item.status === 'EXPIRED' && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10.5px] font-bold bg-rose-100 text-rose-800">
                        <span>⚠️</span> Expired
                      </span>
                    )}
                    {item.status === 'MISSING' && (
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10.5px] font-bold bg-slate-100 text-slate-500 border border-slate-200">
                        <span>✕</span> Missing
                      </span>
                    )}
                  </td>

                  <td className="py-3 px-3">
                    {matched ? (
                      <div className="max-w-[200px]">
                        <span className="font-semibold text-slate-800 truncate block">
                          {matched.documentName}
                        </span>
                        <span className="text-[10px] text-slate-400 font-mono block">
                          {matched.documentNumber} ({ver?.versionNumber || 'v1.0'})
                        </span>
                      </div>
                    ) : (
                      <span className="text-[11px] text-slate-400 italic">
                        Not yet linked or uploaded
                      </span>
                    )}
                  </td>

                  <td className="py-3 px-3 text-right">
                    {item.status === 'VERIFIED_AVAILABLE' && matched ? (
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => onViewDocDetails(matched)}
                          className="px-2 py-1 text-[11px] font-semibold text-slate-700 bg-white hover:bg-slate-100 rounded border border-slate-200 transition cursor-pointer"
                        >
                          View
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            onOpenReuseModal({
                              requirementName: req.name,
                              clearanceCode: item.clearancesTriggered[0] || 'MPCB-CTE',
                              clearanceName: `Clearance ${item.clearancesTriggered[0] || ''}`,
                              category: req.category,
                            })
                          }
                          className="px-2.5 py-1 text-[11px] font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded shadow-2xs transition cursor-pointer"
                        >
                          🔗 Reuse
                        </button>
                      </div>
                    ) : item.status === 'MISSING' ? (
                      <button
                        type="button"
                        onClick={() => onOpenUploadForRequirement(req)}
                        className="px-2.5 py-1 text-[11px] font-bold text-blue-700 hover:text-blue-900 bg-blue-50 hover:bg-blue-100 rounded border border-blue-200 transition cursor-pointer"
                      >
                        + Upload
                      </button>
                    ) : matched ? (
                      <button
                        type="button"
                        onClick={() => onViewDocDetails(matched)}
                        className="px-2 py-1 text-[11px] font-semibold text-slate-700 bg-white hover:bg-slate-100 rounded border border-slate-200 transition cursor-pointer"
                      >
                        Check Status
                      </button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
