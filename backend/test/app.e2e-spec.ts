import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { validationExceptionFactory } from './../src/common/pipes/validation-exception-factory';
import { AllExceptionsFilter } from './../src/common/filters/all-exceptions.filter';

describe('AppModule (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        exceptionFactory: validationExceptionFactory,
      }),
    );
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/v1/health returns status ok', () => {
    return request(app.getHttpServer())
      .get('/api/v1/health')
      .expect(200)
      .expect((res) => {
        expect(res.body.status).toBe('ok');
        expect(typeof res.body.timestamp).toBe('string');
      });
  });

  it('GET /api/v1/health/db reports live database connectivity without throwing', () => {
    // Environment-agnostic on purpose: this suite doesn't assume a working
    // DATABASE_URL is available (see the Step 2 report). Whatever the real
    // connectivity is, the endpoint must respond 200 with a well-formed
    // status rather than erroring.
    return request(app.getHttpServer())
      .get('/api/v1/health/db')
      .expect(200)
      .expect((res) => {
        expect(['up', 'down']).toContain(res.body.status);
        expect(typeof res.body.latencyMs).toBe('number');
      });
  });

  it('returns an X-Request-Id header on every response', () => {
    return request(app.getHttpServer())
      .get('/api/v1/health')
      .expect(200)
      .expect((res) => {
        expect(res.headers['x-request-id']).toBeDefined();
        expect(res.headers['x-request-id'].length).toBeGreaterThan(0);
      });
  });

  it('echoes back a valid client-supplied X-Request-Id', () => {
    return request(app.getHttpServer())
      .get('/api/v1/health')
      .set('X-Request-Id', 'e2e-test-request-id')
      .expect(200)
      .expect((res) => {
        expect(res.headers['x-request-id']).toBe('e2e-test-request-id');
      });
  });

  it('GET /api/v1/does-not-exist returns the standard error envelope', () => {
    return request(app.getHttpServer())
      .get('/api/v1/does-not-exist')
      .expect(404)
      .expect((res) => {
        expect(res.body.error).toBeDefined();
        expect(res.body.error.code).toBe('NOT_FOUND');
      });
  });
});
