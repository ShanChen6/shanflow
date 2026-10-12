import type { Metadata } from 'next';
import { AccountView } from './account-view';

export const metadata: Metadata = { title: 'Account' };

export default function AccountPage() {
  return (
    <main className="mx-auto max-w-md px-6 py-12">
      <AccountView />
    </main>
  );
}
