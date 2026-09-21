import { Enterprise, EnterpriseProject } from './applicant';

export type SectorType =
  | 'Automobile & Auto Components'
  | 'Engineering & Capital Goods'
  | 'Heavy Metallurgical & Forging'
  | 'Agro & Food Processing'
  | 'Chemical & Petrochemical'
  | 'Pharmaceuticals & Bulk Drugs'
  | 'Textiles & Garmenting'
  | 'Electronics & IT Hardware'
  | 'Renewable Energy & Equipment'
  | 'Precision Tooling, Dies & Moulds'
  | 'Other Manufacturing'
  | 'Services / Logistics & Warehousing';

export type ProjectNature =
  | 'Greenfield / New Unit'
  | 'Substantial Expansion / Modernization'
  | 'Diversification into New Products';

export type LandSitingType =
  | 'MIDC Notified Industrial Area'
  | 'Private Industrial Land / Outside MIDC'
  | 'SEZ / Notified Zone';

export type PollutionCategory = 'Red' | 'Orange' | 'Green' | 'White';

export type VoltageGrade =
  | 'LT (Low Tension < 65 kW / 415V)'
  | 'HT (High Tension 11kV / 22kV / 33kV)'
  | 'EHT (Extra High Tension 66kV+)';

export type WaterSourceType =
  | 'MIDC Piped Supply'
  | 'Groundwater / Borewell'
  | 'Surface River / Canal'
  | 'Private Water Tankers';

export interface ProjectParametersContext {
  // Enterprise & Project Identity
  enterpriseId: string;
  enterpriseName: string;
  projectId: string;
  projectName: string;

  // Step 1: Activity & Sector
  sector: SectorType | string;
  subSectorOrActivity: string;
  industryType: 'Manufacturing' | 'Services' | 'Both';
  projectNature: ProjectNature;
  eouStatus: boolean; // Export Oriented Unit
  proposedCapitalInvestmentCr: number;

  // Step 2: Location & Siting
  landType: LandSitingType;
  district: string;
  taluka: string;
  plotOrSurveyNumber: string;
  midcZoneName?: string;
  hasCivilConstruction: boolean;
  totalBuiltUpAreaSqMeters: number;
  buildingHeightMeters: number;
  isHighRise: boolean; // >= 15m
  proximityToWaterBodyEcoZone: boolean;

  // Step 3: Environmental & Pollution
  pollutionCategory: PollutionCategory;
  hasTradeEffluent: boolean;
  effluentDischargeKld: number;
  etpOrCetpHookupProposed: boolean;
  hasAirEmissions: boolean;
  stackHeightMeters: number;
  hasFurnacesOrBoilers: boolean;
  generatesHazardousWaste: boolean;
  hazardousWasteTypes: string[];

  // Step 4: Utilities & Safety
  contractDemandKva: number;
  voltageLevel: VoltageGrade;
  hasSubstationOrTransformer: boolean;
  dgSetCapacityKva: number;
  waterDemandKld: number;
  waterSource: WaterSourceType;
  hasSolventOrHazardousStorage: boolean;
  solventStorageKl: number;
  hasBoilerOrSteamSystem: boolean;
  boilerCapacityTph: number;

  // Step 5: Labour & Workforce
  totalWorkforce: number;
  isPowerDrivenProcess: boolean; // Factories Act 2(m)(i)
  hasContractLabour: boolean;
  contractLabourCount: number;
  hasInterstateMigrantWorkers: boolean;
  interstateWorkersCount: number;
  operatingShifts: 'Single Shift' | 'Two Shifts' | 'Continuous 24x7 Three Shifts';

  // Metadata
  evaluatedAt?: string;
}

export interface DocumentRequirement {
  id: string;
  name: string;
  category: 'Legal & Identity' | 'Land & Siting' | 'Engineering & Layout' | 'Environmental & Health' | 'Safety & Utility';
  mandatoryForClearanceIds: string[];
  description: string;
}

export interface ApprovalResult {
  id: string;
  serviceCode: string;
  name: string;
  department: string;
  subDepartment: string;
  act: string;
  stage: 'Pre-Establishment' | 'Pre-Operation';
  applicability: 'Mandatory' | 'Conditional';
  triggerReason: string;
  slaDays: number;
  feeEstimate: number;
  feeFormulaText: string;
  prerequisites: string;
  requiredDocuments: string[];
  sequenceOrder: number;
  category: string;
  statutoryDisclaimer: string;
  authorityContactOffice: string;
  applicationMode: 'Online via Single Window' | 'Single Application Form (SAF)';
}

export interface DiscoverySummary {
  projectContext: ProjectParametersContext;
  results: ApprovalResult[];
  metrics: {
    totalApprovals: number;
    mandatoryCount: number;
    conditionalCount: number;
    totalEstimatedFee: number;
    criticalPathSla: number;
  };
  requiredDocuments: DocumentRequirement[];
  evaluatedAt: string;
}
