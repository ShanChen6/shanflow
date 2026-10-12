'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { useSession, type Session } from '../shared/session-store';
import { getBootstrapPhase, restoreSession, subscribeToBootstrap } from './bootstrap-store';

export type AuthStatus =
  | { state: 'loading' }
  | { state: 'authenticated'; session: Session }
  | { state: 'unauthenticated' }
  /** The server could not be reached; the user may still have a valid session. */
  | { state: 'unavailable'; retry: () => void };

export function useAuthStatus(): AuthStatus {
  const session = useSession();
  const phase = useSyncExternalStore(subscribeToBootstrap, getBootstrapPhase, () => 'idle' as const);

  useEffect(() => {
    if (!session && phase === 'idle') restoreSession();
  }, [session, phase]);

  if (session) return { state: 'authenticated', session };
  if (phase === 'done') return { state: 'unauthenticated' };
  if (phase === 'unavailable') return { state: 'unavailable', retry: restoreSession };
  return { state: 'loading' };
}
