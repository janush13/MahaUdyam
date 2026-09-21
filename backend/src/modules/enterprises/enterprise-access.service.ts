import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { RepresentativeScope } from '@prisma/client';
import { isUUID } from 'class-validator';
import { ErrorCodes } from '../../common/constants/error-codes.constant';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  EnterpriseAccessLevel,
  higherScope,
  isAuthorisationLive,
  scopeSatisfies,
} from './constants/representative-scope.constant';
import { EnterpriseAccess } from './interfaces/enterprise-access.interface';

/**
 * The single place that answers "may this user do this to this enterprise?"
 * (FRD §20, TRD §28's object-level ABAC). Every enterprise-scoped operation
 * — in this step and in later modules such as projects and applications —
 * goes through here, so ownership and representative rules can never drift
 * apart between modules.
 *
 * Deliberate response split:
 *  - NO live relationship (stranger, PENDING/REVOKED/expired representative,
 *    unknown or malformed id) -> 404, identical in every case, so enterprise
 *    ids cannot be probed.
 *  - A live relationship that is not enough -> 403 FORBIDDEN_SCOPE.
 */
@Injectable()
export class EnterpriseAccessService {
  constructor(private readonly prisma: PrismaService) {}

  /** The caller's live relationship to the enterprise, or null if none. */
  async resolve(
    userId: string,
    enterpriseId: string,
  ): Promise<EnterpriseAccess | null> {
    // Route params reach guards before any pipe runs; a malformed id can
    // never match a row and passing it to Prisma would surface as a 500.
    if (!isUUID(enterpriseId)) {
      return null;
    }

    const enterprise = await this.prisma.enterprise.findUnique({
      where: { id: enterpriseId },
    });
    if (!enterprise) {
      return null;
    }

    if (enterprise.ownerUserId === userId) {
      return { enterprise, relation: 'OWNER', scopedProjectIds: [] };
    }

    const candidates = await this.prisma.enterpriseRepresentative.findMany({
      where: {
        enterpriseId,
        representativeUserId: userId,
        status: 'ACTIVE',
      },
    });
    const live = candidates.filter((c) => isAuthorisationLive(c));
    if (live.length === 0) {
      return null;
    }

    // At most one live record can exist per representative (enforced when
    // granting). If data were ever inconsistent, the highest scope wins and
    // an unrestricted record beats a project-limited one.
    let scope: RepresentativeScope = live[0].scope;
    for (const record of live) {
      scope = higherScope(scope, record.scope);
    }
    const unrestricted = live.some((r) => r.scopedProjectIds.length === 0);
    const scopedProjectIds = unrestricted
      ? []
      : [...new Set(live.flatMap((r) => r.scopedProjectIds))];

    return { enterprise, relation: 'REPRESENTATIVE', scope, scopedProjectIds };
  }

  /**
   * @param projectId when the operation targets a specific project, the
   *   representative's project restriction (FRD §20.3) is checked against
   *   it. A project-restricted representative may still VIEW the enterprise
   *   itself (they need that context), but any higher-level operation must
   *   name a project inside their list.
   */
  async assertAccess(
    userId: string,
    enterpriseId: string,
    required: EnterpriseAccessLevel,
    projectId?: string,
  ): Promise<EnterpriseAccess> {
    const access = await this.resolve(userId, enterpriseId);
    if (!access) {
      throw new NotFoundException({
        code: ErrorCodes.NOT_FOUND,
        message: 'Enterprise not found.',
      });
    }

    if (access.relation === 'OWNER') {
      return access;
    }

    const deny = (): never => {
      throw new ForbiddenException({
        code: ErrorCodes.FORBIDDEN_SCOPE,
        message: 'Your authorisation does not permit this action.',
      });
    };

    if (required === 'OWNER' || !access.scope) {
      return deny();
    }
    if (!scopeSatisfies(access.scope, required)) {
      return deny();
    }

    if (access.scopedProjectIds.length > 0) {
      const enterpriseLevelView = required === 'VIEW_ONLY' && !projectId;
      const insideScope =
        projectId !== undefined && access.scopedProjectIds.includes(projectId);
      if (!enterpriseLevelView && !insideScope) {
        return deny();
      }
    }

    return access;
  }
}
