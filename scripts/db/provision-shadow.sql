-- Bootstrap only, development only. CREATE DATABASE must run outside BEGIN.
-- Serialize concurrent provisioning; never drop/recreate an existing database.
SELECT pg_advisory_lock(73914, 13);
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_database
    WHERE datname = 'shanflow_shadow' AND datdba <> 'shanflow_migrator'::regrole
  ) THEN
    RAISE EXCEPTION 'Existing shadow database has another owner; audit before provisioning';
  END IF;
END
$$;

-- Initially disallow connections so PUBLIC cannot connect before ACL setup.
SELECT 'CREATE DATABASE shanflow_shadow OWNER shanflow_migrator TEMPLATE template0 ALLOW_CONNECTIONS false'
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'shanflow_shadow')
\gexec

BEGIN;
REVOKE ALL ON DATABASE shanflow_shadow FROM PUBLIC, shanflow_app;
GRANT CONNECT ON DATABASE shanflow_shadow TO shanflow_migrator;
ALTER DATABASE shanflow_shadow ALLOW_CONNECTIONS true;
COMMIT;
SELECT pg_advisory_unlock(73914, 13);

-- A separate connection is required for schema privileges in shadow database.
\connect shanflow_shadow
BEGIN;
ALTER SCHEMA public OWNER TO shanflow_migrator;
REVOKE ALL ON SCHEMA public FROM PUBLIC, shanflow_app;
COMMIT;
