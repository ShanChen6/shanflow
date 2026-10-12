import type { Metadata } from 'next';
import { SettingsView } from '@/features/user/settings/settings-view';

export const metadata: Metadata = { title: 'Settings' };

export default function SettingsPage() {
  return (
    <main className="mx-auto max-w-md px-6 py-12">
      <SettingsView />
    </main>
  );
}
