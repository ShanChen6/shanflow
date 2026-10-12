import { refreshSession } from './auth-client';
import { getSession } from './session-store';

export type BootstrapPhase = 'idle' | 'checking' | 'done' | 'unavailable';

// A tiny external store (not component state) so every consumer shares one restore attempt per page load.
let phase: BootstrapPhase = 'idle';
const listeners = new Set<() => void>();

function setPhase(next: BootstrapPhase) {
  phase = next;
  for (const listener of listeners) listener();
}

export function getBootstrapPhase(): BootstrapPhase {
  return phase;
}

export function subscribeToBootstrap(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * The access token lives only in memory, so after a reload the session is restored by exchanging the
 * refresh cookie. Safe to call repeatedly: it does nothing while a session exists or a check is running.
 */
export function restoreSession(): void {
  if (getSession() || phase === 'checking') return;
  setPhase('checking');
  void refreshSession().then((outcome) => setPhase(outcome.status === 'unavailable' ? 'unavailable' : 'done'));
}

/**
 * Called by sign-out before the session is cleared: the user is known to be signed out, so mounted
 * pages must redirect immediately instead of trying to restore a session that was just revoked.
 */
export function markSignedOut(): void {
  setPhase('done');
}

/** Test helper: forget any previous restore attempt. */
export function resetBootstrap(): void {
  phase = 'idle';
}
