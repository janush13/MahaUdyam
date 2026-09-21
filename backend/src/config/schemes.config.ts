/** The roles a deployment may name as the scheme PUBLISHER. FRD 34 names two
 * candidates, "Department Admin or a separate Legal/Compliance role" (register
 * item 10, TO BE VALIDATED); the TRD 2 stakeholder table lists the Scheme Officer
 * as able to "publish schemes". Nothing else is offered: publishing is never a System
 * Administrator's (FRD 35.2). */
export const SCHEME_PUBLISHER_ROLE_CHOICES = [
  'SCHEME_OFFICER',
  'DEPT_ADMIN',
  'LEGAL_COMPLIANCE',
] as const;

export type SchemePublisherRole =
  (typeof SCHEME_PUBLISHER_ROLE_CHOICES)[number];

export interface SchemeSettings {
  /** Who may publish a drafted scheme (make it visible to applicants). The
   * requirements leave this open, so it is configuration, not code. Default:
   * the Department Administrator of the scheme's department, which keeps the
   * publish step separate from the Scheme Officer who drafts it (FRD 34
   * "subject to a publish/approval step"). */
  publisherRoles: SchemePublisherRole[];
}

export const DEFAULT_SCHEME_PUBLISHER_ROLES: SchemePublisherRole[] = [
  'DEPT_ADMIN',
];

function parsePublisherRoles(raw: string | undefined): SchemePublisherRole[] {
  if (raw === undefined || raw.trim() === '') {
    return [...DEFAULT_SCHEME_PUBLISHER_ROLES];
  }
  const wanted = [
    ...new Set(raw.split(',').map((r) => r.trim().toUpperCase())),
  ].filter((r) => r !== '');
  const bad = wanted.filter(
    (r) => !(SCHEME_PUBLISHER_ROLE_CHOICES as readonly string[]).includes(r),
  );
  if (bad.length > 0 || wanted.length === 0) {
    throw new Error(
      `SCHEME_PUBLISHER_ROLES accepts ${SCHEME_PUBLISHER_ROLE_CHOICES.join(', ')} only; got: ${bad.join(', ') || '(nothing)'}`,
    );
  }
  return wanted as SchemePublisherRole[];
}

export const buildSchemeConfig = (): SchemeSettings => ({
  publisherRoles: parsePublisherRoles(process.env.SCHEME_PUBLISHER_ROLES),
});
