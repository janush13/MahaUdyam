import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { ValidationError, validate } from 'class-validator';
import { DecideDto, IssueCertificateDto } from './decision-request.dto';

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

describe('decision DTOs (the global pipe: whitelist + forbidNonWhitelisted)', () => {
  describe('DecideDto', () => {
    it('needs an outcome and a reason', async () => {
      expect(
        await check(DecideDto, {
          outcome: 'APPROVE',
          reason: 'Meets the rule',
        }),
      ).toEqual([]);
      expect(
        await check(DecideDto, { outcome: 'REJECT', reason: 'Not eligible' }),
      ).toEqual([]);
      expect(props(await check(DecideDto, {}))).toEqual(['outcome', 'reason']);
    });

    it('refuses a blank or whitespace-only reason, and an overlong one', async () => {
      for (const reason of ['', '   ']) {
        expect(
          props(await check(DecideDto, { outcome: 'APPROVE', reason })),
        ).toEqual(['reason']);
      }
      expect(
        props(
          await check(DecideDto, {
            outcome: 'APPROVE',
            reason: 'x'.repeat(2001),
          }),
        ),
      ).toEqual(['reason']);
    });

    it('accepts only APPROVE or REJECT (no state names, no other outcome)', async () => {
      for (const outcome of ['APPROVED', 'REJECTED', 'RETURN', 'approve', '']) {
        expect(props(await check(DecideDto, { outcome, reason: 'x' }))).toEqual(
          ['outcome'],
        );
      }
    });

    it('cannot carry a status, recommendation, department, decider, time or certificate', async () => {
      for (const extra of [
        { internalState: 'APPROVED' },
        { applicantStatus: 'APPROVED' },
        { recommendationId: '00000000-0000-4000-8000-000000000001' },
        { recommendation: { outcome: 'APPROVE', reason: 'x' } },
        { departmentId: '00000000-0000-4000-8000-000000000001' },
        { decidedByUserId: '00000000-0000-4000-8000-000000000001' },
        { decidedAt: '2026-01-01T00:00:00Z' },
        { certificateNumber: 'C-1' },
      ]) {
        expect(
          props(
            await check(DecideDto, {
              outcome: 'APPROVE',
              reason: 'x',
              ...extra,
            }),
          ),
        ).toEqual(Object.keys(extra));
      }
    });
  });

  describe('IssueCertificateDto', () => {
    it('the number is optional free text: no scheme is imposed', async () => {
      expect(await check(IssueCertificateDto, {})).toEqual([]);
      expect(
        await check(IssueCertificateDto, {
          certificateNumber: 'ANY/format-01',
        }),
      ).toEqual([]);
      expect(
        props(await check(IssueCertificateDto, { certificateNumber: '  ' })),
      ).toEqual(['certificateNumber']);
      expect(
        props(
          await check(IssueCertificateDto, {
            certificateNumber: 'x'.repeat(101),
          }),
        ),
      ).toEqual(['certificateNumber']);
    });

    it('cannot carry validity, status, document, owner or issuer fields (none is defined)', async () => {
      for (const extra of [
        { validUntil: '2030-01-01' },
        { validFrom: '2026-01-01' },
        { status: 'ACTIVE' },
        { documentId: '00000000-0000-4000-8000-000000000001' },
        { issuedAt: '2026-01-01T00:00:00Z' },
        { issuedByUserId: '00000000-0000-4000-8000-000000000001' },
      ]) {
        expect(props(await check(IssueCertificateDto, extra))).toEqual(
          Object.keys(extra),
        );
      }
    });
  });
});
