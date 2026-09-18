import { AiSettings, buildAiConfig } from './ai.config';
import { AppSettings, buildAppConfig } from './app.config';
import { AuthSettings, buildAuthConfig } from './auth.config';
import { buildDatabaseConfig, DatabaseSettings } from './database.config';
import { buildStorageConfig, StorageSettings } from './storage.config';

/**
 * Composes the per-concern config builders (app/database/auth/storage/ai)
 * into the single typed object the rest of the app reads via
 * `ConfigService<AppConfig, true>`. Deliberately keeps the same shape Step
 * 1/2 already used (`database.url`, `jwt.*`, `storage.driver`,
 * `storage.localPath`, plus the top-level app fields) so existing
 * consumers (PrismaService, main.ts) did not need to change how they read
 * config — only new fields were added (`storage.s3`, `ai`, `bodyLimit`,
 * `swaggerEnabled`, `logLevel`).
 */
export interface AuthSecuritySettings {
  mfaEncryptionKey: string;
  refreshCookieName: string;
  maxFailedLoginAttempts: number;
  lockoutDurationMinutes: number;
}

export interface AppConfig extends AppSettings {
  database: DatabaseSettings;
  jwt: AuthSettings['jwt'];
  authSecurity: AuthSecuritySettings;
  storage: StorageSettings;
  ai: AiSettings;
}

export default (): AppConfig => {
  const app = buildAppConfig();
  const database = buildDatabaseConfig();
  const auth = buildAuthConfig();
  const storage = buildStorageConfig();
  const ai = buildAiConfig();

  return {
    ...app,
    database,
    jwt: auth.jwt,
    authSecurity: {
      mfaEncryptionKey: auth.mfaEncryptionKey,
      refreshCookieName: auth.refreshCookieName,
      maxFailedLoginAttempts: auth.maxFailedLoginAttempts,
      lockoutDurationMinutes: auth.lockoutDurationMinutes,
    },
    storage,
    ai,
  };
};
