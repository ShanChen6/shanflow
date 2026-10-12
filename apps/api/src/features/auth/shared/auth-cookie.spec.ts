import {
  clearRefreshCookie,
  readCookie,
  REFRESH_COOKIE_NAME,
  REFRESH_COOKIE_PATH,
  setRefreshCookie,
} from './auth-cookie.js';

function fakeResponse() {
  const calls: Array<[string, ...unknown[]]> = [];
  return {
    calls,
    cookie: (...args: unknown[]) => calls.push(['cookie', ...args]),
    clearCookie: (...args: unknown[]) => calls.push(['clearCookie', ...args]),
  };
}

describe('refresh cookie', () => {
  const expiresAt = new Date('2026-11-11T00:00:00Z');

  it('is HttpOnly, SameSite=Strict and scoped to /auth', () => {
    const response = fakeResponse();
    setRefreshCookie(response as never, 'secret', expiresAt, {
      secure: true,
      domain: 'example.com',
    });
    expect(response.calls).toEqual([
      [
        'cookie',
        REFRESH_COOKIE_NAME,
        'secret',
        {
          httpOnly: true,
          secure: true,
          sameSite: 'strict',
          path: REFRESH_COOKIE_PATH,
          domain: 'example.com',
          expires: expiresAt,
        },
      ],
    ]);
  });

  it('omits the domain when not configured and honours the secure flag', () => {
    const response = fakeResponse();
    setRefreshCookie(response as never, 'secret', expiresAt, { secure: false });
    expect(response.calls[0]?.[3]).toEqual({
      httpOnly: true,
      secure: false,
      sameSite: 'strict',
      path: '/auth',
      expires: expiresAt,
    });
  });

  it('clears with the same attributes so the browser matches the cookie', () => {
    const response = fakeResponse();
    clearRefreshCookie(response as never, { secure: true });
    expect(response.calls).toEqual([
      [
        'clearCookie',
        REFRESH_COOKIE_NAME,
        { httpOnly: true, secure: true, sameSite: 'strict', path: '/auth' },
      ],
    ]);
  });
});

describe('readCookie', () => {
  it('finds the named cookie among others', () => {
    expect(
      readCookie('a=1; shanflow_refresh=tok-en_1; b=2', 'shanflow_refresh'),
    ).toBe('tok-en_1');
    expect(readCookie('shanflow_refresh=abc', 'shanflow_refresh')).toBe('abc');
  });

  it('does not match a cookie whose name merely contains the target', () => {
    expect(
      readCookie(
        'x_shanflow_refresh=evil; shanflow_refresh_2=evil',
        'shanflow_refresh',
      ),
    ).toBeUndefined();
  });

  it('returns undefined for a missing header, missing cookie or empty value', () => {
    expect(readCookie(undefined, 'shanflow_refresh')).toBeUndefined();
    expect(readCookie('', 'shanflow_refresh')).toBeUndefined();
    expect(readCookie('other=1', 'shanflow_refresh')).toBeUndefined();
    expect(readCookie('shanflow_refresh=', 'shanflow_refresh')).toBeUndefined();
    expect(readCookie('malformed', 'shanflow_refresh')).toBeUndefined();
  });

  it('uses the first occurrence when a name is repeated', () => {
    expect(
      readCookie(
        'shanflow_refresh=first; shanflow_refresh=second',
        'shanflow_refresh',
      ),
    ).toBe('first');
  });
});
