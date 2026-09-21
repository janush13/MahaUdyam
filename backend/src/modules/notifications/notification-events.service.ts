import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  NotificationEventType,
  NotificationEventTypes as E,
} from './notification-events.constant';
import { NotificationRecipientsService } from './notification-recipients.service';
import { NotificationService } from './notification.service';
import { renderNotification } from './notification-templates';

/**
 * The one place the platform's transitions call to raise a notification
 * (TRD 13 trigger events; Blueprint 24 `NotificationService.dispatch`).
 *
 * Every method is called AFTER the transition's transaction has committed - the
 * same place its audit events are written - and can never fail it: a problem
 * is logged (by event name and error class only, never content) and swallowed.
 * The transition therefore never depends on the notification, and a
 * notification is never sent for a transition that rolled back. The price is
 * that a process crash between the commit and the dispatch loses that one
 * notification; the SLA notifications heal themselves (the hourly sweep
 * re-evaluates and every dispatch is idempotent), the others are not retried.
 *
 * Content and recipients come from the database, never from the caller, and
 * every event is idempotent through its dedupe key.
 */
@Injectable()
export class NotificationEventsService {
  private readonly logger = new Logger(NotificationEventsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly recipients: NotificationRecipientsService,
    private readonly notifications: NotificationService,
  ) {}

  // ---- applicant-facing ------------------------------------------------------

  applicationSubmitted(applicationId: string): Promise<void> {
    return this.safely(E.APPLICATION_SUBMITTED, async () => {
      const app = await this.application(applicationId);
      if (!app) {
        return;
      }
      await this.toApplicants(
        app,
        E.APPLICATION_SUBMITTED,
        `${E.APPLICATION_SUBMITTED}:${app.id}`,
        {
          referenceNumber: app.referenceNumber ?? undefined,
          approvalTypeName: app.approvalType.name,
        },
        { referenceNumber: app.referenceNumber },
      );
    });
  }

  queryRaised(applicationId: string, queryId: string): Promise<void> {
    return this.safely(E.QUERY_RAISED, async () => {
      const [app, query] = await Promise.all([
        this.application(applicationId),
        this.prisma.applicationQuery.findFirst({
          where: { id: queryId, applicationId },
          select: { roundNumber: true },
        }),
      ]);
      if (!app || !query) {
        return;
      }
      await this.toApplicants(
        app,
        E.QUERY_RAISED,
        `${E.QUERY_RAISED}:${queryId}`,
        {
          referenceNumber: app.referenceNumber ?? undefined,
          roundNumber: query.roundNumber,
        },
        {
          referenceNumber: app.referenceNumber,
          roundNumber: query.roundNumber,
        },
      );
    });
  }

  inspectionScheduled(
    applicationId: string,
    inspectionId: string,
    scheduledAt: Date,
  ): Promise<void> {
    return this.inspectionEvent(
      E.INSPECTION_SCHEDULED,
      applicationId,
      scheduledAt,
      `${E.INSPECTION_SCHEDULED}:${inspectionId}`,
    );
  }

  /** `changedAt` (the row's update time) tells one reschedule from the next, so
   * moving the same visit twice notifies twice, and re-dispatching one does
   * not. */
  inspectionRescheduled(
    applicationId: string,
    inspectionId: string,
    scheduledAt: Date,
    changedAt: Date,
  ): Promise<void> {
    return this.inspectionEvent(
      E.INSPECTION_RESCHEDULED,
      applicationId,
      scheduledAt,
      `${E.INSPECTION_RESCHEDULED}:${inspectionId}:${changedAt.getTime()}`,
    );
  }

  /** FRD 26.1 "approval issued": the Approving Authority approved. */
  approvalIssued(applicationId: string, decisionId: string): Promise<void> {
    return this.decisionEvent(E.APPROVAL_ISSUED, applicationId, decisionId);
  }

  /** FRD 26.1 "application rejected": the Approving Authority rejected. */
  applicationRejected(
    applicationId: string,
    decisionId: string,
  ): Promise<void> {
    return this.decisionEvent(
      E.APPLICATION_REJECTED,
      applicationId,
      decisionId,
    );
  }

  /** FRD 26.1 "compliance deadline approaching": an obligation became DUE
   * (its configured window opened). Applicant side; the requirement's wording
   * is not repeated here - the obligation itself is one click away. */
  complianceDeadlineApproaching(
    applicationId: string,
    recordId: string,
    dueDate: string,
  ): Promise<void> {
    return this.safely(E.COMPLIANCE_DEADLINE_APPROACHING, async () => {
      const app = await this.application(applicationId);
      if (!app) {
        return;
      }
      await this.toApplicants(
        app,
        E.COMPLIANCE_DEADLINE_APPROACHING,
        `${E.COMPLIANCE_DEADLINE_APPROACHING}:${recordId}`,
        { referenceNumber: app.referenceNumber ?? undefined, dueDate },
        {
          referenceNumber: app.referenceNumber,
          dueDate,
          complianceRecordId: recordId,
        },
      );
    });
  }

  /**
   * FRD 26.1 "scheme application status update": one notification per recorded
   * status change (the history row's id is the dedupe key), to the applicant
   * side of the project - the same recipients and access rule as every
   * applicant notice. Scheme applications are not approval applications, so
   * the row carries the enterprise and project (which is what scopes it) and
   * the scheme application in its payload. The decision's reason is
   * deliberately not copied into the message.
   */
  schemeApplicationStatusUpdated(
    schemeApplicationId: string,
    historyId: string,
  ): Promise<void> {
    return this.safely(E.SCHEME_APPLICATION_STATUS_UPDATE, async () => {
      const history =
        await this.prisma.schemeApplicationStatusHistory.findFirst({
          where: { id: historyId, schemeApplicationId },
          select: {
            toStatus: true,
            schemeApplication: {
              select: {
                id: true,
                referenceNumber: true,
                projectId: true,
                project: { select: { enterpriseId: true } },
                scheme: { select: { id: true, name: true } },
              },
            },
          },
        });
      if (!history) {
        return;
      }
      const app = history.schemeApplication;
      await this.notifications.create({
        recipients: await this.recipients.applicantSide(app.projectId),
        eventType: E.SCHEME_APPLICATION_STATUS_UPDATE,
        audience: 'APPLICANT',
        ...renderNotification(E.SCHEME_APPLICATION_STATUS_UPDATE, {
          referenceNumber: app.referenceNumber ?? undefined,
          schemeName: app.scheme.name,
          schemeStatus: history.toStatus,
        }),
        payload: {
          referenceNumber: app.referenceNumber,
          schemeApplicationId: app.id,
          schemeId: app.scheme.id,
          status: history.toStatus,
        },
        dedupeKey: `${E.SCHEME_APPLICATION_STATUS_UPDATE}:${historyId}`,
        enterpriseId: app.project.enterpriseId,
        projectId: app.projectId,
      });
    });
  }

  // ---- officer-facing ---------------------------------------------------------

  /** The officer who raised the query is told it was answered. */
  queryResponded(applicationId: string, queryId: string): Promise<void> {
    return this.safely(E.QUERY_RESPONDED, async () => {
      const [app, query] = await Promise.all([
        this.application(applicationId),
        this.prisma.applicationQuery.findFirst({
          where: { id: queryId, applicationId },
          select: { roundNumber: true, raisedByUserId: true },
        }),
      ]);
      if (!app || !query) {
        return;
      }
      const params = {
        referenceNumber: app.referenceNumber ?? undefined,
        roundNumber: query.roundNumber,
      };
      await this.notifications.create({
        recipients: await this.recipients.active([query.raisedByUserId]),
        eventType: E.QUERY_RESPONDED,
        audience: 'OFFICER',
        ...renderNotification(E.QUERY_RESPONDED, params),
        payload: {
          referenceNumber: app.referenceNumber,
          roundNumber: query.roundNumber,
        },
        dedupeKey: `${E.QUERY_RESPONDED}:${queryId}`,
        ...this.refs(app),
      });
    });
  }

  slaBreached(
    applicationId: string,
    slaInstanceId: string,
    dueAt: Date,
  ): Promise<void> {
    return this.slaEvent(E.SLA_BREACHED, applicationId, slaInstanceId, dueAt);
  }

  slaWarning(
    applicationId: string,
    slaInstanceId: string,
    dueAt: Date,
    percentElapsed: number,
  ): Promise<void> {
    return this.slaEvent(
      E.SLA_WARNING,
      applicationId,
      slaInstanceId,
      dueAt,
      percentElapsed,
    );
  }

  // ---- account-level ------------------------------------------------------------

  /** FRD 20.2: the representative is told of the offer (or of a widened one
   * that needs their fresh consent). Nothing about it grants access. */
  representativeAuthorisationRequested(
    authorisationId: string,
    offeredAt: Date,
  ): Promise<void> {
    return this.safely(E.REPRESENTATIVE_AUTHORISATION_REQUESTED, async () => {
      const record = await this.prisma.enterpriseRepresentative.findUnique({
        where: { id: authorisationId },
        select: {
          enterpriseId: true,
          representativeUserId: true,
          scope: true,
          enterprise: { select: { name: true } },
        },
      });
      if (!record) {
        return;
      }
      await this.notifications.create({
        recipients: await this.recipients.active([record.representativeUserId]),
        eventType: E.REPRESENTATIVE_AUTHORISATION_REQUESTED,
        audience: 'ACCOUNT',
        ...renderNotification(E.REPRESENTATIVE_AUTHORISATION_REQUESTED, {
          enterpriseName: record.enterprise.name,
        }),
        payload: { authorisationId, scope: record.scope },
        dedupeKey: `${E.REPRESENTATIVE_AUTHORISATION_REQUESTED}:${authorisationId}:${offeredAt.getTime()}`,
        enterpriseId: record.enterpriseId,
      });
    });
  }

  // ---- internals ------------------------------------------------------------------

  /** One decision notifies once (the decision id is the dedupe key), whoever
   * dispatches it and however often. The decision's reason is deliberately not
   * copied into the message: it is read on the application. */
  private decisionEvent(
    type: NotificationEventType,
    applicationId: string,
    decisionId: string,
  ): Promise<void> {
    return this.safely(type, async () => {
      const app = await this.application(applicationId);
      if (!app) {
        return;
      }
      await this.toApplicants(
        app,
        type,
        `${type}:${decisionId}`,
        {
          referenceNumber: app.referenceNumber ?? undefined,
          approvalTypeName: app.approvalType.name,
        },
        { referenceNumber: app.referenceNumber, decisionId },
      );
    });
  }

  private inspectionEvent(
    type: NotificationEventType,
    applicationId: string,
    scheduledAt: Date,
    dedupeKey: string,
  ): Promise<void> {
    return this.safely(type, async () => {
      const app = await this.application(applicationId);
      if (!app) {
        return;
      }
      // Deliberately absent: the inspector's identity and the site (FRD 24
      // discloses inspector information only where the department allows).
      await this.toApplicants(
        app,
        type,
        dedupeKey,
        { referenceNumber: app.referenceNumber ?? undefined, scheduledAt },
        { referenceNumber: app.referenceNumber, scheduledAt },
      );
    });
  }

  private slaEvent(
    type: NotificationEventType,
    applicationId: string,
    slaInstanceId: string,
    dueAt: Date,
    percentElapsed?: number,
  ): Promise<void> {
    return this.safely(type, async () => {
      const app = await this.application(applicationId);
      if (!app) {
        return;
      }
      await this.notifications.create({
        recipients: await this.recipients.officerSide(
          app.id,
          app.approvalType.departmentId,
        ),
        eventType: type,
        audience: 'OFFICER',
        ...renderNotification(type, {
          referenceNumber: app.referenceNumber ?? undefined,
          dueAt,
          percentElapsed,
        }),
        payload: {
          referenceNumber: app.referenceNumber,
          dueAt,
          ...(percentElapsed === undefined
            ? {}
            : { percentElapsed: Math.floor(percentElapsed) }),
        },
        dedupeKey: `${type}:${slaInstanceId}`,
        ...this.refs(app),
      });
    });
  }

  private async toApplicants(
    app: NonNullable<
      Awaited<ReturnType<NotificationEventsService['application']>>
    >,
    type: NotificationEventType,
    dedupeKey: string,
    params: Parameters<typeof renderNotification>[1],
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.notifications.create({
      recipients: await this.recipients.applicantSide(app.projectId),
      eventType: type,
      audience: 'APPLICANT',
      ...renderNotification(type, params),
      payload,
      dedupeKey,
      ...this.refs(app),
    });
  }

  private refs(app: { id: string; projectId: string; enterpriseId: string }) {
    return {
      enterpriseId: app.enterpriseId,
      projectId: app.projectId,
      applicationId: app.id,
    };
  }

  private async application(applicationId: string) {
    const app = await this.prisma.approvalApplication.findUnique({
      where: { id: applicationId },
      select: {
        id: true,
        referenceNumber: true,
        projectId: true,
        project: { select: { enterpriseId: true } },
        approvalType: { select: { name: true, departmentId: true } },
      },
    });
    return app ? { ...app, enterpriseId: app.project.enterpriseId } : null;
  }

  private async safely(
    event: NotificationEventType,
    work: () => Promise<void>,
  ): Promise<void> {
    try {
      await work();
    } catch (error) {
      // Name and class only: a failed statement can embed values.
      this.logger.error(
        `Notification dispatch failed for ${event}: ${(error as Error)?.name ?? 'UnknownError'}`,
      );
    }
  }
}
