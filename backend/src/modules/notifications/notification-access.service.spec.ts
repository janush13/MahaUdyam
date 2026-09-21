import { NotificationAccessService } from './notification-access.service';

const future = new Date(Date.now() + 86_400_000);
const past = new Date(Date.now() - 86_400_000);
const officerWhere = { id: { in: ['visible-app'] } };

function build(opts: {
  owned?: string[];
  reps?: Array<{
    enterpriseId: string;
    scopedProjectIds: string[];
    status?: string;
    expiresAt?: Date | null;
  }>;
}) {
  const prisma = {
    enterprise: {
      findMany: jest
        .fn()
        .mockResolvedValue((opts.owned ?? []).map((id) => ({ id }))),
    },
    enterpriseRepresentative: {
      findMany: jest.fn().mockResolvedValue(
        (opts.reps ?? []).map((r) => ({
          status: 'ACTIVE',
          expiresAt: null,
          ...r,
        })),
      ),
    },
  };
  const officers = {
    grantsFor: jest
      .fn()
      .mockResolvedValue([{ role: 'DEPT_ADMIN', departmentId: 'd' }]),
    visibilityWhere: jest.fn().mockReturnValue(officerWhere),
  };
  return {
    service: new NotificationAccessService(prisma as never, officers as never),
    prisma,
    officers,
  };
}

describe('NotificationAccessService.visibleWhere', () => {
  it('is always the caller’s own IN_APP rows', async () => {
    const { service } = build({});
    expect(await service.visibleWhere('me')).toMatchObject({
      userId: 'me',
      channel: 'IN_APP',
    });
  });

  it('scopes applicant rows to owned enterprises and unrestricted representations, and project-restricted ones to their projects', async () => {
    const { service } = build({
      owned: ['E-own'],
      reps: [
        { enterpriseId: 'E-all', scopedProjectIds: [] },
        { enterpriseId: 'E-some', scopedProjectIds: ['P1', 'P2'] },
      ],
    });
    const where = await service.visibleWhere('me');
    const applicant = (where.OR as Array<Record<string, unknown>>).find(
      (c) => c.audience === 'APPLICANT',
    );
    expect(applicant).toEqual({
      audience: 'APPLICANT',
      OR: [
        { enterpriseId: { in: ['E-own', 'E-all'] } },
        { projectId: { in: ['P1', 'P2'] } },
      ],
    });
  });

  it('ignores a revoked / pending / expired representation: it no longer opens anything', async () => {
    const { service, prisma } = build({
      reps: [
        { enterpriseId: 'E-expired', scopedProjectIds: [], expiresAt: past },
        { enterpriseId: 'E-live', scopedProjectIds: [], expiresAt: future },
      ],
    });
    const where = await service.visibleWhere('me');
    const applicant = (where.OR as Array<Record<string, unknown>>).find(
      (c) => c.audience === 'APPLICANT',
    ) as { OR: Array<{ enterpriseId?: { in: string[] } }> };
    expect(applicant.OR[0].enterpriseId?.in).toEqual(['E-live']);
    // The database is asked only for ACTIVE ones in the first place.
    expect(
      prisma.enterpriseRepresentative.findMany.mock.calls[0][0].where,
    ).toEqual({
      representativeUserId: 'me',
      status: 'ACTIVE',
    });
  });

  it('a user with no enterprise sees no applicant rows at all (empty sets match nothing)', async () => {
    const { service } = build({});
    const where = await service.visibleWhere('me');
    const applicant = (where.OR as Array<Record<string, unknown>>).find(
      (c) => c.audience === 'APPLICANT',
    ) as { OR: Array<Record<string, { in: string[] }>> };
    expect(applicant.OR.map((c) => Object.values(c)[0].in)).toEqual([[], []]);
  });

  it('scopes officer rows by the SAME visibility rule the officer workspace uses', async () => {
    const { service, officers } = build({});
    const where = await service.visibleWhere('me');
    expect(officers.visibilityWhere).toHaveBeenCalledWith('me', [
      { role: 'DEPT_ADMIN', departmentId: 'd' },
    ]);
    expect(where.OR).toContainEqual({
      audience: 'OFFICER',
      application: officerWhere,
    });
  });

  it('account-level rows (a representative offer) are always the recipient’s own', async () => {
    const { service } = build({});
    const where = await service.visibleWhere('me');
    expect(where.OR).toContainEqual({ audience: 'ACCOUNT' });
  });
});
