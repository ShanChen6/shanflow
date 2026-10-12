import { z } from 'zod';
import { PASSWORD_MAX_LENGTH, EMAIL_MAX_LENGTH } from './register.js';
import { authUserSchema } from './user.js';

export const loginRequestSchema = z.object({
  email: z.string().trim().max(EMAIL_MAX_LENGTH).pipe(z.email()),
  // No minimum beyond "present": the login form must not reveal or enforce the signup policy.
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});

/** The refresh token is never in the body; it travels only in the HttpOnly cookie. */
export const loginResponseSchema = z.object({
  accessToken: z.string().min(1),
  tokenType: z.literal('Bearer'),
  /** Access token lifetime in seconds. */
  expiresIn: z.number().int().positive(),
  user: authUserSchema,
});

export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type LoginResponse = z.infer<typeof loginResponseSchema>;
