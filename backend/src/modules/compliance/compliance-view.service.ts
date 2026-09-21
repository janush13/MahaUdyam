import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { isUUID } from 'class-validator';
import { ErrorCodes } from '../../common/constants/error-codes.constant';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ApplicationsService } from '../applications/applications.service';
import { DocumentsService } from '../documents/documents.service';
import { EnterpriseAccess } from '../enterprises/interfaces/enterprise-access.interface';
import { OfficerAccessService } from '../officer/officer-access.service';
import { SlaCalendarService } from '../sla/sla-calendar.service';
import {
  COMPLIANCE_DEFAULT_PAGE_SIZE,
  ListComplianceQueryDto,
} from './dto/compliance-request.dto';
import {
  COMPLIANCE_RECORD_INCLUDE,
  ApplicationComplianceDto,
  ComplianceObligationDto,
  ComplianceRecordRow,
  EnterpriseComplianceListDto,
  NO_OBLIGATIONS_NOTE,
  OfficerApplicationComplianceDto,
  OfficerComplianceListDto,
  toObligationDto,
} from './dto/compliance-response.dto';

const notFound = (what = 'Compliance obligation') =>
  new NotFoundException({
    code: ErrorCodes.NOT_FOUND,
    message: `${what} not found.`,
  });

/** Oldest due date first, obligations with no date last, then the order they
 * were created in - a stable order for both audiences. */
const ORDER = [
  { dueDate: { sort: 'asc', nulls: 'last' } },
  { createdAt: 'asc' },
  { id: 'asc' },
] as Prisma.ComplianceRecordOrderByWithRelationInput[];

/**
 * Reading the compliance calendar (FRD 27.1; TRD 14 "per-applicant and
 * per-department views"; TRD API `/applications/{id}/compliance`
 * "Applicant/Officer"). Read-only, and every figure is a stored snapshot - never
 * today's configuration.
 *
 *  - The applicant reads through the enterprise access every applicant route
 *    uses (owner, or a live representative; a project-restricted representative
 *    only their projects): another enterprise's obligation is the same 404 as a
 *    nonexistent one.
 *  - Officers read through the department / assignment visibility of the
 *    officer workspace (`OfficerAccessService`): a Scrutiny Officer the
 *    applications assigned to them, a Department Administrator their department,
 *    an Approving Authority those awaiting a decision. Nothing new is invented
 *    about who may see what.
 */
@Injectable()
export class ComplianceViewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly officers: OfficerAccessService,
    private readonly applications: ApplicationsService,
    private readonly documents: DocumentsService,
    private readonly calendar: SlaCalendarService,
  ) {}

  private get offset(): number {
    return this.calendar.settings.utcOffsetMinutes;
  }

  // ---- applicant ------------------------------------------------------------

  async forApplication(
    access: EnterpriseAccess,
    projectId: string,
    applicationId: string,
  ): Promise<ApplicationComplianceDto> {
    const app = await this.applications.findApplication(
      access,
      projectId,
      applicationId,
    );
    const rows = await this.prisma.complianceRecord.findMany({
      where: { applicationId: app.id },
      include: COMPLIANCE_RECORD_INCLUDE,
      orderBy: ORDER,
    });
    return {
      applicationId: app.id,
      items: rows.map((r) => toObligationDto(r, this.offset)),
      note: rows.length === 0 ? NO_OBLIGATIONS_NOTE : null,
    };
  }

  async forEnterprise(
    access: EnterpriseAccess,
    query: ListComplianceQueryDto,
  ): Promise<EnterpriseComplianceListDto> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? COMPLIANCE_DEFAULT_PAGE_SIZE;
    const restricted = access.scopedProjectIds.length > 0;
    const where: Prisma.ComplianceRecordWhereInput = {
      application: {
        project: { enterpriseId: access.enterprise.id },
        ...(restricted ? { projectId: { in: access.scopedProjectIds } } : {}),
      },
      ...(query.status ? { status: query.status } : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.complianceRecord.count({ where }),
      this.prisma.complianceRecord.findMany({
        where,
        include: COMPLIANCE_RECORD_INCLUDE,
        orderBy: ORDER,
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return {
      items: rows.map((r) => toObligationDto(r, this.offset)),
      page,
      pageSize,
      total,
    };
  }

  async get(
    access: EnterpriseAccess,
    projectId: string,
    applicationId: string,
    recordId: string,
  ): Promise<ComplianceObligationDto> {
    const { row } = await this.applicantRecord(
      access,
      projectId,
      applicationId,
      recordId,
    );
    return toObligationDto(row, this.offset);
  }

  async evidenceForApplicant(
    access: EnterpriseAccess,
    projectId: string,
    applicationId: string,
    recordId: string,
    actorUserId: string,
    ipAddress: string,
  ) {
    const { app } = await this.applicantRecord(
      access,
      projectId,
      applicationId,
      recordId,
    );
    return this.serveEvidence(
      recordId,
      app.id,
      { userId: actorUserId, roleAtTime: 'APPLICANT' },
      {
        enterpriseId: access.enterprise.id,
        projectId: app.projectId,
        applicationId: app.id,
        actingAs: access.relation,
        complianceRecordId: recordId,
      },
      ipAddress,
    );
  }

  // ---- officer ----------------------------------------------------------------

  /** The department dashboard (TRD 14): the obligations of exactly the
   * applications the caller's role can already see, most urgent first. */
  async listForOfficer(
    userId: string,
    query: ListComplianceQueryDto,
  ): Promise<OfficerComplianceListDto> {
    const grants = await this.officers.grantsFor(userId);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? COMPLIANCE_DEFAULT_PAGE_SIZE;
    const where: Prisma.ComplianceRecordWhereInput = {
      application: this.officers.visibilityWhere(userId, grants),
      ...(query.status ? { status: query.status } : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.complianceRecord.count({ where }),
      this.prisma.complianceRecord.findMany({
        where,
        include: {
          ...COMPLIANCE_RECORD_INCLUDE,
          application: {
            select: {
              referenceNumber: true,
              approvalType: { select: { name: true, departmentId: true } },
            },
          },
        },
        orderBy: ORDER,
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return {
      items: rows.map((r) => ({
        ...toObligationDto(r, this.offset),
        applicationReference: r.application.referenceNumber as string,
        approvalType: r.application.approvalType.name,
        departmentId: r.application.approvalType.departmentId,
      })),
      page,
      pageSize,
      total,
    };
  }

  async forOfficerApplication(
    userId: string,
    applicationId: string,
  ): Promise<OfficerApplicationComplianceDto> {
    const ctx = await this.officers.resolveApplication(
      userId,
      applicationId,
      'VIEW',
    );
    const rows = await this.prisma.complianceRecord.findMany({
      where: { applicationId: ctx.app.id },
      include: COMPLIANCE_RECORD_INCLUDE,
      orderBy: ORDER,
    });
    return {
      applicationId: ctx.app.id,
      applicationReference: ctx.app.referenceNumber as string,
      items: rows.map((r) => toObligationDto(r, this.offset)),
      note: rows.length === 0 ? NO_OBLIGATIONS_NOTE : null,
    };
  }

  async evidenceForOfficer(
    userId: string,
    applicationId: string,
    recordId: string,
    ipAddress: string,
  ) {
    const ctx = await this.officers.resolveApplication(
      userId,
      applicationId,
      'VIEW',
    );
    return this.serveEvidence(
      recordId,
      ctx.app.id,
      { userId, roleAtTime: ctx.actingRole },
      {
        applicationId: ctx.app.id,
        departmentId: ctx.departmentId,
        actingRole: ctx.actingRole,
        complianceRecordId: recordId,
      },
      ipAddress,
    );
  }

  // ---- internals ----------------------------------------------------------------

  private async applicantRecord(
    access: EnterpriseAccess,
    projectId: string,
    applicationId: string,
    recordId: string,
  ): Promise<{
    app: Awaited<ReturnType<ApplicationsService['findApplication']>>;
    row: ComplianceRecordRow;
  }> {
    const app = await this.applications.findApplication(
      access,
      projectId,
      applicationId,
    );
    if (!isUUID(recordId)) {
      throw notFound();
    }
    const row = await this.prisma.complianceRecord.findFirst({
      where: { id: recordId, applicationId: app.id },
      include: COMPLIANCE_RECORD_INCLUDE,
    });
    if (!row) {
      throw notFound();
    }
    return { app, row };
  }

  /** Serves the evidence of one obligation through Step 9's ONE download path
   * (scanned and not rejected, integrity-checked against the stored SHA-256,
   * audited) - never a storage path. The caller has already been authorised for
   * the application. */
  private async serveEvidence(
    recordId: string,
    applicationId: string,
    actor: { userId: string; roleAtTime: string },
    auditContext: Record<string, unknown>,
    ipAddress: string,
  ) {
    if (!isUUID(recordId)) {
      throw notFound();
    }
    const record = await this.prisma.complianceRecord.findFirst({
      where: { id: recordId, applicationId },
      include: { fulfilledDocument: true },
    });
    if (!record) {
      throw notFound();
    }
    if (!record.fulfilledDocument) {
      throw notFound('Evidence');
    }
    return this.documents.downloadDocument(
      record.fulfilledDocument,
      actor,
      auditContext,
      ipAddress,
    );
  }
}
