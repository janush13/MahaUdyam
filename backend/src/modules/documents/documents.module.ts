import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { AppConfig } from '../../config/configuration';
import { ApplicationsModule } from '../applications/applications.module';
import { AuthModule } from '../auth/auth.module';
import { EnterprisesModule } from '../enterprises/enterprises.module';
import { UsersModule } from '../users/users.module';
import { DevMockMalwareScanner } from './dev-mock-malware-scanner';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { MALWARE_SCANNER } from './malware-scanner.interface';
import { UploadErrorsInterceptor } from './upload-errors.interceptor';

/**
 * Document management (Blueprint DocumentModule). Depends on:
 *  - the enterprise module's EnterpriseAccessService/Guard (authorisation -
 *    imported, not re-implemented);
 *  - the application module (an application is the only door to a document);
 *  - STORAGE_SERVICE (global, Step 3) for bytes - never a concrete storage
 *    class or a cloud SDK;
 *  - MALWARE_SCANNER, bound below to whichever scanner DOCUMENT_SCANNER names.
 * UsersModule: RolesGuard (applied via @UseGuards) resolves UsersService in
 * the consuming module's context. Prisma and Audit are global modules.
 */
@Module({
  imports: [
    AuthModule,
    UsersModule,
    EnterprisesModule,
    ApplicationsModule,
    // Uploads are parsed in memory (the storage interface takes a Buffer) with
    // a hard ceiling; requirement-level limits are enforced by the service.
    MulterModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => ({
        // Keep any path the client sent in the filename, so the validator can
        // REFUSE it instead of the parser silently trimming it to a basename.
        preservePath: true,
        limits: {
          // The parser treats reaching its limit as truncation, so it gets one
          // byte of headroom: a file of exactly the maximum passes, a larger
          // one is refused (here, or by the service's own `> max` check).
          fileSize: config.get('documents.maxSizeBytes', { infer: true }) + 1,
          files: 1,
          fields: 4,
          fieldSize: 1024,
          fieldNameSize: 100,
          parts: 6,
        },
      }),
    }),
  ],
  controllers: [DocumentsController],
  providers: [
    DocumentsService,
    UploadErrorsInterceptor,
    DevMockMalwareScanner,
    {
      provide: MALWARE_SCANNER,
      useFactory: (
        config: ConfigService<AppConfig, true>,
        mock: DevMockMalwareScanner,
      ) => {
        const driver = config.get('documents.scanner', { infer: true });
        if (driver === 'mock') {
          new Logger('DocumentsModule').warn(
            `DOCUMENT_SCANNER=mock: ${mock.name} is a DEVELOPMENT stand-in, not antivirus. ` +
              'Connect a real scanner behind MALWARE_SCANNER before relying on document scanning.',
          );
          return mock;
        }
        throw new Error(
          `DOCUMENT_SCANNER="${String(driver)}" is configured, but only "mock" is implemented so far.`,
        );
      },
      inject: [ConfigService, DevMockMalwareScanner],
    },
  ],
  // MulterModule is re-exported so another module's upload route (inspection
  // evidence) parses multipart with the SAME size and part limits.
  exports: [DocumentsService, MulterModule],
})
export class DocumentsModule {}
