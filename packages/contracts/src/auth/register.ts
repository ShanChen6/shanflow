import { z } from 'zod';
import { authUserSchema } from './user.js';

export const PASSWORD_MIN_LENGTH = 12;
// Matches the API hasher's upper bound; protects against oversized-input abuse.
export const PASSWORD_MAX_LENGTH = 128;
export const DISPLAY_NAME_MAX_LENGTH = 80;
export const EMAIL_MAX_LENGTH = 254;

export const registerRequestSchema = z.object({
  // The API stores the canonical (trimmed, lowercase) form; see ADR-010.
  email: z.string().trim().max(EMAIL_MAX_LENGTH).pipe(z.email()),
  // Passwords are never trimmed or otherwise altered.
  password: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
  displayName: z.string().trim().min(1).max(DISPLAY_NAME_MAX_LENGTH),
});

export const registerResponseSchema = z.object({ user: authUserSchema });

export type RegisterRequest = z.infer<typeof registerRequestSchema>;
export type RegisterResponse = z.infer<typeof registerResponseSchema>;
