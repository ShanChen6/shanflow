import { CSRF_HEADER_NAME, CSRF_HEADER_VALUE } from './csrf.js';
import { refreshResponseSchema } from './refresh.js';

describe('refresh contract', () => {
  it('uses the login response shape and never a refresh token field', () => {
    const user = { id: '0b1f7a4e-3c1d-4a6e-9b6a-2f1c8d0e5a11', email: 'a@b.io', displayName: 'A', emailVerified: false };
    const parsed = refreshResponseSchema.parse({ accessToken: 't', tokenType: 'Bearer', expiresIn: 900, user, refreshToken: 'leak' });
    expect(Object.keys(parsed).sort()).toEqual(['accessToken', 'expiresIn', 'tokenType', 'user']);
  });

  it('exposes stable CSRF header constants', () => {
    expect(CSRF_HEADER_NAME).toBe('X-Requested-With');
    expect(CSRF_HEADER_VALUE).toBe('shanflow');
  });
});
