import { LogLevel } from '@nestjs/common';

export interface AppSettings {
  env: string;
  port: number;
  apiPrefix: string;
  frontendUrl: string;
  /** express body-parser limit for JSON/urlencoded payloads. */
  bodyLimit: string;
  swaggerEnabled: boolean;
  logLevel: LogLevel;
}

/**
 * Application-level settings: environment, port, API prefix, frontend
 * origin, body-size limit, Swagger toggle, log verbosity. Every default
 * here reproduces the exact hard-coded behaviour Step 1/2 already had —
 * this file makes those values configurable, it does not change them.
 */
export const buildAppConfig = (): AppSettings => {
  const env = process.env.NODE_ENV ?? 'development';

  return {
    env,
    port: parseInt(process.env.PORT ?? '3000', 10),
    apiPrefix: process.env.API_PREFIX ?? 'api/v1',
    frontendUrl: process.env.FRONTEND_URL ?? 'http://localhost:5173',
    // Matches the architecture's document-upload NFR (~10MB/document,
    // Blueprint §30). Do not raise this without an explicit requirement —
    // see README.md.
    bodyLimit: process.env.BODY_LIMIT ?? '10mb',
    // Defaults to disabled only in production; unset/anything else keeps
    // Step 1/2's existing behaviour (enabled outside production).
    swaggerEnabled: process.env.SWAGGER_ENABLED
      ? process.env.SWAGGER_ENABLED !== 'false'
      : env !== 'production',
    // Defaults to 'verbose' (log everything) to exactly match Nest's
    // behaviour when no `logger` option is passed at all, which is what
    // Step 1/2 did — this only becomes a *behaviour* change once LOG_LEVEL
    // is deliberately set.
    logLevel: (process.env.LOG_LEVEL as LogLevel) ?? 'verbose',
  };
};
