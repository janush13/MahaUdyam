import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ApplicationQuery, Department } from '@prisma/client';
import { ErrorCodes } from '../../common/constants/error-codes.constant';
import { AuditActions } from '../../infrastructure/audit/audit-actions.constant';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  ApplicationDiscoveryContext,
  ruleVersionLabel,
} from '../applications/application-discovery-context';
import { applicantStatusFor } from '../applications/application-state.machine';
import { ApplicationsService } from '../applications/applications.service';
import { EnterpriseAccess } from '../enterprises/interfaces/enterprise-access.interface';
import { RaiseQueryDto, RespondToQueryDto } from './dto/officer-request.dto';
import { ApplicantQueryDto, OfficerQueryDto } from './dto/officer-response.dto';
import { NotificationEventsService } from '../notifications/notification-events.service';
import { SlaLifecycleService } from '../sla/sla-lifecycle.service';
import { OfficerAccessService } from './officer-access.service';
import { ScrutinySupport } from './scrutiny-support.service';

const APPLICANT_ROLE = 'APPLICANT';

const notFound = (what: string) =>
  new NotFoundException({
    code: ErrorCodes.NOT_FOUND,
    message: `${what} not found.`,
  });

const notOpen = (message: string) =>
  new ConflictException({ code: ErrorCodes.QUERY_NOT_OPEN, message });

export function toOfficerQueryDto(q: ApplicationQuery): OfficerQueryDto {
  return {
    id: q.id,
    roundNumber: q.roundNumber,
    status: q.status,
    raisedByUserId: q.raisedByUserId,
    question: q.question,
    sourceObservationId: q.sourceObservationId,
    raisedAt: q.createdAt,
    response:
      q.responseText && q.respondedAt && q.respondedByUserId
        ? {
            text: q.responseText,
            respondedAt: q.respondedAt,
            respondedByUserId: q.respondedByUserId,
          }
        : null,
    closedAt: q.closedAt,
  };
}

export function toApplicantQueryDto(
  q: ApplicationQuery & { department: Department },
): ApplicantQueryDto {
  return {
    id: q.id,
    roundNumber: q.roundNumber,
    status: q.status,
    // Department only: whether an individual officer is named is a department
    // policy still to be validated (FRD 19.1). No officer id, no internal link.
    department: {
      id: q.department.id,
      code: q.department.code,
      name: q.department.name,
    },
    question: q.question,
    raisedAt: q.createdAt,
    response:
      q.responseText && q.respondedAt && q.respondedByUserId
        ? {
            text: q.responseText,
            respondedAt: q.respondedAt,
            respondedByUserId: q.respondedByUserId,
          }
        : null,
    closedAt: q.closedAt,
  };
}

/**
 * The structured query / response record (FRD 19; Blueprint 13.6).
 *
 *   officer  raises  : UNDER_SCRUTINY -> QUERY_RAISED
 *   applicant answers: QUERY_RAISED   -> APPLICANT_RESPONDED   (FULL scope)
 *   officer  closes  : APPLICANT_RESPONDED -> UNDER_SCRUTINY   ("query closed",
 *                      FRD 19.2), after which a further query may be raised
 *
 * The question, who asked it and the response are immutable — in the service AND
 * in PostgreSQL (trigger) — so "neither party can dispute what was asked or
 * said" (FRD 19.3). At most one query is open per application at a time.
 * Communication happens ONLY through this record.
 */
@Injectable()
export class QueriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OfficerAccessService,
    private readonly support: ScrutinySupport,
    private readonly applications: ApplicationsService,
    private readonly sla: SlaLifecycleService,
    private readonly notifications: NotificationEventsService,
  ) {}

  // ---- officer side -------------------------------------------------------

  async raise(
    userId: string,
    applicationId: string,
    dto: RaiseQueryDto,
    ipAddress: string,
  ): Promise<OfficerQueryDto> {
    const ctx = await this.access.resolveApplication(
      userId,
      applicationId,
      'RAISE_QUERY',
    );
    const { query, transition, slaEvents } = await this.support.run(
      ctx,
      async (tx, locked) => {
        const t = this.support.transitionFor(
          'RAISE_QUERY',
          locked.internalState,
        );
        if (dto.sourceObservationId) {
          const observation = await tx.scrutinyObservation.findFirst({
            where: { id: dto.sourceObservationId, applicationId: ctx.app.id },
            select: { id: true },
          });
          if (!observation) {
            throw notFound('Observation');
          }
        }
        const last = await tx.applicationQuery.aggregate({
          where: { applicationId: ctx.app.id },
          _max: { roundNumber: true },
        });
        const created = await tx.applicationQuery.create({
          data: {
            applicationId: ctx.app.id,
            departmentId: ctx.departmentId,
            roundNumber: (last._max.roundNumber ?? 0) + 1,
            raisedByUserId: userId,
            question: dto.question,
            sourceObservationId: dto.sourceObservationId ?? null,
          },
        });
        await this.support.apply(tx, ctx.app.id, t);
        // TRD 12: the clock pauses while the query awaits the applicant (where
        // the stage is configured to), in this same locked transaction.
        const slaEvents = await this.sla.pauseForQuery(
          tx,
          ctx.app.id,
          created.id,
        );
        return { query: created, transition: t, slaEvents };
      },
    );
    await this.support.recordOfficerEvent(
      ctx,
      AuditActions.QUERY_RAISED,
      {
        queryId: query.id,
        roundNumber: query.roundNumber,
        sourceObservationId: query.sourceObservationId,
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
    await this.notifications.queryRaised(ctx.app.id, query.id);
    return toOfficerQueryDto(query);
  }

  async close(
    userId: string,
    applicationId: string,
    queryId: string,
    ipAddress: string,
  ): Promise<OfficerQueryDto> {
    const ctx = await this.access.resolveApplication(
      userId,
      applicationId,
      'CLOSE_QUERY',
    );
    const { closed, transition } = await this.support.run(
      ctx,
      async (tx, locked) => {
        const t = this.support.transitionFor(
          'CLOSE_QUERY',
          locked.internalState,
        );
        const query = await tx.applicationQuery.findFirst({
          where: { id: queryId, applicationId: ctx.app.id },
        });
        if (!query) {
          throw notFound('Query');
        }
        if (query.status !== 'RESPONDED') {
          throw notOpen(
            'Only a query the applicant has answered can be closed.',
          );
        }
        const { count } = await tx.applicationQuery.updateMany({
          where: { id: query.id, status: 'RESPONDED' },
          data: {
            status: 'CLOSED',
            closedByUserId: userId,
            closedAt: new Date(),
          },
        });
        if (count !== 1) {
          throw notOpen('The query was closed by someone else.');
        }
        await this.support.apply(tx, ctx.app.id, t);
        return {
          closed: await tx.applicationQuery.findUniqueOrThrow({
            where: { id: query.id },
          }),
          transition: t,
        };
      },
    );
    await this.support.recordOfficerEvent(
      ctx,
      AuditActions.QUERY_CLOSED,
      { queryId: closed.id, roundNumber: closed.roundNumber },
      ipAddress,
    );
    await this.support.recordStatusChange(ctx, transition, ipAddress);
    return toOfficerQueryDto(closed);
  }

  // ---- applicant side -----------------------------------------------------

  /** The queries raised on an application the caller is authorised for. */
  async listForApplicant(
    access: EnterpriseAccess,
    projectId: string,
    applicationId: string,
  ): Promise<ApplicantQueryDto[]> {
    const app = await this.applications.findApplication(
      access,
      projectId,
      applicationId,
    );
    const rows = await this.prisma.applicationQuery.findMany({
      where: { applicationId: app.id },
      include: { department: true },
      orderBy: { roundNumber: 'asc' },
    });
    return rows.map(toApplicantQueryDto);
  }

  /** The applicant's answer. Written once; the question is never touched. */
  async respond(
    access: EnterpriseAccess,
    projectId: string,
    applicationId: string,
    queryId: string,
    actorUserId: string,
    dto: RespondToQueryDto,
    ipAddress: string,
  ): Promise<ApplicantQueryDto> {
    const app = await this.applications.findApplication(
      access,
      projectId,
      applicationId,
    );
    const { answered, transition, slaEvents } = await this.prisma.$transaction(
      async (tx) => {
        const locked = await this.support.lock(tx, app.id);
        if (!locked) {
          throw notFound('Application');
        }
        const query = await tx.applicationQuery.findFirst({
          where: { id: queryId, applicationId: app.id },
        });
        if (!query) {
          throw notFound('Query');
        }
        if (
          query.status !== 'OPEN' ||
          locked.internalState !== 'QUERY_RAISED'
        ) {
          throw notOpen('This query is not open for a response.');
        }
        const t = this.support.transitionFor(
          'RESPOND_TO_QUERY',
          locked.internalState,
        );
        const { count } = await tx.applicationQuery.updateMany({
          where: { id: query.id, status: 'OPEN' },
          data: {
            status: 'RESPONDED',
            responseText: dto.responseText,
            respondedByUserId: actorUserId,
            respondedAt: new Date(),
          },
        });
        if (count !== 1) {
          throw notOpen('This query has already been answered.');
        }
        await this.support.apply(tx, app.id, t);
        // The applicant's response resumes the clock, its deadline moved
        // forward by exactly the time it was paused (TRD 12, Blueprint 23.2).
        const slaEvents = await this.sla.resumeForQuery(tx, app.id, query.id);
        return {
          answered: await tx.applicationQuery.findUniqueOrThrow({
            where: { id: query.id },
            include: { department: true },
          }),
          transition: t,
          slaEvents,
        };
      },
    );

    const context = {
      enterpriseId: access.enterprise.id,
      projectId: app.projectId,
      applicationId: app.id,
      actingAs: access.relation,
      representativeScope: access.scope ?? null,
    };
    const ruleVersionUsed = ruleVersionLabel(
      app.discoveryContext as unknown as ApplicationDiscoveryContext | null,
    );
    await this.audit.record({
      userId: actorUserId,
      roleAtTime: APPLICANT_ROLE,
      action: AuditActions.QUERY_RESPONDED,
      entityType: 'ApprovalApplication',
      entityId: app.id,
      afterState: {
        ...context,
        queryId: answered.id,
        roundNumber: answered.roundNumber,
        departmentId: answered.departmentId,
      },
      ipAddress,
      ruleVersionUsed,
    });
    await this.audit.record({
      userId: actorUserId,
      roleAtTime: APPLICANT_ROLE,
      action: AuditActions.APPLICATION_STATUS_CHANGED,
      entityType: 'ApprovalApplication',
      entityId: app.id,
      beforeState: {
        internalState: transition.from,
        applicantStatus: applicantStatusFor(transition.from),
      },
      afterState: {
        ...context,
        action: transition.action,
        internalState: transition.to,
        applicantStatus: applicantStatusFor(transition.to),
      },
      ipAddress,
      ruleVersionUsed,
    });
    await this.sla.record(slaEvents, {
      userId: actorUserId,
      roleAtTime: APPLICANT_ROLE,
      ipAddress,
      context,
      ruleVersionUsed,
    });
    await this.notifications.queryResponded(app.id, answered.id);
    return toApplicantQueryDto(answered);
  }
}
