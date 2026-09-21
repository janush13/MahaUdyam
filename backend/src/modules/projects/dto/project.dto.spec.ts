import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateProjectDto } from './create-project.dto';
import { UpdateProjectDto } from './update-project.dto';

const valid = {
  name: 'Chakan Unit 2 Expansion',
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
};

/** Property names with errors, including nested ones as `parent.child`. */
async function failing(
  cls: new () => object,
  input: object,
): Promise<string[]> {
  const errors = await validate(plainToInstance(cls, input));
  const flatten = (e: (typeof errors)[number], prefix = ''): string[] => [
    ...(e.constraints ? [prefix + e.property] : []),
    ...(e.children ?? []).flatMap((c) => flatten(c, `${prefix}${e.property}.`)),
  ];
  return errors.flatMap((e) => flatten(e));
}

const MANDATORY = [
  'name',
  'district',
  'taluka',
  'sectorCode',
  'enterpriseSizeBand',
  'investmentAmount',
  'employmentCount',
  'projectStage',
  'landStatus',
  'constructionStatus',
  'productionStatus',
  'hazardousFlag',
];

describe('CreateProjectDto (FRD §9.2 Step 6-7)', () => {
  it('accepts the mandatory fields alone', async () => {
    expect(await failing(CreateProjectDto, valid)).toEqual([]);
  });

  it('accepts every optional field, including lease details on leased land and a hazardous category', async () => {
    expect(
      await failing(CreateProjectDto, {
        ...valid,
        landStatus: 'leased',
        landLeaseDetails: { lessorName: 'MIDC', leaseTermMonths: 99 },
        hazardousFlag: true,
        hazardousCategory: 'Chemical processing',
        industrialArea: 'MIDC Chakan Phase II',
        environmentalCategory: 'Category B',
        additionalSiteDetails: 'Adjoins Unit 1.',
        expectedCommissioningDate: '2027-04-01',
      }),
    ).toEqual([]);
  });

  it.each(MANDATORY)('requires %s', async (field) => {
    const rest = Object.fromEntries(
      Object.entries(valid).filter(([k]) => k !== field),
    );
    expect(await failing(CreateProjectDto, rest)).toContain(field);
  });

  describe('closed value sets (the rule engine matches on these exact values)', () => {
    it.each([
      ['projectStage', 'Greenfield'],
      ['projectStage', 'new'],
      ['landStatus', 'rented'],
      ['landStatus', 'Owned'],
      ['constructionStatus', 'in_progress'],
      ['productionStatus', 'live'],
      ['enterpriseSizeBand', 'huge'],
      ['enterpriseSizeBand', 'MICRO'],
    ])('rejects %s = %s', async (field, value) => {
      expect(
        await failing(CreateProjectDto, { ...valid, [field]: value }),
      ).toContain(field);
    });

    it.each([
      ['projectStage', ['greenfield', 'brownfield', 'expansion']],
      ['landStatus', ['owned', 'leased', 'allotted_by_midc']],
      ['constructionStatus', ['not_started', 'ongoing', 'completed']],
      ['productionStatus', ['pre_production', 'trial', 'commercial']],
      ['enterpriseSizeBand', ['micro', 'small', 'medium', 'large']],
    ] as const)('accepts every documented %s', async (field, values) => {
      for (const value of values) {
        const input = { ...valid, [field]: value } as Record<string, unknown>;
        if (value === 'leased') {
          input.landLeaseDetails = { lessorName: 'MIDC', leaseTermMonths: 12 };
        }
        expect(await failing(CreateProjectDto, input)).toEqual([]);
      }
    });
  });

  describe('numbers', () => {
    it.each([0, -5, '100', 12.345, Number.NaN, 1e13])(
      'rejects investmentAmount %p',
      async (investmentAmount) => {
        expect(
          await failing(CreateProjectDto, { ...valid, investmentAmount }),
        ).toContain('investmentAmount');
      },
    );

    it('accepts two decimal places and the largest accepted amount (15 significant digits, exactly representable)', async () => {
      expect(
        await failing(CreateProjectDto, { ...valid, investmentAmount: 99.99 }),
      ).toEqual([]);
      expect(
        await failing(CreateProjectDto, {
          ...valid,
          investmentAmount: 9_999_999_999_999.99,
        }),
      ).toEqual([]);
    });

    it.each([-1, 1.5, '10', 1_000_001])(
      'rejects employmentCount %p',
      async (employmentCount) => {
        expect(
          await failing(CreateProjectDto, { ...valid, employmentCount }),
        ).toContain('employmentCount');
      },
    );

    it('accepts zero employment (a project may not have hired yet)', async () => {
      expect(
        await failing(CreateProjectDto, { ...valid, employmentCount: 0 }),
      ).toEqual([]);
    });
  });

  it('requires a real boolean for hazardousFlag — the string "false" is not coerced', async () => {
    expect(
      await failing(CreateProjectDto, { ...valid, hazardousFlag: 'false' }),
    ).toContain('hazardousFlag');
    expect(
      await failing(CreateProjectDto, { ...valid, hazardousFlag: 0 }),
    ).toContain('hazardousFlag');
  });

  it('trims text, so whitespace-only mandatory values are rejected', async () => {
    expect(
      await failing(CreateProjectDto, { ...valid, name: '    ' }),
    ).toContain('name');
    expect(
      await failing(CreateProjectDto, { ...valid, district: ' ' }),
    ).toContain('district');
    expect(
      plainToInstance(CreateProjectDto, { ...valid, name: '  Acme Works  ' })
        .name,
    ).toBe('Acme Works');
  });

  it('rejects over-long text', async () => {
    expect(
      await failing(CreateProjectDto, { ...valid, name: 'x'.repeat(201) }),
    ).toContain('name');
    expect(
      await failing(CreateProjectDto, {
        ...valid,
        additionalSiteDetails: 'x'.repeat(2001),
      }),
    ).toContain('additionalSiteDetails');
  });

  describe('lease details', () => {
    const leased = { ...valid, landStatus: 'leased' };

    it('validates the nested object: both lessor and term are required', async () => {
      expect(
        await failing(CreateProjectDto, {
          ...leased,
          landLeaseDetails: { lessorName: 'MIDC' },
        }),
      ).toContain('landLeaseDetails.leaseTermMonths');
      expect(
        await failing(CreateProjectDto, {
          ...leased,
          landLeaseDetails: { leaseTermMonths: 12 },
        }),
      ).toContain('landLeaseDetails.lessorName');
      expect(
        await failing(CreateProjectDto, {
          ...leased,
          landLeaseDetails: { lessorName: 'MIDC', leaseTermMonths: 0 },
        }),
      ).toContain('landLeaseDetails.leaseTermMonths');
      expect(
        await failing(CreateProjectDto, {
          ...leased,
          landLeaseDetails: { lessorName: 'MIDC', leaseTermMonths: 1.5 },
        }),
      ).toContain('landLeaseDetails.leaseTermMonths');
    });
  });

  describe('expectedCommissioningDate', () => {
    it.each(['2027-04-01', '2026-12-31'])(
      'accepts %s',
      async (expectedCommissioningDate) => {
        expect(
          await failing(CreateProjectDto, {
            ...valid,
            expectedCommissioningDate,
          }),
        ).toEqual([]);
      },
    );

    it.each([
      '01-04-2027',
      '2027/04/01',
      '2027-13-01',
      '2027-00-10',
      '2027-04-32',
      'tomorrow',
      '2027-04-01T00:00:00Z',
    ])('rejects %s', async (expectedCommissioningDate) => {
      expect(
        await failing(CreateProjectDto, {
          ...valid,
          expectedCommissioningDate,
        }),
      ).toContain('expectedCommissioningDate');
    });
  });
});

describe('UpdateProjectDto', () => {
  it('accepts an empty body at DTO level (the service requires at least one field) and a partial update', async () => {
    expect(await failing(UpdateProjectDto, {})).toEqual([]);
    expect(await failing(UpdateProjectDto, { employmentCount: 55 })).toEqual(
      [],
    );
  });

  it.each(MANDATORY)(
    'rejects null for the mandatory field %s (can be changed, never cleared)',
    async (field) => {
      expect(await failing(UpdateProjectDto, { [field]: null })).toContain(
        field,
      );
    },
  );

  it.each([
    'industrialArea',
    'landLeaseDetails',
    'hazardousCategory',
    'environmentalCategory',
    'additionalSiteDetails',
    'expectedCommissioningDate',
  ])('allows null to clear the optional field %s', async (field) => {
    expect(await failing(UpdateProjectDto, { [field]: null })).toEqual([]);
  });

  it('applies the same value rules as creation', async () => {
    expect(
      await failing(UpdateProjectDto, { projectStage: 'Greenfield' }),
    ).toContain('projectStage');
    expect(await failing(UpdateProjectDto, { investmentAmount: -1 })).toContain(
      'investmentAmount',
    );
    expect(await failing(UpdateProjectDto, { name: '  ' })).toContain('name');
    expect(
      await failing(UpdateProjectDto, { hazardousFlag: 'true' }),
    ).toContain('hazardousFlag');
    expect(
      await failing(UpdateProjectDto, {
        expectedCommissioningDate: '2027-13-01',
      }),
    ).toContain('expectedCommissioningDate');
    expect(
      await failing(UpdateProjectDto, {
        landLeaseDetails: { lessorName: 'X' },
      }),
    ).toContain('landLeaseDetails.lessorName');
  });
});
