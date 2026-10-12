import { AUTH_ERROR_CODES } from '@shanflow/contracts';
import { requestNoContent } from '@/shared/api/http-client';
import { authedPostNoContent } from '../shared/auth-client';

export type ConfirmOutcome =
  | { status: 'confirmed' }
  /** Unknown, expired, already used, or for an address the account no longer has. */
  | { status: 'invalid' }
  | { status: 'failed'; message: string };

export async function submitEmailConfirmation(token: string): Promise<ConfirmOutcome> {
  const result = await requestNoContent({ method: 'POST', path: '/auth/email-verification/confirm', body: { token } });
  if (result.ok) return { status: 'confirmed' };
  if (result.kind === 'problem') {
    if (result.problem.code === AUTH_ERROR_CODES.invalidToken || result.problem.code === AUTH_ERROR_CODES.validationFailed) {
      return { status: 'invalid' };
    }
    if (result.problem.code === AUTH_ERROR_CODES.tooManyRequests) {
      return { status: 'failed', message: 'Too many attempts. Please try again later.' };
    }
  }
  return { status: 'failed', message: 'Could not confirm your email. Check your connection and try again.' };
}

export type ResendOutcome = 'sent' | 'throttled' | 'signed-out' | 'failed';

export async function requestVerificationEmail(): Promise<ResendOutcome> {
  const result = await authedPostNoContent('/auth/email-verification/request');
  if (result.ok) return 'sent';
  if (result.kind === 'signed-out') return 'signed-out';
  if (result.kind === 'problem' && result.problem.code === AUTH_ERROR_CODES.tooManyRequests) return 'throttled';
  return 'failed';
}
