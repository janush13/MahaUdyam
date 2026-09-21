import { Injectable, NotFoundException } from '@nestjs/common';
import { ErrorCodes } from '../../common/constants/error-codes.constant';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { DocumentsService } from '../documents/documents.service';
import { EnterpriseAccess } from '../enterprises/interfaces/enterprise-access.interface';
import { OfficerAccessService } from '../officer/officer-access.service';
import { ScrutinySupport } from '../officer/scrutiny-support.service';
import { DECISION_VIEW_NOTE } from './decision.constants';
import {
  CERTIFICATE_INCLUDE,
  toApplicantCertificateDto,
} from './decision.mappers';
import { ApplicantDecisionViewDto } from './dto/decision-response.dto';

const APPLICANT_ROLE = 'APPLICANT';

const notFound = (what: string) =>
  new NotFoundException({
    code: ErrorCodes.NOT_FOUND,
    message: `${what} not found.`,
  });

/**
 * The read side of the decision and the certificate.
 *
 * APPLICANT (FRD 18.1 "current status ... available documents (receipt,
 * certificate once issued)"; FRD 20.3 a representative can "view
 * inspections/decisions"): access is the Step 5/8 enterprise model unchanged -
 * `EnterpriseAccessGuard` has already resolved the caller's relationship to
 * `:enterpriseId`, and every lookup here is scoped by application AND project
 * AND that enterprise, so another enterprise's, another project's or a
 * nonexistent application is the same 404. What the applicant gets is the
 * outcome, the reason the department recorded, when, which department, and the
 * certificate record and file - and NOTHING internal: not the recommendation,
 * not who recommended or decided, not any observation, not any audit event.
 *
 * OFFICER: the certificate file, through the same application-scoped
 * authorisation as every other officer read (`OfficerAccessService`).
 *
 * The file is served by Step 9's own download path: scanned and usable, bytes
 * re-checked against the stored SHA-256, audited, and the storage key never
 * leaves the server.
 */
@Injectable()
export class DecisionViewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly documents: DocumentsService,
    private readonly officerAccess: OfficerAccessService,
    private readonly support: ScrutinySupport,
  ) {}

  async forApplicant(
    access: EnterpriseAccess,
    projectId: string,
    applicationId: string,
  ): Promise<ApplicantDecisionViewDto> {
    const app = await this.prisma.approvalApplication.findFirst({
      where: {
        id: applicationId,
        projectId,
        project: { enterpriseId: access.enterprise.id },
      },
      select: {
        id: true,
        referenceNumber: true,
        applicantStatus: true,
        decision: {
          select: {
            outcome: true,
            reason: true,
            decidedAt: true,
            department: { select: { id: true, code: true, name: true } },
          },
        },
        certificates: {
          orderBy: { version: 'desc' },
          take: 1,
          include: CERTIFICATE_INCLUDE,
        },
      },
    });
    if (!app) {
      throw notFound('Application');
    }
    const certificate = app.certificates[0];
    return {
      applicationId: app.id,
      referenceNumber: app.referenceNumber,
      applicantStatus: app.applicantStatus,
      decision: app.decision
        ? {
            outcome: app.decision.outcome,
            reason: app.decision.reason,
            decidedAt: app.decision.decidedAt,
            department: { ...app.decision.department },
          }
        : null,
      certificate: certificate ? toApplicantCertificateDto(certificate) : null,
      notice: DECISION_VIEW_NOTE,
    };
  }

  async downloadForApplicant(
    access: EnterpriseAccess,
    projectId: string,
    applicationId: string,
    userId: string,
    ipAddress: string,
  ): Promise<{ data: Buffer; filename: string; mimeType: string }> {
    const certificate = await this.prisma.approvalCertificate.findFirst({
      where: {
        applicationId,
        application: {
          projectId,
          project: { enterpriseId: access.enterprise.id },
        },
      },
      orderBy: { version: 'desc' },
      include: CERTIFICATE_INCLUDE,
    });
    if (!certificate) {
      throw notFound('Certificate');
    }
    return this.documents.downloadDocument(
      certificate.document,
      { userId, roleAtTime: APPLICANT_ROLE },
      {
        enterpriseId: access.enterprise.id,
        projectId,
        applicationId,
        certificateId: certificate.id,
      },
      ipAddress,
    );
  }

  async downloadForOfficer(
    userId: string,
    applicationId: string,
    ipAddress: string,
  ): Promise<{ data: Buffer; filename: string; mimeType: string }> {
    const ctx = await this.officerAccess.resolveApplication(
      userId,
      applicationId,
      'VIEW',
    );
    const certificate = await this.prisma.approvalCertificate.findFirst({
      where: { applicationId: ctx.app.id },
      orderBy: { version: 'desc' },
      include: CERTIFICATE_INCLUDE,
    });
    if (!certificate) {
      throw notFound('Certificate');
    }
    return this.documents.downloadDocument(
      certificate.document,
      { userId, roleAtTime: ctx.actingRole },
      {
        ...this.support.contextOf(ctx),
        certificateId: certificate.id,
      },
      ipAddress,
    );
  }
}
