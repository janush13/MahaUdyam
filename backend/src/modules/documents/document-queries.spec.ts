import { DocumentStatus } from '@prisma/client';
import {
  CURRENT_VERSION,
  DOWNLOADABLE_STATUSES,
  USABLE_STATUSES,
  documentIssues,
  isDownloadable,
  isPastExpiry,
  satisfiedRequirementIds,
} from './document-queries';

const ALL_STATUSES = Object.values(DocumentStatus);
const NOW = new Date('2026-09-19T12:00:00.000Z');

describe('document status sets', () => {
  it('lets only scanned, in-flight or verified documents satisfy a requirement', () => {
    expect([...USABLE_STATUSES].sort()).toEqual(
      ['VALIDATION_PENDING', 'VERIFIED'].sort(),
    );
    for (const s of [
      'UPLOADED',
      'SCAN_PENDING',
      'REJECTED',
      'EXPIRED',
    ] as const) {
      expect(USABLE_STATUSES).not.toContain(s);
    }
  });

  it('never serves a rejected or unscanned document', () => {
    expect(DOWNLOADABLE_STATUSES).not.toContain('REJECTED');
    expect(DOWNLOADABLE_STATUSES).not.toContain('SCAN_PENDING');
    expect(DOWNLOADABLE_STATUSES).not.toContain('UPLOADED');
  });

  it('keeps history retrievable: expired documents stay downloadable', () => {
    expect(DOWNLOADABLE_STATUSES).toContain('EXPIRED');
  });
});

describe('isDownloadable', () => {
  const scanned = new Date('2026-09-19T10:00:00.000Z');

  it.each(ALL_STATUSES)('status %s, scanned', (status) => {
    expect(isDownloadable({ status, scannedAt: scanned })).toBe(
      DOWNLOADABLE_STATUSES.includes(status),
    );
  });

  it.each(ALL_STATUSES)(
    'status %s, NOT scanned is never downloadable',
    (status) => {
      expect(isDownloadable({ status, scannedAt: null })).toBe(false);
    },
  );
});

describe('isPastExpiry', () => {
  it('is false with no expiry date', () => {
    expect(isPastExpiry(null, NOW)).toBe(false);
  });

  it('treats the expiry day as expired from its first instant', () => {
    expect(isPastExpiry(new Date('2026-09-19T00:00:00.000Z'), NOW)).toBe(true);
    expect(isPastExpiry(new Date('2026-09-18T00:00:00.000Z'), NOW)).toBe(true);
    expect(isPastExpiry(new Date('2026-09-20T00:00:00.000Z'), NOW)).toBe(false);
  });
});

describe('CURRENT_VERSION', () => {
  it('means "nothing replaces it"', () => {
    expect(CURRENT_VERSION).toEqual({ replacements: { none: {} } });
  });
});

describe('satisfiedRequirementIds', () => {
  const dbReturning = (rows: unknown[]) => ({
    applicationDocument: { findMany: jest.fn().mockResolvedValue(rows) },
  });

  it('does not query when there is nothing to check', async () => {
    const db = dbReturning([]);
    await expect(
      satisfiedRequirementIds(db as never, 'app-1', [], NOW),
    ).resolves.toEqual(new Set());
    expect(db.applicationDocument.findMany).not.toHaveBeenCalled();
  });

  it('asks for current, scanned, usable, unexpired documents of THIS application', async () => {
    const db = dbReturning([]);
    await satisfiedRequirementIds(db as never, 'app-1', ['r1', 'r2'], NOW);
    expect(db.applicationDocument.findMany).toHaveBeenCalledWith({
      where: {
        applicationId: 'app-1',
        document: {
          replacements: { none: {} },
          documentRequirementId: { in: ['r1', 'r2'] },
          status: { in: ['VALIDATION_PENDING', 'VERIFIED'] },
          scannedAt: { not: null },
          OR: [{ expiryDate: null }, { expiryDate: { gt: NOW } }],
        },
      },
      select: { document: { select: { documentRequirementId: true } } },
    });
  });

  it('returns the distinct satisfied requirement ids, ignoring documents with none', async () => {
    const db = dbReturning([
      { document: { documentRequirementId: 'r1' } },
      { document: { documentRequirementId: 'r1' } },
      { document: { documentRequirementId: null } },
      { document: { documentRequirementId: 'r2' } },
    ]);
    await expect(
      satisfiedRequirementIds(db as never, 'app-1', ['r1', 'r2', 'r3'], NOW),
    ).resolves.toEqual(new Set(['r1', 'r2']));
  });
});

describe('documentIssues', () => {
  it('asks for CURRENT documents that are rejected, expired, or past their expiry', async () => {
    const db = {
      applicationDocument: { findMany: jest.fn().mockResolvedValue([]) },
    };
    await documentIssues(db as never, 'app-1', NOW);
    expect(db.applicationDocument.findMany).toHaveBeenCalledWith({
      where: {
        applicationId: 'app-1',
        document: {
          replacements: { none: {} },
          OR: [
            { status: { in: ['REJECTED', 'EXPIRED'] } },
            { expiryDate: { lte: NOW } },
          ],
        },
      },
      select: {
        document: {
          select: { id: true, originalFilename: true, status: true },
        },
      },
    });
  });

  it('labels each issue and orders them deterministically', async () => {
    const db = {
      applicationDocument: {
        findMany: jest.fn().mockResolvedValue([
          {
            document: {
              id: 'b',
              originalFilename: 'b.pdf',
              status: 'REJECTED',
            },
          },
          {
            document: { id: 'a', originalFilename: 'a.pdf', status: 'EXPIRED' },
          },
          {
            document: {
              id: 'c',
              originalFilename: 'c.pdf',
              status: 'VERIFIED',
            },
          },
        ]),
      },
    };
    await expect(documentIssues(db as never, 'app-1', NOW)).resolves.toEqual([
      { documentId: 'a', filename: 'a.pdf', reason: 'EXPIRED' },
      { documentId: 'b', filename: 'b.pdf', reason: 'REJECTED' },
      // matched only by its expiry date, so it reads as expired
      { documentId: 'c', filename: 'c.pdf', reason: 'EXPIRED' },
    ]);
  });
});
