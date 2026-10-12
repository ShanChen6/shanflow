import { changePasswordRequestSchema, forgotPasswordRequestSchema, resetPasswordRequestSchema } from './password-flows.js';
import { confirmEmailRequestSchema } from './one-time-token.js';
import { googleLinkStartRequestSchema } from './oauth.js';
import { meResponseSchema } from './me.js';

const token = 'A'.repeat(43);
const longPassword = 'p'.repeat(12);

describe('one-time token', () => {
  it('accepts only the 43-character base64url shape', () => {
    expect(confirmEmailRequestSchema.safeParse({ token }).success).toBe(true);
    for (const bad of ['', 'short', 'A'.repeat(42), 'A'.repeat(44), `${'A'.repeat(42)}=`, `${'A'.repeat(42)}!`, 123]) {
      expect(confirmEmailRequestSchema.safeParse({ token: bad }).success).toBe(false);
    }
  });
});

describe('password flow contracts', () => {
  it('forgot password needs a valid email and trims it', () => {
    expect(forgotPasswordRequestSchema.parse({ email: ' A@b.io ' })).toEqual({ email: 'A@b.io' });
    expect(forgotPasswordRequestSchema.safeParse({ email: 'nope' }).success).toBe(false);
  });

  it('reset enforces the token shape and the new-password policy', () => {
    expect(resetPasswordRequestSchema.safeParse({ token, newPassword: longPassword }).success).toBe(true);
    expect(resetPasswordRequestSchema.safeParse({ token, newPassword: 'short' }).success).toBe(false);
    expect(resetPasswordRequestSchema.safeParse({ token: 'x', newPassword: longPassword }).success).toBe(false);
    expect(resetPasswordRequestSchema.safeParse({ token, newPassword: 'p'.repeat(129) }).success).toBe(false);
  });

  it('change accepts any non-empty current password but enforces the policy on the new one', () => {
    expect(changePasswordRequestSchema.safeParse({ currentPassword: 'x', newPassword: longPassword }).success).toBe(true);
    expect(changePasswordRequestSchema.safeParse({ currentPassword: '', newPassword: longPassword }).success).toBe(false);
    expect(changePasswordRequestSchema.safeParse({ currentPassword: 'x', newPassword: 'short' }).success).toBe(false);
  });

  it('link start requires a password', () => {
    expect(googleLinkStartRequestSchema.safeParse({ password: 'x' }).success).toBe(true);
    expect(googleLinkStartRequestSchema.safeParse({ password: '' }).success).toBe(false);
  });
});

describe('me response with security', () => {
  const user = { id: '0b1f7a4e-3c1d-4a6e-9b6a-2f1c8d0e5a11', email: 'a@b.io', displayName: 'A', emailVerified: false };
  it('requires the security block and known providers only', () => {
    expect(meResponseSchema.safeParse({ user, security: { hasPassword: true, linkedProviders: ['google'] } }).success).toBe(true);
    expect(meResponseSchema.safeParse({ user }).success).toBe(false);
    expect(meResponseSchema.safeParse({ user, security: { hasPassword: true, linkedProviders: ['facebook'] } }).success).toBe(false);
  });
});
