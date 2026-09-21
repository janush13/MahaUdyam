import { Injectable, NotFoundException } from '@nestjs/common';
import { ErrorCodes } from '../../common/constants/error-codes.constant';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { EnterpriseAccess } from '../enterprises/interfaces/enterprise-access.interface';
import {
  ApplicantInspectionDto,
  ApplicantInspectionsDto,
} from './dto/applicant-inspection.dto';
import {
  inspectionRequired,
  loadInspectionsWithOutcome,
} from './inspection-gate';

type InspectionRow = Awaited<
  ReturnType<typeof loadInspectionsWithOutcome>
>[number];

const notFound = (what: string) =>
  new NotFoundException({
    code: ErrorCodes.NOT_FOUND,
    message: `${what} not found.`,
  });

/** The applicant-safe projection of an inspection (see the DTO). Exported for
 * unit tests. */
export function toApplicantInspection(
  row: InspectionRow,
): ApplicantInspectionDto {
  const report = row.reportSummary;
  return {
    id: row.id,
    status: row.status,
    scheduledAt: row.scheduledAt,
    scheduleConfirmedAt: row.confirmedAt,
    siteAddress: row.siteAddress,
    // Only once a report exists, i.e. only for a completed inspection.
    outcome: report
      ? {
          overallFinding: report.overallFinding,
          correctiveAction: report.correctiveAction,
          recordedAt: report.submittedAt,
        }
      : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * The applicant's READ-ONLY view of the inspections of their own application
 * (FRD 24.1; Blueprint 13.7 "GET /inspections/:id — Applicant(own)"). Access is
 * the Step 5/8 enterprise model unchanged: `EnterpriseAccessGuard` has already
 * resolved the caller's relationship to `:enterpriseId` (owner or authorised
 * representative, project restriction included) and every lookup here is
 * scoped by application AND project AND that enterprise, so another
 * enterprise's, another project's or a nonexistent id is the same 404.
 *
 * It does not depend on who the inspector currently is: a reassignment changes
 * nothing the applicant sees, and a finished inspection stays visible. There
 * is no write here — FRD 24.1's applicant "confirm / request rescheduling
 * where the department's policy permits" has no defined policy to apply and is
 * not implemented.
 */
@Injectable()
export class ApplicantInspectionsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    access: EnterpriseAccess,
    projectId: string,
    applicationId: string,
  ): Promise<ApplicantInspectionsDto> {
    await this.requireApplication(access, projectId, applicationId);
    const [required, rows] = await Promise.all([
      inspectionRequired(this.prisma, applicationId),
      loadInspectionsWithOutcome(this.prisma, applicationId),
    ]);
    return {
      applicationId,
      inspectionRequired: required,
      inspections: rows.map(toApplicantInspection),
    };
  }

  async get(
    access: EnterpriseAccess,
    projectId: string,
    applicationId: string,
    inspectionId: string,
  ): Promise<ApplicantInspectionDto> {
    await this.requireApplication(access, projectId, applicationId);
    const rows = await loadInspectionsWithOutcome(this.prisma, applicationId);
    const row = rows.find((r) => r.id === inspectionId);
    if (!row) {
      throw notFound('Inspection');
    }
    return toApplicantInspection(row);
  }

  private async requireApplication(
    access: EnterpriseAccess,
    projectId: string,
    applicationId: string,
  ): Promise<void> {
    const found = await this.prisma.approvalApplication.count({
      where: {
        id: applicationId,
        projectId,
        project: { enterpriseId: access.enterprise.id },
      },
    });
    if (found === 0) {
      throw notFound('Application');
    }
  }
}
