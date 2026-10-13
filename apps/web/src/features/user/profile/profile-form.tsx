'use client';

import { useState, type FormEvent } from 'react';
import type { UserProfile } from '@shanflow/contracts';
import { FormAlert, SubmitButton } from '@/shared/ui/form-controls';
import { submitDisplayName, validateDisplayName } from './profile.action';

/** Edits the display name, the only profile field a user can change here. */
export function ProfileForm({ profile, onSaved }: { profile: UserProfile; onSaved: (profile: UserProfile) => void }) {
  const [nameError, setNameError] = useState<string>();
  const [formError, setFormError] = useState<string>();
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const displayName = String(new FormData(event.currentTarget).get('displayName') ?? '');
    setSaved(false);
    setFormError(undefined);
    const clientError = validateDisplayName(displayName);
    setNameError(clientError);
    if (clientError) return;

    setPending(true);
    try {
      const outcome = await submitDisplayName(displayName);
      if (outcome.status === 'updated') {
        onSaved(outcome.profile);
        setSaved(true);
      } else if (outcome.status === 'error') {
        setNameError(outcome.nameError);
        setFormError(outcome.formError);
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex max-w-sm flex-col gap-4">
      <h2 className="text-lg font-semibold">Your name</h2>
      {saved ? (
        <p role="status" className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-900">
          Name updated.
        </p>
      ) : null}
      {formError ? <FormAlert>{formError}</FormAlert> : null}
      {/* Keyed by the saved value so the field shows the normalised name the server stored. */}
      <ProfileNameField key={profile.displayName} initial={profile.displayName} error={nameError} disabled={pending} />
      <SubmitButton pending={pending} idle="Save name" busy="Saving…" />
    </form>
  );
}

function ProfileNameField({ initial, error, disabled }: { initial: string; error?: string; disabled: boolean }) {
  return (
    <div>
      <label htmlFor="displayName" className="mb-1 block text-sm font-medium">
        Display name
      </label>
      <input
        id="displayName"
        name="displayName"
        type="text"
        autoComplete="name"
        defaultValue={initial}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? 'displayName-error' : undefined}
        className="w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-brand-500 focus:outline-none aria-[invalid=true]:border-red-600"
      />
      {error ? (
        <p id="displayName-error" className="mt-1 text-sm text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
