import { z } from 'zod';
import { OAUTH_PROVIDERS } from './oauth.js';
import { authUserSchema } from './user.js';

export const meResponseSchema = z.object({
  user: authUserSchema,
  /** What the account can currently sign in with; drives which security actions the UI offers. */
  security: z.object({
    hasPassword: z.boolean(),
    linkedProviders: z.array(z.enum(OAUTH_PROVIDERS)),
  }),
});

export type MeResponse = z.infer<typeof meResponseSchema>;
