import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import pg from 'pg';

config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true });

const connections = [
  ['DATABASE_URL', 'shanflow_app'],
  ['DIRECT_DATABASE_URL', 'shanflow_migrator'],
];

for (const [variable, role] of connections) {
  const connectionString = process.env[variable];
  if (!connectionString) {
    console.error(`Set ${variable} in the root .env file.`);
    process.exitCode = 1;
    break;
  }

  let client;
  try {
    const url = new URL(connectionString);
    if (decodeURIComponent(url.username) !== role || url.pathname !== '/shanflow') {
      throw new Error('Unexpected role or database');
    }
    client = new pg.Client({ connectionString, connectionTimeoutMillis: 5000 });
    await client.connect();
    // Read-only checks: no models, DDL, migrations or database writes.
    const result = await client.query(`
      SELECT 1 AS connected, current_database() AS database, current_user AS role,
             rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls
      FROM pg_roles WHERE rolname = current_user
    `);
    const row = result.rows[0];
    if (!row || row.connected !== 1 || row.database !== 'shanflow' || row.role !== role ||
        row.rolsuper || row.rolcreatedb || row.rolcreaterole || row.rolreplication || row.rolbypassrls) {
      throw new Error('Unexpected role privileges');
    }
    console.log(`${variable}: SELECT 1 passed as ${role}; no cluster admin privileges.`);
  } catch {
    // Driver errors can contain connection details. Do not print the URL/error.
    console.error(`${variable}: verification failed; check credentials, database and role privileges.`);
    process.exitCode = 1;
  } finally {
    if (client) await client.end().catch(() => {});
  }
}
