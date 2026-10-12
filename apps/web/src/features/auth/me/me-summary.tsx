'use client';

import { useSession } from '../shared/session-store';
import type { MeState } from './use-me';

const PROVIDER_LABELS: Record<string, string> = { google: 'Google' };

/** Account details. Shows what the session already knows at once, then the server's answer. */
export function MeSummary({ me }: { me: MeState }) {
  const session = useSession();
  const user = me.state === 'ready' ? me.me.user : session?.user;
  const methods =
    me.state === 'ready'
      ? [
          ...(me.me.security.hasPassword ? ['Password'] : []),
          ...me.me.security.linkedProviders.map((provider) => PROVIDER_LABELS[provider] ?? provider),
        ]
      : [];

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
          {methods.length > 0 ? (
            <>
              <dt className="mt-2 font-medium">Sign-in methods</dt>
              <dd>{methods.join(', ')}</dd>
            </>
          ) : null}
        </dl>
      ) : null}
      {me.state === 'error' ? (
        <p role="alert" className="text-sm text-red-700">
          Could not refresh your profile.
        </p>
      ) : null}
    </section>
  );
}
