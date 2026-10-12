import { AUTH_ERROR_CODES, forgotPasswordRequestSchema } from '@shanflow/contracts';
import { requestNoContent } from '@/shared/api/http-client';

export type ForgotOutcome = { status: 'requested' } | { status: 'invalid-email' } | { status: 'failed'; message: string };

export function validateForgotEmail(email: string): boolean {
  return forgotPasswordRequestSchema.safeParse({ email }).success;
}

export async function submitForgotPassword(email: string): Promise<ForgotOutcome> {
  const result = await requestNoContent({ method: 'POST', path: '/auth/password/forgot', body: { email } });
  // Any 2xx looks the same whether or not the address has an account; the UI must not distinguish either.
  if (result.ok) return { status: 'requested' };
  if (result.kind === 'problem') {
    if (result.problem.code === AUTH_ERROR_CODES.validationFailed) return { status: 'invalid-email' };
    if (result.problem.code === AUTH_ERROR_CODES.tooManyRequests) {
      return { status: 'failed', message: 'Too many requests. Please try again later.' };
    }
  }
  return { status: 'failed', message: 'Could not send the request. Check your connection and try again.' };
}
