import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { OfficerAccessService } from '../officer/officer-access.service';
import { ScrutinySupport } from '../officer/scrutiny-support.service';
import { InspectionAccessService } from './inspection-access.service';
import { InspectionsService, futureInstant } from './inspections.service';

const USER = '00000000-0000-4000-8000-0000000000a1';
const INSPECTOR = '00000000-0000-4000-8000-0000000000b2';
const APP = '11111111-1111-4111-8111-111111111111';
const INSPECTION = '33333333-3333-4333-8333-333333333333';
const FUTURE = new Date(Date.now() + 86_400_000).toISOString();

const ctx = {
  userId: USER,
  actingRole: 'SCRUTINY_OFFICER',
  departmentId: 'dept',
  app: { id: APP, projectId: 'proj', project: { enterpriseId: 'ent' } },
};

function row(over: Record<string, unknown> = {}) {
  return {
    id: INSPECTION,
    applicationId: APP,
    inspectorId: INSPECTOR,
    status: 'PENDING',
    scheduledAt: null,
    siteAddress: 'Plot 4',
    assignedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    application: {
      referenceNumber: 'APP-1',
      approvalType: {
        id: 'at',
        name: 'Approval',
        department: { id: 'dept', name: 'Dept' },
      },
      project: { id: 'proj', name: 'Project' },
    },
    inspector: { id: INSPECTOR, name: 'Inspector' },
    assignedBy: { id: USER, name: 'Officer' },
    ...over,
  };
}

interface Options {
  state?: string;
  inspectorGrant?: object | null;
  conflict?: object | null;
  open?: number;
  existing?: object | null;
}

function build(o: Options = {}) {
  const tx = {
    userRole: {
      findFirst: jest
        .fn()
        .mockResolvedValue(
          o.inspectorGrant === undefined
            ? { userId: INSPECTOR }
            : o.inspectorGrant,
        ),
    },
    inspectorConflict: {
      findFirst: jest.fn().mockResolvedValue(o.conflict ?? null),
    },
    inspection: {
      count: jest.fn().mockResolvedValue(o.open ?? 0),
      create: jest
        .fn()
        .mockImplementation(({ data }) => Promise.resolve(row(data))),
      findFirst: jest
        .fn()
        .mockResolvedValue(o.existing === undefined ? row() : o.existing),
      update: jest
        .fn()
        .mockImplementation(({ data }) => Promise.resolve(row(data))),
    },
  };
  const officers = {
    resolveApplication: jest.fn().mockResolvedValue(ctx),
  } as unknown as OfficerAccessService;
  const record = jest.fn();
  const support = {
    run: jest.fn((_ctx: unknown, fn: (t: unknown, l: unknown) => unknown) =>
      fn(tx, { internalState: o.state ?? 'UNDER_SCRUTINY' }),
    ),
    recordOfficerEvent: record,
  } as unknown as ScrutinySupport;
  const notifications = {
    inspectionScheduled: jest.fn().mockResolvedValue(undefined),
    inspectionRescheduled: jest.fn().mockResolvedValue(undefined),
  };
  const service = new InspectionsService(
    {} as PrismaService,
    officers,
    {} as InspectionAccessService,
    support,
    notifications as never,
  );
  return { service, tx, officers, record, notifications };
}

const create = (o: Options, dto: Record<string, unknown> = {}) =>
  build(o).service.create(
    USER,
    APP,
    { inspectorUserId: INSPECTOR, siteAddress: 'Plot 4', ...dto },
    '127.0.0.1',
  );

describe('futureInstant', () => {
  const now = new Date('2026-10-01T00:00:00Z');
  it('accepts a real future instant', () => {
    expect(futureInstant('2026-10-01T00:00:01Z', 'scheduledAt', now)).toEqual(
      new Date('2026-10-01T00:00:01Z'),
    );
  });
  it('rejects the past, the present and nonsense with a field error', () => {
    for (const bad of [
      '2026-09-30T00:00:00Z',
      '2026-10-01T00:00:00Z',
      'nope',
    ]) {
      expect(() => futureInstant(bad, 'scheduledAt', now)).toThrow(
        BadRequestException,
      );
    }
  });
});

describe('InspectionsService.create', () => {
  it('authorises with the SCHEDULE_INSPECTION capability of the application', async () => {
    const { service, officers } = build();
    await service.create(
      USER,
      APP,
      { inspectorUserId: INSPECTOR, siteAddress: 'Plot 4' },
      '127.0.0.1',
    );
    expect(officers.resolveApplication).toHaveBeenCalledWith(
      USER,
      APP,
      'SCHEDULE_INSPECTION',
    );
  });

  it('derives PENDING without a schedule and SCHEDULED with one, and records who created it', async () => {
    const pending = build();
    await pending.service.create(
      USER,
      APP,
      { inspectorUserId: INSPECTOR, siteAddress: 'Plot 4' },
      'ip',
    );
    expect(pending.tx.inspection.create.mock.calls[0][0].data).toMatchObject({
      applicationId: APP,
      status: 'PENDING',
      scheduledAt: null,
      createdByUserId: USER,
      assignedByUserId: USER,
    });
    const scheduled = build();
    await scheduled.service.create(
      USER,
      APP,
      {
        inspectorUserId: INSPECTOR,
        siteAddress: 'Plot 4',
        scheduledAt: FUTURE,
      },
      'ip',
    );
    expect(scheduled.tx.inspection.create.mock.calls[0][0].data).toMatchObject({
      status: 'SCHEDULED',
      scheduledAt: new Date(FUTURE),
    });
  });

  it('never writes a client-chosen status, application or department', async () => {
    const { service, tx } = build();
    await service.create(
      USER,
      APP,
      {
        inspectorUserId: INSPECTOR,
        siteAddress: 'Plot 4',
        status: 'COMPLETED',
        applicationId: 'other',
      } as never,
      'ip',
    );
    const data = tx.inspection.create.mock.calls[0][0].data;
    expect(data.status).toBe('PENDING');
    expect(data.applicationId).toBe(APP);
  });

  it('rejects a past schedule before touching the database', async () => {
    const { service, tx } = build();
    await expect(
      service.create(
        USER,
        APP,
        {
          inspectorUserId: INSPECTOR,
          siteAddress: 'x',
          scheduledAt: '2020-01-01T00:00:00Z',
        },
        'ip',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.inspection.create).not.toHaveBeenCalled();
  });

  it.each([
    'SUBMITTED',
    'QUERY_RAISED',
    'APPLICANT_RESPONDED',
    'RECOMMENDED_FOR_APPROVAL',
    'APPROVED',
  ])('is a 409 while the application is %s', async (state) => {
    await expect(create({ state })).rejects.toBeInstanceOf(ConflictException);
  });

  it('is a 422 when the user is not an active Inspector of the application’s department', async () => {
    await expect(create({ inspectorGrant: null })).rejects.toMatchObject({
      response: { code: 'INVALID_ASSIGNEE' },
    });
    await expect(create({ inspectorGrant: null })).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it('is a 422 when the inspector has a declared or confirmed conflict for this project', async () => {
    await expect(create({ conflict: { id: 'c' } })).rejects.toMatchObject({
      response: { code: 'INSPECTOR_CONFLICT_OF_INTEREST' },
    });
  });

  it('is a 409 when the application already has an open inspection', async () => {
    await expect(create({ open: 1 })).rejects.toMatchObject({
      response: { code: 'INSPECTION_ALREADY_OPEN' },
    });
  });

  it('audits creation with actor context, and returns the officer view', async () => {
    const { service, record } = build();
    const dto = await service.create(
      USER,
      APP,
      { inspectorUserId: INSPECTOR, siteAddress: 'Plot 4' },
      '10.0.0.1',
    );
    expect(record).toHaveBeenCalledWith(
      ctx,
      'INSPECTION_CREATED',
      expect.objectContaining({
        inspectionId: INSPECTION,
        inspectorUserId: INSPECTOR,
        status: 'PENDING',
      }),
      '10.0.0.1',
    );
    expect(dto.assignedBy).toEqual({ userId: USER, name: 'Officer' });
    expect(JSON.stringify(dto)).not.toMatch(
      /geoConsent|applicationStage|createdByUserId/,
    );
  });
});

describe('InspectionsService.update', () => {
  const update = (o: Options, dto: Record<string, unknown>) =>
    build(o).service.update(USER, APP, INSPECTION, dto, 'ip');

  it('is a 404 for a malformed id or an inspection of another application', async () => {
    await expect(
      build().service.update(USER, APP, 'nope', { siteAddress: 'x' }, 'ip'),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      update({ existing: null }, { siteAddress: 'x' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuses a finished or cancelled inspection, and a finished scrutiny', async () => {
    for (const status of ['COMPLETED', 'CANCELLED']) {
      await expect(
        update({ existing: row({ status }) }, { siteAddress: 'New' }),
      ).rejects.toMatchObject({
        response: { code: 'INSPECTION_NOT_MODIFIABLE' },
      });
    }
    await expect(
      update({ state: 'RECOMMENDED_FOR_APPROVAL' }, { siteAddress: 'New' }),
    ).rejects.toMatchObject({
      response: { code: 'INSPECTION_NOT_MODIFIABLE' },
    });
  });

  it('rejects a request that changes nothing', async () => {
    await expect(update({}, { siteAddress: 'Plot 4' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('a reassignment needs a reason and an eligible inspector', async () => {
    const other = '00000000-0000-4000-8000-0000000000c3';
    await expect(update({}, { inspectorUserId: other })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      update(
        { inspectorGrant: null },
        { inspectorUserId: other, reason: 'sick' },
      ),
    ).rejects.toMatchObject({ response: { code: 'INVALID_ASSIGNEE' } });
  });

  it('a reassignment records who assigned and when, and audits it with the reason and the before state', async () => {
    const other = '00000000-0000-4000-8000-0000000000c3';
    const { service, tx, record } = build();
    await service.update(
      USER,
      APP,
      INSPECTION,
      { inspectorUserId: other, reason: 'sick' },
      'ip',
    );
    const data = tx.inspection.update.mock.calls[0][0].data;
    expect(data).toMatchObject({ inspectorId: other, assignedByUserId: USER });
    expect(data.assignedAt).toBeInstanceOf(Date);
    expect(record).toHaveBeenCalledTimes(1);
    expect(record.mock.calls[0][1]).toBe('INSPECTION_REASSIGNED');
    expect(record.mock.calls[0][2]).toMatchObject({ reason: 'sick' });
    expect(record.mock.calls[0][4]).toMatchObject({
      inspectorUserId: INSPECTOR,
    });
  });

  it('setting a first schedule moves PENDING to SCHEDULED; it must be in the future', async () => {
    const { service, tx, record } = build();
    await service.update(USER, APP, INSPECTION, { scheduledAt: FUTURE }, 'ip');
    expect(tx.inspection.update.mock.calls[0][0].data).toMatchObject({
      status: 'SCHEDULED',
    });
    expect(record.mock.calls[0][1]).toBe('INSPECTION_SCHEDULED');
    await expect(
      update({}, { scheduledAt: '2020-01-01T00:00:00Z' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('changing the schedule or the inspector withdraws the inspector’s confirmation; changing only the site keeps it', async () => {
    const other = '00000000-0000-4000-8000-0000000000c3';
    const rescheduled = build();
    await rescheduled.service.update(
      USER,
      APP,
      INSPECTION,
      { scheduledAt: FUTURE },
      'ip',
    );
    expect(
      rescheduled.tx.inspection.update.mock.calls[0][0].data,
    ).toMatchObject({
      confirmedAt: null,
      confirmedByUserId: null,
    });
    const reassigned = build();
    await reassigned.service.update(
      USER,
      APP,
      INSPECTION,
      { inspectorUserId: other, reason: 'sick' },
      'ip',
    );
    expect(reassigned.tx.inspection.update.mock.calls[0][0].data).toMatchObject(
      {
        confirmedAt: null,
        confirmedByUserId: null,
      },
    );
    const siteOnly = build();
    await siteOnly.service.update(
      USER,
      APP,
      INSPECTION,
      { siteAddress: 'Plot 9' },
      'ip',
    );
    const data = siteOnly.tx.inspection.update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('confirmedAt');
    expect(data).not.toHaveProperty('confirmedByUserId');
  });

  it('does not re-assign or re-stamp the inspector when only the schedule changes', async () => {
    const { service, tx } = build();
    await service.update(USER, APP, INSPECTION, { scheduledAt: FUTURE }, 'ip');
    const data = tx.inspection.update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('assignedByUserId');
    expect(data).not.toHaveProperty('assignedAt');
  });
});

describe('InspectionsService: notifying the applicant (FRD 26.1)', () => {
  it('tells the applicant side when an inspection is created WITH a date, and only then', async () => {
    const scheduled = build();
    await scheduled.service.create(
      USER,
      APP,
      {
        inspectorUserId: INSPECTOR,
        siteAddress: 'Plot 4',
        scheduledAt: FUTURE,
      },
      'ip',
    );
    expect(scheduled.notifications.inspectionScheduled).toHaveBeenCalledWith(
      APP,
      expect.any(String),
      new Date(FUTURE),
    );
    const pending = build();
    await pending.service.create(
      USER,
      APP,
      { inspectorUserId: INSPECTOR, siteAddress: 'Plot 4' },
      'ip',
    );
    expect(pending.notifications.inspectionScheduled).not.toHaveBeenCalled();
  });

  it('a first schedule is "scheduled"; moving an existing one is "rescheduled"; neither for a site change', async () => {
    const first = build();
    await first.service.update(
      USER,
      APP,
      INSPECTION,
      { scheduledAt: FUTURE },
      'ip',
    );
    expect(first.notifications.inspectionScheduled).toHaveBeenCalledTimes(1);
    expect(first.notifications.inspectionRescheduled).not.toHaveBeenCalled();

    const moved = build({
      existing: row({
        status: 'SCHEDULED',
        scheduledAt: new Date('2099-01-01T00:00:00Z'),
      }),
    });
    await moved.service.update(
      USER,
      APP,
      INSPECTION,
      { scheduledAt: FUTURE },
      'ip',
    );
    expect(moved.notifications.inspectionRescheduled).toHaveBeenCalledWith(
      APP,
      expect.any(String),
      new Date(FUTURE),
      expect.any(Date),
    );
    expect(moved.notifications.inspectionScheduled).not.toHaveBeenCalled();

    const site = build();
    await site.service.update(
      USER,
      APP,
      INSPECTION,
      { siteAddress: 'Elsewhere' },
      'ip',
    );
    expect(site.notifications.inspectionScheduled).not.toHaveBeenCalled();
    expect(site.notifications.inspectionRescheduled).not.toHaveBeenCalled();
  });

  it('a refused change notifies nobody', async () => {
    const b = build({ state: 'RECOMMENDED_FOR_APPROVAL' });
    await expect(
      b.service.update(USER, APP, INSPECTION, { scheduledAt: FUTURE }, 'ip'),
    ).rejects.toBeDefined();
    expect(b.notifications.inspectionScheduled).not.toHaveBeenCalled();
    expect(b.notifications.inspectionRescheduled).not.toHaveBeenCalled();
  });
});
