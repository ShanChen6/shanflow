import { z } from 'zod';
import { authUserSchema } from './user.js';

export const meResponseSchema = z.object({ user: authUserSchema });

export type MeResponse = z.infer<typeof meResponseSchema>;
