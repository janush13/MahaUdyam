import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ErrorCodes } from '../../common/constants/error-codes.constant';
import { AuditActions } from '../../infrastructure/audit/audit-actions.constant';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { buildDiscoveryInputs } from '../discovery/engine/discovery-fields';
import { EnterpriseAccess } from '../enterprises/interfaces/enterprise-access.interface';
import { ListSchemeApplicationsQueryDto } from './dto/scheme-request.dto';
import { SchemeApplicationDto } from './dto/scheme-response.dto';
import { SCHEME_ENGINE_VERSION, evaluateSchemeRule } from './scheme-engine';
import { SchemeBrowseService } from './scheme-browse.service';
import { SchemeRulesService } from './scheme-rules.service';
import { LIVE_SCHEME_STATUSES } from './scheme.constants';
import {
  APPLICATION_INCLUDE,
  ApplicationRow,
  CatalogueSnapshot,
  isApplicationOpen,
  toSchemeApplicationDto,
} from './scheme.mappers';

const APPLICANT_ROLE = 'APPLICANT';

const notFound = (what: string) =>
  new NotFoundException({
    code: ErrorCodes.NOT_FOUND,
    message: `${what} not found.`,
  });

/**
 * A scheme application from the applicant's side (FRD 29.5, Blueprint 13.9
 * `POST /schemes/:id/apply`, `GET /scheme-applications/:id`).
 *
 *  - APPLYING is the applicant's one action: it creates the application in the
 *    documented first status (APPLIED) with a reference number and a history
 *    entry. Recommendation and application are two distinct steps (FRD 29.4):
 *    a scheme need not have been recommended to be applied for, and having been
 *    recommended gives no advantage - the Scheme Officer decides.
 *  - What is frozen on the application: the catalogue entry as it read, and what
 *    the system suggested for the project at that moment. Later catalogue edits
 *    or rule changes cannot rewrite either.
 *  - After that the applicant can only READ it (and add evidence, see the
 *    evidence service). There is NO route that sets a status: it moves only
 *    through the Scheme Officer's explicit actions.
 *
 * Authorisation is NOT decided here: routes are protected by the existing
 * EnterpriseAccessGuard, which resolves the caller's relationship to the
 * enterprise (owner, or a live representative with a sufficient scope and,
 * if restricted, this project in their list) BEFORE any method runs. This
 * service receives that decision as `access`, never trusts a client-supplied
 * enterprise / project / owner, and reads only inside the authorised enterprise.
 */
@Injectable()
export class SchemeApplicationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly browse: SchemeBrowseService,
    private readonly rules: SchemeRulesService,
  ) {}

  async apply(
    access: EnterpriseAccess,
    projectId: string,
    schemeId: string,
    actorUserId: string,
    ipAddress: string,
  ): Promise<SchemeApplicationDto> {
    const project = await this.findProject(access, projectId);
    const scheme = await this.browse.findAvailable(schemeId);
    const now = new Date();
    if (!isApplicationOpen(scheme.applicationDeadline, now)) {
      throw new ConflictException({
        code: ErrorCodes.SCHEME_APPLICATION_CLOSED,
        message: 'The application deadline for this scheme has passed.',
      });
    }

    // What the system suggests for THIS project (recorded, never decisive).
    const [descriptor] = await this.rules.loadEffectiveRules(now, scheme.id);
    const outcome = descriptor
      ? evaluateSchemeRule(
          descriptor,
          buildDiscoveryInputs(project, access.enterprise),
        )
      : null;
    const snapshot: CatalogueSnapshot = {
      scheme: {
        id: scheme.id,
        name: scheme.name,
        version: scheme.version,
        departmentId: scheme.departmentId,
        benefits: scheme.benefits,
        benefitType: scheme.benefitType,
        eligibilityCriteria: scheme.eligibilityCriteria,
        applicationDeadline: scheme.applicationDeadline?.toISOString() ?? null,
        sourceReference: scheme.sourceReference,
      },
      recommendation: {
        status: !outcome
          ? 'NO_RULE'
          : outcome.kind === 'RECOMMENDED'
            ? 'RECOMMENDED'
            : outcome.reason === 'DEFINITION_INVALID'
              ? 'RULE_INVALID'
              : 'NOT_RECOMMENDED',
        rule: descriptor
          ? {
              id: descriptor.ruleId,
              version: descriptor.version,
              priority: descriptor.priority,
              sourceReference: descriptor.sourceReference,
              effectiveFrom: descriptor.effectiveFrom,
            }
          : null,
        explanation: outcome?.explanation ?? null,
        engineVersion: SCHEME_ENGINE_VERSION,
        evaluatedAt: now.toISOString(),
      },
    };

    const created = await this.prisma.$transaction(async (tx) => {
      // Serialise concurrent applications for one (project, scheme) so the
      // one-live-application rule cannot be raced past.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`scheme-application:${project.id}:${scheme.id}`}, 0))`;
      // A scheme cannot be withdrawn from under an application being made.
      await tx.$queryRaw`SELECT id FROM schemes WHERE id = ${scheme.id}::uuid FOR SHARE`;
      const stillAvailable = await tx.scheme.findFirst({
        where: {
          id: scheme.id,
          publishStatus: 'PUBLISHED',
          isActive: true,
        },
        select: { id: true },
      });
      if (!stillAvailable) {
        throw notFound('Scheme');
      }
      const existing = await tx.schemeApplication.findFirst({
        where: {
          projectId: project.id,
          schemeId: scheme.id,
          status: { in: [...LIVE_SCHEME_STATUSES] },
        },
        select: { id: true },
      });
      if (existing) {
        throw new ConflictException({
          code: ErrorCodes.SCHEME_APPLICATION_ALREADY_EXISTS,
          message: `An application for this scheme already exists for this project (application ${existing.id}).`,
        });
      }
      return tx.schemeApplication.create({
        data: {
          schemeId: scheme.id,
          projectId: project.id,
          status: 'APPLIED',
          submittedAt: now,
          catalogueSnapshot: snapshot as unknown as Prisma.InputJsonValue,
          createdByUserId: actorUserId,
          history: {
            create: {
              fromStatus: null,
              toStatus: 'APPLIED',
              actorUserId,
              actorRole: APPLICANT_ROLE,
            },
          },
        },
        include: APPLICATION_INCLUDE,
      });
    });

    await this.audit.record({
      userId: actorUserId,
      roleAtTime: APPLICANT_ROLE,
      action: AuditActions.SCHEME_APPLICATION_CREATED,
      entityType: 'SchemeApplication',
      entityId: created.id,
      afterState: {
        ...this.auditContext(access, project.id),
        schemeApplicationId: created.id,
        schemeId: scheme.id,
        schemeVersion: scheme.version,
        departmentId: scheme.departmentId,
        referenceNumber: created.referenceNumber,
        status: created.status,
        // What the system suggested (a recommendation, not a determination).
        recommendationStatus: snapshot.recommendation.status,
        ruleId: snapshot.recommendation.rule?.id ?? null,
        ruleVersion: snapshot.recommendation.rule?.version ?? null,
      },
      ipAddress,
      ruleVersionUsed: snapshot.recommendation.rule
        ? `${snapshot.recommendation.rule.id}@v${snapshot.recommendation.rule.version}`
        : null,
    });
    return toSchemeApplicationDto(created);
  }

  /** The enterprise's scheme applications across its projects; a
   * project-restricted representative sees only those of their projects. */
  async listForEnterprise(
    access: EnterpriseAccess,
    query: ListSchemeApplicationsQueryDto,
  ): Promise<SchemeApplicationDto[]> {
    const restricted = access.scopedProjectIds.length > 0;
    if (
      restricted &&
      query.projectId &&
      !access.scopedProjectIds.includes(query.projectId)
    ) {
      return [];
    }
    const rows = await this.prisma.schemeApplication.findMany({
      where: {
        project: { enterpriseId: access.enterprise.id },
        ...(restricted ? { projectId: { in: access.scopedProjectIds } } : {}),
        ...(query.projectId ? { projectId: query.projectId } : {}),
        ...(query.status ? { status: query.status } : {}),
      },
      include: APPLICATION_INCLUDE,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return rows.map(toSchemeApplicationDto);
  }

  async listForProject(
    access: EnterpriseAccess,
    projectId: string,
    query: ListSchemeApplicationsQueryDto,
  ): Promise<SchemeApplicationDto[]> {
    const project = await this.findProject(access, projectId);
    const rows = await this.prisma.schemeApplication.findMany({
      where: {
        projectId: project.id,
        ...(query.status ? { status: query.status } : {}),
      },
      include: APPLICATION_INCLUDE,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return rows.map(toSchemeApplicationDto);
  }

  async get(
    access: EnterpriseAccess,
    projectId: string,
    applicationId: string,
  ): Promise<SchemeApplicationDto> {
    return toSchemeApplicationDto(
      await this.findApplication(access, projectId, applicationId),
    );
  }

  /** An application found only THROUGH the authorised enterprise and the project
   * in the URL: another enterprise's, another project's, and a nonexistent one
   * are all the same 404. */
  async findApplication(
    access: EnterpriseAccess,
    projectId: string,
    applicationId: string,
  ): Promise<ApplicationRow> {
    const project = await this.findProject(access, projectId);
    const row = UUID.test(applicationId)
      ? await this.prisma.schemeApplication.findFirst({
          where: { id: applicationId, projectId: project.id },
          include: APPLICATION_INCLUDE,
        })
      : null;
    if (!row) {
      throw notFound('Scheme application');
    }
    return row;
  }

  auditContext(access: EnterpriseAccess, projectId: string) {
    return {
      enterpriseId: access.enterprise.id,
      projectId,
      actingAs: access.relation,
      representativeScope: access.scope ?? null,
    };
  }

  private async findProject(access: EnterpriseAccess, projectId: string) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, enterpriseId: access.enterprise.id },
    });
    if (!project) {
      throw notFound('Project');
    }
    return project;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
