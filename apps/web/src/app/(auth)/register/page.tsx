import type { Metadata } from 'next';
import { RegisterForm } from '@/features/auth/register/register-form';

export const metadata: Metadata = { title: 'Create account' };

export default function RegisterPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-12">
      <RegisterForm />
    </main>
  );
}
