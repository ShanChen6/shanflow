import { z } from 'zod';

const optionalText = z
  .string()
  .trim()
  .max(1024)
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

/** Settings for the signed-in user's own data: where uploaded avatars live and how clients reach them. */
export const userEnvSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    // The public origin of this API, used to build avatar URLs handed to browsers.
    API_PUBLIC_URL: optionalText,
    // Directory for uploaded avatars (local-disk storage). It must be absolute and on persistent storage.
    AVATAR_STORAGE_DIR: optionalText,
  })
  .transform((env, context) => {
    const issue = (path: string) =>
      context.addIssue({ code: 'custom', path: [path], message: 'invalid' });
    const production = env.NODE_ENV === 'production';

    const publicUrl =
      env.API_PUBLIC_URL ??
      (production ? undefined : `http://localhost:${env.PORT}`);
    if (
      !publicUrl ||
      !isOrigin(publicUrl) ||
      (production && !publicUrl.startsWith('https://'))
    )
      issue('API_PUBLIC_URL');
    if (
      env.AVATAR_STORAGE_DIR !== undefined &&
      !env.AVATAR_STORAGE_DIR.startsWith('/')
    )
      issue('AVATAR_STORAGE_DIR');
    if (production && env.AVATAR_STORAGE_DIR === undefined)
      issue('AVATAR_STORAGE_DIR');

    return {
      API_PUBLIC_URL: publicUrl ?? '',
      AVATAR_STORAGE_DIR: env.AVATAR_STORAGE_DIR,
    };
  });

export type UserEnvironment = z.output<typeof userEnvSchema>;

const requirements = {
  NODE_ENV: 'NODE_ENV must be development, test or production',
  PORT: 'PORT must be an integer from 1 to 65535',
  API_PUBLIC_URL:
    'API_PUBLIC_URL must be an origin (scheme and host only), set and https in production',
  AVATAR_STORAGE_DIR:
    'AVATAR_STORAGE_DIR must be an absolute path, and is required in production',
};

export function validateUserEnvironment(input: unknown): UserEnvironment {
  const result = userEnvSchema.safeParse(input);
  if (result.success) return result.data;
  const fields = new Set(result.error.issues.map((issue) => issue.path[0]));
  const messages = Object.entries(requirements)
    .filter(([field]) => fields.has(field))
    .map(([, requirement]) => requirement);
  throw new Error(
    `Invalid user environment: ${messages.join('; ') || 'expected an environment object'}.`,
  );
}
