import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { SchemeRuleDescriptor } from './scheme-engine';

/**
 * Which eligibility rule applies to each scheme at a moment: the same resolution
 * as approval discovery. For a scheme, its HIGHEST version among those already
 * effective (and not yet ended); if THAT version is inactive the scheme is
 * simply not evaluated - a retired rule does not fall back to an older one.
 * Only PUBLISHED, active schemes of active departments take part, so a draft
 * rule can never produce a recommendation.
 */
@Injectable()
export class SchemeRulesService {
  constructor(private readonly prisma: PrismaService) {}

  async loadEffectiveRules(
    asOf: Date,
    onlySchemeId?: string,
  ): Promise<SchemeRuleDescriptor[]> {
    const rows = await this.prisma.schemeRule.findMany({
      where: {
        effectiveFrom: { lte: asOf },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: asOf } }],
        scheme: {
          publishStatus: 'PUBLISHED',
          isActive: true,
          department: { isActive: true },
          ...(onlySchemeId ? { id: onlySchemeId } : {}),
        },
      },
      include: { scheme: { include: { department: true } } },
      orderBy: [{ schemeId: 'asc' }, { version: 'desc' }],
    });

    const chosen = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      if (!chosen.has(row.schemeId)) {
        chosen.set(row.schemeId, row);
      }
    }
    return [...chosen.values()]
      .filter((r) => r.isActive)
      .map((r) => ({
        ruleId: r.id,
        version: r.version,
        priority: r.priority,
        effectiveFrom: r.effectiveFrom.toISOString(),
        effectiveTo: r.effectiveTo?.toISOString() ?? null,
        sourceReference: r.sourceReference,
        conditions: r.conditions,
        scheme: {
          id: r.scheme.id,
          name: r.scheme.name,
          benefitType: r.scheme.benefitType,
        },
        department: {
          id: r.scheme.department.id,
          code: r.scheme.department.code,
          name: r.scheme.department.name,
        },
      }));
  }
}
