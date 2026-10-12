import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authedGetJson, fetchMe, refreshSession } from './auth-client';
import { clearSession, getSession, setSession, type Session } from './session-store';

const user = { id: '0b1f7a4e-3c1d-4a6e-9b6a-2f1c8d0e5a11', email: 'ann@example.invalid', displayName: 'Ann', emailVerified: false };
const security = { hasPassword: true, linkedProviders: [] };
const refreshBody = { accessToken: 'jwt-new', tokenType: 'Bearer', expiresIn: 900, user };
const unauthenticated = { type: 't', title: 'x', status: 401, code: 'UNAUTHENTICATED' };

const reply = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body });
const stale = (overrides: Partial<Session> = {}): Session => ({ accessToken: 'jwt-old', expiresAt: Date.now() + 600_000, user, ...overrides });

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  clearSession();
});

describe('refreshSession', () => {
  it('posts with the CSRF marker, credentials and no body, and stores the new session', async () => {
    fetchMock.mockResolvedValue(reply(200, refreshBody));
    const outcome = await refreshSession();
    expect(outcome).toMatchObject({ status: 'ok', session: { accessToken: 'jwt-new', user } });
    expect(getSession()?.accessToken).toBe('jwt-new');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:3001/auth/refresh');
    expect(init).toMatchObject({ method: 'POST', credentials: 'include', body: undefined, keepalive: true });
    expect(init.headers).toMatchObject({ 'X-Requested-With': 'shanflow' });
  });

  it('shares one request between concurrent callers (single-flight)', async () => {
    let finish: (value: unknown) => void = () => {};
    fetchMock.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const calls = [refreshSession(), refreshSession(), refreshSession()];
    finish(reply(200, refreshBody));
    const outcomes = await Promise.all(calls);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(new Set(outcomes).size).toBe(1);
    // After completion a new call starts a new request.
    fetchMock.mockResolvedValue(reply(200, refreshBody));
    await refreshSession();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('runs inside a cross-tab Web Lock when available', async () => {
    const request = vi.fn((_name: string, task: () => Promise<unknown>) => task());
    vi.stubGlobal('navigator', { locks: { request } });
    fetchMock.mockResolvedValue(reply(200, refreshBody));
    await refreshSession();
    expect(request).toHaveBeenCalledWith('shanflow-refresh', expect.any(Function));
  });

  it('signs out and clears the session when the server rejects the token', async () => {
    setSession(stale());
    fetchMock.mockResolvedValue(reply(401, unauthenticated));
    await expect(refreshSession()).resolves.toEqual({ status: 'signed-out' });
    expect(getSession()).toBeNull();
  });

  it.each([
    ['throttling', () => fetchMock.mockResolvedValue(reply(429, { type: 't', title: 'x', status: 429, code: 'TOO_MANY_REQUESTS' }))],
    ['a network failure', () => fetchMock.mockRejectedValue(new TypeError('failed'))],
    ['a malformed response', () => fetchMock.mockResolvedValue(reply(200, { nope: true }))],
  ])('keeps the session and reports unavailable on %s', async (_name, arrange) => {
    const existing = stale();
    setSession(existing);
    arrange();
    await expect(refreshSession()).resolves.toEqual({ status: 'unavailable' });
    expect(getSession()).toBe(existing);
  });
});

describe('authedGetJson', () => {
  it('sends the in-memory token without refreshing while it is fresh', async () => {
    setSession(stale());
    fetchMock.mockResolvedValue(reply(200, { user, security }));
    const result = await fetchMe();
    expect(result).toEqual({ ok: true, data: { user, security } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:3001/auth/me');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer jwt-old' });
    expect(init.headers).not.toHaveProperty('X-Requested-With');
  });

  it('refreshes first when there is no session or the token is about to expire', async () => {
    fetchMock.mockResolvedValueOnce(reply(200, refreshBody)).mockResolvedValueOnce(reply(200, { user, security }));
    await expect(fetchMe()).resolves.toMatchObject({ ok: true });
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual(['http://localhost:3001/auth/refresh', 'http://localhost:3001/auth/me']);
    expect((fetchMock.mock.calls[1]![1] as RequestInit).headers).toMatchObject({ Authorization: 'Bearer jwt-new' });

    setSession(stale({ expiresAt: Date.now() + 5_000 }));
    fetchMock.mockResolvedValueOnce(reply(200, { ...refreshBody, accessToken: 'jwt-newer' })).mockResolvedValueOnce(reply(200, { user, security }));
    await fetchMe();
    expect((fetchMock.mock.calls[3]![1] as RequestInit).headers).toMatchObject({ Authorization: 'Bearer jwt-newer' });
  });

  it('retries exactly once with a refreshed token after a 401', async () => {
    setSession(stale());
    fetchMock
      .mockResolvedValueOnce(reply(401, unauthenticated))
      .mockResolvedValueOnce(reply(200, refreshBody))
      .mockResolvedValueOnce(reply(200, { user, security }));
    await expect(fetchMe()).resolves.toMatchObject({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect((fetchMock.mock.calls[2]![1] as RequestInit).headers).toMatchObject({ Authorization: 'Bearer jwt-new' });
  });

  it('does not loop: a second 401 after refreshing is returned to the caller', async () => {
    setSession(stale());
    fetchMock
      .mockResolvedValueOnce(reply(401, unauthenticated))
      .mockResolvedValueOnce(reply(200, refreshBody))
      .mockResolvedValueOnce(reply(401, unauthenticated));
    await expect(fetchMe()).resolves.toMatchObject({ ok: false, kind: 'problem' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('reports signed-out when the refresh is rejected, and unavailable when it cannot be tried', async () => {
    fetchMock.mockResolvedValueOnce(reply(401, unauthenticated));
    await expect(fetchMe()).resolves.toEqual({ ok: false, kind: 'signed-out' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockRejectedValueOnce(new TypeError('failed'));
    await expect(fetchMe()).resolves.toEqual({ ok: false, kind: 'unavailable' });
  });

  it('passes through non-auth problems without refreshing', async () => {
    setSession(stale());
    fetchMock.mockResolvedValue(reply(500, { type: 't', title: 'x', status: 500, code: 'INTERNAL_ERROR' }));
    await expect(authedGetJson('/auth/me', (await import('@shanflow/contracts')).meResponseSchema)).resolves.toMatchObject({ ok: false, kind: 'problem' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
