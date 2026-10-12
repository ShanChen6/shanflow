'use client';

import { useState, type FormEvent } from 'react';
import { FormAlert, SubmitButton, TextField } from '@/shared/ui/form-controls';
import { submitPasswordChange, validateChange, type ChangeFieldErrors } from './change-password.action';

export function ChangePasswordForm() {
  const [errors, setErrors] = useState<ChangeFieldErrors>({});
  const [formError, setFormError] = useState<string>();
  const [pending, setPending] = useState(false);
  const [changed, setChanged] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const input = { currentPassword: String(data.get('currentPassword') ?? ''), newPassword: String(data.get('newPassword') ?? '') };
    const clientErrors = validateChange(input);
    setErrors(clientErrors);
    setFormError(undefined);
    setChanged(false);
    if (Object.keys(clientErrors).length > 0) return;

    setPending(true);
    try {
      const outcome = await submitPasswordChange(input.currentPassword, input.newPassword);
      if (outcome.status === 'changed') {
        form.reset();
        setChanged(true);
      } else if (outcome.status === 'error') {
        setErrors(outcome.fieldErrors);
        setFormError(outcome.formError);
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex max-w-sm flex-col gap-4">
      <h2 className="text-lg font-semibold">Change password</h2>
      {changed ? (
        <p role="status" className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-900">
          Password changed. Your other devices were signed out.
        </p>
      ) : null}
      {formError ? <FormAlert>{formError}</FormAlert> : null}
      <TextField id="currentPassword" name="currentPassword" label="Current password" type="password" autoComplete="current-password" error={errors.currentPassword} disabled={pending} />
      <TextField id="newPassword" name="newPassword" label="New password" type="password" autoComplete="new-password" hint="At least 12 characters." error={errors.newPassword} disabled={pending} />
      <SubmitButton pending={pending} idle="Change password" busy="Changing…" />
    </form>
  );
}
