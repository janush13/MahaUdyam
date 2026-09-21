import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Inspection, Prisma } from '@prisma/client';
import { isUUID } from 'class-validator';
import { ErrorCodes } from '../../common/constants/error-codes.constant';
import { AuditActions } from '../../infrastructure/audit/audit-actions.constant';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  ApplicationDiscoveryContext,
  ruleVersionLabel,
} from '../applications/application-discovery-context';
import { USABLE_STATUSES, isDownloadable } from '../documents/document-queries';
import {
  DocumentRow,
  DocumentsService,
  ScanAuditTarget,
  UploadedFileLike,
} from '../documents/documents.service';
import { ScrutinySupport } from '../officer/scrutiny-support.service';
import {
  CAPTURE_TIME_SKEW_MS,
  INSPECTION_CHANGE_STATES,
  INSPECTOR_ROLE,
} from './constants/inspection.constants';
import {
  AttachEvidenceDto,
  EvidenceDto,
  RecordResultDto,
  RescheduleInspectionDto,
  ResultDto,
  SubmitReportDto,
  SubmitReportResultDto,
} from './dto/inspection-execution.dto';
import { NotificationEventsService } from '../notifications/notification-events.service';
import { InspectionDto } from './dto/inspection-response.dto';
import { InspectionAccessService } from './inspection-access.service';
import {
  correctiveActionRequired,
  isExecutable,
  isFinal,
  missingItems,
} from './inspection-execution-rules';
import { INSPECTION_INCLUDE, toInspectionDto } from './inspection.mapper';

/** Everything an inspector action needs to know about the inspection it acts
 * on, derived from the inspection itself — never from the request. */
export interface InspectorContext {
  userId: string;
  inspectionId: string;
  applicationId: string;
  projectId: string;
  enterpriseId: string;
  departmentId: string;
  approvalTypeId: string;
  ruleVersion: string | null;
}

const notFound = () =>
  new NotFoundException({
    code: ErrorCodes.NOT_FOUND,
    message: 'Inspection not found.',
  });

function invalid(field: string, message: string): BadRequestException {
  return new BadRequestException({
    code: ErrorCodes.VALIDATION_ERROR,
    message: 'Validation failed',
    fields: { [field]: [message] },
  });
}

const notModifiable = () =>
  new ConflictException({
    code: ErrorCodes.INSPECTION_NOT_MODIFIABLE,
    message:
      'This inspection can no longer be acted on (it is finished or cancelled, or scrutiny has finished).',
  });

const notScheduled = () =>
  new ConflictException({
    code: ErrorCodes.INSPECTION_NOT_SCHEDULED,
    message:
      'This inspection has no schedule yet; the department must schedule it first.',
  });

function requireScheduled(inspection: Pick<Inspection, 'status'>): void {
  if (!isExecutable(inspection.status)) {
    throw notScheduled();
  }
}

/** A capture time is a real instant that is not clearly in the future. */
export function parseCaptureTime(value: string, now: Date): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw invalid('capturedAt', 'capturedAt must be a real date and time');
  }
  if (date.getTime() > now.getTime() + CAPTURE_TIME_SKEW_MS) {
    throw invalid('capturedAt', 'capturedAt cannot be in the future');
  }
  return date;
}

export function toResultDto(
  row: {
    id: string;
    checklistItemId: string;
    itemText: string;
    response: string;
    finding: ResultDto['finding'];
    notes: string | null;
    recordedAt: Date;
    recordedByUserId: string;
  },
  evidenceId: string | null,
): ResultDto {
  return {
    id: row.id,
    checklistItemId: row.checklistItemId,
    itemText: row.itemText,
    response: row.response,
    finding: row.finding,
    notes: row.notes,
    evidenceId,
    recordedAt: row.recordedAt,
    recordedByUserId: row.recordedByUserId,
  };
}

export function toEvidenceDto(
  evidence: {
    id: string;
    documentId: string;
    capturedAt: Date | null;
    caption: string | null;
    createdAt: Date;
    uploadedByUserId: string;
  },
  document: Pick<
    DocumentRow,
    | 'version'
    | 'originalFilename'
    | 'mimeType'
    | 'sizeBytes'
    | 'status'
    | 'scannedAt'
  >,
): EvidenceDto {
  return {
    id: evidence.id,
    documentId: evidence.documentId,
    documentVersion: document.version,
    originalFilename: document.originalFilename,
    mimeType: document.mimeType,
    sizeBytes: document.sizeBytes,
    capturedAt: evidence.capturedAt,
    caption: evidence.caption,
    attachedAt: evidence.createdAt,
    attachedByUserId: evidence.uploadedByUserId,
    scan: {
      state: document.scannedAt ? 'CLEAN' : 'NOT_SCANNED',
      scannedAt: document.scannedAt,
    },
    downloadable: isDownloadable(document),
  };
}

/**
 * Inspection execution (FRD 4.4 / 24.2, TRD 10.1, Blueprint 12.5 / 13.7): the
 * ASSIGNED INSPECTOR confirms or reschedules the visit, records checklist
 * results and findings, attaches evidence and submits the report, which
 * completes the inspection.
 *
 * Authorisation reuses the existing layers: JWT + MFA + `RolesGuard`
 * (INSPECTOR) on the route, then `InspectionAccessService.scopes` — the
 * caller must be the inspection's inspector AND hold the Inspector role in the
 * application's department. Every action then re-checks, UNDER THE
 * APPLICATION'S ROW LOCK, that the caller is still the assigned inspector, that
 * scrutiny is still under way and that the inspection is in a state that allows
 * it — so an officer reassigning the inspector, or two competing actions,
 * are serialised and the loser is refused cleanly. There is no route that takes
 * a status; the only transition (SCHEDULED -> COMPLETED) happens inside
 * `submitReport`, and the database refuses it without a report.
 *
 * The application's own state is never changed here.
 */
@Injectable()
export class InspectionExecutionService {
  private readonly logger = new Logger(InspectionExecutionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: InspectionAccessService,
    private readonly support: ScrutinySupport,
    private readonly documents: DocumentsService,
    private readonly notifications: NotificationEventsService,
  ) {}

  // ---- confirm / reschedule ------------------------------------------------

  async confirm(
    userId: string,
    inspectionId: string,
    ipAddress: string,
  ): Promise<InspectionDto> {
    const ctx = await this.resolve(userId, inspectionId);
    const row = await this.run(ctx, async (tx, inspection) => {
      requireScheduled(inspection);
      if (inspection.confirmedAt) {
        throw new ConflictException({
          code: ErrorCodes.INSPECTION_ALREADY_CONFIRMED,
          message: 'You have already confirmed the current schedule.',
        });
      }
      return tx.inspection.update({
        where: { id: inspection.id },
        data: { confirmedAt: new Date(), confirmedByUserId: userId },
        include: INSPECTION_INCLUDE,
      });
    });
    await this.record(
      ctx,
      AuditActions.INSPECTION_CONFIRMED,
      { scheduledAt: row.scheduledAt, confirmedAt: row.confirmedAt },
      ipAddress,
    );
    return toInspectionDto(row, false);
  }

  async reschedule(
    userId: string,
    inspectionId: string,
    dto: RescheduleInspectionDto,
    ipAddress: string,
  ): Promise<InspectionDto> {
    const ctx = await this.resolve(userId, inspectionId);
    const requested = new Date(dto.scheduledAt);
    if (
      Number.isNaN(requested.getTime()) ||
      requested.getTime() <= Date.now()
    ) {
      throw invalid('scheduledAt', 'scheduledAt must be in the future');
    }
    const { row, before } = await this.run(ctx, async (tx, inspection) => {
      requireScheduled(inspection);
      if (
        inspection.scheduledAt &&
        inspection.scheduledAt.getTime() === requested.getTime()
      ) {
        throw invalid(
          'scheduledAt',
          'That is already the scheduled date and time.',
        );
      }
      const updated = await tx.inspection.update({
        where: { id: inspection.id },
        // The confirmation belonged to the old date.
        data: {
          scheduledAt: requested,
          confirmedAt: null,
          confirmedByUserId: null,
        },
        include: INSPECTION_INCLUDE,
      });
      return {
        row: updated,
        before: {
          scheduledAt: inspection.scheduledAt,
          confirmedAt: inspection.confirmedAt,
        },
      };
    });
    await this.record(
      ctx,
      AuditActions.INSPECTION_RESCHEDULED,
      {
        scheduledAt: row.scheduledAt,
        reason: dto.reason,
        rescheduledBy: INSPECTOR_ROLE,
      },
      ipAddress,
      before,
    );
    if (row.scheduledAt) {
      await this.notifications.inspectionRescheduled(
        row.applicationId,
        row.id,
        row.scheduledAt,
        row.updatedAt,
      );
    }
    return toInspectionDto(row, false);
  }

  // ---- checklist results / findings ------------------------------------------

  async recordResult(
    userId: string,
    inspectionId: string,
    dto: RecordResultDto,
    ipAddress: string,
  ): Promise<ResultDto> {
    const ctx = await this.resolve(userId, inspectionId);
    const { created, previousId } = await this.run(
      ctx,
      async (tx, inspection) => {
        requireScheduled(inspection);
        // An item of THIS approval's checklist only.
        const item = await tx.inspectionChecklist.findFirst({
          where: {
            id: dto.checklistItemId,
            approvalTypeId: ctx.approvalTypeId,
          },
        });
        if (!item) {
          throw new UnprocessableEntityException({
            code: ErrorCodes.INVALID_CHECKLIST_ITEM,
            message: 'That is not an item of this inspection’s checklist.',
          });
        }
        let evidenceDocumentId: string | null = null;
        if (dto.evidenceId) {
          // Evidence of THIS inspection, scanned and usable — the same Step 9
          // rules that decide which documents count.
          const evidence = await tx.inspectionEvidence.findFirst({
            where: { id: dto.evidenceId, inspectionId: inspection.id },
            include: {
              document: { select: { status: true, scannedAt: true } },
            },
          });
          if (
            !evidence ||
            evidence.document.scannedAt === null ||
            !USABLE_STATUSES.includes(evidence.document.status)
          ) {
            throw new UnprocessableEntityException({
              code: ErrorCodes.EVIDENCE_NOT_USABLE,
              message:
                'That evidence is not available for this inspection (it must be attached to it, scanned and usable).',
            });
          }
          evidenceDocumentId = evidence.documentId;
        }
        const previous = await tx.inspectionReport.findFirst({
          where: {
            inspectionId: inspection.id,
            checklistItemId: item.id,
          },
          orderBy: [{ recordedAt: 'desc' }, { id: 'desc' }],
          select: { id: true },
        });
        // Append-only: an answer is never edited; a correction is a new row.
        const row = await tx.inspectionReport.create({
          data: {
            inspectionId: inspection.id,
            checklistItemId: item.id,
            itemText: item.itemText,
            response: dto.response,
            finding: dto.finding,
            notes: dto.notes ?? null,
            evidenceDocumentId,
            recordedByUserId: userId,
          },
        });
        return { created: row, previousId: previous?.id ?? null };
      },
    );
    await this.record(
      ctx,
      AuditActions.INSPECTION_RESULT_RECORDED,
      {
        resultId: created.id,
        checklistItemId: created.checklistItemId,
        finding: created.finding,
        evidenceId: dto.evidenceId ?? null,
        supersedesResultId: previousId,
      },
      ipAddress,
    );
    return toResultDto(created, dto.evidenceId ?? null);
  }

  // ---- evidence ---------------------------------------------------------------

  async attachEvidence(
    userId: string,
    inspectionId: string,
    file: UploadedFileLike | undefined,
    dto: AttachEvidenceDto,
    ipAddress: string,
  ): Promise<EvidenceDto> {
    const ctx = await this.resolve(userId, inspectionId);
    const capturedAt = dto.capturedAt
      ? parseCaptureTime(dto.capturedAt, new Date())
      : null;
    // Refuse before scanning and storing a file for an inspection that cannot
    // take it; every condition is re-checked under the lock below.
    await this.precheck(ctx);

    // Step 9's ONE pipeline: validate, hash, malware-scan (fail closed), store.
    const stored = await this.documents.screenAndStore(
      file,
      null,
      this.scanTarget(ctx, ipAddress),
    );

    let outcome: { document: DocumentRow; evidenceId: string };
    let evidenceRow: Awaited<
      ReturnType<Prisma.TransactionClient['inspectionEvidence']['create']>
    >;
    try {
      const done = await this.run(ctx, async (tx, inspection) => {
        requireScheduled(inspection);
        const document = await this.documents.createEvidenceDocument(
          tx,
          stored,
          ctx.projectId,
          userId,
        );
        const evidence = await tx.inspectionEvidence.create({
          data: {
            inspectionId: inspection.id,
            documentId: document.id,
            uploadedByUserId: userId,
            capturedAt,
            caption: dto.caption ?? null,
          },
        });
        return { document, evidence };
      });
      outcome = { document: done.document, evidenceId: done.evidence.id };
      evidenceRow = done.evidence;
    } catch (error) {
      await this.documents.discardStoredObject(stored.key);
      if (error instanceof HttpException) {
        throw error;
      }
      // Its message can embed the failed statement's values (storage key,
      // checksum, filename): log only what it IS.
      this.logger.error(
        `Recording inspection evidence failed: ${
          error instanceof Prisma.PrismaClientKnownRequestError
            ? `${error.name} ${error.code}`
            : ((error as Error)?.name ?? 'UnknownError')
        }`,
      );
      throw new InternalServerErrorException({
        code: ErrorCodes.INTERNAL_ERROR,
        message: 'The evidence could not be recorded. Please try again later.',
      });
    }

    await this.documents.auditEvidenceStored(
      outcome.document,
      stored,
      { userId, roleAtTime: INSPECTOR_ROLE },
      this.auditContext(ctx),
      ipAddress,
    );
    await this.record(
      ctx,
      AuditActions.INSPECTION_EVIDENCE_ATTACHED,
      {
        evidenceId: outcome.evidenceId,
        documentId: outcome.document.id,
        documentVersion: outcome.document.version,
        capturedAt,
      },
      ipAddress,
    );
    return toEvidenceDto(evidenceRow, outcome.document);
  }

  // ---- report + completion ------------------------------------------------------

  async submitReport(
    userId: string,
    inspectionId: string,
    dto: SubmitReportDto,
    ipAddress: string,
  ): Promise<SubmitReportResultDto> {
    const ctx = await this.resolve(userId, inspectionId);
    const done = await this.run(ctx, async (tx, inspection) => {
      requireScheduled(inspection);
      if (
        correctiveActionRequired(dto.overallFinding) &&
        !dto.correctiveAction
      ) {
        throw invalid(
          'correctiveAction',
          'correctiveAction is required when the overall finding is NON_COMPLIANT',
        );
      }
      const [items, results, evidenceCount] = await Promise.all([
        tx.inspectionChecklist.findMany({
          where: { approvalTypeId: ctx.approvalTypeId },
          select: { id: true, itemText: true },
          orderBy: { sequenceOrder: 'asc' },
        }),
        tx.inspectionReport.findMany({
          where: { inspectionId: inspection.id },
          select: { id: true, checklistItemId: true, recordedAt: true },
        }),
        tx.inspectionEvidence.count({ where: { inspectionId: inspection.id } }),
      ]);
      const missing = missingItems(
        items.map((i) => i.id),
        results,
      );
      if (missing.length > 0) {
        throw new UnprocessableEntityException({
          code: ErrorCodes.CHECKLIST_INCOMPLETE,
          message:
            'Every checklist item needs a recorded result before the report can be submitted.',
          fields: {
            checklist: items
              .filter((i) => missing.includes(i.id))
              .map((i) => `No result recorded for: ${i.itemText}`),
          },
        });
      }
      // One transaction: the report, then the only status change of this step.
      // The database refuses COMPLETED without the report.
      const report = await tx.inspectionReportSummary.create({
        data: {
          inspectionId: inspection.id,
          overallFinding: dto.overallFinding,
          summary: dto.summary,
          correctiveAction: dto.correctiveAction ?? null,
          submittedByUserId: userId,
        },
      });
      const completed = await tx.inspection.update({
        where: { id: inspection.id },
        data: { status: 'COMPLETED' },
        include: INSPECTION_INCLUDE,
      });
      return { report, completed, resultCount: results.length, evidenceCount };
    });

    await this.record(
      ctx,
      AuditActions.INSPECTION_REPORT_SUBMITTED,
      {
        reportId: done.report.id,
        overallFinding: done.report.overallFinding,
        checklistResults: done.resultCount,
        evidenceCount: done.evidenceCount,
        correctiveActionRecorded: done.report.correctiveAction !== null,
      },
      ipAddress,
    );
    await this.record(
      ctx,
      AuditActions.INSPECTION_COMPLETED,
      { status: 'COMPLETED' },
      ipAddress,
      { status: 'SCHEDULED' },
    );
    return {
      inspection: toInspectionDto(done.completed, false),
      report: {
        overallFinding: done.report.overallFinding,
        summary: done.report.summary,
        correctiveAction: done.report.correctiveAction,
        submittedAt: done.report.submittedAt,
        submittedByUserId: done.report.submittedByUserId,
      },
    };
  }

  // ---- shared plumbing ---------------------------------------------------------

  /**
   * The inspection, if — and only if — the caller is its assigned Inspector in
   * a department where they hold the role. Any other caller (another
   * inspector, another department, an officer, a stranger) gets the same 404
   * as for an id that does not exist.
   */
  private async resolve(
    userId: string,
    inspectionId: string,
  ): Promise<InspectorContext> {
    if (!isUUID(inspectionId)) {
      throw notFound();
    }
    const scopes = await this.access.scopes(userId);
    const row = await this.prisma.inspection.findFirst({
      where: { AND: [{ id: inspectionId }, scopes.inspector] },
      select: {
        id: true,
        applicationId: true,
        application: {
          select: {
            projectId: true,
            approvalTypeId: true,
            discoveryContext: true,
            approvalType: { select: { departmentId: true } },
            project: { select: { enterpriseId: true } },
          },
        },
      },
    });
    if (!row) {
      throw notFound();
    }
    const { application } = row;
    return {
      userId,
      inspectionId: row.id,
      applicationId: row.applicationId,
      projectId: application.projectId,
      enterpriseId: application.project.enterpriseId,
      departmentId: application.approvalType.departmentId,
      approvalTypeId: application.approvalTypeId,
      ruleVersion: ruleVersionLabel(
        application.discoveryContext as unknown as ApplicationDiscoveryContext | null,
      ),
    };
  }

  /**
   * Runs `fn` in one transaction under the application's row lock, having
   * re-checked what was decided before the lock: the caller is STILL the
   * assigned inspector (a reassignment mid-request revokes access), scrutiny is
   * still under way, and the inspection is not finished or cancelled.
   */
  private run<T>(
    ctx: InspectorContext,
    fn: (tx: Prisma.TransactionClient, inspection: Inspection) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      const locked = await this.support.lock(tx, ctx.applicationId);
      if (!locked) {
        throw notFound();
      }
      const inspection = await tx.inspection.findUnique({
        where: { id: ctx.inspectionId },
      });
      if (!inspection || inspection.inspectorId !== ctx.userId) {
        throw notFound();
      }
      if (
        isFinal(inspection.status) ||
        !INSPECTION_CHANGE_STATES.includes(locked.internalState)
      ) {
        throw notModifiable();
      }
      return fn(tx, inspection);
    });
  }

  /** The same checks as `run`, without the lock — to refuse early. */
  private async precheck(ctx: InspectorContext): Promise<void> {
    const row = await this.prisma.inspection.findUnique({
      where: { id: ctx.inspectionId },
      select: {
        status: true,
        inspectorId: true,
        application: { select: { internalState: true } },
      },
    });
    if (!row || row.inspectorId !== ctx.userId) {
      throw notFound();
    }
    if (
      isFinal(row.status) ||
      !INSPECTION_CHANGE_STATES.includes(row.application.internalState)
    ) {
      throw notModifiable();
    }
    requireScheduled(row);
  }

  private auditContext(ctx: InspectorContext): Record<string, unknown> {
    return {
      enterpriseId: ctx.enterpriseId,
      projectId: ctx.projectId,
      applicationId: ctx.applicationId,
      departmentId: ctx.departmentId,
      inspectionId: ctx.inspectionId,
      actingAs: INSPECTOR_ROLE,
    };
  }

  private scanTarget(
    ctx: InspectorContext,
    ipAddress: string,
  ): ScanAuditTarget {
    return {
      app: { id: ctx.applicationId },
      actorUserId: ctx.userId,
      ipAddress,
      roleAtTime: INSPECTOR_ROLE,
      context: this.auditContext(ctx),
    };
  }

  /** An inspection event, hung on the application so the application's
   * history shows it, with the inspector's full context and the rule version. */
  private record(
    ctx: InspectorContext,
    action: (typeof AuditActions)[keyof typeof AuditActions],
    details: Record<string, unknown>,
    ipAddress: string,
    beforeState?: Record<string, unknown>,
  ): Promise<void> {
    return this.audit.record({
      userId: ctx.userId,
      roleAtTime: INSPECTOR_ROLE,
      action,
      entityType: 'ApprovalApplication',
      entityId: ctx.applicationId,
      beforeState,
      afterState: { ...this.auditContext(ctx), ...details },
      ipAddress,
      ruleVersionUsed: ctx.ruleVersion,
    });
  }
}
