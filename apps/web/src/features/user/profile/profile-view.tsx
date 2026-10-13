'use client';

import { AvatarEditor } from '../avatar/avatar-editor';
import { ProfileForm } from './profile-form';
import { useProfile } from './use-profile';

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
      <section className="flex flex-col gap-4">
        <AvatarEditor profile={current} onChanged={profile.replace} />
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
