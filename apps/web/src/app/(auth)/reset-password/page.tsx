import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ResetPasswordForm } from '@/features/auth/reset-password/reset-password-form';

export const metadata: Metadata = { title: 'Reset password' };

export default function ResetPasswordPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-12">
      <Suspense>
        <ResetPasswordForm />
      </Suspense>
    </main>
  );
}
