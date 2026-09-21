import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { OfficerAccessService } from '../officer/officer-access.service';
import { UsersService } from '../users/users.service';
import { INSPECTOR_ROLE } from './constants/inspection.constants';

/** Which inspections a caller may see, as two independent scopes. */
export interface InspectionScopes {
  /** Officer roles (Scrutiny Officer / Department Administrator / Approving
   * Authority): exactly the inspections of the applications the Step 10
   * visibility rules already let them see. */
  officer: Prisma.InspectionWhereInput;
  /** Inspector: only inspections assigned to THEM, and only in a department
   * where they currently hold the Inspector role. */
  inspector: Prisma.InspectionWhereInput;
}

const NOTHING: Prisma.InspectionWhereInput = { id: { in: [] } };

/**
 * Object-level authorisation for reading inspections. It adds no permission
 * system: officer scope is `OfficerAccessService.visibilityWhere` (the
 * department is derived from the application's approval type, never from the
 * request), and the Inspector scope is the caller's own `user_roles` rows.
 * A caller with no relevant role sees nothing (fail closed), and an
 * inspection outside the caller's scope is indistinguishable from one that
 * does not exist.
 */
@Injectable()
export class InspectionAccessService {
  constructor(
    private readonly officers: OfficerAccessService,
    private readonly users: UsersService,
    private readonly prisma: PrismaService,
  ) {}

  async scopes(userId: string): Promise<InspectionScopes> {
    const [grants, assignments] = await Promise.all([
      this.officers.grantsFor(userId),
      this.users.getRoleAssignments(userId),
    ]);
    const inspectorDepartments = [
      ...new Set(
        assignments
          .filter((a) => a.roleCode === INSPECTOR_ROLE && a.departmentId)
          .map((a) => a.departmentId as string),
      ),
    ];
    return {
      officer:
        grants.length === 0
          ? NOTHING
          : { application: this.officers.visibilityWhere(userId, grants) },
      inspector:
        inspectorDepartments.length === 0
          ? NOTHING
          : {
              inspectorId: userId,
              application: {
                internalState: { not: 'DRAFT' },
                approvalType: { departmentId: { in: inspectorDepartments } },
              },
            },
    };
  }

  /**
   * In what capacity, if any, the caller may see this inspection: as an
   * officer role (working view), as its assigned Inspector (minimum view), or
   * not at all — which is indistinguishable from a nonexistent id.
   */
  async resolveView(
    userId: string,
    inspectionId: string,
  ): Promise<'OFFICER' | 'INSPECTOR' | null> {
    const scopes = await this.scopes(userId);
    const asOfficer = await this.prisma.inspection.count({
      where: { AND: [{ id: inspectionId }, scopes.officer] },
    });
    if (asOfficer > 0) {
      return 'OFFICER';
    }
    const asInspector = await this.prisma.inspection.count({
      where: { AND: [{ id: inspectionId }, scopes.inspector] },
    });
    return asInspector > 0 ? 'INSPECTOR' : null;
  }
}
