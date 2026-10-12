-- CDB-001: the runtime role must not read or mutate Prisma migration history.
-- Default privileges grant CRUD to shanflow_app on tables the migrator creates,
-- which includes public._prisma_migrations. Guarded so environments or shadow
-- databases without the managed role or without the history table (Prisma's
-- shadow database does not create it) still replay this migration.
BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'shanflow_app')
     AND to_regclass('public._prisma_migrations') IS NOT NULL THEN
    REVOKE ALL ON TABLE public._prisma_migrations FROM PUBLIC, shanflow_app;
  END IF;
END
$$;

COMMIT;
