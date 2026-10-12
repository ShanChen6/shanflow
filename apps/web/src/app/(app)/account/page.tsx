import type { Metadata } from 'next';
import { LogoutButtons } from '@/features/auth/logout/logout-buttons';
import { MePanel } from '@/features/auth/me/me-panel';

export const metadata: Metadata = { title: 'Account' };

export default function AccountPage() {
  return (
    <main className="mx-auto max-w-md px-6 py-12">
      <div className="flex flex-col gap-6">
        <MePanel />
        <LogoutButtons />
      </div>
    </main>
  );
}
