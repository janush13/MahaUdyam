import { randomUUID } from 'node:crypto';
import { EICAR_TEST_SIGNATURE } from '../../src/modules/documents/dev-mock-malware-scanner';

/**
 * Minimal but structurally valid files, each made unique (`tag`) so checksums
 * differ between uploads. They satisfy the platform's content sniffing and
 * structure checks and nothing more - they are not real renderable documents.
 */
const unique = (tag?: string) => tag ?? randomUUID();

export function pdfBytes(tag?: string): Buffer {
  return Buffer.from(
    `%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Note (${unique(tag)}) >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n`,
    'latin1',
  );
}

export function pngBytes(tag?: string): Buffer {
  const signature = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  const ihdr = Buffer.concat([
    Buffer.from([0x00, 0x00, 0x00, 0x0d]),
    Buffer.from('IHDR', 'latin1'),
    Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]),
    Buffer.from([0x90, 0x77, 0x53, 0xde]),
  ]);
  const text = Buffer.from(`tEXt${unique(tag)}`, 'latin1');
  const textChunk = Buffer.concat([
    (() => {
      const length = Buffer.alloc(4);
      length.writeUInt32BE(text.length - 4);
      return length;
    })(),
    text,
    Buffer.from([0, 0, 0, 0]),
  ]);
  const iend = Buffer.from([
    0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
  ]);
  return Buffer.concat([signature, ihdr, textChunk, iend]);
}

export function jpegBytes(tag?: string): Buffer {
  return Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
    Buffer.from('JFIF\0', 'latin1'),
    Buffer.from(unique(tag), 'latin1'),
    Buffer.from([0xff, 0xd9]),
  ]);
}

/** A structurally valid PDF carrying the public EICAR antivirus test string. */
export function eicarPdf(): Buffer {
  return Buffer.from(
    `%PDF-1.4\n1 0 obj\n<< /Note (${EICAR_TEST_SIGNATURE}) >>\nendobj\ntrailer\n<< >>\n%%EOF\n`,
    'latin1',
  );
}

/** What a Windows executable starts with. */
export function exeBytes(): Buffer {
  return Buffer.concat([Buffer.from('MZ', 'latin1'), Buffer.alloc(200, 0x90)]);
}
