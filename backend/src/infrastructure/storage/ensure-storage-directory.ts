import { existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';

/**
 * Ensures the local development storage directory exists at boot.
 * This is the only storage behavior implemented in this step — actual
 * upload/download logic belongs to the DocumentModule in a later step.
 */
export function ensureStorageDirectory(storagePath: string): string {
  const absolutePath = resolve(process.cwd(), storagePath);

  if (!existsSync(absolutePath)) {
    mkdirSync(absolutePath, { recursive: true });
  }

  return absolutePath;
}
