import { loginRequestSchema, loginResponseSchema } from './login.js';

describe('loginRequestSchema', () => {
  it('accepts any non-empty password up to the maximum and trims only the email', () => {
    expect(loginRequestSchema.parse({ email: ' A@b.io ', password: ' x ' })).toEqual({ email: 'A@b.io', password: ' x ' });
  });

  it.each([
    [{ email: 'nope', password: 'x' }, 'email'],
    [{ email: 'a@b.io', password: '' }, 'password'],
    [{ email: 'a@b.io', password: 'x'.repeat(129) }, 'password'],
    [{ email: 'a@b.io' }, 'password'],
  ])('rejects invalid input %#', (input, field) => {
    const result = loginRequestSchema.safeParse(input);
    expect(result.error?.issues.some((issue) => issue.path[0] === field)).toBe(true);
  });
});

describe('loginResponseSchema', () => {
  const user = { id: '0b1f7a4e-3c1d-4a6e-9b6a-2f1c8d0e5a11', email: 'a@b.io', displayName: 'A', emailVerified: false };

  it('requires a Bearer token with a positive lifetime', () => {
    expect(loginResponseSchema.safeParse({ accessToken: 't', tokenType: 'Bearer', expiresIn: 900, user }).success).toBe(true);
    expect(loginResponseSchema.safeParse({ accessToken: 't', tokenType: 'Basic', expiresIn: 900, user }).success).toBe(false);
    expect(loginResponseSchema.safeParse({ accessToken: 't', tokenType: 'Bearer', expiresIn: 0, user }).success).toBe(false);
  });
});
