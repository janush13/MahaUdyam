import { validate } from './validation';

const BASE_ENV = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  JWT_ACCESS_SECRET: 'access-secret',
  JWT_REFRESH_SECRET: 'refresh-secret',
  MFA_ENCRYPTION_KEY: 'bWZhLWtleS1mb3ItdGVzdHMtb25seS0zMi1ieXRlcyE=',
};

describe('validate (environment configuration)', () => {
  it('accepts the minimal required set of variables', () => {
    expect(() => validate({ ...BASE_ENV })).not.toThrow();
  });

  it('throws when DATABASE_URL is missing', () => {
    expect(() =>
      validate({
        JWT_ACCESS_SECRET: BASE_ENV.JWT_ACCESS_SECRET,
        JWT_REFRESH_SECRET: BASE_ENV.JWT_REFRESH_SECRET,
        MFA_ENCRYPTION_KEY: BASE_ENV.MFA_ENCRYPTION_KEY,
      }),
    ).toThrow();
  });

  it('throws when JWT_ACCESS_SECRET is missing', () => {
    expect(() =>
      validate({
        DATABASE_URL: BASE_ENV.DATABASE_URL,
        JWT_REFRESH_SECRET: BASE_ENV.JWT_REFRESH_SECRET,
        MFA_ENCRYPTION_KEY: BASE_ENV.MFA_ENCRYPTION_KEY,
      }),
    ).toThrow();
  });

  it('throws when MFA_ENCRYPTION_KEY is missing', () => {
    expect(() =>
      validate({
        DATABASE_URL: BASE_ENV.DATABASE_URL,
        JWT_ACCESS_SECRET: BASE_ENV.JWT_ACCESS_SECRET,
        JWT_REFRESH_SECRET: BASE_ENV.JWT_REFRESH_SECRET,
      }),
    ).toThrow();
  });

  it('rejects an unrecognised NODE_ENV value', () => {
    expect(() =>
      validate({ ...BASE_ENV, NODE_ENV: 'not-a-real-env' }),
    ).toThrow();
  });

  describe('conditional storage validation', () => {
    it('does not require S3 settings when STORAGE_DRIVER is local (default)', () => {
      expect(() =>
        validate({ ...BASE_ENV, STORAGE_DRIVER: 'local' }),
      ).not.toThrow();
    });

    it('does not require S3 settings when STORAGE_DRIVER is unset', () => {
      expect(() => validate({ ...BASE_ENV })).not.toThrow();
    });

    it('throws when STORAGE_DRIVER=s3 but S3 settings are missing', () => {
      expect(() => validate({ ...BASE_ENV, STORAGE_DRIVER: 's3' })).toThrow();
    });

    it('accepts STORAGE_DRIVER=s3 when all S3 settings are present', () => {
      expect(() =>
        validate({
          ...BASE_ENV,
          STORAGE_DRIVER: 's3',
          S3_ENDPOINT: 'https://s3.example.com',
          S3_REGION: 'us-east-1',
          S3_BUCKET: 'bucket',
          S3_ACCESS_KEY: 'key',
          S3_SECRET_KEY: 'secret',
        }),
      ).not.toThrow();
    });
  });

  describe('document settings', () => {
    it('accepts the defaults (both unset)', () => {
      expect(() => validate(BASE_ENV)).not.toThrow();
    });

    it('accepts a valid size and the mock scanner', () => {
      expect(() =>
        validate({
          ...BASE_ENV,
          DOCUMENT_MAX_SIZE_BYTES: '1048576',
          DOCUMENT_SCANNER: 'mock',
        }),
      ).not.toThrow();
    });

    it.each(['0', '-1', 'abc', '52428801', '1.5'])(
      'rejects DOCUMENT_MAX_SIZE_BYTES=%s',
      (value) => {
        expect(() =>
          validate({ ...BASE_ENV, DOCUMENT_MAX_SIZE_BYTES: value }),
        ).toThrow();
      },
    );

    it('rejects a scanner that does not exist (no silent fallback to "clean")', () => {
      for (const value of ['clamav', 'none', 'off', '']) {
        expect(() =>
          validate({ ...BASE_ENV, DOCUMENT_SCANNER: value }),
        ).toThrow();
      }
    });
  });

  describe('conditional AI validation', () => {
    it('does not require an AI key when AI_PROVIDER is unset', () => {
      expect(() => validate({ ...BASE_ENV })).not.toThrow();
    });

    it('does not require an AI key when AI_PROVIDER=none', () => {
      expect(() =>
        validate({ ...BASE_ENV, AI_PROVIDER: 'none' }),
      ).not.toThrow();
    });

    it('throws when AI_PROVIDER=anthropic but AI_API_KEY is missing', () => {
      expect(() =>
        validate({ ...BASE_ENV, AI_PROVIDER: 'anthropic' }),
      ).toThrow();
    });

    it('accepts AI_PROVIDER=anthropic when AI_API_KEY and AI_MODEL are present', () => {
      expect(() =>
        validate({
          ...BASE_ENV,
          AI_PROVIDER: 'anthropic',
          AI_API_KEY: 'sk-test',
          AI_MODEL: 'claude-test',
        }),
      ).not.toThrow();
    });
  });
});
