import {
  FORM_DATA_MAX_FIELDS,
  FORM_DATA_MAX_KEY_LENGTH,
  FORM_DATA_MAX_STRING_LENGTH,
} from './constants/application.constants';

/**
 * The approval-specific details an applicant enters (FRD §12, §13.2 "Approval-
 * Specific Details"). The per-approval field definitions — which fields exist,
 * which are mandatory — are department configuration that does not exist yet
 * (Blueprint §13.4 loads them from approval-type config), so NOTHING is
 * invented here: only the structure is checked. A flat map of
 * camelCase/snake_case keys to a scalar (string, finite number, boolean) or
 * null. No nesting, so a stored value can never smuggle in structure.
 *
 * Enterprise and project data are never entered here (FRD §12.2): the values
 * are read from the project at the point of use. Keys that name an identity or
 * ownership field are refused so the application cannot carry a second,
 * silently diverging copy of "who owns this".
 */
export type FormDataValue = string | number | boolean | null;
export type FormData = Record<string, FormDataValue>;

const KEY_PATTERN = /^[a-z][a-zA-Z0-9_]*$/;

/** Compared after lower-casing and dropping underscores, so `enterpriseId`,
 * `enterprise_id` and `EnterpriseID` are all caught. */
const RESERVED_KEYS = new Set([
  'id',
  'enterpriseid',
  'projectid',
  'approvaltypeid',
  'workflowid',
  'discoverysnapshotid',
  'owneruserid',
  'createdbyuserid',
  'submittedbyuserid',
  'referencenumber',
  'internalstate',
  'applicantstatus',
  'status',
]);

export interface FormDataValidation {
  data: FormData;
  /** field -> messages; empty when valid. */
  errors: Record<string, string[]>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Pure; never throws on bad input. `data` holds only the entries that were
 * valid, so callers must check `errors` before trusting it. */
export function validateFormData(input: unknown): FormDataValidation {
  const errors: Record<string, string[]> = {};
  const data: FormData = {};
  const fail = (key: string, message: string) => {
    (errors[key] ??= []).push(message);
  };

  if (!isPlainObject(input)) {
    return { data, errors: { formData: ['must be an object'] } };
  }
  const keys = Object.keys(input);
  if (keys.length > FORM_DATA_MAX_FIELDS) {
    fail('formData', `must have at most ${FORM_DATA_MAX_FIELDS} fields`);
  }

  for (const key of keys.slice(0, FORM_DATA_MAX_FIELDS)) {
    const path = `formData.${key}`;
    if (key.length > FORM_DATA_MAX_KEY_LENGTH || !KEY_PATTERN.test(key)) {
      fail(
        path,
        `field names must start with a lower-case letter, contain only letters, digits and underscores, and be at most ${FORM_DATA_MAX_KEY_LENGTH} characters`,
      );
      continue;
    }
    if (RESERVED_KEYS.has(key.toLowerCase().replace(/_/g, ''))) {
      fail(
        path,
        'this name is reserved: enterprise, project and identity data come from the project record and are not entered on an application',
      );
      continue;
    }
    const value = input[key];
    if (
      value === null ||
      typeof value === 'boolean' ||
      (typeof value === 'number' && Number.isFinite(value))
    ) {
      data[key] = value;
    } else if (typeof value === 'string') {
      if (value.length > FORM_DATA_MAX_STRING_LENGTH) {
        fail(path, `must be at most ${FORM_DATA_MAX_STRING_LENGTH} characters`);
      } else {
        data[key] = value;
      }
    } else {
      fail(path, 'must be a string, a finite number, a boolean or null');
    }
  }
  return { data, errors };
}
