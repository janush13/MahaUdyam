import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { isAuthorisationLive } from '../enterprises/constants/representative-scope.constant';
import { OfficerAccessService } from '../officer/officer-access.service';

/**
 * Which notifications a user may read RIGHT NOW. A notification belongs to its
 * recipient (`user_id`), but it names an application, and access to an
 * application is not permanent: a representative can be revoked, an officer
 * reassigned. So the recipient's own rows are further filtered by the SAME
 * access rules the application routes use, evaluated at read time:
 *
 *  - APPLICANT rows: only while the recipient still owns the enterprise, or is a
 *    live representative for it (or, when project-restricted, for that project)
 *    - the FRD 20 / `EnterpriseAccessService` rule.
 *  - OFFICER rows: only while the application is within the recipient's
 *    department / assignment visibility - the `OfficerAccessService` rule that
 *    also scopes the officer workspace and the SLA views.
 *  - ACCOUNT rows (a representative authorisation offer): always theirs.
 *
 * Nothing here trusts a client-supplied scope, and only the IN_APP rows are
 * ever readable (the EMAIL / SMS mirrors are delivery records).
 */
@Injectable()
export class NotificationAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly officers: OfficerAccessService,
  ) {}

  async visibleWhere(
    userId: string,
    now: Date = new Date(),
  ): Promise<Prisma.NotificationWhereInput> {
    const [owned, representations, grants] = await Promise.all([
      this.prisma.enterprise.findMany({
        where: { ownerUserId: userId },
        select: { id: true },
      }),
      this.prisma.enterpriseRepresentative.findMany({
        where: { representativeUserId: userId, status: 'ACTIVE' },
        select: {
          enterpriseId: true,
          scopedProjectIds: true,
          status: true,
          expiresAt: true,
        },
      }),
      this.officers.grantsFor(userId),
    ]);
    const live = representations.filter((r) => isAuthorisationLive(r, now));
    const enterpriseIds = [
      ...new Set([
        ...owned.map((e) => e.id),
        ...live
          .filter((r) => r.scopedProjectIds.length === 0)
          .map((r) => r.enterpriseId),
      ]),
    ];
    const projectIds = [
      ...new Set(
        live
          .filter((r) => r.scopedProjectIds.length > 0)
          .flatMap((r) => r.scopedProjectIds),
      ),
    ];
    return {
      userId,
      channel: 'IN_APP',
      OR: [
        { audience: 'ACCOUNT' },
        {
          audience: 'APPLICANT',
          OR: [
            { enterpriseId: { in: enterpriseIds } },
            { projectId: { in: projectIds } },
          ],
        },
        {
          audience: 'OFFICER',
          application: this.officers.visibilityWhere(userId, grants),
        },
      ],
    };
  }
}
