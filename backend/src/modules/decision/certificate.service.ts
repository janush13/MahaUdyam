import {
  ConflictException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { InternalApplicationState, Prisma } from '@prisma/client';
import { ErrorCodes } from '../../common/constants/error-codes.constant';
import { AuditActions } from '../../infrastructure/audit/audit-actions.constant';
import { applicantStatusFor } from '../applications/application-state.machine';
import { ComplianceLifecycleService } from '../compliance/compliance-lifecycle.service';
import {
  DocumentRow,
  DocumentsService,
  UploadedFileLike,
} from '../documents/documents.service';
import { OfficerAccessService } from '../officer/officer-access.service';
import { ScrutinySupport } from '../officer/scrutiny-support.service';
import {
  DecisionTransition,
  findDecisionTransition,
} from './decision-state.machine';
import { AUTHORITY_ROLE } from './decision.constants';
import {
  CERTIFICATE_INCLUDE,
  toOfficerCertificateDto,
} from './decision.mappers';
import { applyDecisionTransition } from './decision.service';
import { IssueCertificateDto } from './dto/decision-request.dto';
import { CertificateResultDto } from './dto/decision-response.dto';

const APPROVED: InternalApplicationState = 'APPROVED';

const notAllowed = () =>
  new ConflictException({
    code: ErrorCodes.CERTIFICATE_NOT_ALLOWED,
    message:
      'A certificate can be issued only for an application the Approving Authority has approved.',
  });

/** Why a certificate cannot be issued from `state`, or null when it can. A
 * certificate follows an APPROVING decision (TRD 3.2), once. */
export function certificateBlock(
  state: InternalApplicationState,
): ConflictException | null {
  if (state === APPROVED) {
    return null;
  }
  if (state === 'CERTIFICATE_ISSUED' || state === 'ACTIVE') {
    return new ConflictException({
      code: ErrorCodes.CERTIFICATE_ALREADY_ISSUED,
      message: 'A certificate has already been issued for this application.',
    });
  }
  return notAllowed();
}

function required(
  action: DecisionTransition['action'],
  from: InternalApplicationState,
): DecisionTransition {
  const transition = findDecisionTransition(action, from);
  if (!transition) {
    // Unreachable: the block above admits only APPROVED, and the table defines
    // both arrows from the states used here. Fail closed rather than guess.
    throw new ConflictException({
      code: ErrorCodes.INVALID_STATE_TRANSITION,
      message: `This action is not available while the application is in its current state (${from}).`,
    });
  }
  return transition;
}

/**
 * Certificate issuance and the activation it starts (TRD 3.1 "Certificate
 * Issuance -> Post-Approval Compliance Tracking"; TRD 3.2 "APPROVED ->
 * CERTIFICATE_ISSUED -> ACTIVE (compliance period)"; FRD 4.5 "trigger issuance
 * of the approval document for applicant download"; Blueprint 8 "Compliance
 * Obligations Activated").
 *
 * WHAT IS AND IS NOT DEFINED. The requirements name the certificate and its
 * place in the lifecycle, but NOT its format, numbering, validity period, or
 * e-signature. So the platform does not generate a certificate: the Approving
 * Authority supplies the department's own certificate FILE, which goes through
 * the one Step 9 pipeline (validated, checksummed, malware-scanned fail-closed,
 * stored under a server key, never overwritten), and optionally the number the
 * department states. The platform records who issued it, when, and against
 * which application / decision / department / project / enterprise. Version is
 * 1; re-issue and correction are TO BE VALIDATED.
 *
 * ONE TRANSACTION, under the application's row lock: certificate document row,
 * certificate row, APPROVED -> CERTIFICATE_ISSUED, CERTIFICATE_ISSUED -> ACTIVE
 * and the compliance occurrences (ComplianceLifecycleService.ensureOccurrences -
 * the existing mechanism, not a copy of it), all stamped with ONE instant: the
 * moment of issuance, which is when the compliance period begins. Either all of
 * it happens or none of it does, so there is never a certificate without an
 * ACTIVE application, nor an ACTIVE one without its certificate. The unique key
 * (application, version) and the state guard mean two racing issuances produce
 * one certificate.
 */
@Injectable()
export class CertificateService {
  private readonly logger = new Logger(CertificateService.name);

  constructor(
    private readonly access: OfficerAccessService,
    private readonly support: ScrutinySupport,
    private readonly documents: DocumentsService,
    private readonly compliance: ComplianceLifecycleService,
  ) {}

  async issue(
    userId: string,
    applicationId: string,
    file: UploadedFileLike | undefined,
    dto: IssueCertificateDto,
    ipAddress: string,
  ): Promise<CertificateResultDto> {
    const ctx = await this.access.resolveApplication(
      userId,
      applicationId,
      'ISSUE_CERTIFICATE',
    );
    // Refuse before scanning and storing a file for an application that cannot
    // take one; every condition is re-checked under the lock below.
    const early = certificateBlock(ctx.app.internalState);
    if (early) {
      throw early;
    }

    // Step 9's ONE pipeline: validate, hash, malware-scan (fail closed), store.
    const stored = await this.documents.screenAndStore(file, null, {
      app: { id: ctx.app.id },
      actorUserId: userId,
      ipAddress,
      roleAtTime: ctx.actingRole,
      context: this.support.contextOf(ctx),
    });

    let done: {
      certificate: Prisma.ApprovalCertificateGetPayload<{
        include: typeof CERTIFICATE_INCLUDE;
      }>;
      document: DocumentRow;
      issue: DecisionTransition;
      activate: DecisionTransition;
      issuedAt: Date;
      events: Awaited<
        ReturnType<ComplianceLifecycleService['ensureOccurrences']>
      >;
    };
    try {
      done = await this.support.run(ctx, async (tx, locked) => {
        const blocked = certificateBlock(locked.internalState);
        if (blocked) {
          throw blocked;
        }
        const decision = await tx.approvalDecision.findUnique({
          where: { applicationId: ctx.app.id },
        });
        if (!decision || decision.outcome !== 'APPROVE') {
          // Unreachable while only an approving decision reaches APPROVED (the
          // database enforces it); fail closed if it ever is not.
          throw notAllowed();
        }
        const issue = required('ISSUE_CERTIFICATE', locked.internalState);
        const activate = required('ACTIVATE', issue.to);

        // ONE instant for the issuance, the activation and the compliance
        // period it starts.
        const issuedAt = new Date();
        const document = await this.documents.createCertificateDocument(
          tx,
          stored,
          ctx.app.projectId,
          userId,
        );
        const created = await tx.approvalCertificate.create({
          data: {
            applicationId: ctx.app.id,
            version: 1,
            decisionId: decision.id,
            departmentId: ctx.departmentId,
            certificateNumber: dto.certificateNumber ?? null,
            documentId: document.id,
            issuedByUserId: userId,
            issuedAt,
          },
          select: { id: true },
        });
        await applyDecisionTransition(tx, ctx.app.id, issue);
        await applyDecisionTransition(tx, ctx.app.id, activate);
        // The existing compliance mechanism, inside this transaction, with the
        // real activation time. It re-locks the same row (already ours) and is
        // idempotent, so the hourly job finds nothing left to create.
        const events = await this.compliance.ensureOccurrences(
          tx,
          ctx.app.id,
          issuedAt,
        );
        const certificate = await tx.approvalCertificate.findUniqueOrThrow({
          where: { id: created.id },
          include: CERTIFICATE_INCLUDE,
        });
        return { certificate, document, issue, activate, issuedAt, events };
      });
    } catch (error) {
      await this.documents.discardStoredObject(stored.key);
      if (error instanceof HttpException) {
        throw error;
      }
      // Its message can embed the failed statement's values (storage key,
      // checksum, filename): log only what it IS.
      this.logger.error(
        `Issuing a certificate failed: ${
          error instanceof Prisma.PrismaClientKnownRequestError
            ? `${error.name} ${error.code}`
            : ((error as Error)?.name ?? 'UnknownError')
        }`,
      );
      throw new InternalServerErrorException({
        code: ErrorCodes.INTERNAL_ERROR,
        message: 'The certificate could not be issued. Please try again later.',
      });
    }

    // After the commit: the document's scan / upload events, the certificate
    // and the two status changes (FRD 22.2 before/after), then the compliance
    // occurrences it created. Attributed to the issuing authority, with the
    // application's full context.
    const { certificate, document, issue, activate, issuedAt, events } = done;
    await this.documents.auditEvidenceStored(
      document,
      stored,
      { userId, roleAtTime: ctx.actingRole },
      this.support.contextOf(ctx),
      ipAddress,
    );
    await this.support.recordOfficerEvent(
      ctx,
      AuditActions.APPLICATION_CERTIFICATE_ISSUED,
      {
        certificateId: certificate.id,
        certificateVersion: certificate.version,
        certificateNumber: certificate.certificateNumber,
        decisionId: certificate.decisionId,
        documentId: certificate.documentId,
        issuedAt,
      },
      ipAddress,
    );
    for (const transition of [issue, activate]) {
      await this.support.recordOfficerEvent(
        ctx,
        AuditActions.APPLICATION_STATUS_CHANGED,
        {
          action: transition.action,
          internalState: transition.to,
          applicantStatus: applicantStatusFor(transition.to),
          certificateId: certificate.id,
          // ACTIVATE is the platform's consequence of the issuance, not a
          // separate act by the authority.
          performedBy: transition.actor,
        },
        ipAddress,
        {
          internalState: transition.from,
          applicantStatus: applicantStatusFor(transition.from),
        },
      );
    }
    await this.compliance.record(
      events,
      { userId, roleAtTime: AUTHORITY_ROLE, ipAddress },
      {
        ...this.support.contextOf(ctx),
        triggeredBy: 'CERTIFICATE_ISSUED',
        certificateId: certificate.id,
      },
    );

    return {
      applicationId: ctx.app.id,
      internalState: activate.to,
      applicantStatus: applicantStatusFor(activate.to),
      certificate: toOfficerCertificateDto(certificate),
      activatedAt: issuedAt,
      complianceObligationsCreated: events.length,
    };
  }
}
