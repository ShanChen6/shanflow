import type { Metadata } from 'next';
import { GoogleButton } from '@/features/auth/google/google-button';
import { RegisterForm } from '@/features/auth/register/register-form';

export const metadata: Metadata = { title: 'Create account' };

export default function RegisterPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-12">
      <div className="flex w-full max-w-sm flex-col gap-4">
        <RegisterForm />
        <GoogleButton label="Sign up with Google" />
      </div>
    </main>
  );
}
