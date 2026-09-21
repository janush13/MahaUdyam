import { Prisma } from '@prisma/client';
import { isDownloadable } from '../documents/document-queries';
import {
  ApplicantCertificateDto,
  DecisionDto,
  OfficerCertificateDto,
} from './dto/decision-response.dto';

/** What a decision is read with: the recommendation it answers (only to say
 * what that advised). */
export const DECISION_INCLUDE = {
  recommendation: { select: { outcome: true } },
} satisfies Prisma.ApprovalDecisionInclude;

export type DecisionRow = Prisma.ApprovalDecisionGetPayload<{
  include: typeof DECISION_INCLUDE;
}>;

/** What a certificate is read with: its file, its department, and the
 * application's project (for the enterprise / project references). */
export const CERTIFICATE_INCLUDE = {
  document: true,
  department: { select: { id: true, code: true, name: true } },
  application: {
    select: { projectId: true, project: { select: { enterpriseId: true } } },
  },
} satisfies Prisma.ApprovalCertificateInclude;

export type CertificateRow = Prisma.ApprovalCertificateGetPayload<{
  include: typeof CERTIFICATE_INCLUDE;
}>;

export function toDecisionDto(row: DecisionRow): DecisionDto {
  return {
    id: row.id,
    applicationId: row.applicationId,
    outcome: row.outcome,
    reason: row.reason,
    decidedByUserId: row.decidedByUserId,
    decidedAt: row.decidedAt,
    recommendationId: row.recommendationId,
    recommendedOutcome: row.recommendation.outcome,
    differsFromRecommendation: row.recommendation.outcome !== row.outcome,
    isStatutoryDecision: true,
  };
}

/** The applicant-safe projection: the record and the file, never who issued it
 * or which decision row it hangs on. */
export function toApplicantCertificateDto(
  row: CertificateRow,
): ApplicantCertificateDto {
  return {
    id: row.id,
    applicationId: row.applicationId,
    enterpriseId: row.application.project.enterpriseId,
    projectId: row.application.projectId,
    department: { ...row.department },
    version: row.version,
    certificateNumber: row.certificateNumber,
    issuedAt: row.issuedAt,
    file: {
      filename: row.document.originalFilename,
      mimeType: row.document.mimeType,
      sizeBytes: row.document.sizeBytes,
      downloadable: isDownloadable(row.document),
    },
  };
}

export function toOfficerCertificateDto(
  row: CertificateRow,
): OfficerCertificateDto {
  return {
    ...toApplicantCertificateDto(row),
    decisionId: row.decisionId,
    issuedByUserId: row.issuedByUserId,
  };
}
