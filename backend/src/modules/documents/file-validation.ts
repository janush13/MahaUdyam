import {
  DANGEROUS_EXTENSIONS,
  MAX_FILENAME_LENGTH,
  RESERVED_DEVICE_NAMES,
  SUPPORTED_DOCUMENT_TYPES,
  SupportedMime,
} from './constants/document.constants';

/**
 * Server-side validation of an uploaded file — pure functions over bytes and
 * strings, no I/O and no framework. Nothing here trusts the browser: the type
 * is decided from the CONTENT, the declared type and the extension must agree
 * with it, and the filename is validated as data (it is never used as a path).
 */

export type UploadRejection =
  | 'FILE_EMPTY'
  | 'FILE_TOO_LARGE'
  | 'UNSUPPORTED_TYPE'
  | 'MIME_TYPE_MISMATCH'
  | 'INVALID_FILENAME'
  | 'CORRUPT_FILE';

export type FilenameResult =
  | { ok: true; name: string; extension: string }
  | { ok: false; message: string };

export type UploadCheck =
  | { ok: true; filename: string; mime: SupportedMime; size: number }
  | { ok: false; code: UploadRejection; message: string };

/** multipart parsers hand over the filename decoded as latin1; a UTF-8 name
 * therefore arrives as mojibake. Recover it when the round trip is clean. */
export function decodeMultipartFilename(raw: string): string {
  const recovered = Buffer.from(raw, 'latin1').toString('utf8');
  return recovered.includes('\uFFFD') ? raw : recovered;
}

// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
// Bidirectional-override characters can make "evil.exe" display as "evilexe.pdf".
const BIDI_CONTROLS = /[\u202a-\u202e\u2066-\u2069\u200e\u200f]/;

/**
 * Validates an original filename. It is stored only as metadata, but it ends
 * up in downloads and UIs, so anything path-like, control-character-laden or
 * executable-looking is refused rather than "cleaned".
 */
export function validateFilename(raw: unknown): FilenameResult {
  if (typeof raw !== 'string') {
    return { ok: false, message: 'The file has no name.' };
  }
  const name = raw.normalize('NFC').trim();
  if (name.length === 0) {
    return { ok: false, message: 'The file has no name.' };
  }
  if (name.length > MAX_FILENAME_LENGTH) {
    return {
      ok: false,
      message: `The file name must be at most ${MAX_FILENAME_LENGTH} characters.`,
    };
  }
  if (
    name.includes('/') ||
    name.includes('\\') ||
    name.includes(':') ||
    CONTROL_CHARACTERS.test(name) ||
    BIDI_CONTROLS.test(name)
  ) {
    return {
      ok: false,
      message:
        'The file name must not contain path separators, colons or control characters.',
    };
  }
  if (name.startsWith('.') || name.endsWith('.') || name.endsWith(' ')) {
    return {
      ok: false,
      message: 'The file name must not start or end with a dot or a space.',
    };
  }
  const segments = name.toLowerCase().split('.');
  if (segments.some((segment) => segment === '')) {
    return { ok: false, message: 'The file name must not contain "..".' };
  }
  if (segments.length < 2) {
    return { ok: false, message: 'The file name must have an extension.' };
  }
  if (RESERVED_DEVICE_NAMES.has(segments[0].trim())) {
    return { ok: false, message: 'This file name is reserved.' };
  }
  const extension = segments[segments.length - 1];
  if (segments.slice(1).some((segment) => DANGEROUS_EXTENSIONS.has(segment))) {
    return {
      ok: false,
      message: 'Executable or script file names are not accepted.',
    };
  }
  return { ok: true, name, extension };
}

export interface DetectedType {
  mime: SupportedMime;
  extensions: readonly string[];
}

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const PNG_IEND = Buffer.from([
  0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

const typeOf = (mime: SupportedMime): DetectedType => {
  const found = SUPPORTED_DOCUMENT_TYPES.find((t) => t.mime === mime)!;
  return { mime: found.mime, extensions: found.extensions };
};

/** The content type of the bytes, from their leading signature — or null when
 * they are none of the supported types (executables, scripts, archives,
 * anything unknown). */
export function detectFileType(data: Buffer): DetectedType | null {
  if (data.length >= 5 && data.subarray(0, 5).toString('latin1') === '%PDF-') {
    return typeOf('application/pdf');
  }
  if (
    data.length >= 3 &&
    data[0] === 0xff &&
    data[1] === 0xd8 &&
    data[2] === 0xff
  ) {
    return typeOf('image/jpeg');
  }
  if (
    data.length >= PNG_SIGNATURE.length &&
    data.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
  ) {
    return typeOf('image/png');
  }
  return null;
}

function trimTrailing(data: Buffer, isPadding: (byte: number) => boolean) {
  let end = data.length;
  while (end > 0 && isPadding(data[end - 1])) {
    end -= 1;
  }
  return data.subarray(0, end);
}

/** Cheap, format-specific integrity checks ("corrupt upload where
 * detectable"): a truncated file is caught, a legitimately padded one is not
 * refused. This is not a full parser and does not validate a file's meaning. */
export function hasValidStructure(data: Buffer, mime: SupportedMime): boolean {
  switch (mime) {
    case 'application/pdf': {
      const body = trimTrailing(
        data,
        (b) => b === 0x00 || b === 0x0a || b === 0x0d || b === 0x20,
      );
      return body
        .subarray(Math.max(0, body.length - 2048))
        .toString('latin1')
        .includes('%%EOF');
    }
    case 'image/jpeg': {
      const body = trimTrailing(data, (b) => b === 0x00);
      return (
        body.length >= 4 &&
        body[body.length - 2] === 0xff &&
        body[body.length - 1] === 0xd9
      );
    }
    case 'image/png':
      return (
        data.length >= PNG_SIGNATURE.length + 12 + PNG_IEND.length &&
        data.subarray(12, 16).toString('latin1') === 'IHDR' &&
        data.subarray(data.length - PNG_IEND.length).equals(PNG_IEND)
      );
  }
}

const MIME_ALIASES: Record<string, string> = {
  'image/jpg': 'image/jpeg',
  'image/pjpeg': 'image/jpeg',
  'application/x-pdf': 'application/pdf',
};

/** Lower-cased, parameter-free, alias-normalised content type. */
export function normaliseDeclaredMime(declared: unknown): string {
  if (typeof declared !== 'string') {
    return '';
  }
  const bare = declared.split(';')[0].trim().toLowerCase();
  return MIME_ALIASES[bare] ?? bare;
}

export interface UploadInput {
  originalName: unknown;
  declaredMime: unknown;
  data: Buffer;
  /** The effective ceiling: platform limit lowered by the requirement's. */
  maxSizeBytes: number;
  /** Detected types the upload may be (already narrowed by any requirement). */
  acceptedMimes: readonly string[];
}

/**
 * The complete hard validation of an upload (FRD 16.1 "Errors": wrong format,
 * invalid file). Order matters only for the message the caller sees; every
 * check runs before anything is scanned or stored.
 */
export function validateUpload(input: UploadInput): UploadCheck {
  const fail = (code: UploadRejection, message: string): UploadCheck => ({
    ok: false,
    code,
    message,
  });

  const name = validateFilename(input.originalName);
  if (!name.ok) {
    return fail('INVALID_FILENAME', name.message);
  }
  if (input.data.length === 0) {
    return fail('FILE_EMPTY', 'The uploaded file is empty.');
  }
  if (input.data.length > input.maxSizeBytes) {
    return fail(
      'FILE_TOO_LARGE',
      `The file is larger than the ${input.maxSizeBytes} byte limit.`,
    );
  }

  const detected = detectFileType(input.data);
  if (!detected) {
    return fail(
      'UNSUPPORTED_TYPE',
      'Only PDF, JPEG and PNG files are accepted, and the file content must match its type.',
    );
  }
  if (!input.acceptedMimes.includes(detected.mime)) {
    return fail(
      'UNSUPPORTED_TYPE',
      'This document type is not accepted for the selected requirement.',
    );
  }
  if (!detected.extensions.includes(name.extension)) {
    return fail(
      'MIME_TYPE_MISMATCH',
      'The file extension does not match the file content.',
    );
  }
  const declared = normaliseDeclaredMime(input.declaredMime);
  if (
    declared !== '' &&
    declared !== 'application/octet-stream' &&
    declared !== detected.mime
  ) {
    return fail(
      'MIME_TYPE_MISMATCH',
      'The declared content type does not match the file content.',
    );
  }
  if (!hasValidStructure(input.data, detected.mime)) {
    return fail(
      'CORRUPT_FILE',
      'The file appears to be incomplete or corrupt.',
    );
  }
  return {
    ok: true,
    filename: name.name,
    mime: detected.mime,
    size: input.data.length,
  };
}

/**
 * The effective limits for one upload: the platform ceiling, lowered — never
 * raised — by a DocumentRequirement's own limit; and the supported types,
 * narrowed by the requirement's list. An empty / null requirement setting
 * means "platform default" (FRD 14: never a guessed value).
 */
export function effectiveLimits(
  platformMaxBytes: number,
  requirement: {
    maxSizeBytes: number | null;
    allowedMimeTypes: string[];
  } | null,
): { maxSizeBytes: number; acceptedMimes: SupportedMime[] } {
  const supported = SUPPORTED_DOCUMENT_TYPES.map(
    (t) => t.mime as SupportedMime,
  );
  const listed = requirement?.allowedMimeTypes.map(normaliseDeclaredMime) ?? [];
  return {
    maxSizeBytes: Math.min(
      platformMaxBytes,
      requirement?.maxSizeBytes ?? platformMaxBytes,
    ),
    acceptedMimes:
      listed.length === 0
        ? supported
        : supported.filter((m) => listed.includes(m)),
  };
}

/** `Content-Disposition: attachment` value with an ASCII fallback and an
 * RFC 5987 UTF-8 form, so no character in a stored name can break out of the
 * header. */
export function attachmentDisposition(filename: string): string {
  const fallback =
    filename
      .replace(/[^\x20-\x7e]/g, '_')
      .replace(/["\\%;]/g, '_')
      .slice(0, MAX_FILENAME_LENGTH) || 'document';
  const encoded = encodeURIComponent(filename).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
