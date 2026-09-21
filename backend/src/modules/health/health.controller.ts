import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';
import {
  DatabaseHealthStatus,
  HealthService,
  HealthStatus,
} from './health.service';

// Public by design: liveness/readiness probes (Docker healthcheck, load
// balancers) carry no credentials, and the global JwtAuthGuard would
// otherwise reject them. Neither endpoint exposes connection details.
@Public()
@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @ApiOperation({
    summary: 'Check backend availability (application liveness only)',
  })
  @ApiOkResponse({
    description: 'Backend is running. Never depends on the database.',
    schema: {
      example: { status: 'ok', timestamp: '2026-01-01T00:00:00.000Z' },
    },
  })
  check(): HealthStatus {
    return this.healthService.check();
  }

  @Get('db')
  @ApiOperation({ summary: 'Check live database connectivity' })
  @ApiOkResponse({
    description:
      'Reports current database connectivity, checked live on every call. Always returns 200 — check the "status" field rather than the HTTP status code. Never exposes connection details or credentials.',
    schema: {
      example: {
        status: 'up',
        latencyMs: 4,
        timestamp: '2026-01-01T00:00:00.000Z',
      },
    },
  })
  checkDatabase(): Promise<DatabaseHealthStatus> {
    return this.healthService.checkDatabase();
  }
}
