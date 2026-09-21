import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  AddSlaHolidayDto,
  ListSlaQueryDto,
  MAX_SLA_DAYS,
  UpdateSlaStageDto,
} from './sla-request.dto';

function errors<T extends object>(
  cls: new () => T,
  body: Record<string, unknown>,
) {
  return validateSync(plainToInstance(cls, body), {
    whitelist: true,
    forbidNonWhitelisted: true,
  }).map((e) => e.property);
}

describe('UpdateSlaStageDto', () => {
  it('accepts a positive whole number of days, null, and a pause flag', () => {
    expect(errors(UpdateSlaStageDto, { slaDays: 7 })).toEqual([]);
    expect(errors(UpdateSlaStageDto, { slaDays: null })).toEqual([]);
    expect(errors(UpdateSlaStageDto, { pauseOnQuery: true })).toEqual([]);
    expect(
      errors(UpdateSlaStageDto, { slaDays: MAX_SLA_DAYS, pauseOnQuery: false }),
    ).toEqual([]);
  });

  it('refuses zero, negative, fractional, oversized and non-numeric durations', () => {
    for (const slaDays of [0, -3, 1.5, MAX_SLA_DAYS + 1, '7', true]) {
      expect(errors(UpdateSlaStageDto, { slaDays })).toContain('slaDays');
    }
    expect(errors(UpdateSlaStageDto, { pauseOnQuery: 'yes' })).toContain(
      'pauseOnQuery',
    );
  });

  it('accepts no field that could name a status, a deadline or a department', () => {
    for (const field of [
      'status',
      'dueAt',
      'breachedAt',
      'departmentId',
      'workflowId',
    ]) {
      expect(errors(UpdateSlaStageDto, { slaDays: 1, [field]: 'x' })).toContain(
        field,
      );
    }
  });
});

describe('AddSlaHolidayDto', () => {
  it('needs a YYYY-MM-DD date and a description, trims it, and takes an optional department', () => {
    expect(
      errors(AddSlaHolidayDto, {
        date: '2026-10-02',
        description: '  Holiday  ',
      }),
    ).toEqual([]);
    const dto = plainToInstance(AddSlaHolidayDto, {
      date: '2026-10-02',
      description: '  Holiday  ',
    });
    expect(dto.description).toBe('Holiday');
    for (const date of ['2026-1-2', '02/10/2026', 'tomorrow', 20261002]) {
      expect(errors(AddSlaHolidayDto, { date, description: 'x' })).toContain(
        'date',
      );
    }
    expect(
      errors(AddSlaHolidayDto, { date: '2026-10-02', description: '   ' }),
    ).toContain('description');
    expect(
      errors(AddSlaHolidayDto, {
        date: '2026-10-02',
        description: 'x',
        departmentId: 'no',
      }),
    ).toContain('departmentId');
  });
});

describe('ListSlaQueryDto', () => {
  it('coerces paging and the breached flag, and limits the page size', () => {
    const dto = plainToInstance(ListSlaQueryDto, {
      page: '2',
      pageSize: '50',
      breached: 'true',
      status: 'RUNNING',
    });
    expect(validateSync(dto)).toEqual([]);
    expect(dto).toMatchObject({ page: 2, pageSize: 50, breached: true });
    expect(errors(ListSlaQueryDto, { pageSize: '101' })).toContain('pageSize');
    expect(errors(ListSlaQueryDto, { status: 'BREACHED' })).toContain('status');
  });
});
