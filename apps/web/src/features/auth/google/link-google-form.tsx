'use client';

import { useState, type FormEvent } from 'react';
import { FormAlert, SubmitButton, TextField } from '@/shared/ui/form-controls';
import { startGoogleLink } from './google.action';

/** Linking needs the password again, so a stolen access token alone cannot attach someone else's Google account. */
export function LinkGoogleForm() {
  const [passwordError, setPasswordError] = useState<string>();
  const [formError, setFormError] = useState<string>();
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const password = String(new FormData(event.currentTarget).get('password') ?? '');
    setFormError(undefined);
    if (password === '') {
      setPasswordError('Enter your current password.');
      return;
    }
    setPasswordError(undefined);
    setPending(true);
    const outcome = await startGoogleLink(password);
    if (outcome.status === 'redirect') {
      // Leaves the app for Google; the button stays disabled until the browser navigates away.
      window.location.assign(outcome.url);
      return;
    }
    setPending(false);
    if (outcome.status === 'error') {
      setPasswordError(outcome.passwordError);
      setFormError(outcome.formError);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex max-w-sm flex-col gap-4">
      <h2 className="text-lg font-semibold">Link your Google account</h2>
      <p className="text-sm text-slate-600">Confirm your password, then choose the Google account to link.</p>
      {formError ? <FormAlert>{formError}</FormAlert> : null}
      <TextField id="link-password" name="password" label="Current password" type="password" autoComplete="current-password" error={passwordError} disabled={pending} />
      <SubmitButton pending={pending} idle="Link Google account" busy="Redirecting…" />
    </form>
  );
}
