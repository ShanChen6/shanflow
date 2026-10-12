import { z } from 'zod';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, newPasswordSchema } from './password.js';
import { authUserSchema } from './user.js';

export { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH };

export const DISPLAY_NAME_MAX_LENGTH = 80;
export const EMAIL_MAX_LENGTH = 254;

export const registerRequestSchema = z.object({
  // The API stores the canonical (trimmed, lowercase) form; see ADR-010.
  email: z.string().trim().max(EMAIL_MAX_LENGTH).pipe(z.email()),
  password: newPasswordSchema,
  displayName: z.string().trim().min(1).max(DISPLAY_NAME_MAX_LENGTH),
});

export const registerResponseSchema = z.object({ user: authUserSchema });

export type RegisterRequest = z.infer<typeof registerRequestSchema>;
export type RegisterResponse = z.infer<typeof registerResponseSchema>;
