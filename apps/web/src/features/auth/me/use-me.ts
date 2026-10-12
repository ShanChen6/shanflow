'use client';

import { useEffect, useState } from 'react';
import type { MeResponse } from '@shanflow/contracts';
import { fetchMe } from '../shared/auth-client';

export type MeState =
  | { state: 'loading' }
  | { state: 'ready'; me: MeResponse }
  | { state: 'error' };

/** Loads the signed-in user's profile and sign-in methods from the server. */
export function useMe(): MeState {
  const [me, setMe] = useState<MeState>({ state: 'loading' });

  useEffect(() => {
    let active = true;
    void fetchMe().then((result) => {
      if (active) setMe(result.ok ? { state: 'ready', me: result.data } : { state: 'error' });
    });
    return () => {
      active = false;
    };
  }, []);

  return me;
}
