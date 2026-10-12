import { z } from 'zod';

const trimmedText = z.string().trim().min(1).max(200);

const booleanText = z
  .union([z.boolean(), z.enum(['true', 'false'])])
  .transform((value) => value === true || value === 'true');

/** Blank values (as in .env.example) mean "not set". */
const optionalText = z
  .string()
  .trim()
  .max(2048)
  .transform((value) => (value === '' ? undefined : value))
  .optional();

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

function isHttpUrl(value: string, options: { https?: boolean } = {}): boolean {
  try {
    const url = new URL(value);
    const protocols = options.https ? ['https:'] : ['http:', 'https:'];
    return (
      protocols.includes(url.protocol) &&
      !url.username &&
      !url.password &&
      !url.hash
    );
  } catch {
    return false;
  }
}

function isSmtpUrl(value: string): boolean {
  try {
    return ['smtp:', 'smtps:'].includes(new URL(value).protocol);
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
    // Email delivery: `console` only logs messages (development/test); production requires `smtp`.
    MAIL_TRANSPORT: z.enum(['console', 'smtp']).default('console'),
    SMTP_URL: optionalText,
    // No CR/LF: a header value must never be able to inject extra headers.
    MAIL_FROM: z
      .string()
      .trim()
      .min(3)
      .max(200)
      .regex(/^[^\r\n]+$/)
      .default('Shanflow <no-reply@localhost>'),
    // Google sign-in is enabled only when all three are set.
    GOOGLE_CLIENT_ID: optionalText,
    GOOGLE_CLIENT_SECRET: optionalText,
    GOOGLE_REDIRECT_URI: optionalText,
    // Endpoint overrides exist only so tests can run a fake provider; forbidden in production.
    GOOGLE_AUTHORIZATION_ENDPOINT: optionalText,
    GOOGLE_TOKEN_ENDPOINT: optionalText,
    GOOGLE_JWKS_URI: optionalText,
  })
  .transform((env, context) => {
    const issue = (path: string) =>
      context.addIssue({ code: 'custom', path: [path], message: 'invalid' });
    const production = env.NODE_ENV === 'production';

    const cookieSecure = env.AUTH_COOKIE_SECURE ?? production;
    if (production && !cookieSecure) issue('AUTH_COOKIE_SECURE');
    if (production && !env.WEB_ORIGIN.startsWith('https://')) {
      issue('WEB_ORIGIN');
    }

    if (
      env.MAIL_TRANSPORT === 'smtp' &&
      !(env.SMTP_URL && isSmtpUrl(env.SMTP_URL))
    ) {
      issue('SMTP_URL');
    }
    if (production && env.MAIL_TRANSPORT !== 'smtp') issue('MAIL_TRANSPORT');

    const googleParts = [
      env.GOOGLE_CLIENT_ID,
      env.GOOGLE_CLIENT_SECRET,
      env.GOOGLE_REDIRECT_URI,
    ];
    const googleSet = googleParts.filter((part) => part !== undefined).length;
    if (googleSet !== 0 && googleSet !== googleParts.length) {
      issue('GOOGLE_CLIENT_ID');
    }
    if (
      env.GOOGLE_REDIRECT_URI &&
      !isHttpUrl(env.GOOGLE_REDIRECT_URI, { https: production })
    ) {
      issue('GOOGLE_REDIRECT_URI');
    }
    const endpoints = [
      ['GOOGLE_AUTHORIZATION_ENDPOINT', env.GOOGLE_AUTHORIZATION_ENDPOINT],
      ['GOOGLE_TOKEN_ENDPOINT', env.GOOGLE_TOKEN_ENDPOINT],
      ['GOOGLE_JWKS_URI', env.GOOGLE_JWKS_URI],
    ] as const;
    for (const [name, value] of endpoints) {
      if (value === undefined) continue;
      if (production || !isHttpUrl(value)) issue(name);
    }

    const google =
      env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_REDIRECT_URI
        ? {
            clientId: env.GOOGLE_CLIENT_ID,
            clientSecret: env.GOOGLE_CLIENT_SECRET,
            redirectUri: env.GOOGLE_REDIRECT_URI,
            authorizationEndpoint:
              env.GOOGLE_AUTHORIZATION_ENDPOINT ??
              'https://accounts.google.com/o/oauth2/v2/auth',
            tokenEndpoint:
              env.GOOGLE_TOKEN_ENDPOINT ?? 'https://oauth2.googleapis.com/token',
            jwksUri:
              env.GOOGLE_JWKS_URI ??
              'https://www.googleapis.com/oauth2/v3/certs',
          }
        : undefined;

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
      MAIL_TRANSPORT: env.MAIL_TRANSPORT,
      SMTP_URL: env.SMTP_URL,
      MAIL_FROM: env.MAIL_FROM,
      GOOGLE: google,
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
  MAIL_TRANSPORT:
    'MAIL_TRANSPORT must be console or smtp, and smtp in production',
  SMTP_URL:
    'SMTP_URL must be an smtp:// or smtps:// URL when MAIL_TRANSPORT is smtp',
  MAIL_FROM: 'MAIL_FROM must be a single-line address of 3 to 200 characters',
  GOOGLE_CLIENT_ID:
    'GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REDIRECT_URI must be set together or not at all',
  GOOGLE_CLIENT_SECRET: 'GOOGLE_CLIENT_SECRET must be a non-empty string',
  GOOGLE_REDIRECT_URI:
    'GOOGLE_REDIRECT_URI must be an http(s) URL without credentials, https in production',
  GOOGLE_AUTHORIZATION_ENDPOINT:
    'GOOGLE_AUTHORIZATION_ENDPOINT must be an http(s) URL and is not allowed in production',
  GOOGLE_TOKEN_ENDPOINT:
    'GOOGLE_TOKEN_ENDPOINT must be an http(s) URL and is not allowed in production',
  GOOGLE_JWKS_URI:
    'GOOGLE_JWKS_URI must be an http(s) URL and is not allowed in production',
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
