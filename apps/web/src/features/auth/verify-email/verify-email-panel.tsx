'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { isPlausibleToken } from '../shared/token';
import { submitEmailConfirmation, type ConfirmOutcome } from './verify-email.action';

/**
 * The emailed link carries a single-use token. Confirmation is an explicit click (not on page load) so mail
 * scanners and link previewers that open URLs cannot consume it, and the token is removed from the address bar.
 */
export function VerifyEmailPanel() {
  const params = useSearchParams();
  const [token] = useState(() => params.get('token'));
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<ConfirmOutcome>();

  useEffect(() => {
    // Keep the secret out of history, screenshots and the Referer of anything this page loads.
    window.history.replaceState(null, '', window.location.pathname);
  }, []);

  async function confirm() {
    if (pending || !isPlausibleToken(token)) return;
    setPending(true);
    try {
      setOutcome(await submitEmailConfirmation(token));
    } finally {
      setPending(false);
    }
  }

  if (outcome?.status === 'confirmed') {
    return (
      <div role="status" className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold">Email confirmed</h1>
        <p className="text-slate-600">Thank you. Your email address is now verified.</p>
        <a href="/account" className="font-medium underline">
          Go to your account
        </a>
      </div>
    );
  }

  if (!isPlausibleToken(token) || outcome?.status === 'invalid') {
    return (
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold">This link is not valid</h1>
        <p className="text-slate-600">It may have expired or already been used. Sign in and request a new one from your account page.</p>
        <a href="/account" className="font-medium underline">
          Go to your account
        </a>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-2xl font-bold">Confirm your email</h1>
      <p className="text-slate-600">Confirm that this is your email address.</p>
      {outcome?.status === 'failed' ? (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          {outcome.message}
        </p>
      ) : null}
      <button
        type="button"
        onClick={() => void confirm()}
        disabled={pending}
        className="self-start rounded-md bg-brand-500 px-4 py-2 font-medium text-brand-ink disabled:opacity-60"
      >
        {pending ? 'Confirming…' : 'Confirm email'}
      </button>
    </div>
  );
}
