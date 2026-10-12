import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const TOKEN_BYTES = 32;

/** Opaque high-entropy secret (256 bits, base64url). Only the hash is ever stored. */
export function generateSecureToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

/** SHA-256 as 64 lowercase hex characters, matching the refresh_sessions CHECK constraint. */
export function hashSecureToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Constant-time comparison for two hex digests of equal length. */
export function hashesEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}
