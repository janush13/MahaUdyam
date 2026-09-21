import { NotFoundException } from '@nestjs/common';
import { EnterpriseAccess } from '../enterprises/interfaces/enterprise-access.interface';
import {
  ApplicantInspectionsService,
  toApplicantInspection,
} from './applicant-inspections.service';

const ENT = '11111111-1111-4111-8111-111111111111';
const PROJ = '22222222-2222-4222-8222-222222222222';
const APP = '33333333-3333-4333-8333-333333333333';
const INSP = '44444444-4444-4444-8444-444444444444';
const t = (n: number) => new Date(Date.UTC(2026, 9, 1, 0, 0, n));

const access = {
  enterprise: { id: ENT },
  relation: 'OWNER',
} as EnterpriseAccess;

const row = (over: Record<string, unknown> = {}) => ({
  id: INSP,
  status: 'SCHEDULED',
  scheduledAt: t(5),
  confirmedAt: null,
  siteAddress: 'Plot 12',
  createdAt: t(1),
  updatedAt: t(2),
  reportSummary: null,
  ...over,
});

function build(
  opts: { appFound?: boolean; rows?: unknown[]; stages?: number } = {},
) {
  const prisma = {
    approvalApplication: {
      count: jest.fn().mockResolvedValue(opts.appFound === false ? 0 : 1),
      findUnique: jest.fn().mockResolvedValue({
        workflow: {
          stages: Array.from({ length: opts.stages ?? 0 }, (_, i) => ({
            id: `s${i}`,
          })),
        },
      }),
    },
    inspection: { findMany: jest.fn().mockResolvedValue(opts.rows ?? [row()]) },
  };
  return { prisma, service: new ApplicantInspectionsService(prisma as never) };
}

describe('toApplicantInspection', () => {
  it('shows status, schedule and site — and no outcome before completion', () => {
    expect(toApplicantInspection(row() as never)).toEqual({
      id: INSP,
      status: 'SCHEDULED',
      scheduledAt: t(5),
      scheduleConfirmedAt: null,
      siteAddress: 'Plot 12',
      outcome: null,
      createdAt: t(1),
      updatedAt: t(2),
    });
  });

  it('shows only the overall finding and corrective action once a report exists', () => {
    const dto = toApplicantInspection(
      row({
        status: 'COMPLETED',
        reportSummary: {
          overallFinding: 'NON_COMPLIANT',
          summary: 'INTERNAL observations of the inspector',
          correctiveAction: 'Install a second fire exit.',
          submittedAt: t(9),
          submittedByUserId: 'inspector-user-id',
        },
      }) as never,
    );
    expect(dto.outcome).toEqual({
      overallFinding: 'NON_COMPLIANT',
      correctiveAction: 'Install a second fire exit.',
      recordedAt: t(9),
    });
    const text = JSON.stringify(dto);
    expect(text).not.toContain('INTERNAL observations');
    expect(text).not.toContain('inspector-user-id');
    expect(Object.keys(dto)).not.toEqual(
      expect.arrayContaining(['inspector', 'inspectorId', 'assignedBy']),
    );
  });
});

describe('ApplicantInspectionsService', () => {
  it('scopes the application lookup by id AND project AND the authorised enterprise', async () => {
    const { prisma, service } = build();
    await service.list(access, PROJ, APP);
    expect(prisma.approvalApplication.count).toHaveBeenCalledWith({
      where: { id: APP, projectId: PROJ, project: { enterpriseId: ENT } },
    });
  });

  it('lists the configured requirement separately from the inspections that exist', async () => {
    const required = await build({ stages: 1, rows: [] }).service.list(
      access,
      PROJ,
      APP,
    );
    expect(required).toEqual({
      applicationId: APP,
      inspectionRequired: true,
      inspections: [],
    });
    const optional = await build({ stages: 0 }).service.list(access, PROJ, APP);
    expect(optional.inspectionRequired).toBe(false);
    expect(optional.inspections).toHaveLength(1);
  });

  it('an application outside the enterprise / project is a 404 and nothing else is read', async () => {
    const { prisma, service } = build({ appFound: false });
    await expect(service.list(access, PROJ, APP)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.get(access, PROJ, APP, INSP)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.inspection.findMany).not.toHaveBeenCalled();
  });

  it('returns one inspection of THIS application, and a 404 for any other id', async () => {
    const { service } = build();
    await expect(service.get(access, PROJ, APP, INSP)).resolves.toMatchObject({
      id: INSP,
    });
    await expect(
      service.get(access, PROJ, APP, '55555555-5555-4555-8555-555555555555'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
