'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import { PASSWORD_MIN_LENGTH } from '@shanflow/contracts';
import { FormAlert, SubmitButton, TextField } from '@/shared/ui/form-controls';
import { isPlausibleToken } from '../shared/token';
import { submitPasswordReset, validateNewPassword } from './reset-password.action';

type Errors = { newPassword?: string; confirm?: string };

export function ResetPasswordForm() {
  const params = useSearchParams();
  const [token] = useState(() => params.get('token'));
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string>();
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [invalidLink, setInvalidLink] = useState(false);

  useEffect(() => {
    // The link is a credential: keep it out of history and out of the Referer of anything this page loads.
    window.history.replaceState(null, '', window.location.pathname);
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || !isPlausibleToken(token)) return;
    const data = new FormData(event.currentTarget);
    const newPassword = String(data.get('newPassword') ?? '');
    const confirm = String(data.get('confirm') ?? '');
    const next: Errors = {};
    if (!validateNewPassword(newPassword)) next.newPassword = `Use ${PASSWORD_MIN_LENGTH} to 128 characters.`;
    else if (confirm !== newPassword) next.confirm = 'The passwords do not match.';
    setErrors(next);
    setFormError(undefined);
    if (Object.keys(next).length > 0) return;

    setPending(true);
    try {
      const outcome = await submitPasswordReset(token, newPassword);
      if (outcome.status === 'reset') setDone(true);
      else if (outcome.status === 'invalid-token') setInvalidLink(true);
      else if (outcome.status === 'weak-password') setErrors({ newPassword: `Use ${PASSWORD_MIN_LENGTH} to 128 characters.` });
      else setFormError(outcome.message);
    } finally {
      setPending(false);
    }
  }

  if (done) {
    return (
      <div role="status" className="flex max-w-sm flex-col gap-2">
        <h1 className="text-2xl font-bold">Password updated</h1>
        <p className="text-slate-600">Your password was changed and you were signed out everywhere. Sign in with the new password.</p>
        <a href="/login" className="font-medium underline">
          Sign in
        </a>
      </div>
    );
  }

  if (!isPlausibleToken(token) || invalidLink) {
    return (
      <div className="flex max-w-sm flex-col gap-2">
        <h1 className="text-2xl font-bold">This link is not valid</h1>
        <p className="text-slate-600">It may have expired or already been used.</p>
        <a href="/forgot-password" className="font-medium underline">
          Request a new link
        </a>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex w-full max-w-sm flex-col gap-4">
      <h1 className="text-2xl font-bold">Choose a new password</h1>
      {formError ? <FormAlert>{formError}</FormAlert> : null}
      <TextField
        id="newPassword"
        name="newPassword"
        label="New password"
        type="password"
        autoComplete="new-password"
        hint={`At least ${PASSWORD_MIN_LENGTH} characters.`}
        error={errors.newPassword}
        disabled={pending}
      />
      <TextField id="confirm" name="confirm" label="Confirm new password" type="password" autoComplete="new-password" error={errors.confirm} disabled={pending} />
      <SubmitButton pending={pending} idle="Update password" busy="Updating…" />
    </form>
  );
}
