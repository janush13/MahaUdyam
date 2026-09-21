import { createHash, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentRequirement, Prisma } from '@prisma/client';
import { AppConfig } from '../../config/configuration';
import { ErrorCodes } from '../../common/constants/error-codes.constant';
import { AuditActions } from '../../infrastructure/audit/audit-actions.constant';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  STORAGE_SERVICE,
  StorageObjectExistsError,
  StorageService,
} from '../../infrastructure/storage/storage.interface';
import { allowsDocumentChanges } from '../applications/application-state.machine';
import { ApplicationsService } from '../applications/applications.service';
import { EnterpriseAccess } from '../enterprises/interfaces/enterprise-access.interface';
import { STORAGE_KEY_PREFIX } from './constants/document.constants';
import {
  CURRENT_VERSION,
  isDownloadable,
  satisfiedRequirementIds,
} from './document-queries';
import {
  DocumentRequirementStatusDto,
  DocumentResponseDto,
} from './dto/document-response.dto';
import {
  ReplaceDocumentDto,
  UploadDocumentDto,
} from './dto/upload-document.dto';
import {
  UploadRejection,
  decodeMultipartFilename,
  effectiveLimits,
  validateUpload,
} from './file-validation';
import {
  MALWARE_SCANNER,
  MalwareScanner,
  ScanResult,
} from './malware-scanner.interface';

const APPLICANT_ROLE = 'APPLICANT';

/** The subset of a multipart upload this service reads. Declared here (not
 * imported from multer's typings) so the module depends on nothing but the
 * fields it actually uses. `buffer` is present because uploads are parsed in
 * memory. */
export interface UploadedFileLike {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

const DOCUMENT_INCLUDE = {
  documentRequirement: {
    select: { id: true, name: true, isMandatory: true },
  },
  replacements: { select: { id: true } },
  /** The latest officer review (verified / rejected), if any. */
  verifications: { orderBy: { verifiedAt: 'desc' }, take: 1 },
} satisfies Prisma.DocumentInclude;

export type DocumentRow = Prisma.DocumentGetPayload<{
  include: typeof DOCUMENT_INCLUDE;
}>;

/** What a scan / rejection audit event needs, whoever the uploader is: the
 * application it concerns, who acted (and in which role), and the actor's own
 * audit context (enterprise / relation for an applicant, the inspection for an
 * inspector). */
export interface ScanAuditTarget {
  app: { id: string };
  actorUserId: string;
  ipAddress: string;
  roleAtTime: string;
  context: Record<string, unknown>;
  /** What `app.id` identifies in the audit trail. Defaults to the approval
   * application, the original (and still most common) owner of a document. */
  entityType?: string;
}

/** The only parts of a document requirement the upload pipeline reads: its
 * size and content-type limits. An approval's requirement and a scheme's both
 * satisfy it. */
export interface UploadLimitSource {
  maxSizeBytes: number | null;
  allowedMimeTypes: string[];
}

/** The fields the scan/upload audit events read from a stored document row. */
export type AuditableDocument = Pick<
  DocumentRow,
  'id' | 'version' | 'lineageId' | 'originalFilename' | 'mimeType' | 'sizeBytes'
>;

/** A file that has passed validation and the malware scan and is now in
 * storage under a server-generated key, not yet recorded in the database. */
export interface StoredUpload {
  documentId: string;
  key: string;
  checksum: string;
  filename: string;
  mime: string;
  size: number;
  scan: ScanResult;
}

/** The document fields the download path reads. */
export type ServableDocument = Pick<
  DocumentRow,
  | 'id'
  | 'filePath'
  | 'checksum'
  | 'status'
  | 'scannedAt'
  | 'version'
  | 'originalFilename'
  | 'mimeType'
>;

/** How an upload rejection maps onto HTTP. */
const REJECTION_STATUS: Record<UploadRejection, number> = {
  FILE_EMPTY: 400,
  FILE_TOO_LARGE: 413,
  UNSUPPORTED_TYPE: 415,
  MIME_TYPE_MISMATCH: 422,
  INVALID_FILENAME: 422,
  CORRUPT_FILE: 422,
};

function notFound(what: string): NotFoundException {
  return new NotFoundException({
    code: ErrorCodes.NOT_FOUND,
    message: `${what} not found.`,
  });
}

function validationError(field: string, message: string): BadRequestException {
  return new BadRequestException({
    code: ErrorCodes.VALIDATION_ERROR,
    message: 'Validation failed',
    fields: { [field]: [message] },
  });
}

/** A real calendar date (YYYY-MM-DD) or null. */
export function parseExpiryDate(value: string | undefined): Date | null {
  if (value === undefined) {
    return null;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
  ) {
    throw validationError(
      'expiryDate',
      'expiryDate must be a real calendar date',
    );
  }
  return parsed;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

/** Who is looking: an officer additionally sees the reviewer's internal
 * notes; an applicant sees only the reason for a rejection. */
export type DocumentAudience = 'APPLICANT' | 'OFFICER';

export function toDocumentResponse(
  row: DocumentRow,
  applicationId: string,
  audience: DocumentAudience = 'APPLICANT',
): DocumentResponseDto {
  const review = (row.verifications ?? [])[0];
  return {
    id: row.id,
    applicationId,
    lineageId: row.lineageId,
    version: row.version,
    isCurrent: row.replacements.length === 0,
    previousVersionId: row.replacedDocumentId,
    replacedByVersionId: row.replacements[0]?.id ?? null,
    requirement: row.documentRequirement,
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
            ? {
                notes: review.notes,
                reviewedByUserId: review.verifiedByUserId,
              }
            : {}),
        }
      : null,
    uploadedByUserId: row.uploadedBy,
    uploadedAt: row.createdAt,
  };
}

/**
 * Document management (FRD 14/15, TRD 6, Blueprint 13.5/22): upload, replace
 * (non-destructive versioning), list, retrieve and download an application's
 * documents.
 *
 * OWNERSHIP + AUTHORISATION. Routes are protected by the existing
 * EnterpriseAccessGuard. The service then derives the whole chain from the
 * URL - enterprise (already authorised) -> project -> application, each
 * looked up INSIDE the previous one - and only afterwards touches a document,
 * which is always looked up THROUGH that application. No ownership, owner,
 * uploader, status, scan or storage field is ever taken from the client, and
 * a document id from any other application/project/enterprise is
 * indistinguishable from a nonexistent one.
 *
 * PIPELINE (upload / replace): validate (name, size, real content type,
 * structure) -> SHA-256 -> malware scan, FAIL CLOSED -> store under a
 * server-generated key without overwriting -> one transaction that locks the
 * application, re-checks it is still a draft and writes the document +
 * association. A file the scanner rejects, or cannot judge, is never stored.
 * If the transaction fails the stored object is removed again.
 *
 * VERSIONING. A replacement is a NEW row (version + 1, same lineage, same
 * requirement/owner) naming its predecessor; nothing is overwritten or
 * deleted, and PostgreSQL forbids changing a version's identity. There is no
 * delete endpoint: documents are part of the historical record.
 */
@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly applications: ApplicationsService,
    private readonly config: ConfigService<AppConfig, true>,
    @Inject(STORAGE_SERVICE) private readonly storage: StorageService,
    @Inject(MALWARE_SCANNER) private readonly scanner: MalwareScanner,
  ) {}

  // ---------------------------------------------------------------------
  // Upload / replace
  // ---------------------------------------------------------------------

  async upload(
    access: EnterpriseAccess,
    projectId: string,
    applicationId: string,
    actorUserId: string,
    file: UploadedFileLike | undefined,
    dto: UploadDocumentDto,
    ipAddress: string,
  ): Promise<DocumentResponseDto> {
    const app = await this.applications.findApplication(
      access,
      projectId,
      applicationId,
    );
    this.assertEditable(app.internalState);
    const expiryDate = parseExpiryDate(dto.expiryDate);

    let requirement: RequirementRow | null = null;
    if (dto.documentRequirementId) {
      // Must belong to THIS application's approval - a requirement id of any
      // other approval is refused, not silently accepted.
      requirement = await this.prisma.documentRequirement.findFirst({
        where: {
          id: dto.documentRequirementId,
          approvalTypeId: app.approvalTypeId,
        },
      });
      if (!requirement) {
        throw new UnprocessableEntityException({
          code: ErrorCodes.DOCUMENT_REQUIREMENT_MISMATCH,
          message:
            'That document requirement does not belong to this application’s approval.',
        });
      }
    }

    const created = await this.ingest({
      access,
      app,
      actorUserId,
      ipAddress,
      file,
      expiryDate,
      requirement,
      predecessor: null,
    });
    return toDocumentResponse(created, app.id);
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
  ): Promise<DocumentResponseDto> {
    const app = await this.applications.findApplication(
      access,
      projectId,
      applicationId,
    );
    this.assertEditable(app.internalState);
    const expiryDate = parseExpiryDate(dto.expiryDate);

    const predecessor = await this.findLinked(app.id, documentId);
    if (predecessor.replacements.length > 0) {
      throw this.notCurrent();
    }
    const requirement = predecessor.documentRequirementId
      ? await this.prisma.documentRequirement.findUnique({
          where: { id: predecessor.documentRequirementId },
        })
      : null;

    const created = await this.ingest({
      access,
      app,
      actorUserId,
      ipAddress,
      file,
      expiryDate,
      requirement,
      predecessor,
    });
    return toDocumentResponse(created, app.id);
  }

  // ---------------------------------------------------------------------
  // Read
  // ---------------------------------------------------------------------

  /** An application's documents: each document's CURRENT version, or every
   * version when `includeHistory` is set. */
  async list(
    access: EnterpriseAccess,
    projectId: string,
    applicationId: string,
    includeHistory: boolean,
  ): Promise<DocumentResponseDto[]> {
    const app = await this.applications.findApplication(
      access,
      projectId,
      applicationId,
    );
    return this.listForApplication(app.id, includeHistory);
  }

  /** The same listing for an already-authorised application (used by the
   * officer workspace, which authorises through department scope instead). */
  async listForApplication(
    applicationId: string,
    includeHistory: boolean,
    audience: DocumentAudience = 'APPLICANT',
  ): Promise<DocumentResponseDto[]> {
    const rows = await this.prisma.document.findMany({
      where: {
        applicationDocuments: { some: { applicationId } },
        ...(includeHistory ? {} : CURRENT_VERSION),
      },
      include: DOCUMENT_INCLUDE,
      orderBy: [{ createdAt: 'asc' }, { version: 'asc' }, { id: 'asc' }],
    });
    return rows.map((row) => toDocumentResponse(row, applicationId, audience));
  }

  async get(
    access: EnterpriseAccess,
    projectId: string,
    applicationId: string,
    documentId: string,
  ): Promise<DocumentResponseDto> {
    const app = await this.applications.findApplication(
      access,
      projectId,
      applicationId,
    );
    return toDocumentResponse(
      await this.findLinked(app.id, documentId),
      app.id,
    );
  }

  /** One document version of an already-authorised application. */
  async getForApplication(
    applicationId: string,
    documentId: string,
    audience: DocumentAudience = 'APPLICANT',
  ): Promise<DocumentResponseDto> {
    return toDocumentResponse(
      await this.findLinked(applicationId, documentId),
      applicationId,
      audience,
    );
  }

  /** The whole chain of an already-authorised application's document. */
  async versionsForApplication(
    applicationId: string,
    documentId: string,
    audience: DocumentAudience = 'APPLICANT',
  ): Promise<DocumentResponseDto[]> {
    const anchor = await this.findLinked(applicationId, documentId);
    const rows = await this.prisma.document.findMany({
      where: {
        lineageId: anchor.lineageId,
        applicationDocuments: { some: { applicationId } },
      },
      include: DOCUMENT_INCLUDE,
      orderBy: { version: 'asc' },
    });
    return rows.map((row) => toDocumentResponse(row, applicationId, audience));
  }

  /** Every version of the chain the document belongs to, oldest first. */
  async versions(
    access: EnterpriseAccess,
    projectId: string,
    applicationId: string,
    documentId: string,
  ): Promise<DocumentResponseDto[]> {
    const app = await this.applications.findApplication(
      access,
      projectId,
      applicationId,
    );
    const anchor = await this.findLinked(app.id, documentId);
    const rows = await this.prisma.document.findMany({
      where: {
        lineageId: anchor.lineageId,
        applicationDocuments: { some: { applicationId: app.id } },
      },
      include: DOCUMENT_INCLUDE,
      orderBy: { version: 'asc' },
    });
    return rows.map((row) => toDocumentResponse(row, app.id));
  }

  /** The configured requirements of this application's approval and whether
   * each is currently satisfied. Empty when a department has configured none
   * - nothing is ever fabricated. */
  async requirements(
    access: EnterpriseAccess,
    projectId: string,
    applicationId: string,
  ): Promise<DocumentRequirementStatusDto[]> {
    const app = await this.applications.findApplication(
      access,
      projectId,
      applicationId,
    );
    const requirements = await this.prisma.documentRequirement.findMany({
      where: { approvalTypeId: app.approvalTypeId },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
    const ids = requirements.map((r) => r.id);
    const satisfied = await satisfiedRequirementIds(this.prisma, app.id, ids);
    const heads = ids.length
      ? await this.prisma.applicationDocument.findMany({
          where: {
            applicationId: app.id,
            document: {
              ...CURRENT_VERSION,
              documentRequirementId: { in: ids },
            },
          },
          select: {
            document: {
              select: {
                id: true,
                version: true,
                status: true,
                documentRequirementId: true,
              },
            },
          },
        })
      : [];
    const headByRequirement = new Map(
      heads.map((h) => [h.document.documentRequirementId, h.document]),
    );
    const platformMax = this.platformMaxBytes();

    return requirements.map((r) => {
      const limits = effectiveLimits(platformMax, r);
      const head = headByRequirement.get(r.id);
      return {
        id: r.id,
        name: r.name,
        description: r.description,
        isMandatory: r.isMandatory,
        acceptedMimeTypes: limits.acceptedMimes,
        maxSizeBytes: limits.maxSizeBytes,
        satisfied: satisfied.has(r.id),
        currentDocument: head
          ? { id: head.id, version: head.version, status: head.status }
          : null,
      };
    });
  }

  // ---------------------------------------------------------------------
  // Download
  // ---------------------------------------------------------------------

  /**
   * Serves a stored file. Authorisation happened first (guard), the document
   * is found only through this application, its state must permit download
   * (scanned, not rejected), and the bytes are re-checked against the stored
   * SHA-256 before they leave. The storage key never reaches the client.
   */
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
    return this.serve(
      app,
      documentId,
      { userId: actorUserId, roleAtTime: APPLICANT_ROLE },
      this.auditContext(access, app.projectId, app.id),
      ipAddress,
    );
  }

  /** Download for an already-authorised application by another kind of actor
   * (an officer): same state checks, same integrity check, same audit — with
   * the caller's own audit context. */
  async downloadForApplication(
    app: { id: string; projectId: string },
    documentId: string,
    actor: { userId: string; roleAtTime: string },
    auditContext: Record<string, unknown>,
    ipAddress: string,
  ): Promise<{ data: Buffer; filename: string; mimeType: string }> {
    return this.serve(app, documentId, actor, auditContext, ipAddress);
  }

  private async serve(
    app: { id: string; projectId: string },
    documentId: string,
    actor: { userId: string; roleAtTime: string },
    auditContext: Record<string, unknown>,
    ipAddress: string,
  ): Promise<{ data: Buffer; filename: string; mimeType: string }> {
    const document = await this.findLinked(app.id, documentId);
    return this.downloadDocument(document, actor, auditContext, ipAddress);
  }

  /** Serves a document row the CALLER has already authorised (the applicant
   * path finds it through the application; inspection evidence through the
   * inspection). Same state check (scanned, not rejected), same integrity
   * check against the stored SHA-256, same audit. */
  async downloadDocument(
    document: ServableDocument,
    actor: { userId: string; roleAtTime: string },
    auditContext: Record<string, unknown>,
    ipAddress: string,
  ): Promise<{ data: Buffer; filename: string; mimeType: string }> {
    if (!isDownloadable(document)) {
      throw new ConflictException({
        code: ErrorCodes.DOCUMENT_NOT_AVAILABLE,
        message: 'This document is not available for download.',
      });
    }

    let data: Buffer;
    try {
      data = await this.storage.get(document.filePath);
    } catch (error) {
      this.logger.error(
        `Stored object missing or unreadable for document ${document.id}: ${(error as Error).name}`,
      );
      throw new InternalServerErrorException({
        code: ErrorCodes.DOCUMENT_INTEGRITY_ERROR,
        message: 'The stored file could not be retrieved.',
      });
    }
    if (sha256(data) !== document.checksum) {
      this.logger.error(
        `Checksum mismatch for document ${document.id} (stored object altered)`,
      );
      throw new InternalServerErrorException({
        code: ErrorCodes.DOCUMENT_INTEGRITY_ERROR,
        message: 'The stored file failed its integrity check.',
      });
    }

    await this.audit.record({
      userId: actor.userId,
      roleAtTime: actor.roleAtTime,
      action: AuditActions.DOCUMENT_DOWNLOADED,
      entityType: 'Document',
      entityId: document.id,
      afterState: {
        ...auditContext,
        documentId: document.id,
        version: document.version,
      },
      ipAddress,
    });
    return {
      data,
      filename: document.originalFilename,
      mimeType: document.mimeType,
    };
  }

  // ---------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------

  /**
   * The ONE validate -> hash -> malware-scan (fail closed) -> store pipeline,
   * used by applicant uploads AND by inspection evidence: nothing is stored
   * unless it passed every check, and a stored object is never overwritten.
   * The caller records the document row and must call `discardStoredObject`
   * if that fails.
   */
  async screenAndStore(
    file: UploadedFileLike | undefined,
    requirement: UploadLimitSource | null,
    target: ScanAuditTarget,
  ): Promise<StoredUpload> {
    if (!file || !Buffer.isBuffer(file.buffer)) {
      throw new BadRequestException({
        code: ErrorCodes.FILE_REQUIRED,
        message: 'A file must be uploaded in the "file" form field.',
      });
    }

    // 1. Hard validation - before anything is scanned or stored.
    const limits = effectiveLimits(this.platformMaxBytes(), requirement);
    const check = validateUpload({
      originalName: decodeMultipartFilename(file.originalname),
      declaredMime: file.mimetype,
      data: file.buffer,
      maxSizeBytes: limits.maxSizeBytes,
      acceptedMimes: limits.acceptedMimes,
    });
    if (!check.ok) {
      throw new HttpException(
        {
          code: ErrorCodes[check.code],
          message: check.message,
        },
        REJECTION_STATUS[check.code],
      );
    }

    // 2. Integrity + malware scan (fail closed).
    const checksum = sha256(file.buffer);
    const scan = await this.scanOrReject(
      target,
      check.filename,
      file.buffer,
      checksum,
    );

    // 3. Store under a server-generated key; never overwrite.
    const documentId = randomUUID();
    const key = `${STORAGE_KEY_PREFIX}/${new Date().getUTCFullYear()}/${randomUUID()}`;
    try {
      await this.storage.put(key, file.buffer, { overwrite: false });
    } catch (error) {
      this.logger.error(
        `Storage write failed for a document upload: ${
          error instanceof StorageObjectExistsError
            ? 'key collision'
            : (error as Error).name
        }`,
      );
      throw new ServiceUnavailableException({
        code: ErrorCodes.STORAGE_UNAVAILABLE,
        message: 'The file could not be stored. Please try again.',
      });
    }
    return {
      documentId,
      key,
      checksum,
      filename: check.filename,
      mime: check.mime,
      size: check.size,
      scan,
    };
  }

  private async ingest(p: {
    access: EnterpriseAccess;
    app: {
      id: string;
      projectId: string;
      approvalTypeId: string;
    };
    actorUserId: string;
    ipAddress: string;
    file: UploadedFileLike | undefined;
    expiryDate: Date | null;
    requirement: RequirementRow | null;
    predecessor: DocumentRow | null;
  }): Promise<DocumentRow> {
    const stored = await this.screenAndStore(p.file, p.requirement, {
      app: p.app,
      actorUserId: p.actorUserId,
      ipAddress: p.ipAddress,
      roleAtTime: APPLICANT_ROLE,
      context: this.auditContext(p.access, p.app.projectId, p.app.id),
    });
    const { documentId, key, checksum, scan } = stored;
    const check = {
      filename: stored.filename,
      mime: stored.mime,
      size: stored.size,
    };

    // 4. Record it, atomically, against a still-editable application.
    let created: DocumentRow;
    try {
      created = await this.prisma.$transaction(async (tx) => {
        // Serialises every document operation of this application with each
        // other and with submission (which updates this same row).
        await tx.$queryRaw`SELECT id FROM approval_applications WHERE id = ${p.app.id}::uuid FOR UPDATE`;
        const fresh = await tx.approvalApplication.findUnique({
          where: { id: p.app.id },
          select: { internalState: true },
        });
        if (!fresh || !allowsDocumentChanges(fresh.internalState)) {
          throw this.alreadySubmitted();
        }

        if (p.predecessor) {
          const replaced = await tx.document.findFirst({
            where: { replacedDocumentId: p.predecessor.id },
            select: { id: true },
          });
          if (replaced) {
            throw this.notCurrent();
          }
        } else if (p.requirement) {
          const existing = await tx.applicationDocument.findFirst({
            where: {
              applicationId: p.app.id,
              document: {
                ...CURRENT_VERSION,
                documentRequirementId: p.requirement.id,
              },
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

        const row = await tx.document.create({
          data: {
            id: documentId,
            // Derived from the authorised application - never from the client.
            ownerType: p.predecessor?.ownerType ?? 'PROJECT',
            ownerId: p.predecessor?.ownerId ?? p.app.projectId,
            documentRequirementId:
              p.predecessor?.documentRequirementId ?? p.requirement?.id ?? null,
            filePath: key,
            checksum,
            originalFilename: check.filename,
            mimeType: check.mime,
            sizeBytes: check.size,
            status: 'VALIDATION_PENDING',
            expiryDate: p.expiryDate,
            version: p.predecessor ? p.predecessor.version + 1 : 1,
            replacedDocumentId: p.predecessor?.id ?? null,
            ...(p.predecessor ? { lineageId: p.predecessor.lineageId } : {}),
            scannedAt: new Date(),
            scannerName: scan.scannerName,
            uploadedBy: p.actorUserId,
          },
          include: DOCUMENT_INCLUDE,
        });
        await tx.applicationDocument.create({
          data: { applicationId: p.app.id, documentId: row.id },
        });
        // A new document can turn "Draft" into "Ready to Submit" (or back).
        await this.applications.syncDraftStatus(tx, p.app.id);
        return row;
      });
    } catch (error) {
      await this.discardStoredObject(key);
      if (isUniqueViolation(error)) {
        // Backstop for a racing replacement: (lineage_id, version) is unique.
        throw p.predecessor
          ? this.notCurrent()
          : new ConflictException({
              code: ErrorCodes.CONFLICT,
              message: 'The document could not be recorded. Please try again.',
            });
      }
      if (error instanceof HttpException) {
        throw error; // already a controlled, client-safe outcome
      }
      // Anything else is unexpected. Its message can embed the values of the
      // failed statement (storage key, checksum, filename), and the global
      // filter would log it - so log only what it IS, and answer generically.
      this.logger.error(
        `Recording a document failed: ${
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

    await this.auditSuccess(p, created, checksum, scan);
    return created;
  }

  /** Runs the scanner; returns only a CLEAN result. An infected file is
   * rejected; a scanner that cannot decide is treated as a failure - never as
   * clean. Neither is stored. The audit entry hangs on the application because
   * no document row exists for a rejected file. */
  private async scanOrReject(
    p: ScanAuditTarget,
    filename: string,
    data: Buffer,
    checksum: string,
  ): Promise<ScanResult> {
    let result: ScanResult;
    try {
      result = await this.scanner.scan(data, { filename });
    } catch (error) {
      this.logger.warn(
        `Malware scanner failed to deliver a verdict: ${(error as Error).name}`,
      );
      await this.recordScanEvent(
        AuditActions.DOCUMENT_SCAN_FAILED,
        p,
        filename,
        checksum,
        { scanner: this.scanner.name },
      );
      throw new ServiceUnavailableException({
        code: ErrorCodes.SCANNER_UNAVAILABLE,
        message:
          'The document could not be scanned right now, so it was not accepted. Please try again later.',
      });
    }

    if (result.verdict === 'CLEAN') {
      return result;
    }
    if (result.verdict === 'INFECTED') {
      await this.recordScanEvent(
        AuditActions.DOCUMENT_SCAN_REJECTED,
        p,
        filename,
        checksum,
        { scanner: result.scannerName, signature: result.signature ?? null },
      );
      throw new UnprocessableEntityException({
        code: ErrorCodes.MALWARE_DETECTED,
        message:
          'The file was rejected by the security scan and was not stored.',
      });
    }
    // Any other verdict is a scanner malfunction: fail closed.
    await this.recordScanEvent(
      AuditActions.DOCUMENT_SCAN_FAILED,
      p,
      filename,
      checksum,
      { scanner: this.scanner.name, reason: 'UNRECOGNISED_VERDICT' },
    );
    throw new ServiceUnavailableException({
      code: ErrorCodes.SCANNER_UNAVAILABLE,
      message:
        'The document could not be scanned right now, so it was not accepted. Please try again later.',
    });
  }

  private recordScanEvent(
    action:
      | typeof AuditActions.DOCUMENT_SCAN_REJECTED
      | typeof AuditActions.DOCUMENT_SCAN_FAILED,
    p: ScanAuditTarget,
    filename: string,
    checksum: string,
    details: Record<string, unknown>,
  ): Promise<void> {
    return this.audit.record({
      userId: p.actorUserId,
      roleAtTime: p.roleAtTime,
      action,
      entityType: p.entityType ?? 'ApprovalApplication',
      entityId: p.app.id,
      afterState: {
        ...p.context,
        originalFilename: filename,
        checksumSha256: checksum,
        stored: false,
        ...details,
      },
      ipAddress: p.ipAddress,
    });
  }

  private async auditSuccess(
    p: {
      access: EnterpriseAccess;
      app: { id: string; projectId: string };
      actorUserId: string;
      ipAddress: string;
      predecessor: DocumentRow | null;
    },
    created: DocumentRow,
    checksum: string,
    scan: ScanResult,
  ): Promise<void> {
    const context = {
      ...this.auditContext(p.access, p.app.projectId, p.app.id),
      documentId: created.id,
      version: created.version,
      lineageId: created.lineageId,
      requirementId: created.documentRequirementId,
    };
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

    await event(AuditActions.DOCUMENT_SCAN_COMPLETED, {
      ...context,
      scanner: scan.scannerName,
      verdict: 'CLEAN',
    });
    await event(AuditActions.DOCUMENT_UPLOADED, {
      ...context,
      originalFilename: created.originalFilename,
      mimeType: created.mimeType,
      sizeBytes: created.sizeBytes,
      checksumSha256: checksum,
    });
    await event(AuditActions.DOCUMENT_ASSOCIATED, context);
    if (p.predecessor) {
      await event(
        AuditActions.DOCUMENT_REPLACED,
        {
          ...context,
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
    if (created.documentRequirementId) {
      await event(AuditActions.DOCUMENT_REQUIREMENT_SATISFIED, context);
    }
  }

  /**
   * Records an evidence file as an ordinary Step 9 document (owned by the
   * inspected application's PROJECT, scanned clean, awaiting review) inside the
   * caller's transaction. It is deliberately NOT attached to the application's
   * document list: evidence is reached only through its inspection. Owner,
   * uploader, status and scan state are set here, never by a client.
   */
  async createEvidenceDocument(
    tx: Prisma.TransactionClient,
    stored: StoredUpload,
    projectId: string,
    uploaderUserId: string,
  ): Promise<DocumentRow> {
    return tx.document.create({
      data: {
        id: stored.documentId,
        ownerType: 'PROJECT',
        ownerId: projectId,
        filePath: stored.key,
        checksum: stored.checksum,
        originalFilename: stored.filename,
        mimeType: stored.mime,
        sizeBytes: stored.size,
        status: 'VALIDATION_PENDING',
        scannedAt: new Date(),
        scannerName: stored.scan.scannerName,
        uploadedBy: uploaderUserId,
      },
      include: DOCUMENT_INCLUDE,
    });
  }

  /**
   * Records a department-issued CERTIFICATE file (Step 15) as an ordinary
   * Step 9 document inside the caller's transaction: owned by the application's
   * PROJECT, scanned clean, and - like evidence - deliberately NOT attached to
   * the application's document list, so it is never offered for review or
   * replacement; it is reached only through its certificate record. Same
   * ownership / uploader / scan-state rules as evidence: set here, never by a
   * client.
   */
  createCertificateDocument(
    tx: Prisma.TransactionClient,
    stored: StoredUpload,
    projectId: string,
    uploaderUserId: string,
  ): Promise<DocumentRow> {
    return this.createEvidenceDocument(tx, stored, projectId, uploaderUserId);
  }

  /**
   * Records a scanned file as an ordinary document owned by a PROJECT, inside
   * the caller's transaction, optionally as the next version of `predecessor`
   * (same chain, same owner). For a caller that links the document to its own
   * record (scheme evidence): owner, uploader, status and scan state are set
   * here, never by a client, and the document is deliberately NOT attached to
   * an approval application's document list.
   */
  createLinkedDocument(
    tx: Prisma.TransactionClient,
    stored: StoredUpload,
    p: {
      projectId: string;
      uploaderUserId: string;
      expiryDate: Date | null;
      predecessor: { id: string; version: number; lineageId: string } | null;
    },
  ) {
    return tx.document.create({
      data: {
        id: stored.documentId,
        ownerType: 'PROJECT',
        ownerId: p.projectId,
        filePath: stored.key,
        checksum: stored.checksum,
        originalFilename: stored.filename,
        mimeType: stored.mime,
        sizeBytes: stored.size,
        status: 'VALIDATION_PENDING',
        expiryDate: p.expiryDate,
        version: p.predecessor ? p.predecessor.version + 1 : 1,
        replacedDocumentId: p.predecessor?.id ?? null,
        ...(p.predecessor ? { lineageId: p.predecessor.lineageId } : {}),
        scannedAt: new Date(),
        scannerName: stored.scan.scannerName,
        uploadedBy: p.uploaderUserId,
      },
    });
  }

  /** The scan + upload audit events for an evidence document, with the
   * inspector's own role and context. */
  async auditEvidenceStored(
    created: AuditableDocument,
    stored: StoredUpload,
    actor: { userId: string; roleAtTime: string },
    context: Record<string, unknown>,
    ipAddress: string,
  ): Promise<void> {
    const base = {
      ...context,
      documentId: created.id,
      version: created.version,
      lineageId: created.lineageId,
    };
    const event = (
      action: (typeof AuditActions)[keyof typeof AuditActions],
      afterState: Record<string, unknown>,
    ) =>
      this.audit.record({
        userId: actor.userId,
        roleAtTime: actor.roleAtTime,
        action,
        entityType: 'Document',
        entityId: created.id,
        afterState,
        ipAddress,
      });
    await event(AuditActions.DOCUMENT_SCAN_COMPLETED, {
      ...base,
      scanner: stored.scan.scannerName,
      verdict: 'CLEAN',
    });
    await event(AuditActions.DOCUMENT_UPLOADED, {
      ...base,
      originalFilename: created.originalFilename,
      mimeType: created.mimeType,
      sizeBytes: created.sizeBytes,
      checksumSha256: stored.checksum,
    });
  }

  async discardStoredObject(key: string): Promise<void> {
    try {
      await this.storage.delete(key);
    } catch {
      this.logger.error(
        'Could not remove an orphaned stored object after a failed upload.',
      );
    }
  }

  /** Documents are found only THROUGH the application they are attached to. */
  private async findLinked(
    applicationId: string,
    documentId: string,
  ): Promise<DocumentRow> {
    const row = await this.prisma.document.findFirst({
      where: {
        id: documentId,
        applicationDocuments: { some: { applicationId } },
      },
      include: DOCUMENT_INCLUDE,
    });
    if (!row) {
      throw notFound('Document');
    }
    return row;
  }

  private assertEditable(
    state: Parameters<typeof allowsDocumentChanges>[0],
  ): void {
    if (!allowsDocumentChanges(state)) {
      throw this.alreadySubmitted();
    }
  }

  private alreadySubmitted(): ConflictException {
    return new ConflictException({
      code: ErrorCodes.ALREADY_SUBMITTED,
      message:
        'This application has been submitted, so its documents can no longer be changed here.',
    });
  }

  private notCurrent(): ConflictException {
    return new ConflictException({
      code: ErrorCodes.DOCUMENT_NOT_CURRENT,
      message:
        'This version has already been replaced. Only the current version of a document can be replaced.',
    });
  }

  private platformMaxBytes(): number {
    return this.config.get('documents.maxSizeBytes', { infer: true });
  }

  private auditContext(
    access: EnterpriseAccess,
    projectId: string,
    applicationId: string,
  ) {
    return {
      enterpriseId: access.enterprise.id,
      projectId,
      applicationId,
      actingAs: access.relation,
      representativeScope: access.scope ?? null,
    };
  }
}

type RequirementRow = DocumentRequirement;

function sha256(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}
