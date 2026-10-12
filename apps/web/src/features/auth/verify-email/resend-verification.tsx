'use client';

import { useState } from 'react';
import { requestVerificationEmail, type ResendOutcome } from './verify-email.action';

const MESSAGES: Record<ResendOutcome, string> = {
  sent: 'If this address is not verified yet, a new link is on its way.',
  throttled: 'Too many requests. Please wait before asking for another email.',
  'signed-out': 'Your session ended. Please sign in again.',
  failed: 'Could not send the email. Please try again.',
};

export function ResendVerification() {
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<ResendOutcome>();

  async function send() {
    if (pending) return;
    setPending(true);
    try {
      setOutcome(await requestVerificationEmail());
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-lg font-semibold">Verify your email</h2>
      <p className="text-sm text-slate-600">Your email address has not been verified yet.</p>
      <button
        type="button"
        onClick={() => void send()}
        disabled={pending}
        className="self-start rounded-md border border-slate-300 px-4 py-2 font-medium disabled:opacity-60"
      >
        {pending ? 'Sending…' : 'Send verification email'}
      </button>
      {outcome ? (
        <p role={outcome === 'sent' ? 'status' : 'alert'} className={outcome === 'sent' ? 'text-sm text-slate-700' : 'text-sm text-red-700'}>
          {MESSAGES[outcome]}
        </p>
      ) : null}
    </section>
  );
}
