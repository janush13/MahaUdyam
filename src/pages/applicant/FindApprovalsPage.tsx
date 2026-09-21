import React, { useState, useEffect } from 'react';
import { ApplicantLayout } from '../../components/layout/ApplicantLayout';
import { useRouter } from '../../router/Router';
import { applicantService } from '../../services/applicantService';
import { approvalRuleEngine } from '../../services/approvalRuleEngine';
import { Enterprise, EnterpriseProject } from '../../types/applicant';

export const FindApprovalsPage: React.FC = () => {
  const { navigate } = useRouter();
  const enterprises = applicantService.getEnterprises();

  const [selectedEnterpriseId, setSelectedEnterpriseId] = useState<string>(() => {
    const primary = enterprises.find((e) => e.isPrimary);
    return primary ? primary.id : enterprises[0]?.id || '';
  });

  const availableProjects = applicantService.getProjectsByEnterprise(selectedEnterpriseId);

  const [selectedProjectId, setSelectedProjectId] = useState<string>(() => {
    return availableProjects[0]?.id || '';
  });

  // When enterprise changes, ensure a valid project is selected
  useEffect(() => {
    const projects = applicantService.getProjectsByEnterprise(selectedEnterpriseId);
    if (projects.length > 0 && !projects.some((p) => p.id === selectedProjectId)) {
      setSelectedProjectId(projects[0].id);
    }
  }, [selectedEnterpriseId, selectedProjectId]);

  const selectedEnterprise = enterprises.find((e) => e.id === selectedEnterpriseId);
  const selectedProject = availableProjects.find((p) => p.id === selectedProjectId);

  const handleStartDiscovery = () => {
    if (!selectedEnterprise || !selectedProject) return;

    // Initialize context pre-fill via rule engine
    const initialContext = approvalRuleEngine.createInitialContext(selectedEnterprise, selectedProject);
    // Store in session storage / discovery summary cache if needed or pass via query
    navigate(`/applicant/approvals/questionnaire?projectId=${selectedProject.id}&enterpriseId=${selectedEnterprise.id}`);
  };

  return (
    <ApplicantLayout
      activeTab="discovery"
      breadcrumbs={[{ label: 'Find Approvals', href: '/applicant/approvals/find' }]}
    >
      <div className="space-y-6" data-purpose="screen-17-find-approvals">
        {/* Header Ribbon */}
        <div className="bg-white p-5 sm:p-6 rounded-2xl border border-slate-200 shadow-2xs">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="px-2 py-0.5 rounded text-[10.5px] font-mono font-bold bg-blue-100 text-blue-900 border border-blue-200 uppercase">
                  Step 1: Project Classification &amp; Activity Profile
                </span>
                <span className="text-xs text-slate-400">•</span>
                <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                  Smart Clearance Engine
                </span>
              </div>
              <h1 className="text-xl sm:text-2xl font-bold font-serif text-[#0f2b48]">
                Find Approvals Applicable to My Project
              </h1>
              <p className="text-xs text-slate-600 mt-1 max-w-3xl leading-relaxed">
                Identify all mandatory statutory clearances, provisional NOCs, and departmental registrations for your industrial undertaking in Maharashtra under the Single Window Act 2016.
              </p>
            </div>

            <button
              type="button"
              onClick={() => navigate('/applicant/enterprises')}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-blue-900 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-xl transition self-start lg:self-center cursor-pointer"
            >
              <span>+ Register New Undertaking</span>
            </button>
          </div>
        </div>

        {/* Statutory Legal Notice Card */}
        <div className="bg-gradient-to-r from-blue-50/80 to-slate-50 border border-blue-200 p-4 rounded-xl flex items-start gap-3 text-xs text-blue-900 shadow-2xs">
          <span className="text-xl">⚖️</span>
          <div>
            <span className="font-bold block text-blue-950">
              Statutory Single Window Governance Mandate:
            </span>
            <p className="text-blue-900/90 mt-0.5 leading-relaxed">
              Under the Maharashtra Single Window Clearances Act, projects undergo algorithmic parameter evaluation across MPCB, MIDC, DISH, Energy, Fire, and Water departments. Approvals determined herein establish the authoritative filing sequence.
              <span className="font-semibold text-blue-950 ml-1">
                (Prototype rule — statutory validation required by competent authorities).
              </span>
            </p>
          </div>
        </div>

        {/* Step 1: Enterprise Selection */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 shadow-2xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
            <div>
              <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-blue-900 text-white text-[11px] flex items-center justify-center font-bold">1</span>
                <span>Select Legal Enterprise Entity</span>
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                The corporate entity holding legal responsibility for capital investments and land leases.
              </p>
            </div>
            <span className="text-xs font-semibold text-slate-500">
              {enterprises.length} Registered Enterprise{enterprises.length > 1 ? 's' : ''}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {enterprises.map((ent) => {
              const isSelected = ent.id === selectedEnterpriseId;
              return (
                <div
                  key={ent.id}
                  onClick={() => setSelectedEnterpriseId(ent.id)}
                  className={`p-4 rounded-xl border transition cursor-pointer flex flex-col justify-between ${
                    isSelected
                      ? 'border-blue-900 bg-blue-50/40 shadow-xs ring-1 ring-blue-900/20'
                      : 'border-slate-200 hover:border-slate-300 bg-white'
                  }`}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      setSelectedEnterpriseId(ent.id);
                    }
                  }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-bold text-slate-900 font-serif">
                          {ent.name}
                        </span>
                        {ent.isPrimary && (
                          <span className="px-1.5 py-0.2 rounded text-[9.5px] font-bold bg-amber-100 text-amber-900 border border-amber-300">
                            Primary
                          </span>
                        )}
                        <span className="px-1.5 py-0.2 rounded text-[9.5px] font-bold bg-slate-100 text-slate-700">
                          {ent.category}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 font-mono">
                        {ent.cinOrLlpin} • PAN: {ent.pan}
                      </p>
                    </div>

                    <div
                      className={`w-5 h-5 rounded-full border flex items-center justify-center text-xs shrink-0 ${
                        isSelected
                          ? 'border-blue-900 bg-blue-900 text-white'
                          : 'border-slate-300 bg-white'
                      }`}
                    >
                      {isSelected ? '✓' : ''}
                    </div>
                  </div>

                  <div className="mt-3 pt-2.5 border-t border-slate-100 text-[11px] text-slate-600 flex items-center justify-between">
                    <span>Udyam: <span className="font-mono font-semibold text-slate-800">{ent.udyamRegistration}</span></span>
                    <span className="font-semibold text-blue-900">{ent.projectsCount || 1} Undertakings</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Step 2: Project / Undertaking Selection */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 shadow-2xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
            <div>
              <h2 className="text-sm font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-blue-900 text-white text-[11px] flex items-center justify-center font-bold">2</span>
                <span>Select Target Industrial Project / Unit</span>
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Approvals will be analyzed specifically for the physical and environmental parameters of this site.
              </p>
            </div>
            <span className="text-xs text-slate-500">
              Showing projects under {selectedEnterprise?.name}
            </span>
          </div>

          {availableProjects.length === 0 ? (
            <div className="p-8 text-center bg-slate-50 rounded-xl border border-dashed border-slate-300 space-y-3">
              <span className="text-3xl">🏭</span>
              <h3 className="text-sm font-bold text-slate-800">No Industrial Projects Registered Yet</h3>
              <p className="text-xs text-slate-500 max-w-md mx-auto">
                This enterprise does not have any registered undertakings. Register a project with location and utility details to start clearance discovery.
              </p>
              <button
                type="button"
                onClick={() => navigate('/applicant/enterprises')}
                className="px-4 py-2 bg-blue-900 text-white rounded-xl text-xs font-bold hover:bg-blue-800 transition"
              >
                + Register Project Now
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {availableProjects.map((proj) => {
                const isSelected = proj.id === selectedProjectId;
                return (
                  <div
                    key={proj.id}
                    onClick={() => setSelectedProjectId(proj.id)}
                    className={`p-4 rounded-xl border transition cursor-pointer flex flex-col justify-between ${
                      isSelected
                        ? 'border-blue-900 bg-blue-50/50 shadow-xs ring-2 ring-blue-900/30'
                        : 'border-slate-200 hover:border-slate-300 bg-white'
                    }`}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        setSelectedProjectId(proj.id);
                      }
                    }}
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                            proj.status === 'Operational'
                              ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                              : proj.status === 'In Setup'
                              ? 'bg-blue-50 text-blue-900 border-blue-200'
                              : 'bg-amber-50 text-amber-800 border-amber-300'
                          }`}
                        >
                          {proj.status}
                        </span>

                        <div
                          className={`w-5 h-5 rounded-full border flex items-center justify-center text-xs shrink-0 ${
                            isSelected
                              ? 'border-blue-900 bg-blue-900 text-white'
                              : 'border-slate-300 bg-white'
                          }`}
                        >
                          {isSelected ? '✓' : ''}
                        </div>
                      </div>

                      <h3 className="text-xs font-bold text-slate-900 font-serif leading-tight">
                        {proj.name}
                      </h3>
                      <p className="text-[11px] text-slate-500 font-medium mt-0.5">
                        📍 {proj.location}
                      </p>
                      <p className="text-[11px] text-blue-900 font-semibold mt-1">
                        🏭 {proj.sector}
                      </p>
                    </div>

                    <div className="mt-4 pt-3 border-t border-slate-100 grid grid-cols-2 gap-2 text-[10.5px] text-slate-600 bg-slate-50/70 p-2 rounded-lg">
                      <div>
                        <span className="text-slate-400 block text-[9.5px]">Land Area:</span>
                        <span className="font-semibold text-slate-800">{proj.landAreaAcres} Acres</span>
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[9.5px]">Investment:</span>
                        <span className="font-semibold text-slate-800">₹{proj.proposedInvestmentCr} Cr</span>
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[9.5px]">Power Load:</span>
                        <span className="font-semibold text-slate-800">{proj.powerDemandKva || 0} kVA</span>
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[9.5px]">Water Demand:</span>
                        <span className="font-semibold text-slate-800">{proj.waterDemandKld || 0} KLD</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Selected Project Dossier Preview Card */}
        {selectedProject && selectedEnterprise && (
          <div className="bg-white rounded-2xl border border-blue-200/80 p-5 sm:p-6 shadow-2xs space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
              <div>
                <span className="text-[10.5px] font-bold uppercase tracking-wider text-blue-900 block">
                  Configured Project Profile for Discovery
                </span>
                <h3 className="text-base font-bold font-serif text-slate-900">
                  {selectedProject.name}
                </h3>
                <p className="text-xs text-slate-500">
                  Tethered to: <span className="font-semibold text-slate-700">{selectedEnterprise.name}</span>
                </p>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500">Target Commencement:</span>
                <span className="px-2 py-0.5 rounded text-xs font-bold bg-slate-100 text-slate-800 font-mono">
                  {selectedProject.commencementExpected}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs bg-slate-50 p-4 rounded-xl border border-slate-100">
              <div>
                <span className="text-slate-400 block text-[10.5px]">Industrial Sector:</span>
                <span className="font-bold text-slate-800 block truncate">{selectedProject.sector}</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[10.5px]">Siting &amp; MIDC Zone:</span>
                <span className="font-semibold text-slate-800 block truncate">
                  {selectedProject.midcArea || selectedProject.district}
                </span>
              </div>
              <div>
                <span className="text-slate-400 block text-[10.5px]">Direct Employment:</span>
                <span className="font-bold text-slate-800 block">
                  {selectedProject.proposedEmployment} Workers
                </span>
              </div>
              <div>
                <span className="text-slate-400 block text-[10.5px]">Capital Outlay:</span>
                <span className="font-bold text-blue-900 block font-mono">
                  ₹{selectedProject.proposedInvestmentCr} Crores
                </span>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-2">
              <p className="text-xs text-slate-500">
                Next, answer 5 short parameter sections to pinpoint environmental, fire, utility, and labour clearances.
              </p>

              <button
                type="button"
                onClick={handleStartDiscovery}
                className="w-full sm:w-auto px-6 py-3 rounded-xl bg-[#0f2b48] hover:bg-blue-900 text-white text-xs font-bold shadow-sm transition flex items-center justify-center gap-2 cursor-pointer"
              >
                <span>Proceed to Project Parameters Questionnaire</span>
                <span>→</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </ApplicantLayout>
  );
};
