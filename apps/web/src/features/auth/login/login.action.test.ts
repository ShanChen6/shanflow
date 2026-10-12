import { afterEach, describe, expect, it, vi } from 'vitest';
import { mapLoginProblem, submitLogin, validateLogin } from './login.action';

const input = { email: 'ann@example.invalid', password: 'correct horse battery' };
const user = { id: '0b1f7a4e-3c1d-4a6e-9b6a-2f1c8d0e5a11', email: input.email, displayName: 'Ann', emailVerified: false };

function respond(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({ ok: status < 400, status, json: async () => body });
}

afterEach(() => vi.unstubAllGlobals());

describe('validateLogin', () => {
  it('accepts any non-empty password', () => {
    expect(validateLogin({ email: 'a@b.io', password: 'x' })).toEqual({});
  });

  it('flags a bad email and an empty password', () => {
    expect(Object.keys(validateLogin({ email: 'nope', password: '' })).sort()).toEqual(['email', 'password']);
  });
});

describe('mapLoginProblem', () => {
  const base = { type: 't', title: 'x', status: 401 };

  it('uses one generic message for invalid credentials', () => {
    expect(mapLoginProblem({ ...base, code: 'INVALID_CREDENTIALS' })).toEqual({
      status: 'error',
      fieldErrors: {},
      formError: 'Invalid email or password.',
    });
  });

  it('maps throttling, validation and unknown codes to form-level messages', () => {
    expect(mapLoginProblem({ ...base, status: 429, code: 'TOO_MANY_REQUESTS' }).formError).toMatch(/Too many/);
    expect(mapLoginProblem({ ...base, status: 400, code: 'VALIDATION_FAILED' }).formError).toMatch(/check your email/);
    expect(mapLoginProblem({ ...base, status: 500, code: 'INTERNAL_ERROR' }).formError).toMatch(/Something went wrong/);
  });
});

describe('submitLogin', () => {
  it('posts credentials and returns an in-memory session with an absolute expiry', async () => {
    vi.useFakeTimers().setSystemTime(new Date('2026-10-12T00:00:00Z'));
    try {
      const fetchMock = respond(200, { accessToken: 'jwt', tokenType: 'Bearer', expiresIn: 900, user });
      vi.stubGlobal('fetch', fetchMock);
      const outcome = await submitLogin(input);
      expect(outcome).toEqual({
        status: 'success',
        session: { accessToken: 'jwt', expiresAt: Date.parse('2026-10-12T00:15:00Z'), user },
      });
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('http://localhost:3001/auth/login');
      expect(init).toMatchObject({ method: 'POST', credentials: 'include' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('maps a 401 problem to the generic form error', async () => {
    vi.stubGlobal('fetch', respond(401, { type: 't', title: 'x', status: 401, code: 'INVALID_CREDENTIALS' }));
    await expect(submitLogin(input)).resolves.toMatchObject({ status: 'error', formError: 'Invalid email or password.' });
  });

  it.each([
    ['network failure', () => vi.fn().mockRejectedValue(new TypeError('failed'))],
    ['response that breaks the contract', () => respond(200, { accessToken: '', tokenType: 'Bearer', expiresIn: 1, user })],
  ])('reports the server as unreachable on %s', async (_name, makeFetch) => {
    vi.stubGlobal('fetch', makeFetch());
    await expect(submitLogin(input)).resolves.toMatchObject({ status: 'error', formError: expect.stringMatching(/reach the server/) });
  });
});
