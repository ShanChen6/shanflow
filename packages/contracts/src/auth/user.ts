import { z } from 'zod';

/** Public profile returned by auth endpoints. */
export const authUserSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  displayName: z.string(),
  emailVerified: z.boolean(),
});

export type AuthUser = z.infer<typeof authUserSchema>;
