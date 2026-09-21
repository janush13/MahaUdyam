import buildConfiguration from './configuration';

describe('configuration', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('applies sensible defaults when only the minimum is set', () => {
    process.env = {
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
      JWT_ACCESS_SECRET: 'a',
      JWT_REFRESH_SECRET: 'b',
    } as NodeJS.ProcessEnv;

    const config = buildConfiguration();

    expect(config.env).toBe('development');
    expect(config.port).toBe(3000);
    expect(config.apiPrefix).toBe('api/v1');
    expect(config.frontendUrl).toBe('http://localhost:5173');
    expect(config.bodyLimit).toBe('10mb');
    expect(config.swaggerEnabled).toBe(true);
    expect(config.logLevel).toBe('verbose');
    expect(config.database.url).toBe(
      'postgresql://user:pass@localhost:5432/db',
    );
    expect(config.jwt.accessExpiresIn).toBe('15m');
    expect(config.jwt.refreshExpiresIn).toBe('7d');
    expect(config.storage.driver).toBe('local');
    expect(config.storage.localPath).toBe('./storage');
    expect(config.storage.s3).toBeUndefined();
    expect(config.documents).toEqual({
      maxSizeBytes: 10 * 1024 * 1024,
      scanner: 'mock',
    });
    expect(config.ai.provider).toBe('none');
  });

  it('reads the document settings from the environment', () => {
    process.env = {
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
      JWT_ACCESS_SECRET: 'a',
      JWT_REFRESH_SECRET: 'b',
      DOCUMENT_MAX_SIZE_BYTES: '2048',
      DOCUMENT_SCANNER: 'mock',
    } as NodeJS.ProcessEnv;
    expect(buildConfiguration().documents).toEqual({
      maxSizeBytes: 2048,
      scanner: 'mock',
    });
  });

  it('disables Swagger by default in production', () => {
    process.env = {
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
      JWT_ACCESS_SECRET: 'a',
      JWT_REFRESH_SECRET: 'b',
    } as NodeJS.ProcessEnv;

    expect(buildConfiguration().swaggerEnabled).toBe(false);
  });

  it('honours an explicit SWAGGER_ENABLED override', () => {
    process.env = {
      NODE_ENV: 'production',
      SWAGGER_ENABLED: 'true',
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
      JWT_ACCESS_SECRET: 'a',
      JWT_REFRESH_SECRET: 'b',
    } as NodeJS.ProcessEnv;

    expect(buildConfiguration().swaggerEnabled).toBe(true);
  });

  it('populates S3 settings only when STORAGE_DRIVER=s3', () => {
    process.env = {
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
      JWT_ACCESS_SECRET: 'a',
      JWT_REFRESH_SECRET: 'b',
      STORAGE_DRIVER: 's3',
      S3_ENDPOINT: 'https://s3.example.com',
      S3_REGION: 'us-east-1',
      S3_BUCKET: 'bucket',
      S3_ACCESS_KEY: 'key',
      S3_SECRET_KEY: 'secret',
    } as NodeJS.ProcessEnv;

    const config = buildConfiguration();

    expect(config.storage.driver).toBe('s3');
    expect(config.storage.s3).toEqual({
      endpoint: 'https://s3.example.com',
      region: 'us-east-1',
      bucket: 'bucket',
      accessKey: 'key',
      secretKey: 'secret',
    });
  });

  it('never requires AI settings when AI_PROVIDER is unset', () => {
    process.env = {
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
      JWT_ACCESS_SECRET: 'a',
      JWT_REFRESH_SECRET: 'b',
    } as NodeJS.ProcessEnv;

    const config = buildConfiguration();

    expect(config.ai.provider).toBe('none');
    expect(config.ai.apiKey).toBeUndefined();
  });
});
