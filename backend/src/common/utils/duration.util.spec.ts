import { parseDurationToMs } from './duration.util';

describe('parseDurationToMs', () => {
  it('parses seconds', () => {
    expect(parseDurationToMs('30s')).toBe(30_000);
  });

  it('parses minutes', () => {
    expect(parseDurationToMs('15m')).toBe(15 * 60_000);
  });

  it('parses hours', () => {
    expect(parseDurationToMs('2h')).toBe(2 * 3_600_000);
  });

  it('parses days', () => {
    expect(parseDurationToMs('7d')).toBe(7 * 86_400_000);
  });

  it('throws on an unrecognised format', () => {
    expect(() => parseDurationToMs('7 days')).toThrow();
  });

  it('throws on an unsupported unit', () => {
    expect(() => parseDurationToMs('7w')).toThrow();
  });
});
