import {
  AUTH_ERROR_CODES,
  displayNameSchema,
  getUserMeResponseSchema,
  updateProfileResponseSchema,
  type UserProfile,
} from '@shanflow/contracts';
import { authedGetJson, authedPatchJson } from '@/features/auth/shared/auth-client';
import { updateSessionUser } from '@/features/auth/shared/session-store';

export type ProfileLoad = { status: 'ready'; profile: UserProfile } | { status: 'error' } | { status: 'signed-out' };

export async function loadProfile(): Promise<ProfileLoad> {
  const result = await authedGetJson('/users/me', getUserMeResponseSchema);
  if (result.ok) return { status: 'ready', profile: result.data.user };
  return result.kind === 'signed-out' ? { status: 'signed-out' } : { status: 'error' };
}

const NAME_MESSAGE = 'Enter a name of 1 to 80 characters, without line breaks or hidden characters.';

/** Same rules as the API, applied before sending. Returns a message, or undefined when the name is acceptable. */
export function validateDisplayName(value: string): string | undefined {
  return displayNameSchema.safeParse(value).success ? undefined : NAME_MESSAGE;
}

export type UpdateOutcome =
  | { status: 'updated'; profile: UserProfile }
  | { status: 'error'; nameError?: string; formError?: string }
  | { status: 'signed-out' };

export async function submitDisplayName(displayName: string): Promise<UpdateOutcome> {
  const nameError = validateDisplayName(displayName);
  if (nameError) return { status: 'error', nameError };

  const result = await authedPatchJson('/users/me', { displayName }, updateProfileResponseSchema);
  if (result.ok) {
    updateSessionUser({ displayName: result.data.user.displayName });
    return { status: 'updated', profile: result.data.user };
  }
  if (result.kind === 'signed-out') return { status: 'signed-out' };
  if (result.kind === 'problem') {
    switch (result.problem.code) {
      case AUTH_ERROR_CODES.validationFailed:
        return { status: 'error', nameError: NAME_MESSAGE };
      case AUTH_ERROR_CODES.tooManyRequests:
        return { status: 'error', formError: 'Too many changes. Please wait a moment and try again.' };
      case AUTH_ERROR_CODES.unauthenticated:
        return { status: 'signed-out' };
    }
  }
  return { status: 'error', formError: 'Could not save your name. Check your connection and try again.' };
}
