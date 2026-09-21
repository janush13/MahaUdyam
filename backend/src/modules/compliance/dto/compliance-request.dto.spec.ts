import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  CreateComplianceRequirementDto,
  ListComplianceQueryDto,
  MAX_DAYS,
  UpdateComplianceRequirementDto,
} from './compliance-request.dto';

const TYPE = '00000000-0000-4000-8000-0000000000e1';
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

describe('CreateComplianceRequirementDto', () => {
  const ok = {
    approvalTypeId: TYPE,
    description: 'File the return',
    frequency: 'ANNUAL',
  };

  it('accepts the minimum: an approval type, a description and a frequency (no duration is required)', () => {
    expect(errors(CreateComplianceRequirementDto, ok)).toEqual([]);
  });

  it('accepts the full configuration, and an explicit null first due offset ("not yet configured")', () => {
    expect(
      errors(CreateComplianceRequirementDto, {
        ...ok,
        evidenceRequired: true,
        applicantAction: 'Upload it',
        sourceReference: 'Notice 4',
        firstDueAfterDays: 0,
        dueWindowDays: 14,
      }),
    ).toEqual([]);
    expect(
      errors(CreateComplianceRequirementDto, {
        ...ok,
        firstDueAfterDays: null,
      }),
    ).toEqual([]);
  });

  it('only the three frequencies the blueprint defines', () => {
    for (const frequency of ['ONE_TIME', 'MONTHLY', 'ANNUAL']) {
      expect(
        errors(CreateComplianceRequirementDto, { ...ok, frequency }),
      ).toEqual([]);
    }
    for (const frequency of ['WEEKLY', 'QUARTERLY', 'annual', '', 1]) {
      expect(
        fields(errors(CreateComplianceRequirementDto, { ...ok, frequency })),
      ).toContain('frequency');
    }
  });

  it('refuses a blank description (it is trimmed first), a missing type and a bad id', () => {
    expect(
      fields(
        errors(CreateComplianceRequirementDto, { ...ok, description: '   ' }),
      ),
    ).toContain('description');
    expect(
      fields(
        errors(CreateComplianceRequirementDto, { ...ok, approvalTypeId: 'x' }),
      ),
    ).toContain('approvalTypeId');
    expect(
      fields(
        errors(CreateComplianceRequirementDto, {
          description: 'x',
          frequency: 'ANNUAL',
        }),
      ),
    ).toContain('approvalTypeId');
  });

  it('bounds the durations to whole numbers 0..3650', () => {
    for (const bad of [-1, 1.5, '3', MAX_DAYS + 1]) {
      expect(
        fields(
          errors(CreateComplianceRequirementDto, {
            ...ok,
            firstDueAfterDays: bad,
          }),
        ),
      ).toContain('firstDueAfterDays');
      expect(
        fields(
          errors(CreateComplianceRequirementDto, { ...ok, dueWindowDays: bad }),
        ),
      ).toContain('dueWindowDays');
    }
    expect(
      errors(CreateComplianceRequirementDto, {
        ...ok,
        firstDueAfterDays: MAX_DAYS,
      }),
    ).toEqual([]);
  });

  it('refuses fields that are not configuration (a status, a due date, a version, an id)', () => {
    for (const extra of [
      { status: 'FULFILLED' },
      { dueDate: '2027-01-01' },
      { version: 9 },
      { id: TYPE },
      { isActive: false },
    ]) {
      expect(
        errors(CreateComplianceRequirementDto, { ...ok, ...extra }),
      ).not.toEqual([]);
    }
  });
});

describe('UpdateComplianceRequirementDto', () => {
  it('accepts any subset, including clearing the optional fields with null and deactivating', () => {
    expect(errors(UpdateComplianceRequirementDto, {})).toEqual([]);
    expect(
      errors(UpdateComplianceRequirementDto, {
        applicantAction: null,
        sourceReference: null,
        firstDueAfterDays: null,
        isActive: false,
      }),
    ).toEqual([]);
  });

  it('refuses to change the approval type, a status or a version', () => {
    for (const extra of [
      { approvalTypeId: TYPE },
      { status: 'DUE' },
      { version: 3 },
    ]) {
      expect(errors(UpdateComplianceRequirementDto, extra)).not.toEqual([]);
    }
  });

  it('validates what it does accept', () => {
    expect(
      fields(errors(UpdateComplianceRequirementDto, { frequency: 'DAILY' })),
    ).toContain('frequency');
    expect(
      fields(errors(UpdateComplianceRequirementDto, { dueWindowDays: -2 })),
    ).toContain('dueWindowDays');
    expect(
      fields(errors(UpdateComplianceRequirementDto, { description: '  ' })),
    ).toContain('description');
  });
});

describe('ListComplianceQueryDto', () => {
  it('accepts a status and bounded paging', () => {
    expect(
      errors(ListComplianceQueryDto, {
        status: 'OVERDUE',
        page: '2',
        pageSize: '100',
      }),
    ).toEqual([]);
  });
  it('refuses an unknown status and out-of-range paging', () => {
    for (const bad of [
      { status: 'LATE' },
      { page: '0' },
      { pageSize: '0' },
      { pageSize: '101' },
    ]) {
      expect(errors(ListComplianceQueryDto, bad)).not.toEqual([]);
    }
  });
});
