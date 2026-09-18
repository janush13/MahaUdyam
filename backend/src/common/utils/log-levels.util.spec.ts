import { resolveLogLevels } from './log-levels.util';

describe('resolveLogLevels', () => {
  it('includes only error for "error"', () => {
    expect(resolveLogLevels('error')).toEqual(['error']);
  });

  it('includes error+warn for "warn"', () => {
    expect(resolveLogLevels('warn')).toEqual(['error', 'warn']);
  });

  it('includes error+warn+log for "log"', () => {
    expect(resolveLogLevels('log')).toEqual(['error', 'warn', 'log']);
  });

  it('includes everything up to debug for "debug"', () => {
    expect(resolveLogLevels('debug')).toEqual([
      'error',
      'warn',
      'log',
      'debug',
    ]);
  });

  it('includes every level for "verbose"', () => {
    expect(resolveLogLevels('verbose')).toEqual([
      'error',
      'warn',
      'log',
      'debug',
      'verbose',
    ]);
  });

  it('falls back to "log" for an unrecognised value', () => {
    expect(resolveLogLevels('not-a-level')).toEqual(['error', 'warn', 'log']);
  });
});
