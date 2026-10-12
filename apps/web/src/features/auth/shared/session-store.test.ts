import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearSession, getSession, setSession, subscribeToSession, type Session } from './session-store';

const session: Session = {
  accessToken: 'jwt',
  expiresAt: 123,
  user: { id: '0b1f7a4e-3c1d-4a6e-9b6a-2f1c8d0e5a11', email: 'a@b.io', displayName: 'A', emailVerified: false },
};

afterEach(() => clearSession());

describe('session store', () => {
  it('starts empty and holds the session in memory only', () => {
    expect(getSession()).toBeNull();
    setSession(session);
    expect(getSession()).toBe(session);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it('notifies subscribers on set and clear, but not on a redundant clear', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToSession(listener);
    setSession(session);
    clearSession();
    clearSession();
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    setSession(session);
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
