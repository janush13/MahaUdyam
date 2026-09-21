import React, { useState, useEffect } from 'react';
import { useRouter } from '../../router/Router';
import { ApplicantLayout } from '../../components/layout/ApplicantLayout';
import { ApplicationStepHeader } from '../../components/applicant/ApplicationStepHeader';
import { applicationService } from '../../services/applicationService';
import { applicantService } from '../../services/applicantService';
import { ApprovalApplication, CTEProjectParameters } from '../../types/application';

export const CteStep1ParametersPage: React.FC = () => {
  const { navigate } = useRouter();
  const [application, setApplication] = useState<ApprovalApplication>(() =>
    applicationService.getOrCreateDraftApplication()
  );
  const [params, setParams] = useState<CTEProjectParameters>(application.projectParameters);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});

  const projects = applicantService.getProjects();

  useEffect(() => {
    // Ensure draft exists and matches state
    const app = applicationService.getOrCreateDraftApplication();
    setApplication(app);
    setParams(app.projectParameters);
  }, []);

  const handleProjectChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newProjectId = e.target.value;
    const updatedApp = applicationService.changeProject(newProjectId);
    setApplication(updatedApp);
    setParams(updatedApp.projectParameters);
    showSaveToast('Project changed. Parameters refreshed from Project Dossier.');
  };

  const handleInputChange = (field: keyof CTEProjectParameters, value: any) => {
    const updated = { ...params, [field]: value };
    setParams(updated);
  };

  const showSaveToast = (msg: string) => {
    setSaveMessage(msg);
    setTimeout(() => setSaveMessage(null), 3500);
  };

  const handleSaveDraft = () => {
    setIsSaving(true);
    applicationService.updateParameters(params);
    const updated = applicationService.getOrCreateDraftApplication();
    setApplication(updated);
    setIsSaving(false);
    showSaveToast('Draft saved successfully at ' + new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }));
  };

  const validate = (): boolean => {
    const errors: Record<string, string> = {};
    if (!params.manufacturingActivity.trim()) {
      errors.manufacturingActivity = 'Manufacturing activity description is mandatory for CTE scrutiny.';
    }
    if (params.proposedCapitalInvestmentCr <= 0) {
      errors.proposedCapitalInvestmentCr = 'Proposed capital investment must be greater than zero.';
    }
    if (params.waterRequirementKld <= 0) {
      errors.waterRequirementKld = 'Water requirement must be greater than zero.';
    }
    if (params.tradeEffluentKld < 0) {
      errors.tradeEffluentKld = 'Trade effluent cannot be negative.';
    }
    if (!params.hazardousWasteCategory.trim()) {
      errors.hazardousWasteCategory = 'Please specify hazardous waste classification or declare "None".';
    }

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleContinue = () => {
    if (!validate()) {
      window.scrollTo({ top: 300, behavior: 'smooth' });
      return;
    }

    applicationService.updateParameters(params);
    applicationService.setCurrentStep(2);
    navigate('/applicant/applications/cte/documents');
  };

  return (
    <ApplicantLayout
      activeTab="discovery"
      breadcrumbs={[
        { label: 'Applications', href: '/applicant/dashboard' },
        { label: 'Consent to Establish (CTE)' },
        { label: 'Step 1: Parameters' },
      ]}
    >
      <div className="space-y-6 max-w-6xl mx-auto" data-purpose="screen-21-cte-step-1">
        {/* Top Stepper Header */}
        <ApplicationStepHeader
          application={application}
          currentStep={1}
          onSaveDraft={handleSaveDraft}
          isSaving={isSaving}
          saveMessage={saveMessage}
        />

        {/* 1. Entity & Industrial Siting Dossier Card */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
          <div className="p-5 border-b border-slate-200 bg-slate-50/70 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-blue-100 text-blue-900 border border-blue-200">
                  Pre-Populated Profile
                </span>
                <span className="text-xs text-slate-500">•</span>
                <span className="text-xs text-slate-600 font-medium">
                  Verified Enterprise &amp; Project Dossier
                </span>
              </div>
              <h2 className="text-base font-bold text-slate-900 font-serif">
                Enterprise &amp; Siting Details (Phase 3 Dossier Auto-Fill)
              </h2>
            </div>

            {/* Change Project Selector */}
            <div className="flex items-center gap-2">
              <label htmlFor="project-select" className="text-xs text-slate-500 font-medium whitespace-nowrap">
                Switch Project:
              </label>
              <select
                id="project-select"
                value={application.projectId}
                onChange={handleProjectChange}
                className="text-xs font-semibold bg-white border border-slate-300 rounded-xl px-3 py-1.5 text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-blue-900 cursor-pointer"
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.district})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="p-5 sm:p-6 grid grid-cols-1 md:grid-cols-3 gap-5 text-xs">
            <div className="space-y-1">
              <span className="text-slate-400 font-semibold block uppercase text-[10px]">
                Applicant Legal Entity
              </span>
              <p className="font-bold text-slate-900 text-sm">
                {application.enterpriseName}
              </p>
              <p className="text-slate-500">
                Authorized Signatory: <strong className="text-slate-700">{application.applicantName}</strong> ({application.applicantDesignation})
              </p>
            </div>

            <div className="space-y-1">
              <span className="text-slate-400 font-semibold block uppercase text-[10px]">
                Proposed Siting Location
              </span>
              <p className="font-bold text-slate-800">
                {params.plotOrSurveyNumber}, {params.midcArea}
              </p>
              <p className="text-slate-500">
                District: <strong className="text-slate-700">{params.district}</strong> • Taluka: <strong className="text-slate-700">{params.taluka}</strong>
              </p>
            </div>

            <div className="space-y-1">
              <span className="text-slate-400 font-semibold block uppercase text-[10px]">
                Statutory Siting Baseline
              </span>
              <p className="text-slate-700">
                Land Parcel: <strong className="text-blue-950 font-bold">{params.landAreaAcres} Acres</strong>
              </p>
              <p className="text-slate-700">
                Industrial Built-Up Area: <strong className="text-blue-950 font-bold">{params.totalBuiltUpAreaSqMeters.toLocaleString('en-IN')} sq.m</strong>
              </p>
              <p className="text-slate-500 text-[11px]">
                Contract Demand: <strong className="text-slate-700">{params.powerRequirementKva} kVA</strong>
              </p>
            </div>
          </div>
        </div>

        {/* 2. CPCB Classification & Environmental Categorization */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
          <div className="p-5 border-b border-slate-200 bg-slate-50/70 flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="px-2 py-0.5 rounded text-[10.5px] font-bold border bg-amber-50 text-amber-900 border-amber-300">
                  {params.cpcbCategory} Category Industrial Unit
                </span>
                <span className="px-2 py-0.5 rounded text-[10.5px] font-mono bg-blue-50 text-blue-900 border border-blue-200">
                  Phase 4 Derived
                </span>
              </div>
              <h2 className="text-base font-bold text-slate-900 font-serif">
                CPCB Statutory Pollution Categorization &amp; Manufacturing Scope
              </h2>
            </div>

            <span className="text-[11px] text-slate-400 hidden sm:inline">
              Rule: Water Act Sec 25 &amp; CPCB Re-categorization Order 2016
            </span>
          </div>

          <div className="p-5 sm:p-6 space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {/* Sector & CPCB Code */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  CPCB Industry Sector Classification
                </label>
                <input
                  type="text"
                  value={params.cpcbIndustryType}
                  onChange={(e) => handleInputChange('cpcbIndustryType', e.target.value)}
                  className="w-full text-xs bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-slate-900 font-medium focus:outline-hidden focus:ring-2 focus:ring-blue-900"
                />
                <span className="text-[11px] text-slate-500 mt-1 block">
                  Determines pollution score index under MPCB Schedule II.
                </span>
              </div>

              {/* Capital Investment (₹ Cr) & Scrutiny Fee */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Proposed Capital Investment (Gross Fixed Assets in ₹ Cr) *
                </label>
                <div className="flex items-center gap-3">
                  <div className="relative flex-1">
                    <span className="absolute left-3 top-2.5 text-xs text-slate-500 font-bold">₹</span>
                    <input
                      type="number"
                      step="0.1"
                      value={params.proposedCapitalInvestmentCr}
                      onChange={(e) => handleInputChange('proposedCapitalInvestmentCr', parseFloat(e.target.value) || 0)}
                      className={`w-full text-xs bg-white border rounded-xl pl-7 pr-3 py-2 text-slate-900 font-bold ${
                        validationErrors.proposedCapitalInvestmentCr
                          ? 'border-rose-400 focus:ring-rose-500'
                          : 'border-slate-300 focus:ring-blue-900'
                      }`}
                    />
                  </div>
                  <div className="bg-blue-50 border border-blue-200 px-3 py-1.5 rounded-xl shrink-0 text-right">
                    <span className="text-[10px] text-blue-700 block uppercase font-bold">
                      Est. MPCB Scrutiny Fee
                    </span>
                    <span className="text-xs font-bold font-mono text-blue-950">
                      ₹{params.proposedCapitalInvestmentCr > 25 ? '25,000' : '10,000'}
                    </span>
                  </div>
                </div>
                {validationErrors.proposedCapitalInvestmentCr && (
                  <p className="text-xs text-rose-600 mt-1 font-semibold">{validationErrors.proposedCapitalInvestmentCr}</p>
                )}
              </div>
            </div>

            {/* Manufacturing Activity Description */}
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Detailed Manufacturing Process &amp; Product Portfolio *
              </label>
              <textarea
                rows={3}
                value={params.manufacturingActivity}
                onChange={(e) => handleInputChange('manufacturingActivity', e.target.value)}
                placeholder="Describe raw materials, intermediate conversions, final products and manufacturing unit operations..."
                className={`w-full text-xs bg-white border rounded-xl p-3 text-slate-900 ${
                  validationErrors.manufacturingActivity
                    ? 'border-rose-400 focus:ring-rose-500'
                    : 'border-slate-300 focus:ring-blue-900'
                }`}
              />
              {validationErrors.manufacturingActivity && (
                <p className="text-xs text-rose-600 mt-1 font-semibold">{validationErrors.manufacturingActivity}</p>
              )}
            </div>
          </div>
        </div>

        {/* 3. Water Balance, Trade Effluent & ETP */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
          <div className="p-5 border-b border-slate-200 bg-slate-50/70">
            <h2 className="text-base font-bold text-slate-900 font-serif">
              Water Requirement &amp; Effluent Disposal Scheme (Water Act 1974)
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Specify daily water consumption balance and trade effluent treatment mechanism.
            </p>
          </div>

          <div className="p-5 sm:p-6 space-y-4 text-xs">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  Total Water Demand (KLD) *
                </label>
                <input
                  type="number"
                  step="0.5"
                  value={params.waterRequirementKld}
                  onChange={(e) => handleInputChange('waterRequirementKld', parseFloat(e.target.value) || 0)}
                  className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-slate-900 font-semibold"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  Industrial Trade Effluent (KLD) *
                </label>
                <input
                  type="number"
                  step="0.5"
                  value={params.tradeEffluentKld}
                  onChange={(e) => handleInputChange('tradeEffluentKld', parseFloat(e.target.value) || 0)}
                  className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-slate-900 font-semibold"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  Domestic Sewage Effluent (KLD)
                </label>
                <input
                  type="number"
                  step="0.5"
                  value={params.domesticEffluentKld}
                  onChange={(e) => handleInputChange('domesticEffluentKld', parseFloat(e.target.value) || 0)}
                  className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-slate-900 font-semibold"
                />
              </div>
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">
                Proposed Effluent Treatment &amp; Disposal Scheme
              </label>
              <select
                value={params.effluentTreatmentPlan}
                onChange={(e) => handleInputChange('effluentTreatmentPlan', e.target.value as any)}
                className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-slate-900 font-semibold cursor-pointer"
              >
                <option value="CETP Connected">Connected to MIDC Common Effluent Treatment Plant (CETP)</option>
                <option value="Standalone ETP">Standalone Primary, Secondary &amp; Tertiary ETP on site</option>
                <option value="Zero Liquid Discharge (ZLD)">Zero Liquid Discharge (ZLD) with RO &amp; Multi-Effect Evaporator (MEE)</option>
                <option value="Soak Pit / Septic Tank">Septic Tank followed by Sub-surface Soak Pit (Domestic only)</option>
              </select>
              <span className="text-[11px] text-slate-500 mt-1 block">
                Units generating trade effluent must connect to CETP or establish primary neutralizing treatment.
              </span>
            </div>
          </div>
        </div>

        {/* 4. Air Emissions & Atmospheric Stacks (Air Act 1981) */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
          <div className="p-5 border-b border-slate-200 bg-slate-50/70">
            <h2 className="text-base font-bold text-slate-900 font-serif">
              Atmospheric Emissions &amp; Stack Specifications (Air Act 1981)
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Declaration of industrial chimneys, boiler stacks, and emergency standby power generation.
            </p>
          </div>

          <div className="p-5 sm:p-6 grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
            <div>
              <label className="block font-bold text-slate-700 mb-1">
                Diesel Generator (DG) Capacity (kVA)
              </label>
              <input
                type="number"
                value={params.dgSetCapacityKva}
                onChange={(e) => handleInputChange('dgSetCapacityKva', parseInt(e.target.value) || 0)}
                className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-slate-900 font-semibold"
              />
              <span className="text-[10.5px] text-slate-400 mt-0.5 block">
                Acoustic enclosure mandated by CPCB norms.
              </span>
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">
                Primary Industrial Fuel Type
              </label>
              <input
                type="text"
                value={params.fuelType}
                onChange={(e) => handleInputChange('fuelType', e.target.value)}
                className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-slate-900 font-semibold"
              />
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">
                Commissioning Target Date
              </label>
              <input
                type="text"
                value={params.expectedCommissioningDate}
                onChange={(e) => handleInputChange('expectedCommissioningDate', e.target.value)}
                className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-slate-900 font-semibold"
              />
            </div>
          </div>
        </div>

        {/* 5. Hazardous Waste & Solid Waste Residuals */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
          <div className="p-5 border-b border-slate-200 bg-slate-50/70">
            <h2 className="text-base font-bold text-slate-900 font-serif">
              Hazardous Waste Management (HWM Rules 2016)
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Registration under Hazardous and Other Wastes (Management &amp; Transboundary Movement) Rules.
            </p>
          </div>

          <div className="p-5 sm:p-6 grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
            <div className="sm:col-span-2">
              <label className="block font-bold text-slate-700 mb-1">
                Hazardous Waste Schedule &amp; Category *
              </label>
              <input
                type="text"
                value={params.hazardousWasteCategory}
                onChange={(e) => handleInputChange('hazardousWasteCategory', e.target.value)}
                className={`w-full bg-white border rounded-xl px-3 py-2 text-slate-900 font-semibold ${
                  validationErrors.hazardousWasteCategory ? 'border-rose-400' : 'border-slate-300'
                }`}
              />
              {validationErrors.hazardousWasteCategory && (
                <p className="text-xs text-rose-600 mt-1 font-semibold">{validationErrors.hazardousWasteCategory}</p>
              )}
            </div>

            <div>
              <label className="block font-bold text-slate-700 mb-1">
                CHWTSDF Membership Facility
              </label>
              <select
                value={params.chwtsdfMembership}
                onChange={(e) => handleInputChange('chwtsdfMembership', e.target.value as any)}
                className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-slate-900 font-semibold cursor-pointer"
              >
                <option value="MEPL Ranjangaon">MEPL (Ranjangaon Industrial Estate)</option>
                <option value="TCG Transi">TCG Waste Management Facility, Taloja</option>
                <option value="Standalone Treatment">In-House Authorized Incinerator</option>
                <option value="Not Applicable">Not Applicable (Zero Hazardous Generation)</option>
              </select>
            </div>
          </div>
        </div>

        {/* Bottom Navigation Toolbar */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-2xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <button
            type="button"
            onClick={() => navigate('/applicant/approvals/results')}
            className="px-4 py-2.5 rounded-xl border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-semibold transition cursor-pointer self-start sm:self-auto"
          >
            ← Back to Clearance Matrix
          </button>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleSaveDraft}
              disabled={isSaving}
              className="px-4 py-2.5 rounded-xl border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-bold transition cursor-pointer"
            >
              {isSaving ? 'Saving...' : '💾 Save Draft'}
            </button>

            <button
              type="button"
              onClick={handleContinue}
              className="px-6 py-2.5 rounded-xl bg-blue-900 hover:bg-blue-800 text-white text-xs font-bold shadow-xs transition flex items-center gap-2 cursor-pointer"
            >
              <span>Continue to Step 2: Document Validation</span>
              <span>→</span>
            </button>
          </div>
        </div>
      </div>
    </ApplicantLayout>
  );
};
