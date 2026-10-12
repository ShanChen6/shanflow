import { AUTH_ERROR_CODES, AVATAR_CONTENT_TYPES, AVATAR_MAX_BYTES, avatarResponseSchema, type UserProfile } from '@shanflow/contracts';
import { authedDeleteJson, authedPutBlob } from '@/features/auth/shared/auth-client';

export type AvatarOutcome = { status: 'updated'; profile: UserProfile } | { status: 'error'; message: string } | { status: 'signed-out' };

/** First-line check before any bytes are sent; the server re-validates and re-encodes the image anyway. */
export function validateAvatarFile(file: { type: string; size: number }): string | undefined {
  if (!(AVATAR_CONTENT_TYPES as readonly string[]).includes(file.type)) return 'Choose a PNG, JPEG or WebP image.';
  if (file.size === 0) return 'That file is empty.';
  if (file.size > AVATAR_MAX_BYTES) return 'The image is larger than 2 MB. Choose a smaller one.';
  return undefined;
}

function failure(result: { ok: false; kind: string; problem?: { code?: string } }, fallback: string): AvatarOutcome {
  if (result.kind === 'signed-out') return { status: 'signed-out' };
  switch (result.kind === 'problem' ? result.problem?.code : undefined) {
    case AUTH_ERROR_CODES.unauthenticated:
      return { status: 'signed-out' };
    case AUTH_ERROR_CODES.payloadTooLarge:
      return {
        status: 'error',
        message: 'The image is larger than 2 MB. Choose a smaller one.',
      };
    case AUTH_ERROR_CODES.unsupportedMediaType:
      return { status: 'error', message: 'Choose a PNG, JPEG or WebP image.' };
    case AUTH_ERROR_CODES.invalidImage:
      return {
        status: 'error',
        message: 'That file could not be read as an image. Try a different one.',
      };
    case AUTH_ERROR_CODES.tooManyRequests:
      return {
        status: 'error',
        message: 'Too many changes. Please wait a few minutes and try again.',
      };
  }
  return { status: 'error', message: fallback };
}

export async function uploadAvatar(file: File): Promise<AvatarOutcome> {
  const invalid = validateAvatarFile(file);
  if (invalid) return { status: 'error', message: invalid };
  const result = await authedPutBlob('/users/me/avatar', file, avatarResponseSchema);
  if (result.ok) return { status: 'updated', profile: result.data.user };
  return failure(result as never, 'Could not upload the image. Check your connection and try again.');
}

export async function removeAvatar(): Promise<AvatarOutcome> {
  const result = await authedDeleteJson('/users/me/avatar', avatarResponseSchema);
  if (result.ok) return { status: 'updated', profile: result.data.user };
  return failure(result as never, 'Could not remove the image. Check your connection and try again.');
}
