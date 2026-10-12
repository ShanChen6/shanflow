import type { Metadata } from 'next';
import { Suspense } from 'react';
import { VerifyEmailPanel } from '@/features/auth/verify-email/verify-email-panel';

export const metadata: Metadata = { title: 'Confirm email' };

export default function VerifyEmailPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-12">
      <Suspense>
        <VerifyEmailPanel />
      </Suspense>
    </main>
  );
}
