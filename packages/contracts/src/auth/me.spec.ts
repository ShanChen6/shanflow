import { meResponseSchema } from './me.js';

describe('meResponseSchema', () => {
  it('requires the public user profile', () => {
    const user = { id: '0b1f7a4e-3c1d-4a6e-9b6a-2f1c8d0e5a11', email: 'a@b.io', displayName: 'A', emailVerified: true };
    expect(meResponseSchema.safeParse({ user }).success).toBe(true);
    expect(meResponseSchema.safeParse({}).success).toBe(false);
    expect(meResponseSchema.safeParse({ user: { ...user, id: 'x' } }).success).toBe(false);
  });
});
