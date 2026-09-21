import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { ValidationError, validate } from 'class-validator';
import {
  AttachEvidenceDto,
  RecordResultDto,
  RescheduleInspectionDto,
  SubmitReportDto,
} from './inspection-execution.dto';

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

describe('inspection execution DTOs (the global pipe: whitelist + forbidNonWhitelisted)', () => {
  describe('RescheduleInspectionDto', () => {
    it('needs a date-time with an offset and a reason', async () => {
      expect(
        await check(RescheduleInspectionDto, {
          scheduledAt: '2099-10-02T11:00:00+05:30',
          reason: 'Site closed that day',
        }),
      ).toEqual([]);
      expect(props(await check(RescheduleInspectionDto, {}))).toEqual([
        'reason',
        'scheduledAt',
      ]);
      for (const scheduledAt of ['2099-10-02T11:00:00', '2099-10-02', 'soon']) {
        expect(
          props(
            await check(RescheduleInspectionDto, { scheduledAt, reason: 'x' }),
          ),
        ).toEqual(['scheduledAt']);
      }
      expect(
        props(
          await check(RescheduleInspectionDto, {
            scheduledAt: '2099-10-02T11:00:00Z',
            reason: '   ',
          }),
        ),
      ).toEqual(['reason']);
    });

    it('cannot carry a status, an inspector or a confirmation', async () => {
      for (const extra of [
        { status: 'COMPLETED' },
        { inspectorUserId: UUID },
        { confirmedAt: '2099-10-02T11:00:00Z' },
      ]) {
        expect(
          props(
            await check(RescheduleInspectionDto, {
              scheduledAt: '2099-10-02T11:00:00Z',
              reason: 'x',
              ...extra,
            }),
          ),
        ).toEqual(Object.keys(extra));
      }
    });
  });

  describe('RecordResultDto', () => {
    const valid = {
      checklistItemId: UUID,
      response: 'Extinguishers present',
      finding: 'COMPLIANT',
    };

    it('accepts a result with optional notes and evidence', async () => {
      expect(await check(RecordResultDto, valid)).toEqual([]);
      expect(
        await check(RecordResultDto, {
          ...valid,
          finding: 'CONDITIONAL',
          notes: 'Recheck in a week',
          evidenceId: UUID,
        }),
      ).toEqual([]);
    });

    it('needs an item, a response and a finding from the defined three', async () => {
      expect(props(await check(RecordResultDto, {}))).toEqual([
        'checklistItemId',
        'finding',
        'response',
      ]);
      for (const finding of ['PASS', 'RE_INSPECTION_REQUIRED', 'compliant']) {
        expect(
          props(await check(RecordResultDto, { ...valid, finding })),
        ).toEqual(['finding']);
      }
      expect(
        props(await check(RecordResultDto, { ...valid, response: '  ' })),
      ).toEqual(['response']);
      expect(
        props(
          await check(RecordResultDto, {
            ...valid,
            response: 'x'.repeat(2001),
          }),
        ),
      ).toEqual(['response']);
      expect(
        props(await check(RecordResultDto, { ...valid, evidenceId: 'x' })),
      ).toEqual(['evidenceId']);
    });

    it('cannot carry an inspection, a recorder, a timestamp or a raw document id', async () => {
      for (const extra of [
        { inspectionId: UUID },
        { recordedByUserId: UUID },
        { recordedAt: '2026-01-01T00:00:00Z' },
        { evidenceDocumentId: UUID },
        { itemText: 'rewritten' },
      ]) {
        expect(
          props(await check(RecordResultDto, { ...valid, ...extra })),
        ).toEqual(Object.keys(extra));
      }
    });
  });

  describe('AttachEvidenceDto', () => {
    it('everything is optional; a capture time needs an offset', async () => {
      expect(await check(AttachEvidenceDto, {})).toEqual([]);
      expect(
        await check(AttachEvidenceDto, {
          capturedAt: '2026-10-02T11:20:00+05:30',
          caption: 'Fire exit, north side',
        }),
      ).toEqual([]);
      expect(
        props(await check(AttachEvidenceDto, { capturedAt: '2026-10-02' })),
      ).toEqual(['capturedAt']);
      expect(
        props(await check(AttachEvidenceDto, { caption: 'x'.repeat(501) })),
      ).toEqual(['caption']);
    });

    it('never accepts a location, a document id, an owner or scan state', async () => {
      for (const extra of [
        { latitude: 19.07 },
        { longitude: 72.87 },
        { location: 'x' },
        { documentId: UUID },
        { ownerId: UUID },
        { status: 'VERIFIED' },
        { scannedAt: '2026-10-02T11:20:00Z' },
      ]) {
        expect(props(await check(AttachEvidenceDto, extra))).toEqual(
          Object.keys(extra),
        );
      }
    });
  });

  describe('SubmitReportDto', () => {
    it('needs a finding and observations; a corrective action is optional here', async () => {
      expect(
        await check(SubmitReportDto, {
          overallFinding: 'COMPLIANT',
          summary: 'All in order',
        }),
      ).toEqual([]);
      expect(
        await check(SubmitReportDto, {
          overallFinding: 'NON_COMPLIANT',
          summary: 'Blocked exit',
          correctiveAction: 'Clear the exit',
        }),
      ).toEqual([]);
      expect(props(await check(SubmitReportDto, {}))).toEqual([
        'overallFinding',
        'summary',
      ]);
      expect(
        props(
          await check(SubmitReportDto, {
            overallFinding: 'RE_INSPECTION',
            summary: 'x',
          }),
        ),
      ).toEqual(['overallFinding']);
    });

    it('cannot carry a status, completion flag or inspection outcome the requirements do not define', async () => {
      for (const extra of [
        { status: 'COMPLETED' },
        { completed: true },
        { outcome: 'RE_INSPECTION_REQUIRED' },
        { submittedByUserId: UUID },
        { submittedAt: '2026-01-01T00:00:00Z' },
      ]) {
        expect(
          props(
            await check(SubmitReportDto, {
              overallFinding: 'COMPLIANT',
              summary: 'ok',
              ...extra,
            }),
          ),
        ).toEqual(Object.keys(extra));
      }
    });
  });
});
