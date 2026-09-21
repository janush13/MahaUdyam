import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { EnterpriseAccess } from '../enterprises/interfaces/enterprise-access.interface';
import { CreateProjectDto } from './dto/create-project.dto';
import {
  ProjectsService,
  assertConsistent,
  toProjectResponse,
  toProjectValues,
} from './projects.service';

const ENTERPRISE = '00000000-0000-4000-8000-0000000000c3';
const OTHER_ENTERPRISE = '00000000-0000-4000-8000-0000000000c4';
const PROJECT = '00000000-0000-4000-8000-0000000000e5';
const P2 = '00000000-0000-4000-8000-0000000000e6';
const ACTOR = '00000000-0000-4000-8000-0000000000a1';

const ownerAccess = {
  relation: 'OWNER',
  enterprise: { id: ENTERPRISE },
  scopedProjectIds: [],
} as unknown as EnterpriseAccess;

const repAccess = (scopedProjectIds: string[] = []) =>
  ({
    relation: 'REPRESENTATIVE',
    scope: 'FULL',
    enterprise: { id: ENTERPRISE },
    scopedProjectIds,
  }) as unknown as EnterpriseAccess;

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: PROJECT,
    referenceNumber: 'PRJ-2026-000001',
    enterpriseId: ENTERPRISE,
    name: 'Chakan Unit 2',
    district: 'Pune',
    taluka: 'Khed',
    industrialArea: null,
    sectorCode: '25910',
    enterpriseSizeBand: 'small',
    investmentAmount: new Prisma.Decimal('25000000.50'),
    employmentCount: 40,
    projectStage: 'expansion',
    landStatus: 'owned',
    landLeaseDetails: null,
    constructionStatus: 'not_started',
    productionStatus: 'pre_production',
    environmentalCategory: null,
    hazardousFlag: false,
    hazardousCategory: null,
    additionalSiteDetails: null,
    expectedCommissioningDate: null,
    createdAt: new Date('2026-09-19T00:00:00Z'),
    updatedAt: new Date('2026-09-19T00:00:00Z'),
    ...overrides,
  };
}

const createDto = (overrides: Record<string, unknown> = {}) =>
  ({
    name: 'Chakan Unit 2',
    district: 'Pune',
    taluka: 'Khed',
    sectorCode: '25910',
    enterpriseSizeBand: 'small',
    investmentAmount: 25000000.5,
    employmentCount: 40,
    projectStage: 'expansion',
    landStatus: 'owned',
    constructionStatus: 'not_started',
    productionStatus: 'pre_production',
    hazardousFlag: false,
    ...overrides,
  }) as unknown as CreateProjectDto;

function build(existing: object | null = row()) {
  const project = {
    create: jest
      .fn()
      .mockImplementation(({ data }) => Promise.resolve(row(data))),
    findFirst: jest.fn().mockResolvedValue(existing),
    findMany: jest.fn().mockResolvedValue([row()]),
    update: jest
      .fn()
      .mockImplementation(({ data }) => Promise.resolve(row(data))),
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const service = new ProjectsService(
    { project } as unknown as PrismaService,
    audit as unknown as AuditService,
  );
  return { service, project, audit };
}

describe('toProjectResponse', () => {
  it('converts Decimal to number and the DATE to YYYY-MM-DD, and has no status or internal field', () => {
    const dto = toProjectResponse(
      row({
        expectedCommissioningDate: new Date('2027-04-01T00:00:00Z'),
      }) as never,
    );
    expect(dto.investmentAmount).toBe(25000000.5);
    expect(dto.expectedCommissioningDate).toBe('2027-04-01');
    expect(Object.keys(dto)).not.toContain('status');
    expect(Object.keys(dto).sort()).toEqual(
      [
        'id',
        'referenceNumber',
        'enterpriseId',
        'name',
        'district',
        'taluka',
        'industrialArea',
        'sectorCode',
        'enterpriseSizeBand',
        'investmentAmount',
        'employmentCount',
        'projectStage',
        'landStatus',
        'landLeaseDetails',
        'constructionStatus',
        'productionStatus',
        'hazardousFlag',
        'hazardousCategory',
        'environmentalCategory',
        'additionalSiteDetails',
        'expectedCommissioningDate',
        'createdAt',
        'updatedAt',
      ].sort(),
    );
  });

  it('exposes only the known lease keys, whatever the JSON column holds', () => {
    const values = toProjectValues(
      row({
        landStatus: 'leased',
        landLeaseDetails: {
          lessorName: 'MIDC',
          leaseTermMonths: 99,
          internalNote: 'x',
        },
      }) as never,
    );
    expect(values.landLeaseDetails).toEqual({
      lessorName: 'MIDC',
      leaseTermMonths: 99,
    });
  });
});

describe('assertConsistent (cross-field rules)', () => {
  const base = toProjectValues(row() as never);

  it('rejects lease details on land that is not leased', () => {
    expect(() =>
      assertConsistent({
        ...base,
        landLeaseDetails: { lessorName: 'X1', leaseTermMonths: 5 },
      }),
    ).toThrow(BadRequestException);
  });

  it('allows lease details on leased land, and leased land without details', () => {
    expect(() =>
      assertConsistent({
        ...base,
        landStatus: 'leased',
        landLeaseDetails: { lessorName: 'X1', leaseTermMonths: 5 },
      }),
    ).not.toThrow();
    expect(() =>
      assertConsistent({ ...base, landStatus: 'leased' }),
    ).not.toThrow();
  });

  it('rejects a hazardous category on a non-hazardous project, allows it when flagged', () => {
    expect(() =>
      assertConsistent({ ...base, hazardousCategory: 'Chemical' }),
    ).toThrow(BadRequestException);
    expect(() =>
      assertConsistent({
        ...base,
        hazardousFlag: true,
        hazardousCategory: 'Chemical',
      }),
    ).not.toThrow();
  });

  it('rejects an impossible calendar date such as 2027-02-31', () => {
    expect(() =>
      assertConsistent({ ...base, expectedCommissioningDate: '2027-02-31' }),
    ).toThrow(BadRequestException);
    expect(() =>
      assertConsistent({ ...base, expectedCommissioningDate: '2028-02-29' }),
    ).not.toThrow();
  });

  it('reports the offending field in the standard error envelope', () => {
    try {
      assertConsistent({ ...base, hazardousCategory: 'Chemical' });
      fail('expected a throw');
    } catch (e) {
      expect((e as BadRequestException).getResponse()).toMatchObject({
        code: 'VALIDATION_ERROR',
        fields: { hazardousCategory: [expect.any(String)] },
      });
    }
  });
});

describe('ProjectsService.create', () => {
  it('always uses the authorised enterprise — never anything from the body — and records the actor', async () => {
    const { service, project, audit } = build();
    const dto = createDto({
      enterpriseId: OTHER_ENTERPRISE,
      ownerUserId: 'evil',
    });
    await service.create(ownerAccess, ACTOR, dto, '1.1.1.1');

    expect(project.create.mock.calls[0][0].data.enterpriseId).toBe(ENTERPRISE);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: ACTOR,
        action: 'PROJECT_CREATED',
        entityType: 'Project',
        afterState: expect.objectContaining({
          enterpriseId: ENTERPRISE,
          actingAs: 'OWNER',
        }),
      }),
    );
  });

  it('marks representative-made changes as such in the audit trail (FRD §20.5)', async () => {
    const { service, audit } = build();
    await service.create(repAccess(), ACTOR, createDto(), 'ip');
    expect(audit.record.mock.calls[0][0].afterState.actingAs).toBe(
      'REPRESENTATIVE',
    );
  });

  it('never writes a status field (none exists) and stores nothing for absent optional fields', async () => {
    const { service, project } = build();
    await service.create(ownerAccess, ACTOR, createDto(), 'ip');
    const data = project.create.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('status');
    expect(data).not.toHaveProperty('landLeaseDetails');
    expect(data).not.toHaveProperty('hazardousCategory');
  });

  it('rejects inconsistent input before touching the database', async () => {
    const { service, project, audit } = build();
    await expect(
      service.create(
        ownerAccess,
        ACTOR,
        createDto({ hazardousCategory: 'Chemical' }),
        'ip',
      ),
    ).rejects.toThrow(BadRequestException);
    expect(project.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });
});

describe('ProjectsService.list', () => {
  it('lists every project of the enterprise for the owner / an unrestricted representative', async () => {
    const { service, project } = build();
    await service.list(ownerAccess);
    await service.list(repAccess([]));
    for (const call of project.findMany.mock.calls) {
      expect(call[0].where).toEqual({ enterpriseId: ENTERPRISE });
    }
  });

  it('limits a project-restricted representative to their authorised projects', async () => {
    const { service, project } = build();
    await service.list(repAccess([PROJECT, P2]));
    expect(project.findMany.mock.calls[0][0].where).toEqual({
      enterpriseId: ENTERPRISE,
      id: { in: [PROJECT, P2] },
    });
  });
});

describe('ProjectsService.get', () => {
  it('scopes the lookup to the authorised enterprise, so another enterprise’s project id is a 404', async () => {
    const { service, project } = build(null);
    await expect(service.get(ownerAccess, PROJECT)).rejects.toThrow(
      NotFoundException,
    );
    expect(project.findFirst.mock.calls[0][0].where).toEqual({
      id: PROJECT,
      enterpriseId: ENTERPRISE,
    });
  });
});

describe('ProjectsService.update', () => {
  it('writes and audits only the fields that changed, with the previous values', async () => {
    const { service, project, audit } = build();
    await service.update(
      ownerAccess,
      PROJECT,
      ACTOR,
      { employmentCount: 55, district: 'Pune' } as never,
      'ip',
    );

    expect(project.update.mock.calls[0][0].data).toEqual({
      employmentCount: 55,
    });
    const event = audit.record.mock.calls[0][0];
    expect(event.action).toBe('PROJECT_UPDATED');
    expect(event.beforeState).toEqual({ employmentCount: 40 });
    expect(event.afterState).toEqual({
      employmentCount: 55,
      enterpriseId: ENTERPRISE,
      actingAs: 'OWNER',
    });
  });

  it('scopes the write by enterprise as well as id', async () => {
    const { service, project } = build();
    await service.update(
      ownerAccess,
      PROJECT,
      ACTOR,
      { employmentCount: 1 } as never,
      'ip',
    );
    expect(project.update.mock.calls[0][0].where).toEqual({
      id: PROJECT,
      enterpriseId: ENTERPRISE,
    });
  });

  it('a no-op update succeeds with no write and no audit entry', async () => {
    const { service, project, audit } = build();
    await service.update(
      ownerAccess,
      PROJECT,
      ACTOR,
      { employmentCount: 40, name: 'Chakan Unit 2' } as never,
      'ip',
    );
    expect(project.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('requires at least one field', async () => {
    const { service } = build();
    await expect(
      service.update(ownerAccess, PROJECT, ACTOR, {} as never, 'ip'),
    ).rejects.toThrow(BadRequestException);
  });

  it('is a 404 for a project outside the enterprise', async () => {
    const { service, project } = build(null);
    await expect(
      service.update(
        ownerAccess,
        PROJECT,
        ACTOR,
        { employmentCount: 1 } as never,
        'ip',
      ),
    ).rejects.toThrow(NotFoundException);
    expect(project.update).not.toHaveBeenCalled();
  });

  it('checks cross-field rules against the RESULTING project: switching away from leased needs an explicit null', async () => {
    const leased = row({
      landStatus: 'leased',
      landLeaseDetails: { lessorName: 'MIDC', leaseTermMonths: 99 },
    });
    const { service, project } = build(leased);

    await expect(
      service.update(
        ownerAccess,
        PROJECT,
        ACTOR,
        { landStatus: 'owned' } as never,
        'ip',
      ),
    ).rejects.toThrow(BadRequestException);
    expect(project.update).not.toHaveBeenCalled();

    await service.update(
      ownerAccess,
      PROJECT,
      ACTOR,
      { landStatus: 'owned', landLeaseDetails: null } as never,
      'ip',
    );
    expect(project.update.mock.calls[0][0].data.landLeaseDetails).toBe(
      Prisma.DbNull,
    );
  });

  it('unsetting the hazardous flag needs an explicit null category, and setting a category needs the flag', async () => {
    const { service } = build(
      row({ hazardousFlag: true, hazardousCategory: 'Chemical' }),
    );
    await expect(
      service.update(
        ownerAccess,
        PROJECT,
        ACTOR,
        { hazardousFlag: false } as never,
        'ip',
      ),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.update(
        ownerAccess,
        PROJECT,
        ACTOR,
        { hazardousFlag: false, hazardousCategory: null } as never,
        'ip',
      ),
    ).resolves.toBeDefined();

    const plain = build();
    await expect(
      plain.service.update(
        ownerAccess,
        PROJECT,
        ACTOR,
        { hazardousCategory: 'Chemical' } as never,
        'ip',
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('converts the commissioning date to a UTC date and clears it with null', async () => {
    const { service, project } = build();
    await service.update(
      ownerAccess,
      PROJECT,
      ACTOR,
      { expectedCommissioningDate: '2027-04-01' } as never,
      'ip',
    );
    expect(
      project.update.mock.calls[0][0].data.expectedCommissioningDate,
    ).toEqual(new Date('2027-04-01T00:00:00.000Z'));

    const cleared = build(
      row({ expectedCommissioningDate: new Date('2027-04-01T00:00:00Z') }),
    );
    await cleared.service.update(
      ownerAccess,
      PROJECT,
      ACTOR,
      { expectedCommissioningDate: null } as never,
      'ip',
    );
    expect(
      cleared.project.update.mock.calls[0][0].data.expectedCommissioningDate,
    ).toBeNull();
  });
});
