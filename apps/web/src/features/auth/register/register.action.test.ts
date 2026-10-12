import { afterEach, describe, expect, it, vi } from 'vitest';
import { mapRegisterProblem, submitRegistration, validateRegistration } from './register.action';

const input = { email: 'ann@example.invalid', password: 'correct horse battery', displayName: 'Ann' };
const user = { id: '0b1f7a4e-3c1d-4a6e-9b6a-2f1c8d0e5a11', email: input.email, displayName: 'Ann', emailVerified: false };

function respond(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({ ok: status < 400, status, json: async () => body });
}

afterEach(() => vi.unstubAllGlobals());

describe('validateRegistration', () => {
  it('returns no errors for a valid request', () => {
    expect(validateRegistration(input)).toEqual({});
  });

  it('flags every invalid field without leaking values', () => {
    const errors = validateRegistration({ email: 'nope', password: 'short', displayName: ' ' });
    expect(Object.keys(errors).sort()).toEqual(['displayName', 'email', 'password']);
    expect(JSON.stringify(errors)).not.toContain('short');
  });
});

describe('mapRegisterProblem', () => {
  const base = { type: 't', title: 'x', status: 400 };

  it('maps a duplicate email to the email field', () => {
    expect(mapRegisterProblem({ ...base, status: 409, code: 'EMAIL_ALREADY_REGISTERED' }).fieldErrors.email).toMatch(/already exists/);
  });

  it('maps server validation issues to fields and ignores unknown paths', () => {
    const outcome = mapRegisterProblem({
      ...base,
      code: 'VALIDATION_FAILED',
      issues: [{ path: 'password', code: 'too_small' }, { path: 'unknown', code: 'x' }],
    });
    expect(Object.keys(outcome.fieldErrors)).toEqual(['password']);
    expect(outcome.formError).toBeDefined();
  });

  it('maps throttling and unknown codes to form-level messages', () => {
    expect(mapRegisterProblem({ ...base, status: 429, code: 'TOO_MANY_REQUESTS' }).formError).toMatch(/Too many/);
    expect(mapRegisterProblem({ ...base, status: 500, code: 'INTERNAL_ERROR' }).formError).toMatch(/Something went wrong/);
  });
});

describe('submitRegistration', () => {
  it('posts JSON with credentials and returns the user on success', async () => {
    const fetchMock = respond(201, { user });
    vi.stubGlobal('fetch', fetchMock);
    await expect(submitRegistration(input)).resolves.toEqual({ status: 'success', user });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:3001/auth/register');
    expect(init).toMatchObject({ method: 'POST', credentials: 'include' });
    expect(JSON.parse(String(init.body))).toEqual(input);
  });

  it('maps a 409 problem to an email field error', async () => {
    vi.stubGlobal('fetch', respond(409, { type: 't', title: 'x', status: 409, code: 'EMAIL_ALREADY_REGISTERED' }));
    const outcome = await submitRegistration(input);
    expect(outcome).toMatchObject({ status: 'error', fieldErrors: { email: expect.any(String) } });
  });

  it.each([
    ['network failure', () => vi.fn().mockRejectedValue(new TypeError('failed'))],
    ['non-JSON body', () => vi.fn().mockResolvedValue({ ok: false, status: 502, json: async () => { throw new SyntaxError('x'); } })],
    ['success body that breaks the contract', () => respond(201, { user: { id: 'not-a-uuid' } })],
    ['error body that is not a problem', () => respond(500, { message: 'boom' })],
  ])('reports the server as unreachable on %s', async (_name, makeFetch) => {
    vi.stubGlobal('fetch', makeFetch());
    const outcome = await submitRegistration(input);
    expect(outcome).toMatchObject({ status: 'error', fieldErrors: {}, formError: expect.stringMatching(/reach the server/) });
  });
});
