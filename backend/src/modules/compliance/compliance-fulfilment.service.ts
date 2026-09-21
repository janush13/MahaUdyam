import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { isUUID } from 'class-validator';
import { ErrorCodes } from '../../common/constants/error-codes.constant';
import { AuditActions } from '../../infrastructure/audit/audit-actions.constant';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ApplicationsService } from '../applications/applications.service';
import {
  DocumentsService,
  StoredUpload,
  UploadedFileLike,
} from '../documents/documents.service';
import { EnterpriseAccess } from '../enterprises/interfaces/enterprise-access.interface';
import { SlaCalendarService } from '../sla/sla-calendar.service';
import { toYmd } from './compliance-dates';
import {
  COMPLIANCE_RECORD_INCLUDE,
  ComplianceObligationDto,
  toObligationDto,
} from './dto/compliance-response.dto';

const APPLICANT_ROLE = 'APPLICANT';

const notFound = () =>
  new NotFoundException({
    code: ErrorCodes.NOT_FOUND,
    message: 'Compliance obligation not found.',
  });

const alreadyFulfilled = () =>
  new ConflictException({
    code: ErrorCodes.COMPLIANCE_ALREADY_FULFILLED,
    message: 'This obligation has already been fulfilled.',
  });

/**
 * Fulfilling an obligation (Blueprint 13.8 `POST /compliance/:id/fulfil`
 * "Submit fulfilment document"; FRD 27.1 "supporting document (if any is
 * required to evidence fulfilment)").
 *
 *  - Authorisation is the applicant's own enterprise access (owner, or a
 *    representative who may prepare and submit) - the same rule as every
 *    application write.
 *  - The document goes through Step 9's ONE pipeline - content validation, hash,
 *    malware scan (fail closed), server-generated storage key
 *    (`DocumentsService.screenAndStore`) - and is recorded exactly as inspection
 *    evidence is: an ordinary document owned by the PROJECT, never in the
 *    application's own document list. Nothing here stores or scans a file.
 *  - Where the obligation (as it was created) requires evidence, no file means
 *    no fulfilment - refused BEFORE anything is scanned or stored; the database
 *    enforces the same rule.
 *  - The requirements define no officer review of a fulfilment, so submitting is
 *    what moves the obligation to FULFILLED (Blueprint 12.6: status FULFILLED
 *    with `fulfilled_document_id`); it is permanent, and whether it was late is
 *    a fact of the two stored dates.
 *  - One conditional UPDATE decides it, so two simultaneous submissions cannot
 *    both fulfil, and a fulfilment cannot race the date job into a wrong state.
 */
@Injectable()
export class ComplianceFulfilmentService {
  private readonly logger = new Logger(ComplianceFulfilmentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly applications: ApplicationsService,
    private readonly documents: DocumentsService,
    private readonly calendar: SlaCalendarService,
  ) {}

  async fulfil(
    access: EnterpriseAccess,
    projectId: string,
    applicationId: string,
    recordId: string,
    actorUserId: string,
    file: UploadedFileLike | undefined,
    ipAddress: string,
    now: Date = new Date(),
  ): Promise<ComplianceObligationDto> {
    const app = await this.applications.findApplication(
      access,
      projectId,
      applicationId,
    );
    if (!isUUID(recordId)) {
      throw notFound();
    }
    const record = await this.prisma.complianceRecord.findFirst({
      where: { id: recordId, applicationId: app.id },
    });
    if (!record) {
      throw notFound();
    }
    if (record.status === 'FULFILLED') {
      throw alreadyFulfilled();
    }
    if (record.evidenceRequired && !file) {
      throw new BadRequestException({
        code: ErrorCodes.COMPLIANCE_EVIDENCE_REQUIRED,
        message:
          'This obligation requires a supporting document: upload it in the "file" form field.',
      });
    }

    const context = {
      enterpriseId: access.enterprise.id,
      projectId: app.projectId,
      applicationId: app.id,
      actingAs: access.relation,
      representativeScope: access.scope ?? null,
    };

    let stored: StoredUpload | undefined;
    if (file) {
      stored = await this.documents.screenAndStore(file, null, {
        app: { id: app.id },
        actorUserId,
        ipAddress,
        roleAtTime: APPLICANT_ROLE,
        context,
      });
    }

    const result = await this.commit(
      record.id,
      app.projectId,
      actorUserId,
      stored,
      now,
    ).catch(async (error: unknown): Promise<never> => {
      if (stored) {
        await this.documents.discardStoredObject(stored.key);
      }
      if (error instanceof HttpException) {
        throw error;
      }
      // Its message can embed the failed statement's values (storage key,
      // checksum, filename): log only what it IS.
      this.logger.error(
        `Recording a compliance fulfilment failed: ${
          error instanceof Prisma.PrismaClientKnownRequestError
            ? `${error.name} ${error.code}`
            : ((error as Error)?.name ?? 'UnknownError')
        }`,
      );
      throw new InternalServerErrorException({
        code: ErrorCodes.INTERNAL_ERROR,
        message:
          'The fulfilment could not be recorded. Please try again later.',
      });
    });

    const { updated, document, previousStatus } = result;
    const dueYmd = updated.dueDate ? toYmd(updated.dueDate) : null;
    const dto = toObligationDto(
      updated,
      this.calendar.settings.utcOffsetMinutes,
    );
    await this.audit.record({
      userId: actorUserId,
      roleAtTime: APPLICANT_ROLE,
      action: AuditActions.COMPLIANCE_FULFILLED,
      entityType: 'ApprovalApplication',
      entityId: app.id,
      beforeState: { status: previousStatus },
      afterState: {
        ...context,
        complianceRecordId: updated.id,
        requirementId: updated.complianceRequirementId,
        requirementVersion: updated.requirementVersion,
        occurrenceNumber: updated.occurrenceNumber,
        status: 'FULFILLED',
        dueDate: dueYmd,
        late: dto.fulfilledLate,
        documentId: document?.id ?? null,
        documentVersion: document?.version ?? null,
      },
      ipAddress,
    });
    if (document && stored) {
      await this.documents.auditEvidenceStored(
        document,
        stored,
        { userId: actorUserId, roleAtTime: APPLICANT_ROLE },
        context,
        ipAddress,
      );
    }
    return dto;
  }

  /** The one transaction: lock the record, re-check, record the document,
   * fulfil - or nothing. */
  private async commit(
    recordId: string,
    projectId: string,
    actorUserId: string,
    stored: StoredUpload | undefined,
    now: Date,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM compliance_records WHERE id = ${recordId}::uuid FOR UPDATE`;
      const fresh = await tx.complianceRecord.findUnique({
        where: { id: recordId },
        select: { status: true, evidenceRequired: true },
      });
      if (!fresh) {
        throw notFound();
      }
      if (fresh.status === 'FULFILLED') {
        throw alreadyFulfilled();
      }
      const document = stored
        ? await this.documents.createEvidenceDocument(
            tx,
            stored,
            projectId,
            actorUserId,
          )
        : null;
      const { count } = await tx.complianceRecord.updateMany({
        where: { id: recordId, status: { not: 'FULFILLED' } },
        data: {
          status: 'FULFILLED',
          fulfilledAt: now,
          fulfilledByUserId: actorUserId,
          fulfilledDocumentId: document?.id ?? null,
        },
      });
      if (count !== 1) {
        throw alreadyFulfilled();
      }
      const updated = await tx.complianceRecord.findUniqueOrThrow({
        where: { id: recordId },
        include: COMPLIANCE_RECORD_INCLUDE,
      });
      return { updated, document, previousStatus: fresh.status };
    });
  }
}
