import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

/**
 * Prisma 7 configuration. As of Prisma 7, the datasource connection string
 * no longer lives in schema.prisma — this file is where Migrate and
 * introspection commands read it from. The runtime PrismaClient (used by
 * the application) is configured separately via a driver adapter — see
 * src/infrastructure/prisma/prisma.service.ts — so the same DATABASE_URL
 * env var drives both, and no credential is hard-coded in either place.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: env('DATABASE_URL'),
  },
  migrations: {
    seed: 'ts-node prisma/seed.ts',
  },
});
