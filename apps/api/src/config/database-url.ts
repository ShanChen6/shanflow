// Builds the PostgreSQL connection URLs from the individual settings in the root .env, so a host, port or
// password is stored once. An explicitly set URL always wins (CI and tests set them directly).
// Keep this file free of imports and non-erasable TypeScript: Prisma's config and scripts/check-db.mjs load it directly.

type Environment = Record<string, string | undefined>;

export type DatabaseRole = 'app' | 'migrator';

const ROLES = {
  app: { user: 'shanflow_app', passwordVariable: 'POSTGRES_APP_PASSWORD', urlVariable: 'DATABASE_URL' },
  migrator: { user: 'shanflow_migrator', passwordVariable: 'POSTGRES_MIGRATOR_PASSWORD', urlVariable: 'DIRECT_DATABASE_URL' },
} as const;

function text(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/** Returns undefined when the role's password is not configured. Credentials are percent-encoded. */
export function buildDatabaseUrl(env: Environment, role: DatabaseRole, database?: string): string | undefined {
  const { user, passwordVariable } = ROLES[role];
  const password = text(env[passwordVariable]);
  if (!password) return undefined;
  const host = text(env.POSTGRES_HOST) ?? 'localhost';
  const port = text(env.POSTGRES_PORT) ?? '5432';
  const name = database ?? text(env.POSTGRES_DB) ?? 'shanflow';
  const hostPart = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${hostPart}:${port}/${encodeURIComponent(name)}?schema=public`;
}

/** Explicit DATABASE_URL / DIRECT_DATABASE_URL / SHADOW_DATABASE_URL win; otherwise they are derived from the parts. */
export function resolveDatabaseUrls(env: Environment): {
  DATABASE_URL?: string;
  DIRECT_DATABASE_URL?: string;
  SHADOW_DATABASE_URL?: string;
} {
  return {
    DATABASE_URL: text(env.DATABASE_URL) ?? buildDatabaseUrl(env, 'app'),
    DIRECT_DATABASE_URL: text(env.DIRECT_DATABASE_URL) ?? buildDatabaseUrl(env, 'migrator'),
    SHADOW_DATABASE_URL: text(env.SHADOW_DATABASE_URL) ?? buildDatabaseUrl(env, 'migrator', 'shanflow_shadow'),
  };
}
