import { ValidationPipe } from '@nestjs/common';
import { ListDocumentsQueryDto } from './list-documents-query.dto';
import { ReplaceDocumentDto, UploadDocumentDto } from './upload-document.dto';

const UUID = '10000000-0000-4000-8000-000000000001';

/** The same pipe configuration the app uses (whitelist + forbidNonWhitelisted
 * + transform), so these tests exercise what a real request goes through. */
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});
const run = (
  type: new () => unknown,
  value: unknown,
  kind: 'body' | 'query' = 'body',
) => pipe.transform(value, { type: kind, metatype: type });
const rejects = async (
  type: new () => unknown,
  value: unknown,
  kind: 'body' | 'query' = 'body',
) => {
  await expect(run(type, value, kind)).rejects.toBeDefined();
};

describe('document DTOs', () => {
  describe('UploadDocumentDto', () => {
    it('accepts nothing, a requirement, an expiry date, or both', async () => {
      await expect(run(UploadDocumentDto, {})).resolves.toBeDefined();
      await expect(
        run(UploadDocumentDto, { documentRequirementId: UUID }),
      ).resolves.toBeDefined();
      await expect(
        run(UploadDocumentDto, { expiryDate: '2027-03-31' }),
      ).resolves.toBeDefined();
      await expect(
        run(UploadDocumentDto, {
          documentRequirementId: UUID,
          expiryDate: '2027-03-31',
        }),
      ).resolves.toBeDefined();
    });

    it.each([
      ['a non-uuid requirement', { documentRequirementId: 'x' }],
      ['a dd-mm-yyyy date', { expiryDate: '31-03-2027' }],
      ['a date with a time', { expiryDate: '2027-03-31T00:00:00Z' }],
      ['a date with spaces', { expiryDate: ' 2027-03-31' }],
      ['a non-string date', { expiryDate: 20270331 }],
    ])('rejects %s', async (_l, body) => {
      await rejects(UploadDocumentDto, body);
    });

    it.each([
      'applicationId',
      'projectId',
      'enterpriseId',
      'ownerId',
      'ownerType',
      'uploadedBy',
      'uploadedByUserId',
      'status',
      'scanStatus',
      'scannedAt',
      'scannerName',
      'filePath',
      'storageKey',
      'checksum',
      'version',
      'lineageId',
      'replacedDocumentId',
      'mimeType',
      'originalFilename',
      'sizeBytes',
    ])('refuses the client-supplied field %s', async (field) => {
      await rejects(UploadDocumentDto, { [field]: UUID });
    });
  });

  describe('ReplaceDocumentDto', () => {
    it('accepts nothing or an expiry date', async () => {
      await expect(run(ReplaceDocumentDto, {})).resolves.toBeDefined();
      await expect(
        run(ReplaceDocumentDto, { expiryDate: '2027-03-31' }),
      ).resolves.toBeDefined();
    });

    it.each([
      [
        'a requirement (it is inherited, never re-chosen)',
        { documentRequirementId: UUID },
      ],
      ['a version', { version: 3 }],
      ['a predecessor', { replacedDocumentId: UUID }],
      ['a status', { status: 'VERIFIED' }],
      ['a bad date', { expiryDate: 'soon' }],
    ])('rejects %s', async (_l, body) => {
      await rejects(ReplaceDocumentDto, body);
    });
  });

  describe('ListDocumentsQueryDto', () => {
    it('accepts no filter and true / false as query strings', async () => {
      await expect(run(ListDocumentsQueryDto, {}, 'query')).resolves.toEqual(
        {},
      );
      await expect(
        run(ListDocumentsQueryDto, { includeHistory: 'true' }, 'query'),
      ).resolves.toMatchObject({ includeHistory: true });
      await expect(
        run(ListDocumentsQueryDto, { includeHistory: 'false' }, 'query'),
      ).resolves.toMatchObject({ includeHistory: false });
    });

    it.each([
      ['a non-boolean', { includeHistory: 'maybe' }],
      ['a number', { includeHistory: '1' }],
      ['an unknown filter', { anything: 'x' }],
    ])('rejects %s', async (_l, query) => {
      await rejects(ListDocumentsQueryDto, query, 'query');
    });
  });
});
