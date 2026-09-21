import { Prisma } from '@prisma/client';
import {
  CURRENT_VERSION,
  USABLE_STATUSES,
} from '../documents/document-queries';

type Db = Pick<Prisma.TransactionClient, 'schemeApplicationDocument'>;

/**
 * The scheme's document requirements that this application currently satisfies:
 * the same definition of "which document counts" as approval applications (the
 * shared `USABLE_STATUSES` / `CURRENT_VERSION`), so the two can never disagree -
 * the CURRENT version of a chain, scanned clean, not rejected or expired, not
 * past its expiry date. Older versions are kept forever but never satisfy one.
 */
export async function satisfiedSchemeRequirementIds(
  db: Db,
  schemeApplicationId: string,
  requirementIds: string[],
  now: Date = new Date(),
): Promise<Set<string>> {
  if (requirementIds.length === 0) {
    return new Set();
  }
  const links = await db.schemeApplicationDocument.findMany({
    where: {
      schemeApplicationId,
      schemeDocumentRequirementId: { in: requirementIds },
      document: {
        ...CURRENT_VERSION,
        status: { in: USABLE_STATUSES },
        scannedAt: { not: null },
        OR: [{ expiryDate: null }, { expiryDate: { gt: now } }],
      },
    },
    select: { schemeDocumentRequirementId: true },
  });
  return new Set(
    links
      .map((l) => l.schemeDocumentRequirementId)
      .filter((id): id is string => id !== null),
  );
}
