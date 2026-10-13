'use client';

import { useRef, useState, type ChangeEvent } from 'react';
import { AVATAR_CONTENT_TYPES, type UserProfile } from '@shanflow/contracts';
import { FormAlert } from '@/shared/ui/form-controls';
import { removeAvatar, uploadAvatar, type AvatarOutcome } from './avatar.action';

function Picture({ profile }: { profile: UserProfile }) {
  if (profile.avatarUrl) {
    // A plain <img>: the URL is API-served or a provider image, not something Next's optimizer should proxy.
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

/** Shows the avatar with controls to replace or remove it. */
export function AvatarEditor({ profile, onChanged }: { profile: UserProfile; onChanged: (profile: UserProfile) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  async function run(action: () => Promise<AvatarOutcome>) {
    if (pending) return;
    setPending(true);
    setError(undefined);
    try {
      const outcome = await action();
      if (outcome.status === 'updated') onChanged(outcome.profile);
      else if (outcome.status === 'error') setError(outcome.message);
    } finally {
      setPending(false);
    }
  }

  function onPick(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    // Reset so choosing the same file again still fires a change event.
    event.currentTarget.value = '';
    if (file) void run(() => uploadAvatar(file));
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <Picture profile={profile} />
        <div className="flex flex-col gap-1 text-sm">
          <input ref={input} type="file" accept={AVATAR_CONTENT_TYPES.join(',')} onChange={onPick} hidden aria-label="Choose a profile picture" />
          <button
            type="button"
            disabled={pending}
            onClick={() => input.current?.click()}
            className="rounded-md border border-slate-300 px-3 py-1 hover:bg-slate-50 disabled:opacity-60"
          >
            {pending ? 'Working…' : profile.avatarUrl ? 'Change picture' : 'Upload picture'}
          </button>
          {profile.avatarUrl ? (
            <button
              type="button"
              disabled={pending}
              onClick={() => void run(removeAvatar)}
              className="text-left text-slate-600 underline disabled:opacity-60"
            >
              Remove picture
            </button>
          ) : null}
        </div>
      </div>
      <p className="text-xs text-slate-500">PNG, JPEG or WebP, up to 2 MB. It is resized to a square.</p>
      {error ? <FormAlert>{error}</FormAlert> : null}
    </div>
  );
}
