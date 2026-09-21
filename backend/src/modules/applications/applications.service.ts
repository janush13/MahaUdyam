import { isDeepStrictEqual } from 'node:util';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ErrorCodes } from '../../common/constants/error-codes.constant';
import { AuditActions } from '../../infrastructure/audit/audit-actions.constant';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { EnterpriseAccess } from '../enterprises/interfaces/enterprise-access.interface';
import {
  CURRENT_VERSION,
  documentIssues,
  satisfiedRequirementIds,
} from '../documents/document-queries';
import { DiscoveryEngineResult } from '../discovery/engine/discovery-engine';
import {
  ApplicationDiscoveryContext,
  buildDiscoveryContext,
  ruleVersionLabel,
} from './application-discovery-context';
import { validateFormData } from './application-form-data';
import {
  ValidationSummary,
  evaluateSubmissionReadiness,
} from './application-readiness';
import {
  LIVE_STATES,
  applicantStatusFor,
  findTransition,
  isEditable,
} from './application-state.machine';
import { NotificationEventsService } from '../notifications/notification-events.service';
import { SlaLifecycleService } from '../sla/sla-lifecycle.service';
import { DISCOVERY_CONTEXT_NOTE } from './constants/application.constants';
import {
  ApplicationResponseDto,
  ApplicationStatusDto,
} from './dto/application-response.dto';
import { CreateApplicationDto } from './dto/create-application.dto';
import {
  ListApplicationsQueryDto,
  ListEnterpriseApplicationsQueryDto,
} from './dto/list-applications-query.dto';
import { SubmitApplicationDto } from './dto/submit-application.dto';
import { UpdateApplicationDraftDto } from './dto/update-application-draft.dto';

const APPLICANT_ROLE = 'APPLICANT';

const APPLICATION_INCLUDE = {
  approvalType: { include: { department: true } },
  project: { select: { referenceNumber: true, enterpriseId: true } },
} satisfies Prisma.ApprovalApplicationInclude;

type ApplicationRow = Prisma.ApprovalApplicationGetPayload<{
  include: typeof APPLICATION_INCLUDE;
}>;

function formDataOf(row: { formData: Prisma.JsonValue }) {
  return validateFormData(row.formData).data;
}

export function toApplicationResponse(
  row: ApplicationRow,
): ApplicationResponseDto {
  const context =
    row.discoveryContext as unknown as ApplicationDiscoveryContext | null;
  return {
    id: row.id,
    referenceNumber: row.referenceNumber,
    // From the project, never from the client.
    enterpriseId: row.project.enterpriseId,
    projectId: row.projectId,
    projectReferenceNumber: row.project.referenceNumber,
    approvalType: {
      id: row.approvalType.id,
      name: row.approvalType.name,
      legalName: row.approvalType.legalName,
      department: {
        id: row.approvalType.department.id,
        code: row.approvalType.department.code,
        name: row.approvalType.department.name,
      },
    },
    applicantStatus: row.applicantStatus,
    editable: isEditable(row.internalState),
    formData: formDataOf(row),
    discovery:
      row.discoverySnapshotId && context
        ? { ...context, note: DISCOVERY_CONTEXT_NOTE }
        : null,
    submittedAt: row.submittedAt,
    declarationAcceptedAt: row.declarationAcceptedAt,
    createdByUserId: row.createdByUserId,
    submittedByUserId: row.submittedByUserId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function notFound(what: string): NotFoundException {
  return new NotFoundException({
    code: ErrorCodes.NOT_FOUND,
    message: `${what} not found.`,
  });
}

function formDataError(errors: Record<string, string[]>): BadRequestException {
  return new BadRequestException({
    code: ErrorCodes.VALIDATION_ERROR,
    message: 'Validation failed',
    fields: errors,
  });
}

/**
 * Application lifecycle (FRD §12, §16–§18; Blueprint ApplicationModule):
 * create a draft from a stored discovery result, edit it while it is a draft,
 * validate it, submit it, read it and its status.
 *
 * AUTHORISATION is NOT decided here. Every route is protected by the
 * existing EnterpriseAccessGuard, which resolves the caller's relationship to
 * the enterprise (owner, or a live representative with a sufficient scope and,
 * if restricted, this project in their list) BEFORE any method runs. This
 * service receives that decision as `access`, never trusts a client-supplied
 * enterprise / owner / project, and reads only inside the authorised
 * enterprise — so another enterprise's project or application is
 * indistinguishable from a nonexistent one.
 *
 * STATUS: clients can never set a status. The two layers (internal state /
 * applicant status) change only inside this service, through the explicit
 * transition methods, validated by application-state.machine. The only
 * executable transition is DRAFT -> SUBMITTED.
 *
 * DISCOVERY vs DETERMINATION: an application records the persisted discovery
 * snapshot it was started from (foreign key + an immutable copy of the matched
 * rule context). Discovery is never silently re-run, and later rule changes
 * cannot alter an existing application. Creating or submitting an application
 * is not a statutory decision — that stays with the department.
 */
@Injectable()
export class ApplicationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly sla: SlaLifecycleService,
    private readonly notifications: NotificationEventsService,
  ) {}

  // ---------------------------------------------------------------------
  // Create
  // ---------------------------------------------------------------------

  async create(
    access: EnterpriseAccess,
    projectId: string,
    actorUserId: string,
    dto: CreateApplicationDto,
    ipAddress: string,
  ): Promise<ApplicationResponseDto> {
    const form = validateFormData(dto.formData ?? {});
    if (Object.keys(form.errors).length > 0) {
      throw formDataError(form.errors);
    }

    const project = await this.findProject(access, projectId);

    // The discovery result must be this project's own stored snapshot.
    const snapshot = await this.prisma.discoverySnapshot.findFirst({
      where: { id: dto.discoverySnapshotId, projectId: project.id },
    });
    if (!snapshot) {
      throw notFound('Discovery result');
    }
    const result = snapshot.result as unknown as DiscoveryEngineResult;
    const entry = Array.isArray(result?.applicable)
      ? result.applicable.find((a) => a.approvalType.id === dto.approvalTypeId)
      : undefined;
    if (!entry) {
      throw new UnprocessableEntityException({
        code: ErrorCodes.APPROVAL_NOT_IN_DISCOVERY,
        message:
          'That approval was not among the applicable approvals of the cited discovery result.',
      });
    }

    const approvalType = await this.prisma.approvalType.findUnique({
      where: { id: dto.approvalTypeId },
    });
    if (!approvalType) {
      throw notFound('Approval');
    }
    if (!approvalType.isActive) {
      throw new ConflictException({
        code: ErrorCodes.APPROVAL_TYPE_INACTIVE,
        message: 'This approval is no longer available for new applications.',
      });
    }

    // The workflow version is pinned at creation (Blueprint §9.3) so a later
    // workflow change cannot re-route an existing application.
    const workflow = await this.prisma.workflow.findFirst({
      where: { approvalTypeId: approvalType.id, isActive: true },
      orderBy: { version: 'desc' },
    });
    if (!workflow) {
      throw new ConflictException({
        code: ErrorCodes.WORKFLOW_NOT_CONFIGURED,
        message:
          'The department has not yet configured how this approval is processed, so an application cannot be started.',
      });
    }

    const context = buildDiscoveryContext(snapshot, entry);
    const readiness = await this.readiness({
      applicationId: null,
      approvalTypeId: approvalType.id,
      approvalTypeActive: true,
      internalState: 'DRAFT',
      formDataErrors: {},
    });

    const created = await this.prisma.$transaction(async (tx) => {
      // Serialise concurrent creates for one (project, approval) so the
      // one-live-application rule cannot be raced past.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`application:${project.id}:${approvalType.id}`}, 0))`;

      const existing = await tx.approvalApplication.findFirst({
        where: {
          projectId: project.id,
          approvalTypeId: approvalType.id,
          internalState: { in: LIVE_STATES },
        },
        select: { id: true },
      });
      if (existing) {
        throw new ConflictException({
          code: ErrorCodes.APPLICATION_ALREADY_EXISTS,
          message: `An application for this approval already exists for this project (application ${existing.id}).`,
        });
      }

      return tx.approvalApplication.create({
        data: {
          projectId: project.id,
          approvalTypeId: approvalType.id,
          workflowId: workflow.id,
          internalState: 'DRAFT',
          applicantStatus:
            applicantStatusFor('DRAFT', readiness.readyForSubmission) ??
            'DRAFT',
          discoverySnapshotId: snapshot.id,
          discoveryContext: context as unknown as Prisma.InputJsonValue,
          formData: form.data as Prisma.InputJsonValue,
          createdByUserId: actorUserId,
        },
        include: APPLICATION_INCLUDE,
      });
    });

    await this.audit.record({
      userId: actorUserId,
      roleAtTime: APPLICANT_ROLE,
      action: AuditActions.APPLICATION_CREATED,
      entityType: 'ApprovalApplication',
      entityId: created.id,
      afterState: {
        ...this.auditContext(access, project.id),
        approvalTypeId: approvalType.id,
        workflowId: workflow.id,
        workflowVersion: workflow.version,
        discoverySnapshotId: snapshot.id,
        recommendationLabel: context.recommendationLabel,
        ruleId: context.rule.id,
        ruleVersion: context.rule.version,
        internalState: created.internalState,
        applicantStatus: created.applicantStatus,
      },
      ipAddress,
      ruleVersionUsed: ruleVersionLabel(context),
    });

    return toApplicationResponse(created);
  }

  // ---------------------------------------------------------------------
  // Read
  // ---------------------------------------------------------------------

  /** Applications of one project. A project-restricted representative
   * reaches this only for a project in their list (guard). */
  async listForProject(
    access: EnterpriseAccess,
    projectId: string,
    query: ListApplicationsQueryDto,
  ): Promise<ApplicationResponseDto[]> {
    const project = await this.findProject(access, projectId);
    const rows = await this.prisma.approvalApplication.findMany({
      where: {
        projectId: project.id,
        ...(query.approvalTypeId
          ? { approvalTypeId: query.approvalTypeId }
          : {}),
        ...(query.applicantStatus
          ? { applicantStatus: query.applicantStatus }
          : {}),
      },
      include: APPLICATION_INCLUDE,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return rows.map(toApplicationResponse);
  }

  /** Applications across the enterprise. A project-restricted representative
   * sees only applications of their authorised projects. */
  async listForEnterprise(
    access: EnterpriseAccess,
    query: ListEnterpriseApplicationsQueryDto,
  ): Promise<ApplicationResponseDto[]> {
    const restricted = access.scopedProjectIds.length > 0;
    if (
      restricted &&
      query.projectId &&
      !access.scopedProjectIds.includes(query.projectId)
    ) {
      return [];
    }
    const rows = await this.prisma.approvalApplication.findMany({
      where: {
        project: { enterpriseId: access.enterprise.id },
        ...(restricted ? { projectId: { in: access.scopedProjectIds } } : {}),
        ...(query.projectId ? { projectId: query.projectId } : {}),
        ...(query.approvalTypeId
          ? { approvalTypeId: query.approvalTypeId }
          : {}),
        ...(query.applicantStatus
          ? { applicantStatus: query.applicantStatus }
          : {}),
      },
      include: APPLICATION_INCLUDE,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return rows.map(toApplicationResponse);
  }

  async get(
    access: EnterpriseAccess,
    projectId: string,
    applicationId: string,
  ): Promise<ApplicationResponseDto> {
    return toApplicationResponse(
      await this.findApplication(access, projectId, applicationId),
    );
  }

  async getStatus(
    access: EnterpriseAccess,
    projectId: string,
    applicationId: string,
  ): Promise<ApplicationStatusDto> {
    const row = await this.findApplication(access, projectId, applicationId);
    return {
      id: row.id,
      referenceNumber: row.referenceNumber,
      applicantStatus: row.applicantStatus,
      editable: isEditable(row.internalState),
      submittedAt: row.submittedAt,
      updatedAt: row.updatedAt,
    };
  }

  // ---------------------------------------------------------------------
  // Edit a draft
  // ---------------------------------------------------------------------

  async updateDraft(
    access: EnterpriseAccess,
    projectId: string,
    applicationId: string,
    actorUserId: string,
    dto: UpdateApplicationDraftDto,
    ipAddress: string,
  ): Promise<ApplicationResponseDto> {
    const current = await this.findApplication(
      access,
      projectId,
      applicationId,
    );
    if (!isEditable(current.internalState)) {
      throw this.alreadySubmitted();
    }
    const form = validateFormData(dto.formData);
    if (Object.keys(form.errors).length > 0) {
      throw formDataError(form.errors);
    }

    const before = formDataOf(current);
    if (isDeepStrictEqual(before, form.data)) {
      return toApplicationResponse(current);
    }

    const readiness = await this.readiness({
      applicationId: current.id,
      approvalTypeId: current.approvalTypeId,
      approvalTypeActive: current.approvalType.isActive,
      internalState: current.internalState,
      formDataErrors: {},
    });
    const applicantStatus =
      applicantStatusFor('DRAFT', readiness.readyForSubmission) ?? 'DRAFT';

    // Atomic: only while STILL a draft, so an edit racing a submission can
    // never change submitted data (FRD §17.3).
    const { count } = await this.prisma.approvalApplication.updateMany({
      where: { id: current.id, internalState: 'DRAFT' },
      data: {
        formData: form.data as Prisma.InputJsonValue,
        applicantStatus,
      },
    });
    if (count !== 1) {
      throw this.alreadySubmitted();
    }

    const changedKeys = [
      ...new Set([...Object.keys(before), ...Object.keys(form.data)]),
    ].filter((k) => !isDeepStrictEqual(before[k], form.data[k]));
    const previous: Record<string, unknown> = {};
    const changes: Record<string, unknown> = {};
    for (const key of changedKeys) {
      previous[key] = before[key] ?? null;
      changes[key] = form.data[key] ?? null;
    }

    await this.audit.record({
      userId: actorUserId,
      roleAtTime: APPLICANT_ROLE,
      action: AuditActions.APPLICATION_UPDATED,
      entityType: 'ApprovalApplication',
      entityId: current.id,
      beforeState: {
        formData: previous,
        applicantStatus: current.applicantStatus,
      },
      afterState: {
        ...this.auditContext(access, current.projectId),
        formData: changes,
        applicantStatus,
      },
      ipAddress,
      ruleVersionUsed: ruleVersionLabel(
        current.discoveryContext as unknown as ApplicationDiscoveryContext,
      ),
    });

    return toApplicationResponse(
      await this.findApplication(access, projectId, applicationId),
    );
  }

  // ---------------------------------------------------------------------
  // Validate + submit
  // ---------------------------------------------------------------------

  /** Pre-submission validation summary (FRD §16). Read-only: changes nothing
   * and is not audited. */
  async preValidate(
    access: EnterpriseAccess,
    projectId: string,
    applicationId: string,
  ): Promise<ValidationSummary> {
    const row = await this.findApplication(access, projectId, applicationId);
    if (!isEditable(row.internalState)) {
      throw this.alreadySubmitted();
    }
    return this.summaryFor(row);
  }

  async submit(
    access: EnterpriseAccess,
    projectId: string,
    applicationId: string,
    actorUserId: string,
    _dto: SubmitApplicationDto,
    ipAddress: string,
  ): Promise<ApplicationResponseDto> {
    const row = await this.findApplication(access, projectId, applicationId);

    // The ONLY way an application leaves DRAFT: an explicit, validated
    // transition — never a client-supplied status.
    const transition = findTransition('SUBMIT', row.internalState);
    if (!transition) {
      // Anything already submitted is "already submitted"; a state that was
      // never submitted but has no SUBMIT arrow (e.g. cancelled) is simply an
      // undefined transition.
      throw row.submittedAt !== null
        ? this.alreadySubmitted()
        : new ConflictException({
            code: ErrorCodes.INVALID_STATE_TRANSITION,
            message: 'This application cannot be submitted from its state.',
          });
    }

    // Re-validated at the moment of submission; the summary a client saw
    // earlier is never trusted.
    const summary = await this.summaryFor(row);
    if (!summary.readyForSubmission) {
      const fields: Record<string, string[]> = {};
      for (const issue of summary.errors) {
        (fields[issue.field ?? issue.code] ??= []).push(issue.message);
      }
      if (summary.missingDocuments.length > 0) {
        fields.documents = summary.missingDocuments.map(
          (d) => `Missing mandatory document: ${d.name}`,
        );
      }
      throw new UnprocessableEntityException({
        code: ErrorCodes.VALIDATION_FAILED,
        message:
          'The application cannot be submitted until the listed problems are fixed.',
        fields,
      });
    }

    const submittedDocuments = await this.currentDocumentsSnapshot(row.id);

    const [{ ref }] = await this.prisma.$queryRaw<Array<{ ref: string }>>`
      SELECT 'APP-' || to_char(now(), 'YYYY') || '-' ||
             lpad(nextval('application_reference_seq')::text, 6, '0') AS ref`;
    const now = new Date();
    const to = transition.to;
    const toApplicant = applicantStatusFor(to);
    if (!toApplicant) {
      // Unreachable: SUBMITTED always maps. Fail closed rather than guess.
      throw new ConflictException({
        code: ErrorCodes.INVALID_STATE_TRANSITION,
        message: 'No applicant-facing status is defined for this transition.',
      });
    }

    // Atomic and optimistic: only if STILL the same draft that was validated.
    // The SLA clock of the scrutiny stage starts in the SAME transaction (TRD
    // 12: "the SLA clock starts on submission"), so an application is never
    // submitted without its clock, nor a clock started for a submission that
    // lost the race.
    const { count, slaEvents } = await this.prisma.$transaction(async (tx) => {
      const result = await tx.approvalApplication.updateMany({
        where: {
          id: row.id,
          internalState: transition.from,
          updatedAt: row.updatedAt,
        },
        data: {
          internalState: to,
          applicantStatus: toApplicant,
          submittedAt: now,
          submittedByUserId: actorUserId,
          declarationAcceptedAt: now,
          referenceNumber: ref,
          submittedDocuments: submittedDocuments as Prisma.InputJsonValue,
        },
      });
      return {
        count: result.count,
        slaEvents:
          result.count === 1
            ? await this.sla.startAtSubmission(tx, row.id, now)
            : [],
      };
    });
    if (count !== 1) {
      const latest = await this.findApplication(
        access,
        projectId,
        applicationId,
      );
      throw isEditable(latest.internalState)
        ? new ConflictException({
            code: ErrorCodes.CONFLICT,
            message:
              'The application was changed while it was being submitted. Review it and submit again.',
          })
        : this.alreadySubmitted();
    }

    const context =
      row.discoveryContext as unknown as ApplicationDiscoveryContext | null;
    const ruleVersionUsed = ruleVersionLabel(context);
    const base = this.auditContext(access, row.projectId);

    await this.audit.record({
      userId: actorUserId,
      roleAtTime: APPLICANT_ROLE,
      action: AuditActions.APPLICATION_STATUS_CHANGED,
      entityType: 'ApprovalApplication',
      entityId: row.id,
      beforeState: {
        internalState: row.internalState,
        applicantStatus: row.applicantStatus,
      },
      afterState: {
        ...base,
        action: transition.action,
        internalState: to,
        applicantStatus: toApplicant,
      },
      ipAddress,
      ruleVersionUsed,
    });
    await this.audit.record({
      userId: actorUserId,
      roleAtTime: APPLICANT_ROLE,
      action: AuditActions.APPLICATION_SUBMITTED,
      entityType: 'ApprovalApplication',
      entityId: row.id,
      afterState: {
        ...base,
        referenceNumber: ref,
        approvalTypeId: row.approvalTypeId,
        workflowId: row.workflowId,
        // "Which discovery context was used when this was submitted?"
        discoverySnapshotId: row.discoverySnapshotId,
        recommendationLabel: context?.recommendationLabel ?? null,
        ruleId: context?.rule.id ?? null,
        ruleVersion: context?.rule.version ?? null,
        declarationAccepted: true,
        // Which document versions were used when this was submitted.
        documents: submittedDocuments.map((d) => ({
          documentId: d.documentId,
          version: d.version,
          requirementId: d.requirementId,
        })),
      },
      ipAddress,
      ruleVersionUsed,
    });
    await this.sla.record(slaEvents, {
      userId: actorUserId,
      roleAtTime: APPLICANT_ROLE,
      ipAddress,
      context: base,
      ruleVersionUsed,
    });
    // After the commit and the audit, never able to fail the submission.
    await this.notifications.applicationSubmitted(row.id);

    return toApplicationResponse(
      await this.findApplication(access, projectId, applicationId),
    );
  }

  // ---------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------

  private alreadySubmitted(): ConflictException {
    return new ConflictException({
      code: ErrorCodes.ALREADY_SUBMITTED,
      message:
        'This application has been submitted and can no longer be edited or submitted again.',
    });
  }

  /** Actor context recorded on every audit entry: who acted for whom, in
   * which relationship (FRD §20.5). */
  private auditContext(access: EnterpriseAccess, projectId: string) {
    return {
      enterpriseId: access.enterprise.id,
      projectId,
      actingAs: access.relation,
      representativeScope: access.scope ?? null,
    };
  }

  private summaryFor(
    row: ApplicationRow,
    db: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<ValidationSummary> {
    return this.readiness(
      {
        applicationId: row.id,
        approvalTypeId: row.approvalTypeId,
        approvalTypeActive: row.approvalType.isActive,
        internalState: row.internalState,
        formDataErrors: validateFormData(row.formData).errors,
      },
      db,
    );
  }

  /**
   * Re-derives a draft's applicant-facing status ("Draft" / "Ready to Submit")
   * after something it depends on changed - the document module calls this
   * inside its own transaction when a document is added or replaced. Bumps
   * `updated_at`, so a submission that read the application earlier fails its
   * optimistic check instead of submitting stale data. No-op for anything that
   * is not a draft.
   */
  async syncDraftStatus(
    db: Prisma.TransactionClient,
    applicationId: string,
  ): Promise<void> {
    const row = await db.approvalApplication.findUnique({
      where: { id: applicationId },
      include: APPLICATION_INCLUDE,
    });
    if (!row || !isEditable(row.internalState)) {
      return;
    }
    const summary = await this.summaryFor(row, db);
    await db.approvalApplication.updateMany({
      where: { id: row.id, internalState: 'DRAFT' },
      data: {
        applicantStatus:
          applicantStatusFor('DRAFT', summary.readyForSubmission) ?? 'DRAFT',
        updatedAt: new Date(),
      },
    });
  }

  /** The document versions that are current for this application right now,
   * frozen onto it at submission (Step 9 historical correctness). */
  private async currentDocumentsSnapshot(applicationId: string) {
    const links = await this.prisma.applicationDocument.findMany({
      where: { applicationId, document: { ...CURRENT_VERSION } },
      select: { document: true },
    });
    return links
      .map(({ document: d }) => ({
        documentId: d.id,
        version: d.version,
        lineageId: d.lineageId,
        requirementId: d.documentRequirementId,
        originalFilename: d.originalFilename,
        mimeType: d.mimeType,
        sizeBytes: d.sizeBytes,
        checksum: d.checksum,
        status: d.status,
        scannedAt: d.scannedAt?.toISOString() ?? null,
        scannerName: d.scannerName,
        expiryDate: d.expiryDate?.toISOString().slice(0, 10) ?? null,
        uploadedAt: d.createdAt.toISOString(),
      }))
      .sort((x, y) =>
        x.uploadedAt === y.uploadedAt
          ? x.documentId < y.documentId
            ? -1
            : 1
          : x.uploadedAt < y.uploadedAt
            ? -1
            : 1,
      );
  }

  /** Loads the facts the pure readiness evaluator needs. */
  private async readiness(
    input: {
      applicationId: string | null;
      approvalTypeId: string;
      approvalTypeActive: boolean;
      internalState: ApplicationRow['internalState'];
      formDataErrors: Record<string, string[]>;
    },
    db: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<ValidationSummary> {
    const mandatory = await db.documentRequirement.findMany({
      where: { approvalTypeId: input.approvalTypeId, isMandatory: true },
      select: { id: true, name: true },
    });
    const satisfied = input.applicationId
      ? await satisfiedRequirementIds(
          db,
          input.applicationId,
          mandatory.map((r) => r.id),
        )
      : new Set<string>();
    const issues = input.applicationId
      ? await documentIssues(db, input.applicationId)
      : [];
    return evaluateSubmissionReadiness({
      internalState: input.internalState,
      approvalTypeActive: input.approvalTypeActive,
      formDataErrors: input.formDataErrors,
      mandatoryRequirements: mandatory,
      satisfiedRequirementIds: satisfied,
      documentIssues: issues,
    });
  }

  /** Always scoped to the authorised enterprise, so a project id belonging
   * to another enterprise is indistinguishable from a nonexistent one. */
  private async findProject(access: EnterpriseAccess, projectId: string) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, enterpriseId: access.enterprise.id },
    });
    if (!project) {
      throw notFound('Project');
    }
    return project;
  }

  /** Scoped by application id AND project AND the authorised enterprise. */
  async findApplication(
    access: EnterpriseAccess,
    projectId: string,
    applicationId: string,
  ): Promise<ApplicationRow> {
    const row = await this.prisma.approvalApplication.findFirst({
      where: {
        id: applicationId,
        projectId,
        project: { enterpriseId: access.enterprise.id },
      },
      include: APPLICATION_INCLUDE,
    });
    if (!row) {
      throw notFound('Application');
    }
    return row;
  }
}
