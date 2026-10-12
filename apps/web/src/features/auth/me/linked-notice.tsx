'use client';

import { useSearchParams } from 'next/navigation';

/** Confirms a completed Google link (the API redirects to /account?linked=google). Render inside <Suspense>. */
export function LinkedNotice() {
  if (useSearchParams().get('linked') !== 'google') return null;
  return (
    <p role="status" className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-900">
      Your Google account is now linked. You can sign in with Google.
    </p>
  );
}
