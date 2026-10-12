import {
  generateSecureToken,
  hashSecureToken,
  hashesEqual,
} from './secure-token.js';

describe('secure token helpers', () => {
  it('generates distinct 256-bit base64url tokens', () => {
    const a = generateSecureToken();
    const b = generateSecureToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('hashes to 64 lowercase hex characters deterministically', () => {
    const hash = hashSecureToken('token');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashSecureToken('token')).toBe(hash);
    expect(hashSecureToken('other')).not.toBe(hash);
    // Known SHA-256("abc") vector.
    expect(hashSecureToken('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('compares hashes without throwing on different lengths', () => {
    const hash = hashSecureToken('token');
    expect(hashesEqual(hash, hash)).toBe(true);
    expect(hashesEqual(hash, hashSecureToken('other'))).toBe(false);
    expect(hashesEqual(hash, 'short')).toBe(false);
  });
});
