import { updateProfileResponseSchema } from './update-profile.js';

/** The largest upload accepted (the API enforces it while reading, not just from the header). */
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

/** What may be uploaded. The API sniffs the real format from the bytes and does not trust this header. */
export const AVATAR_CONTENT_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export type AvatarContentType = (typeof AVATAR_CONTENT_TYPES)[number];

/** Uploading or removing an avatar answers with the updated profile. */
export const avatarResponseSchema = updateProfileResponseSchema;
