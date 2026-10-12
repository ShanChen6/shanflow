'use client';

import { Suspense } from 'react';
import { ChangePasswordForm } from '@/features/auth/change-password/change-password-form';
import { LinkGoogleForm } from '@/features/auth/google/link-google-form';
import { LogoutButtons } from '@/features/auth/logout/logout-buttons';
import { LinkedNotice } from '@/features/auth/me/linked-notice';
import { MeSummary } from '@/features/auth/me/me-summary';
import { useMe } from '@/features/auth/me/use-me';
import { ResendVerification } from '@/features/auth/verify-email/resend-verification';

/**
 * Composes the account page from independent feature slices. Slices do not import each other, so this
 * layer decides what to show from the server's view of the account.
 */
export function AccountView() {
  const me = useMe();
  const ready = me.state === 'ready' ? me.me : undefined;
  const googleLinked = ready?.security.linkedProviders.includes('google') ?? false;

  return (
    <div className="flex flex-col gap-8">
      <Suspense>
        <LinkedNotice />
      </Suspense>
      <MeSummary me={me} />
      {ready && !ready.user.emailVerified ? <ResendVerification /> : null}
      {ready?.security.hasPassword ? <ChangePasswordForm /> : null}
      {ready?.security.hasPassword && !googleLinked ? <LinkGoogleForm /> : null}
      {ready && !ready.security.hasPassword ? (
        <p className="text-sm text-slate-600">
          This account signs in with Google. To add a password, use <a href="/forgot-password" className="font-medium underline">Forgot password</a>.
        </p>
      ) : null}
      <LogoutButtons />
    </div>
  );
}
