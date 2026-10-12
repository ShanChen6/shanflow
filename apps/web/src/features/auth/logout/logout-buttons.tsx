'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { submitLogout, type LogoutScope } from './logout.action';

export function LogoutButtons() {
  const router = useRouter();
  const [pending, setPending] = useState<LogoutScope>();
  const [error, setError] = useState<string>();

  async function signOut(scope: LogoutScope) {
    if (pending) return;
    setPending(scope);
    setError(undefined);
    const outcome = await submitLogout(scope);
    if (outcome.status === 'signed-out') {
      router.replace('/login');
      return;
    }
    setError(outcome.message);
    setPending(undefined);
  }

  return (
    <div className="flex flex-col gap-2">
      {error ? (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending !== undefined}
          onClick={() => void signOut('device')}
          className="rounded-md bg-brand-500 px-4 py-2 font-medium text-brand-ink disabled:opacity-60"
        >
          {pending === 'device' ? 'Signing out…' : 'Sign out'}
        </button>
        <button
          type="button"
          disabled={pending !== undefined}
          onClick={() => void signOut('everywhere')}
          className="rounded-md border border-slate-300 px-4 py-2 font-medium disabled:opacity-60"
        >
          {pending === 'everywhere' ? 'Signing out…' : 'Sign out of all devices'}
        </button>
      </div>
    </div>
  );
}
