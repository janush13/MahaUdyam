import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, SchemeApplicationStatus } from '@prisma/client';
import { ErrorCodes } from '../../common/constants/error-codes.constant';
import { AuditActions } from '../../infrastructure/audit/audit-actions.constant';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { NotificationEventsService } from '../notifications/notification-events.service';
import {
  DecideSchemeApplicationDto,
  ListOfficerSchemeApplicationsQueryDto,
} from './dto/scheme-request.dto';
import {
  OfficerSchemeApplicationDto,
  OfficerSchemeApplicationListDto,
} from './dto/scheme-response.dto';
import { SchemeAccessService, SchemeActor } from './scheme-access.service';
import { satisfiedSchemeRequirementIds } from './scheme-evidence-queries';
import {
  SchemeAction,
  SchemeTransition,
  actionForOutcome,
  findSchemeTransition,
} from './scheme-state.machine';
import { DEFAULT_PAGE_SIZE } from './scheme.constants';
import {
  APPLICATION_INCLUDE,
  ApplicationRow,
  CatalogueSnapshot,
  toOfficerApplicationDto,
  toOfficerSummaryDto,
} from './scheme.mappers';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The Scheme Officer acting on one application. */
export interface SchemeOfficerContext {
  userId: string;
  app: ApplicationRow;
  actor: SchemeActor;
  departmentId: string;
}

const notFound = () =>
  new NotFoundException({
    code: ErrorCodes.NOT_FOUND,
    message: 'Scheme application not found.',
  });

/**
 * The Scheme Officer's side of a scheme application (FRD 4.7 / 34; TRD 15,
 * 28 "Scheme Officer - Verify, Approve, Reject").
 *
 * WHO. A Scheme Officer of the department that administers the SCHEME - derived
 * from the application's scheme, never from the client. Any other role (an
 * applicant, a scrutiny officer, a department administrator, a system
 * administrator) has none of these routes; a Scheme Officer of ANOTHER
 * department gets the same 404 as for a nonexistent application.
 *
 * WHAT. The documented status flow only, as explicit domain actions - `start
 * review`, `decide` (approve / reject, with a mandatory reason) and `disburse`.
 * No route takes a status. The Scheme Officer's decision IS the eligibility
 * determination (TRD 15): the system's recommendation is advice recorded on the
 * application and never an input to it. Disbursement is a status marker only -
 * no amount, payment or bank detail is modelled (Blueprint 31: no payment
 * gateway).
 *
 * HOW. The application row is locked (`SELECT ... FOR UPDATE`) and everything is
 * re-checked under the lock; the change is a guarded UPDATE
 * (`WHERE status = <from>`) plus a history row, in one transaction, and the
 * database itself refuses any other transition. Two officers racing produce one
 * winner and a 409 for the other. Audit and notification are written after the
 * commit, like every other transition.
 */
@Injectable()
export class SchemeOfficerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: SchemeAccessService,
    private readonly notifications: NotificationEventsService,
  ) {}

  async list(
    userId: string,
    query: ListOfficerSchemeApplicationsQueryDto,
  ): Promise<OfficerSchemeApplicationListDto> {
    const departments = await this.access.maintainedDepartments(userId);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;
    const q = query.q?.trim();
    const where: Prisma.SchemeApplicationWhereInput = {
      scheme: { departmentId: { in: departments } },
      ...(query.status ? { status: query.status } : {}),
      ...(query.schemeId ? { schemeId: query.schemeId } : {}),
      ...(q
        ? {
            OR: [
              { referenceNumber: { contains: q, mode: 'insensitive' } },
              { project: { name: { contains: q, mode: 'insensitive' } } },
              {
                project: {
                  referenceNumber: { contains: q, mode: 'insensitive' },
                },
              },
              {
                project: {
                  enterprise: { name: { contains: q, mode: 'insensitive' } },
                },
              },
              {
                project: {
                  enterprise: {
                    referenceNumber: { contains: q, mode: 'insensitive' },
                  },
                },
              },
            ],
          }
        : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.schemeApplication.count({ where }),
      this.prisma.schemeApplication.findMany({
        where,
        include: APPLICATION_INCLUDE,
        orderBy: [{ submittedAt: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { items: rows.map(toOfficerSummaryDto), total, page, pageSize };
  }

  async get(
    userId: string,
    applicationId: string,
  ): Promise<OfficerSchemeApplicationDto> {
    const ctx = await this.resolve(userId, applicationId);
    return toOfficerApplicationDto(ctx.app);
  }

  startReview(
    userId: string,
    applicationId: string,
    ipAddress: string,
  ): Promise<OfficerSchemeApplicationDto> {
    return this.act(userId, applicationId, 'START_REVIEW', null, ipAddress);
  }

  decide(
    userId: string,
    applicationId: string,
    dto: DecideSchemeApplicationDto,
    ipAddress: string,
  ): Promise<OfficerSchemeApplicationDto> {
    return this.act(
      userId,
      applicationId,
      actionForOutcome(dto.outcome),
      dto.reason,
      ipAddress,
    );
  }

  disburse(
    userId: string,
    applicationId: string,
    ipAddress: string,
  ): Promise<OfficerSchemeApplicationDto> {
    return this.act(userId, applicationId, 'DISBURSE', null, ipAddress);
  }

  /** The application, if the caller is a Scheme Officer of its scheme's
   * department; otherwise a 404 that cannot be told from "no such application". */
  async resolve(
    userId: string,
    applicationId: string,
  ): Promise<SchemeOfficerContext> {
    if (!UUID.test(applicationId)) {
      throw notFound();
    }
    const app = await this.prisma.schemeApplication.findUnique({
      where: { id: applicationId },
      include: APPLICATION_INCLUDE,
    });
    if (!app) {
      throw notFound();
    }
    const departmentId = app.scheme.departmentId;
    const actor = await this.access.resolveApplicationDepartment(
      userId,
      departmentId,
    );
    if (!actor) {
      throw notFound();
    }
    return { userId, app, actor, departmentId };
  }

  // ---- the transition -------------------------------------------------------------

  private async act(
    userId: string,
    applicationId: string,
    action: SchemeAction,
    reason: string | null,
    ipAddress: string,
  ): Promise<OfficerSchemeApplicationDto> {
    const ctx = await this.resolve(userId, applicationId);

    const done = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM scheme_applications WHERE id = ${ctx.app.id}::uuid FOR UPDATE`;
      const locked = await tx.schemeApplication.findUnique({
        where: { id: ctx.app.id },
        select: { status: true },
      });
      if (!locked) {
        throw notFound();
      }
      const transition = this.transitionFor(action, locked.status);
      if (action === 'APPROVE') {
        await this.assertEvidenceComplete(tx, ctx.app.id, ctx.app.schemeId);
      }

      const now = new Date();
      const { count } = await tx.schemeApplication.updateMany({
        where: { id: ctx.app.id, status: transition.from },
        data: {
          status: transition.to,
          updatedAt: now,
          ...(action === 'APPROVE' || action === 'REJECT'
            ? {
                decidedAt: now,
                decidedByUserId: userId,
                decisionReason: reason,
              }
            : {}),
          ...(action === 'DISBURSE' ? { disbursedAt: now } : {}),
        },
      });
      if (count !== 1) {
        throw new ConflictException({
          code: ErrorCodes.CONFLICT,
          message:
            'The application changed while this action was being processed. Reload it and try again.',
        });
      }
      const history = await tx.schemeApplicationStatusHistory.create({
        data: {
          schemeApplicationId: ctx.app.id,
          fromStatus: transition.from,
          toStatus: transition.to,
          actorUserId: userId,
          actorRole: ctx.actor.actingRole,
          reason,
        },
      });
      return { transition, historyId: history.id };
    });

    const { transition, historyId } = done;
    const snapshot = ctx.app.catalogueSnapshot as unknown as CatalogueSnapshot;
    const context = {
      enterpriseId: ctx.app.project.enterpriseId,
      projectId: ctx.app.projectId,
      schemeApplicationId: ctx.app.id,
      schemeId: ctx.app.schemeId,
      departmentId: ctx.departmentId,
      referenceNumber: ctx.app.referenceNumber,
      actingAs: ctx.actor.actingRole,
    };
    const ruleVersionUsed = snapshot.recommendation.rule
      ? `${snapshot.recommendation.rule.id}@v${snapshot.recommendation.rule.version}`
      : null;
    await this.audit.record({
      userId,
      roleAtTime: ctx.actor.actingRole,
      action: AuditActions.SCHEME_APPLICATION_STATUS_CHANGED,
      entityType: 'SchemeApplication',
      entityId: ctx.app.id,
      beforeState: { status: transition.from },
      afterState: {
        ...context,
        action: transition.action,
        status: transition.to,
        historyId,
      },
      ipAddress,
      ruleVersionUsed,
    });
    if (transition.action === 'APPROVE' || transition.action === 'REJECT') {
      await this.audit.record({
        userId,
        roleAtTime: ctx.actor.actingRole,
        action: AuditActions.SCHEME_APPLICATION_DECISION_RECORDED,
        entityType: 'SchemeApplication',
        entityId: ctx.app.id,
        afterState: {
          ...context,
          outcome: transition.action,
          reason,
          // What the system suggested, alongside the officer's own decision:
          // the recommendation was advice, the decision is the determination.
          recommendationStatus: snapshot.recommendation.status,
          isRecommendationOnly: false,
        },
        ipAddress,
        ruleVersionUsed,
      });
    }
    await this.notifications.schemeApplicationStatusUpdated(
      ctx.app.id,
      historyId,
    );

    const fresh = await this.prisma.schemeApplication.findUniqueOrThrow({
      where: { id: ctx.app.id },
      include: APPLICATION_INCLUDE,
    });
    return toOfficerApplicationDto(fresh);
  }

  /** The transition `action` performs from `from`, or a 409 - the client never
   * names a target status. A status that is already past the action gets the
   * plain "not available" answer naming where the application is. */
  private transitionFor(
    action: SchemeAction,
    from: SchemeApplicationStatus,
  ): SchemeTransition {
    const transition = findSchemeTransition(action, from);
    if (!transition) {
      throw new ConflictException({
        code: ErrorCodes.INVALID_STATE_TRANSITION,
        message: `This action is not available while the application is ${from}.`,
      });
    }
    return transition;
  }

  /** An application is approved only with usable evidence for every MANDATORY
   * document the scheme requires (FRD 29.2 "required documents"; the officer
   * "verifies supporting documents", FRD 34). Rejecting is never blocked. */
  private async assertEvidenceComplete(
    tx: Prisma.TransactionClient,
    applicationId: string,
    schemeId: string,
  ): Promise<void> {
    const mandatory = await tx.schemeDocumentRequirement.findMany({
      where: { schemeId, isMandatory: true },
      select: { id: true, name: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
    const satisfied = await satisfiedSchemeRequirementIds(
      tx,
      applicationId,
      mandatory.map((r) => r.id),
    );
    const missing = mandatory.filter((r) => !satisfied.has(r.id));
    if (missing.length > 0) {
      throw new ConflictException({
        code: ErrorCodes.SCHEME_EVIDENCE_INCOMPLETE,
        message: `A mandatory document has no usable evidence, so the application cannot be approved: ${missing
          .map((m) => m.name)
          .join('; ')}.`,
      });
    }
  }
}
