import type { Metadata } from 'next';
import { ProfileView } from '@/features/user/profile/profile-view';

export const metadata: Metadata = { title: 'Profile' };

export default function ProfilePage() {
  return (
    <main className="mx-auto max-w-md px-6 py-12">
      <ProfileView />
    </main>
  );
}
