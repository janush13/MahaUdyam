import cookieParser from 'cookie-parser';
import { json, urlencoded } from 'express';
import helmet from 'helmet';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { validationExceptionFactory } from './common/pipes/validation-exception-factory';
import { AppConfig } from './config/configuration';

/**
 * Everything about the HTTP layer that must be identical in production
 * (main.ts) and in e2e tests: prefix, security headers, body parsing,
 * cookies, CORS, validation, and the error envelope. Kept in one place so
 * tests exercise the real configuration rather than a hand-copied
 * approximation that could silently drift.
 */
export function configureApp(app: NestExpressApplication): void {
  const configService = app.get(ConfigService<AppConfig, true>);
  const apiPrefix = configService.get('apiPrefix', { infer: true });
  const frontendUrl = configService.get('frontendUrl', { infer: true });
  const bodyLimit = configService.get('bodyLimit', { infer: true });

  app.setGlobalPrefix(apiPrefix);

  // Security foundation.
  app.use(helmet());
  app.use(json({ limit: bodyLimit }));
  app.use(urlencoded({ extended: true, limit: bodyLimit }));
  // Required for the refresh-token httpOnly cookie (req.cookies) — see
  // src/modules/auth/cookie.util.ts.
  app.use(cookieParser());

  app.enableCors({
    origin: frontendUrl,
    // Credentialed requests need an explicit (non-wildcard) origin, which
    // FRONTEND_URL already provides.
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: validationExceptionFactory,
    }),
  );

  app.useGlobalFilters(new AllExceptionsFilter());
}

export function setupSwagger(app: INestApplication): void {
  const swaggerConfig = new DocumentBuilder()
    .setTitle('MahaUdyam One API')
    .setDescription(
      'Backend API for MahaUdyam One — Unified Industrial Approvals, Compliance & ' +
        'Government Support Platform. Implements shared infrastructure (configuration, ' +
        'database, storage, health, error handling) plus authentication/MFA/RBAC. No ' +
        'business endpoints (enterprises, projects, approvals, documents, ...) exist yet. ' +
        'This document is the contract the future frontend will integrate against as ' +
        'those endpoints are added.',
    )
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document);
}
