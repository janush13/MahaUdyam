import {
  eicarPdf,
  exeBytes,
  jpegBytes,
  pdfBytes,
  pngBytes,
} from '../../../test/support/document-fixtures';
import {
  attachmentDisposition,
  decodeMultipartFilename,
  detectFileType,
  effectiveLimits,
  hasValidStructure,
  normaliseDeclaredMime,
  validateFilename,
  validateUpload,
} from './file-validation';

const ACCEPT_ALL = ['application/pdf', 'image/jpeg', 'image/png'];
const MB = 1024 * 1024;

describe('validateFilename', () => {
  it.each([
    ['report.pdf', 'pdf'],
    ['Site Plan v2.PDF', 'pdf'],
    ['photo.JPEG', 'jpeg'],
    ['a.b.c.png', 'png'],
    ['आधार कार्ड.pdf', 'pdf'],
    ['  padded.pdf  ', 'pdf'],
    ['x'.repeat(251) + '.pdf', 'pdf'],
  ])('accepts %p', (name, extension) => {
    const result = validateFilename(name);
    expect(result).toMatchObject({ ok: true, extension });
  });

  it('returns the trimmed, NFC-normalised name', () => {
    const decomposed = 'cafe\u0301.pdf';
    const result = validateFilename(`  ${decomposed} `);
    expect(result).toEqual({
      ok: true,
      name: 'caf\u00e9.pdf',
      extension: 'pdf',
    });
  });

  it.each([
    ['a relative traversal', '../../etc/passwd.pdf'],
    ['a backslash traversal', '..\\..\\windows\\x.pdf'],
    ['a POSIX path', '/etc/passwd.pdf'],
    ['a Windows drive path', 'C:\\evil.pdf'],
    ['a drive-relative name', 'C:evil.pdf'],
    ['a NUL byte', 'a\u0000b.pdf'],
    ['a newline', 'a\nb.pdf'],
    ['a carriage return', 'a\rb.pdf'],
    ['a tab', 'a\tb.pdf'],
    ['a DEL character', 'a\u007fb.pdf'],
    ['a bidi override', 'invoice\u202Efdp.pdf'],
    ['a bidi isolate', 'a\u2066b.pdf'],
    ['a line separator', 'a\u2028b.pdf'],
    ['a leading dot', '.hidden.pdf'],
    ['a trailing dot', 'report.pdf.'],
    ['a double dot', 'a..pdf'],
    ['no extension', 'report'],
    ['only an extension', '.pdf'],
    ['an over-long name', `${'a'.repeat(300)}.pdf`],
    ['an empty name', ''],
    ['a blank name', '   '],
  ])('rejects %s', (_label, name) => {
    const result = validateFilename(name);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toEqual(expect.any(String));
    }
  });

  it.each([
    'exe',
    'dll',
    'bat',
    'cmd',
    'ps1',
    'vbs',
    'js',
    'jar',
    'sh',
    'php',
    'html',
    'svg',
    'docm',
    'lnk',
  ])('rejects a %s segment anywhere, including a double extension', (ext) => {
    expect(validateFilename(`file.${ext}`).ok).toBe(false);
    expect(validateFilename(`invoice.${ext}.pdf`).ok).toBe(false);
    expect(validateFilename(`invoice.${ext.toUpperCase()}.pdf`).ok).toBe(false);
  });

  it.each(['CON.pdf', 'nul.pdf', 'Aux.png', 'com1.jpg', 'LPT9.pdf'])(
    'rejects the reserved device name %s',
    (name) => {
      expect(validateFilename(name).ok).toBe(false);
    },
  );

  it.each([null, undefined, 42, {}, ['a.pdf']])(
    'rejects a non-string (%p)',
    (value) => {
      expect(validateFilename(value).ok).toBe(false);
    },
  );

  it('does not treat a harmless word containing a dangerous one as dangerous', () => {
    expect(validateFilename('shell-permit.pdf').ok).toBe(true);
    expect(validateFilename('jsonschema.pdf').ok).toBe(true);
  });
});

describe('decodeMultipartFilename', () => {
  it('recovers a UTF-8 name that arrived decoded as latin1', () => {
    const wire = Buffer.from('आधार.pdf', 'utf8').toString('latin1');
    expect(decodeMultipartFilename(wire)).toBe('आधार.pdf');
  });

  it('leaves plain ASCII untouched', () => {
    expect(decodeMultipartFilename('report.pdf')).toBe('report.pdf');
  });

  it('keeps the original when the round trip is not valid UTF-8', () => {
    const notUtf8 = 'caf\u00e9.pdf'; // é as a single latin1 byte
    expect(decodeMultipartFilename(notUtf8)).toBe(notUtf8);
  });
});

describe('detectFileType', () => {
  it('recognises PDF, JPEG and PNG by their signature', () => {
    expect(detectFileType(pdfBytes())?.mime).toBe('application/pdf');
    expect(detectFileType(jpegBytes())?.mime).toBe('image/jpeg');
    expect(detectFileType(pngBytes())?.mime).toBe('image/png');
  });

  it.each([
    ['an executable', exeBytes()],
    ['plain text', Buffer.from('hello world')],
    ['HTML', Buffer.from('<html></html>')],
    ['a ZIP', Buffer.from('PK\u0003\u0004')],
    ['a GIF', Buffer.from('GIF89a')],
    ['a truncated PDF magic', Buffer.from('%PD')],
    ['a PDF magic that is not at the start', Buffer.from(' %PDF-1.4')],
    ['a truncated PNG signature', Buffer.from([0x89, 0x50, 0x4e, 0x47])],
    ['a two-byte JPEG start', Buffer.from([0xff, 0xd8])],
    ['nothing', Buffer.alloc(0)],
  ])('does not recognise %s', (_l, bytes) => {
    expect(detectFileType(bytes)).toBeNull();
  });

  it('decides from content, not from any name', () => {
    // The same bytes are a PDF whatever they are called.
    expect(detectFileType(Buffer.from(pdfBytes()))?.extensions).toEqual([
      'pdf',
    ]);
  });
});

describe('hasValidStructure', () => {
  it('accepts complete files of each type', () => {
    expect(hasValidStructure(pdfBytes(), 'application/pdf')).toBe(true);
    expect(hasValidStructure(jpegBytes(), 'image/jpeg')).toBe(true);
    expect(hasValidStructure(pngBytes(), 'image/png')).toBe(true);
  });

  it('tolerates legitimate trailing padding', () => {
    expect(
      hasValidStructure(
        Buffer.concat([pdfBytes(), Buffer.from('\n\r\n   \0\0')]),
        'application/pdf',
      ),
    ).toBe(true);
    expect(
      hasValidStructure(
        Buffer.concat([jpegBytes(), Buffer.alloc(16)]),
        'image/jpeg',
      ),
    ).toBe(true);
  });

  it.each([
    [
      'a PDF with no EOF marker',
      Buffer.from('%PDF-1.4\n1 0 obj'),
      'application/pdf',
    ],
    [
      'a PDF whose EOF is far from the end',
      Buffer.concat([
        Buffer.from('%PDF-1.4\n%%EOF\n'),
        Buffer.alloc(4096, 0x41),
      ]),
      'application/pdf',
    ],
    ['a truncated JPEG', jpegBytes().subarray(0, 8), 'image/jpeg'],
    [
      'a JPEG missing its end marker',
      Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]),
      'image/jpeg',
    ],
    ['a truncated PNG', pngBytes().subarray(0, 40), 'image/png'],
    [
      'a PNG with the wrong first chunk',
      (() => {
        const png = Buffer.from(pngBytes());
        png.write('XXXX', 12, 'latin1');
        return png;
      })(),
      'image/png',
    ],
  ] as const)('rejects %s', (_l, bytes, mime) => {
    expect(hasValidStructure(bytes, mime)).toBe(false);
  });
});

describe('normaliseDeclaredMime', () => {
  it.each([
    ['application/pdf', 'application/pdf'],
    ['Application/PDF; charset=binary', 'application/pdf'],
    ['image/jpg', 'image/jpeg'],
    ['image/pjpeg', 'image/jpeg'],
    ['application/x-pdf', 'application/pdf'],
    ['', ''],
  ])('%p -> %p', (input, expected) => {
    expect(normaliseDeclaredMime(input)).toBe(expected);
  });

  it.each([undefined, null, 5, {}])('gives "" for a non-string (%p)', (v) => {
    expect(normaliseDeclaredMime(v)).toBe('');
  });
});

describe('validateUpload', () => {
  const base = {
    originalName: 'doc.pdf',
    declaredMime: 'application/pdf',
    data: pdfBytes(),
    maxSizeBytes: 10 * MB,
    acceptedMimes: ACCEPT_ALL,
  };
  const rejection = (over: Partial<typeof base>) => {
    const result = validateUpload({ ...base, ...over });
    expect(result.ok).toBe(false);
    return result.ok ? null : result.code;
  };

  it('accepts a valid file and returns the DETECTED type and its size', () => {
    const data = pngBytes();
    expect(
      validateUpload({
        ...base,
        originalName: 'scan.png',
        declaredMime: 'application/octet-stream',
        data,
      }),
    ).toEqual({
      ok: true,
      filename: 'scan.png',
      mime: 'image/png',
      size: data.length,
    });
  });

  it('accepts an empty/absent declared type (the bytes decide)', () => {
    expect(validateUpload({ ...base, declaredMime: '' }).ok).toBe(true);
    expect(validateUpload({ ...base, declaredMime: undefined }).ok).toBe(true);
  });

  it('accepts a jpg alias for image/jpeg', () => {
    expect(
      validateUpload({
        ...base,
        originalName: 'p.jpg',
        declaredMime: 'image/jpg',
        data: jpegBytes(),
      }).ok,
    ).toBe(true);
  });

  it('reports each failure with its own code', () => {
    expect(rejection({ originalName: '../x.pdf' })).toBe('INVALID_FILENAME');
    expect(rejection({ data: Buffer.alloc(0) })).toBe('FILE_EMPTY');
    expect(rejection({ maxSizeBytes: 10 })).toBe('FILE_TOO_LARGE');
    expect(rejection({ data: exeBytes() })).toBe('UNSUPPORTED_TYPE');
    expect(rejection({ originalName: 'doc.png' })).toBe('MIME_TYPE_MISMATCH');
    expect(rejection({ declaredMime: 'image/png' })).toBe('MIME_TYPE_MISMATCH');
    expect(rejection({ data: Buffer.from('%PDF-1.4 cut off') })).toBe(
      'CORRUPT_FILE',
    );
  });

  it('accepts a file exactly at the limit and rejects one byte over', () => {
    const data = pdfBytes();
    expect(
      validateUpload({ ...base, data, maxSizeBytes: data.length }).ok,
    ).toBe(true);
    expect(
      validateUpload({ ...base, data, maxSizeBytes: data.length - 1 }).ok,
    ).toBe(false);
  });

  it('checks the filename before the bytes (a hostile name is refused outright)', () => {
    expect(rejection({ originalName: '../x.pdf', data: exeBytes() })).toBe(
      'INVALID_FILENAME',
    );
  });

  it('refuses a type the requirement does not accept, even though the platform does', () => {
    expect(
      rejection({
        acceptedMimes: ['application/pdf'],
        originalName: 'a.png',
        declaredMime: 'image/png',
        data: pngBytes(),
      }),
    ).toBe('UNSUPPORTED_TYPE');
    expect(rejection({ acceptedMimes: [] })).toBe('UNSUPPORTED_TYPE');
  });

  it('an executable is never accepted whatever it is called or declared as', () => {
    for (const [name, mime] of [
      ['a.pdf', 'application/pdf'],
      ['a.png', 'image/png'],
      ['a.jpg', 'image/jpeg'],
      ['a.pdf', 'application/octet-stream'],
    ]) {
      expect(
        rejection({ originalName: name, declaredMime: mime, data: exeBytes() }),
      ).toBe('UNSUPPORTED_TYPE');
    }
  });

  it('does not itself detect malware (that is the scanner boundary’s job)', () => {
    // A structurally valid PDF carrying the EICAR string passes validation...
    expect(validateUpload({ ...base, data: eicarPdf() }).ok).toBe(true);
  });

  it('is pure: it does not modify its input', () => {
    const data = pdfBytes();
    const copy = Buffer.from(data);
    validateUpload({ ...base, data });
    expect(data.equals(copy)).toBe(true);
  });
});

describe('effectiveLimits', () => {
  it('uses the platform ceiling and every supported type with no requirement', () => {
    expect(effectiveLimits(10 * MB, null)).toEqual({
      maxSizeBytes: 10 * MB,
      acceptedMimes: ACCEPT_ALL,
    });
  });

  it('treats a requirement’s null size and empty type list as "platform default"', () => {
    expect(
      effectiveLimits(10 * MB, { maxSizeBytes: null, allowedMimeTypes: [] }),
    ).toEqual({ maxSizeBytes: 10 * MB, acceptedMimes: ACCEPT_ALL });
  });

  it('lets a requirement LOWER the size limit', () => {
    expect(
      effectiveLimits(10 * MB, { maxSizeBytes: 1000, allowedMimeTypes: [] })
        .maxSizeBytes,
    ).toBe(1000);
  });

  it('never lets a requirement RAISE the size limit', () => {
    expect(
      effectiveLimits(10 * MB, { maxSizeBytes: 999 * MB, allowedMimeTypes: [] })
        .maxSizeBytes,
    ).toBe(10 * MB);
  });

  it('lets a requirement NARROW the types, normalising aliases', () => {
    expect(
      effectiveLimits(MB, {
        maxSizeBytes: null,
        allowedMimeTypes: ['application/pdf', 'IMAGE/JPG'],
      }).acceptedMimes,
    ).toEqual(['application/pdf', 'image/jpeg']);
  });

  it('never lets a requirement WIDEN the types beyond what can be verified', () => {
    expect(
      effectiveLimits(MB, {
        maxSizeBytes: null,
        allowedMimeTypes: [
          'application/msword',
          'application/pdf',
          'image/svg+xml',
        ],
      }).acceptedMimes,
    ).toEqual(['application/pdf']);
    expect(
      effectiveLimits(MB, {
        maxSizeBytes: null,
        allowedMimeTypes: ['application/msword'],
      }).acceptedMimes,
    ).toEqual([]);
  });
});

describe('attachmentDisposition', () => {
  it('produces an attachment with an ASCII fallback and a UTF-8 form', () => {
    expect(attachmentDisposition('Site plan.pdf')).toBe(
      `attachment; filename="Site plan.pdf"; filename*=UTF-8''Site%20plan.pdf`,
    );
  });

  it('encodes non-ASCII names', () => {
    const header = attachmentDisposition('आधार.pdf');
    expect(header).toContain(
      `filename*=UTF-8''${encodeURIComponent('आधार.pdf')}`,
    );
    // Each non-ASCII character becomes one underscore in the ASCII fallback.
    expect(header).toContain(`filename="${'_'.repeat(4)}.pdf"`);
  });

  it.each([
    ['a quote', 'a"b.pdf'],
    ['a backslash', 'a\\b.pdf'],
    ['a semicolon', 'a;b.pdf'],
    ['a percent', 'a%b.pdf'],
    ['a CRLF', 'a\r\nSet-Cookie: x=1.pdf'],
  ])('cannot be broken out of by %s', (_l, name) => {
    const header = attachmentDisposition(name);
    expect(header).not.toMatch(/[\r\n]/);
    // exactly one quoted filename, and it contains no quote/backslash/semicolon
    const quoted = header.match(/filename="([^"]*)"/);
    expect(quoted).not.toBeNull();
    expect(quoted![1]).not.toMatch(/["\\;%]/);
    expect(header.startsWith('attachment; ')).toBe(true);
  });

  it('never returns an empty fallback name', () => {
    expect(attachmentDisposition('\u202e\u202e')).toContain('filename="__"');
    expect(attachmentDisposition('')).toContain('filename="document"');
  });
});
