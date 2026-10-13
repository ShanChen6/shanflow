import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { defineConfig } from 'prisma/config';
import { resolveDatabaseUrls } from './src/config/database-url.js';

// Resolve the root .env independently of the command's working directory.
// Environment variables provided by the shell take precedence.
config({ path: fileURLToPath(new URL('../../.env', import.meta.url)), quiet: true });

// DIRECT_DATABASE_URL / SHADOW_DATABASE_URL may be set explicitly; otherwise they are derived from
// POSTGRES_HOST/PORT and POSTGRES_MIGRATOR_PASSWORD.
const { DIRECT_DATABASE_URL: migrationUrl, SHADOW_DATABASE_URL: shadowUrl } = resolveDatabaseUrls(process.env);
if (!migrationUrl) {
  throw new Error('Set POSTGRES_MIGRATOR_PASSWORD (or DIRECT_DATABASE_URL) in the root .env file.');
}
if (process.argv.includes('migrate') && process.argv.includes('dev') && !shadowUrl) {
  throw new Error('SHADOW_DATABASE_URL is required for development migrations.');
}
try {
  const url = new URL(migrationUrl);
  const database = decodeURIComponent(url.pathname.slice(1));
  if (!['postgres:', 'postgresql:'].includes(url.protocol) ||
      decodeURIComponent(url.username) !== 'shanflow_migrator' || database !== 'shanflow' ||
      (url.searchParams.get('schema') ?? 'public') !== 'public') {
    throw new Error('Unexpected migration connection');
  }
  if (shadowUrl) {
    const shadow = new URL(shadowUrl);
    const shadowDatabase = decodeURIComponent(shadow.pathname.slice(1));
    // Reject the primary database name even through host aliases, different
    // credentials, ports, query parameters or percent-encoded URL paths.
    if (shadowDatabase === database || shadowDatabase !== 'shanflow_shadow' ||
        !['postgres:', 'postgresql:'].includes(shadow.protocol) ||
        decodeURIComponent(shadow.username) !== 'shanflow_migrator' ||
        (shadow.searchParams.get('schema') ?? 'public') !== 'public') {
      throw new Error('Unsafe shadow connection');
    }
  }
} catch {
  throw new Error('Prisma CLI requires shanflow_migrator, primary database shanflow and a separate shadow database shanflow_shadow, with schema public.');
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    // CLI operations must use the migration role, never runtime/bootstrap.
    url: migrationUrl,
    // Optional for production deploy/status; required for local migrate dev.
    ...(shadowUrl ? { shadowDatabaseUrl: shadowUrl } : {}),
  },
});
