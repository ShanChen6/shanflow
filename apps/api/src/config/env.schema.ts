import { z } from 'zod';

function isRuntimeDatabaseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    decodeURIComponent(url.password);
    return value === value.trim() && ['postgres:', 'postgresql:'].includes(url.protocol) &&
      Boolean(url.hostname) && decodeURIComponent(url.username) === 'shanflow_app' &&
      decodeURIComponent(url.pathname.slice(1)) === 'shanflow' &&
      (url.searchParams.get('schema') ?? 'public') === 'public' &&
      !['user', 'username', 'password', 'database', 'dbname', 'host', 'port'].some(key => url.searchParams.has(key));
  } catch {
    return false;
  }
}

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.union([z.string().regex(/^\d+$/).transform(Number), z.number()])
    .pipe(z.number().int().min(1).max(65535)).default(3001),
  DATABASE_URL: z.string().min(1).refine(isRuntimeDatabaseUrl),
});

export type RuntimeEnvironment = z.infer<typeof envSchema>;

const requirements = {
  NODE_ENV: 'NODE_ENV must be development, test or production',
  PORT: 'PORT must be an integer from 1 to 65535',
  DATABASE_URL: 'DATABASE_URL is required and must be a PostgreSQL URL using shanflow_app, database shanflow and schema public',
};

export function validateEnvironment(input: unknown): RuntimeEnvironment {
  const result = envSchema.safeParse(input);
  if (result.success) return result.data;
  const fields = new Set(result.error.issues.map(issue => issue.path[0]));
  const messages = Object.entries(requirements)
    .filter(([field]) => fields.has(field))
    .map(([, requirement]) => requirement);
  // Never stringify Zod errors: invalid inputs may contain secrets.
  throw new Error(`Invalid runtime environment: ${messages.join('; ') || 'expected an environment object'}.`);
}
