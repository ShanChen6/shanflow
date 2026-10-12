import { AUTH_ERROR_CODES, newPasswordSchema } from '@shanflow/contracts';
import { requestNoContent } from '@/shared/api/http-client';

export type ResetOutcome =
  | { status: 'reset' }
  /** The link is unknown, expired or already used: the user must ask for a new one. */
  | { status: 'invalid-token' }
  | { status: 'weak-password' }
  | { status: 'failed'; message: string };

export function validateNewPassword(password: string): boolean {
  return newPasswordSchema.safeParse(password).success;
}

export async function submitPasswordReset(token: string, newPassword: string): Promise<ResetOutcome> {
  const result = await requestNoContent({ method: 'POST', path: '/auth/password/reset', body: { token, newPassword } });
  if (result.ok) return { status: 'reset' };
  if (result.kind === 'problem') {
    if (result.problem.code === AUTH_ERROR_CODES.invalidToken) return { status: 'invalid-token' };
    if (result.problem.code === AUTH_ERROR_CODES.validationFailed) return { status: 'weak-password' };
    if (result.problem.code === AUTH_ERROR_CODES.tooManyRequests) {
      return { status: 'failed', message: 'Too many attempts. Please try again later.' };
    }
  }
  return { status: 'failed', message: 'Could not reset the password. Check your connection and try again.' };
}
