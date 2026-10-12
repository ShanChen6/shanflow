import {
  Argon2PasswordHasher,
  MAX_PASSWORD_LENGTH,
} from './password-hasher.js';

describe('Argon2PasswordHasher', () => {
  const hasher = new Argon2PasswordHasher();

  it('hashes with argon2id and verifies the right password only', async () => {
    const hash = await hasher.hash('correct horse battery');
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,p=1,t=2\$/);
    expect(hash).not.toContain('correct horse');
    await expect(hasher.verify(hash, 'correct horse battery')).resolves.toBe(
      true,
    );
    await expect(hasher.verify(hash, 'wrong password')).resolves.toBe(false);
  });

  it('salts every hash', async () => {
    const [a, b] = await Promise.all([
      hasher.hash('same'),
      hasher.hash('same'),
    ]);
    expect(a).not.toBe(b);
  });

  it('returns false for malformed hashes and unsupported lengths instead of throwing', async () => {
    await expect(hasher.verify('not-a-hash', 'password')).resolves.toBe(false);
    await expect(hasher.verify('', 'password')).resolves.toBe(false);
    const hash = await hasher.hash('x'.repeat(MAX_PASSWORD_LENGTH));
    await expect(
      hasher.verify(hash, 'x'.repeat(MAX_PASSWORD_LENGTH + 1)),
    ).resolves.toBe(false);
    await expect(hasher.verify(hash, '')).resolves.toBe(false);
  });

  it('rejects hashing empty or over-long passwords', async () => {
    await expect(hasher.hash('')).rejects.toThrow(RangeError);
    await expect(
      hasher.hash('x'.repeat(MAX_PASSWORD_LENGTH + 1)),
    ).rejects.toThrow(RangeError);
  });

  it('flags hashes made with weaker parameters for rehash', async () => {
    const argon2 = (await import('argon2')).default;
    const weak = await argon2.hash('password', {
      type: argon2.argon2id,
      memoryCost: 8192,
      timeCost: 1,
      parallelism: 1,
    });
    expect(hasher.needsRehash(weak)).toBe(true);
    expect(hasher.needsRehash(await hasher.hash('password'))).toBe(false);
  });

  it('runs the dummy verification without error for any input length', async () => {
    await expect(hasher.verifyDummy('anything')).resolves.toBeUndefined();
    await expect(hasher.verifyDummy('x'.repeat(1000))).resolves.toBeUndefined();
    await expect(hasher.verifyDummy('')).resolves.toBeUndefined();
  });
});
