import { resolve, sep } from 'node:path';

export class InvalidStorageKeyError extends Error {
  constructor(key: string) {
    super(
      `Storage key "${key}" is not permitted — it is absolute, contains invalid characters, or resolves outside the storage root.`,
    );
    this.name = 'InvalidStorageKeyError';
  }
}

const ABSOLUTE_PATH = /^([a-zA-Z]:[\\/]|[\\/])/;

/**
 * Resolves a caller-supplied storage key against the storage root, and
 * throws InvalidStorageKeyError if the result would escape that root (path
 * traversal via `..`, an absolute path, or a null byte) or if the key is
 * empty. No upload endpoint exists yet, but every future one must go
 * through this — a document key must never be treated as a trustworthy
 * filesystem path on its own.
 */
export function resolveSafeStoragePath(root: string, key: string): string {
  if (!key || key.includes('\0') || ABSOLUTE_PATH.test(key)) {
    throw new InvalidStorageKeyError(key);
  }

  const resolvedRoot = resolve(root);
  const resolvedPath = resolve(resolvedRoot, key);

  const isRootItself = resolvedPath === resolvedRoot;
  const isInsideRoot = resolvedPath.startsWith(resolvedRoot + sep);

  if (!isRootItself && !isInsideRoot) {
    throw new InvalidStorageKeyError(key);
  }

  return resolvedPath;
}
