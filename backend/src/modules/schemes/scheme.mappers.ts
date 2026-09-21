import { Prisma } from '@prisma/client';
import { buildDiscoveryInputs } from '../discovery/engine/discovery-fields';
import {
  RECOMMENDATION_NOTICE,
  EVIDENCE_OPEN_STATUSES,
} from './scheme.constants';
import {
  OfficerSchemeApplicationDto,
  OfficerSchemeApplicationSummaryDto,
  SchemeAdminDto,
  SchemeApplicationDto,
  SchemeApplicationRecommendationDto,
  SchemeCapabilitiesDto,
  SchemeDocumentRequirementDto,
  SchemeDto,
  SchemeRuleDto,
} from './dto/scheme-response.dto';
import { availableActions } from './scheme-state.machine';

// ---- schemes ------------------------------------------------------------------

export const SCHEME_INCLUDE = {
  department: true,
  documentRequirements: { orderBy: [{ name: 'asc' }, { id: 'asc' }] },
} satisfies Prisma.SchemeInclude;

export const SCHEME_ADMIN_INCLUDE = {
  ...SCHEME_INCLUDE,
  rules: { orderBy: { version: 'asc' } },
} satisfies Prisma.SchemeInclude;

export type SchemeRow = Prisma.SchemeGetPayload<{
  include: typeof SCHEME_INCLUDE;
}>;
export type SchemeAdminRow = Prisma.SchemeGetPayload<{
  include: typeof SCHEME_ADMIN_INCLUDE;
}>;

export function toRequirementDto(
  r: SchemeRow['documentRequirements'][number],
): SchemeDocumentRequirementDto {
  return {
    id: r.id,
    name: r.name,
    isMandatory: r.isMandatory,
    description: r.description,
    maxSizeBytes: r.maxSizeBytes,
    allowedMimeTypes: r.allowedMimeTypes ?? [],
  };
}

/** Whether a scheme can still be applied for: no deadline, or not yet passed. */
export function isApplicationOpen(
  deadline: Date | null,
  now: Date = new Date(),
): boolean {
  return deadline === null || now.getTime() <= deadline.getTime();
}

/** A scheme as an applicant / the public reads it. Deliberately no rules, no
 * draft state, no creator: internal configuration stays internal. */
export function toSchemeDto(row: SchemeRow, now: Date = new Date()): SchemeDto {
  return {
    id: row.id,
    name: row.name,
    department: {
      id: row.department.id,
      code: row.department.code,
      name: row.department.name,
    },
    description: row.description,
    benefits: row.benefits,
    benefitType: row.benefitType,
    eligibilityCriteria: row.eligibilityCriteria,
    applicableSectors: row.applicableSectors ?? [],
    applicableDistricts: row.applicableDistricts ?? [],
    applicableEnterpriseSizes: row.applicableEnterpriseSizes ?? [],
    applicationDeadline: row.applicationDeadline,
    applicationOpen: isApplicationOpen(row.applicationDeadline, now),
    sourceReference: row.sourceReference,
    documentRequirements: row.documentRequirements.map(toRequirementDto),
  };
}

export function toRuleDto(r: SchemeAdminRow['rules'][number]): SchemeRuleDto {
  return {
    id: r.id,
    version: r.version,
    effectiveFrom: r.effectiveFrom,
    effectiveTo: r.effectiveTo,
    isActive: r.isActive,
    priority: r.priority,
    sourceReference: r.sourceReference,
    conditions: r.conditions,
    createdByUserId: r.createdByUserId,
    createdAt: r.createdAt,
  };
}

export function toSchemeAdminDto(
  row: SchemeAdminRow,
  capabilities: SchemeCapabilitiesDto,
  now: Date = new Date(),
): SchemeAdminDto {
  return {
    ...toSchemeDto(row, now),
    publishStatus: row.publishStatus,
    isActive: row.isActive,
    version: row.version,
    createdByUserId: row.createdByUserId,
    publishedAt: row.publishedAt,
    publishedByUserId: row.publishedByUserId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    rules: row.rules.map(toRuleDto),
    capabilities,
  };
}

/** A scheme as the audit trail records it (content + control state). */
export function schemeAuditState(row: SchemeRow | SchemeAdminRow) {
  return {
    name: row.name,
    departmentId: row.departmentId,
    description: row.description,
    benefits: row.benefits,
    eligibilityCriteria: row.eligibilityCriteria,
    benefitType: row.benefitType,
    applicableSectors: row.applicableSectors ?? [],
    applicableDistricts: row.applicableDistricts ?? [],
    applicableEnterpriseSizes: row.applicableEnterpriseSizes ?? [],
    applicationDeadline: row.applicationDeadline?.toISOString() ?? null,
    sourceReference: row.sourceReference,
    publishStatus: row.publishStatus,
    isActive: row.isActive,
    version: row.version,
  };
}

// ---- applications ---------------------------------------------------------------

export interface RuleSnapshot {
  id: string;
  version: number;
  priority: number;
  sourceReference: string;
  effectiveFrom: string;
}

/** What is frozen on a scheme application when it is made: the catalogue entry
 * as it read, and what the system suggested for the project (a suggestion, never
 * a determination). */
export interface CatalogueSnapshot {
  scheme: {
    id: string;
    name: string;
    version: number;
    departmentId: string;
    benefits: string;
    benefitType: string | null;
    eligibilityCriteria: string;
    applicationDeadline: string | null;
    sourceReference: string | null;
  };
  recommendation: {
    status: SchemeApplicationRecommendationDto['status'];
    rule: RuleSnapshot | null;
    explanation: string | null;
    engineVersion: string;
    evaluatedAt: string;
  };
}

export const APPLICATION_INCLUDE = {
  scheme: { include: { department: true } },
  project: { include: { enterprise: true } },
  history: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
} satisfies Prisma.SchemeApplicationInclude;

export type ApplicationRow = Prisma.SchemeApplicationGetPayload<{
  include: typeof APPLICATION_INCLUDE;
}>;

function recommendationOf(
  row: Pick<ApplicationRow, 'catalogueSnapshot'>,
): SchemeApplicationRecommendationDto {
  const snapshot = row.catalogueSnapshot as unknown as CatalogueSnapshot;
  return {
    status: snapshot.recommendation.status,
    rule: snapshot.recommendation.rule,
    explanation: snapshot.recommendation.explanation,
    notice: RECOMMENDATION_NOTICE,
  };
}

function schemeOf(row: ApplicationRow) {
  return {
    id: row.scheme.id,
    name: row.scheme.name,
    benefitType: row.scheme.benefitType,
    department: {
      id: row.scheme.department.id,
      code: row.scheme.department.code,
      name: row.scheme.department.name,
    },
  };
}

/** The decision's reason belongs to the APPROVED / REJECTED entry only. */
const showsReason = (toStatus: string) =>
  toStatus === 'APPROVED' || toStatus === 'REJECTED';

/** The applicant's own view (FRD 29.5): reference number, status, timeline and
 * decision. Nobody's identity is disclosed (FRD 24: officer identity is shown
 * only where the department allows, TO BE VALIDATED). */
export function toSchemeApplicationDto(
  row: ApplicationRow,
): SchemeApplicationDto {
  return {
    id: row.id,
    referenceNumber: row.referenceNumber,
    status: row.status,
    scheme: schemeOf(row),
    enterpriseId: row.project.enterpriseId,
    projectId: row.projectId,
    projectReferenceNumber: row.project.referenceNumber,
    submittedAt: row.submittedAt,
    decidedAt: row.decidedAt,
    decisionReason: row.decisionReason,
    disbursedAt: row.disbursedAt,
    recommendation: recommendationOf(row),
    evidenceEditable: EVIDENCE_OPEN_STATUSES.includes(row.status),
    timeline: row.history.map((h) => ({
      fromStatus: h.fromStatus,
      toStatus: h.toStatus,
      at: h.createdAt,
      reason: showsReason(h.toStatus) ? h.reason : null,
    })),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function toOfficerSummaryDto(
  row: ApplicationRow,
): OfficerSchemeApplicationSummaryDto {
  return {
    id: row.id,
    referenceNumber: row.referenceNumber,
    status: row.status,
    scheme: schemeOf(row),
    enterprise: {
      id: row.project.enterprise.id,
      name: row.project.enterprise.name,
      referenceNumber: row.project.enterprise.referenceNumber,
    },
    project: {
      id: row.project.id,
      name: row.project.name,
      referenceNumber: row.project.referenceNumber,
    },
    submittedAt: row.submittedAt,
    updatedAt: row.updatedAt,
  };
}

export function toOfficerApplicationDto(
  row: ApplicationRow,
): OfficerSchemeApplicationDto {
  return {
    ...toOfficerSummaryDto(row),
    decisionReason: row.decisionReason,
    decidedAt: row.decidedAt,
    decidedByUserId: row.decidedByUserId,
    disbursedAt: row.disbursedAt,
    appliedByUserId: row.createdByUserId,
    recommendation: recommendationOf(row),
    projectInputs: buildDiscoveryInputs(row.project, row.project.enterprise),
    availableActions: availableActions(row.status),
    timeline: row.history.map((h) => ({
      fromStatus: h.fromStatus,
      toStatus: h.toStatus,
      at: h.createdAt,
      reason: h.reason,
      actorUserId: h.actorUserId,
      actorRole: h.actorRole,
    })),
  };
}
