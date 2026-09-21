import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ErrorCodes } from '../../common/constants/error-codes.constant';
import { AuditActions } from '../../infrastructure/audit/audit-actions.constant';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { DISCOVERY_CONTEXT_NOTE } from '../applications/constants/application.constants';
import {
  DISCOVERY_NOTICE,
  DiscoveryEngineResult,
} from '../discovery/engine/discovery-engine';
import { DocumentResponseDto } from '../documents/dto/document-response.dto';
import { DocumentsService } from '../documents/documents.service';
import {
  CERTIFICATE_INCLUDE,
  DECISION_INCLUDE,
  toDecisionDto,
  toOfficerCertificateDto,
} from '../decision/decision.mappers';
import { authorityActionsFrom } from '../decision/decision-state.machine';
import {
  loadInspectionFacts,
  loadInspectionsWithOutcome,
  recommendationBlock,
} from '../inspections/inspection-gate';
import { toProjectResponse } from '../projects/projects.service';
import {
  CAN_SEE_ASSIGNMENT_HISTORY,
  DEFAULT_PAGE_SIZE,
  ROLE_CAPABILITIES,
} from './constants/officer.constants';
import { ListOfficerApplicationsQueryDto } from './dto/officer-request.dto';
import {
  HistoryEntryDto,
  OfficerApplicationDetailDto,
  OfficerApplicationListDto,
  OfficerApplicationSummaryDto,
  OfficerDashboardDto,
  OfficerDiscoveryDto,
} from './dto/officer-response.dto';
import {
  OfficerAccessService,
  OfficerApplicationContext,
} from './officer-access.service';
import { toObservationDto, toRecommendationDto } from './scrutiny.service';
import { toOfficerQueryDto } from './queries.service';
import {
  ASSIGNABLE_STATES,
  DOCUMENT_REVIEW_STATES,
  WORKING_STATES,
  officerActionsFrom,
} from './scrutiny-state.machine';
import { ScrutinySupport } from './scrutiny-support.service';

const LIST_SELECT = {
  id: true,
  referenceNumber: true,
  internalState: true,
  applicantStatus: true,
  submittedAt: true,
  updatedAt: true,
  approvalType: {
    select: {
      id: true,
      name: true,
      department: { select: { id: true, code: true, name: true } },
    },
  },
  project: {
    select: {
      id: true,
      referenceNumber: true,
      name: true,
      district: true,
      enterprise: {
        select: { id: true, referenceNumber: true, name: true },
      },
    },
  },
  assignments: {
    where: { endedAt: null },
    take: 1,
    select: {
      officerUserId: true,
      assignedAt: true,
      officer: { select: { name: true } },
    },
  },
  queries: {
    where: { status: { not: 'CLOSED' } },
    take: 1,
    select: { id: true },
  },
} satisfies Prisma.ApprovalApplicationSelect;

type ListRow = Prisma.ApprovalApplicationGetPayload<{
  select: typeof LIST_SELECT;
}>;

function toSummary(row: ListRow): OfficerApplicationSummaryDto {
  const assignment = row.assignments[0];
  return {
    id: row.id,
    referenceNumber: row.referenceNumber as string,
    approvalType: { id: row.approvalType.id, name: row.approvalType.name },
    department: { ...row.approvalType.department },
    enterprise: { ...row.project.enterprise },
    project: {
      id: row.project.id,
      referenceNumber: row.project.referenceNumber,
      name: row.project.name,
      district: row.project.district,
    },
    internalState: row.internalState,
    applicantStatus: row.applicantStatus,
    submittedAt: row.submittedAt as Date,
    updatedAt: row.updatedAt,
    assignedOfficer: assignment
      ? {
          userId: assignment.officerUserId,
          name: assignment.officer.name,
          assignedAt: assignment.assignedAt,
        }
      : null,
    awaitingApplicant: row.queries.length > 0,
  };
}

/** Escapes the LIKE metacharacters (backslash is PostgreSQL's default escape). */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

function utcDate(value: string, field: string): Date {
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

/** Only these audit actions describe application activity to an officer; auth,
 * role and security events are never part of an application's history. */
const HISTORY_SUMMARIES: Record<
  string,
  (after: Record<string, unknown>, before: Record<string, unknown>) => string
> = {
  [AuditActions.APPLICATION_CREATED]: () => 'Application started',
  [AuditActions.APPLICATION_UPDATED]: () => 'Draft details saved',
  [AuditActions.APPLICATION_SUBMITTED]: () => 'Application submitted',
  [AuditActions.APPLICATION_STATUS_CHANGED]: (after, before) =>
    `Status changed: ${String(before.internalState ?? '?')} → ${String(after.internalState ?? '?')}`,
  [AuditActions.APPLICATION_ASSIGNED]: () => 'Assigned to an officer',
  [AuditActions.APPLICATION_REASSIGNED]: () => 'Reassigned to another officer',
  [AuditActions.SCRUTINY_STARTED]: () => 'Scrutiny started',
  [AuditActions.SCRUTINY_OBSERVATION_RECORDED]: () =>
    'Internal observation recorded',
  [AuditActions.QUERY_RAISED]: (after) =>
    `Query raised (round ${String(after.roundNumber ?? '?')})`,
  [AuditActions.QUERY_RESPONDED]: (after) =>
    `Applicant responded to query (round ${String(after.roundNumber ?? '?')})`,
  [AuditActions.QUERY_CLOSED]: (after) =>
    `Query closed (round ${String(after.roundNumber ?? '?')})`,
  [AuditActions.DOCUMENT_UPLOADED]: (after) =>
    `Document uploaded (version ${String(after.version ?? '?')})`,
  [AuditActions.DOCUMENT_REPLACED]: (after) =>
    `Document replaced (now version ${String(after.version ?? '?')})`,
  [AuditActions.DOCUMENT_VERIFIED]: () => 'Document verified',
  [AuditActions.DOCUMENT_REJECTED_BY_OFFICER]: () =>
    'Document rejected by the department',
  [AuditActions.INSPECTION_CREATED]: (after) =>
    after.scheduledAt
      ? 'Inspection requested and scheduled'
      : 'Inspection requested (not yet scheduled)',
  [AuditActions.INSPECTION_SCHEDULED]: () => 'Inspection scheduled',
  [AuditActions.INSPECTION_RESCHEDULED]: () => 'Inspection rescheduled',
  [AuditActions.INSPECTION_REASSIGNED]: () =>
    'Inspection assigned to a different inspector',
  [AuditActions.INSPECTION_SITE_UPDATED]: () => 'Inspection site updated',
  [AuditActions.INSPECTION_CONFIRMED]: () =>
    'Inspector confirmed the inspection visit',
  [AuditActions.INSPECTION_RESULT_RECORDED]: () =>
    'Inspection checklist result recorded',
  [AuditActions.INSPECTION_EVIDENCE_ATTACHED]: () =>
    'Inspection evidence attached',
  [AuditActions.INSPECTION_REPORT_SUBMITTED]: (after) =>
    `Inspection report submitted (${String(after.overallFinding ?? '?')})`,
  [AuditActions.INSPECTION_COMPLETED]: () => 'Inspection completed',
  [AuditActions.SLA_STARTED]: (after) =>
    after.configured
      ? 'SLA clock started'
      : 'SLA clock started (timeline not yet configured)',
  [AuditActions.SLA_PAUSED]: () =>
    'SLA clock paused (query awaiting applicant)',
  [AuditActions.SLA_RESUMED]: () => 'SLA clock resumed (applicant responded)',
  [AuditActions.SLA_COMPLETED]: () => 'SLA clock completed (scrutiny finished)',
  [AuditActions.SLA_BREACHED]: () => 'SLA breached',
  [AuditActions.SCRUTINY_RECOMMENDATION_RECORDED]: (after) =>
    `Recommendation recorded (${String(after.outcome ?? '?')}) — for the Approving Authority`,
  [AuditActions.APPLICATION_DECISION_RECORDED]: (after) =>
    `Decision recorded by the Approving Authority (${String(after.outcome ?? '?')})`,
  [AuditActions.APPLICATION_CERTIFICATE_ISSUED]: (after) =>
    `Certificate issued${after.certificateNumber ? ` (${String(after.certificateNumber)})` : ''}`,
};

const HISTORY_LIMIT = 500;

/**
 * The officer's window onto applications (FRD 21/22, Blueprint OFF-01..03):
 * queue, dashboard, detail, the stored discovery context, and history. All
 * reads go through OfficerAccessService (department scope + assignment), and
 * every query is a bounded, indexed PostgreSQL query — no search engine, no
 * raw filter language, no N+1 (list rows are one query with joins).
 */
@Injectable()
export class OfficerWorkspaceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly access: OfficerAccessService,
    private readonly support: ScrutinySupport,
    private readonly documents: DocumentsService,
  ) {}

  // ---- queue --------------------------------------------------------------

  async list(
    userId: string,
    query: ListOfficerApplicationsQueryDto,
  ): Promise<OfficerApplicationListDto> {
    const grants = await this.access.grantsFor(userId);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;

    const filters: Prisma.ApprovalApplicationWhereInput[] = [
      this.access.visibilityWhere(userId, grants, query.departmentId),
    ];
    if (query.approvalTypeId) {
      filters.push({ approvalTypeId: query.approvalTypeId });
    }
    if (query.enterpriseId) {
      filters.push({ project: { enterpriseId: query.enterpriseId } });
    }
    if (query.projectId) {
      filters.push({ projectId: query.projectId });
    }
    if (query.internalState) {
      filters.push({ internalState: query.internalState });
    }
    if (query.applicantStatus) {
      filters.push({ applicantStatus: query.applicantStatus });
    }
    if (query.submittedFrom) {
      filters.push({
        submittedAt: { gte: utcDate(query.submittedFrom, 'submittedFrom') },
      });
    }
    if (query.submittedTo) {
      const end = utcDate(query.submittedTo, 'submittedTo');
      end.setUTCDate(end.getUTCDate() + 1);
      filters.push({ submittedAt: { lt: end } });
    }
    if (query.assignedOfficerId) {
      filters.push({
        assignments: {
          some: { officerUserId: query.assignedOfficerId, endedAt: null },
        },
      });
    }
    if (query.unassigned === true) {
      filters.push({ assignments: { none: { endedAt: null } } });
    }
    if (query.q) {
      // Search text is DATA: Prisma's `contains` passes LIKE wildcards through,
      // so escape them ("%" must mean a percent sign, not "everything").
      const contains = {
        contains: escapeLike(query.q),
        mode: 'insensitive' as const,
      };
      filters.push({
        OR: [
          { referenceNumber: contains },
          { project: { name: contains } },
          { project: { referenceNumber: contains } },
          { project: { enterprise: { name: contains } } },
          { project: { enterprise: { referenceNumber: contains } } },
        ],
      });
    }
    const where: Prisma.ApprovalApplicationWhereInput = { AND: filters };

    const field = query.sort ?? 'submittedAt';
    const order = query.order ?? 'asc';
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.approvalApplication.count({ where }),
      this.prisma.approvalApplication.findMany({
        where,
        select: LIST_SELECT,
        // The id tie-break makes the order total, so pages never overlap or
        // skip even when many applications share a timestamp.
        orderBy: [{ [field]: order }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { items: rows.map(toSummary), page, pageSize, total };
  }

  async dashboard(userId: string): Promise<OfficerDashboardDto> {
    const grants = await this.access.grantsFor(userId);
    const visible = this.access.visibilityWhere(userId, grants);
    const adminDepartments = grants
      .filter((g) => g.role === 'DEPT_ADMIN')
      .map((g) => g.departmentId);

    const [
      byState,
      assignedToMe,
      unassigned,
      awaitingApplicant,
      awaitingDecision,
    ] = await Promise.all([
      this.prisma.approvalApplication.groupBy({
        by: ['internalState'],
        where: visible,
        _count: { _all: true },
      }),
      this.prisma.approvalApplication.count({
        where: {
          AND: [
            visible,
            { assignments: { some: { officerUserId: userId, endedAt: null } } },
          ],
        },
      }),
      adminDepartments.length === 0
        ? Promise.resolve(0)
        : this.prisma.approvalApplication.count({
            where: {
              approvalType: { departmentId: { in: adminDepartments } },
              internalState: { in: [...ASSIGNABLE_STATES] },
              assignments: { none: { endedAt: null } },
            },
          }),
      this.prisma.approvalApplication.count({
        where: { AND: [visible, { internalState: 'QUERY_RAISED' }] },
      }),
      this.prisma.approvalApplication.count({
        where: {
          AND: [visible, { internalState: 'RECOMMENDED_FOR_APPROVAL' }],
        },
      }),
    ]);
    return {
      roles: grants.map((g) => ({
        role: g.role,
        departmentId: g.departmentId,
      })),
      byState: Object.fromEntries(
        byState.map((r) => [r.internalState, r._count._all]),
      ),
      assignedToMe,
      unassigned,
      awaitingApplicant,
      awaitingDecision,
    };
  }

  // ---- one application ----------------------------------------------------

  /** Opens an application for scrutiny: the full working view. Recorded in the
   * audit trail (FRD 22.2 logs "open application"). */
  async detail(
    userId: string,
    applicationId: string,
    ipAddress: string,
  ): Promise<OfficerApplicationDetailDto> {
    const ctx = await this.access.resolveApplication(
      userId,
      applicationId,
      'VIEW',
    );
    const app = ctx.app;
    const [
      observations,
      queries,
      recommendations,
      history,
      documents,
      inspectionFacts,
      inspections,
      decision,
      certificate,
    ] = await Promise.all([
      this.prisma.scrutinyObservation.findMany({
        where: { applicationId: app.id },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
      this.prisma.applicationQuery.findMany({
        where: { applicationId: app.id },
        orderBy: { roundNumber: 'asc' },
      }),
      this.prisma.scrutinyRecommendation.findMany({
        where: { applicationId: app.id },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
      CAN_SEE_ASSIGNMENT_HISTORY.includes(ctx.actingRole)
        ? this.prisma.applicationAssignment.findMany({
            where: { applicationId: app.id },
            orderBy: [{ assignedAt: 'asc' }, { id: 'asc' }],
          })
        : Promise.resolve(null),
      this.documents.listForApplication(app.id, false, 'OFFICER'),
      loadInspectionFacts(this.prisma, app.id),
      loadInspectionsWithOutcome(this.prisma, app.id),
      this.prisma.approvalDecision.findUnique({
        where: { applicationId: app.id },
        include: DECISION_INCLUDE,
      }),
      this.prisma.approvalCertificate.findFirst({
        where: { applicationId: app.id },
        orderBy: { version: 'desc' },
        include: CERTIFICATE_INCLUDE,
      }),
    ]);

    await this.support.recordOfficerEvent(
      ctx,
      AuditActions.APPLICATION_OPENED_FOR_SCRUTINY,
      { internalState: app.internalState },
      ipAddress,
    );

    const assignment = app.assignments[0];
    return {
      id: app.id,
      referenceNumber: app.referenceNumber as string,
      approvalType: { id: app.approvalType.id, name: app.approvalType.name },
      department: {
        id: app.approvalType.department.id,
        code: app.approvalType.department.code,
        name: app.approvalType.department.name,
      },
      enterprise: {
        id: app.project.enterprise.id,
        referenceNumber: app.project.enterprise.referenceNumber,
        name: app.project.enterprise.name,
      },
      project: {
        id: app.project.id,
        referenceNumber: app.project.referenceNumber,
        name: app.project.name,
        district: app.project.district,
      },
      internalState: app.internalState,
      applicantStatus: app.applicantStatus,
      submittedAt: app.submittedAt as Date,
      updatedAt: app.updatedAt,
      assignedOfficer: assignment
        ? {
            userId: assignment.officerUserId,
            name: assignment.officer.name,
            assignedAt: assignment.assignedAt,
          }
        : null,
      awaitingApplicant: queries.some((q) => q.status !== 'CLOSED'),
      actingRole: ctx.actingRole,
      availableActions: this.availableActions(ctx),
      formData: (app.formData ?? {}) as Record<string, unknown>,
      declarationAcceptedAt: app.declarationAcceptedAt,
      submittedByUserId: app.submittedByUserId,
      enterpriseDetails: {
        id: app.project.enterprise.id,
        referenceNumber: app.project.enterprise.referenceNumber,
        name: app.project.enterprise.name,
        tradeName: app.project.enterprise.tradeName,
        businessType: app.project.enterprise.businessType,
        registrationNumber: app.project.enterprise.registrationNumber,
        registrationNumberType: app.project.enterprise.registrationNumberType,
        sector: app.project.enterprise.sector,
        address: app.project.enterprise.address,
        website: app.project.enterprise.website,
        contactPersonName: app.project.enterprise.contactPersonName,
      },
      projectDetails: toProjectResponse(app.project),
      submittedDocuments: app.submittedDocuments as Array<
        Record<string, unknown>
      > | null,
      documents,
      observations: observations.map(toObservationDto),
      queries: queries.map(toOfficerQueryDto),
      recommendations: recommendations.map(toRecommendationDto),
      decision: decision ? toDecisionDto(decision) : null,
      certificate: certificate ? toOfficerCertificateDto(certificate) : null,
      inspection: {
        required: inspectionFacts.required,
        open: inspectionFacts.open,
        completed: inspectionFacts.completed,
        recommendationBlockedBy: recommendationBlock(inspectionFacts),
        outcomes: inspections.flatMap((i) =>
          i.reportSummary
            ? [
                {
                  inspectionId: i.id,
                  scheduledAt: i.scheduledAt,
                  ...i.reportSummary,
                },
              ]
            : [],
        ),
      },
      assignmentHistory: history
        ? history.map((h) => ({
            id: h.id,
            officerUserId: h.officerUserId,
            assignedByUserId: h.assignedByUserId,
            assignedAt: h.assignedAt,
            endedAt: h.endedAt,
            endReason: h.endReason,
          }))
        : null,
    };
  }

  /** What this caller could do next (advisory: each is re-checked on use). */
  private availableActions(ctx: OfficerApplicationContext): string[] {
    const capabilities = ROLE_CAPABILITIES[ctx.actingRole];
    const state = ctx.app.internalState;
    const actions: string[] = [];
    // The Approving Authority's statutory acts (Step 15), by state alone: it
    // is not assigned applications, it works its department's decision desk.
    if (capabilities.has('DECIDE') || capabilities.has('ISSUE_CERTIFICATE')) {
      for (const action of authorityActionsFrom(state)) {
        if (action === 'ISSUE_CERTIFICATE') {
          if (capabilities.has('ISSUE_CERTIFICATE')) {
            actions.push(action);
          }
        } else if (capabilities.has('DECIDE') && !actions.includes('DECIDE')) {
          actions.push('DECIDE');
        }
      }
    }
    if (capabilities.has('ASSIGN') && ASSIGNABLE_STATES.includes(state)) {
      actions.push(ctx.app.assignments[0] ? 'REASSIGN' : 'ASSIGN');
    }
    if (ctx.assignedToMe) {
      for (const action of officerActionsFrom(state)) {
        const needed =
          action === 'START_SCRUTINY'
            ? 'START_SCRUTINY'
            : action === 'RAISE_QUERY'
              ? 'RAISE_QUERY'
              : action === 'CLOSE_QUERY'
                ? 'CLOSE_QUERY'
                : 'RECOMMEND';
        if (capabilities.has(needed)) {
          actions.push(action);
        }
      }
      if (
        capabilities.has('RECORD_OBSERVATION') &&
        WORKING_STATES.includes(state)
      ) {
        actions.push('RECORD_OBSERVATION');
      }
      if (
        capabilities.has('REVIEW_DOCUMENT') &&
        DOCUMENT_REVIEW_STATES.includes(state)
      ) {
        actions.push('REVIEW_DOCUMENT');
      }
    }
    return actions;
  }

  // ---- the stored discovery context --------------------------------------

  /**
   * The Step 7 discovery result this application was started from, read back
   * from the IMMUTABLE snapshot — discovery is never re-run, so a later rule
   * change cannot alter what the officer sees about why the approval was
   * suggested. Recommendation, not determination.
   */
  async discovery(
    userId: string,
    applicationId: string,
  ): Promise<OfficerDiscoveryDto> {
    const ctx = await this.access.resolveApplication(
      userId,
      applicationId,
      'VIEW',
    );
    const app = ctx.app;
    if (!app.discoverySnapshotId) {
      throw new NotFoundException({
        code: ErrorCodes.NOT_FOUND,
        message: 'No discovery context was recorded for this application.',
      });
    }
    const snapshot = await this.prisma.discoverySnapshot.findUnique({
      where: { id: app.discoverySnapshotId },
    });
    const result = snapshot?.result as unknown as
      DiscoveryEngineResult | undefined;
    const entry = result?.applicable?.find(
      (a) => a.approvalType.id === app.approvalTypeId,
    );
    if (!snapshot || !entry) {
      throw new NotFoundException({
        code: ErrorCodes.NOT_FOUND,
        message: 'No discovery context was recorded for this application.',
      });
    }
    return {
      snapshotId: snapshot.id,
      snapshotEvaluatedAt: snapshot.evaluatedAt.toISOString(),
      engineVersion: snapshot.engineVersion,
      approvalType: {
        id: entry.approvalType.id,
        name: entry.approvalType.name,
      },
      department: { ...entry.department },
      recommendationLabel: entry.label,
      rule: { ...entry.rule },
      explanation: entry.explanation,
      dependsOn: entry.dependsOn.map((d) => ({ ...d })),
      trace: entry.trace as unknown as Record<string, unknown>,
      notice: `${DISCOVERY_NOTICE} ${DISCOVERY_CONTEXT_NOTE}`,
    };
  }

  // ---- documents (Step 9 storage, officer access) -------------------------

  /** An application's documents, current versions (or all with history). */
  async listDocuments(
    userId: string,
    applicationId: string,
    includeHistory: boolean,
  ): Promise<DocumentResponseDto[]> {
    const ctx = await this.access.resolveApplication(
      userId,
      applicationId,
      'VIEW',
    );
    return this.documents.listForApplication(
      ctx.app.id,
      includeHistory,
      'OFFICER',
    );
  }

  async getDocument(
    userId: string,
    applicationId: string,
    documentId: string,
  ): Promise<DocumentResponseDto> {
    const ctx = await this.access.resolveApplication(
      userId,
      applicationId,
      'VIEW',
    );
    return this.documents.getForApplication(ctx.app.id, documentId, 'OFFICER');
  }

  async documentVersions(
    userId: string,
    applicationId: string,
    documentId: string,
  ): Promise<DocumentResponseDto[]> {
    const ctx = await this.access.resolveApplication(
      userId,
      applicationId,
      'VIEW',
    );
    return this.documents.versionsForApplication(
      ctx.app.id,
      documentId,
      'OFFICER',
    );
  }

  /**
   * The file itself. Authorised as the application (department scope +
   * assignment); the document is found only through the application; the
   * Step 9 rules apply unchanged — scanned and not rejected, checksum
   * re-verified, no storage key ever exposed — and the download is audited
   * with the officer's role and department.
   */
  async downloadDocument(
    userId: string,
    applicationId: string,
    documentId: string,
    ipAddress: string,
  ): Promise<{ data: Buffer; filename: string; mimeType: string }> {
    const ctx = await this.access.resolveApplication(
      userId,
      applicationId,
      'VIEW',
    );
    return this.documents.downloadForApplication(
      { id: ctx.app.id, projectId: ctx.app.projectId },
      documentId,
      { userId, roleAtTime: ctx.actingRole },
      this.support.contextOf(ctx),
      ipAddress,
    );
  }

  // ---- history ------------------------------------------------------------

  async history(
    userId: string,
    applicationId: string,
  ): Promise<HistoryEntryDto[]> {
    const ctx = await this.access.resolveApplication(
      userId,
      applicationId,
      'VIEW',
    );
    const links = await this.prisma.applicationDocument.findMany({
      where: { applicationId: ctx.app.id },
      select: { documentId: true },
    });
    const events = await this.prisma.auditLog.findMany({
      where: {
        entityId: { in: [ctx.app.id, ...links.map((l) => l.documentId)] },
        action: { in: Object.keys(HISTORY_SUMMARIES) },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: HISTORY_LIMIT,
    });
    return events.map((e) => {
      const after = (e.afterState ?? {}) as Record<string, unknown>;
      const before = (e.beforeState ?? {}) as Record<string, unknown>;
      return {
        at: e.createdAt,
        action: e.action,
        summary: HISTORY_SUMMARIES[e.action](after, before),
        actorRole: e.roleAtTime,
        actorUserId: e.userId,
        from:
          typeof before.internalState === 'string'
            ? before.internalState
            : null,
        to:
          e.action === AuditActions.APPLICATION_STATUS_CHANGED &&
          typeof after.internalState === 'string'
            ? after.internalState
            : null,
      };
    });
  }
}
