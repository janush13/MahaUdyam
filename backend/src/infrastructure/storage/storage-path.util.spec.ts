import { join, resolve } from 'node:path';
import {
  InvalidStorageKeyError,
  resolveSafeStoragePath,
} from './storage-path.util';

describe('resolveSafeStoragePath', () => {
  const root = resolve('C:/fake/storage/root');

  it('resolves a simple relative key inside the root', () => {
    expect(resolveSafeStoragePath(root, 'documents/a.pdf')).toBe(
      join(root, 'documents', 'a.pdf'),
    );
  });

  it('resolves a nested key inside the root', () => {
    expect(resolveSafeStoragePath(root, 'a/b/c/d.txt')).toBe(
      join(root, 'a', 'b', 'c', 'd.txt'),
    );
  });

  it('rejects an empty key', () => {
    expect(() => resolveSafeStoragePath(root, '')).toThrow(
      InvalidStorageKeyError,
    );
  });

  it('rejects a key that escapes the root via ..', () => {
    expect(() => resolveSafeStoragePath(root, '../../etc/passwd')).toThrow(
      InvalidStorageKeyError,
    );
  });

  it('rejects a key that escapes the root via a deeper .. traversal', () => {
    expect(() => resolveSafeStoragePath(root, 'a/../../b')).toThrow(
      InvalidStorageKeyError,
    );
  });

  it('rejects a POSIX absolute path', () => {
    expect(() => resolveSafeStoragePath(root, '/etc/passwd')).toThrow(
      InvalidStorageKeyError,
    );
  });

  it('rejects a Windows absolute path', () => {
    expect(() => resolveSafeStoragePath(root, 'C:\\Windows\\System32')).toThrow(
      InvalidStorageKeyError,
    );
  });

  it('rejects a key containing a null byte', () => {
    expect(() => resolveSafeStoragePath(root, 'a\0b')).toThrow(
      InvalidStorageKeyError,
    );
  });
});
