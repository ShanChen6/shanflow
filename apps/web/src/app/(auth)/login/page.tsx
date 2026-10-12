import type { Metadata } from 'next';
import { LoginForm } from '@/features/auth/login/login-form';

export const metadata: Metadata = { title: 'Sign in' };

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-12">
      <LoginForm />
    </main>
  );
}
