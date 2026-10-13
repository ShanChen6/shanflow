import { z } from 'zod';
import { displayNameSchema } from './display-name.js';
import { userProfileSchema } from './profile.js';

/**
 * Only the display name can be changed here. `.strict()` makes anything else (email, avatar, id…) a validation
 * error instead of being silently ignored, so a client cannot believe it changed something it did not.
 */
export const updateProfileRequestSchema = z.object({ displayName: displayNameSchema }).strict();

export const updateProfileResponseSchema = z.object({ user: userProfileSchema });

export type UpdateProfileRequest = z.infer<typeof updateProfileRequestSchema>;
export type UpdateProfileResponse = z.infer<typeof updateProfileResponseSchema>;
