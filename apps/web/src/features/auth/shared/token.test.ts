import { describe, expect, it } from 'vitest';
import { isPlausibleToken } from './token';

describe('isPlausibleToken', () => {
  it('accepts only the 43-character base64url shape the API issues', () => {
    expect(isPlausibleToken('A'.repeat(43))).toBe(true);
    for (const bad of [null, undefined, '', 'short', 'A'.repeat(44), `${'A'.repeat(42)}!`]) {
      expect(isPlausibleToken(bad)).toBe(false);
    }
  });
});
