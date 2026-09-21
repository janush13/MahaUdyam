import { DocumentStatus, Prisma } from '@prisma/client';

/**
 * Shared, read-only definitions of "which document counts", used by the
 * document module AND by the application module's pre-submission validation,
 * so the two can never disagree.
 *
 *  - CURRENT version: the head of a replacement chain — no other document
 *    names it as `replaced_document_id`. Older versions are kept forever but
 *    never satisfy a requirement.
 *  - USABLE: scanned clean (scanned_at set), in a status that has not been
 *    rejected or expired, and not past its expiry date.
 */
type Db = Pick<Prisma.TransactionClient, 'applicationDocument'>;

/** Statuses in which a (current, scanned) document satisfies a requirement.
 * REJECTED / EXPIRED need a replacement; UPLOADED / SCAN_PENDING have not been
 * scanned yet. Verification (VERIFIED) is an officer step of a later stage. */
export const USABLE_STATUSES: DocumentStatus[] = [
  'VALIDATION_PENDING',
  'VERIFIED',
];

/** Statuses in which the normal download endpoint may serve the bytes.
 * Superseded versions keep their status, so history stays retrievable;
 * REJECTED (an officer's or the scanner's refusal) never is. */
export const DOWNLOADABLE_STATUSES: DocumentStatus[] = [
  'VALIDATION_PENDING',
  'VERIFIED',
  'EXPIRED',
];

export function isDownloadable(document: {
  status: DocumentStatus;
  scannedAt: Date | null;
}): boolean {
  return (
    document.scannedAt !== null &&
    DOWNLOADABLE_STATUSES.includes(document.status)
  );
}

/** True when the expiry date (a calendar date, stored at UTC midnight) has
 * arrived — the document is treated as expired from that day. */
export function isPastExpiry(
  expiryDate: Date | null,
  now: Date = new Date(),
): boolean {
  return expiryDate !== null && expiryDate.getTime() <= now.getTime();
}

export const CURRENT_VERSION = { replacements: { none: {} } } as const;

/** Requirement ids, among `requirementIds`, that this application currently
 * satisfies with a usable document. */
export async function satisfiedRequirementIds(
  db: Db,
  applicationId: string,
  requirementIds: string[],
  now: Date = new Date(),
): Promise<Set<string>> {
  if (requirementIds.length === 0) {
    return new Set();
  }
  const links = await db.applicationDocument.findMany({
    where: {
      applicationId,
      document: {
        ...CURRENT_VERSION,
        documentRequirementId: { in: requirementIds },
        status: { in: USABLE_STATUSES },
        scannedAt: { not: null },
        OR: [{ expiryDate: null }, { expiryDate: { gt: now } }],
      },
    },
    select: { document: { select: { documentRequirementId: true } } },
  });
  const satisfied = new Set<string>();
  for (const link of links) {
    if (link.document.documentRequirementId) {
      satisfied.add(link.document.documentRequirementId);
    }
  }
  return satisfied;
}

export interface DocumentIssue {
  documentId: string;
  filename: string;
  reason: 'EXPIRED' | 'REJECTED';
}

/** Current documents that need replacing before the application can be
 * submitted (FRD 16.1 "expired document" error; Blueprint 22 "Replacement
 * Required"). */
export async function documentIssues(
  db: Db,
  applicationId: string,
  now: Date = new Date(),
): Promise<DocumentIssue[]> {
  const links = await db.applicationDocument.findMany({
    where: {
      applicationId,
      document: {
        ...CURRENT_VERSION,
        OR: [
          { status: { in: ['REJECTED', 'EXPIRED'] } },
          { expiryDate: { lte: now } },
        ],
      },
    },
    select: {
      document: {
        select: { id: true, originalFilename: true, status: true },
      },
    },
  });
  return links
    .map(({ document }): DocumentIssue => ({
      documentId: document.id,
      filename: document.originalFilename,
      reason: document.status === 'REJECTED' ? 'REJECTED' : 'EXPIRED',
    }))
    .sort((a, b) => (a.documentId < b.documentId ? -1 : 1));
}
