import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../config/configuration';
import { InvalidStorageKeyError } from './storage-path.util';
import { StorageObjectExistsError } from './storage.interface';
import { LocalStorageService } from './local-storage.service';

describe('LocalStorageService', () => {
  let testRoot: string;
  let service: LocalStorageService;

  beforeEach(() => {
    testRoot = join(tmpdir(), `mahaudyam-storage-test-${randomUUID()}`);

    const configService = {
      get: () => testRoot,
    } as unknown as ConfigService<AppConfig, true>;

    service = new LocalStorageService(configService);
  });

  afterEach(async () => {
    await rm(testRoot, { recursive: true, force: true });
  });

  it('creates the storage root directory on construction', async () => {
    expect(await service.exists('anything')).toBe(false);
  });

  it('writes and reads back a file (put/get round trip)', async () => {
    const data = Buffer.from('hello world');

    const meta = await service.put('greeting.txt', data);

    expect(meta).toEqual({ key: 'greeting.txt', size: data.byteLength });
    expect(await service.get('greeting.txt')).toEqual(data);
  });

  it('creates intermediate directories for nested keys', async () => {
    const data = Buffer.from('nested');

    await service.put('a/b/c/nested.txt', data);

    expect(await service.get('a/b/c/nested.txt')).toEqual(data);
  });

  it('reports exists() correctly before and after put', async () => {
    expect(await service.exists('doc.pdf')).toBe(false);
    await service.put('doc.pdf', Buffer.from('x'));
    expect(await service.exists('doc.pdf')).toBe(true);
  });

  it('deletes a file', async () => {
    await service.put('to-delete.txt', Buffer.from('x'));
    expect(await service.exists('to-delete.txt')).toBe(true);

    await service.delete('to-delete.txt');

    expect(await service.exists('to-delete.txt')).toBe(false);
  });

  it('does not throw when deleting a key that does not exist', async () => {
    await expect(service.delete('never-existed.txt')).resolves.not.toThrow();
  });

  it('rejects a path-traversal key on put', async () => {
    await expect(
      service.put('../../escape.txt', Buffer.from('x')),
    ).rejects.toThrow(InvalidStorageKeyError);
  });

  it('rejects a path-traversal key on get', async () => {
    await expect(service.get('../../escape.txt')).rejects.toThrow(
      InvalidStorageKeyError,
    );
  });

  describe('put with overwrite disabled (immutable objects such as documents)', () => {
    it('writes a new key normally', async () => {
      const meta = await service.put('immutable.bin', Buffer.from('one'), {
        overwrite: false,
      });
      expect(meta).toEqual({ key: 'immutable.bin', size: 3 });
      expect(await service.get('immutable.bin')).toEqual(Buffer.from('one'));
    });

    it('refuses to replace an existing object, and leaves it untouched', async () => {
      await service.put('immutable.bin', Buffer.from('original'), {
        overwrite: false,
      });
      await expect(
        service.put('immutable.bin', Buffer.from('replacement'), {
          overwrite: false,
        }),
      ).rejects.toThrow(StorageObjectExistsError);
      expect(await service.get('immutable.bin')).toEqual(
        Buffer.from('original'),
      );
    });

    it('is atomic: of two racing writers to one key exactly one wins', async () => {
      const results = await Promise.allSettled(
        Array.from({ length: 8 }, (_, i) =>
          service.put('race.bin', Buffer.from(`writer-${i}`), {
            overwrite: false,
          }),
        ),
      );
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      for (const r of results.filter((x) => x.status === 'rejected')) {
        expect((r as PromiseRejectedResult).reason).toBeInstanceOf(
          StorageObjectExistsError,
        );
      }
    });

    it('still validates the key (no traversal via the no-overwrite path)', async () => {
      await expect(
        service.put('../../escape.txt', Buffer.from('x'), { overwrite: false }),
      ).rejects.toThrow(InvalidStorageKeyError);
    });

    it('keeps the Step 3 default: overwrite unless told otherwise', async () => {
      await service.put('default.txt', Buffer.from('first'));
      await service.put('default.txt', Buffer.from('second'));
      await service.put('default.txt', Buffer.from('third'), {
        overwrite: true,
      });
      expect(await service.get('default.txt')).toEqual(Buffer.from('third'));
    });

    it('does not mask other write errors as "already exists"', async () => {
      // A key whose parent is a FILE cannot be created: an ordinary I/O error,
      // which must not be reported as "the object already exists".
      await service.put('a-file', Buffer.from('x'));
      const error = await service
        .put('a-file/child.bin', Buffer.from('y'), { overwrite: false })
        .catch((e: unknown) => e);
      expect(error).toBeDefined();
      expect(error instanceof StorageObjectExistsError).toBe(false);
    });
  });
});
