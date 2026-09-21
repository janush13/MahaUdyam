import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../config/configuration';
import { ensureStorageDirectory } from './ensure-storage-directory';
import { resolveSafeStoragePath } from './storage-path.util';
import {
  PutOptions,
  StorageObjectExistsError,
  StorageService,
  StoredObjectMetadata,
} from './storage.interface';

/**
 * Development storage implementation — local filesystem, rooted at
 * STORAGE_LOCAL_PATH. Every key is resolved through
 * resolveSafeStoragePath, so a caller can never write or read outside the
 * storage root regardless of what key it supplies.
 */
@Injectable()
export class LocalStorageService implements StorageService {
  private readonly root: string;

  constructor(configService: ConfigService<AppConfig, true>) {
    this.root = ensureStorageDirectory(
      configService.get('storage.localPath', { infer: true }),
    );
  }

  async put(
    key: string,
    data: Buffer,
    options: PutOptions = {},
  ): Promise<StoredObjectMetadata> {
    const path = resolveSafeStoragePath(this.root, key);
    await mkdir(dirname(path), { recursive: true });
    try {
      // 'wx' fails atomically if the file exists — no check-then-write race.
      await writeFile(path, data, {
        flag: options.overwrite === false ? 'wx' : 'w',
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new StorageObjectExistsError();
      }
      throw error;
    }
    return { key, size: data.byteLength };
  }

  async get(key: string): Promise<Buffer> {
    const path = resolveSafeStoragePath(this.root, key);
    return readFile(path);
  }

  async delete(key: string): Promise<void> {
    const path = resolveSafeStoragePath(this.root, key);
    await rm(path, { force: true });
  }

  async exists(key: string): Promise<boolean> {
    const path = resolveSafeStoragePath(this.root, key);
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  }
}
