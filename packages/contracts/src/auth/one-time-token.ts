import { z } from 'zod';

/** 32 random bytes, base64url: the only shape the API issues, so anything else is rejected early. */
export const oneTimeTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

export const confirmEmailRequestSchema = z.object({ token: oneTimeTokenSchema });
export type ConfirmEmailRequest = z.infer<typeof confirmEmailRequestSchema>;
