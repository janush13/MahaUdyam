import { RepresentativeScope } from '@prisma/client';

/** What an operation demands of the caller. `OWNER` (the Applicant Admin,
 * FRD §20) is deliberately above every representative scope: a
 * representative — even with FULL delegation — can never satisfy it, which
 * is how "cannot change the enterprise's own profile or authorise further
 * representatives" (FRD §20.3) is enforced. */
export type EnterpriseAccessLevel = 'OWNER' | RepresentativeScope;

/** FRD §20.3: View Only < Prepare & Submit < Full Delegation. */
const SCOPE_RANK: Record<RepresentativeScope, number> = {
  VIEW_ONLY: 1,
  PREPARE_SUBMIT: 2,
  FULL: 3,
};

export function scopeSatisfies(
  held: RepresentativeScope,
  required: RepresentativeScope,
): boolean {
  return SCOPE_RANK[held] >= SCOPE_RANK[required];
}

export function higherScope(
  a: RepresentativeScope,
  b: RepresentativeScope,
): RepresentativeScope {
  return SCOPE_RANK[a] >= SCOPE_RANK[b] ? a : b;
}

/** An authorisation only grants access while ACTIVE and not past its
 * expiry. Expiry is evaluated at use time (no background job), so it takes
 * effect the instant the timestamp passes. PENDING and REVOKED never grant
 * access (FRD §20.1/§20.2/§20.4). */
export function isAuthorisationLive(
  authorisation: { status: string; expiresAt: Date | null },
  now: Date = new Date(),
): boolean {
  return (
    authorisation.status === 'ACTIVE' &&
    (authorisation.expiresAt === null ||
      authorisation.expiresAt.getTime() > now.getTime())
  );
}

export function isExpired(
  authorisation: { expiresAt: Date | null },
  now: Date = new Date(),
): boolean {
  return (
    authorisation.expiresAt !== null &&
    authorisation.expiresAt.getTime() <= now.getTime()
  );
}

/** True when a change gives the representative MORE reach than they
 * consented to: a higher scope, or a wider set of projects (an empty list
 * means "every project", so going from restricted to empty is a widening).
 * Such a change must be re-accepted by the representative — otherwise the
 * two-sided consent of FRD §20.2 could be bypassed by editing an already-
 * accepted authorisation. Narrowing changes take effect immediately. */
export function isWidening(
  before: { scope: RepresentativeScope; scopedProjectIds: string[] },
  after: { scope: RepresentativeScope; scopedProjectIds: string[] },
): boolean {
  if (SCOPE_RANK[after.scope] > SCOPE_RANK[before.scope]) {
    return true;
  }
  const wasRestricted = before.scopedProjectIds.length > 0;
  const isRestricted = after.scopedProjectIds.length > 0;
  if (wasRestricted && !isRestricted) {
    return true;
  }
  if (wasRestricted && isRestricted) {
    const previous = new Set(before.scopedProjectIds);
    return after.scopedProjectIds.some((id) => !previous.has(id));
  }
  return false;
}
