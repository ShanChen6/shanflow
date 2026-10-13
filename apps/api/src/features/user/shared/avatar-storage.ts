import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';

const KEY_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$/;

/** `<user id>/<random uuid>.webp`: a fresh key per upload, so a URL never serves different bytes later. */
export function newAvatarKey(userId: string): string {
  return `${userId}/${randomUUID()}.webp`;
}

/**
 * Where avatar bytes live. The database stores only the key. A production deployment on ephemeral
 * containers needs an object-storage implementation of this port (local disk does not survive redeploys).
 */
export abstract class AvatarStorage {
  abstract put(key: string, bytes: Buffer): Promise<void>;
  /** The stored bytes, or null if there are none under this key. */
  abstract get(key: string): Promise<Buffer | null>;
  /** Idempotent: deleting a missing key succeeds. */
  abstract delete(key: string): Promise<void>;
}

export class LocalAvatarStorage extends AvatarStorage {
  private readonly root: string;

  constructor(directory: string) {
    super();
    this.root = resolve(directory);
  }

  /** Only keys of the exact generated shape are accepted, and the result must stay inside the root. */
  private pathFor(key: string): string {
    if (!KEY_PATTERN.test(key)) throw new RangeError('Invalid avatar key.');
    const path = resolve(join(this.root, key));
    if (!path.startsWith(this.root + sep))
      throw new RangeError('Invalid avatar key.');
    return path;
  }

  async put(key: string, bytes: Buffer): Promise<void> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    // Write then rename, so a reader never sees a half-written image.
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, bytes, { mode: 0o600, flag: 'wx' });
      await rename(temporary, path);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      return await readFile(this.pathFor(key));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }
}
