export type StorageDriver = 'local' | 's3';

export interface S3Settings {
  endpoint: string;
  region: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
}

export interface StorageSettings {
  driver: StorageDriver;
  localPath: string;
  /** Only populated when driver === 's3'. */
  s3?: S3Settings;
}

/**
 * Storage driver selection + settings for whichever driver is active.
 * S3 settings are only read/populated when STORAGE_DRIVER=s3 — an S3
 * implementation is not built in this step (see
 * src/infrastructure/storage), so no AWS SDK dependency is introduced
 * merely to read these values.
 */
export const buildStorageConfig = (): StorageSettings => {
  const driver = (process.env.STORAGE_DRIVER as StorageDriver) ?? 'local';
  const localPath = process.env.STORAGE_LOCAL_PATH ?? './storage';

  if (driver !== 's3') {
    return { driver, localPath };
  }

  return {
    driver,
    localPath,
    s3: {
      endpoint: process.env.S3_ENDPOINT ?? '',
      region: process.env.S3_REGION ?? '',
      bucket: process.env.S3_BUCKET ?? '',
      accessKey: process.env.S3_ACCESS_KEY ?? '',
      secretKey: process.env.S3_SECRET_KEY ?? '',
    },
  };
};
