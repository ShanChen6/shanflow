import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, registerRequestSchema, registerResponseSchema } from './register.js';

const valid = { email: 'user@example.invalid', password: 'x'.repeat(PASSWORD_MIN_LENGTH), displayName: 'User' };

describe('registerRequestSchema', () => {
  it('accepts a valid request and trims email and display name only', () => {
    const parsed = registerRequestSchema.parse({ email: '  User@Example.invalid ', password: '  spaced password  ', displayName: '  Ann  ' });
    expect(parsed).toEqual({ email: 'User@Example.invalid', password: '  spaced password  ', displayName: 'Ann' });
  });

  it.each([
    [{ ...valid, email: 'not-an-email' }, 'email'],
    [{ ...valid, email: `${'a'.repeat(250)}@x.io` }, 'email'],
    [{ ...valid, password: 'x'.repeat(PASSWORD_MIN_LENGTH - 1) }, 'password'],
    [{ ...valid, password: 'x'.repeat(PASSWORD_MAX_LENGTH + 1) }, 'password'],
    [{ ...valid, displayName: '   ' }, 'displayName'],
    [{ ...valid, displayName: 'n'.repeat(81) }, 'displayName'],
    [{ email: valid.email }, 'password'],
  ])('rejects invalid input %#', (input, field) => {
    const result = registerRequestSchema.safeParse(input);
    expect(result.success).toBe(false);
    expect(result.error?.issues.some((issue) => issue.path[0] === field)).toBe(true);
  });

  it('accepts the maximum password length', () => {
    expect(registerRequestSchema.safeParse({ ...valid, password: 'x'.repeat(PASSWORD_MAX_LENGTH) }).success).toBe(true);
  });
});

describe('registerResponseSchema', () => {
  it('requires a uuid and the verification flag', () => {
    const user = { id: '0b1f7a4e-3c1d-4a6e-9b6a-2f1c8d0e5a11', email: 'a@b.io', displayName: 'A', emailVerified: false };
    expect(registerResponseSchema.safeParse({ user }).success).toBe(true);
    expect(registerResponseSchema.safeParse({ user: { ...user, id: 'nope' } }).success).toBe(false);
  });
});
