import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AuthoriseRepresentativeDto } from './authorise-representative.dto';
import { CreateEnterpriseDto } from './create-enterprise.dto';
import { UpdateEnterpriseDto } from './update-enterprise.dto';
import { UpdateRepresentativeDto } from './update-representative.dto';

const valid = {
  name: 'Sahyadri Precision Components Pvt Ltd',
  businessType: 'Private Limited Company',
  registrationNumber: 'UDYAM-MH-26-0012345',
  registrationNumberType: 'UDYAM',
  address: 'Plot 14, MIDC Chakan, Pune, Maharashtra 410501',
  sector: 'Engineering',
};

const failing = async (cls: new () => object, input: object) =>
  (await validate(plainToInstance(cls, input))).map((e) => e.property);

describe('CreateEnterpriseDto (FRD §9.2 mandatory/optional fields)', () => {
  it('accepts the mandatory fields alone', async () => {
    expect(await failing(CreateEnterpriseDto, valid)).toEqual([]);
  });

  it('accepts every optional field when well-formed', async () => {
    expect(
      await failing(CreateEnterpriseDto, {
        ...valid,
        tradeName: 'Sahyadri Precision',
        website: 'https://sahyadri.example.com',
        contactPersonName: 'Meera Kulkarni',
        contactPersonMobile: '9123456780',
      }),
    ).toEqual([]);
  });

  it.each([
    'name',
    'businessType',
    'registrationNumber',
    'registrationNumberType',
    'address',
    'sector',
  ])('requires %s', async (field) => {
    const rest = Object.fromEntries(
      Object.entries(valid).filter(([key]) => key !== field),
    );
    expect(await failing(CreateEnterpriseDto, rest)).toContain(field);
  });

  it('trims input, so a whitespace-only mandatory value is rejected', async () => {
    expect(
      await failing(CreateEnterpriseDto, { ...valid, name: '     ' }),
    ).toContain('name');
    const instance = plainToInstance(CreateEnterpriseDto, {
      ...valid,
      name: '  Acme Ltd  ',
    });
    expect(instance.name).toBe('Acme Ltd');
  });

  it('rejects an over-long name and a too-short address', async () => {
    expect(
      await failing(CreateEnterpriseDto, { ...valid, name: 'x'.repeat(201) }),
    ).toContain('name');
    expect(
      await failing(CreateEnterpriseDto, { ...valid, address: 'abc' }),
    ).toContain('address');
  });

  it('rejects a website without an http(s) protocol, or with a dangerous one', async () => {
    expect(
      await failing(CreateEnterpriseDto, {
        ...valid,
        website: 'sahyadri.example.com',
      }),
    ).toContain('website');
    expect(
      await failing(CreateEnterpriseDto, {
        ...valid,
        website: 'javascript:alert(1)',
      }),
    ).toContain('website');
  });

  it('rejects a malformed contact mobile', async () => {
    expect(
      await failing(CreateEnterpriseDto, {
        ...valid,
        contactPersonMobile: '98ab',
      }),
    ).toContain('contactPersonMobile');
  });

  it('does not hard-code a registration number format (still TBV per FRD §37)', async () => {
    for (const registrationNumber of [
      'U12345MH2020PTC123456',
      'UDYAM-MH-26-0012345',
      '27AAAPL1234C1Z5',
    ]) {
      expect(
        await failing(CreateEnterpriseDto, { ...valid, registrationNumber }),
      ).toEqual([]);
    }
  });
});

describe('UpdateEnterpriseDto', () => {
  it('accepts an empty body at DTO level (the service requires at least one field)', async () => {
    expect(await failing(UpdateEnterpriseDto, {})).toEqual([]);
  });

  it('accepts a partial update', async () => {
    expect(await failing(UpdateEnterpriseDto, { sector: 'Textiles' })).toEqual(
      [],
    );
  });

  it.each([
    'name',
    'businessType',
    'registrationNumber',
    'registrationNumberType',
    'address',
    'sector',
  ])(
    'rejects null for the mandatory field %s (mandatory data can be changed, never cleared)',
    async (field) => {
      expect(await failing(UpdateEnterpriseDto, { [field]: null })).toContain(
        field,
      );
    },
  );

  it.each(['tradeName', 'website', 'contactPersonName', 'contactPersonMobile'])(
    'allows null to clear the optional field %s',
    async (field) => {
      expect(await failing(UpdateEnterpriseDto, { [field]: null })).toEqual([]);
    },
  );

  it('applies the same value rules as creation', async () => {
    expect(await failing(UpdateEnterpriseDto, { name: '  ' })).toContain(
      'name',
    );
    expect(
      await failing(UpdateEnterpriseDto, { website: 'ftp://x.example.com' }),
    ).toContain('website');
  });
});

describe('AuthoriseRepresentativeDto', () => {
  const ok = { emailOrMobile: 'rep@example.com', scope: 'PREPARE_SUBMIT' };

  it('accepts each of the three scopes', async () => {
    for (const scope of ['VIEW_ONLY', 'PREPARE_SUBMIT', 'FULL']) {
      expect(
        await failing(AuthoriseRepresentativeDto, { ...ok, scope }),
      ).toEqual([]);
    }
  });

  it('rejects an unknown scope and a missing scope or identifier', async () => {
    expect(
      await failing(AuthoriseRepresentativeDto, { ...ok, scope: 'ADMIN' }),
    ).toContain('scope');
    expect(
      await failing(AuthoriseRepresentativeDto, {
        emailOrMobile: 'rep@example.com',
      }),
    ).toContain('scope');
    expect(
      await failing(AuthoriseRepresentativeDto, { scope: 'FULL' }),
    ).toContain('emailOrMobile');
  });

  it('validates projectIds as unique UUIDs', async () => {
    const id = '3f9c1f0e-6b1d-4c53-9d0a-5b8a2f7e1c11';
    expect(
      await failing(AuthoriseRepresentativeDto, { ...ok, projectIds: [id] }),
    ).toEqual([]);
    expect(
      await failing(AuthoriseRepresentativeDto, {
        ...ok,
        projectIds: ['nope'],
      }),
    ).toContain('projectIds');
    expect(
      await failing(AuthoriseRepresentativeDto, {
        ...ok,
        projectIds: [id, id],
      }),
    ).toContain('projectIds');
  });

  it('parses expiresAt as a date and rejects garbage', async () => {
    const good = plainToInstance(AuthoriseRepresentativeDto, {
      ...ok,
      expiresAt: '2030-01-01T00:00:00.000Z',
    });
    expect(good.expiresAt).toBeInstanceOf(Date);
    expect(await validate(good)).toHaveLength(0);
    expect(
      await failing(AuthoriseRepresentativeDto, {
        ...ok,
        expiresAt: 'not-a-date',
      }),
    ).toContain('expiresAt');
  });
});

describe('UpdateRepresentativeDto', () => {
  it('accepts scope, projectIds and expiresAt (including null to remove expiry)', async () => {
    expect(await failing(UpdateRepresentativeDto, { scope: 'FULL' })).toEqual(
      [],
    );
    expect(await failing(UpdateRepresentativeDto, { expiresAt: null })).toEqual(
      [],
    );
    expect(await failing(UpdateRepresentativeDto, { projectIds: [] })).toEqual(
      [],
    );
  });

  it('rejects an invalid scope', async () => {
    expect(
      await failing(UpdateRepresentativeDto, { scope: 'OWNER' }),
    ).toContain('scope');
  });
});
