import {
  CONSTRUCTION_STATUSES,
  ENTERPRISE_SIZE_BANDS,
  LAND_STATUSES,
  PRODUCTION_STATUSES,
  PROJECT_STAGES,
} from '../../projects/constants/project-values.constant';

/**
 * The project characteristics a rule may test — Blueprint §10.2 ("read
 * directly from the projects table ... enterprise type from the linked
 * enterprises row"). A closed catalogue: a rule referencing anything else is
 * rejected when it is published and reported as invalid if it is ever found
 * stored, so a typo can never silently turn into "never matches".
 *
 * Names are snake_case, exactly as in the Blueprint's stored rule JSON.
 *
 *  - `enum`    closed value set, compared exactly (the same vocabulary the
 *              project API enforces, so rules and projects cannot drift)
 *  - `text`    free text (sector code, district, ...): compared trimmed and
 *              case-insensitively, because "Pune" and "pune" are one place
 *  - `number`  supports gt / lt / between
 *  - `boolean`
 */
export type FieldKind = 'boolean' | 'number' | 'enum' | 'text';

export interface FieldDefinition {
  kind: FieldKind;
  /** Allowed values, for `enum` fields. */
  values?: readonly string[];
}

export const DISCOVERY_FIELDS: Readonly<Record<string, FieldDefinition>> = {
  sector_code: { kind: 'text' },
  district: { kind: 'text' },
  taluka: { kind: 'text' },
  industrial_area: { kind: 'text' },
  enterprise_size_band: { kind: 'enum', values: ENTERPRISE_SIZE_BANDS },
  investment_amount: { kind: 'number' },
  employment_count: { kind: 'number' },
  project_stage: { kind: 'enum', values: PROJECT_STAGES },
  land_status: { kind: 'enum', values: LAND_STATUSES },
  construction_status: { kind: 'enum', values: CONSTRUCTION_STATUSES },
  production_status: { kind: 'enum', values: PRODUCTION_STATUSES },
  hazardous_flag: { kind: 'boolean' },
  hazardous_category: { kind: 'text' },
  environmental_category: { kind: 'text' },
  enterprise_type: { kind: 'text' },
};

export function getFieldDefinition(name: string): FieldDefinition | undefined {
  // hasOwn, not `in`/index: "__proto__" or "constructor" must not resolve.
  return Object.prototype.hasOwnProperty.call(DISCOVERY_FIELDS, name)
    ? DISCOVERY_FIELDS[name]
    : undefined;
}

export type DiscoveryValue = string | number | boolean | null;

/** The evaluated characteristics. `null` means "not provided" (optional
 * project fields). */
export type DiscoveryInputs = Record<string, DiscoveryValue>;

interface ProjectLike {
  sectorCode: string;
  district: string;
  taluka: string;
  industrialArea: string | null;
  enterpriseSizeBand: string;
  investmentAmount: { toString(): string } | number;
  employmentCount: number;
  projectStage: string;
  landStatus: string;
  constructionStatus: string;
  productionStatus: string;
  hazardousFlag: boolean;
  hazardousCategory: string | null;
  environmentalCategory: string | null;
}

/** Builds the evaluated inputs from a project and its enterprise. Pure. */
export function buildDiscoveryInputs(
  project: ProjectLike,
  enterprise: { businessType: string },
): DiscoveryInputs {
  return {
    sector_code: project.sectorCode,
    district: project.district,
    taluka: project.taluka,
    industrial_area: project.industrialArea,
    enterprise_size_band: project.enterpriseSizeBand,
    investment_amount: Number(project.investmentAmount),
    employment_count: project.employmentCount,
    project_stage: project.projectStage,
    land_status: project.landStatus,
    construction_status: project.constructionStatus,
    production_status: project.productionStatus,
    hazardous_flag: project.hazardousFlag,
    hazardous_category: project.hazardousCategory,
    environmental_category: project.environmentalCategory,
    enterprise_type: enterprise.businessType,
  };
}
