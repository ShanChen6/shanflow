import { z } from 'zod';

/**
 * The signed-in user's own profile (`GET /users/me`). It carries what the account page and profile editor
 * need and nothing about credentials: sign-in methods stay on `GET /auth/me`, which is about authentication.
 */
export const userProfileSchema = z.object({
  id: z.uuid(),
  /** Canonical (trimmed, lowercase) address. */
  email: z.string(),
  emailVerified: z.boolean(),
  displayName: z.string(),
  /** An https image URL, or null when the user has no avatar. */
  avatarUrl: z.url().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const getUserMeResponseSchema = z.object({ user: userProfileSchema });

export type UserProfile = z.infer<typeof userProfileSchema>;
export type GetUserMeResponse = z.infer<typeof getUserMeResponseSchema>;
