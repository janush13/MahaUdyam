const UNIT_MS: Record<string, number> = {
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

/**
 * Parses the simple duration strings used throughout this codebase's
 * configuration (e.g. "15m", "7d") into milliseconds. Deliberately
 * minimal — only the four units actually used — to avoid adding a
 * dependency (e.g. `ms`) for something this small.
 */
export function parseDurationToMs(value: string): number {
  const match = /^(\d+)(s|m|h|d)$/.exec(value.trim());

  if (!match) {
    throw new Error(
      `Invalid duration string: "${value}" (expected formats like "15m", "7d").`,
    );
  }

  const [, amount, unit] = match;
  return Number(amount) * UNIT_MS[unit];
}
