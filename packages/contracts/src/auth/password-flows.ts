import { z } from 'zod';
import { EMAIL_MAX_LENGTH } from './register.js';
import { oneTimeTokenSchema } from './one-time-token.js';
import { newPasswordSchema, presentedPasswordSchema } from './password.js';

export const forgotPasswordRequestSchema = z.object({
  email: z.string().trim().max(EMAIL_MAX_LENGTH).pipe(z.email()),
});

export const resetPasswordRequestSchema = z.object({
  token: oneTimeTokenSchema,
  newPassword: newPasswordSchema,
});

export const changePasswordRequestSchema = z.object({
  currentPassword: presentedPasswordSchema,
  newPassword: newPasswordSchema,
});

export type ForgotPasswordRequest = z.infer<typeof forgotPasswordRequestSchema>;
export type ResetPasswordRequest = z.infer<typeof resetPasswordRequestSchema>;
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;
