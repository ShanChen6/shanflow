import { useSyncExternalStore } from 'react';
import type { AuthUser, LoginResponse } from '@shanflow/contracts';

export interface Session {
  accessToken: string;
  /** Epoch milliseconds when the access token stops being valid. */
  expiresAt: number;
  user: AuthUser;
}

/** Converts a login/refresh response into a session with an absolute expiry. */
export function sessionFromResponse(response: LoginResponse, now = Date.now()): Session {
  return { accessToken: response.accessToken, expiresAt: now + response.expiresIn * 1000, user: response.user };
}

// Kept in module memory only: never localStorage/sessionStorage, so XSS cannot read a persisted token
// and a reload starts unauthenticated until the refresh cookie restores the session.
let current: Session | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

export function getSession(): Session | null {
  return current;
}

export function setSession(session: Session): void {
  current = session;
  notify();
}

export function clearSession(): void {
  if (current === null) return;
  current = null;
  notify();
}

export function subscribeToSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSession(): Session | null {
  return useSyncExternalStore(subscribeToSession, getSession, () => null);
}
