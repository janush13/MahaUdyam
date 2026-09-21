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
import { Document, Prisma } from '@prisma/client';
import { ErrorCodes } from '../../common/constants/error-codes.constant';
import { AuditActions } from '../../infrastructure/audit/audit-actions.constant';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CURRENT_VERSION, isDownloadable } from '../documents/document-queries';
import {
  DocumentsService,
  UploadedFileLike,
  parseExpiryDate,
} from '../documents/documents.service';
import {
  ReplaceDocumentDto,
  UploadDocumentDto,
} from '../documents/dto/upload-document.dto';
import { ReviewDocumentDto } from '../officer/dto/officer-request.dto';
import { EnterpriseAccess } from '../enterprises/interfaces/enterprise-access.interface';
import {
  SchemeDocumentDto,
  SchemeEvidenceRequirementStatusDto,
} from './dto/scheme-response.dto';
import { satisfiedSchemeRequirementIds } from './scheme-evidence-queries';
import { SchemeApplicationsService } from './scheme-applications.service';
import { SchemeOfficerService } from './scheme-officer.service';
import {
  EVIDENCE_OPEN_STATUSES,
  EVIDENCE_REVIEW_STATUSES,
  SCHEME_OFFICER_ROLE,
} from './scheme.constants';
import { toRequirementDto } from './scheme.mappers';

const APPLICANT_ROLE = 'APPLICANT';

const DOCUMENT_INCLUDE = {
  replacements: { select: { id: true } },
  /** The latest officer review (verified / rejected), if any. */
  verifications: { orderBy: { verifiedAt: 'desc' }, take: 1 },
  schemeApplicationDocuments: {
    select: {
      schemeApplicationId: true,
      schemeDocumentRequirement: {
        select: { id: true, name: true, isMandatory: true },
      },
    },
  },
} satisfies Prisma.DocumentInclude;

type DocumentRow = Prisma.DocumentGetPayload<{
  include: typeof DOCUMENT_INCLUDE;
}>;

type Audience = 'APPLICANT' | 'OFFICER';

export function toSchemeDocumentDto(
  row: DocumentRow,
  schemeApplicationId: string,
  audience: Audience = 'APPLICANT',
): SchemeDocumentDto {
  const review = row.verifications[0];
  const link = row.schemeApplicationDocuments.find(
    (l) => l.schemeApplicationId === schemeApplicationId,
  );
  return {
    id: row.id,
    schemeApplicationId,
    lineageId: row.lineageId,
    version: row.version,
    isCurrent: row.replacements.length === 0,
    previousVersionId: row.replacedDocumentId,
    requirement: link?.schemeDocumentRequirement ?? null,
    originalFilename: row.originalFilename,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    status: row.status,
    expiryDate: row.expiryDate
      ? row.expiryDate.toISOString().slice(0, 10)
      : null,
    scan: {
      state: row.scannedAt ? 'CLEAN' : 'NOT_SCANNED',
      scannedAt: row.scannedAt,
      scanner: row.scannerName,
    },
    downloadable: isDownloadable(row),
    review: review
      ? {
          verdict: review.verdict,
          reviewedAt: review.verifiedAt,
          // A rejection's reason is for the applicant to act on; a
          // verification's notes are internal.
          reason: review.verdict === 'REJECTED' ? review.notes : null,
          ...(audience === 'OFFICER'
            ? { notes: review.notes, reviewedByUserId: review.verifiedByUserId }
            : {}),
        }
      : null,
    uploadedByUserId: row.uploadedBy,
    uploadedAt: row.createdAt,
  };
}

const notFound = (what: string) =>
  new NotFoundException({
    code: ErrorCodes.NOT_FOUND,
    message: `${what} not found.`,
  });

const isUniqueViolation = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  error.code === 'P2002';

const evidenceLocked = () =>
  new ConflictException({
    code: ErrorCodes.SCHEME_EVIDENCE_LOCKED,
    message:
      'A decision has been recorded on this application, so its evidence can no longer be changed.',
  });

const notCurrent = () =>
  new ConflictException({
    code: ErrorCodes.DOCUMENT_NOT_CURRENT,
    message:
      'This version has already been replaced. Only the current version of a document can be replaced.',
  });

/** A real calendar date (YYYY-MM-DD) or null. */
function parseDate(value: string | undefined, field: string): Date | null {
  if (value === undefined) {
    return null;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    throw new BadRequestException({
      code: ErrorCodes.VALIDATION_ERROR,
      message: 'Validation failed',
      fields: { [field]: [`${field} must be a real calendar date`] },
    });
  }
  return parsed;
}

/**
 * Supporting evidence for a scheme application (FRD 29.2 "required documents",
 * FRD 34 "verify supporting documents"). REUSES the platform's one document
 * pipeline (`DocumentsService`): validated by real content, hashed, malware-scanned
 * (fail closed), stored under a server-generated key that is never overwritten,
 * versioned non-destructively, downloaded only after the scan and an integrity
 * check, and audited. This service adds only what is scheme-specific: which
 * scheme requirement a file answers, and when evidence may change.
 *
 * OWNERSHIP. Every route derives the chain from the URL - authorised enterprise ->
 * project -> scheme application, each looked up INSIDE the previous one - and only
 * then touches a document, always THROUGH that application. Owner, uploader,
 * status and scan state are set by the server; a document id of any other
 * application is indistinguishable from a nonexistent one.
 *
 * WHEN. The applicant can add or replace evidence while the application is
 * APPLIED or UNDER_REVIEW; a decision closes it. The Scheme Officer reviews
 * (verifies / rejects) a document only while UNDER_REVIEW. There is no delete:
 * documents are part of the historical record.
 */
@Injectable()
export class SchemeEvidenceService {
  private readonly logger = new Logger(SchemeEvidenceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly documents: DocumentsService,
    private readonly applications: SchemeApplicationsService,
    private readonly officers: SchemeOfficerService,
  ) {}

  // ---- applicant ------------------------------------------------------------------

  async upload(
    access: EnterpriseAccess,
    projectId: string,
    applicationId: string,
    actorUserId: string,
    file: UploadedFileLike | undefined,
    dto: UploadDocumentDto,
    ipAddress: string,
  ): Promise<SchemeDocumentDto> {
    const app = await this.applications.findApplication(
      access,
      projectId,
      applicationId,
    );
    this.assertOpen(app.status);
    const expiryDate = parseExpiryDate(dto.expiryDate);

    let requirement: {
      id: string;
      maxSizeBytes: number | null;
      allowedMimeTypes: string[];
    } | null = null;
    if (dto.documentRequirementId) {
      // Must belong to THIS application's scheme - one of any other scheme is
      // refused, not silently accepted.
      requirement = await this.prisma.schemeDocumentRequirement.findFirst({
        where: { id: dto.documentRequirementId, schemeId: app.schemeId },
      });
      if (!requirement) {
        throw new UnprocessableEntityException({
          code: ErrorCodes.DOCUMENT_REQUIREMENT_MISMATCH,
          message:
            'That document requirement does not belong to this application’s scheme.',
        });
      }
    }
    return this.ingest({
      access,
      app,
      actorUserId,
      ipAddress,
      file,
      expiryDate,
      requirement,
      predecessor: null,
    });
  }

  async replace(
    access: EnterpriseAccess,
    projectId: string,
    applicationId: string,
    documentId: string,
    actorUserId: string,
    file: UploadedFileLike | undefined,
    dto: ReplaceDocumentDto,
    ipAddress: string,
  ): Promise<SchemeDocumentDto> {
    const app = await this.applications.findApplication(
      access,
      projectId,
      applicationId,
    );
    this.assertOpen(app.status);
    const expiryDate = parseExpiryDate(dto.expiryDate);

    const predecessor = await this.findLinked(app.id, documentId);
    if (predecessor.replacements.length > 0) {
      throw notCurrent();
    }
    const requirementId =
      predecessor.schemeApplicationDocuments.find(
        (l) => l.schemeApplicationId === app.id,
      )?.schemeDocumentRequirement?.id ?? null;
    const requirement = requirementId
      ? await this.prisma.schemeDocumentRequirement.findUnique({
          where: { id: requirementId },
        })
      : null;
    return this.ingest({
      access,
      app,
      actorUserId,
      ipAddress,
      file,
      expiryDate,
      requirement,
      predecessor: {
        id: predecessor.id,
        version: predecessor.version,
        lineageId: predecessor.lineageId,
        status: predecessor.status,
      },
    });
  }

  async list(
    access: EnterpriseAccess,
    projectId: string,
    applicationId: string,
    includeHistory: boolean,
  ): Promise<SchemeDocumentDto[]> {
    const app = await this.applications.findApplication(
      access,
      projectId,
      applicationId,
    );
    return this.listFor(app.id, includeHistory, 'APPLICANT');
  }

  async requirements(
    access: EnterpriseAccess,
    projectId: string,
    applicationId: string,
  ): Promise<SchemeEvidenceRequirementStatusDto[]> {
    const app = await this.applications.findApplication(
      access,
      projectId,
      applicationId,
    );
    return this.requirementsFor(app.id, app.schemeId);
  }

  async download(
    access: EnterpriseAccess,
    projectId: string,
    applicationId: string,
    documentId: string,
    actorUserId: string,
    ipAddress: string,
  ): Promise<{ data: Buffer; filename: string; mimeType: string }> {
    const app = await this.applications.findApplication(
      access,
      projectId,
      applicationId,
    );
    const document = await this.findLinked(app.id, documentId);
    return this.documents.downloadDocument(
      document,
      { userId: actorUserId, roleAtTime: APPLICANT_ROLE },
      {
        ...this.applications.auditContext(access, app.projectId),
        schemeApplicationId: app.id,
        schemeId: app.schemeId,
      },
      ipAddress,
    );
  }

  // ---- officer --------------------------------------------------------------------

  async listForOfficer(
    userId: string,
    applicationId: string,
    includeHistory: boolean,
  ): Promise<SchemeDocumentDto[]> {
    const ctx = await this.officers.resolve(userId, applicationId);
    return this.listFor(ctx.app.id, includeHistory, 'OFFICER');
  }

  async requirementsForOfficer(
    userId: string,
    applicationId: string,
  ): Promise<SchemeEvidenceRequirementStatusDto[]> {
    const ctx = await this.officers.resolve(userId, applicationId);
    return this.requirementsFor(ctx.app.id, ctx.app.schemeId);
  }

  async downloadForOfficer(
    userId: string,
    applicationId: string,
    documentId: string,
    ipAddress: string,
  ): Promise<{ data: Buffer; filename: string; mimeType: string }> {
    const ctx = await this.officers.resolve(userId, applicationId);
    const document = await this.findLinked(ctx.app.id, documentId);
    return this.documents.downloadDocument(
      document,
      { userId, roleAtTime: ctx.actor.actingRole },
      this.officerContext(ctx),
      ipAddress,
    );
  }

  /** Verify or reject the CURRENT version of an application's evidence. */
  async review(
    userId: string,
    applicationId: string,
    documentId: string,
    dto: ReviewDocumentDto,
    ipAddress: string,
  ): Promise<SchemeDocumentDto> {
    const ctx = await this.officers.resolve(userId, applicationId);
    const notes = dto.notes?.trim() ? dto.notes.trim() : null;
    if (dto.verdict === 'REJECTED' && !notes) {
      throw new BadRequestException({
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'Validation failed',
        fields: { notes: ['A reason is required when rejecting a document.'] },
      });
    }
    if (dto.verdict === 'REJECTED' && dto.validUntil !== undefined) {
      throw new BadRequestException({
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'Validation failed',
        fields: {
          validUntil: ['validUntil applies only to a verified document.'],
        },
      });
    }
    const validUntil = parseDate(dto.validUntil, 'validUntil');

    const reviewed = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM scheme_applications WHERE id = ${ctx.app.id}::uuid FOR UPDATE`;
      const locked = await tx.schemeApplication.findUnique({
        where: { id: ctx.app.id },
        select: { status: true },
      });
      if (!locked || !EVIDENCE_REVIEW_STATUSES.includes(locked.status)) {
        throw new ConflictException({
          code: ErrorCodes.DOCUMENT_NOT_REVIEWABLE,
          message:
            'Evidence can be reviewed only while the application is under review.',
        });
      }
      const document = await tx.document.findFirst({
        where: {
          id: documentId,
          schemeApplicationDocuments: {
            some: { schemeApplicationId: ctx.app.id },
          },
        },
        include: { replacements: { select: { id: true } } },
      });
      if (!document) {
        throw notFound('Document');
      }
      if (
        document.replacements.length > 0 ||
        document.status !== 'VALIDATION_PENDING' ||
        document.scannedAt === null
      ) {
        throw new ConflictException({
          code: ErrorCodes.DOCUMENT_NOT_REVIEWABLE,
          message:
            'Only the current version of a scanned document that is awaiting review can be reviewed.',
        });
      }
      // Guarded: a second officer action on the same document matches nothing.
      const { count } = await tx.document.updateMany({
        where: { id: document.id, status: 'VALIDATION_PENDING' },
        data: { status: dto.verdict },
      });
      if (count !== 1) {
        throw new ConflictException({
          code: ErrorCodes.DOCUMENT_NOT_REVIEWABLE,
          message: 'The document was reviewed by someone else.',
        });
      }
      const verification = await tx.documentVerification.create({
        data: {
          documentId: document.id,
          verifiedByUserId: userId,
          verdict: dto.verdict,
          notes,
          validUntil,
        },
      });
      return { document, verification };
    });

    await this.audit.record({
      userId,
      roleAtTime: ctx.actor.actingRole,
      action:
        dto.verdict === 'VERIFIED'
          ? AuditActions.DOCUMENT_VERIFIED
          : AuditActions.DOCUMENT_REJECTED_BY_OFFICER,
      entityType: 'Document',
      entityId: reviewed.document.id,
      beforeState: { status: 'VALIDATION_PENDING' },
      afterState: {
        ...this.officerContext(ctx),
        documentId: reviewed.document.id,
        version: reviewed.document.version,
        verdict: dto.verdict,
        reviewId: reviewed.verification.id,
        status: dto.verdict,
      },
      ipAddress,
    });
    const row = await this.findLinked(ctx.app.id, reviewed.document.id);
    return toSchemeDocumentDto(row, ctx.app.id, 'OFFICER');
  }

  // ---- internals ------------------------------------------------------------------

  private async ingest(p: {
    access: EnterpriseAccess;
    app: { id: string; projectId: string; schemeId: string };
    actorUserId: string;
    ipAddress: string;
    file: UploadedFileLike | undefined;
    expiryDate: Date | null;
    requirement: {
      id: string;
      maxSizeBytes: number | null;
      allowedMimeTypes: string[];
    } | null;
    predecessor: {
      id: string;
      version: number;
      lineageId: string;
      status: string;
    } | null;
  }): Promise<SchemeDocumentDto> {
    const context = {
      ...this.applications.auditContext(p.access, p.app.projectId),
      schemeApplicationId: p.app.id,
      schemeId: p.app.schemeId,
    };
    // 1-3. Validate, hash, malware-scan (fail closed), store - the platform's
    // one pipeline. Nothing is stored unless every check passed.
    const stored = await this.documents.screenAndStore(p.file, p.requirement, {
      app: p.app,
      actorUserId: p.actorUserId,
      ipAddress: p.ipAddress,
      roleAtTime: APPLICANT_ROLE,
      context,
      entityType: 'SchemeApplication',
    });

    // 4. Record it, atomically, against an application whose evidence is still open.
    let created: Document;
    let linkedRequirementId: string | null = null;
    try {
      created = await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM scheme_applications WHERE id = ${p.app.id}::uuid FOR UPDATE`;
        const fresh = await tx.schemeApplication.findUnique({
          where: { id: p.app.id },
          select: { status: true },
        });
        if (!fresh || !EVIDENCE_OPEN_STATUSES.includes(fresh.status)) {
          throw evidenceLocked();
        }

        if (p.predecessor) {
          const replaced = await tx.document.findFirst({
            where: { replacedDocumentId: p.predecessor.id },
            select: { id: true },
          });
          if (replaced) {
            throw notCurrent();
          }
        } else if (p.requirement) {
          const existing = await tx.schemeApplicationDocument.findFirst({
            where: {
              schemeApplicationId: p.app.id,
              schemeDocumentRequirementId: p.requirement.id,
              document: CURRENT_VERSION,
            },
            select: { documentId: true },
          });
          if (existing) {
            throw new ConflictException({
              code: ErrorCodes.REQUIREMENT_ALREADY_HAS_DOCUMENT,
              message:
                'This requirement already has a document. Replace that document to upload a new version.',
            });
          }
        }

        // The requirement a replacement answers is inherited from the version it
        // replaces; a new document answers the one the applicant named.
        const inherited = p.predecessor
          ? ((
              await tx.schemeApplicationDocument.findFirst({
                where: {
                  schemeApplicationId: p.app.id,
                  documentId: p.predecessor.id,
                },
                select: { schemeDocumentRequirementId: true },
              })
            )?.schemeDocumentRequirementId ?? null)
          : null;
        linkedRequirementId = p.requirement?.id ?? inherited;

        // Owner, uploader, status and scan state are the server's, never the
        // client's; the owner is the application's own PROJECT.
        const row = await this.documents.createLinkedDocument(tx, stored, {
          projectId: p.app.projectId,
          uploaderUserId: p.actorUserId,
          expiryDate: p.expiryDate,
          predecessor: p.predecessor,
        });
        await tx.schemeApplicationDocument.create({
          data: {
            schemeApplicationId: p.app.id,
            documentId: row.id,
            schemeDocumentRequirementId: linkedRequirementId,
          },
        });
        return row;
      });
    } catch (error) {
      await this.documents.discardStoredObject(stored.key);
      if (isUniqueViolation(error)) {
        // Backstop for a racing replacement: (lineage_id, version) is unique.
        throw p.predecessor
          ? notCurrent()
          : new ConflictException({
              code: ErrorCodes.CONFLICT,
              message: 'The document could not be recorded. Please try again.',
            });
      }
      if (error instanceof HttpException) {
        throw error; // already a controlled, client-safe outcome
      }
      // Anything else is unexpected. Its message can embed the values of the
      // failed statement (storage key, checksum, filename), so log only what it
      // IS, and answer generically.
      this.logger.error(
        `Recording scheme evidence failed: ${
          error instanceof Prisma.PrismaClientKnownRequestError
            ? `${error.name} ${error.code}`
            : ((error as Error)?.name ?? 'UnknownError')
        }`,
      );
      throw new InternalServerErrorException({
        code: ErrorCodes.INTERNAL_ERROR,
        message: 'The document could not be recorded. Please try again later.',
      });
    }

    const actor = { userId: p.actorUserId, roleAtTime: APPLICANT_ROLE };
    const eventContext = {
      ...context,
      documentId: created.id,
      version: created.version,
      lineageId: created.lineageId,
      schemeRequirementId: linkedRequirementId,
    };
    await this.documents.auditEvidenceStored(
      created,
      stored,
      actor,
      eventContext,
      p.ipAddress,
    );
    const event = (
      action: (typeof AuditActions)[keyof typeof AuditActions],
      afterState: Record<string, unknown>,
      beforeState?: Record<string, unknown>,
    ) =>
      this.audit.record({
        userId: p.actorUserId,
        roleAtTime: APPLICANT_ROLE,
        action,
        entityType: 'Document',
        entityId: created.id,
        beforeState,
        afterState,
        ipAddress: p.ipAddress,
      });
    await event(AuditActions.DOCUMENT_ASSOCIATED, eventContext);
    if (p.predecessor) {
      await event(
        AuditActions.DOCUMENT_REPLACED,
        {
          ...eventContext,
          previousDocumentId: p.predecessor.id,
          previousVersion: p.predecessor.version,
        },
        {
          documentId: p.predecessor.id,
          version: p.predecessor.version,
          status: p.predecessor.status,
        },
      );
    }
    if (linkedRequirementId) {
      await event(AuditActions.DOCUMENT_REQUIREMENT_SATISFIED, eventContext);
    }
    const row = await this.findLinked(p.app.id, created.id);
    return toSchemeDocumentDto(row, p.app.id, 'APPLICANT');
  }

  private async listFor(
    applicationId: string,
    includeHistory: boolean,
    audience: Audience,
  ): Promise<SchemeDocumentDto[]> {
    const rows = await this.prisma.document.findMany({
      where: {
        schemeApplicationDocuments: {
          some: { schemeApplicationId: applicationId },
        },
        ...(includeHistory ? {} : CURRENT_VERSION),
      },
      include: DOCUMENT_INCLUDE,
      orderBy: [{ createdAt: 'asc' }, { version: 'asc' }, { id: 'asc' }],
    });
    return rows.map((row) => toSchemeDocumentDto(row, applicationId, audience));
  }

  private async requirementsFor(
    applicationId: string,
    schemeId: string,
  ): Promise<SchemeEvidenceRequirementStatusDto[]> {
    const requirements = await this.prisma.schemeDocumentRequirement.findMany({
      where: { schemeId },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
    const ids = requirements.map((r) => r.id);
    const satisfied = await satisfiedSchemeRequirementIds(
      this.prisma,
      applicationId,
      ids,
    );
    const heads = ids.length
      ? await this.prisma.schemeApplicationDocument.findMany({
          where: {
            schemeApplicationId: applicationId,
            schemeDocumentRequirementId: { in: ids },
            document: CURRENT_VERSION,
          },
          select: {
            schemeDocumentRequirementId: true,
            document: { select: { id: true, version: true, status: true } },
          },
        })
      : [];
    const headByRequirement = new Map(
      heads.map((h) => [h.schemeDocumentRequirementId, h.document]),
    );
    return requirements.map((r) => ({
      ...toRequirementDto(r),
      satisfied: satisfied.has(r.id),
      currentDocument: headByRequirement.get(r.id) ?? null,
    }));
  }

  /** Documents are found only THROUGH the application they are attached to. */
  private async findLinked(
    applicationId: string,
    documentId: string,
  ): Promise<DocumentRow> {
    const row = /^[0-9a-f-]{36}$/i.test(documentId)
      ? await this.prisma.document.findFirst({
          where: {
            id: documentId,
            schemeApplicationDocuments: {
              some: { schemeApplicationId: applicationId },
            },
          },
          include: DOCUMENT_INCLUDE,
        })
      : null;
    if (!row) {
      throw notFound('Document');
    }
    return row;
  }

  private assertOpen(
    status: (typeof EVIDENCE_OPEN_STATUSES)[number] | string,
  ): void {
    if (!(EVIDENCE_OPEN_STATUSES as readonly string[]).includes(status)) {
      throw evidenceLocked();
    }
  }

  private officerContext(ctx: {
    app: {
      id: string;
      projectId: string;
      schemeId: string;
      project: { enterpriseId: string };
    };
    departmentId: string;
  }) {
    return {
      enterpriseId: ctx.app.project.enterpriseId,
      projectId: ctx.app.projectId,
      schemeApplicationId: ctx.app.id,
      schemeId: ctx.app.schemeId,
      departmentId: ctx.departmentId,
      actingAs: SCHEME_OFFICER_ROLE,
    };
  }
}
