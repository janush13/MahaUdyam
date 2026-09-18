/**
 * Storage abstraction boundary (architecture: StorageService interface ->
 * LocalStorageService (dev, implemented this step) ->
 * S3-compatible adapter (production, a future step — see README.md)).
 *
 * Deliberately minimal: put/get/delete/exists is everything a future
 * DocumentModule needs to build on. No upload-endpoint, validation, OCR,
 * or malware-scanning logic lives here or anywhere near it — this is pure
 * byte storage, key in and bytes out.
 */
export interface StoredObjectMetadata {
  key: string;
  size: number;
}

export interface StorageService {
  put(key: string, data: Buffer): Promise<StoredObjectMetadata>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

/** DI token — `StorageService` is an interface and has no runtime identity,
 * so consumers inject via `@Inject(STORAGE_SERVICE)`. */
export const STORAGE_SERVICE = Symbol('STORAGE_SERVICE');
