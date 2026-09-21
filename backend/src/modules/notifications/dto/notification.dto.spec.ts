import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  ListNotificationsQueryDto,
  NOTIFICATION_MAX_PAGE_SIZE,
} from './notification.dto';

const check = (query: Record<string, unknown>) => {
  const dto = plainToInstance(ListNotificationsQueryDto, query);
  return { dto, errors: validateSync(dto, { whitelist: true }) };
};

describe('ListNotificationsQueryDto', () => {
  it('accepts an empty query', () => {
    expect(check({}).errors).toEqual([]);
  });

  it('reads unread=true / false from the query string', () => {
    expect(check({ unread: 'true' }).dto.unread).toBe(true);
    expect(check({ unread: 'false' }).dto.unread).toBe(false);
    expect(check({ unread: 'true' }).errors).toEqual([]);
  });

  it('rejects anything else for unread', () => {
    expect(check({ unread: 'maybe' }).errors).not.toEqual([]);
    expect(check({ unread: '1' }).errors).not.toEqual([]);
  });

  it('bounds paging', () => {
    expect(
      check({ page: '1', pageSize: String(NOTIFICATION_MAX_PAGE_SIZE) }).errors,
    ).toEqual([]);
    for (const bad of [
      { page: '0' },
      { page: '-1' },
      { page: '1.5' },
      { pageSize: '0' },
      { pageSize: String(NOTIFICATION_MAX_PAGE_SIZE + 1) },
      { pageSize: 'lots' },
    ]) {
      expect(check(bad).errors).not.toEqual([]);
    }
  });
});
