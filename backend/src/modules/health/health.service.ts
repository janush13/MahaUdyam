import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

export interface HealthStatus {
  status: 'ok';
  timestamp: string;
}

export interface DatabaseHealthStatus {
  status: 'up' | 'down';
  latencyMs: number;
  timestamp: string;
}

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Application liveness only — never depends on the database. */
  check(): HealthStatus {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Live database connectivity, checked on every call (not cached from
   * startup) — deliberately a separate concern from application liveness,
   * per the architecture's "distinguish application health from database
   * connectivity" requirement. Never returns connection details, error
   * messages, or credentials to the caller — failures are logged
   * server-side only.
   */
  async checkDatabase(): Promise<DatabaseHealthStatus> {
    const start = Date.now();

    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return {
        status: 'up',
        latencyMs: Date.now() - start,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.warn(
        'Database health check failed.',
        error instanceof Error ? error.stack : undefined,
      );
      return {
        status: 'down',
        latencyMs: Date.now() - start,
        timestamp: new Date().toISOString(),
      };
    }
  }
}
