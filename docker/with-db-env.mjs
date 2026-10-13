// Builds DATABASE_URL (shanflow_app) and DIRECT_DATABASE_URL (shanflow_migrator) for containers from the
// role passwords in the root .env, percent-encoding them, then runs the given command.
// Usage: node docker/with-db-env.mjs <command> [args...]
import { spawn } from 'node:child_process';

const host = process.env.POSTGRES_HOST ?? 'postgres';
const database = process.env.POSTGRES_DB ?? 'shanflow';

function url(user, password) {
  if (!password) {
    console.error(`Set the password for ${user} in the root .env (see docs/guides/environment-setup.md).`);
    process.exit(1);
  }
  return `postgresql://${user}:${encodeURIComponent(password)}@${host}:5432/${database}?schema=public`;
}

const env = {
  ...process.env,
  DATABASE_URL: url('shanflow_app', process.env.POSTGRES_APP_PASSWORD),
  DIRECT_DATABASE_URL: url('shanflow_migrator', process.env.POSTGRES_MIGRATOR_PASSWORD),
};
const [command, ...args] = process.argv.slice(2);
const child = spawn(command, args, { stdio: 'inherit', env });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
