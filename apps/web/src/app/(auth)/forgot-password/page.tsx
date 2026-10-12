import type { Metadata } from 'next';
import { ForgotPasswordForm } from '@/features/auth/forgot-password/forgot-password-form';

export const metadata: Metadata = { title: 'Forgot password' };

export default function ForgotPasswordPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-12">
      <ForgotPasswordForm />
    </main>
  );
}
