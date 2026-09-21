import { Injectable, NotFoundException } from '@nestjs/common';
import { ErrorCodes } from '../../common/constants/error-codes.constant';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { buildDiscoveryInputs } from '../discovery/engine/discovery-fields';
import { EnterpriseAccess } from '../enterprises/interfaces/enterprise-access.interface';
import { ListRecommendationsQueryDto } from './dto/scheme-request.dto';
import { SchemeRecommendationsDto } from './dto/scheme-response.dto';
import {
  SCHEME_ENGINE_VERSION,
  SchemeEngineResult,
  evaluateSchemeRecommendations,
} from './scheme-engine';
import { SchemeRulesService } from './scheme-rules.service';
import {
  LIVE_SCHEME_STATUSES,
  RECOMMENDATIONS_NOTICE,
} from './scheme.constants';
import { SCHEME_INCLUDE, toSchemeDto } from './scheme.mappers';

const MESSAGE_NO_RULES =
  'No scheme eligibility rules have been configured yet, so no schemes could be suggested. You can still browse the scheme catalogue.';
const MESSAGE_NO_MATCH =
  'No scheme could be suggested for this combination of project details. You can still browse the scheme catalogue.';

function messageFor(result: SchemeEngineResult): string | null {
  if (result.summary.rulesEvaluated === 0) {
    return MESSAGE_NO_RULES;
  }
  return result.recommended.length === 0 ? MESSAGE_NO_MATCH : null;
}

/**
 * The "You may be eligible" list (FRD 29.3, TRD 15, Blueprint 13.9
 * `GET /schemes/recommendations`).
 *
 * A RECOMMENDATION, never a determination (FRD 29.4): the deterministic,
 * explainable rule engine (no AI, no ML ranking - Blueprint 3) suggests the
 * published schemes whose configured eligibility rule holds for the project's
 * own recorded characteristics, ranked by the department's `priority`; every
 * item carries the FRD 29.4 wording and its explanation. The Scheme Officer's
 * verification of an application is the determination.
 *
 * Authorisation is the existing EnterpriseAccessGuard on the route; this only
 * reads a project inside the authorised enterprise. It changes nothing and
 * persists nothing: what the system suggested for a project when it applied is
 * frozen on the application itself.
 */
@Injectable()
export class SchemeRecommendationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rules: SchemeRulesService,
  ) {}

  async recommend(
    access: EnterpriseAccess,
    projectId: string,
    query: ListRecommendationsQueryDto,
  ): Promise<SchemeRecommendationsDto> {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, enterpriseId: access.enterprise.id },
    });
    if (!project) {
      throw new NotFoundException({
        code: ErrorCodes.NOT_FOUND,
        message: 'Project not found.',
      });
    }
    const evaluatedAt = new Date();
    const inputs = buildDiscoveryInputs(project, access.enterprise);
    const result = evaluateSchemeRecommendations(
      await this.rules.loadEffectiveRules(evaluatedAt),
      inputs,
    );
    const shown = result.recommended.slice(0, query.limit ?? undefined);

    const schemeIds = shown.map((r) => r.scheme.id);
    const [schemes, live] = schemeIds.length
      ? await Promise.all([
          this.prisma.scheme.findMany({
            where: { id: { in: schemeIds } },
            include: SCHEME_INCLUDE,
          }),
          this.prisma.schemeApplication.findMany({
            where: {
              projectId: project.id,
              schemeId: { in: schemeIds },
              status: { in: [...LIVE_SCHEME_STATUSES] },
            },
            select: {
              id: true,
              schemeId: true,
              referenceNumber: true,
              status: true,
            },
          }),
        ])
      : [[], []];
    const schemeById = new Map(schemes.map((s) => [s.id, s]));
    const liveByScheme = new Map(live.map((a) => [a.schemeId, a]));

    return {
      projectId: project.id,
      projectReferenceNumber: project.referenceNumber,
      evaluatedAt,
      engineVersion: SCHEME_ENGINE_VERSION,
      notice: RECOMMENDATIONS_NOTICE,
      message: messageFor(result),
      summary: result.summary,
      recommendations: shown.flatMap((r) => {
        const scheme = schemeById.get(r.scheme.id);
        if (!scheme) {
          return [];
        }
        const existing = liveByScheme.get(r.scheme.id);
        return [
          {
            rank: r.rank,
            scheme: toSchemeDto(scheme, evaluatedAt),
            label: r.label,
            notice: r.notice,
            explanation: r.explanation,
            rule: {
              id: r.rule.id,
              version: r.rule.version,
              priority: r.rule.priority,
              sourceReference: r.rule.sourceReference,
              effectiveFrom: r.rule.effectiveFrom,
            },
            trace: r.trace,
            existingApplication: existing
              ? {
                  id: existing.id,
                  referenceNumber: existing.referenceNumber,
                  status: existing.status,
                }
              : null,
          },
        ];
      }),
    };
  }
}
