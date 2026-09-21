import { EnterpriseAccessLevel } from '../../enterprises/constants/representative-scope.constant';

/**
 * Who may do what with an application's documents, against the EXISTING
 * enterprise access levels (FRD 20.3) — no second permission system.
 *
 *  - View / list / download: any live scope ("View applications/status/
 *    documents"; View Only "cannot submit, respond, or upload").
 *  - Upload / replace: Prepare & Submit or above ("fill, upload, and submit").
 */
export const DOCUMENT_READ_LEVEL: EnterpriseAccessLevel = 'VIEW_ONLY';
export const DOCUMENT_WRITE_LEVEL: EnterpriseAccessLevel = 'PREPARE_SUBMIT';

/** Multipart field name of the uploaded file. */
export const UPLOAD_FIELD = 'file';

/** Longest stored / displayed original filename. */
export const MAX_FILENAME_LENGTH = 255;

/** What a stored document may be, by CONTENT (magic bytes), never by the
 * client-declared type alone. FRD 14 lists "PDF, JPG, PNG (typical) — TO BE
 * VALIDATED WITH GOVERNMENT DEPARTMENT", so only these three, which the
 * platform can verify, are supported; a DocumentRequirement can narrow the set
 * but never widen it. */
export const SUPPORTED_DOCUMENT_TYPES = [
  { mime: 'application/pdf', extensions: ['pdf'] },
  { mime: 'image/jpeg', extensions: ['jpg', 'jpeg'] },
  { mime: 'image/png', extensions: ['png'] },
] as const;

export type SupportedMime = (typeof SUPPORTED_DOCUMENT_TYPES)[number]['mime'];

/** A filename segment (between dots) that names an executable / script /
 * installer / macro-capable type is refused outright, including in a "double
 * extension" such as `invoice.exe.pdf`. Original filenames are only metadata
 * and never a filesystem path, but they reach downloads and UIs. */
export const DANGEROUS_EXTENSIONS: ReadonlySet<string> = new Set([
  'exe',
  'dll',
  'com',
  'scr',
  'msi',
  'bat',
  'cmd',
  'ps1',
  'psm1',
  'vbs',
  'vbe',
  'js',
  'jse',
  'wsf',
  'wsh',
  'jar',
  'sh',
  'bash',
  'php',
  'phtml',
  'asp',
  'aspx',
  'jsp',
  'py',
  'pl',
  'rb',
  'cgi',
  'lnk',
  'reg',
  'hta',
  'cpl',
  'apk',
  'app',
  'bin',
  'html',
  'htm',
  'svg',
  'docm',
  'xlsm',
  'pptm',
]);

/** Windows device names — never valid file names on that platform, and a
 * classic filename-injection trick. */
export const RESERVED_DEVICE_NAMES: ReadonlySet<string> = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  'com1',
  'com2',
  'com3',
  'com4',
  'com5',
  'com6',
  'com7',
  'com8',
  'com9',
  'lpt1',
  'lpt2',
  'lpt3',
  'lpt4',
  'lpt5',
  'lpt6',
  'lpt7',
  'lpt8',
  'lpt9',
]);

/** Storage keys are generated server-side: `documents/<yyyy>/<uuid>`. */
export const STORAGE_KEY_PREFIX = 'documents';

/** How the download response is described in the audit trail / headers. */
export const DOWNLOAD_CACHE_CONTROL = 'private, no-store';
