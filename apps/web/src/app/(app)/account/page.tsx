import type { Metadata } from 'next';
import { MePanel } from '@/features/auth/me/me-panel';

export const metadata: Metadata = { title: 'Account' };

export default function AccountPage() {
  return (
    <main className="mx-auto max-w-md px-6 py-12">
      <MePanel />
    </main>
  );
}
