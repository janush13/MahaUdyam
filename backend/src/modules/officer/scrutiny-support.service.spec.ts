import { ConflictException, NotFoundException } from '@nestjs/common';
import { AuditActions } from '../../infrastructure/audit/audit-actions.constant';
import { AuditService } from '../../infrastructure/audit/audit.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { OfficerApplicationContext } from './officer-access.service';
import { ScrutinySupport } from './scrutiny-support.service';

const USER = '00000000-0000-4000-8000-0000000000a1';
const OTHER = '00000000-0000-4000-8000-0000000000a2';
const APP = '11111111-1111-4111-8111-111111111111';

function tx(row: object | null, count = 1) {
  return {
    $queryRaw: jest.fn().mockResolvedValue([]),
    approvalApplication: {
      findUnique: jest.fn().mockResolvedValue(row),
      updateMany: jest.fn().mockResolvedValue({ count }),
    },
  };
}

function build(client: ReturnType<typeof tx>) {
  const prisma = {
    $transaction: jest.fn((fn: (t: unknown) => unknown) => fn(client)),
  } as unknown as PrismaService;
  const record = jest.fn();
  const audit = { record } as unknown as AuditService;
  return { support: new ScrutinySupport(prisma, audit), record };
}

const ctx = (actingRole: 'SCRUTINY_OFFICER' | 'DEPT_ADMIN') =>
  ({
    userId: USER,
    actingRole,
    departmentId: 'dept',
    app: {
      id: APP,
      projectId: 'proj',
      project: { enterpriseId: 'ent' },
      discoveryContext: null,
    },
  }) as unknown as OfficerApplicationContext;

const row = (officer: string | null) => ({
  internalState: 'UNDER_SCRUTINY',
  assignments: officer ? [{ id: 'asg', officerUserId: officer }] : [],
});

describe('ScrutinySupport', () => {
  describe('run', () => {
    it('locks the application row (FOR UPDATE) before letting the operation act', async () => {
      const client = tx(row(USER));
      const { support } = build(client);
      const seen = await support.run(ctx('SCRUTINY_OFFICER'), (_t, locked) =>
        Promise.resolve(locked),
      );
      expect(client.$queryRaw).toHaveBeenCalledTimes(1);
      const sql = (client.$queryRaw.mock.calls[0][0] as string[]).join('?');
      expect(sql).toContain('FOR UPDATE');
      expect(seen).toEqual({
        internalState: 'UNDER_SCRUTINY',
        assignmentId: 'asg',
        assignedOfficerUserId: USER,
      });
    });

    it('is a 404 when the application vanished', async () => {
      const { support } = build(tx(null));
      await expect(
        support.run(ctx('SCRUTINY_OFFICER'), () => Promise.resolve(1)),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('a Scrutiny Officer loses sight of an application reassigned mid-request, and the operation never runs', async () => {
      const { support } = build(tx(row(OTHER)));
      const fn = jest.fn();
      await expect(
        support.run(ctx('SCRUTINY_OFFICER'), fn),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(fn).not.toHaveBeenCalled();
    });

    it('an administrator is not tied to the assignee', async () => {
      const { support } = build(tx(row(OTHER)));
      await expect(
        support.run(ctx('DEPT_ADMIN'), () => Promise.resolve('ok')),
      ).resolves.toBe('ok');
    });
  });

  describe('transitionFor', () => {
    const { support } = build(tx(null));

    it('returns the defined transition', () => {
      expect(
        support.transitionFor('START_SCRUTINY', 'SUBMITTED'),
      ).toMatchObject({ from: 'SUBMITTED', to: 'UNDER_SCRUTINY' });
    });

    it('is a 409 INVALID_STATE_TRANSITION from any other state', () => {
      let thrown: unknown;
      try {
        support.transitionFor('START_SCRUTINY', 'UNDER_SCRUTINY');
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(ConflictException);
      expect((thrown as ConflictException).getResponse()).toMatchObject({
        code: 'INVALID_STATE_TRANSITION',
      });
    });
  });

  describe('apply', () => {
    const transition = {
      action: 'START_SCRUTINY' as const,
      from: 'SUBMITTED' as const,
      to: 'UNDER_SCRUTINY' as const,
      actor: 'OFFICER' as const,
    };

    it('updates only if the state is still the one it was validated against, and moves the applicant status with it', async () => {
      const client = tx(null, 1);
      const { support } = build(client);
      await support.apply(client as never, APP, transition);
      expect(client.approvalApplication.updateMany).toHaveBeenCalledWith({
        where: { id: APP, internalState: 'SUBMITTED' },
        data: expect.objectContaining({
          internalState: 'UNDER_SCRUTINY',
          applicantStatus: 'UNDER_SCRUTINY',
        }),
      });
    });

    it('is a 409 when the guarded update matched nothing (someone else moved it)', async () => {
      const client = tx(null, 0);
      const { support } = build(client);
      await expect(
        support.apply(client as never, APP, transition),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('audit context', () => {
    it('records actor, role, department, enterprise, project and application', async () => {
      const { support, record } = build(tx(null));
      await support.recordOfficerEvent(
        ctx('SCRUTINY_OFFICER'),
        AuditActions.APPLICATION_STATUS_CHANGED,
        { note: 'x' },
        '127.0.0.1',
      );
      expect(record).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: USER,
          roleAtTime: 'SCRUTINY_OFFICER',
          entityType: 'ApprovalApplication',
          entityId: APP,
          afterState: expect.objectContaining({
            enterpriseId: 'ent',
            projectId: 'proj',
            applicationId: APP,
            departmentId: 'dept',
            actingAs: 'SCRUTINY_OFFICER',
            note: 'x',
          }),
        }),
      );
    });
  });
});
