import { z } from 'zod';

/** RFC 9457 problem+json body returned by the API for every failure. */
export const problemDetailsSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  code: z.string(),
  issues: z.array(z.object({ path: z.string(), code: z.string() })).optional(),
});

export type ProblemDetails = z.infer<typeof problemDetailsSchema>;
