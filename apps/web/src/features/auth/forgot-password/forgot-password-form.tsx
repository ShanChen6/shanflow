'use client';

import { useState, type FormEvent } from 'react';
import { FormAlert, SubmitButton, TextField } from '@/shared/ui/form-controls';
import { submitForgotPassword, validateForgotEmail } from './forgot-password.action';

export function ForgotPasswordForm() {
  const [emailError, setEmailError] = useState<string>();
  const [formError, setFormError] = useState<string>();
  const [pending, setPending] = useState(false);
  const [requestedFor, setRequestedFor] = useState<string>();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const email = String(new FormData(event.currentTarget).get('email') ?? '');
    setFormError(undefined);
    if (!validateForgotEmail(email)) {
      setEmailError('Enter a valid email address.');
      return;
    }
    setEmailError(undefined);
    setPending(true);
    try {
      const outcome = await submitForgotPassword(email);
      if (outcome.status === 'requested') setRequestedFor(email.trim());
      else if (outcome.status === 'invalid-email') setEmailError('Enter a valid email address.');
      else setFormError(outcome.message);
    } finally {
      setPending(false);
    }
  }

  if (requestedFor) {
    return (
      <div role="status" className="flex max-w-sm flex-col gap-2">
        <h1 className="text-2xl font-bold">Check your email</h1>
        <p className="text-slate-600">
          If an account exists for {requestedFor}, we sent a link to reset the password. It expires in one hour.
        </p>
        <a href="/login" className="font-medium underline">
          Back to sign in
        </a>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex w-full max-w-sm flex-col gap-4">
      <h1 className="text-2xl font-bold">Forgot your password?</h1>
      <p className="text-slate-600">Enter your email and we will send you a link to choose a new one.</p>
      {formError ? <FormAlert>{formError}</FormAlert> : null}
      <TextField id="email" name="email" label="Email" type="email" autoComplete="email" error={emailError} disabled={pending} />
      <SubmitButton pending={pending} idle="Send reset link" busy="Sending…" />
      <a href="/login" className="text-sm font-medium underline">
        Back to sign in
      </a>
    </form>
  );
}
