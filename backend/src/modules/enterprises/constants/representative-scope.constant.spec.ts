import {
  higherScope,
  isAuthorisationLive,
  isExpired,
  isWidening,
  scopeSatisfies,
} from './representative-scope.constant';

const PAST = new Date(Date.now() - 60_000);
const FUTURE = new Date(Date.now() + 3_600_000);
const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';

describe('scopeSatisfies', () => {
  it.each([
    ['VIEW_ONLY', 'VIEW_ONLY', true],
    ['VIEW_ONLY', 'PREPARE_SUBMIT', false],
    ['VIEW_ONLY', 'FULL', false],
    ['PREPARE_SUBMIT', 'VIEW_ONLY', true],
    ['PREPARE_SUBMIT', 'PREPARE_SUBMIT', true],
    ['PREPARE_SUBMIT', 'FULL', false],
    ['FULL', 'VIEW_ONLY', true],
    ['FULL', 'PREPARE_SUBMIT', true],
    ['FULL', 'FULL', true],
  ] as const)('held %s vs required %s -> %s', (held, required, expected) => {
    expect(scopeSatisfies(held, required)).toBe(expected);
  });
});

describe('higherScope', () => {
  it('returns the more powerful scope regardless of argument order', () => {
    expect(higherScope('VIEW_ONLY', 'FULL')).toBe('FULL');
    expect(higherScope('FULL', 'VIEW_ONLY')).toBe('FULL');
    expect(higherScope('PREPARE_SUBMIT', 'VIEW_ONLY')).toBe('PREPARE_SUBMIT');
  });
});

describe('isAuthorisationLive', () => {
  it('is live only when ACTIVE and not expired', () => {
    expect(isAuthorisationLive({ status: 'ACTIVE', expiresAt: null })).toBe(
      true,
    );
    expect(isAuthorisationLive({ status: 'ACTIVE', expiresAt: FUTURE })).toBe(
      true,
    );
  });

  it('is never live while PENDING (two-sided consent not yet given)', () => {
    expect(isAuthorisationLive({ status: 'PENDING', expiresAt: null })).toBe(
      false,
    );
  });

  it('is never live once REVOKED', () => {
    expect(isAuthorisationLive({ status: 'REVOKED', expiresAt: null })).toBe(
      false,
    );
    expect(isAuthorisationLive({ status: 'REVOKED', expiresAt: FUTURE })).toBe(
      false,
    );
  });

  it('stops being live the moment expiry passes, without any status change', () => {
    expect(isAuthorisationLive({ status: 'ACTIVE', expiresAt: PAST })).toBe(
      false,
    );
  });

  it('treats an expiry exactly equal to "now" as expired', () => {
    const now = new Date();
    expect(isAuthorisationLive({ status: 'ACTIVE', expiresAt: now }, now)).toBe(
      false,
    );
  });
});

describe('isExpired', () => {
  it('is false with no expiry or a future expiry, true once past', () => {
    expect(isExpired({ expiresAt: null })).toBe(false);
    expect(isExpired({ expiresAt: FUTURE })).toBe(false);
    expect(isExpired({ expiresAt: PAST })).toBe(true);
  });
});

describe('isWidening (changes that require the representative to accept again)', () => {
  const base = {
    scope: 'PREPARE_SUBMIT',
    scopedProjectIds: [] as string[],
  } as const;

  it('scope increases are widening', () => {
    expect(
      isWidening(
        { ...base, scope: 'VIEW_ONLY' },
        { ...base, scope: 'PREPARE_SUBMIT' },
      ),
    ).toBe(true);
    expect(
      isWidening(
        { ...base, scope: 'PREPARE_SUBMIT' },
        { ...base, scope: 'FULL' },
      ),
    ).toBe(true);
    expect(
      isWidening({ ...base, scope: 'VIEW_ONLY' }, { ...base, scope: 'FULL' }),
    ).toBe(true);
  });

  it('scope decreases and no-ops are not widening', () => {
    expect(
      isWidening({ ...base, scope: 'FULL' }, { ...base, scope: 'VIEW_ONLY' }),
    ).toBe(false);
    expect(isWidening(base, base)).toBe(false);
  });

  it('going from a project restriction to "every project" is widening', () => {
    expect(
      isWidening(
        { ...base, scopedProjectIds: [P1] },
        { ...base, scopedProjectIds: [] },
      ),
    ).toBe(true);
  });

  it('adding a project to a restriction is widening; removing one is not', () => {
    expect(
      isWidening(
        { ...base, scopedProjectIds: [P1] },
        { ...base, scopedProjectIds: [P1, P2] },
      ),
    ).toBe(true);
    expect(
      isWidening(
        { ...base, scopedProjectIds: [P1, P2] },
        { ...base, scopedProjectIds: [P1] },
      ),
    ).toBe(false);
  });

  it('swapping to a different project is widening (new reach they never accepted)', () => {
    expect(
      isWidening(
        { ...base, scopedProjectIds: [P1] },
        { ...base, scopedProjectIds: [P2] },
      ),
    ).toBe(true);
  });

  it('narrowing from "every project" to a restriction is not widening', () => {
    expect(
      isWidening(
        { ...base, scopedProjectIds: [] },
        { ...base, scopedProjectIds: [P1] },
      ),
    ).toBe(false);
  });
});
