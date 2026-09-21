import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ErrorCodes } from '../../common/constants/error-codes.constant';
import { AuditActions } from '../../infrastructure/audit/audit-actions.constant';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { applicantStatusFor } from '../applications/application-state.machine';
import { DocumentResponseDto } from '../documents/dto/document-response.dto';
import { DocumentsService } from '../documents/documents.service';
import {
  RECOMMENDATION_BLOCK_MESSAGES,
  loadInspectionFacts,
  recommendationBlock,
} from '../inspections/inspection-gate';
import {
  RecommendDto,
  RecordObservationDto,
  ReviewDocumentDto,
} from './dto/officer-request.dto';
import { ObservationDto, RecommendationDto } from './dto/officer-response.dto';
import { OfficerAccessService } from './officer-access.service';
import {
  WORKING_STATES,
  DOCUMENT_REVIEW_STATES,
} from './scrutiny-state.machine';
import { SlaLifecycleService } from '../sla/sla-lifecycle.service';
import { ScrutinySupport } from './scrutiny-support.service';

export class ScrutinyResultDto {
  applicationId: string;
  internalState: string;
  applicantStatus: string | null;
}

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
 * The scrutiny operations of a Scrutiny Officer (FRD 22.1), each an explicit
 * domain action — none takes a status. Authorisation is decided by
 * OfficerAccessService (department scope + assignment + capability) BEFORE the
 * transaction, and every precondition is re-checked INSIDE it under a row lock
 * (ScrutinySupport), so concurrent officers cannot interleave.
 *
 * Scrutiny only ever RECOMMENDS: nothing here reaches a decision state.
 */
@Injectable()
export class ScrutinyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OfficerAccessService,
    private readonly support: ScrutinySupport,
    private readonly documents: DocumentsService,
    private readonly sla: SlaLifecycleService,
  ) {}

  /** SUBMITTED -> UNDER_SCRUTINY. */
  async startScrutiny(
    userId: string,
    applicationId: string,
    ipAddress: string,
  ): Promise<ScrutinyResultDto> {
    const ctx = await this.access.resolveApplication(
      userId,
      applicationId,
      'START_SCRUTINY',
    );
    const transition = await this.support.run(ctx, async (tx, locked) => {
      const t = this.support.transitionFor(
        'START_SCRUTINY',
        locked.internalState,
      );
      await this.support.apply(tx, ctx.app.id, t);
      return t;
    });
    await this.support.recordOfficerEvent(
      ctx,
      AuditActions.SCRUTINY_STARTED,
      { assignedOfficerUserId: userId },
      ipAddress,
    );
    await this.support.recordStatusChange(ctx, transition, ipAddress);
    return {
      applicationId: ctx.app.id,
      internalState: transition.to,
      applicantStatus: applicantStatusFor(transition.to),
    };
  }

  /** An INTERNAL observation (never applicant-visible). Append-only. */
  async recordObservation(
    userId: string,
    applicationId: string,
    dto: RecordObservationDto,
    ipAddress: string,
  ): Promise<ObservationDto> {
    const ctx = await this.access.resolveApplication(
      userId,
      applicationId,
      'RECORD_OBSERVATION',
    );
    const created = await this.support.run(ctx, async (tx, locked) => {
      if (!WORKING_STATES.includes(locked.internalState)) {
        throw new ConflictException({
          code: ErrorCodes.INVALID_STATE_TRANSITION,
          message:
            'Observations can be recorded once scrutiny has started and until it is finished.',
        });
      }
      if (dto.relatedDocumentId) {
        const linked = await tx.applicationDocument.findFirst({
          where: {
            applicationId: ctx.app.id,
            documentId: dto.relatedDocumentId,
          },
          select: { documentId: true },
        });
        if (!linked) {
          // Same answer as any other document not on this application.
          throw new NotFoundException({
            code: ErrorCodes.NOT_FOUND,
            message: 'Document not found.',
          });
        }
      }
      return tx.scrutinyObservation.create({
        data: {
          applicationId: ctx.app.id,
          departmentId: ctx.departmentId,
          authorUserId: userId,
          body: dto.body,
          relatedDocumentId: dto.relatedDocumentId ?? null,
          relatedField: dto.relatedField ?? null,
        },
      });
    });
    // The body is internal working text: the audit trail records THAT an
    // observation was made, and what it points at, not its content.
    await this.support.recordOfficerEvent(
      ctx,
      AuditActions.SCRUTINY_OBSERVATION_RECORDED,
      {
        observationId: created.id,
        relatedDocumentId: created.relatedDocumentId,
        relatedField: created.relatedField,
      },
      ipAddress,
    );
    return toObservationDto(created);
  }

  /** UNDER_SCRUTINY -> RECOMMENDED_FOR_APPROVAL, recording the recommendation. */
  async recommend(
    userId: string,
    applicationId: string,
    dto: RecommendDto,
    ipAddress: string,
  ): Promise<RecommendationDto> {
    const ctx = await this.access.resolveApplication(
      userId,
      applicationId,
      'RECOMMEND',
    );
    const { transition, recommendation, slaEvents } = await this.support.run(
      ctx,
      async (tx, locked) => {
        const t = this.support.transitionFor('RECOMMEND', locked.internalState);
        // TRD 3.3: scrutiny triggers inspection BEFORE recommendation. Read
        // under the application's row lock - the same lock an inspector's
        // completion takes - so a recommendation and a completion (or a new
        // inspection request) are serialised and this sees the winner's result.
        const block = recommendationBlock(
          await loadInspectionFacts(tx, ctx.app.id),
        );
        if (block) {
          throw new ConflictException({
            code: ErrorCodes[block],
            message: RECOMMENDATION_BLOCK_MESSAGES[block],
          });
        }
        const created = await tx.scrutinyRecommendation.create({
          data: {
            applicationId: ctx.app.id,
            departmentId: ctx.departmentId,
            outcome: dto.outcome,
            reason: dto.reason,
            recommendedByUserId: userId,
          },
        });
        await this.support.apply(tx, ctx.app.id, t);
        // Scrutiny is finished: its SLA clock stops in the same locked
        // transaction (Blueprint 23.2 "Completion").
        const slaEvents = await this.sla.completeScrutiny(tx, ctx.app.id);
        return { transition: t, recommendation: created, slaEvents };
      },
    );
    await this.support.recordOfficerEvent(
      ctx,
      AuditActions.SCRUTINY_RECOMMENDATION_RECORDED,
      {
        recommendationId: recommendation.id,
        outcome: recommendation.outcome,
        reason: recommendation.reason,
        // A recommendation is not a decision.
        isRecommendationOnly: true,
      },
      ipAddress,
    );
    await this.support.recordStatusChange(ctx, transition, ipAddress);
    await this.sla.record(slaEvents, {
      userId,
      roleAtTime: ctx.actingRole,
      ipAddress,
      context: this.support.contextOf(ctx),
      ruleVersionUsed: this.support.ruleVersionOf(ctx.app),
    });
    return toRecommendationDto(recommendation);
  }

  /** Verify or reject the CURRENT version of an application's document. */
  async reviewDocument(
    userId: string,
    applicationId: string,
    documentId: string,
    dto: ReviewDocumentDto,
    ipAddress: string,
  ): Promise<DocumentResponseDto> {
    const ctx = await this.access.resolveApplication(
      userId,
      applicationId,
      'REVIEW_DOCUMENT',
    );
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

    const reviewed = await this.support.run(ctx, async (tx, locked) => {
      if (!DOCUMENT_REVIEW_STATES.includes(locked.internalState)) {
        throw new ConflictException({
          code: ErrorCodes.DOCUMENT_NOT_REVIEWABLE,
          message:
            'Documents can be reviewed only while the application is under scrutiny.',
        });
      }
      const document = await tx.document.findFirst({
        where: {
          id: documentId,
          applicationDocuments: { some: { applicationId: ctx.app.id } },
        },
        include: { replacements: { select: { id: true } } },
      });
      if (!document) {
        throw new NotFoundException({
          code: ErrorCodes.NOT_FOUND,
          message: 'Document not found.',
        });
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
      const review = await tx.documentVerification.create({
        data: {
          documentId: document.id,
          verifiedByUserId: userId,
          verdict: dto.verdict,
          notes,
          validUntil,
        },
      });
      return { document, review };
    });

    await this.audit.record({
      userId,
      roleAtTime: ctx.actingRole,
      action:
        dto.verdict === 'VERIFIED'
          ? AuditActions.DOCUMENT_VERIFIED
          : AuditActions.DOCUMENT_REJECTED_BY_OFFICER,
      entityType: 'Document',
      entityId: reviewed.document.id,
      beforeState: { status: 'VALIDATION_PENDING' },
      afterState: {
        ...this.support.contextOf(ctx),
        documentId: reviewed.document.id,
        version: reviewed.document.version,
        requirementId: reviewed.document.documentRequirementId,
        verdict: dto.verdict,
        reviewId: reviewed.review.id,
        status: dto.verdict,
      },
      ipAddress,
      ruleVersionUsed: this.support.ruleVersionOf(ctx.app),
    });
    return this.documents.getForApplication(
      ctx.app.id,
      reviewed.document.id,
      'OFFICER',
    );
  }
}

export function toObservationDto(o: {
  id: string;
  authorUserId: string;
  body: string;
  relatedDocumentId: string | null;
  relatedField: string | null;
  createdAt: Date;
}): ObservationDto {
  return {
    id: o.id,
    authorUserId: o.authorUserId,
    body: o.body,
    relatedDocumentId: o.relatedDocumentId,
    relatedField: o.relatedField,
    createdAt: o.createdAt,
  };
}

export function toRecommendationDto(r: {
  id: string;
  outcome: 'APPROVE' | 'REJECT';
  reason: string;
  recommendedByUserId: string;
  createdAt: Date;
}): RecommendationDto {
  return {
    id: r.id,
    outcome: r.outcome,
    reason: r.reason,
    recommendedByUserId: r.recommendedByUserId,
    createdAt: r.createdAt,
    isRecommendationOnly: true,
  };
}
