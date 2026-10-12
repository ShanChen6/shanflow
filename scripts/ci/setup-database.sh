#!/usr/bin/env bash
# Prepares an EMPTY PostgreSQL for the database tests the way local provisioning does, then writes the root .env.
#
#   PGPASSWORD=... [PGHOST=127.0.0.1] [PGPORT=5432] [PGUSER=shanflow] scripts/ci/setup-database.sh
#
# It creates the two least-privilege roles (shanflow_app, shanflow_migrator), applies the repository's own
# scripts/db/provision-*.sql, and generates throwaway random passwords and a JWT secret. Intended for CI and
# disposable databases only: it refuses to run if the target already has the application roles.
set -euo pipefail

: "${PGPASSWORD:?Set PGPASSWORD to the bootstrap superuser password}"
export PGHOST="${PGHOST:-127.0.0.1}" PGPORT="${PGPORT:-5432}" PGUSER="${PGUSER:-shanflow}" PGPASSWORD
DATABASE="${POSTGRES_DB:-shanflow}"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

if [ "$PGHOST" != "127.0.0.1" ] && [ "$PGHOST" != "localhost" ]; then
  echo "Refusing to provision a non-local host: $PGHOST" >&2
  exit 1
fi

psql_admin() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }

if [ -e "$root/.env" ] && [ "${CI:-}" != "true" ]; then
  echo "A root .env already exists; refusing to overwrite it outside CI." >&2
  exit 1
fi

existing="$(psql_admin -d postgres -At -c "SELECT count(*) FROM pg_roles WHERE rolname IN ('shanflow_app','shanflow_migrator')")"
if [ "$existing" != "0" ]; then
  echo "Application roles already exist; this script only prepares empty databases." >&2
  exit 1
fi

app_password="$(openssl rand -hex 24)"
migrator_password="$(openssl rand -hex 24)"
jwt_secret="$(openssl rand -base64 48 | tr -d '\n')"

psql_admin -d postgres \
  -c "CREATE ROLE shanflow_app LOGIN PASSWORD '${app_password}'" \
  -c "CREATE ROLE shanflow_migrator LOGIN PASSWORD '${migrator_password}'"
psql_admin -d "$DATABASE" -v "database=${DATABASE}" -f "$root/scripts/db/provision-roles.sql"
psql_admin -d postgres -f "$root/scripts/db/provision-shadow.sql"

url() { echo "postgresql://$1:$2@127.0.0.1:${PGPORT}/$3?schema=public"; }
umask 077
cat > "$root/.env" <<ENV
NODE_ENV=test
POSTGRES_DB=${DATABASE}
POSTGRES_PORT=${PGPORT}
DATABASE_URL=$(url shanflow_app "$app_password" "$DATABASE")
DIRECT_DATABASE_URL=$(url shanflow_migrator "$migrator_password" "$DATABASE")
SHADOW_DATABASE_URL=$(url shanflow_migrator "$migrator_password" shanflow_shadow)
JWT_ACCESS_SECRET=${jwt_secret}
ENV
echo "Database prepared and .env written (not printed)."
