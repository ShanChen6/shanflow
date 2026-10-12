import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getBootstrapPhase, resetBootstrap } from '../shared/bootstrap-store';
import { clearSession, getSession, setSession, type Session } from '../shared/session-store';
import { submitLogout } from './logout.action';

const user = { id: '0b1f7a4e-3c1d-4a6e-9b6a-2f1c8d0e5a11', email: 'ann@example.invalid', displayName: 'Ann', emailVerified: false };
const session = (): Session => ({ accessToken: 'jwt', expiresAt: Date.now() + 600_000, user });
const noContent = { ok: true, status: 204, json: async () => { throw new SyntaxError('empty'); } };
const problem = (status: number, code: string) => ({ ok: false, status, json: async () => ({ type: 't', title: 'x', status, code }) });

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  resetBootstrap();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  setSession(session());
});
afterEach(() => {
  vi.unstubAllGlobals();
  clearSession();
});

describe('submitLogout (this device)', () => {
  it('calls /auth/logout with the CSRF marker and keepalive, then clears the session and marks signed out', async () => {
    fetchMock.mockResolvedValue(noContent);
    await expect(submitLogout('device')).resolves.toEqual({ status: 'signed-out' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:3001/auth/logout');
    expect(init).toMatchObject({ method: 'POST', credentials: 'include', keepalive: true });
    expect(init.headers).toMatchObject({ 'X-Requested-With': 'shanflow' });
    expect(init.headers).not.toHaveProperty('Authorization');
    expect(getSession()).toBeNull();
    expect(getBootstrapPhase()).toBe('done');
  });

  it.each([
    ['a network failure', () => fetchMock.mockRejectedValue(new TypeError('failed'))],
    ['a CSRF rejection', () => fetchMock.mockResolvedValue(problem(403, 'CSRF_REJECTED'))],
    ['throttling', () => fetchMock.mockResolvedValue(problem(429, 'TOO_MANY_REQUESTS'))],
  ])('stays signed in and reports failure on %s', async (_name, arrange) => {
    const before = getSession();
    arrange();
    await expect(submitLogout('device')).resolves.toMatchObject({ status: 'failed', message: expect.stringMatching(/try again/) });
    expect(getSession()).toBe(before);
    expect(getBootstrapPhase()).toBe('idle');
  });
});

describe('submitLogout (all devices)', () => {
  it('calls /auth/logout-all with the Bearer token and clears local state', async () => {
    fetchMock.mockResolvedValue(noContent);
    await expect(submitLogout('everywhere')).resolves.toEqual({ status: 'signed-out' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:3001/auth/logout-all');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer jwt' });
    expect(getSession()).toBeNull();
  });

  it('refreshes once and retries when the access token was rejected', async () => {
    fetchMock
      .mockResolvedValueOnce(problem(401, 'UNAUTHENTICATED'))
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ accessToken: 'jwt-2', tokenType: 'Bearer', expiresIn: 900, user }) })
      .mockResolvedValueOnce(noContent);
    await expect(submitLogout('everywhere')).resolves.toEqual({ status: 'signed-out' });
    expect((fetchMock.mock.calls[2]![1] as RequestInit).headers).toMatchObject({ Authorization: 'Bearer jwt-2' });
  });

  it('treats an already-dead session as signed out', async () => {
    fetchMock.mockResolvedValueOnce(problem(401, 'UNAUTHENTICATED')).mockResolvedValueOnce(problem(401, 'UNAUTHENTICATED'));
    await expect(submitLogout('everywhere')).resolves.toEqual({ status: 'signed-out' });
    expect(getSession()).toBeNull();
  });

  it('stays signed in when the server cannot be reached', async () => {
    fetchMock.mockRejectedValue(new TypeError('failed'));
    await expect(submitLogout('everywhere')).resolves.toMatchObject({ status: 'failed' });
    expect(getSession()).not.toBeNull();
  });
});
