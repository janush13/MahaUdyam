import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { RequestIdMiddleware } from './middleware/request-id.middleware';

/**
 * Home for cross-cutting request infrastructure applied to every route.
 * Currently just request-ID correlation; future cross-cutting concerns
 * (e.g. request logging) belong here too, once they're actually needed.
 */
@Module({})
export class CommonModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
