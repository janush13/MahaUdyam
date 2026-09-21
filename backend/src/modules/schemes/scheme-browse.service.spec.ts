import { NotFoundException } from '@nestjs/common';
import { SchemeBrowseService } from './scheme-browse.service';

const SCHEME_ID = '00000000-0000-4000-8000-0000000000e1';

function row(over: Record<string, unknown> = {}) {
  return {
    id: SCHEME_ID,
    name: 'Alpha Scheme',
    departmentId: 'dept-1',
    department: { id: 'dept-1', code: 'D1', name: 'Department One' },
    description: 'About alpha',
    benefits: 'Benefit text',
    eligibilityCriteria: 'Criteria text',
    benefitType: null,
    applicableSectors: [],
    applicableDistricts: [],
    applicableEnterpriseSizes: [],
    applicationDeadline: null,
    sourceReference: null,
    documentRequirements: [],
    // Internal fields that must never reach a response:
    publishStatus: 'PUBLISHED',
    isActive: true,
    createdByUserId: 'creator-1',
    version: 4,
    ...over,
  };
}

function build(rows: Array<Record<string, unknown>>) {
  const prisma = {
    scheme: {
      findMany: jest.fn().mockResolvedValue(rows),
      findFirst: jest.fn().mockResolvedValue(rows[0] ?? null),
    },
  };
  return { service: new SchemeBrowseService(prisma as never), prisma };
}
const names = (res: { items: Array<{ name: string }> }) =>
  res.items.map((i) => i.name);

describe('SchemeBrowseService', () => {
  it('reads only PUBLISHED, active schemes of active departments from the database', async () => {
    const { service, prisma } = build([row()]);
    await service.list({});
    expect(prisma.scheme.findMany.mock.calls[0][0].where).toMatchObject({
      publishStatus: 'PUBLISHED',
      isActive: true,
      department: { isActive: true },
    });
    await service.findAvailable(SCHEME_ID).catch(() => undefined);
    expect(prisma.scheme.findFirst.mock.calls[0][0].where).toMatchObject({
      id: SCHEME_ID,
      publishStatus: 'PUBLISHED',
      isActive: true,
    });
  });

  it('never returns rules, publish state, creator or version', async () => {
    const { service } = build([row()]);
    const [item] = (await service.list({})).items;
    for (const internal of [
      'publishStatus',
      'isActive',
      'createdByUserId',
      'version',
      'rules',
    ]) {
      expect(item).not.toHaveProperty(internal);
    }
    expect(item).toMatchObject({
      name: 'Alpha Scheme',
      department: { code: 'D1' },
      eligibilityCriteria: 'Criteria text',
      applicationOpen: true,
    });
  });

  it('a facet the department listed must match; one it did not list is unrestricted and stays', async () => {
    const { service } = build([
      row({ name: 'Pune only', applicableDistricts: ['Pune'] }),
      row({ name: 'Nashik only', applicableDistricts: ['Nashik'] }),
      row({ name: 'Anywhere' }),
    ]);
    expect(names(await service.list({ district: ' pUNe ' }))).toEqual([
      'Pune only',
      'Anywhere',
    ]);
    expect(names(await service.list({ district: 'Mumbai' }))).toEqual([
      'Anywhere',
    ]);
  });

  it('filters sector, enterprise size and department the same way', async () => {
    const { service } = build([
      row({
        name: 'S1',
        applicableSectors: ['25910'],
        applicableEnterpriseSizes: ['small'],
      }),
      row({
        name: 'S2',
        applicableSectors: ['99999'],
        applicableEnterpriseSizes: ['large'],
      }),
    ]);
    expect(names(await service.list({ sector: '25910' }))).toEqual(['S1']);
    expect(names(await service.list({ enterpriseSize: 'LARGE' }))).toEqual([
      'S2',
    ]);
    expect(
      names(await service.list({ sector: '25910', enterpriseSize: 'large' })),
    ).toEqual([]);
    const { prisma } = build([]);
    await new SchemeBrowseService(prisma as never).list({
      departmentId: 'dept-9',
    });
    expect(prisma.scheme.findMany.mock.calls[0][0].where.departmentId).toBe(
      'dept-9',
    );
  });

  it('a benefit-type filter matches only schemes that HAVE that type (exactly, ignoring case)', async () => {
    const { service } = build([
      row({ name: 'Typed', benefitType: 'Type One' }),
      row({ name: 'Untyped', benefitType: null }),
      row({ name: 'Other', benefitType: 'Type Two' }),
    ]);
    expect(names(await service.list({ benefitType: ' type one ' }))).toEqual([
      'Typed',
    ]);
  });

  it('keyword search covers the name, description, benefits and eligibility text', async () => {
    const { service } = build([
      row({ name: 'Zeta' }),
      row({ name: 'Beta', description: 'mentions NEEDLE here' }),
      row({ name: 'Gamma', benefits: 'a needle in the benefits' }),
      row({ name: 'Delta', eligibilityCriteria: 'needle criteria' }),
    ]);
    expect(names(await service.list({ q: 'needle' }))).toEqual([
      'Beta',
      'Gamma',
      'Delta',
    ]);
    expect(names(await service.list({ q: 'zeta' }))).toEqual(['Zeta']);
    expect(names(await service.list({ q: 'nothing' }))).toEqual([]);
  });

  it('pages the filtered result and reports the total', async () => {
    const { service } = build(
      ['A', 'B', 'C', 'D', 'E'].map((name) => row({ name })),
    );
    const page2 = await service.list({ page: 2, pageSize: 2 });
    expect(names(page2)).toEqual(['C', 'D']);
    expect(page2).toMatchObject({ total: 5, page: 2, pageSize: 2 });
    expect(names(await service.list({ page: 3, pageSize: 2 }))).toEqual(['E']);
    expect(names(await service.list({ page: 9, pageSize: 2 }))).toEqual([]);
    expect((await service.list({})).pageSize).toBe(25);
  });

  it('flags a passed deadline as closed, and an open or absent one as open', async () => {
    const { service } = build([
      row({
        name: 'Past',
        applicationDeadline: new Date(Date.now() - 86_400_000),
      }),
      row({
        name: 'Future',
        applicationDeadline: new Date(Date.now() + 86_400_000),
      }),
      row({ name: 'None' }),
    ]);
    const open = Object.fromEntries(
      (await service.list({})).items.map(
        (i: { name: string; applicationOpen: boolean }) => [
          i.name,
          i.applicationOpen,
        ],
      ),
    );
    expect(open).toEqual({ Past: false, Future: true, None: true });
  });

  it('finding one is a 404 for a malformed id (no query) and for a scheme that is not available', async () => {
    const { service, prisma } = build([]);
    await expect(service.findAvailable('nope')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(prisma.scheme.findFirst).not.toHaveBeenCalled();
    prisma.scheme.findFirst.mockResolvedValue(null);
    await expect(service.get(SCHEME_ID)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
