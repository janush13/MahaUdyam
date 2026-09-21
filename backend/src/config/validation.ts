import { plainToInstance } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateIf,
  validateSync,
} from 'class-validator';

enum Environment {
  Development = 'development',
  Test = 'test',
  Staging = 'staging',
  Production = 'production',
}

enum StorageDriverEnum {
  Local = 'local',
  S3 = 's3',
}

enum DocumentScannerEnum {
  Mock = 'mock',
}

enum AiProviderEnum {
  None = 'none',
  Anthropic = 'anthropic',
}

enum LogLevelEnum {
  Error = 'error',
  Warn = 'warn',
  Log = 'log',
  Debug = 'debug',
  Verbose = 'verbose',
}

/**
 * Declares every environment variable this backend depends on, including
 * variables for features not yet implemented (JWT_*, S3_*, AI_*) so
 * misconfiguration fails fast at boot rather than being silently ignored
 * once those features land. Conditional rules (`@ValidateIf`) mean a var is
 * only required when the feature it belongs to is actually selected —
 * STORAGE_DRIVER=local (the default) never requires S3 credentials, and
 * AI_PROVIDER=none (the default) never requires an AI API key.
 */
class EnvironmentVariables {
  @IsEnum(Environment)
  @IsOptional()
  NODE_ENV?: Environment;

  @IsInt()
  @Min(0)
  @Max(65535)
  @IsOptional()
  PORT?: number;

  @IsString()
  @IsOptional()
  API_PREFIX?: string;

  @IsString()
  @IsOptional()
  FRONTEND_URL?: string;

  @IsString()
  @IsOptional()
  BODY_LIMIT?: string;

  @IsString()
  @IsOptional()
  SWAGGER_ENABLED?: string;

  @IsEnum(LogLevelEnum)
  @IsOptional()
  LOG_LEVEL?: LogLevelEnum;

  @IsString()
  DATABASE_URL: string;

  @IsString()
  JWT_ACCESS_SECRET: string;

  @IsString()
  JWT_REFRESH_SECRET: string;

  @IsString()
  @IsOptional()
  JWT_ACCESS_EXPIRES_IN?: string;

  @IsString()
  @IsOptional()
  JWT_REFRESH_EXPIRES_IN?: string;

  @IsString()
  MFA_ENCRYPTION_KEY: string;

  @IsString()
  @IsOptional()
  REFRESH_COOKIE_NAME?: string;

  @IsInt()
  @Min(1)
  @IsOptional()
  AUTH_MAX_FAILED_LOGIN_ATTEMPTS?: number;

  @IsInt()
  @Min(1)
  @IsOptional()
  AUTH_LOCKOUT_DURATION_MINUTES?: number;

  @IsEnum(StorageDriverEnum)
  @IsOptional()
  STORAGE_DRIVER?: StorageDriverEnum;

  @IsString()
  @IsOptional()
  STORAGE_LOCAL_PATH?: string;

  @ValidateIf(
    (env: EnvironmentVariables) => env.STORAGE_DRIVER === StorageDriverEnum.S3,
  )
  @IsString()
  S3_ENDPOINT?: string;

  @ValidateIf(
    (env: EnvironmentVariables) => env.STORAGE_DRIVER === StorageDriverEnum.S3,
  )
  @IsString()
  S3_REGION?: string;

  @ValidateIf(
    (env: EnvironmentVariables) => env.STORAGE_DRIVER === StorageDriverEnum.S3,
  )
  @IsString()
  S3_BUCKET?: string;

  @ValidateIf(
    (env: EnvironmentVariables) => env.STORAGE_DRIVER === StorageDriverEnum.S3,
  )
  @IsString()
  S3_ACCESS_KEY?: string;

  @ValidateIf(
    (env: EnvironmentVariables) => env.STORAGE_DRIVER === StorageDriverEnum.S3,
  )
  @IsString()
  S3_SECRET_KEY?: string;

  @IsInt()
  @Min(1)
  @Max(52_428_800)
  @IsOptional()
  DOCUMENT_MAX_SIZE_BYTES?: number;

  @IsEnum(DocumentScannerEnum)
  @IsOptional()
  DOCUMENT_SCANNER?: DocumentScannerEnum;

  @IsEnum(AiProviderEnum)
  @IsOptional()
  AI_PROVIDER?: AiProviderEnum;

  @ValidateIf(
    (env: EnvironmentVariables) =>
      !!env.AI_PROVIDER && env.AI_PROVIDER !== AiProviderEnum.None,
  )
  @IsString()
  AI_API_KEY?: string;

  @ValidateIf(
    (env: EnvironmentVariables) =>
      !!env.AI_PROVIDER && env.AI_PROVIDER !== AiProviderEnum.None,
  )
  @IsString()
  AI_MODEL?: string;
}

export function validate(
  config: Record<string, unknown>,
): EnvironmentVariables {
  const validatedConfig = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });

  const errors = validateSync(validatedConfig, {
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    throw new Error(
      `Invalid environment configuration:\n${errors
        .map((error) => Object.values(error.constraints ?? {}).join(', '))
        .join('\n')}`,
    );
  }

  return validatedConfig;
}
