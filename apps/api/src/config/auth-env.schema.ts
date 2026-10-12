import { z } from 'zod';

const trimmedText = z.string().trim().min(1).max(200);

const booleanText = z
  .union([z.boolean(), z.enum(['true', 'false'])])
  .transform((value) => value === true || value === 'true');

function isOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      ['http:', 'https:'].includes(url.protocol) &&
      url.origin === value &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

export const authEnvSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    // HS256 key: at least 32 characters (256 bits when generated randomly).
    JWT_ACCESS_SECRET: z
      .string()
      .min(32)
      .max(512)
      .refine((value) => value.trim() === value),
    JWT_ISSUER: trimmedText.default('shanflow-api'),
    JWT_AUDIENCE: trimmedText.default('shanflow-web'),
    ACCESS_TOKEN_TTL_SECONDS: z.coerce
      .number()
      .int()
      .min(60)
      .max(3600)
      .default(900),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
    AUTH_COOKIE_SECURE: booleanText.optional(),
    AUTH_COOKIE_DOMAIN: z
      .string()
      .trim()
      .regex(/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/i)
      .optional()
      .or(z.literal('').transform(() => undefined)),
    WEB_ORIGIN: z.string().refine(isOrigin).default('http://localhost:3000'),
  })
  .transform((env, context) => {
    const production = env.NODE_ENV === 'production';
    const cookieSecure = env.AUTH_COOKIE_SECURE ?? production;
    if (production && !cookieSecure) {
      context.addIssue({
        code: 'custom',
        path: ['AUTH_COOKIE_SECURE'],
        message: 'insecure',
      });
    }
    if (production && !env.WEB_ORIGIN.startsWith('https://')) {
      context.addIssue({
        code: 'custom',
        path: ['WEB_ORIGIN'],
        message: 'insecure',
      });
    }
    return {
      NODE_ENV: env.NODE_ENV,
      JWT_ACCESS_SECRET: env.JWT_ACCESS_SECRET,
      JWT_ISSUER: env.JWT_ISSUER,
      JWT_AUDIENCE: env.JWT_AUDIENCE,
      ACCESS_TOKEN_TTL_SECONDS: env.ACCESS_TOKEN_TTL_SECONDS,
      REFRESH_TOKEN_TTL_DAYS: env.REFRESH_TOKEN_TTL_DAYS,
      AUTH_COOKIE_SECURE: cookieSecure,
      AUTH_COOKIE_DOMAIN: env.AUTH_COOKIE_DOMAIN,
      WEB_ORIGIN: env.WEB_ORIGIN,
    };
  });

export type AuthEnvironment = z.output<typeof authEnvSchema>;

const requirements = {
  JWT_ACCESS_SECRET:
    'JWT_ACCESS_SECRET must be a random string of at least 32 characters without surrounding whitespace',
  JWT_ISSUER: 'JWT_ISSUER must be a non-empty string',
  JWT_AUDIENCE: 'JWT_AUDIENCE must be a non-empty string',
  ACCESS_TOKEN_TTL_SECONDS:
    'ACCESS_TOKEN_TTL_SECONDS must be an integer from 60 to 3600',
  REFRESH_TOKEN_TTL_DAYS:
    'REFRESH_TOKEN_TTL_DAYS must be an integer from 1 to 90',
  AUTH_COOKIE_SECURE:
    'AUTH_COOKIE_SECURE must be true or false, and true in production',
  AUTH_COOKIE_DOMAIN: 'AUTH_COOKIE_DOMAIN must be a bare host name',
  WEB_ORIGIN:
    'WEB_ORIGIN must be an origin (scheme and host only), https in production',
  NODE_ENV: 'NODE_ENV must be development, test or production',
};

export function validateAuthEnvironment(input: unknown): AuthEnvironment {
  const result = authEnvSchema.safeParse(input);
  if (result.success) return result.data;
  const fields = new Set(result.error.issues.map((issue) => issue.path[0]));
  const messages = Object.entries(requirements)
    .filter(([field]) => fields.has(field))
    .map(([, requirement]) => requirement);
  // Never stringify Zod errors: invalid inputs may contain the signing secret.
  throw new Error(
    `Invalid auth environment: ${messages.join('; ') || 'expected an environment object'}.`,
  );
}
