'use client';

import type { UserProfile } from '@shanflow/contracts';
import { ProfileForm } from './profile-form';
import { useProfile } from './use-profile';

function Avatar({ profile }: { profile: UserProfile }) {
  if (profile.avatarUrl) {
    // A plain <img>: the URL is an API-served or provider image, not something Next's optimizer should proxy.
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={profile.avatarUrl} alt="" referrerPolicy="no-referrer" className="h-16 w-16 rounded-full object-cover" />;
  }
  const initial = Array.from(profile.displayName)[0]?.toUpperCase() ?? '?';
  return (
    <span aria-hidden className="flex h-16 w-16 items-center justify-center rounded-full bg-slate-200 text-2xl font-semibold text-slate-700">
      {initial}
    </span>
  );
}

export function ProfileView() {
  const profile = useProfile();

  if (profile.state === 'loading') {
    return (
      <p role="status" className="text-slate-600">
        Loading…
      </p>
    );
  }
  if (profile.state === 'error') {
    return (
      <p role="alert" className="text-red-700">
        Could not load your profile. Please reload the page.
      </p>
    );
  }

  const { profile: current } = profile;
  return (
    <div className="flex flex-col gap-8">
      <section className="flex items-center gap-4">
        <Avatar profile={current} />
        <div>
          <h1 className="text-2xl font-bold">{current.displayName}</h1>
          <p className="text-slate-700">
            {current.email} {current.emailVerified ? null : <span className="text-amber-700">(not verified)</span>}
          </p>
          <p className="text-sm text-slate-500">Member since {new Date(current.createdAt).toLocaleDateString('en', { dateStyle: 'long' })}</p>
        </div>
      </section>
      <ProfileForm profile={current} onSaved={profile.replace} />
    </div>
  );
}
