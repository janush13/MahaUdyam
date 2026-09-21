import { isDeepStrictEqual } from 'node:util';
import { Injectable, NotFoundException } from '@nestjs/common';
import { DiscoverySnapshot, Prisma, Project } from '@prisma/client';
import { ErrorCodes } from '../../common/constants/error-codes.constant';
import { AuditActions } from '../../infrastructure/audit/audit-actions.constant';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { EnterpriseAccess } from '../enterprises/interfaces/enterprise-access.interface';
import { ApprovalRulesService } from './approval-rules.service';
import {
  DiscoveryResultDto,
  DiscoverySnapshotSummaryDto,
} from './dto/discovery-response.dto';
import {
  DISCOVERY_ENGINE_VERSION,
  DISCOVERY_NOTICE,
  DiscoveryEngineResult,
  RuleDescriptor,
  evaluateDiscovery,
} from './engine/discovery-engine';
import {
  DiscoveryInputs,
  buildDiscoveryInputs,
} from './engine/discovery-fields';

const APPLICANT_ROLE = 'APPLICANT';

const MESSAGE_NO_RULES =
  'No approval rules have been configured yet, so no approvals could be determined. Please consult the relevant department.';
const MESSAGE_NO_MATCH =
  'We could not determine additional approvals for this combination of project details — please consult the relevant department.';

/** JSON as it comes back from the database (no undefined, Dates as strings). */
const roundTrip = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function messageFor(result: DiscoveryEngineResult): string | null {
  if (result.summary.rulesEvaluated === 0) {
    return MESSAGE_NO_RULES;
  }
  return result.applicable.length === 0 ? MESSAGE_NO_MATCH : null;
}

/**
 * Approval discovery: evaluates the effective rules against a project's
 * characteristics and persists an immutable snapshot.
 *
 * Kept strictly separate from statutory determination: the output is a
 * recommendation ("Potentially Applicable", or "Officially Required" only
 * where a department flagged the rule authoritative), always accompanied by
 * the notice below, and it creates no application and no obligation.
 *
 * Authorisation is NOT decided here: routes are protected by the existing
 * EnterpriseAccessGuard, which resolves the caller's relationship (and any
 * project restriction) before these methods run. This service only ever
 * reads the project inside the authorised enterprise.
 */
@Injectable()
export class DiscoveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rules: ApprovalRulesService,
    private readonly audit: AuditService,
  ) {}

  async run(
    access: EnterpriseAccess,
    projectId: string,
    actorUserId: string,
    ipAddress: string,
  ): Promise<DiscoveryResultDto> {
    const project = await this.findProject(access, projectId);
    const inputs = buildDiscoveryInputs(project, access.enterprise);

    const evaluatedAt = new Date();
    const descriptors = await this.rules.loadEffectiveRules(evaluatedAt);
    const result = evaluateDiscovery(descriptors, inputs);

    // The snapshot is self-contained: the exact rule versions (definitions
    // included), the exact inputs and the full result. Later changes to rules,
    // approval types, departments or the project cannot rewrite it, and the
    // engine can re-derive the result from what is stored here.
    const snapshot = await this.prisma.discoverySnapshot.create({
      data: {
        projectId: project.id,
        evaluatedAt,
        ruleVersionsUsed: descriptors as unknown as Prisma.InputJsonValue,
        matchedApprovalTypeIds: result.matchedApprovalTypeIds,
        projectInputs: inputs as Prisma.InputJsonValue,
        result: result as unknown as Prisma.InputJsonValue,
        engineVersion: DISCOVERY_ENGINE_VERSION,
        createdByUserId: actorUserId,
      },
    });

    await this.audit.record({
      userId: actorUserId,
      roleAtTime: APPLICANT_ROLE,
      action: AuditActions.DISCOVERY_RUN,
      entityType: 'DiscoverySnapshot',
      entityId: snapshot.id,
      afterState: {
        projectId: project.id,
        enterpriseId: access.enterprise.id,
        actingAs: access.relation,
        engineVersion: DISCOVERY_ENGINE_VERSION,
        rulesEvaluated: result.summary.rulesEvaluated,
        applicableCount: result.summary.applicableCount,
        matchedApprovalTypeIds: result.matchedApprovalTypeIds,
        ruleVersions: descriptors.map((d) => ({
          ruleId: d.ruleId,
          version: d.version,
        })),
      },
      ipAddress,
    });

    return this.toDto(snapshot, project, false);
  }

  async list(
    access: EnterpriseAccess,
    projectId: string,
  ): Promise<DiscoverySnapshotSummaryDto[]> {
    const project = await this.findProject(access, projectId);
    const snapshots = await this.prisma.discoverySnapshot.findMany({
      where: { projectId: project.id },
      orderBy: [{ evaluatedAt: 'desc' }, { id: 'desc' }],
    });
    return snapshots.map((s) => {
      const result = s.result as unknown as DiscoveryEngineResult;
      return {
        id: s.id,
        evaluatedAt: s.evaluatedAt,
        engineVersion: s.engineVersion,
        rulesEvaluated: result.summary.rulesEvaluated,
        applicableCount: result.summary.applicableCount,
        notApplicableCount: result.summary.notApplicableCount,
        matchedApprovalTypeIds: s.matchedApprovalTypeIds,
      };
    });
  }

  /** Re-reads a stored snapshot exactly as it was produced, and reports
   * whether the engine reproduces it from the stored rules and inputs. */
  async get(
    access: EnterpriseAccess,
    projectId: string,
    snapshotId: string,
  ): Promise<DiscoveryResultDto> {
    const project = await this.findProject(access, projectId);
    const snapshot = await this.prisma.discoverySnapshot.findFirst({
      // Scoped to this project, which is scoped to the authorised enterprise.
      where: { id: snapshotId, projectId: project.id },
    });
    if (!snapshot) {
      throw new NotFoundException({
        code: ErrorCodes.NOT_FOUND,
        message: 'Discovery result not found.',
      });
    }
    return this.toDto(snapshot, project, true);
  }

  /** Re-runs the engine on what a snapshot stored. Pure — no database. */
  replay(snapshot: DiscoverySnapshot): DiscoveryEngineResult {
    return evaluateDiscovery(
      snapshot.ruleVersionsUsed as unknown as RuleDescriptor[],
      snapshot.projectInputs as unknown as DiscoveryInputs,
    );
  }

  private toDto(
    snapshot: DiscoverySnapshot,
    project: Project,
    verify: boolean,
  ): DiscoveryResultDto {
    const stored = snapshot.result as unknown as DiscoveryEngineResult;
    return {
      snapshotId: snapshot.id,
      projectId: project.id,
      projectReferenceNumber: project.referenceNumber,
      evaluatedAt: snapshot.evaluatedAt,
      engineVersion: snapshot.engineVersion,
      notice: DISCOVERY_NOTICE,
      message: messageFor(stored),
      inputs: snapshot.projectInputs as object,
      summary: stored.summary,
      applicable: stored.applicable,
      notApplicable: stored.notApplicable,
      ...(verify
        ? {
            reproducible: isDeepStrictEqual(
              roundTrip(this.replay(snapshot)),
              roundTrip(stored),
            ),
          }
        : {}),
    };
  }

  /** Always scoped to the authorised enterprise, so a project id belonging to
   * another enterprise is indistinguishable from a nonexistent one. */
  private async findProject(
    access: EnterpriseAccess,
    projectId: string,
  ): Promise<Project> {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, enterpriseId: access.enterprise.id },
    });
    if (!project) {
      throw new NotFoundException({
        code: ErrorCodes.NOT_FOUND,
        message: 'Project not found.',
      });
    }
    return project;
  }
}
