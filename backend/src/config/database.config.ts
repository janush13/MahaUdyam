export interface DatabaseSettings {
  url: string;
}

/**
 * Database connection settings. Prisma remains the only database
 * client/ORM — this holds nothing but the connection string, read once
 * here rather than via scattered `process.env.DATABASE_URL` reads
 * throughout the codebase.
 */
export const buildDatabaseConfig = (): DatabaseSettings => ({
  url: process.env.DATABASE_URL ?? '',
});
