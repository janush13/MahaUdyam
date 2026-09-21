import { NotificationRecipientsService } from './notification-recipients.service';

const future = new Date(Date.now() + 86_400_000);
const past = new Date(Date.now() - 86_400_000);

function build(opts: {
  project?: unknown;
  assignment?: { officerUserId: string } | null;
  admins?: string[];
  inactive?: string[];
}) {
  const prisma = {
    project: {
      findUnique: jest.fn().mockResolvedValue(opts.project ?? null),
    },
    applicationAssignment: {
      findFirst: jest.fn().mockResolvedValue(opts.assignment ?? null),
    },
    userRole: {
      findMany: jest
        .fn()
        .mockResolvedValue((opts.admins ?? []).map((userId) => ({ userId }))),
    },
    user: {
      findMany: jest
        .fn()
        .mockImplementation(({ where }) =>
          Promise.resolve(
            (where.id.in as string[])
              .filter((id) => !(opts.inactive ?? []).includes(id))
              .map((id) => ({ id })),
          ),
        ),
    },
  };
  return {
    service: new NotificationRecipientsService(prisma as never),
    prisma,
  };
}

const rep = (
  id: string,
  extra: Partial<{
    status: string;
    expiresAt: Date | null;
    scopedProjectIds: string[];
  }> = {},
) => ({
  representativeUserId: id,
  status: 'ACTIVE',
  expiresAt: null,
  scopedProjectIds: [],
  ...extra,
});

describe('NotificationRecipientsService.applicantSide', () => {
  it('is the enterprise owner plus every live representative covering the project', async () => {
    const { service } = build({
      project: {
        enterprise: {
          ownerUserId: 'owner',
          representatives: [
            rep('unrestricted'),
            rep('this-project', { scopedProjectIds: ['P1', 'P9'] }),
            rep('other-project', { scopedProjectIds: ['P9'] }),
            rep('expired', { expiresAt: past }),
            rep('not-yet-expired', { expiresAt: future }),
          ],
        },
      },
    });
    const out = await service.applicantSide('P1');
    expect(out.sort()).toEqual(
      ['owner', 'unrestricted', 'this-project', 'not-yet-expired'].sort(),
    );
  });

  it('asks the database only for ACTIVE authorisations (PENDING / REVOKED never receive)', async () => {
    const { service, prisma } = build({
      project: { enterprise: { ownerUserId: 'o', representatives: [] } },
    });
    await service.applicantSide('P1');
    expect(
      prisma.project.findUnique.mock.calls[0][0].select.enterprise.select
        .representatives.where,
    ).toEqual({ status: 'ACTIVE' });
  });

  it('skips deactivated accounts, including a deactivated owner', async () => {
    const { service } = build({
      project: {
        enterprise: {
          ownerUserId: 'owner',
          representatives: [rep('r1'), rep('r2')],
        },
      },
      inactive: ['owner', 'r2'],
    });
    expect(await service.applicantSide('P1')).toEqual(['r1']);
  });

  it('is empty for an unknown project', async () => {
    const { service } = build({});
    expect(await service.applicantSide('nope')).toEqual([]);
  });
});

describe('NotificationRecipientsService.officerSide', () => {
  it('is the current assignee plus the Department Administrators of the department, once each', async () => {
    const { service, prisma } = build({
      assignment: { officerUserId: 'so' },
      admins: ['adm1', 'adm2', 'so'],
    });
    const out = await service.officerSide('APP', 'DEPT');
    expect(out.sort()).toEqual(['adm1', 'adm2', 'so']);
    expect(
      prisma.applicationAssignment.findFirst.mock.calls[0][0].where,
    ).toEqual({ applicationId: 'APP', endedAt: null });
    expect(prisma.userRole.findMany.mock.calls[0][0].where).toEqual({
      departmentId: 'DEPT',
      role: { code: 'DEPT_ADMIN' },
    });
  });

  it('is just the administrators when nobody is assigned, and never anyone from elsewhere', async () => {
    const { service } = build({ assignment: null, admins: ['adm1'] });
    expect(await service.officerSide('APP', 'DEPT')).toEqual(['adm1']);
  });

  it('is empty when there is neither an assignee nor an administrator', async () => {
    const { service, prisma } = build({});
    expect(await service.officerSide('APP', 'DEPT')).toEqual([]);
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });
});
