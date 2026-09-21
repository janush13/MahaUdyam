import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { isAuthorisationLive } from '../enterprises/constants/representative-scope.constant';

/**
 * Who a notification is FOR. Recipients are DERIVED from relationships that
 * already exist - never supplied by a caller, never invented:
 *
 *  - applicant side: the users who can currently see the application through
 *    the existing enterprise access model (FRD 20): the enterprise's owner and
 *    every representative whose authorisation is ACTIVE, unexpired and covers
 *    the project (FRD 20.3, any scope). It is the same rule the applicant
 *    routes apply, so a notification never reaches someone who could not open
 *    the application.
 *  - officer side (Blueprint 23.3: "the assigned officer and their Department
 *    Admin"): the application's current assignee and the Department
 *    Administrators of the application's department.
 *
 * Deactivated accounts are skipped.
 */
@Injectable()
export class NotificationRecipientsService {
  constructor(private readonly prisma: PrismaService) {}

  async applicantSide(projectId: string): Promise<string[]> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: {
        enterprise: {
          select: {
            ownerUserId: true,
            representatives: {
              where: { status: 'ACTIVE' },
              select: {
                representativeUserId: true,
                status: true,
                expiresAt: true,
                scopedProjectIds: true,
              },
            },
          },
        },
      },
    });
    if (!project) {
      return [];
    }
    const { ownerUserId, representatives } = project.enterprise;
    const candidates = [
      ownerUserId,
      ...representatives
        .filter(
          (r) =>
            isAuthorisationLive(r) &&
            (r.scopedProjectIds.length === 0 ||
              r.scopedProjectIds.includes(projectId)),
        )
        .map((r) => r.representativeUserId),
    ];
    return this.active(candidates);
  }

  async officerSide(
    applicationId: string,
    departmentId: string,
  ): Promise<string[]> {
    const [assignment, admins] = await Promise.all([
      this.prisma.applicationAssignment.findFirst({
        where: { applicationId, endedAt: null },
        select: { officerUserId: true },
      }),
      this.prisma.userRole.findMany({
        where: { departmentId, role: { code: 'DEPT_ADMIN' } },
        select: { userId: true },
      }),
    ]);
    return this.active([
      ...(assignment ? [assignment.officerUserId] : []),
      ...admins.map((a) => a.userId),
    ]);
  }

  /** The distinct ids among `userIds` that are active accounts. */
  async active(userIds: readonly string[]): Promise<string[]> {
    const distinct = [...new Set(userIds)];
    if (distinct.length === 0) {
      return [];
    }
    const rows = await this.prisma.user.findMany({
      where: { id: { in: distinct }, isActive: true },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }
}
