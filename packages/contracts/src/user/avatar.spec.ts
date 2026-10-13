import { AVATAR_CONTENT_TYPES, AVATAR_MAX_BYTES, avatarResponseSchema } from './avatar.js';

describe('avatar contract', () => {
  it('limits uploads to 2 MiB of PNG, JPEG or WebP', () => {
    expect(AVATAR_MAX_BYTES).toBe(2_097_152);
    expect([...AVATAR_CONTENT_TYPES]).toEqual(['image/png', 'image/jpeg', 'image/webp']);
  });

  it('answers with the updated profile', () => {
    const user = {
      id: '0b1f7a4e-3c1d-4a6e-9b6a-2f1c8d0e5a11',
      email: 'a@b.io',
      emailVerified: true,
      displayName: 'A',
      avatarUrl: 'http://localhost:3001/users/0b1f7a4e-3c1d-4a6e-9b6a-2f1c8d0e5a11/avatar?v=1',
      createdAt: '2026-10-12T00:00:00.000Z',
      updatedAt: '2026-10-12T00:00:00.000Z',
    };
    expect(avatarResponseSchema.safeParse({ user }).success).toBe(true);
    expect(avatarResponseSchema.safeParse({}).success).toBe(false);
  });
});
