import type { Metadata } from 'next';
import { Suspense } from 'react';
import { GoogleButton } from '@/features/auth/google/google-button';
import { OAuthErrorBanner } from '@/features/auth/google/oauth-error-banner';
import { LoginForm } from '@/features/auth/login/login-form';

export const metadata: Metadata = { title: 'Sign in' };

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-12">
      <div className="flex w-full max-w-sm flex-col gap-4">
        <Suspense>
          <OAuthErrorBanner />
        </Suspense>
        <LoginForm />
        <GoogleButton />
      </div>
    </main>
  );
}
