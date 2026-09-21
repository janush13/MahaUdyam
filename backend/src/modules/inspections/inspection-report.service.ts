import { Injectable, NotFoundException } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { ErrorCodes } from '../../common/constants/error-codes.constant';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { DocumentsService } from '../documents/documents.service';
import { OfficerAccessService } from '../officer/officer-access.service';
import { INSPECTOR_ROLE } from './constants/inspection.constants';
import {
  ChecklistItemViewDto,
  EvidenceDto,
  InspectionReportViewDto,
  ResultDto,
} from './dto/inspection-execution.dto';
import { InspectionAccessService } from './inspection-access.service';
import {
  currentResults,
  supersededResults,
} from './inspection-execution-rules';
import { toEvidenceDto, toResultDto } from './inspection-execution.service';

const notFound = () =>
  new NotFoundException({
    code: ErrorCodes.NOT_FOUND,
    message: 'Inspection not found.',
  });

/**
 * Reading an inspection's checklist, recorded results, evidence and submitted
 * report, and downloading evidence — by the assigned Inspector and by the
 * officer roles that can already see the inspection (FRD 4.3 "view inspection
 * reports"; FRD 24.2 "feeds directly into the application's scrutiny record").
 * Visibility is `InspectionAccessService`'s, so anything outside the caller's
 * scope is the same 404 as a nonexistent id. The applicant has no route here.
 *
 * Results are append-only, so the view shows the CURRENT result per item and,
 * beside it, every earlier answer: nothing recorded is ever hidden or lost.
 */
@Injectable()
export class InspectionReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: InspectionAccessService,
    private readonly officers: OfficerAccessService,
    private readonly documents: DocumentsService,
  ) {}

  async getReport(
    userId: string,
    inspectionId: string,
  ): Promise<InspectionReportViewDto> {
    if (!isUUID(inspectionId)) {
      throw notFound();
    }
    if ((await this.access.resolveView(userId, inspectionId)) === null) {
      throw notFound();
    }
    const inspection = await this.prisma.inspection.findUnique({
      where: { id: inspectionId },
      select: {
        id: true,
        status: true,
        application: { select: { approvalTypeId: true } },
        reportSummary: true,
      },
    });
    if (!inspection) {
      throw notFound();
    }
    const [items, results, evidence] = await Promise.all([
      this.prisma.inspectionChecklist.findMany({
        where: { approvalTypeId: inspection.application.approvalTypeId },
        orderBy: [{ sequenceOrder: 'asc' }, { id: 'asc' }],
      }),
      this.prisma.inspectionReport.findMany({
        where: { inspectionId },
        orderBy: [{ recordedAt: 'asc' }, { id: 'asc' }],
      }),
      this.prisma.inspectionEvidence.findMany({
        where: { inspectionId },
        include: { document: true },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
    ]);

    const evidenceIdByDocument = new Map(
      evidence.map((e) => [e.documentId, e.id]),
    );
    const toResult = (r: (typeof results)[number]): ResultDto =>
      toResultDto(
        r,
        r.evidenceDocumentId
          ? (evidenceIdByDocument.get(r.evidenceDocumentId) ?? null)
          : null,
      );
    const current = currentResults(results);
    const checklist: ChecklistItemViewDto[] = items.map((item) => {
      const now = current.get(item.id);
      return {
        id: item.id,
        text: item.itemText,
        sequenceOrder: item.sequenceOrder,
        current: now ? toResult(now) : null,
        earlier: supersededResults(results, item.id).map(toResult),
      };
    });
    const summary = inspection.reportSummary;
    return {
      inspectionId: inspection.id,
      status: inspection.status,
      checklist,
      evidence: evidence.map((e): EvidenceDto => toEvidenceDto(e, e.document)),
      report: summary
        ? {
            overallFinding: summary.overallFinding,
            summary: summary.summary,
            correctiveAction: summary.correctiveAction,
            submittedAt: summary.submittedAt,
            submittedByUserId: summary.submittedByUserId,
          }
        : null,
    };
  }

  /** Evidence bytes, re-checked against the stored SHA-256 and audited by the
   * document service; found only THROUGH the inspection the caller may see. */
  async downloadEvidence(
    userId: string,
    inspectionId: string,
    evidenceId: string,
    ipAddress: string,
  ): Promise<{ data: Buffer; filename: string; mimeType: string }> {
    if (!isUUID(inspectionId) || !isUUID(evidenceId)) {
      throw notFound();
    }
    const view = await this.access.resolveView(userId, inspectionId);
    if (view === null) {
      throw notFound();
    }
    const evidence = await this.prisma.inspectionEvidence.findFirst({
      where: { id: evidenceId, inspectionId },
      include: {
        document: true,
        inspection: {
          select: {
            applicationId: true,
            application: {
              select: {
                projectId: true,
                approvalType: { select: { departmentId: true } },
                project: { select: { enterpriseId: true } },
              },
            },
          },
        },
      },
    });
    if (!evidence) {
      throw notFound();
    }
    const { application } = evidence.inspection;
    const departmentId = application.approvalType.departmentId;
    let roleAtTime = INSPECTOR_ROLE;
    if (view === 'OFFICER') {
      const grants = await this.officers.grantsFor(userId);
      roleAtTime =
        grants.find((g) => g.departmentId === departmentId)?.role ?? 'OFFICER';
    }
    return this.documents.downloadDocument(
      evidence.document,
      { userId, roleAtTime },
      {
        enterpriseId: application.project.enterpriseId,
        projectId: application.projectId,
        applicationId: evidence.inspection.applicationId,
        departmentId,
        inspectionId,
        evidenceId,
        actingAs: roleAtTime,
      },
      ipAddress,
    );
  }
}
