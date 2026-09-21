import React, { useState } from 'react';
import { ApplicantLayout } from '../../components/layout/ApplicantLayout';
import { applicantService } from '../../services/applicantService';
import { Enterprise, EnterpriseProject } from '../../types/applicant';

export const EnterprisesPage: React.FC = () => {
  const [enterprises, setEnterprises] = useState<Enterprise[]>(applicantService.getEnterprises());
  const [selectedEnterpriseId, setSelectedEnterpriseId] = useState<string>(enterprises[0]?.id || '');
  const [projects, setProjects] = useState<EnterpriseProject[]>(applicantService.getProjects());
  const [expandedProjectId, setExpandedProjectId] = useState<string | null>(null);

  // New Project Undertaking Modal State
  const [modalOpen, setModalOpen] = useState(false);
  const [newProject, setNewProject] = useState({
    enterpriseId: selectedEnterpriseId || enterprises[0]?.id || '',
    name: '',
    sector: 'Automobile Components & Advanced Engineering',
    district: 'Pune',
    location: '',
    midcArea: '',
    proposedInvestmentCr: 10.0,
    proposedEmployment: 100,
    landAreaAcres: 3.5,
    powerDemandKva: 500,
    waterDemandKld: 20,
    commencementExpected: 'December 2027',
    description: '',
  });
  const [formError, setFormError] = useState<string | null>(null);
  const [creationSuccess, setCreationSuccess] = useState<string | null>(null);

  const activeEnterprise = enterprises.find((e) => e.id === selectedEnterpriseId) || enterprises[0];
  const enterpriseProjects = projects.filter((p) => p.enterpriseId === activeEnterprise?.id);

  const handleCreateProject = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProject.name.trim()) {
      setFormError('Project undertaking name is mandatory.');
      return;
    }
    if (!newProject.location.trim()) {
      setFormError('Project site address or plot location is mandatory.');
      return;
    }
    if (newProject.proposedInvestmentCr <= 0) {
      setFormError('Proposed capital investment must be greater than zero.');
      return;
    }

    const created = applicantService.addProject({
      enterpriseId: newProject.enterpriseId,
      name: newProject.name.trim(),
      sector: newProject.sector,
      district: newProject.district,
      location: newProject.location.trim(),
      midcArea: newProject.midcArea.trim() || undefined,
      proposedInvestmentCr: Number(newProject.proposedInvestmentCr),
      proposedEmployment: Number(newProject.proposedEmployment),
      landAreaAcres: Number(newProject.landAreaAcres),
      powerDemandKva: Number(newProject.powerDemandKva),
      waterDemandKld: Number(newProject.waterDemandKld),
      status: 'Proposed',
      commencementExpected: newProject.commencementExpected,
      description: newProject.description.trim() || 'New industrial manufacturing undertaking.',
    });

    // Refresh state
    setEnterprises(applicantService.getEnterprises());
    setProjects(applicantService.getProjects());
    setCreationSuccess(`Project "${created.name}" registered successfully under ${activeEnterprise.name}.`);
    setFormError(null);
    setModalOpen(false);
    setExpandedProjectId(created.id);

    // Reset form defaults
    setNewProject({
      enterpriseId: activeEnterprise.id,
      name: '',
      sector: 'Automobile Components & Advanced Engineering',
      district: 'Pune',
      location: '',
      midcArea: '',
      proposedInvestmentCr: 10.0,
      proposedEmployment: 100,
      landAreaAcres: 3.5,
      powerDemandKva: 500,
      waterDemandKld: 20,
      commencementExpected: 'December 2027',
      description: '',
    });

    setTimeout(() => setCreationSuccess(null), 5000);
  };

  return (
    <ApplicantLayout
      activeTab="enterprises"
      breadcrumbs={[{ label: 'Enterprises & Industrial Projects' }]}
    >
      <div className="space-y-6">
        {/* Header Ribbon */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold font-serif text-slate-900">
              Enterprise Management &amp; Industrial Projects
            </h1>
            <p className="text-xs text-slate-500 mt-1">
              Registered corporate legal entities and their tethered manufacturing / industrial projects under Single Business ID.
            </p>
          </div>

          <button
            type="button"
            onClick={() => {
              setNewProject((prev) => ({ ...prev, enterpriseId: activeEnterprise.id }));
              setModalOpen(true);
            }}
            className="px-4 py-2.5 rounded-xl bg-blue-900 hover:bg-blue-800 text-white text-xs font-bold shadow transition flex items-center gap-1.5 self-start sm:self-center cursor-pointer"
          >
            <span>+ Register New Industrial Project</span>
          </button>
        </div>

        {/* Success Alert */}
        {creationSuccess && (
          <div className="bg-emerald-50 border border-emerald-300 text-emerald-800 p-4 rounded-xl flex items-center justify-between shadow-2xs">
            <div className="flex items-center gap-2 text-xs font-semibold">
              <span className="text-base">✓</span>
              <span>{creationSuccess}</span>
            </div>
            <button
              type="button"
              onClick={() => setCreationSuccess(null)}
              className="text-emerald-700 hover:text-emerald-900 text-xs font-bold"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* 1. Enterprise Selection Tabs */}
        <div className="flex space-x-2 border-b border-slate-200 overflow-x-auto pb-1">
          {enterprises.map((ent) => {
            const isSelected = ent.id === selectedEnterpriseId;
            return (
              <button
                key={ent.id}
                type="button"
                onClick={() => {
                  setSelectedEnterpriseId(ent.id);
                  setExpandedProjectId(null);
                }}
                className={`px-4 py-3 rounded-t-xl text-xs font-bold transition flex items-center space-x-2 border-t-2 ${
                  isSelected
                    ? 'bg-white text-blue-900 border-blue-900 shadow-2xs'
                    : 'bg-slate-100 text-slate-600 border-transparent hover:bg-slate-200/70'
                }`}
              >
                <span>🏭</span>
                <span className="whitespace-nowrap">{ent.name}</span>
                {ent.isPrimary && (
                  <span className="px-1.5 py-0.2 rounded text-[9px] font-extrabold bg-amber-100 text-amber-800 border border-amber-300">
                    Primary
                  </span>
                )}
                <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-slate-200 text-slate-700">
                  {projects.filter((p) => p.enterpriseId === ent.id).length} Projects
                </span>
              </button>
            );
          })}
        </div>

        {/* 2. Active Enterprise Master Dossier Card */}
        {activeEnterprise && (
          <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 shadow-2xs space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-bold text-slate-900 font-serif">
                    {activeEnterprise.name}
                  </h2>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                    {activeEnterprise.status}
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  Corporate Classification: <strong className="text-slate-700">{activeEnterprise.category} Enterprise</strong> ({activeEnterprise.type}) • Incorporated: {activeEnterprise.incorporationDate}
                </p>
              </div>

              <div className="text-right sm:text-left">
                <span className="text-[11px] text-slate-400 block">Single Window Unified Anchor</span>
                <span className="font-mono text-xs font-bold text-blue-900 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
                  {applicantService.getProfile().singleBusinessId}
                </span>
              </div>
            </div>

            {/* Statutory Identifiers Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                <span className="text-slate-400 block text-[10.5px]">CIN / LLPIN:</span>
                <span className="font-mono font-bold text-slate-900 block truncate">
                  {activeEnterprise.cinOrLlpin}
                </span>
              </div>

              <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                <span className="text-slate-400 block text-[10.5px]">Udyam Registration:</span>
                <span className="font-mono font-bold text-slate-900 block truncate">
                  {activeEnterprise.udyamRegistration}
                </span>
              </div>

              <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                <span className="text-slate-400 block text-[10.5px]">GSTIN:</span>
                <span className="font-mono font-bold text-slate-900 block truncate">
                  {activeEnterprise.gstin}
                </span>
              </div>

              <div className="p-3 bg-slate-50 rounded-xl border border-slate-100">
                <span className="text-slate-400 block text-[10.5px]">PAN:</span>
                <span className="font-mono font-bold text-slate-900 block truncate">
                  {activeEnterprise.pan}
                </span>
              </div>
            </div>

            {/* Financial and Address Dossier */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs pt-1">
              <div className="p-3 rounded-xl border border-slate-100 bg-slate-50/70">
                <span className="text-slate-500 block">Annual Turnover:</span>
                <span className="text-sm font-bold text-slate-900">
                  ₹{activeEnterprise.turnoverCr.toFixed(2)} Cr
                </span>
              </div>

              <div className="p-3 rounded-xl border border-slate-100 bg-slate-50/70">
                <span className="text-slate-500 block">Capital Investment:</span>
                <span className="text-sm font-bold text-slate-900">
                  ₹{activeEnterprise.capitalInvestmentCr.toFixed(2)} Cr
                </span>
              </div>

              <div className="p-3 rounded-xl border border-slate-100 bg-slate-50/70">
                <span className="text-slate-500 block">Registered Corporate Office:</span>
                <span className="font-medium text-slate-800 block truncate">
                  {activeEnterprise.registeredAddress}, {activeEnterprise.district} - {activeEnterprise.pincode}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* 3. Tethered Industrial Projects Section */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-bold font-serif text-slate-900 flex items-center gap-2">
                <span>📍</span> Industrial Projects Tethered to {activeEnterprise?.name}
              </h3>
              <p className="text-xs text-slate-500">
                Individual factory units, manufacturing plants, and site expansions eligible for statutory clearances.
              </p>
            </div>
            <span className="text-xs font-bold text-slate-600 bg-slate-100 px-2.5 py-1 rounded-full">
              {enterpriseProjects.length} Projects
            </span>
          </div>

          {enterpriseProjects.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-slate-500">
              <p className="text-sm font-semibold">No industrial projects registered for this enterprise yet.</p>
              <button
                type="button"
                onClick={() => setModalOpen(true)}
                className="mt-3 px-4 py-2 bg-blue-900 text-white rounded-xl text-xs font-bold"
              >
                Register First Project
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4">
              {enterpriseProjects.map((proj) => {
                const isExpanded = expandedProjectId === proj.id;
                return (
                  <div
                    key={proj.id}
                    className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden transition"
                  >
                    {/* Summary Card Row */}
                    <div className="p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h4 className="text-base font-bold text-slate-900 font-serif">
                            {proj.name}
                          </h4>
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              proj.status === 'Operational'
                                ? 'bg-emerald-100 text-emerald-800'
                                : proj.status === 'In Setup'
                                ? 'bg-blue-100 text-blue-800'
                                : 'bg-purple-100 text-purple-800'
                            }`}
                          >
                            {proj.status}
                          </span>
                          <span className="text-xs text-slate-400">•</span>
                          <span className="text-xs text-slate-500 font-medium">
                            {proj.sector}
                          </span>
                        </div>
                        <p className="text-xs text-slate-600">
                          📍 <span className="font-semibold">{proj.location}</span> ({proj.district})
                        </p>
                      </div>

                      <div className="flex items-center gap-4 text-xs">
                        <div className="text-right">
                          <span className="text-slate-400 block text-[10.5px]">Proposed Investment:</span>
                          <span className="font-bold text-slate-900 text-sm">
                            ₹{proj.proposedInvestmentCr.toFixed(1)} Cr
                          </span>
                        </div>
                        <div className="text-right">
                          <span className="text-slate-400 block text-[10.5px]">Employment:</span>
                          <span className="font-bold text-slate-900 text-sm">
                            {proj.proposedEmployment} Persons
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => setExpandedProjectId(isExpanded ? null : proj.id)}
                          className="px-3 py-1.5 rounded-lg border border-slate-300 hover:bg-slate-100 text-xs font-semibold text-slate-700 transition"
                        >
                          {isExpanded ? 'Collapse ▲' : 'View Metrics ▼'}
                        </button>
                      </div>
                    </div>

                    {/* Expanded Technical Details Drawer */}
                    {isExpanded && (
                      <div className="bg-slate-50 border-t border-slate-200 p-5 space-y-4 text-xs animate-in fade-in duration-150">
                        {proj.description && (
                          <div className="bg-white p-3.5 rounded-xl border border-slate-200">
                            <span className="font-bold text-slate-800 block mb-1">
                              Project Undertaking Scope &amp; Manufacturing Activities:
                            </span>
                            <p className="text-slate-600 leading-relaxed">{proj.description}</p>
                          </div>
                        )}

                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                          <div className="bg-white p-3 rounded-xl border border-slate-200">
                            <span className="text-slate-500 block text-[11px]">Industrial Land Area:</span>
                            <span className="font-bold text-slate-900 text-sm">
                              {proj.landAreaAcres} Acres
                            </span>
                          </div>

                          <div className="bg-white p-3 rounded-xl border border-slate-200">
                            <span className="text-slate-500 block text-[11px]">Power Load Demand:</span>
                            <span className="font-bold text-slate-900 text-sm">
                              {proj.powerDemandKva ? `${proj.powerDemandKva} kVA` : 'Not Specified'}
                            </span>
                          </div>

                          <div className="bg-white p-3 rounded-xl border border-slate-200">
                            <span className="text-slate-500 block text-[11px]">Industrial Water Demand:</span>
                            <span className="font-bold text-slate-900 text-sm">
                              {proj.waterDemandKld ? `${proj.waterDemandKld} KLD` : 'Not Specified'}
                            </span>
                          </div>

                          <div className="bg-white p-3 rounded-xl border border-slate-200">
                            <span className="text-slate-500 block text-[11px]">Target Commercial Launch:</span>
                            <span className="font-bold text-slate-900 text-sm">
                              {proj.commencementExpected}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center justify-between pt-2">
                          <span className="text-[11px] text-slate-400 font-mono">
                            Project UID: {proj.id}
                          </span>
                          <div className="flex gap-2">
                            <span className="px-2 py-1 text-[11px] font-semibold text-blue-900 bg-blue-100 rounded">
                              ✓ Tethered to {activeEnterprise.name}
                            </span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* 4. Register New Project Modal */}
        {modalOpen && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs overflow-y-auto"
            role="dialog"
            aria-modal="true"
          >
            <div className="bg-white rounded-2xl max-w-2xl w-full p-6 shadow-2xl border border-slate-200 space-y-4 my-8 max-h-[90vh] overflow-y-auto">
              <div className="flex items-start justify-between border-b border-slate-100 pb-3">
                <div>
                  <h3 className="text-lg font-bold text-slate-900 font-serif">
                    Register New Industrial Project Undertaking
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Tether a new industrial plant, greenfield facility, or expansion unit to an enterprise.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="text-slate-400 hover:text-slate-700 p-1"
                >
                  ✕
                </button>
              </div>

              {formError && (
                <div className="p-3 rounded-xl bg-rose-50 text-rose-800 border border-rose-300 text-xs font-semibold">
                  ⚠️ {formError}
                </div>
              )}

              <form onSubmit={handleCreateProject} className="space-y-4 text-xs">
                {/* Enterprise Parent Selection */}
                <div>
                  <label className="block text-slate-700 font-bold mb-1">
                    Parent Legal Enterprise *
                  </label>
                  <select
                    value={newProject.enterpriseId}
                    onChange={(e) => setNewProject({ ...newProject, enterpriseId: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white font-medium"
                    required
                  >
                    {enterprises.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name} ({e.cinOrLlpin})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Project Name */}
                <div>
                  <label className="block text-slate-700 font-bold mb-1">
                    Project Undertaking Name *
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Supa Heavy Forging Plant or Talegaon EV Assembly"
                    value={newProject.name}
                    onChange={(e) => setNewProject({ ...newProject, name: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-900"
                    required
                  />
                </div>

                {/* Sector & District Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-slate-700 font-bold mb-1">
                      Industrial Sector *
                    </label>
                    <select
                      value={newProject.sector}
                      onChange={(e) => setNewProject({ ...newProject, sector: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                    >
                      <option value="Automobile Components & Advanced Engineering">Automobile Components &amp; Advanced Engineering</option>
                      <option value="Heavy Metallurgical & Die Casting">Heavy Metallurgical &amp; Die Casting</option>
                      <option value="Precision Tooling, Dies & Moulds">Precision Tooling, Dies &amp; Moulds</option>
                      <option value="Bio-Fuels, Pelletization & Renewable Energy">Bio-Fuels, Pelletization &amp; Renewable Energy</option>
                      <option value="Food & Agro Processing">Food &amp; Agro Processing</option>
                      <option value="Chemicals & Petrochemicals">Chemicals &amp; Petrochemicals</option>
                      <option value="Electronics System Design & Manufacturing (ESDM)">Electronics System Design &amp; Manufacturing (ESDM)</option>
                      <option value="Textiles & Technical Apparels">Textiles &amp; Technical Apparels</option>
                      <option value="Pharmaceuticals & Medical Devices">Pharmaceuticals &amp; Medical Devices</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-slate-700 font-bold mb-1">
                      District *
                    </label>
                    <select
                      value={newProject.district}
                      onChange={(e) => setNewProject({ ...newProject, district: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white"
                    >
                      <option value="Pune">Pune</option>
                      <option value="Ahmednagar">Ahmednagar</option>
                      <option value="Chhatrapati Sambhajinagar">Chhatrapati Sambhajinagar</option>
                      <option value="Thane">Thane</option>
                      <option value="Raigad">Raigad</option>
                      <option value="Nashik">Nashik</option>
                      <option value="Nagpur">Nagpur</option>
                      <option value="Solapur">Solapur</option>
                      <option value="Kolhapur">Kolhapur</option>
                      <option value="Satara">Satara</option>
                    </select>
                  </div>
                </div>

                {/* Site Location & MIDC Area */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-slate-700 font-bold mb-1">
                      Site Address / Plot Details *
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Plot No. 42, Sector 5"
                      value={newProject.location}
                      onChange={(e) => setNewProject({ ...newProject, location: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-900"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-slate-700 font-bold mb-1">
                      MIDC Industrial Area / Zone (if applicable)
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Chakan MIDC Phase II / Supa MIDC"
                      value={newProject.midcArea}
                      onChange={(e) => setNewProject({ ...newProject, midcArea: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-900"
                    />
                  </div>
                </div>

                {/* Financial and Scale Metrics */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div>
                    <label className="block text-slate-700 font-bold mb-1">
                      Investment (₹ Cr) *
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      min="0.1"
                      value={newProject.proposedInvestmentCr}
                      onChange={(e) => setNewProject({ ...newProject, proposedInvestmentCr: parseFloat(e.target.value) || 0 })}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg font-bold text-slate-900"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-slate-700 font-bold mb-1">
                      Employment (Nos.) *
                    </label>
                    <input
                      type="number"
                      min="1"
                      value={newProject.proposedEmployment}
                      onChange={(e) => setNewProject({ ...newProject, proposedEmployment: parseInt(e.target.value, 10) || 0 })}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg font-bold text-slate-900"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-slate-700 font-bold mb-1">
                      Land Area (Acres) *
                    </label>
                    <input
                      type="number"
                      step="0.1"
                      min="0.1"
                      value={newProject.landAreaAcres}
                      onChange={(e) => setNewProject({ ...newProject, landAreaAcres: parseFloat(e.target.value) || 0 })}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg font-bold text-slate-900"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-slate-700 font-bold mb-1">
                      Power Load (kVA)
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={newProject.powerDemandKva}
                      onChange={(e) => setNewProject({ ...newProject, powerDemandKva: parseInt(e.target.value, 10) || 0 })}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg font-bold text-slate-900"
                    />
                  </div>
                </div>

                {/* Water demand & Commencement date */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-slate-700 font-bold mb-1">
                      Industrial Water Requirement (KLD)
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={newProject.waterDemandKld}
                      onChange={(e) => setNewProject({ ...newProject, waterDemandKld: parseInt(e.target.value, 10) || 0 })}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg font-bold text-slate-900"
                    />
                  </div>

                  <div>
                    <label className="block text-slate-700 font-bold mb-1">
                      Expected Commercial Commissioning
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. March 2027"
                      value={newProject.commencementExpected}
                      onChange={(e) => setNewProject({ ...newProject, commencementExpected: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg"
                    />
                  </div>
                </div>

                {/* Description */}
                <div>
                  <label className="block text-slate-700 font-bold mb-1">
                    Project Scope &amp; Manufacturing Activities Summary
                  </label>
                  <textarea
                    rows={3}
                    placeholder="Briefly state products manufactured, machinery deployed, and technological profile..."
                    value={newProject.description}
                    onChange={(e) => setNewProject({ ...newProject, description: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-900"
                  />
                </div>

                {/* Modal Actions */}
                <div className="flex justify-end gap-3 pt-3 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setModalOpen(false)}
                    className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-xl font-semibold"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-5 py-2 bg-blue-900 text-white rounded-xl font-bold hover:bg-blue-800 shadow cursor-pointer"
                  >
                    Register Project Undertaking
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </ApplicantLayout>
  );
};
