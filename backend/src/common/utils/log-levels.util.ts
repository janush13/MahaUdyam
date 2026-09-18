import { LogLevel } from '@nestjs/common';

const LEVEL_ORDER: LogLevel[] = ['error', 'warn', 'log', 'debug', 'verbose'];

/**
 * Expands a single configured minimum level (e.g. "warn") into the array
 * Nest's `logger` bootstrap option expects (["error","warn"]) — each level
 * includes everything less verbose than it. Unrecognised input falls back
 * to "log" (Nest's own conventional default), never to silence.
 */
export function resolveLogLevels(level: string): LogLevel[] {
  const index = LEVEL_ORDER.indexOf(level as LogLevel);
  const cutoff = index === -1 ? LEVEL_ORDER.indexOf('log') : index;
  return LEVEL_ORDER.slice(0, cutoff + 1);
}
