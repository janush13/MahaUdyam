import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp, setupSwagger } from './app.setup';
import { resolveLogLevels } from './common/utils/log-levels.util';
import { buildAppConfig } from './config/app.config';
import { AppConfig } from './config/configuration';

async function bootstrap(): Promise<void> {
  // Read directly here (not via ConfigService) only because Nest's `logger`
  // bootstrap option must be known before the DI container — and therefore
  // ConfigService — exists. Everything else below uses ConfigService, as it
  // should for anything not needed pre-DI.
  const { logLevel } = buildAppConfig();

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    logger: resolveLogLevels(logLevel),
  });

  const configService = app.get(ConfigService<AppConfig, true>);
  const apiPrefix = configService.get('apiPrefix', { infer: true });
  const port = configService.get('port', { infer: true });
  const swaggerEnabled = configService.get('swaggerEnabled', { infer: true });

  configureApp(app);

  app.enableShutdownHooks();

  if (swaggerEnabled) {
    setupSwagger(app);
  }

  await app.listen(port);

  const logger = new Logger('Bootstrap');
  logger.log(
    `MahaUdyam One backend listening on http://localhost:${port}/${apiPrefix}`,
  );
  if (swaggerEnabled) {
    logger.log(
      `Swagger documentation available at http://localhost:${port}/api/docs`,
    );
  }
}

bootstrap();
