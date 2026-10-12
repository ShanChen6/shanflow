import { AUTH_ERROR_CODES, googleLinkStartResponseSchema } from '@shanflow/contracts';
import { authedPostJson } from '../shared/auth-client';

export type LinkStartOutcome =
  | { status: 'redirect'; url: string }
  | { status: 'error'; passwordError?: string; formError?: string }
  | { status: 'signed-out' };

export async function startGoogleLink(password: string): Promise<LinkStartOutcome> {
  const result = await authedPostJson('/auth/google/link/start', { password }, googleLinkStartResponseSchema);
  if (result.ok) return { status: 'redirect', url: result.data.authorizationUrl };
  if (result.kind === 'signed-out') return { status: 'signed-out' };
  if (result.kind === 'problem') {
    switch (result.problem.code) {
      case AUTH_ERROR_CODES.wrongPassword:
        return { status: 'error', passwordError: 'That is not your current password.' };
      case AUTH_ERROR_CODES.validationFailed:
        return { status: 'error', passwordError: 'Enter your current password.' };
      case AUTH_ERROR_CODES.alreadyLinked:
        return { status: 'error', formError: 'A Google account is already linked.' };
      case AUTH_ERROR_CODES.oauthNotConfigured:
        return { status: 'error', formError: 'Google sign-in is not available right now.' };
      case AUTH_ERROR_CODES.tooManyRequests:
        return { status: 'error', formError: 'Too many attempts. Please try again later.' };
      case AUTH_ERROR_CODES.unauthenticated:
        return { status: 'signed-out' };
    }
  }
  return { status: 'error', formError: 'Could not start linking. Check your connection and try again.' };
}
