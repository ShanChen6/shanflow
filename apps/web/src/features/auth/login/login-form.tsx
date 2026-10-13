'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { setSession } from '../shared/session-store';
import { submitLogin, validateLogin, type LoginField, type LoginFieldErrors } from './login.action';

const inputClass =
  'w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-brand-500 focus:outline-none aria-[invalid=true]:border-red-600';

export function LoginForm() {
  const router = useRouter();
  const [errors, setErrors] = useState<LoginFieldErrors>({});
  const [formError, setFormError] = useState<string>();
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const data = new FormData(event.currentTarget);
    const input = { email: String(data.get('email') ?? ''), password: String(data.get('password') ?? '') };
    const clientErrors = validateLogin(input);
    setFormError(undefined);
    setErrors(clientErrors);
    if (Object.keys(clientErrors).length > 0) return;

    setPending(true);
    try {
      const outcome = await submitLogin(input);
      if (outcome.status === 'success') {
        setSession(outcome.session);
        router.push('/account');
        return;
      }
      setErrors(outcome.fieldErrors);
      setFormError(outcome.formError);
    } finally {
      setPending(false);
    }
  }

  const field = (name: LoginField) => ({
    name,
    'aria-invalid': errors[name] ? true : undefined,
    'aria-describedby': errors[name] ? `${name}-error` : undefined,
    className: inputClass,
    disabled: pending,
  });
  const fieldError = (name: LoginField) =>
    errors[name] ? (
      <p id={`${name}-error`} className="mt-1 text-sm text-red-700">
        {errors[name]}
      </p>
    ) : null;

  return (
    <form onSubmit={onSubmit} noValidate className="flex w-full max-w-sm flex-col gap-4">
      <h1 className="text-2xl font-bold">Sign in</h1>
      {formError ? (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          {formError}
        </p>
      ) : null}
      <div>
        <label htmlFor="email" className="mb-1 block text-sm font-medium">
          Email
        </label>
        <input id="email" type="email" autoComplete="username" {...field('email')} />
        {fieldError('email')}
      </div>
      <div>
        <label htmlFor="password" className="mb-1 block text-sm font-medium">
          Password
        </label>
        <input id="password" type="password" autoComplete="current-password" {...field('password')} />
        {fieldError('password')}
      </div>
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-brand-500 px-4 py-2 font-medium text-brand-ink disabled:opacity-60"
      >
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
      <p className="text-sm text-slate-600">
        <a href="/forgot-password" className="font-medium underline">
          Forgot your password?
        </a>
      </p>
      <p className="text-sm text-slate-600">
        No account yet?{' '}
        <a href="/register" className="font-medium underline">
          Create one
        </a>
      </p>
    </form>
  );
}
