import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../config/configuration';
import { LocalStorageService } from './local-storage.service';
import { STORAGE_SERVICE } from './storage.interface';

/**
 * Binds STORAGE_SERVICE to an implementation chosen by STORAGE_DRIVER.
 * Only "local" is implemented in this step — selecting STORAGE_DRIVER=s3
 * fails fast at startup with a clear message rather than silently falling
 * back to local storage (which would be a surprising, wrong default for
 * someone who explicitly configured S3). Swapping in a real S3-compatible
 * implementation later only requires adding a case here — every consumer
 * depends on STORAGE_SERVICE, never on LocalStorageService directly.
 */
@Global()
@Module({
  providers: [
    LocalStorageService,
    {
      provide: STORAGE_SERVICE,
      useFactory: (
        configService: ConfigService<AppConfig, true>,
        local: LocalStorageService,
      ) => {
        const driver = configService.get('storage.driver', { infer: true });

        if (driver === 'local') {
          return local;
        }

        throw new Error(
          `STORAGE_DRIVER="${driver}" is configured, but only "local" is implemented so far. ` +
            'The S3-compatible adapter is a future step — see backend/README.md.',
        );
      },
      inject: [ConfigService, LocalStorageService],
    },
  ],
  exports: [STORAGE_SERVICE],
})
export class StorageModule {}
