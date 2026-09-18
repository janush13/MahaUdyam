import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../config/configuration';
import { InvalidStorageKeyError } from './storage-path.util';
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
});
