import { AUTH_ERROR_CODES, changePasswordRequestSchema } from '@shanflow/contracts';
import { authedPostNoContent } from '../shared/auth-client';

export type ChangeField = 'currentPassword' | 'newPassword';
export type ChangeFieldErrors = Partial<Record<ChangeField, string>>;

export type ChangeOutcome =
  | { status: 'changed' }
  | { status: 'error'; fieldErrors: ChangeFieldErrors; formError?: string }
  /** The session is gone; RequireAuth sends the user to /login. */
  | { status: 'signed-out' };

const NEW_PASSWORD_MESSAGE = 'Use 12 to 128 characters.';

/** Client-side check with the same contract schema the API enforces. */
export function validateChange(input: unknown): ChangeFieldErrors {
  const result = changePasswordRequestSchema.safeParse(input);
  if (result.success) return {};
  const errors: ChangeFieldErrors = {};
  for (const issue of result.error.issues) {
    if (issue.path[0] === 'currentPassword') errors.currentPassword = 'Enter your current password.';
    if (issue.path[0] === 'newPassword') errors.newPassword = NEW_PASSWORD_MESSAGE;
  }
  return errors;
}

export async function submitPasswordChange(currentPassword: string, newPassword: string): Promise<ChangeOutcome> {
  const result = await authedPostNoContent('/auth/password/change', { currentPassword, newPassword });
  if (result.ok) return { status: 'changed' };
  if (result.kind === 'signed-out') return { status: 'signed-out' };
  if (result.kind === 'problem') {
    switch (result.problem.code) {
      case AUTH_ERROR_CODES.wrongPassword:
        return { status: 'error', fieldErrors: { currentPassword: 'That is not your current password.' } };
      case AUTH_ERROR_CODES.passwordUnchanged:
        return { status: 'error', fieldErrors: { newPassword: 'Choose a password different from the current one.' } };
      case AUTH_ERROR_CODES.validationFailed:
        return { status: 'error', fieldErrors: { newPassword: NEW_PASSWORD_MESSAGE } };
      case AUTH_ERROR_CODES.tooManyRequests:
        return { status: 'error', fieldErrors: {}, formError: 'Too many attempts. Please try again later.' };
      case AUTH_ERROR_CODES.unauthenticated:
        return { status: 'signed-out' };
      case AUTH_ERROR_CODES.passwordNotSet:
        return { status: 'error', fieldErrors: {}, formError: 'This account has no password yet. Use "Forgot password" to set one.' };
    }
  }
  return { status: 'error', fieldErrors: {}, formError: 'Could not change the password. Check your connection and try again.' };
}
