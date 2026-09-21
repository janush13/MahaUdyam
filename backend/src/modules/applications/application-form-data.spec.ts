import {
  FORM_DATA_MAX_FIELDS,
  FORM_DATA_MAX_STRING_LENGTH,
} from './constants/application.constants';
import { validateFormData } from './application-form-data';

describe('validateFormData', () => {
  it('accepts an empty object (Save Draft never requires completeness)', () => {
    expect(validateFormData({})).toEqual({ data: {}, errors: {} });
  });

  it('accepts flat scalar values and null', () => {
    const input = {
      proposedCapacity: '500 units',
      workers: 40,
      usesBoiler: true,
      note: null,
      snake_case_key: 'x',
    };
    expect(validateFormData(input)).toEqual({ data: input, errors: {} });
  });

  it.each([null, undefined, 'text', 5, true, [], [1, 2]])(
    'rejects a non-object root (%p)',
    (input) => {
      expect(validateFormData(input).errors).toHaveProperty('formData');
    },
  );

  it.each([
    ['nested object', { a: { b: 1 } }],
    ['array value', { a: [1, 2] }],
    ['NaN', { a: NaN }],
    ['Infinity', { a: Infinity }],
    ['undefined', { a: undefined }],
    ['function', { a: () => 1 }],
  ])('rejects a %s value', (_label, input) => {
    expect(Object.keys(validateFormData(input).errors)).toEqual(['formData.a']);
  });

  it.each(['1abc', 'Upper', 'has space', 'has-dash', '', 'a.b', '__proto__'])(
    'rejects the field name %p',
    (key) => {
      // JSON.parse keeps "__proto__" as an own key, like a real request body.
      const input = JSON.parse(JSON.stringify({ [key]: 'v' })) as unknown;
      const result = validateFormData(input);
      expect(Object.keys(result.errors)).toHaveLength(1);
      expect(Object.keys(result.data)).toHaveLength(0);
    },
  );

  it('rejects over-long strings and accepts the maximum', () => {
    expect(
      validateFormData({ a: 'x'.repeat(FORM_DATA_MAX_STRING_LENGTH + 1) })
        .errors['formData.a'],
    ).toBeDefined();
    expect(
      validateFormData({ a: 'x'.repeat(FORM_DATA_MAX_STRING_LENGTH) }).errors,
    ).toEqual({});
  });

  it('rejects too many fields and accepts the maximum', () => {
    const build = (n: number) =>
      Object.fromEntries(Array.from({ length: n }, (_, i) => [`f${i}`, i]));
    expect(
      validateFormData(build(FORM_DATA_MAX_FIELDS + 1)).errors.formData,
    ).toBeDefined();
    expect(validateFormData(build(FORM_DATA_MAX_FIELDS)).errors).toEqual({});
  });

  it.each([
    'enterpriseId',
    'enterprise_id',
    'projectId',
    'ownerUserId',
    'owner_user_id',
    'approvalTypeId',
    'discoverySnapshotId',
    'workflowId',
    'createdByUserId',
    'referenceNumber',
    'internalState',
    'applicantStatus',
    'status',
    'id',
  ])('refuses the reserved identity/ownership/status name %s', (key) => {
    const result = validateFormData({ [key]: 'x' });
    expect(result.errors[`formData.${key}`]).toBeDefined();
    expect(result.data).toEqual({});
  });

  it('does not mutate its input', () => {
    const input = { a: 'x', b: 2 };
    const copy = { ...input };
    validateFormData(input);
    expect(input).toEqual(copy);
  });
});
