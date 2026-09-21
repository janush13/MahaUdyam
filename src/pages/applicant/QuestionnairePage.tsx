import React, { useState, useEffect } from 'react';
import { ApplicantLayout } from '../../components/layout/ApplicantLayout';
import { useRouter } from '../../router/Router';
import { applicantService } from '../../services/applicantService';
import { approvalRuleEngine } from '../../services/approvalRuleEngine';
import {
  ProjectParametersContext,
  PollutionCategory,
  LandSitingType,
  VoltageGrade,
  WaterSourceType,
} from '../../types/approvalDiscovery';

export const QuestionnairePage: React.FC = () => {
  const { currentPath, navigate } = useRouter();

  // Extract query parameters
  const queryParams = new URLSearchParams(currentPath.split('?')[1] || '');
  const queryEnterpriseId = queryParams.get('enterpriseId');
  const queryProjectId = queryParams.get('projectId');

  const enterprises = applicantService.getEnterprises();

  // Selected enterprise and project
  const [currentEnterprise, setCurrentEnterprise] = useState(() => {
    if (queryEnterpriseId) {
      const found = applicantService.getEnterpriseById(queryEnterpriseId);
      if (found) return found;
    }
    const primary = enterprises.find((e) => e.isPrimary);
    return primary || enterprises[0];
  });

  const [currentProject, setCurrentProject] = useState(() => {
    if (queryProjectId) {
      const found = applicantService.getProjectById(queryProjectId);
      if (found) return found;
    }
    const projects = applicantService.getProjectsByEnterprise(currentEnterprise?.id || '');
    return projects[0] || applicantService.getProjects()[0];
  });

  // Wizard Step (1 to 6)
  const [currentStep, setCurrentStep] = useState<number>(1);
  const [isEvaluating, setIsEvaluating] = useState<boolean>(false);
  const [evaluatingStepText, setEvaluatingStepText] = useState<string>('Initializing Rule Engine...');
  const [validationError, setValidationError] = useState<string | null>(null);

  // Form State initialized from Rule Engine default context or cached summary
  const [formData, setFormData] = useState<ProjectParametersContext>(() => {
    const cached = approvalRuleEngine.getDiscoverySummary();
    if (cached && cached.projectContext && cached.projectContext.projectId === currentProject?.id) {
      return cached.projectContext;
    }
    if (currentEnterprise && currentProject) {
      return approvalRuleEngine.createInitialContext(currentEnterprise, currentProject);
    }
    // Fallback baseline
    return {
      enterpriseId: 'ent-dipl-01',
      enterpriseName: 'Deshmukh Industries Pvt. Ltd.',
      projectId: 'proj-chk-01',
      projectName: 'Chakan Auto Component Expansion Unit',
      sector: 'Automobile & Auto Components',
      subSectorOrActivity: 'High precision transmission gear forging and CNC automated machining facility',
      industryType: 'Manufacturing',
      projectNature: 'Greenfield / New Unit',
      eouStatus: false,
      proposedCapitalInvestmentCr: 12.5,
      landType: 'MIDC Notified Industrial Area',
      district: 'Pune',
      taluka: 'Khed',
      plotOrSurveyNumber: 'Plot B-14/1, Chakan MIDC Phase II',
      midcZoneName: 'Chakan MIDC Phase II',
      hasCivilConstruction: true,
      totalBuiltUpAreaSqMeters: 7200,
      buildingHeightMeters: 12,
      isHighRise: false,
      proximityToWaterBodyEcoZone: false,
      pollutionCategory: 'Orange',
      hasTradeEffluent: true,
      effluentDischargeKld: 35,
      etpOrCetpHookupProposed: true,
      hasAirEmissions: true,
      stackHeightMeters: 30,
      hasFurnacesOrBoilers: false,
      generatesHazardousWaste: true,
      hazardousWasteTypes: ['Used / Waste Lubricating Oil (5.1)', 'Chemical / Solvent Containers (33.1)', 'ETP Sludge (35.3)'],
      contractDemandKva: 1250,
      voltageLevel: 'HT (High Tension 11kV / 22kV / 33kV)',
      hasSubstationOrTransformer: true,
      dgSetCapacityKva: 250,
      waterDemandKld: 50,
      waterSource: 'MIDC Piped Supply',
      hasSolventOrHazardousStorage: false,
      solventStorageKl: 0,
      hasBoilerOrSteamSystem: false,
      boilerCapacityTph: 0,
      totalWorkforce: 140,
      isPowerDrivenProcess: true,
      hasContractLabour: true,
      contractLabourCount: 45,
      hasInterstateMigrantWorkers: true,
      interstateWorkersCount: 15,
      operatingShifts: 'Two Shifts',
    };
  });

  const steps = [
    { number: 1, title: 'Activity & Sector', subtitle: 'Type & Scope' },
    { number: 2, title: 'Location & Siting', subtitle: 'Land & Building' },
    { number: 3, title: 'Environmental & Pollution', subtitle: 'MPCB Triggers' },
    { number: 4, title: 'Utilities & Safety', subtitle: 'Power, Water & DG' },
    { number: 5, title: 'Labour & Workforce', subtitle: 'DISH & CLRA' },
    { number: 6, title: 'Review & Analysis', subtitle: 'Composite Engine' },
  ];

  // Validation before step transition
  const validateCurrentStep = (): boolean => {
    setValidationError(null);
    if (currentStep === 1) {
      if (!formData.sector.trim()) {
        setValidationError('Please select or specify the primary industrial sector.');
        return false;
      }
      if (formData.proposedCapitalInvestmentCr <= 0) {
        setValidationError('Proposed capital investment must be greater than 0.');
        return false;
      }
    } else if (currentStep === 2) {
      if (!formData.district.trim()) {
        setValidationError('Project district is required.');
        return false;
      }
      if (formData.hasCivilConstruction && formData.totalBuiltUpAreaSqMeters <= 0) {
        setValidationError('Please enter an estimated built-up area for proposed civil construction.');
        return false;
      }
    } else if (currentStep === 3) {
      if (formData.hasTradeEffluent && formData.effluentDischargeKld <= 0) {
        setValidationError('Please specify estimated daily effluent discharge in KLD.');
        return false;
      }
    } else if (currentStep === 4) {
      if (formData.contractDemandKva <= 0) {
        setValidationError('Contract electrical demand must be greater than 0 kVA.');
        return false;
      }
    } else if (currentStep === 5) {
      if (formData.totalWorkforce < 1) {
        setValidationError('Please enter estimated direct workforce count.');
        return false;
      }
    }
    return true;
  };

  const handleNext = () => {
    if (validateCurrentStep()) {
      setCurrentStep((prev) => Math.min(6, prev + 1));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleBack = () => {
    setValidationError(null);
    setCurrentStep((prev) => Math.max(1, prev - 1));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleRunEngine = () => {
    if (!validateCurrentStep()) return;

    setIsEvaluating(true);
    setEvaluatingStepText('Connecting to MahaUdyam Master Clearance Database...');

    setTimeout(() => {
      setEvaluatingStepText('Evaluating MPCB Environmental & Pollution Triggers (Water Act & Air Act)...');
    }, 400);

    setTimeout(() => {
      setEvaluatingStepText('Verifying Factories Act (DISH) & Directorate of Fire Services Rules...');
    }, 800);

    setTimeout(() => {
      setEvaluatingStepText('Determining MSEDCL HT Power, Water Supply & Labour Regulations...');
    }, 1200);

    setTimeout(() => {
      // Evaluate centrally via ApprovalRuleEngine
      const summary = approvalRuleEngine.evaluateProject(formData);
      setIsEvaluating(false);
      navigate('/applicant/approvals/results');
    }, 1600);
  };

  return (
    <ApplicantLayout
      activeTab="discovery"
      breadcrumbs={[
        { label: 'Find Approvals', href: '/applicant/approvals/find' },
        { label: 'Questionnaire' },
      ]}
    >
      <div className="space-y-6" data-purpose="screen-18-questionnaire">
        {/* Project Context Sticky Bar */}
        <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200 shadow-2xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-50 border border-blue-200 text-blue-900 flex items-center justify-center font-bold text-lg shrink-0">
              🏭
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm sm:text-base font-bold text-slate-900 font-serif">
                  {formData.projectName}
                </h2>
                <span className="px-2 py-0.2 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                  Active Dossier
                </span>
              </div>
              <p className="text-xs text-slate-500">
                Entity: <span className="font-semibold text-slate-700">{formData.enterpriseName}</span> • Siting: <span className="font-semibold text-slate-700">{formData.district} ({formData.landType})</span>
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => navigate('/applicant/approvals/find')}
            className="text-xs font-semibold text-blue-900 hover:text-blue-700 underline self-start sm:self-center"
          >
            Change Project
          </button>
        </div>

        {/* Wizard Step Progress Tracker */}
        <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200 shadow-2xs">
          <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
            {steps.map((s) => {
              const isCurrent = currentStep === s.number;
              const isPast = currentStep > s.number;
              return (
                <button
                  key={s.number}
                  type="button"
                  onClick={() => {
                    if (s.number < currentStep || validateCurrentStep()) {
                      setCurrentStep(s.number);
                    }
                  }}
                  className={`text-left p-2.5 rounded-xl border transition flex flex-col justify-between ${
                    isCurrent
                      ? 'border-blue-900 bg-blue-50/60 ring-1 ring-blue-900/20 shadow-xs'
                      : isPast
                      ? 'border-emerald-200 bg-emerald-50/30 text-slate-700'
                      : 'border-slate-100 bg-slate-50/40 text-slate-400'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span
                      className={`w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center ${
                        isCurrent
                          ? 'bg-blue-900 text-white'
                          : isPast
                          ? 'bg-emerald-600 text-white'
                          : 'bg-slate-200 text-slate-600'
                      }`}
                    >
                      {isPast ? '✓' : s.number}
                    </span>
                    <span className="text-[10px] font-mono text-slate-400">Step {s.number}</span>
                  </div>
                  <div>
                    <span
                      className={`text-xs font-bold block truncate ${
                        isCurrent ? 'text-blue-950' : isPast ? 'text-slate-800' : 'text-slate-400'
                      }`}
                    >
                      {s.title}
                    </span>
                    <span className="text-[10px] text-slate-400 block truncate">{s.subtitle}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Validation Warning Notice */}
        {validationError && (
          <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-300 text-rose-800 text-xs font-semibold flex items-center gap-2">
            <span>⚠️</span>
            <span>{validationError}</span>
          </div>
        )}

        {/* Questionnaire Form Container */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-7 shadow-2xs space-y-6">
          {/* STEP 1: ACTIVITY & SECTOR */}
          {currentStep === 1 && (
            <div className="space-y-5 animate-in fade-in duration-200">
              <div className="border-b border-slate-100 pb-3">
                <span className="text-[11px] font-bold text-blue-900 uppercase tracking-wider block">
                  Questionnaire • Step 1 of 6
                </span>
                <h3 className="text-lg font-bold font-serif text-slate-900">
                  Activity Classification &amp; Sectoral Profile
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Sectoral categorization determines applicable industrial policies, industrial zoning norms, and MPCB pollution classification.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                <div>
                  <label className="block text-slate-700 font-bold mb-1">
                    Primary Industrial Sector *
                  </label>
                  <select
                    value={formData.sector}
                    onChange={(e) => setFormData({ ...formData, sector: e.target.value })}
                    className="w-full px-3 py-2.5 border border-slate-300 rounded-xl bg-white font-medium focus:ring-2 focus:ring-blue-900 focus:outline-none"
                  >
                    <option value="Automobile & Auto Components">Automobile &amp; Auto Components</option>
                    <option value="Engineering & Capital Goods">Engineering &amp; Capital Goods</option>
                    <option value="Heavy Metallurgical & Forging">Heavy Metallurgical &amp; Forging</option>
                    <option value="Agro & Food Processing">Agro &amp; Food Processing</option>
                    <option value="Chemical & Petrochemical">Chemical &amp; Petrochemical</option>
                    <option value="Pharmaceuticals & Bulk Drugs">Pharmaceuticals &amp; Bulk Drugs</option>
                    <option value="Textiles & Garmenting">Textiles &amp; Garmenting</option>
                    <option value="Electronics & IT Hardware">Electronics &amp; IT Hardware</option>
                    <option value="Renewable Energy & Equipment">Renewable Energy &amp; Equipment</option>
                    <option value="Precision Tooling, Dies & Moulds">Precision Tooling, Dies &amp; Moulds</option>
                    <option value="Services / Logistics & Warehousing">Services / Logistics &amp; Warehousing</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-700 font-bold mb-1">
                    Nature of Industrial Operations *
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {(['Manufacturing', 'Services', 'Both'] as const).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setFormData({ ...formData, industryType: mode })}
                        className={`py-2 px-3 rounded-xl border text-center font-bold transition ${
                          formData.industryType === mode
                            ? 'border-blue-900 bg-blue-900 text-white shadow-2xs'
                            : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                        }`}
                      >
                        {mode}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-slate-700 font-bold mb-1">
                  Specific Activity &amp; Product Description
                </label>
                <textarea
                  rows={2}
                  value={formData.subSectorOrActivity}
                  onChange={(e) => setFormData({ ...formData, subSectorOrActivity: e.target.value })}
                  placeholder="e.g. High precision transmission gear forging, CNC automated machining, and robotic heat treatment facility"
                  className="w-full px-3 py-2 border border-slate-300 rounded-xl focus:ring-2 focus:ring-blue-900 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                <div>
                  <label className="block text-slate-700 font-bold mb-1">
                    Project Undertaking Type *
                  </label>
                  <select
                    value={formData.projectNature}
                    onChange={(e) => setFormData({ ...formData, projectNature: e.target.value as any })}
                    className="w-full px-3 py-2.5 border border-slate-300 rounded-xl bg-white font-medium"
                  >
                    <option value="Greenfield / New Unit">Greenfield / Completely New Industrial Unit</option>
                    <option value="Substantial Expansion / Modernization">Substantial Expansion / Plant Modernization</option>
                    <option value="Diversification into New Products">Diversification into New Product Lines</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-700 font-bold mb-1">
                    Proposed Capital Investment (Plant &amp; Machinery + Civil in ₹ Crores) *
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-2.5 text-slate-500 font-bold">₹</span>
                    <input
                      type="number"
                      step="0.1"
                      min="0.1"
                      value={formData.proposedCapitalInvestmentCr}
                      onChange={(e) => setFormData({ ...formData, proposedCapitalInvestmentCr: parseFloat(e.target.value) || 0 })}
                      className="w-full pl-8 pr-3 py-2 border border-slate-300 rounded-xl font-bold font-mono focus:ring-2 focus:ring-blue-900 focus:outline-none"
                    />
                  </div>
                  <p className="text-[10.5px] text-slate-400 mt-1">
                    Used to calculate MPCB consent fees and statutory stamp duty exemptions.
                  </p>
                </div>
              </div>

              {/* EOU Checkbox */}
              <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200">
                <label className="flex items-start gap-3 cursor-pointer text-xs">
                  <input
                    type="checkbox"
                    checked={formData.eouStatus}
                    onChange={(e) => setFormData({ ...formData, eouStatus: e.target.checked })}
                    className="mt-0.5 rounded border-slate-300 text-blue-900 focus:ring-blue-900"
                  />
                  <div>
                    <span className="font-bold text-slate-800">
                      100% Export Oriented Unit (EOU) / Special Economic Zone (SEZ) Unit
                    </span>
                    <p className="text-slate-500 text-[11px] mt-0.5">
                      Check if this unit will hold customs bonded status or export &gt;50% of annual output.
                    </p>
                  </div>
                </label>
              </div>
            </div>
          )}

          {/* STEP 2: LOCATION & SITING */}
          {currentStep === 2 && (
            <div className="space-y-5 animate-in fade-in duration-200">
              <div className="border-b border-slate-100 pb-3">
                <span className="text-[11px] font-bold text-blue-900 uppercase tracking-wider block">
                  Questionnaire • Step 2 of 6
                </span>
                <h3 className="text-lg font-bold font-serif text-slate-900">
                  Location, Siting &amp; Civil Infrastructure
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Determines planning permissions (MIDC SPA vs Town Planning), provisional Fire NOCs, and environmental buffer zones.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                <div>
                  <label className="block text-slate-700 font-bold mb-1">
                    Land Jurisdiction / Siting Authority *
                  </label>
                  <select
                    value={formData.landType}
                    onChange={(e) => setFormData({ ...formData, landType: e.target.value as LandSitingType })}
                    className="w-full px-3 py-2.5 border border-slate-300 rounded-xl bg-white font-medium"
                  >
                    <option value="MIDC Notified Industrial Area">MIDC Notified Industrial Area (MIDC SPA)</option>
                    <option value="Private Industrial Land / Outside MIDC">Private Industrial Land / Outside MIDC (Town Planning &amp; Collector)</option>
                    <option value="SEZ / Notified Zone">Special Economic Zone (SEZ / IT Park)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-700 font-bold mb-1">
                    District *
                  </label>
                  <input
                    type="text"
                    value={formData.district}
                    onChange={(e) => setFormData({ ...formData, district: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl font-medium"
                    placeholder="e.g. Pune / Thane / Chhatrapati Sambhajinagar"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                <div>
                  <label className="block text-slate-700 font-bold mb-1">
                    Taluka / Sub-Division
                  </label>
                  <input
                    type="text"
                    value={formData.taluka}
                    onChange={(e) => setFormData({ ...formData, taluka: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl"
                    placeholder="e.g. Khed / Haveli / Kurla"
                  />
                </div>

                <div>
                  <label className="block text-slate-700 font-bold mb-1">
                    Plot / Survey / Gat Number *
                  </label>
                  <input
                    type="text"
                    value={formData.plotOrSurveyNumber}
                    onChange={(e) => setFormData({ ...formData, plotOrSurveyNumber: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl font-mono"
                    placeholder="e.g. Plot B-14/1, Chakan MIDC Phase II"
                    required
                  />
                </div>
              </div>

              {/* Civil Construction Toggle */}
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-bold text-slate-800 text-xs block">
                      Proposed Civil Construction on Plot
                    </span>
                    <p className="text-[11px] text-slate-500">
                      Does the project involve construction of industrial sheds, RCC factory buildings, or admin complexes?
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setFormData({ ...formData, hasCivilConstruction: true })}
                      className={`px-3 py-1 rounded-lg text-xs font-bold transition ${
                        formData.hasCivilConstruction
                          ? 'bg-blue-900 text-white'
                          : 'bg-white border border-slate-300 text-slate-700'
                      }`}
                    >
                      Yes
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormData({ ...formData, hasCivilConstruction: false })}
                      className={`px-3 py-1 rounded-lg text-xs font-bold transition ${
                        !formData.hasCivilConstruction
                          ? 'bg-blue-900 text-white'
                          : 'bg-white border border-slate-300 text-slate-700'
                      }`}
                    >
                      No (Existing Building)
                    </button>
                  </div>
                </div>

                {formData.hasCivilConstruction && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-slate-200 text-xs">
                    <div>
                      <label className="block text-slate-700 font-semibold mb-1">
                        Total Built-up Area (Square Meters) *
                      </label>
                      <input
                        type="number"
                        value={formData.totalBuiltUpAreaSqMeters}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value) || 0;
                          setFormData({ ...formData, totalBuiltUpAreaSqMeters: val });
                        }}
                        className="w-full px-3 py-1.5 border border-slate-300 rounded-lg font-mono font-bold"
                        placeholder="e.g. 7200"
                      />
                      <p className="text-[10px] text-slate-500 mt-0.5">
                        {formData.totalBuiltUpAreaSqMeters > 500 ? '⚡ Exceeds 500 sq.m: Triggers Fire Safety Provisional NOC.' : ''}
                      </p>
                    </div>

                    <div>
                      <label className="block text-slate-700 font-semibold mb-1">
                        Building Height (Meters)
                      </label>
                      <input
                        type="number"
                        value={formData.buildingHeightMeters}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value) || 0;
                          setFormData({
                            ...formData,
                            buildingHeightMeters: val,
                            isHighRise: val >= 15,
                          });
                        }}
                        className="w-full px-3 py-1.5 border border-slate-300 rounded-lg font-mono"
                        placeholder="e.g. 12"
                      />
                      <p className="text-[10px] text-slate-500 mt-0.5">
                        {formData.buildingHeightMeters >= 15 ? '⚠️ High-Rise (≥15m): Subject to Special Fire Safety Approvals.' : 'Low-Rise (<15m)'}
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* Eco Sensitive Buffer Zone */}
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                <label className="flex items-start gap-3 cursor-pointer text-xs">
                  <input
                    type="checkbox"
                    checked={formData.proximityToWaterBodyEcoZone}
                    onChange={(e) => setFormData({ ...formData, proximityToWaterBodyEcoZone: e.target.checked })}
                    className="mt-0.5 rounded border-slate-300 text-blue-900"
                  />
                  <div>
                    <span className="font-bold text-slate-800">
                      Site is within 500 meters of a River, Lake, or Eco-Sensitive Forest Zone
                    </span>
                    <p className="text-slate-500 text-[11px]">
                      Requires River Regulation Zone (RRZ) validation and special environmental buffer clearances.
                    </p>
                  </div>
                </label>
              </div>
            </div>
          )}

          {/* STEP 3: ENVIRONMENTAL & POLLUTION */}
          {currentStep === 3 && (
            <div className="space-y-5 animate-in fade-in duration-200">
              <div className="border-b border-slate-100 pb-3">
                <span className="text-[11px] font-bold text-blue-900 uppercase tracking-wider block">
                  Questionnaire • Step 3 of 6
                </span>
                <h3 className="text-lg font-bold font-serif text-slate-900">
                  Environmental &amp; Pollution Parameters (MPCB)
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Evaluates MPCB Consent to Establish (CTE), Hazardous Waste Authorization, and Stack Emission norms.
                </p>
              </div>

              {/* Prototype rule notice */}
              <div className="p-3 bg-amber-50/70 border border-amber-200 text-amber-900 rounded-xl text-xs flex items-start gap-2">
                <span>ℹ️</span>
                <span>
                  <strong>Prototype Rule Advisory:</strong> Statutory pollution classification is governed by the Central Pollution Control Board (CPCB) Revised Classification Scheme. Official categorization is confirmed upon formal scrutiny by the Regional Officer, MPCB.
                </span>
              </div>

              {/* CPCB Category Selection */}
              <div>
                <label className="block text-slate-700 font-bold mb-1.5 text-xs">
                  CPCB / MPCB Pollution Index Categorization *
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5 text-xs">
                  {[
                    {
                      category: 'Red' as PollutionCategory,
                      title: 'Red Category',
                      desc: 'Pollution Index ≥ 60. Heavy industrial, chemical, plating, large forges.',
                      color: 'border-rose-300 bg-rose-50/50 text-rose-950',
                      badge: 'bg-rose-100 text-rose-800',
                    },
                    {
                      category: 'Orange' as PollutionCategory,
                      title: 'Orange Category',
                      desc: 'Pollution Index 41–59. Auto components, engineering, food processing.',
                      color: 'border-amber-300 bg-amber-50/50 text-amber-950',
                      badge: 'bg-amber-100 text-amber-800',
                    },
                    {
                      category: 'Green' as PollutionCategory,
                      title: 'Green Category',
                      desc: 'Pollution Index 21–40. Small assembly, garmenting, solar equipment.',
                      color: 'border-emerald-300 bg-emerald-50/50 text-emerald-950',
                      badge: 'bg-emerald-100 text-emerald-800',
                    },
                    {
                      category: 'White' as PollutionCategory,
                      title: 'White Category',
                      desc: 'Pollution Index ≤ 20. Non-polluting, IT, handicraft. Exempt from CTE.',
                      color: 'border-slate-300 bg-slate-50 text-slate-900',
                      badge: 'bg-slate-200 text-slate-700',
                    },
                  ].map((item) => (
                    <button
                      key={item.category}
                      type="button"
                      onClick={() => setFormData({ ...formData, pollutionCategory: item.category })}
                      className={`p-3 rounded-xl border text-left transition ${
                        formData.pollutionCategory === item.category
                          ? `ring-2 ring-blue-900 ${item.color} shadow-xs font-bold`
                          : 'border-slate-200 bg-white hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className={`px-2 py-0.2 rounded text-[10px] font-bold ${item.badge}`}>
                          {item.title}
                        </span>
                        {formData.pollutionCategory === item.category && (
                          <span className="text-xs text-blue-900 font-bold">✓</span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-600 font-normal leading-relaxed mt-1">
                        {item.desc}
                      </p>
                    </button>
                  ))}
                </div>
              </div>

              {/* Trade Effluent Generation */}
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-3 text-xs">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-bold text-slate-800 block">
                      Industrial Trade Effluent Generation
                    </span>
                    <p className="text-[11px] text-slate-500">
                      Does the industrial process produce washing, cooling bleed, or chemical wastewater?
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setFormData({ ...formData, hasTradeEffluent: true })}
                      className={`px-3 py-1 rounded-lg font-bold transition ${
                        formData.hasTradeEffluent
                          ? 'bg-blue-900 text-white'
                          : 'bg-white border border-slate-300 text-slate-700'
                      }`}
                    >
                      Yes
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormData({ ...formData, hasTradeEffluent: false })}
                      className={`px-3 py-1 rounded-lg font-bold transition ${
                        !formData.hasTradeEffluent
                          ? 'bg-blue-900 text-white'
                          : 'bg-white border border-slate-300 text-slate-700'
                      }`}
                    >
                      No (Zero Discharge)
                    </button>
                  </div>
                </div>

                {formData.hasTradeEffluent && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-slate-200">
                    <div>
                      <label className="block text-slate-700 font-semibold mb-1">
                        Daily Trade Effluent Generation (KLD) *
                      </label>
                      <input
                        type="number"
                        value={formData.effluentDischargeKld}
                        onChange={(e) => setFormData({ ...formData, effluentDischargeKld: parseFloat(e.target.value) || 0 })}
                        className="w-full px-3 py-1.5 border border-slate-300 rounded-lg font-mono font-bold"
                        placeholder="e.g. 35"
                      />
                    </div>
                    <div>
                      <label className="block text-slate-700 font-semibold mb-1">
                        Effluent Treatment Scheme
                      </label>
                      <select
                        value={formData.etpOrCetpHookupProposed ? 'ETP' : 'CETP'}
                        onChange={(e) => setFormData({ ...formData, etpOrCetpHookupProposed: e.target.value === 'ETP' })}
                        className="w-full px-3 py-1.5 border border-slate-300 rounded-lg bg-white"
                      >
                        <option value="ETP">Dedicated Captive Effluent Treatment Plant (ETP) on site</option>
                        <option value="CETP">Hookup to MIDC Common Effluent Treatment Plant (CETP)</option>
                      </select>
                    </div>
                  </div>
                )}
              </div>

              {/* Air Emissions & Hazardous Waste Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
                  <label className="flex items-start gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.hasAirEmissions}
                      onChange={(e) => setFormData({ ...formData, hasAirEmissions: e.target.checked })}
                      className="mt-0.5 rounded border-slate-300 text-blue-900"
                    />
                    <div>
                      <span className="font-bold text-slate-800">
                        Process Air Emissions / Chimney Stacks
                      </span>
                      <p className="text-[11px] text-slate-500">
                        Flue gas, paint spray booths, or furnace exhaust requiring stack heights.
                      </p>
                    </div>
                  </label>
                  {formData.hasAirEmissions && (
                    <div className="pt-2">
                      <label className="block text-slate-700 font-semibold text-[11px] mb-1">
                        Proposed Stack Height (Meters)
                      </label>
                      <input
                        type="number"
                        value={formData.stackHeightMeters}
                        onChange={(e) => setFormData({ ...formData, stackHeightMeters: parseFloat(e.target.value) || 0 })}
                        className="w-full px-2.5 py-1 border border-slate-300 rounded-lg font-mono"
                        placeholder="30"
                      />
                    </div>
                  )}
                </div>

                <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
                  <label className="flex items-start gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.generatesHazardousWaste}
                      onChange={(e) => setFormData({ ...formData, generatesHazardousWaste: e.target.checked })}
                      className="mt-0.5 rounded border-slate-300 text-blue-900"
                    />
                    <div>
                      <span className="font-bold text-slate-800">
                        Hazardous Waste Generation (Form 1)
                      </span>
                      <p className="text-[11px] text-slate-500">
                        Used oil, paint sludge, ETP sludge, or chemical packaging containers.
                      </p>
                    </div>
                  </label>
                  <p className="text-[10px] text-slate-500 pl-6">
                    ⚡ Triggers MPCB Hazardous Waste Authorization &amp; CHWTSDF membership.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* STEP 4: UTILITIES & SAFETY */}
          {currentStep === 4 && (
            <div className="space-y-5 animate-in fade-in duration-200">
              <div className="border-b border-slate-100 pb-3">
                <span className="text-[11px] font-bold text-blue-900 uppercase tracking-wider block">
                  Questionnaire • Step 4 of 6
                </span>
                <h3 className="text-lg font-bold font-serif text-slate-900">
                  Utilities, Electrical Power &amp; Plant Safety
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Determines MSEDCL power sanctions, Chief Electrical Inspector (CEI) approvals, and water allocations.
                </p>
              </div>

              {/* Power Demand & Voltage */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                <div>
                  <label className="block text-slate-700 font-bold mb-1">
                    Contract Electrical Demand (kVA) *
                  </label>
                  <input
                    type="number"
                    value={formData.contractDemandKva}
                    onChange={(e) => {
                      const kva = parseFloat(e.target.value) || 0;
                      setFormData({
                        ...formData,
                        contractDemandKva: kva,
                        voltageLevel: kva >= 100 ? 'HT (High Tension 11kV / 22kV / 33kV)' : 'LT (Low Tension < 65 kW / 415V)',
                        hasSubstationOrTransformer: kva >= 500,
                      });
                    }}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl font-mono font-bold"
                    placeholder="e.g. 1250"
                    required
                  />
                  <p className="text-[10.5px] text-slate-500 mt-1">
                    {formData.contractDemandKva >= 100
                      ? '⚡ ≥ 100 kVA: Triggers High Tension (HT) Power Sanction & CEI drawing clearance.'
                      : 'Standard Low Tension (LT) commercial tariff.'}
                  </p>
                </div>

                <div>
                  <label className="block text-slate-700 font-bold mb-1">
                    Voltage Supply Grade *
                  </label>
                  <select
                    value={formData.voltageLevel}
                    onChange={(e) => setFormData({ ...formData, voltageLevel: e.target.value as VoltageGrade })}
                    className="w-full px-3 py-2.5 border border-slate-300 rounded-xl bg-white font-medium"
                  >
                    <option value="LT (Low Tension < 65 kW / 415V)">LT (Low Tension &lt; 65 kW / 415V)</option>
                    <option value="HT (High Tension 11kV / 22kV / 33kV)">HT (High Tension 11kV / 22kV / 33kV)</option>
                    <option value="EHT (Extra High Tension 66kV+)">EHT (Extra High Tension 66kV+)</option>
                  </select>
                </div>
              </div>

              {/* Standby DG Set & Substation */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200">
                  <label className="block text-slate-700 font-bold mb-1">
                    Standby Diesel Generator (DG Set) Capacity (kVA)
                  </label>
                  <input
                    type="number"
                    value={formData.dgSetCapacityKva}
                    onChange={(e) => setFormData({ ...formData, dgSetCapacityKva: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-lg font-mono"
                    placeholder="e.g. 250 (0 for none)"
                  />
                  <p className="text-[10px] text-slate-500 mt-1">
                    {formData.dgSetCapacityKva > 0 ? '⚡ Triggers Chief Electrical Inspector (CEI) DG Set Inspection.' : 'No DG Set planned.'}
                  </p>
                </div>

                <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200">
                  <label className="block text-slate-700 font-bold mb-1">
                    Daily Water Demand (KLD) *
                  </label>
                  <input
                    type="number"
                    value={formData.waterDemandKld}
                    onChange={(e) => setFormData({ ...formData, waterDemandKld: parseFloat(e.target.value) || 0 })}
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-lg font-mono font-bold"
                    placeholder="e.g. 50"
                  />
                  <p className="text-[10px] text-slate-500 mt-1">
                    Combined process, cooling, domestic, and gardening water volume.
                  </p>
                </div>
              </div>

              {/* Water Source & Solvents */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                <div>
                  <label className="block text-slate-700 font-bold mb-1">
                    Primary Water Supply Source *
                  </label>
                  <select
                    value={formData.waterSource}
                    onChange={(e) => setFormData({ ...formData, waterSource: e.target.value as WaterSourceType })}
                    className="w-full px-3 py-2.5 border border-slate-300 rounded-xl bg-white font-medium"
                  >
                    <option value="MIDC Piped Supply">MIDC Industrial Piped Distribution</option>
                    <option value="Groundwater / Borewell">Groundwater / Borewell Extraction (CGWA / GSDA)</option>
                    <option value="Surface River / Canal">Surface Water / River Irrigation Hookup</option>
                    <option value="Private Water Tankers">Private Bulk Tankers</option>
                  </select>
                  <p className="text-[10px] text-slate-500 mt-1">
                    {formData.waterSource === 'Groundwater / Borewell' ? '⚠️ Triggers CGWA / GSDA Groundwater Extraction NOC.' : ''}
                  </p>
                </div>

                <div>
                  <label className="block text-slate-700 font-bold mb-1">
                    Industrial Boilers / Steam Vessels
                  </label>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setFormData({ ...formData, hasBoilerOrSteamSystem: true, boilerCapacityTph: 2 })}
                      className={`flex-1 py-2 rounded-xl border text-center font-bold transition ${
                        formData.hasBoilerOrSteamSystem
                          ? 'bg-blue-900 text-white'
                          : 'bg-white border-slate-200 text-slate-700'
                      }`}
                    >
                      Yes (Boilers Proposed)
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormData({ ...formData, hasBoilerOrSteamSystem: false, boilerCapacityTph: 0 })}
                      className={`flex-1 py-2 rounded-xl border text-center font-bold transition ${
                        !formData.hasBoilerOrSteamSystem
                          ? 'bg-blue-900 text-white'
                          : 'bg-white border-slate-200 text-slate-700'
                      }`}
                    >
                      No Boilers
                    </button>
                  </div>
                  {formData.hasBoilerOrSteamSystem && (
                    <div className="mt-2">
                      <input
                        type="number"
                        step="0.5"
                        value={formData.boilerCapacityTph}
                        onChange={(e) => setFormData({ ...formData, boilerCapacityTph: parseFloat(e.target.value) || 0 })}
                        className="w-full px-2.5 py-1 border border-slate-300 rounded-lg text-xs font-mono"
                        placeholder="Capacity in Tonnes Per Hour (TPH)"
                      />
                      <span className="text-[9.5px] text-blue-900 block mt-0.5">
                        ⚡ Triggers Directorate of Steam Boilers Registration.
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Chemical / Solvent Storage */}
              <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 text-xs space-y-2">
                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.hasSolventOrHazardousStorage}
                    onChange={(e) => setFormData({ ...formData, hasSolventOrHazardousStorage: e.target.checked })}
                    className="mt-0.5 rounded border-slate-300 text-blue-900"
                  />
                  <div>
                    <span className="font-bold text-slate-800">
                      Bulk Storage of Solvents, Petroleum Products or Flammable Chemicals
                    </span>
                    <p className="text-[11px] text-slate-500">
                      Storage tanks or barrel yards exceeding threshold limits under the Petroleum Act 1934.
                    </p>
                  </div>
                </label>
                {formData.hasSolventOrHazardousStorage && (
                  <div className="pt-2 pl-6">
                    <label className="block text-slate-700 font-semibold mb-1 text-[11px]">
                      Total Flammable Liquid Storage Capacity (Kilo Litres - KL)
                    </label>
                    <input
                      type="number"
                      value={formData.solventStorageKl}
                      onChange={(e) => setFormData({ ...formData, solventStorageKl: parseFloat(e.target.value) || 0 })}
                      className="w-48 px-2.5 py-1 border border-slate-300 rounded-lg font-mono text-xs"
                      placeholder="e.g. 10"
                    />
                    <p className="text-[10px] text-slate-500 mt-0.5">
                      ⚡ Triggers PESO (Petroleum &amp; Explosives Safety Organisation) Bulk Storage Licence.
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* STEP 5: LABOUR & WORKFORCE */}
          {currentStep === 5 && (
            <div className="space-y-5 animate-in fade-in duration-200">
              <div className="border-b border-slate-100 pb-3">
                <span className="text-[11px] font-bold text-blue-900 uppercase tracking-wider block">
                  Questionnaire • Step 5 of 6
                </span>
                <h3 className="text-lg font-bold font-serif text-slate-900">
                  Labour, Employment &amp; Occupational Welfare
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Determines applicability of Factories Act 1948 (DISH), Contract Labour Act 1970, and Inter-State Migrant Workmen welfare registrations.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                <div>
                  <label className="block text-slate-700 font-bold mb-1">
                    Total Estimated Direct Workforce (Workers &amp; Staff) *
                  </label>
                  <input
                    type="number"
                    value={formData.totalWorkforce}
                    onChange={(e) => setFormData({ ...formData, totalWorkforce: parseInt(e.target.value) || 0 })}
                    className="w-full px-3 py-2 border border-slate-300 rounded-xl font-mono font-bold"
                    placeholder="e.g. 140"
                    required
                  />
                  <p className="text-[10.5px] text-slate-500 mt-1">
                    {formData.totalWorkforce >= 10
                      ? '⚡ ≥ 10 workers with electric power: Mandates Factory Licence (DISH) under Section 2(m)(i).'
                      : 'Under Section 2(m)(i) threshold.'}
                  </p>
                </div>

                <div>
                  <label className="block text-slate-700 font-bold mb-1">
                    Manufacturing Process Mode *
                  </label>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setFormData({ ...formData, isPowerDrivenProcess: true })}
                      className={`flex-1 py-2 px-3 rounded-xl border text-center font-bold transition ${
                        formData.isPowerDrivenProcess
                          ? 'bg-blue-900 text-white'
                          : 'bg-white border-slate-200 text-slate-700'
                      }`}
                    >
                      With Aid of Power (Electric)
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormData({ ...formData, isPowerDrivenProcess: false })}
                      className={`flex-1 py-2 px-3 rounded-xl border text-center font-bold transition ${
                        !formData.isPowerDrivenProcess
                          ? 'bg-blue-900 text-white'
                          : 'bg-white border-slate-200 text-slate-700'
                      }`}
                    >
                      Without Aid of Power
                    </button>
                  </div>
                </div>
              </div>

              {/* Contract Labour Section */}
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-3 text-xs">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-bold text-slate-800 block">
                      Contract Labour Engagement (CLRA Act, 1970)
                    </span>
                    <p className="text-[11px] text-slate-500">
                      Will third-party contractors supply security, housekeeping, packing, or production labour?
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setFormData({ ...formData, hasContractLabour: true, contractLabourCount: 40 })}
                      className={`px-3 py-1 rounded-lg font-bold transition ${
                        formData.hasContractLabour
                          ? 'bg-blue-900 text-white'
                          : 'bg-white border border-slate-300 text-slate-700'
                      }`}
                    >
                      Yes
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormData({ ...formData, hasContractLabour: false, contractLabourCount: 0 })}
                      className={`px-3 py-1 rounded-lg font-bold transition ${
                        !formData.hasContractLabour
                          ? 'bg-blue-900 text-white'
                          : 'bg-white border border-slate-300 text-slate-700'
                      }`}
                    >
                      No
                    </button>
                  </div>
                </div>

                {formData.hasContractLabour && (
                  <div className="pt-2 border-t border-slate-200">
                    <label className="block text-slate-700 font-semibold mb-1">
                      Expected Peak Number of Contract Workmen *
                    </label>
                    <input
                      type="number"
                      value={formData.contractLabourCount}
                      onChange={(e) => setFormData({ ...formData, contractLabourCount: parseInt(e.target.value) || 0 })}
                      className="w-48 px-3 py-1.5 border border-slate-300 rounded-lg font-mono font-bold"
                      placeholder="e.g. 45"
                    />
                    <p className="text-[10px] text-slate-500 mt-1">
                      {formData.contractLabourCount >= 20
                        ? '⚡ ≥ 20 contract workmen: Mandates Principal Employer Registration Certificate under CLRA Section 7.'
                        : 'Exempt from Principal Employer Registration (< 20 workers).'}
                    </p>
                  </div>
                )}
              </div>

              {/* Inter-State Migrant Workmen */}
              <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-3 text-xs">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-bold text-slate-800 block">
                      Inter-State Migrant Workmen
                    </span>
                    <p className="text-[11px] text-slate-500">
                      Does the undertaking employ or contract workers originating from other Indian states?
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setFormData({ ...formData, hasInterstateMigrantWorkers: true, interstateWorkersCount: 15 })}
                      className={`px-3 py-1 rounded-lg font-bold transition ${
                        formData.hasInterstateMigrantWorkers
                          ? 'bg-blue-900 text-white'
                          : 'bg-white border border-slate-300 text-slate-700'
                      }`}
                    >
                      Yes
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormData({ ...formData, hasInterstateMigrantWorkers: false, interstateWorkersCount: 0 })}
                      className={`px-3 py-1 rounded-lg font-bold transition ${
                        !formData.hasInterstateMigrantWorkers
                          ? 'bg-blue-900 text-white'
                          : 'bg-white border border-slate-300 text-slate-700'
                      }`}
                    >
                      No
                    </button>
                  </div>
                </div>

                {formData.hasInterstateMigrantWorkers && (
                  <div className="pt-2 border-t border-slate-200">
                    <label className="block text-slate-700 font-semibold mb-1">
                      Number of Inter-State Workmen Expected *
                    </label>
                    <input
                      type="number"
                      value={formData.interstateWorkersCount}
                      onChange={(e) => setFormData({ ...formData, interstateWorkersCount: parseInt(e.target.value) || 0 })}
                      className="w-48 px-3 py-1.5 border border-slate-300 rounded-lg font-mono font-bold"
                      placeholder="e.g. 15"
                    />
                    <p className="text-[10px] text-slate-500 mt-1">
                      {formData.interstateWorkersCount >= 5
                        ? '⚡ ≥ 5 migrant workers: Mandates Inter-State Migrant Workmen Establishment Registration.'
                        : 'Exempt (< 5 workers).'}
                    </p>
                  </div>
                )}
              </div>

              {/* Operating Shifts */}
              <div className="text-xs">
                <label className="block text-slate-700 font-bold mb-1">
                  Plant Shift Schedule
                </label>
                <select
                  value={formData.operatingShifts}
                  onChange={(e) => setFormData({ ...formData, operatingShifts: e.target.value as any })}
                  className="w-full sm:w-80 px-3 py-2 border border-slate-300 rounded-xl bg-white font-medium"
                >
                  <option value="Single Shift">Single General Shift (8 hours)</option>
                  <option value="Two Shifts">Two Production Shifts (16 hours)</option>
                  <option value="Continuous 24x7 Three Shifts">Continuous 24x7 Three Shifts (Requires Night Shift Safety Clearances)</option>
                </select>
              </div>
            </div>
          )}

          {/* STEP 6: REVIEW & COMPOSITE ANALYSIS */}
          {currentStep === 6 && (
            <div className="space-y-6 animate-in fade-in duration-200">
              <div className="border-b border-slate-100 pb-3">
                <span className="text-[11px] font-bold text-blue-900 uppercase tracking-wider block">
                  Questionnaire • Step 6 of 6
                </span>
                <h3 className="text-lg font-bold font-serif text-slate-900">
                  Review Parameters &amp; Execute Composite Clearance Engine
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Confirm the recorded project characteristics. The rule engine will calculate the statutory clearance docket and sequence.
                </p>
              </div>

              {/* Summary Dossier Review Cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                {/* Section 1 Review */}
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-2">
                  <div className="flex items-center justify-between border-b border-slate-200 pb-1.5">
                    <span className="font-bold text-slate-900 font-serif">1. Activity &amp; Sector</span>
                    <button
                      type="button"
                      onClick={() => setCurrentStep(1)}
                      className="text-blue-900 hover:text-blue-700 font-bold text-[11px] underline"
                    >
                      Edit
                    </button>
                  </div>
                  <div className="space-y-1 text-slate-600">
                    <p><span className="text-slate-400">Sector:</span> <strong className="text-slate-800">{formData.sector}</strong></p>
                    <p><span className="text-slate-400">Nature:</span> {formData.projectNature} ({formData.industryType})</p>
                    <p><span className="text-slate-400">Capital Investment:</span> <strong className="text-blue-900 font-mono">₹{formData.proposedCapitalInvestmentCr} Cr</strong></p>
                    <p><span className="text-slate-400">EOU / SEZ:</span> {formData.eouStatus ? 'Yes (100% EOU)' : 'Domestic Tariff Area'}</p>
                  </div>
                </div>

                {/* Section 2 Review */}
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-2">
                  <div className="flex items-center justify-between border-b border-slate-200 pb-1.5">
                    <span className="font-bold text-slate-900 font-serif">2. Location &amp; Siting</span>
                    <button
                      type="button"
                      onClick={() => setCurrentStep(2)}
                      className="text-blue-900 hover:text-blue-700 font-bold text-[11px] underline"
                    >
                      Edit
                    </button>
                  </div>
                  <div className="space-y-1 text-slate-600">
                    <p><span className="text-slate-400">Authority:</span> <strong className="text-slate-800">{formData.landType}</strong></p>
                    <p><span className="text-slate-400">District:</span> {formData.district} ({formData.taluka})</p>
                    <p><span className="text-slate-400">Plot/Survey:</span> <span className="font-mono text-slate-800">{formData.plotOrSurveyNumber}</span></p>
                    <p><span className="text-slate-400">Built-Up Area:</span> {formData.hasCivilConstruction ? `${formData.totalBuiltUpAreaSqMeters} sq.m (${formData.buildingHeightMeters}m)` : 'None (Existing)'}</p>
                  </div>
                </div>

                {/* Section 3 Review */}
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-2">
                  <div className="flex items-center justify-between border-b border-slate-200 pb-1.5">
                    <span className="font-bold text-slate-900 font-serif">3. Environmental &amp; Pollution</span>
                    <button
                      type="button"
                      onClick={() => setCurrentStep(3)}
                      className="text-blue-900 hover:text-blue-700 font-bold text-[11px] underline"
                    >
                      Edit
                    </button>
                  </div>
                  <div className="space-y-1 text-slate-600">
                    <p>
                      <span className="text-slate-400">Pollution Category:</span>{' '}
                      <span className={`px-2 py-0.2 rounded text-[10px] font-bold ${
                        formData.pollutionCategory === 'Red'
                          ? 'bg-rose-100 text-rose-900 border border-rose-300'
                          : formData.pollutionCategory === 'Orange'
                          ? 'bg-amber-100 text-amber-900 border border-amber-300'
                          : 'bg-emerald-100 text-emerald-900 border border-emerald-300'
                      }`}>
                        {formData.pollutionCategory} Category
                      </span>
                    </p>
                    <p><span className="text-slate-400">Effluent:</span> {formData.hasTradeEffluent ? `${formData.effluentDischargeKld} KLD (${formData.etpOrCetpHookupProposed ? 'Captive ETP' : 'CETP'})` : 'Zero Discharge'}</p>
                    <p><span className="text-slate-400">Air Emissions:</span> {formData.hasAirEmissions ? `Yes (${formData.stackHeightMeters}m stack)` : 'None'}</p>
                    <p><span className="text-slate-400">Hazardous Waste:</span> {formData.generatesHazardousWaste ? 'Yes (Form 1 Applicable)' : 'No'}</p>
                  </div>
                </div>

                {/* Section 4 & 5 Review */}
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-2">
                  <div className="flex items-center justify-between border-b border-slate-200 pb-1.5">
                    <span className="font-bold text-slate-900 font-serif">4 &amp; 5. Utilities &amp; Workforce</span>
                    <button
                      type="button"
                      onClick={() => setCurrentStep(4)}
                      className="text-blue-900 hover:text-blue-700 font-bold text-[11px] underline"
                    >
                      Edit
                    </button>
                  </div>
                  <div className="space-y-1 text-slate-600">
                    <p><span className="text-slate-400">Power:</span> <strong className="text-slate-800">{formData.contractDemandKva} kVA</strong> ({formData.voltageLevel})</p>
                    <p><span className="text-slate-400">DG Set:</span> {formData.dgSetCapacityKva > 0 ? `${formData.dgSetCapacityKva} kVA Standby` : 'None'}</p>
                    <p><span className="text-slate-400">Water Demand:</span> {formData.waterDemandKld} KLD via {formData.waterSource}</p>
                    <p><span className="text-slate-400">Total Workforce:</span> <strong className="text-slate-800">{formData.totalWorkforce} direct</strong> ({formData.hasContractLabour ? `${formData.contractLabourCount} contract` : 'No contract'})</p>
                  </div>
                </div>
              </div>

              {/* Statutory Legal Safeguard Warning */}
              <div className="p-4 rounded-xl bg-blue-50/70 border border-blue-200 text-xs text-blue-950 space-y-1">
                <span className="font-bold block flex items-center gap-1.5">
                  <span>⚖️</span>
                  <span>Statutory Safeguard &amp; Advisory Notice:</span>
                </span>
                <p className="text-blue-900/90 leading-relaxed">
                  The MahaUdyam One Approval Discovery Engine generates an indicative clearance matrix based on user-supplied parameters and state regulatory frameworks. Final statutory approvals and fee sanctions are verified by competent departmental authorities during formal single-window processing.
                  <span className="font-semibold text-blue-950 block mt-1">
                    Prototype rule — statutory validation required.
                  </span>
                </p>
              </div>

              {/* Engine Loading State or Submit Button */}
              {isEvaluating ? (
                <div className="p-6 bg-slate-50 border border-blue-300 rounded-2xl text-center space-y-3 shadow-inner">
                  <div className="w-10 h-10 border-3 border-blue-900 border-t-transparent rounded-full animate-spin mx-auto" />
                  <h4 className="text-sm font-bold text-[#0f2b48] font-serif">
                    Evaluating Clearance Matrix &amp; Trigger Rules...
                  </h4>
                  <p className="text-xs text-blue-800 font-medium animate-pulse">
                    {evaluatingStepText}
                  </p>
                </div>
              ) : (
                <div className="pt-2">
                  <button
                    type="button"
                    onClick={handleRunEngine}
                    className="w-full py-3.5 px-6 rounded-xl bg-[#0f2b48] hover:bg-blue-900 text-white font-bold text-sm shadow-md transition flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <span>⚡ Run Clearance Engine &amp; Generate Statutory Docket</span>
                    <span>→</span>
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Navigation Controls (Back / Next) */}
          {!isEvaluating && (
            <div className="flex items-center justify-between pt-4 border-t border-slate-100">
              <button
                type="button"
                onClick={handleBack}
                disabled={currentStep === 1}
                className={`px-4 py-2 text-xs font-semibold rounded-xl border transition ${
                  currentStep === 1
                    ? 'opacity-40 cursor-not-allowed border-slate-200 text-slate-400'
                    : 'border-slate-300 text-slate-700 hover:bg-slate-100 cursor-pointer'
                }`}
              >
                ← Back
              </button>

              {currentStep < 6 && (
                <button
                  type="button"
                  onClick={handleNext}
                  className="px-6 py-2 bg-blue-900 hover:bg-blue-800 text-white text-xs font-bold rounded-xl shadow-xs transition cursor-pointer"
                >
                  Next: {steps[currentStep].title} →
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </ApplicantLayout>
  );
};
