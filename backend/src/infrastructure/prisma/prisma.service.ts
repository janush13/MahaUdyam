import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { AppConfig } from '../../config/configuration';

/**
 * Prisma Client foundation. Infrastructure only — no business repositories
 * live here; future modules inject PrismaService and use it directly (or
 * wrap it in their own repository classes), the same way they would use
 * `PrismaClient` in any other NestJS app.
 *
 * Prisma 7 requires a driver adapter at runtime (the schema's `datasource`
 * block no longer carries a connection `url` — see prisma/schema.prisma and
 * prisma.config.ts), so this service builds a `PrismaPg` adapter from
 * DATABASE_URL instead of relying on Prisma's older implicit connection
 * behavior.
 *
 * Transactions: Prisma's own `$transaction()` (inherited from PrismaClient)
 * is already available on any injected PrismaService instance — future
 * application services should call `this.prisma.$transaction(...)`
 * directly. No custom transaction wrapper is introduced here; one was not
 * genuinely necessary.
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor(configService: ConfigService<AppConfig, true>) {
    const connectionString = configService.get('database.url', { infer: true });
    super({
      adapter: new PrismaPg({ connectionString }),
      // Prisma's defaults (2s to obtain a connection, 5s to finish) turn any
      // burst of concurrent requests into a spurious 500 ("Unable to start a
      // transaction in the given time") when the database is momentarily
      // slow — seen when several suites start together against the Docker
      // Postgres. Generous limits absorb that without masking real hangs.
      transactionOptions: { maxWait: 10_000, timeout: 20_000 },
    });
  }

  /**
   * Connects eagerly at startup where possible, but deliberately does not
   * throw if the database is unreachable — the rest of the application
   * (including GET /api/v1/health) must still start and serve traffic.
   * Database-dependent operations simply fail individually until
   * connectivity is restored; use the /api/v1/health/db endpoint to observe
   * live connectivity rather than inferring it from application uptime.
   */
  async onModuleInit(): Promise<void> {
    try {
      await this.$connect();
      // $connect() resolves even with invalid credentials when using the
      // PrismaPg driver adapter — it initializes the pool but does not
      // itself perform authentication. Only a real query proves the
      // database is actually reachable, which is why this (not the
      // $connect() call above) gates the success log below — logging
      // "established" straight after $connect() would be misleading.
      await this.$queryRaw`SELECT 1`;
      this.logger.log('Database connection established.');
    } catch (error) {
      this.logger.warn(
        'Could not establish a verified database connection — the application will continue to start. Database-dependent features will be unavailable until connectivity is restored.',
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
