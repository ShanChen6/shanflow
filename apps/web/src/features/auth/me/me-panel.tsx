'use client';

import { useEffect, useState } from 'react';
import type { MeResponse } from '@shanflow/contracts';
import { fetchMe } from '../shared/auth-client';
import { useSession } from '../shared/session-store';

type MeState = { state: 'loading' } | { state: 'ready'; user: MeResponse['user'] } | { state: 'error' };

export function MePanel() {
  // Show what the session already knows immediately, then confirm with the server.
  const session = useSession();
  const [me, setMe] = useState<MeState>({ state: 'loading' });

  useEffect(() => {
    let active = true;
    void fetchMe().then((result) => {
      if (active) setMe(result.ok ? { state: 'ready', user: result.data.user } : { state: 'error' });
    });
    return () => {
      active = false;
    };
  }, []);

  const user = me.state === 'ready' ? me.user : session?.user;
  return (
    <section className="flex flex-col gap-2">
      <h1 className="text-2xl font-bold">Account</h1>
      {user ? (
        <dl className="text-slate-700">
          <dt className="font-medium">Name</dt>
          <dd>{user.displayName}</dd>
          <dt className="mt-2 font-medium">Email</dt>
          <dd>
            {user.email} {user.emailVerified ? null : <span className="text-amber-700">(not verified)</span>}
          </dd>
        </dl>
      ) : null}
      {me.state === 'error' ? <p role="alert" className="text-sm text-red-700">Could not refresh your profile.</p> : null}
    </section>
  );
}
