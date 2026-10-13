import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalAvatarStorage, newAvatarKey } from './avatar-storage.js';

const userId = '0b1f7a4e-3c1d-4a6e-9b6a-2f1c8d0e5a11';

describe('LocalAvatarStorage', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'shanflow-storage-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('stores, reads and deletes by key', async () => {
    const storage = new LocalAvatarStorage(dir);
    const key = newAvatarKey(userId);
    await storage.put(key, Buffer.from('abc'));
    expect((await storage.get(key))?.toString()).toBe('abc');
    await storage.delete(key);
    expect(await storage.get(key)).toBeNull();
    expect(existsSync(join(dir, key))).toBe(false);
  });

  it('generates a fresh key per call, scoped to the user', () => {
    const a = newAvatarKey(userId);
    expect(a).toMatch(new RegExp(`^${userId}/[0-9a-f-]{36}\\.webp$`));
    expect(newAvatarKey(userId)).not.toBe(a);
  });

  it.each([
    '../evil.webp',
    `${userId}/../../x.webp`,
    '/etc/passwd',
    `${userId}/a.png`,
    '',
  ])('refuses the unsafe key %j', async (key) => {
    const storage = new LocalAvatarStorage(dir);
    await expect(storage.put(key, Buffer.from('x'))).rejects.toThrow();
    await expect(storage.get(key)).rejects.toThrow();
    await expect(storage.delete(key)).rejects.toThrow();
  });

  it('treats a missing file as absent and deleting it as a no-op', async () => {
    const storage = new LocalAvatarStorage(dir);
    const key = newAvatarKey(userId);
    expect(await storage.get(key)).toBeNull();
    await expect(storage.delete(key)).resolves.toBeUndefined();
  });
});
