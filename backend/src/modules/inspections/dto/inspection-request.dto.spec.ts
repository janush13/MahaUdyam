import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { ValidationError, validate } from 'class-validator';
import {
  CreateInspectionDto,
  ListInspectionsQueryDto,
  UpdateInspectionDto,
} from './inspection-request.dto';

const UUID = '00000000-0000-4000-8000-0000000000b2';

async function check<T extends object>(
  cls: new () => T,
  plain: Record<string, unknown>,
): Promise<ValidationError[]> {
  return validate(plainToInstance(cls, plain), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
}
const props = (errors: ValidationError[]) =>
  errors.map((e) => e.property).sort();

describe('inspection request DTOs (the global pipe: whitelist + forbidNonWhitelisted)', () => {
  describe('CreateInspectionDto', () => {
    it('accepts an inspector and a site, with or without a schedule', async () => {
      expect(
        await check(CreateInspectionDto, {
          inspectorUserId: UUID,
          siteAddress: 'Plot 4',
        }),
      ).toEqual([]);
      expect(
        await check(CreateInspectionDto, {
          inspectorUserId: UUID,
          siteAddress: 'Plot 4',
          scheduledAt: '2026-10-01T10:30:00+05:30',
        }),
      ).toEqual([]);
      expect(
        await check(CreateInspectionDto, {
          inspectorUserId: UUID,
          siteAddress: 'Plot 4',
          scheduledAt: '2026-10-01T05:00:00Z',
        }),
      ).toEqual([]);
    });

    it('requires an inspector (a UUID) and a non-blank site', async () => {
      expect(props(await check(CreateInspectionDto, {}))).toEqual([
        'inspectorUserId',
        'siteAddress',
      ]);
      expect(
        props(
          await check(CreateInspectionDto, {
            inspectorUserId: 'x',
            siteAddress: '   ',
          }),
        ),
      ).toEqual(['inspectorUserId', 'siteAddress']);
      expect(
        props(
          await check(CreateInspectionDto, {
            inspectorUserId: UUID,
            siteAddress: 'a'.repeat(501),
          }),
        ),
      ).toEqual(['siteAddress']);
    });

    it('rejects a schedule with no offset, or that is not a date-time', async () => {
      for (const scheduledAt of [
        '2026-10-01T10:30:00',
        '2026-10-01',
        'tomorrow',
        12345,
      ]) {
        expect(
          props(
            await check(CreateInspectionDto, {
              inspectorUserId: UUID,
              siteAddress: 'x',
              scheduledAt,
            }),
          ),
        ).toContain('scheduledAt');
      }
    });

    it('rejects every field a client must never send', async () => {
      for (const extra of [
        { status: 'COMPLETED' },
        { internalState: 'INSPECTION_COMPLETED' },
        { applicationId: UUID },
        { departmentId: UUID },
        { enterpriseId: UUID },
        { createdByUserId: UUID },
        { geoConsentGiven: true },
        { applicationStageId: UUID },
      ]) {
        const errors = await check(CreateInspectionDto, {
          inspectorUserId: UUID,
          siteAddress: 'x',
          ...extra,
        });
        expect(props(errors)).toEqual(Object.keys(extra));
      }
    });
  });

  describe('UpdateInspectionDto', () => {
    it('every field is optional, and validated when present', async () => {
      expect(await check(UpdateInspectionDto, {})).toEqual([]);
      expect(
        await check(UpdateInspectionDto, {
          inspectorUserId: UUID,
          reason: 'sick',
          scheduledAt: '2026-10-01T10:30:00Z',
          siteAddress: 'Plot 9',
        }),
      ).toEqual([]);
      expect(
        props(
          await check(UpdateInspectionDto, {
            inspectorUserId: 'x',
            reason: '',
            siteAddress: '',
          }),
        ),
      ).toEqual(['inspectorUserId', 'reason', 'siteAddress']);
    });

    it('cannot carry a status, or null out the schedule', async () => {
      expect(
        props(await check(UpdateInspectionDto, { status: 'CANCELLED' })),
      ).toEqual(['status']);
      expect(
        props(await check(UpdateInspectionDto, { scheduledAt: 'not-a-date' })),
      ).toContain('scheduledAt');
    });
  });

  describe('ListInspectionsQueryDto', () => {
    it('accepts the closed set of filters and bounds the page size', async () => {
      expect(
        await check(ListInspectionsQueryDto, {
          page: '2',
          pageSize: '100',
          status: 'SCHEDULED',
          applicationId: UUID,
          scheduledFrom: '2026-10-01T00:00:00Z',
          scheduledTo: '2026-10-31T00:00:00+05:30',
        }),
      ).toEqual([]);
      expect(
        props(await check(ListInspectionsQueryDto, { pageSize: '101' })),
      ).toEqual(['pageSize']);
      expect(
        props(await check(ListInspectionsQueryDto, { page: '0' })),
      ).toEqual(['page']);
    });

    it('rejects an unknown status and any unlisted filter (no raw query language)', async () => {
      expect(
        props(await check(ListInspectionsQueryDto, { status: 'DONE' })),
      ).toEqual(['status']);
      expect(
        props(
          await check(ListInspectionsQueryDto, {
            departmentId: UUID,
            where: '1=1',
          }),
        ),
      ).toEqual(['departmentId', 'where']);
    });
  });
});
