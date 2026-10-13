'use client';

import { useEffect, useState } from 'react';
import type { UserProfile } from '@shanflow/contracts';
import { loadProfile } from './profile.action';

export type ProfileState =
  | { state: 'loading' }
  | { state: 'ready'; profile: UserProfile }
  | { state: 'error' };

/** Loads the signed-in user's profile. `replace` swaps in a profile the server just returned. */
export function useProfile(): ProfileState & { replace: (profile: UserProfile) => void } {
  const [value, setValue] = useState<ProfileState>({ state: 'loading' });

  useEffect(() => {
    let active = true;
    void loadProfile().then((result) => {
      // A signed-out result clears the session, so RequireAuth takes over; nothing to show here.
      if (active) setValue(result.status === 'ready' ? { state: 'ready', profile: result.profile } : { state: 'error' });
    });
    return () => {
      active = false;
    };
  }, []);

  return { ...value, replace: (profile) => setValue({ state: 'ready', profile }) };
}
