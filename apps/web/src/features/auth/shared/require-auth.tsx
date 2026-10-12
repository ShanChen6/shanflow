'use client';

import { useEffect, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStatus } from '../session/use-auth-status';

/** UX gate only: the API enforces authentication on every request regardless of what the page shows. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const router = useRouter();
  const status = useAuthStatus();

  useEffect(() => {
    if (status.state === 'unauthenticated') router.replace('/login');
  }, [status.state, router]);

  if (status.state === 'authenticated') return <>{children}</>;
  if (status.state === 'unavailable') {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-3 px-6">
        <p role="alert">Could not reach the server.</p>
        <button type="button" onClick={status.retry} className="rounded-md bg-slate-900 px-4 py-2 font-medium text-white">
          Try again
        </button>
      </main>
    );
  }
  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <p role="status" className="text-slate-600">
        Loading…
      </p>
    </main>
  );
}
