import { Prisma } from '@prisma/client';
import { InspectionDto } from './dto/inspection-response.dto';

export const INSPECTION_INCLUDE = {
  application: {
    select: {
      referenceNumber: true,
      approvalType: {
        select: {
          id: true,
          name: true,
          department: { select: { id: true, name: true } },
        },
      },
      project: { select: { id: true, name: true } },
    },
  },
  inspector: { select: { id: true, name: true } },
  assignedBy: { select: { id: true, name: true } },
} satisfies Prisma.InspectionInclude;

export type InspectionRow = Prisma.InspectionGetPayload<{
  include: typeof INSPECTION_INCLUDE;
}>;

/** One inspection as one caller may see it. `officerView` adds the
 * assignment metadata an Inspector never sees. */
export function toInspectionDto(
  row: InspectionRow,
  officerView: boolean,
): InspectionDto {
  const { approvalType } = row.application;
  return {
    id: row.id,
    applicationId: row.applicationId,
    applicationReference: row.application.referenceNumber as string,
    approvalType: { id: approvalType.id, name: approvalType.name },
    department: {
      id: approvalType.department.id,
      name: approvalType.department.name,
    },
    project: {
      id: row.application.project.id,
      name: row.application.project.name,
    },
    status: row.status,
    scheduledAt: row.scheduledAt,
    confirmedAt: row.confirmedAt,
    siteAddress: row.siteAddress,
    inspector: { userId: row.inspector.id, name: row.inspector.name },
    assignedAt: row.assignedAt,
    assignedBy: officerView
      ? { userId: row.assignedBy.id, name: row.assignedBy.name }
      : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
