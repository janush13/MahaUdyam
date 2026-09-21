import {
  ProjectParametersContext,
  ApprovalResult,
  DiscoverySummary,
  DocumentRequirement,
} from '../types/approvalDiscovery';
import { Enterprise, EnterpriseProject } from '../types/applicant';

const DISCOVERY_STORAGE_KEY = 'mahaudyam_approval_discovery_summary';

export class ApprovalRuleEngine {
  /**
   * Builds an initial default context prefilled from Phase 3 Enterprise & Project state
   */
  public createInitialContext(
    enterprise: Enterprise,
    project: EnterpriseProject
  ): ProjectParametersContext {
    // Determine default pollution category based on sector
    let defaultPollution: 'Red' | 'Orange' | 'Green' | 'White' = 'Orange';
    const sectorLower = (project.sector || '').toLowerCase();
    if (
      sectorLower.includes('chemical') ||
      sectorLower.includes('pharma') ||
      sectorLower.includes('metallurgical') ||
      sectorLower.includes('forging')
    ) {
      defaultPollution = 'Red';
    } else if (
      sectorLower.includes('auto') ||
      sectorLower.includes('engineering') ||
      sectorLower.includes('tooling')
    ) {
      defaultPollution = 'Orange';
    } else if (
      sectorLower.includes('agro') ||
      sectorLower.includes('garment')
    ) {
      defaultPollution = 'Green';
    }

    const builtUpSqM = Math.round((project.landAreaAcres || 2) * 4046 * 0.4); // 40% ground coverage rule of thumb

    return {
      enterpriseId: enterprise.id,
      enterpriseName: enterprise.name,
      projectId: project.id,
      projectName: project.name,

      // Step 1
      sector: project.sector || 'Automobile & Auto Components',
      subSectorOrActivity: project.description || 'High precision engineering & automated CNC manufacturing',
      industryType: 'Manufacturing',
      projectNature: project.status === 'Operational' ? 'Substantial Expansion / Modernization' : 'Greenfield / New Unit',
      eouStatus: false,
      proposedCapitalInvestmentCr: project.proposedInvestmentCr || enterprise.capitalInvestmentCr || 10,

      // Step 2
      landType: project.midcArea ? 'MIDC Notified Industrial Area' : 'Private Industrial Land / Outside MIDC',
      district: project.district || enterprise.district || 'Pune',
      taluka: project.location.includes('Khed') ? 'Khed' : 'Haveli',
      plotOrSurveyNumber: project.location.split(',')[0] || 'Plot B-14',
      midcZoneName: project.midcArea || 'Chakan MIDC Phase II',
      hasCivilConstruction: true,
      totalBuiltUpAreaSqMeters: builtUpSqM,
      buildingHeightMeters: 12,
      isHighRise: false,
      proximityToWaterBodyEcoZone: false,

      // Step 3
      pollutionCategory: defaultPollution,
      hasTradeEffluent: (project.waterDemandKld || 0) > 15,
      effluentDischargeKld: Math.round((project.waterDemandKld || 50) * 0.7),
      etpOrCetpHookupProposed: true,
      hasAirEmissions: defaultPollution === 'Red' || defaultPollution === 'Orange',
      stackHeightMeters: 30,
      hasFurnacesOrBoilers: defaultPollution === 'Red',
      generatesHazardousWaste: true,
      hazardousWasteTypes: ['Used / Waste Lubricating Oil (5.1)', 'Chemical / Solvent Containers (33.1)', 'ETP Sludge (35.3)'],

      // Step 4
      contractDemandKva: project.powerDemandKva || 1250,
      voltageLevel: (project.powerDemandKva || 1000) >= 100 ? 'HT (High Tension 11kV / 22kV / 33kV)' : 'LT (Low Tension < 65 kW / 415V)',
      hasSubstationOrTransformer: (project.powerDemandKva || 1000) >= 500,
      dgSetCapacityKva: 250,
      waterDemandKld: project.waterDemandKld || 50,
      waterSource: project.midcArea ? 'MIDC Piped Supply' : 'Groundwater / Borewell',
      hasSolventOrHazardousStorage: defaultPollution === 'Red',
      solventStorageKl: defaultPollution === 'Red' ? 10 : 0,
      hasBoilerOrSteamSystem: defaultPollution === 'Red',
      boilerCapacityTph: defaultPollution === 'Red' ? 2 : 0,

      // Step 5
      totalWorkforce: project.proposedEmployment || 120,
      isPowerDrivenProcess: true,
      hasContractLabour: (project.proposedEmployment || 120) >= 20,
      contractLabourCount: Math.round((project.proposedEmployment || 120) * 0.4),
      hasInterstateMigrantWorkers: (project.proposedEmployment || 120) >= 50,
      interstateWorkersCount: Math.round((project.proposedEmployment || 120) * 0.15),
      operatingShifts: 'Two Shifts',
    };
  }

  /**
   * Centralized, deterministic evaluation of industrial clearances
   */
  public evaluateProject(ctx: ProjectParametersContext): DiscoverySummary {
    const results: ApprovalResult[] = [];
    const disclaimer = 'Prototype rule — statutory validation required by competent authority.';

    // 1. Consent to Establish (CTE) - MPCB
    // Applies if manufacturing/processing in Red, Orange or Green categories
    if (ctx.pollutionCategory !== 'White') {
      let fee = 10000;
      if (ctx.proposedCapitalInvestmentCr > 25) {
        fee = 25000;
      } else if (ctx.proposedCapitalInvestmentCr < 5) {
        fee = 5000;
      }
      const sla = ctx.pollutionCategory === 'Red' ? 60 : 30;

      results.push({
        id: 'cte-01',
        serviceCode: 'CTE-01',
        name: 'Consent to Establish (CTE)',
        department: 'Environment Department',
        subDepartment: 'MPCB (Maharashtra Pollution Control Board)',
        act: 'Water (Prevention & Control of Pollution) Act 1974 & Air (Prevention & Control of Pollution) Act 1981',
        stage: 'Pre-Establishment',
        applicability: 'Mandatory',
        triggerReason: `Triggered by: ${ctx.industryType} Activity (${ctx.sector}) classified under ${ctx.pollutionCategory} Category with Capital Investment ₹${ctx.proposedCapitalInvestmentCr} Cr and ${ctx.hasTradeEffluent ? `trade effluent discharge of ${ctx.effluentDischargeKld} KLD.` : 'air/noise pollution baseline.'}`,
        slaDays: sla,
        feeEstimate: fee,
        feeFormulaText: `₹${fee.toLocaleString('en-IN')} (Scaled by Capital Investment of ₹${ctx.proposedCapitalInvestmentCr} Cr under MPCB Gazette Fee Schedule)`,
        prerequisites: 'Pre-requisite for Factory Licence & Civil Construction Sanction',
        requiredDocuments: [
          'Detailed Project Report (DPR) with Manufacturing Process Flow',
          'Site Layout Plan with ETP / STP Proposed Locations',
          'Land Possession Receipt / MIDC Allotment Letter',
          'Water Balance & Effluent Treatment Scheme',
          'Air Pollution Control (APC) Equipment Drawings',
        ],
        sequenceOrder: 1,
        category: 'Environment',
        statutoryDisclaimer: disclaimer,
        authorityContactOffice: `MPCB Regional Office (${ctx.district})`,
        applicationMode: 'Online via Single Window',
      });
    }

    // 2. Building Plan Approval & Sanction - MIDC SPA / Local Planning Authority
    if (ctx.hasCivilConstruction || ctx.totalBuiltUpAreaSqMeters > 0) {
      const isMidc = ctx.landType === 'MIDC Notified Industrial Area';
      const fee = Math.max(10000, Math.round(ctx.totalBuiltUpAreaSqMeters * 3.5));

      results.push({
        id: 'bp-11',
        serviceCode: 'BP-11',
        name: isMidc ? 'Building Plan Approval & Sanction (MIDC)' : 'Building Permission & Development Sanction (MRTP)',
        department: 'Urban Development Department',
        subDepartment: isMidc ? 'MIDC Special Planning Authority (SPA)' : `District Town Planning & Collectorate (${ctx.district})`,
        act: isMidc ? 'MIDC Development Control & Promotion Regulations (DCPR)' : 'Maharashtra Regional & Town Planning (MRTP) Act, 1966',
        stage: 'Pre-Establishment',
        applicability: 'Mandatory',
        triggerReason: `Triggered by: Planned civil construction on site with built-up area of ${ctx.totalBuiltUpAreaSqMeters.toLocaleString('en-IN')} sq.m on ${ctx.landType} (${ctx.plotOrSurveyNumber}).`,
        slaDays: 60,
        feeEstimate: fee,
        feeFormulaText: `₹${fee.toLocaleString('en-IN')} (Calculated on built-up area of ${ctx.totalBuiltUpAreaSqMeters} sq.m @ ₹3.50/sq.m scrutiny charges)`,
        prerequisites: 'Requires Provisional Fire NOC and Site Demarcation Certificate',
        requiredDocuments: [
          'Architectural Layout Drawings (AutoCAD / PDF signed by Council Architect)',
          'Structural Stability Certificate by Licensed Structural Engineer',
          'Land Title Search Report & Allotment Letter',
          'Storm Water Drainage & Soil Test Report',
        ],
        sequenceOrder: 2,
        category: 'Planning & Building',
        statutoryDisclaimer: disclaimer,
        authorityContactOffice: isMidc ? `MIDC Executive Engineer (SPA), ${ctx.district}` : `Town Planning Office, ${ctx.district}`,
        applicationMode: 'Online via Single Window',
      });
    }

    // 3. Fire Safety Provisional NOC
    // Triggered if builtUpArea > 500 sq.m OR highRise OR solvent storage OR Red/Orange pollution
    if (
      ctx.totalBuiltUpAreaSqMeters > 500 ||
      ctx.buildingHeightMeters >= 15 ||
      ctx.hasSolventOrHazardousStorage ||
      ctx.pollutionCategory === 'Red' ||
      ctx.pollutionCategory === 'Orange'
    ) {
      results.push({
        id: 'noc-04',
        serviceCode: 'NOC-04',
        name: 'Fire Safety Provisional NOC',
        department: 'Fire Services Department',
        subDepartment: ctx.landType === 'MIDC Notified Industrial Area' ? 'MIDC Fire Prevention Division' : `Directorate of Maharashtra Fire Services (${ctx.district})`,
        act: 'Maharashtra Fire Prevention & Life Safety Measures Act 2006',
        stage: 'Pre-Establishment',
        applicability: 'Mandatory',
        triggerReason: `Triggered by: Industrial built-up area of ${ctx.totalBuiltUpAreaSqMeters} sq.m (exceeding 500 sq.m threshold)${ctx.buildingHeightMeters >= 15 ? ' + High-Rise building height ≥ 15m' : ''}${ctx.hasSolventOrHazardousStorage ? ' + Presence of solvent/chemical storage' : ''}.`,
        slaDays: 21,
        feeEstimate: 2000,
        feeFormulaText: '₹2,000 (Standard statutory scrutiny charges for industrial provisional assessment)',
        prerequisites: 'Pre-requisite for Building Plan Approval & Commencement Certificate',
        requiredDocuments: [
          'Fire Evacuation & Hydrant Layout Drawings',
          'Emergency Escape & Static Water Tank Capacity Calculations',
          'Hazard Identification & Chemical Risk Assessment (if applicable)',
        ],
        sequenceOrder: 3,
        category: 'Fire & Safety',
        statutoryDisclaimer: disclaimer,
        authorityContactOffice: `Divisional Fire Office, ${ctx.district}`,
        applicationMode: 'Online via Single Window',
      });
    }

    // 4. Factory Licence & Plan Sanction - DISH
    // Factories Act Section 2(m)(i) -> >= 10 workers with power, or 2(m)(ii) -> >= 20 without power
    if (
      ctx.industryType !== 'Services' &&
      ((ctx.isPowerDrivenProcess && ctx.totalWorkforce >= 10) ||
        (!ctx.isPowerDrivenProcess && ctx.totalWorkforce >= 20))
    ) {
      const fee = ctx.totalWorkforce > 100 ? 5000 : 2500;
      results.push({
        id: 'fl-06',
        serviceCode: 'FL-06',
        name: 'Factory Licence & Plan Sanction',
        department: 'Labour Department',
        subDepartment: 'DISH (Directorate of Industrial Safety & Health)',
        act: 'Section 6, The Factories Act 1948 & Maharashtra Factories Rules 1963',
        stage: 'Pre-Operation',
        applicability: 'Mandatory',
        triggerReason: `Triggered by: Manufacturing process carried on with the aid of electrical power employing ${ctx.totalWorkforce} direct workers (exceeding Section 2(m)(i) statutory threshold of 10 workers).`,
        slaDays: 45,
        feeEstimate: fee,
        feeFormulaText: `₹${fee.toLocaleString('en-IN')} (Statutory licensing scale for ${ctx.totalWorkforce} workers and ${ctx.contractDemandKva} kVA connected load)`,
        prerequisites: 'Requires Consent to Establish (CTE) & Building Completion / Structural Sanction',
        requiredDocuments: [
          'Form No. 1 (Particulars of Factory & Machinery Layout)',
          'Plant Machinery Layout Blueprints signed by Factory Inspector certified Architect',
          'Process Flowsheet and Hazardous Substance MSDS',
          'List of Directors / Partners with residential proof and DIN/PAN',
        ],
        sequenceOrder: 4,
        category: 'Industrial Safety',
        statutoryDisclaimer: disclaimer,
        authorityContactOffice: `Joint Director, DISH (${ctx.district} Division)`,
        applicationMode: 'Online via Single Window',
      });
    }

    // 5. High Tension (HT) Power Connection Sanction & CEI Inspection
    if (ctx.contractDemandKva >= 100 || ctx.voltageLevel.includes('HT') || ctx.hasSubstationOrTransformer) {
      results.push({
        id: 'ht-09',
        serviceCode: 'HT-09',
        name: 'High Tension (HT) Power Connection & Substation Sanction',
        department: 'Energy Department / MSEDCL',
        subDepartment: 'Maharashtra State Electricity Distribution Co. Ltd. & CEI',
        act: 'Electricity Act 2003 & MERC Supply Code Regulations',
        stage: 'Pre-Establishment',
        applicability: 'Mandatory',
        triggerReason: `Triggered by: Contract power demand of ${ctx.contractDemandKva} kVA exceeding 100 kVA threshold, requiring High Tension (${ctx.voltageLevel}) line tapping and dedicated substation/transformer.`,
        slaDays: 30,
        feeEstimate: 7500,
        feeFormulaText: '₹7,500 (Technical feasibility and load sanction estimate, excluding security deposits)',
        prerequisites: 'Site ownership proof & Electrical single-line schematic diagram',
        requiredDocuments: [
          'Electrical Single Line Diagram (SLD) vetted by Chartered Electrical Engineer',
          'Substation / Transformer Location Yard Layout',
          'Connected Load List with machine-wise kilowatt ratings',
          'Chief Electrical Inspector (CEI) Drawing Approval Request',
        ],
        sequenceOrder: 5,
        category: 'Power & Electrical',
        statutoryDisclaimer: disclaimer,
        authorityContactOffice: `MSEDCL Superintending Engineer (Circle Office, ${ctx.district})`,
        applicationMode: 'Online via Single Window',
      });
    }

    // 6. Water Supply Clearance / Allocation
    if (ctx.waterSource === 'MIDC Piped Supply' || ctx.waterDemandKld >= 10) {
      const isMidc = ctx.waterSource === 'MIDC Piped Supply';
      results.push({
        id: 'bw-02',
        serviceCode: 'BW-02',
        name: isMidc ? 'MIDC Industrial Water Supply Connection Sanction' : 'Surface Water Allocation & Hookup Clearance',
        department: 'Water Resources & Industry Department',
        subDepartment: isMidc ? 'MIDC Water Works Division' : `Irrigation / Water Resources Dept (${ctx.district})`,
        act: 'Maharashtra Industrial Development Act 1961',
        stage: 'Pre-Establishment',
        applicability: 'Mandatory',
        triggerReason: `Triggered by: Industrial daily water requirement of ${ctx.waterDemandKld} KLD connected via ${ctx.waterSource}.`,
        slaDays: 30,
        feeEstimate: 3000,
        feeFormulaText: '₹3,000 (Pipeline branching connection scrutiny and meter calibration fee)',
        prerequisites: 'Plumbing schematic diagram and water balance chart',
        requiredDocuments: [
          'Water Balance Diagram (Raw, Process, Domestic, Cooling & Recycling)',
          'Internal Plumbing Schematic from MIDC Main Distribution Manifold',
          'Allotment letter and approved site plan',
        ],
        sequenceOrder: 6,
        category: 'Water Resources',
        statutoryDisclaimer: disclaimer,
        authorityContactOffice: `Executive Engineer (MIDC Water Division), ${ctx.district}`,
        applicationMode: 'Online via Single Window',
      });
    }

    // 7. Groundwater Extraction NOC (CGWA / GSDA)
    if (ctx.waterSource === 'Groundwater / Borewell') {
      results.push({
        id: 'gw-07',
        serviceCode: 'GW-07',
        name: 'Groundwater Extraction NOC (CGWA / GSDA)',
        department: 'Water Resources / Central Ground Water Authority',
        subDepartment: 'Groundwater Surveys & Development Agency (GSDA) & CGWA',
        act: 'Environment Protection Act 1986 & State Groundwater Regulatory Directives',
        stage: 'Pre-Establishment',
        applicability: 'Mandatory',
        triggerReason: `Triggered by: Sourcing ${ctx.waterDemandKld} KLD industrial water from private on-site borewells / groundwater extraction.`,
        slaDays: 45,
        feeEstimate: 5000,
        feeFormulaText: '₹5,000 (Statutory ground water aquifer impact assessment and NOC scrutiny fee)',
        prerequisites: 'Mandatory installation of digital flow meter and Rainwater Harvesting system',
        requiredDocuments: [
          'Hydrogeological Survey Report by Accredited Geologist',
          'Rainwater Harvesting & Artificial Recharge Plan',
          'Details of Existing & Proposed Borewells with Depth and Yield',
        ],
        sequenceOrder: 7,
        category: 'Water Resources',
        statutoryDisclaimer: disclaimer,
        authorityContactOffice: `GSDA Regional Office & CGWA Nodal Cell (${ctx.district})`,
        applicationMode: 'Online via Single Window',
      });
    }

    // 8. Hazardous Waste Authorization (Form 1) - MPCB
    if (ctx.generatesHazardousWaste || ctx.pollutionCategory === 'Red') {
      results.push({
        id: 'hw-05',
        serviceCode: 'HW-05',
        name: 'Hazardous Waste Management Authorization (Form 1)',
        department: 'Environment Department',
        subDepartment: 'MPCB (Maharashtra Pollution Control Board)',
        act: 'Hazardous and Other Wastes (Management and Transboundary Movement) Rules, 2016',
        stage: 'Pre-Establishment',
        applicability: 'Mandatory',
        triggerReason: `Triggered by: Planned generation and storage of hazardous waste streams (${ctx.hazardousWasteTypes.join(', ')}).`,
        slaDays: 30,
        feeEstimate: 7500,
        feeFormulaText: '₹7,500 (Five-year statutory hazardous waste handling and storage authorization)',
        prerequisites: 'Membership with authorized Common Hazardous Waste Treatment Facility (CHWTSDF)',
        requiredDocuments: [
          'Proof of Valid Membership with CHWTSDF (MEPL / TCWML)',
          'Hazardous Waste Storage Shed Design with Impervious Flooring and Spill Bunds',
          'Emergency Preparedness & Disaster Management Plan',
        ],
        sequenceOrder: 8,
        category: 'Environment',
        statutoryDisclaimer: disclaimer,
        authorityContactOffice: `MPCB Regional Sub-Office (${ctx.district})`,
        applicationMode: 'Online via Single Window',
      });
    }

    // 9. Contract Labour Principal Employer Registration
    if (ctx.hasContractLabour && ctx.contractLabourCount >= 20) {
      results.push({
        id: 'cl-08',
        serviceCode: 'CL-08',
        name: 'Contract Labour Registration (Principal Employer)',
        department: 'Labour Department',
        subDepartment: 'Office of the Registering Officer under CLRA',
        act: 'Section 7, Contract Labour (Regulation and Abolition) Act, 1970',
        stage: 'Pre-Operation',
        applicability: 'Mandatory',
        triggerReason: `Triggered by: Proposed engagement of ${ctx.contractLabourCount} contract workmen (exceeding the 20 workmen threshold under CLRA).`,
        slaDays: 15,
        feeEstimate: 1500,
        feeFormulaText: '₹1,500 (Statutory registration fee based on employment slab 20–50 contract workmen)',
        prerequisites: 'Requires registration before deploying third-party contractor personnel',
        requiredDocuments: [
          'Form I Application for Principal Employer Registration',
          'List of Licensed Contractors with Labour Licence numbers',
          'Welfare Amenities Undertaking (Canteen, Rest Rooms, First Aid)',
        ],
        sequenceOrder: 9,
        category: 'Labour & Welfare',
        statutoryDisclaimer: disclaimer,
        authorityContactOffice: `Assistant Labour Commissioner (ALC), ${ctx.district}`,
        applicationMode: 'Online via Single Window',
      });
    }

    // 10. Inter-State Migrant Workmen Establishment Registration
    if (ctx.hasInterstateMigrantWorkers && ctx.interstateWorkersCount >= 5) {
      results.push({
        id: 'mw-10',
        serviceCode: 'MW-10',
        name: 'Inter-State Migrant Workmen Establishment Registration',
        department: 'Labour Department',
        subDepartment: 'Registering Officer, Maharashtra Labour Welfare Board',
        act: 'Section 6, Inter-State Migrant Workmen (Regulation of Employment & Conditions of Service) Act 1979',
        stage: 'Pre-Operation',
        applicability: 'Conditional',
        triggerReason: `Triggered by: Planned employment of ${ctx.interstateWorkersCount} workers originating from other Indian states (exceeding the statutory threshold of 5 workers).`,
        slaDays: 15,
        feeEstimate: 1000,
        feeFormulaText: '₹1,000 (Standard principal employer registration for inter-state workforce welfare)',
        prerequisites: 'Statutory displacement and travel allowance compliance declarations',
        requiredDocuments: [
          'Particulars of Inter-state workers with native state details',
          'Residential accommodation and drinking water arrangement certificates',
        ],
        sequenceOrder: 10,
        category: 'Labour & Welfare',
        statutoryDisclaimer: disclaimer,
        authorityContactOffice: `Office of Deputy Labour Commissioner, ${ctx.district}`,
        applicationMode: 'Online via Single Window',
      });
    }

    // 11. Standby Diesel Generator (DG Set) CEI Approval
    if (ctx.dgSetCapacityKva > 0) {
      results.push({
        id: 'dg-04',
        serviceCode: 'DG-04',
        name: 'Standby DG Set Installation Permission & CEI Inspection',
        department: 'Energy Department / CEI',
        subDepartment: 'Chief Electrical Inspector (CEI), Energy Department',
        act: 'Central Electricity Authority (Measures Relating to Safety & Electric Supply) Regulations',
        stage: 'Pre-Operation',
        applicability: 'Conditional',
        triggerReason: `Triggered by: Installation of ${ctx.dgSetCapacityKva} kVA standby diesel generator set for auxiliary plant emergency power.`,
        slaDays: 15,
        feeEstimate: 2500,
        feeFormulaText: '₹2,500 (Statutory inspection charge based on kVA rating)',
        prerequisites: 'CPCB acoustic enclosure certificate & electrical earthing test report',
        requiredDocuments: [
          'Acoustic Enclosure Type Approval Certificate (CPCB II Compliant)',
          'Earth Resistance Test Report (Megger Test by Licensed Electrical Contractor)',
          'DG Set Vendor Technical Specification & Single Line Diagram',
        ],
        sequenceOrder: 11,
        category: 'Power & Electrical',
        statutoryDisclaimer: disclaimer,
        authorityContactOffice: `Electrical Inspector, ${ctx.district} Division`,
        applicationMode: 'Online via Single Window',
      });
    }

    // 12. Industrial Steam Boiler Registration & Erection Permission
    if (ctx.hasBoilerOrSteamSystem && ctx.boilerCapacityTph > 0) {
      results.push({
        id: 'bl-09',
        serviceCode: 'BL-09',
        name: 'Steam Boiler Erection Permission & Registration',
        department: 'Labour & Industrial Safety / Steam Boilers',
        subDepartment: 'Directorate of Steam Boilers, Maharashtra',
        act: 'Section 7 & 8, The Indian Boilers Act, 1923 & Maharashtra Boiler Rules',
        stage: 'Pre-Establishment',
        applicability: 'Mandatory',
        triggerReason: `Triggered by: Planned installation of industrial steam generation boiler system with capacity of ${ctx.boilerCapacityTph} TPH.`,
        slaDays: 30,
        feeEstimate: 8000,
        feeFormulaText: '₹8,000 (Hydraulic test and boiler shell drawing approval fee based on heating surface area)',
        prerequisites: 'Fabricator Form II certificate & qualified Boiler Attendant nomination',
        requiredDocuments: [
          'Boiler Maker Certificate & Inspection Test Dossier (Form II / III)',
          'Steam Pipeline Isometric Drawings and Safety Valve Calculations',
          'Appointment Letter of Certified 1st Class Boiler Operation Engineer',
        ],
        sequenceOrder: 12,
        category: 'Boilers & Steam',
        statutoryDisclaimer: disclaimer,
        authorityContactOffice: `Inspector of Steam Boilers, ${ctx.district} Region`,
        applicationMode: 'Online via Single Window',
      });
    }

    // 13. PESO Petroleum / Solvent Storage Licence
    if (ctx.hasSolventOrHazardousStorage && ctx.solventStorageKl > 0) {
      results.push({
        id: 'ps-12',
        serviceCode: 'PS-12',
        name: 'Petroleum / Solvent Bulk Storage Licence (PESO)',
        department: 'Commerce & Industry / PESO',
        subDepartment: 'Petroleum & Explosives Safety Organisation (PESO), West Circle',
        act: 'Petroleum Act 1934 and Petroleum Rules 2002',
        stage: 'Pre-Establishment',
        applicability: 'Mandatory',
        triggerReason: `Triggered by: Storage of flammable solvents/petroleum class products with proposed volume of ${ctx.solventStorageKl} KL.`,
        slaDays: 45,
        feeEstimate: 12000,
        feeFormulaText: '₹12,000 (Central PESO licensing scale for class B/C hydrocarbon tankage)',
        prerequisites: 'PESO approved tank fabrication drawings & cathodic protection test',
        requiredDocuments: [
          'Site & Layout Plan showing safety distances according to Petroleum Rules',
          'Safety Relief Valve & Flame Arrestor Calibration Certificates',
          'Explosive Vapor Dispersion Analysis & On-site Emergency Plan',
        ],
        sequenceOrder: 13,
        category: 'Industrial Safety',
        statutoryDisclaimer: disclaimer,
        authorityContactOffice: 'Joint Chief Controller of Explosives (PESO), Navi Mumbai',
        applicationMode: 'Online via Single Window',
      });
    }

    // 14. Tree Felling / Transit NOC (Conditional for greenfield projects)
    if (ctx.projectNature === 'Greenfield / New Unit' && ctx.totalBuiltUpAreaSqMeters > 2000) {
      results.push({
        id: 'tr-03',
        serviceCode: 'TR-03',
        name: 'Site Clearance & Tree Preservation NOC',
        department: 'Urban Development / Environment',
        subDepartment: `Tree Authority & Urban Local Body (${ctx.district})`,
        act: 'Maharashtra (Urban Areas) Protection and Preservation of Trees Act 1975',
        stage: 'Pre-Establishment',
        applicability: 'Conditional',
        triggerReason: 'Triggered by: Greenfield development on expansive plot requiring site clearance and verification of existing tree canopy.',
        slaDays: 21,
        feeEstimate: 1500,
        feeFormulaText: '₹1,500 (Tree census verification and site inspection fee)',
        prerequisites: 'Site contour plan and compensatory plantation undertaking',
        requiredDocuments: [
          'Site Tree Census Report with Geo-tagged Tree Photographs',
          'Compensatory Tree Plantation Undertaking (5 trees per tree cut, if any)',
        ],
        sequenceOrder: 14,
        category: 'Environment',
        statutoryDisclaimer: disclaimer,
        authorityContactOffice: `Tree Officer, Municipal Corporation / MIDC (${ctx.district})`,
        applicationMode: 'Online via Single Window',
      });
    }

    // Sort results by sequenceOrder
    results.sort((a, b) => a.sequenceOrder - b.sequenceOrder);

    // Compute Metrics
    const mandatoryCount = results.filter((r) => r.applicability === 'Mandatory').length;
    const conditionalCount = results.filter((r) => r.applicability === 'Conditional').length;
    const totalEstimatedFee = results.reduce((acc, curr) => acc + curr.feeEstimate, 0);

    // Critical-path SLA: maximum SLA of mandatory pre-establishment approvals (since they run in parallel/staggered single-window tracks)
    const preEstMandatorySlas = results
      .filter((r) => r.stage === 'Pre-Establishment' && r.applicability === 'Mandatory')
      .map((r) => r.slaDays);
    const criticalPathSla = preEstMandatorySlas.length > 0 ? Math.max(...preEstMandatorySlas) : 30;

    // Generate consolidated document requirements
    const requiredDocuments = this.generateDocumentChecklist(results);

    const summary: DiscoverySummary = {
      projectContext: {
        ...ctx,
        evaluatedAt: new Date().toISOString(),
      },
      results,
      metrics: {
        totalApprovals: results.length,
        mandatoryCount,
        conditionalCount,
        totalEstimatedFee,
        criticalPathSla,
      },
      requiredDocuments,
      evaluatedAt: new Date().toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }),
    };

    // Persist to localStorage
    this.saveDiscoverySummary(summary);

    return summary;
  }

  /**
   * Generates a deduplicated, categorized document checklist from all triggered approvals
   */
  private generateDocumentChecklist(results: ApprovalResult[]): DocumentRequirement[] {
    const docMap = new Map<string, { name: string; category: DocumentRequirement['category']; clearanceIds: string[]; description: string }>();

    results.forEach((r) => {
      r.requiredDocuments.forEach((doc) => {
        let category: DocumentRequirement['category'] = 'Legal & Identity';
        const docLower = doc.toLowerCase();

        if (docLower.includes('layout') || docLower.includes('drawing') || docLower.includes('architect') || docLower.includes('structural')) {
          category = 'Engineering & Layout';
        } else if (docLower.includes('land') || docLower.includes('allotment') || docLower.includes('title') || docLower.includes('site')) {
          category = 'Land & Siting';
        } else if (docLower.includes('etp') || docLower.includes('effluent') || docLower.includes('pollution') || docLower.includes('waste') || docLower.includes('chwtsdf')) {
          category = 'Environmental & Health';
        } else if (docLower.includes('fire') || docLower.includes('hazard') || docLower.includes('safety') || docLower.includes('electrical') || docLower.includes('dg') || docLower.includes('boiler')) {
          category = 'Safety & Utility';
        }

        const existing = docMap.get(doc);
        if (existing) {
          if (!existing.clearanceIds.includes(r.serviceCode)) {
            existing.clearanceIds.push(r.serviceCode);
          }
        } else {
          docMap.set(doc, {
            name: doc,
            category,
            clearanceIds: [r.serviceCode],
            description: `Required for statutory clearance under ${r.name} (${r.subDepartment}).`,
          });
        }
      });
    });

    return Array.from(docMap.entries()).map(([key, val], idx) => ({
      id: `doc-req-${idx + 1}`,
      name: val.name,
      category: val.category,
      mandatoryForClearanceIds: val.clearanceIds,
      description: val.description,
    }));
  }

  public saveDiscoverySummary(summary: DiscoverySummary): void {
    try {
      localStorage.setItem(DISCOVERY_STORAGE_KEY, JSON.stringify(summary));
    } catch (e) {
      console.warn('Failed to save discovery summary to localStorage', e);
    }
  }

  public getDiscoverySummary(): DiscoverySummary | null {
    try {
      const raw = localStorage.getItem(DISCOVERY_STORAGE_KEY);
      if (raw) {
        return JSON.parse(raw);
      }
    } catch (e) {
      console.warn('Failed to parse discovery summary from localStorage', e);
    }
    return null;
  }

  public clearDiscoverySummary(): void {
    try {
      localStorage.removeItem(DISCOVERY_STORAGE_KEY);
    } catch (e) {
      console.warn('Failed to clear discovery summary', e);
    }
  }
}

export const approvalRuleEngine = new ApprovalRuleEngine();
