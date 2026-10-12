'use client';

import { useState, type FormEvent } from 'react';
import { PASSWORD_MIN_LENGTH } from '@shanflow/contracts';
import {
  submitRegistration,
  validateRegistration,
  type RegisterFieldErrors,
  type RegisterField,
} from './register.action';

const inputClass =
  'w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-slate-900 focus:outline-none aria-[invalid=true]:border-red-600';

export function RegisterForm() {
  const [errors, setErrors] = useState<RegisterFieldErrors>({});
  const [formError, setFormError] = useState<string>();
  const [pending, setPending] = useState(false);
  const [registeredEmail, setRegisteredEmail] = useState<string>();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const data = new FormData(event.currentTarget);
    const input = {
      email: String(data.get('email') ?? ''),
      password: String(data.get('password') ?? ''),
      displayName: String(data.get('displayName') ?? ''),
    };
    const clientErrors = validateRegistration(input);
    setFormError(undefined);
    setErrors(clientErrors);
    if (Object.keys(clientErrors).length > 0) return;

    setPending(true);
    try {
      const outcome = await submitRegistration(input);
      if (outcome.status === 'success') {
        setRegisteredEmail(outcome.user.email);
        return;
      }
      setErrors(outcome.fieldErrors);
      setFormError(outcome.formError);
    } finally {
      setPending(false);
    }
  }

  if (registeredEmail) {
    return (
      <div role="status" className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold">Account created</h1>
        <p className="text-slate-600">
          {registeredEmail} is registered.
        </p>
        <a href="/login" className="font-medium underline">
          Continue to sign in
        </a>
      </div>
    );
  }

  const field = (name: RegisterField) => ({
    name,
    'aria-invalid': errors[name] ? true : undefined,
    'aria-describedby': errors[name] ? `${name}-error` : undefined,
    className: inputClass,
    disabled: pending,
  });
  const fieldError = (name: RegisterField) =>
    errors[name] ? (
      <p id={`${name}-error`} className="mt-1 text-sm text-red-700">
        {errors[name]}
      </p>
    ) : null;

  return (
    <form onSubmit={onSubmit} noValidate className="flex w-full max-w-sm flex-col gap-4">
      <h1 className="text-2xl font-bold">Create your account</h1>
      {formError ? (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          {formError}
        </p>
      ) : null}
      <div>
        <label htmlFor="displayName" className="mb-1 block text-sm font-medium">
          Name
        </label>
        <input id="displayName" type="text" autoComplete="name" {...field('displayName')} />
        {fieldError('displayName')}
      </div>
      <div>
        <label htmlFor="email" className="mb-1 block text-sm font-medium">
          Email
        </label>
        <input id="email" type="email" autoComplete="email" {...field('email')} />
        {fieldError('email')}
      </div>
      <div>
        <label htmlFor="password" className="mb-1 block text-sm font-medium">
          Password
        </label>
        <input id="password" type="password" autoComplete="new-password" {...field('password')} />
        <p className="mt-1 text-sm text-slate-500">At least {PASSWORD_MIN_LENGTH} characters.</p>
        {fieldError('password')}
      </div>
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-slate-900 px-4 py-2 font-medium text-white disabled:opacity-60"
      >
        {pending ? 'Creating account…' : 'Create account'}
      </button>
    </form>
  );
}
