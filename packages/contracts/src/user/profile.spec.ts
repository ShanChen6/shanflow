import { getUserMeResponseSchema, userProfileSchema } from './profile.js';

const profile = {
  id: '0b1f7a4e-3c1d-4a6e-9b6a-2f1c8d0e5a11',
  email: 'ann@example.invalid',
  emailVerified: true,
  displayName: 'Ann',
  avatarUrl: 'https://images.example.invalid/ann.png',
  createdAt: '2026-10-12T00:00:00.000Z',
  updatedAt: '2026-10-12T01:00:00.000Z',
};

describe('userProfileSchema', () => {
  it('accepts a complete profile and a profile without an avatar', () => {
    expect(userProfileSchema.safeParse(profile).success).toBe(true);
    expect(userProfileSchema.safeParse({ ...profile, avatarUrl: null }).success).toBe(true);
  });

  it.each([
    ['a non-uuid id', { id: 'nope' }],
    ['a missing verification flag', { emailVerified: undefined }],
    ['an avatar that is not a URL', { avatarUrl: 'not a url' }],
    ['a date that is not ISO 8601', { createdAt: '12/10/2026' }],
    ['an undefined avatar (must be explicit null)', { avatarUrl: undefined }],
  ])('rejects %s', (_name, override) => {
    expect(userProfileSchema.safeParse({ ...profile, ...override }).success).toBe(false);
  });

  it('strips fields it does not know, so credentials can never ride along', () => {
    const parsed = userProfileSchema.parse({ ...profile, passwordHash: 'secret', accountStatus: 'ACTIVE' });
    expect(Object.keys(parsed).sort()).toEqual(['avatarUrl', 'createdAt', 'displayName', 'email', 'emailVerified', 'id', 'updatedAt']);
  });
});

describe('getUserMeResponseSchema', () => {
  it('wraps the profile in a user key', () => {
    expect(getUserMeResponseSchema.parse({ user: profile })).toEqual({ user: profile });
    expect(getUserMeResponseSchema.safeParse(profile).success).toBe(false);
  });
});
