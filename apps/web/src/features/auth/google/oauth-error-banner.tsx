'use client';

import { useSearchParams } from 'next/navigation';
import { messageForOAuthError } from './oauth-messages';

/** Shows why a Google sign-in redirect ended on the sign-in page. Render inside <Suspense>. */
export function OAuthErrorBanner() {
  const message = messageForOAuthError(useSearchParams().get('error'));
  if (!message) return null;
  return (
    <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
      {message}
    </p>
  );
}
