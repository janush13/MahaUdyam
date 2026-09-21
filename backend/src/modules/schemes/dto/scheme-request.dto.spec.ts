import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  AddSchemeRuleDto,
  BrowseSchemesQueryDto,
  CreateSchemeDocumentRequirementDto,
  CreateSchemeDto,
  DecideSchemeApplicationDto,
  ListOfficerSchemeApplicationsQueryDto,
  ListRecommendationsQueryDto,
  SetSchemeActiveDto,
  UpdateSchemeDocumentRequirementDto,
  UpdateSchemeDto,
} from './scheme-request.dto';

const DEPT = '00000000-0000-4000-8000-0000000000d1';
const errors = <T extends object>(
  cls: new () => T,
  body: Record<string, unknown>,
) =>
  validateSync(plainToInstance(cls, body), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
const fields = (list: ReturnType<typeof validateSync>) =>
  list.map((e) => e.property);

describe('CreateSchemeDto', () => {
  const ok = {
    departmentId: DEPT,
    name: 'A test scheme',
    description: 'What it is',
    benefits: 'What it gives',
    eligibilityCriteria: 'Who it is for',
  };

  it('accepts the minimum: a department, name, description, benefits and plain-language criteria - nothing else is required', () => {
    expect(errors(CreateSchemeDto, ok)).toEqual([]);
  });

  it('accepts the optional catalogue fields the requirements define', () => {
    expect(
      errors(CreateSchemeDto, {
        ...ok,
        benefitType: 'Type',
        applicableSectors: ['25910'],
        applicableDistricts: ['Pune'],
        applicableEnterpriseSizes: ['small'],
        applicationDeadline: '2027-03-31T18:29:59.000Z',
        sourceReference: 'GR of some date',
      }),
    ).toEqual([]);
  });

  it('requires each of the required texts, and refuses blank ones', () => {
    for (const field of [
      'name',
      'description',
      'benefits',
      'eligibilityCriteria',
    ]) {
      const without = Object.fromEntries(
        Object.entries(ok).filter(([key]) => key !== field),
      );
      expect(fields(errors(CreateSchemeDto, without))).toContain(field);
      expect(
        fields(errors(CreateSchemeDto, { ...ok, [field]: '   ' })),
      ).toContain(field);
    }
    expect(
      fields(errors(CreateSchemeDto, { ...ok, departmentId: 'x' })),
    ).toContain('departmentId');
  });

  it('refuses a deadline that is not an ISO 8601 instant', () => {
    for (const applicationDeadline of [
      'tomorrow',
      '31/03/2027',
      20270331,
      '2027-13-40',
    ]) {
      expect(
        fields(errors(CreateSchemeDto, { ...ok, applicationDeadline })),
      ).toContain('applicationDeadline');
    }
  });

  it('refuses facet lists that are not lists of non-empty strings, and oversize ones', () => {
    expect(
      fields(errors(CreateSchemeDto, { ...ok, applicableSectors: 'x' })),
    ).toContain('applicableSectors');
    expect(
      fields(errors(CreateSchemeDto, { ...ok, applicableDistricts: [1] })),
    ).toContain('applicableDistricts');
    expect(
      fields(
        errors(CreateSchemeDto, { ...ok, applicableEnterpriseSizes: [' '] }),
      ),
    ).toContain('applicableEnterpriseSizes');
    expect(
      fields(
        errors(CreateSchemeDto, {
          ...ok,
          applicableSectors: Array.from({ length: 51 }, (_, i) => `s${i}`),
        }),
      ),
    ).toContain('applicableSectors');
  });

  it('trims and de-duplicates facet values', () => {
    const dto = plainToInstance(CreateSchemeDto, {
      ...ok,
      applicableDistricts: [' Pune ', 'Pune', 'Nashik'],
    });
    expect(dto.applicableDistricts).toEqual(['Pune', 'Nashik']);
  });

  it('takes nothing the server owns: status, activity, version, creator, publisher', () => {
    for (const forbidden of [
      { publishStatus: 'PUBLISHED' },
      { isActive: false },
      { version: 3 },
      { createdByUserId: DEPT },
      { publishedByUserId: DEPT },
      { publishedAt: '2026-01-01' },
    ]) {
      expect(
        errors(CreateSchemeDto, { ...ok, ...forbidden }).length,
      ).toBeGreaterThan(0);
    }
  });
});

describe('UpdateSchemeDto', () => {
  it('accepts any subset, including null to clear a nullable field', () => {
    expect(errors(UpdateSchemeDto, {})).toEqual([]);
    expect(errors(UpdateSchemeDto, { name: 'New' })).toEqual([]);
    expect(
      errors(UpdateSchemeDto, {
        benefitType: null,
        applicationDeadline: null,
        sourceReference: null,
      }),
    ).toEqual([]);
  });

  it('cannot move a scheme to another department or change server-owned state', () => {
    for (const forbidden of [
      { departmentId: DEPT },
      { publishStatus: 'PUBLISHED' },
      { isActive: true },
    ]) {
      expect(errors(UpdateSchemeDto, forbidden).length).toBeGreaterThan(0);
    }
  });

  it('still refuses blanks and bad deadlines', () => {
    expect(fields(errors(UpdateSchemeDto, { name: '  ' }))).toContain('name');
    expect(
      fields(errors(UpdateSchemeDto, { applicationDeadline: 'soon' })),
    ).toContain('applicationDeadline');
  });
});

describe('AddSchemeRuleDto', () => {
  const ok = {
    conditions: { field: 'district', op: 'equals', value: 'Pune' },
    sourceReference: 'TBD',
  };

  it('accepts a condition object and a source reference (the literal TBD included)', () => {
    expect(errors(AddSchemeRuleDto, ok)).toEqual([]);
    expect(
      errors(AddSchemeRuleDto, {
        ...ok,
        effectiveFrom: '2026-10-01T00:00:00.000Z',
        effectiveTo: '2027-10-01T00:00:00.000Z',
        isActive: false,
        priority: 10,
      }),
    ).toEqual([]);
  });

  it('requires the conditions to be an object and the source reference to be given', () => {
    expect(
      fields(errors(AddSchemeRuleDto, { sourceReference: 'TBD' })),
    ).toContain('conditions');
    expect(
      fields(errors(AddSchemeRuleDto, { ...ok, conditions: 'x' })),
    ).toContain('conditions');
    expect(
      fields(errors(AddSchemeRuleDto, { conditions: ok.conditions })),
    ).toContain('sourceReference');
  });

  it('bounds the priority, and refuses non-instant dates', () => {
    for (const priority of [-1, 10_001, 1.5, '5']) {
      expect(fields(errors(AddSchemeRuleDto, { ...ok, priority }))).toContain(
        'priority',
      );
    }
    expect(
      fields(errors(AddSchemeRuleDto, { ...ok, effectiveFrom: 'x' })),
    ).toContain('effectiveFrom');
  });

  it('takes no version, creator or scheme id from the client', () => {
    for (const forbidden of [
      { version: 2 },
      { createdByUserId: DEPT },
      { schemeId: DEPT },
    ]) {
      expect(
        errors(AddSchemeRuleDto, { ...ok, ...forbidden }).length,
      ).toBeGreaterThan(0);
    }
  });
});

describe('scheme document requirement DTOs', () => {
  it('needs a name and whether it is mandatory; nothing is assumed mandatory', () => {
    expect(
      errors(CreateSchemeDocumentRequirementDto, {
        name: 'Proof',
        isMandatory: false,
      }),
    ).toEqual([]);
    expect(
      fields(errors(CreateSchemeDocumentRequirementDto, { isMandatory: true })),
    ).toContain('name');
    expect(
      fields(errors(CreateSchemeDocumentRequirementDto, { name: 'Proof' })),
    ).toContain('isMandatory');
  });

  it('limits: a positive size, and only the platform’s supported content types', () => {
    const ok = { name: 'Proof', isMandatory: true };
    expect(
      errors(CreateSchemeDocumentRequirementDto, {
        ...ok,
        maxSizeBytes: 1000,
        allowedMimeTypes: ['application/pdf', 'image/png'],
      }),
    ).toEqual([]);
    expect(
      fields(
        errors(CreateSchemeDocumentRequirementDto, { ...ok, maxSizeBytes: 0 }),
      ),
    ).toContain('maxSizeBytes');
    expect(
      fields(
        errors(CreateSchemeDocumentRequirementDto, {
          ...ok,
          allowedMimeTypes: ['application/zip'],
        }),
      ),
    ).toContain('allowedMimeTypes');
  });

  it('an update may clear the description and size limit with null', () => {
    expect(
      errors(UpdateSchemeDocumentRequirementDto, {
        description: null,
        maxSizeBytes: null,
      }),
    ).toEqual([]);
    expect(
      errors(UpdateSchemeDocumentRequirementDto, { schemeId: DEPT }).length,
    ).toBeGreaterThan(0);
  });
});

describe('SetSchemeActiveDto', () => {
  it('needs a boolean', () => {
    expect(errors(SetSchemeActiveDto, { isActive: false })).toEqual([]);
    expect(fields(errors(SetSchemeActiveDto, {}))).toContain('isActive');
    expect(fields(errors(SetSchemeActiveDto, { isActive: 'no' }))).toContain(
      'isActive',
    );
  });
});

describe('DecideSchemeApplicationDto', () => {
  it('takes only the documented outcomes and a mandatory reason', () => {
    expect(
      errors(DecideSchemeApplicationDto, { outcome: 'APPROVE', reason: 'ok' }),
    ).toEqual([]);
    expect(
      errors(DecideSchemeApplicationDto, { outcome: 'REJECT', reason: 'ok' }),
    ).toEqual([]);
    for (const bad of [
      { outcome: 'DISBURSE', reason: 'ok' },
      { outcome: 'approve', reason: 'ok' },
      { outcome: 'APPROVE' },
      { outcome: 'APPROVE', reason: '  ' },
      { outcome: 'APPROVE', reason: 'x'.repeat(2001) },
    ]) {
      expect(errors(DecideSchemeApplicationDto, bad).length).toBeGreaterThan(0);
    }
  });

  it('takes no status, user, time or amount from the client', () => {
    for (const forbidden of [
      { status: 'APPROVED' },
      { decidedByUserId: DEPT },
      { decidedAt: '2026-01-01' },
      { amount: 100 },
    ]) {
      expect(
        errors(DecideSchemeApplicationDto, {
          outcome: 'APPROVE',
          reason: 'ok',
          ...forbidden,
        }).length,
      ).toBeGreaterThan(0);
    }
  });
});

describe('query DTOs', () => {
  it('browsing: filters are trimmed text, paging is bounded, unknown parameters are refused', () => {
    expect(
      errors(BrowseSchemesQueryDto, {
        q: 'loan',
        sector: '25910',
        district: 'Pune',
        enterpriseSize: 'small',
        benefitType: 'Type',
        departmentId: DEPT,
        page: '2',
        pageSize: '50',
      }),
    ).toEqual([]);
    expect(
      fields(errors(BrowseSchemesQueryDto, { pageSize: '1000' })),
    ).toContain('pageSize');
    expect(fields(errors(BrowseSchemesQueryDto, { page: '0' }))).toContain(
      'page',
    );
    expect(
      fields(errors(BrowseSchemesQueryDto, { departmentId: 'x' })),
    ).toContain('departmentId');
    expect(
      errors(BrowseSchemesQueryDto, { hackerParam: '1' }).length,
    ).toBeGreaterThan(0);
  });

  it('recommendations: an optional bounded limit, and no default cap is imposed', () => {
    expect(errors(ListRecommendationsQueryDto, {})).toEqual([]);
    expect(
      plainToInstance(ListRecommendationsQueryDto, {}).limit,
    ).toBeUndefined();
    expect(
      fields(errors(ListRecommendationsQueryDto, { limit: '0' })),
    ).toContain('limit');
    expect(
      fields(errors(ListRecommendationsQueryDto, { limit: '101' })),
    ).toContain('limit');
  });

  it('officer queue: only the documented statuses', () => {
    for (const status of [
      'APPLIED',
      'UNDER_REVIEW',
      'APPROVED',
      'REJECTED',
      'DISBURSED',
    ]) {
      expect(errors(ListOfficerSchemeApplicationsQueryDto, { status })).toEqual(
        [],
      );
    }
    for (const status of ['DRAFT', 'WITHDRAWN', 'QUERY_RAISED']) {
      expect(
        fields(errors(ListOfficerSchemeApplicationsQueryDto, { status })),
      ).toContain('status');
    }
  });
});
