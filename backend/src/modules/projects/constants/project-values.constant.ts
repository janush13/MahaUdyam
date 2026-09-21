import { EnterpriseAccessLevel } from '../../enterprises/constants/representative-scope.constant';

/**
 * Closed value sets for the project characteristics the rule engine reads
 * (Blueprint §11: e.g. `project_stage in ["greenfield", ...]`). The columns
 * are plain strings in the database (a Step 2 decision, so a department can
 * extend a set without a schema migration), but the API only accepts the
 * values the requirements actually name — free text would silently break rule
 * matching later. Lower-case snake_case, matching the Blueprint's rule JSON.
 *
 * Sources: project stage — FRD §9.2 (explicit); land / construction /
 * production status and size bands — TRD §4.2 input schema [INFERRED]. The
 * statutory thresholds behind the size bands are TO-BE-VALIDATED, so the
 * band is chosen by the applicant, never computed from the investment amount.
 */
export const PROJECT_STAGES = [
  'greenfield',
  'brownfield',
  'expansion',
] as const;
export const LAND_STATUSES = ['owned', 'leased', 'allotted_by_midc'] as const;
export const CONSTRUCTION_STATUSES = [
  'not_started',
  'ongoing',
  'completed',
] as const;
export const PRODUCTION_STATUSES = [
  'pre_production',
  'trial',
  'commercial',
] as const;
export const ENTERPRISE_SIZE_BANDS = [
  'micro',
  'small',
  'medium',
  'large',
] as const;

/** Only a `leased` project carries lease details (FRD §9.2: "conditional
 * fields appear only when relevant"). */
export const LEASED_LAND_STATUS = 'leased';

/**
 * What a representative needs to change project data (create/update).
 *
 * FRD §20.3 describes Prepare & Submit as filling, uploading and submitting
 * *applications*; only Full Delegation is described as broader. Project
 * characteristics are the enterprise's own business data that drive approval
 * discovery, not an application, so writes require FULL — least privilege
 * where the requirements are silent. Reading needs only VIEW_ONLY. Kept as a
 * named constant so relaxing it is a one-line, reviewable change.
 */
export const PROJECT_WRITE_LEVEL: EnterpriseAccessLevel = 'FULL';
export const PROJECT_READ_LEVEL: EnterpriseAccessLevel = 'VIEW_ONLY';
