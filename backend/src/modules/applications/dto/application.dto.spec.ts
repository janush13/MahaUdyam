import { ValidationPipe } from '@nestjs/common';
import { CreateApplicationDto } from './create-application.dto';
import { ListApplicationsQueryDto } from './list-applications-query.dto';
import { SubmitApplicationDto } from './submit-application.dto';
import { UpdateApplicationDraftDto } from './update-application-draft.dto';

const UUID = '10000000-0000-4000-8000-000000000001';

/** The same pipe configuration the app uses (whitelist + forbidNonWhitelisted
 * + transform), so these tests exercise what a real request goes through. */
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});
const run = (type: new () => unknown, value: unknown) =>
  pipe.transform(value, { type: 'body', metatype: type });
const rejects = async (type: new () => unknown, value: unknown) => {
  await expect(run(type, value)).rejects.toBeDefined();
};

describe('application DTOs', () => {
  describe('CreateApplicationDto', () => {
    it('accepts the approval, the snapshot and optional details', async () => {
      await expect(
        run(CreateApplicationDto, {
          approvalTypeId: UUID,
          discoverySnapshotId: UUID,
          formData: { a: 1 },
        }),
      ).resolves.toMatchObject({ approvalTypeId: UUID });
      await expect(
        run(CreateApplicationDto, {
          approvalTypeId: UUID,
          discoverySnapshotId: UUID,
        }),
      ).resolves.toBeDefined();
    });

    it.each([
      ['a missing approval', { discoverySnapshotId: UUID }],
      ['a missing snapshot', { approvalTypeId: UUID }],
      [
        'a non-uuid approval',
        { approvalTypeId: 'x', discoverySnapshotId: UUID },
      ],
      [
        'a non-uuid snapshot',
        { approvalTypeId: UUID, discoverySnapshotId: 'x' },
      ],
      [
        'formData that is not an object',
        { approvalTypeId: UUID, discoverySnapshotId: UUID, formData: 'x' },
      ],
    ])('rejects %s', async (_l, body) => {
      await rejects(CreateApplicationDto, body);
    });

    it.each([
      'enterpriseId',
      'projectId',
      'ownerUserId',
      'workflowId',
      'status',
      'internalState',
      'applicantStatus',
      'referenceNumber',
      'createdByUserId',
    ])('refuses the client-supplied field %s', async (field) => {
      await rejects(CreateApplicationDto, {
        approvalTypeId: UUID,
        discoverySnapshotId: UUID,
        [field]: UUID,
      });
    });
  });

  describe('UpdateApplicationDraftDto', () => {
    it('accepts only formData', async () => {
      await expect(
        run(UpdateApplicationDraftDto, { formData: { a: 'x' } }),
      ).resolves.toBeDefined();
    });

    it.each([
      ['no body fields', {}],
      ['a non-object formData', { formData: [1] }],
      ['a status', { formData: {}, applicantStatus: 'APPROVED' }],
      ['an internal state', { formData: {}, internalState: 'APPROVED' }],
      ['a project', { formData: {}, projectId: UUID }],
      ['an approval', { formData: {}, approvalTypeId: UUID }],
      ['a discovery link', { formData: {}, discoverySnapshotId: UUID }],
    ])('rejects %s', async (_l, body) => {
      await rejects(UpdateApplicationDraftDto, body);
    });
  });

  describe('SubmitApplicationDto', () => {
    it('accepts exactly declarationAccepted: true', async () => {
      await expect(
        run(SubmitApplicationDto, { declarationAccepted: true }),
      ).resolves.toEqual({ declarationAccepted: true });
    });

    it.each([
      ['false', { declarationAccepted: false }],
      ['the string "true"', { declarationAccepted: 'true' }],
      ['missing', {}],
      ['a status', { declarationAccepted: true, applicantStatus: 'APPROVED' }],
      [
        'an internal state',
        { declarationAccepted: true, internalState: 'APPROVED' },
      ],
    ])('rejects %s', async (_l, body) => {
      await rejects(SubmitApplicationDto, body);
    });
  });

  describe('ListApplicationsQueryDto', () => {
    it('accepts valid filters and none', async () => {
      await expect(run(ListApplicationsQueryDto, {})).resolves.toBeDefined();
      await expect(
        run(ListApplicationsQueryDto, {
          approvalTypeId: UUID,
          applicantStatus: 'READY_TO_SUBMIT',
        }),
      ).resolves.toBeDefined();
    });

    it.each([
      ['an unknown status', { applicantStatus: 'NOPE' }],
      ['a non-uuid approval', { approvalTypeId: 'x' }],
      ['an unknown filter', { anything: 'x' }],
    ])('rejects %s', async (_l, body) => {
      await rejects(ListApplicationsQueryDto, body);
    });
  });
});
