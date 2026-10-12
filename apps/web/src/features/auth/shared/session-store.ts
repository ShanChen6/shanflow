import { useSyncExternalStore } from 'react';
import type { AuthUser } from '@shanflow/contracts';

export interface Session {
  accessToken: string;
  /** Epoch milliseconds when the access token stops being valid. */
  expiresAt: number;
  user: AuthUser;
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
