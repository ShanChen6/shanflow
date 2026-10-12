-- Executed by provision-roles.py as bootstrap, inside a single transaction.
-- Passwords are supplied in memory by the runner, never stored in this file.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class WHERE relowner = 'shanflow_app'::regrole
  ) THEN
    RAISE EXCEPTION 'Runtime role owns objects; audit ownership before provisioning';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_auth_members
    WHERE member IN ('shanflow_app'::regrole, 'shanflow_migrator'::regrole)
  ) THEN
    RAISE EXCEPTION 'Managed roles have unexpected memberships; audit them before provisioning';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_database
    WHERE datdba = 'shanflow_app'::regrole
       OR (datdba = 'shanflow_migrator'::regrole AND datname <> 'shanflow_shadow')
  ) THEN
    RAISE EXCEPTION 'Runtime must not own databases; migrator may own only shanflow_shadow';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_namespace
    WHERE nspowner = 'shanflow_app'::regrole
  ) THEN
    RAISE EXCEPTION 'Runtime role owns a schema; audit ownership before provisioning';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relowner <> 'shanflow_migrator'::regrole
  ) THEN
    RAISE EXCEPTION 'Public objects have another owner; audit and transfer ownership explicitly';
  END IF;
END
$$;

ALTER ROLE shanflow_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOREPLICATION NOBYPASSRLS NOINHERIT;
ALTER ROLE shanflow_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOREPLICATION NOBYPASSRLS NOINHERIT;

-- This is a dedicated development cluster. PUBLIC CONNECT is additive:
-- revoking it only from a named role would not restrict connections.
SELECT format('REVOKE CONNECT ON DATABASE %I FROM PUBLIC, shanflow_app, shanflow_migrator', datname)
FROM pg_database
\gexec

REVOKE ALL ON DATABASE :"database" FROM PUBLIC, shanflow_app, shanflow_migrator;
GRANT CONNECT ON DATABASE :"database" TO shanflow_app, shanflow_migrator;

ALTER SCHEMA public OWNER TO shanflow_migrator;
REVOKE ALL ON SCHEMA public FROM PUBLIC, shanflow_app;
GRANT USAGE ON SCHEMA public TO shanflow_app;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC, shanflow_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO shanflow_app;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC, shanflow_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO shanflow_app;

-- CDB-001: Prisma migration bookkeeping is migrator-only. The blanket grant
-- above (and the default privileges below, which apply when Prisma first
-- creates the table) would otherwise give runtime CRUD on it. The same revoke
-- is repeated by a migration so fresh databases are correct without a rerun.
DO $$
BEGIN
  IF to_regclass('public._prisma_migrations') IS NOT NULL THEN
    REVOKE ALL ON TABLE public._prisma_migrations FROM PUBLIC, shanflow_app;
  END IF;
END
$$;

-- Remove both global and schema-local defaults, then grant the exact runtime
-- privileges. Defaults apply to objects created AS shanflow_migrator.
ALTER DEFAULT PRIVILEGES FOR ROLE shanflow_migrator
  REVOKE ALL ON TABLES FROM PUBLIC, shanflow_app;
ALTER DEFAULT PRIVILEGES FOR ROLE shanflow_migrator IN SCHEMA public
  REVOKE ALL ON TABLES FROM PUBLIC, shanflow_app;
ALTER DEFAULT PRIVILEGES FOR ROLE shanflow_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO shanflow_app;
ALTER DEFAULT PRIVILEGES FOR ROLE shanflow_migrator
  REVOKE ALL ON SEQUENCES FROM PUBLIC, shanflow_app;
ALTER DEFAULT PRIVILEGES FOR ROLE shanflow_migrator IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM PUBLIC, shanflow_app;
ALTER DEFAULT PRIVILEGES FOR ROLE shanflow_migrator IN SCHEMA public
  GRANT USAGE ON SEQUENCES TO shanflow_app;

-- Runtime is not granted execution of application routines implicitly.
REVOKE ALL ON ALL ROUTINES IN SCHEMA public FROM PUBLIC, shanflow_app;
ALTER DEFAULT PRIVILEGES FOR ROLE shanflow_migrator
  REVOKE EXECUTE ON ROUTINES FROM PUBLIC, shanflow_app;
ALTER DEFAULT PRIVILEGES FOR ROLE shanflow_migrator IN SCHEMA public
  REVOKE EXECUTE ON ROUTINES FROM PUBLIC, shanflow_app;

-- pg_catalog is implicitly searched first; public remains the CREATE target.
ALTER ROLE shanflow_app IN DATABASE :"database" SET search_path = public;
ALTER ROLE shanflow_migrator IN DATABASE :"database" SET search_path = public;
