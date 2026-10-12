# Workspace implementation — Prompt 2.2C

Date: 2026-10-12. Authority: [IA-001](../security/local-development-authorization.md),
local development only. Design: [blueprint](prisma-modeling-plan.md), ADR-002/008/011
in [data decisions](data-decisions.md). Existing ADRs and freeze are unchanged.

## Schema and constraints

`Workspace` maps to `workspaces`: UUID `id` (Prisma uuid()), required text `name`,
UUID `ownerId` mapped to `owner_id`, `type` PERSONAL/TEAM (default PERSONAL),
`createdAt`/`updatedAt` mapped to timestamptz(3) columns. Creation timestamps default
to now(); Prisma updates updatedAt. Direct SQL updates must set updated_at explicitly.
User gains only the inverse `ownedWorkspaces` relation, with no new User columns.

`WorkspaceOwner` uses `owner_id → users.id`, ON DELETE RESTRICT / ON UPDATE NO ACTION,
non-deferrable. An ordinary owner index covers TEAM lookup and FK checks. The manual
`workspaces_personal_owner_unique` index enforces UNIQUE(owner_id) WHERE type=PERSONAL.
All persisted workspaces count because MVP has no archive/delete lifecycle fields.
TEAM rows are outside that unique predicate. A manual btrim(name) nonblank CHECK
rejects empty/space-only names. No WorkspaceMember, Project, Task or ownership triggers.

Only owner existence is currently enforced. Matching ACTIVE OWNER membership,
exactly-one OWNER and atomic owner/member bootstrap remain incomplete. WorkspaceMember
is the next schema stage; the complete consistency protocol still needs the service
transactions/guards described by ADR-011. This migration does not expose business APIs.

## Migration and verification evidence

`20261012001633_add_workspace` was generated with migrate dev --create-only, reviewed,
then replayed in the dedicated disposable shanflow_shadow database. Shadow catalog
confirmed the partial predicate and FK actions before apply. SQL creates only the
workspace enum/table/indexes/constraints, wrapped in BEGIN/COMMIT; it does not rewrite
User data or change init_user. Apply used migrate deploy with shanflow_migrator on
verified 127.0.0.1:55432/shanflow/public, PostgreSQL 18.6, existing named volume.
No reset, db push, provisioning or elevated-role migration was used.

Preflight verified runtime/migrator identities and absence of elevated role flags,
schema ownership, separate empty-of-user-data shadow, healthy Compose container and
current init_user history. Main users was empty before migration. After tests, users
and workspaces both contain zero rows. Fixture cleanup targets allocated IDs only;
no broad data deletion is used. Both applied migration checksums match local files.

Verification passed: schema validation/generation; two applied migrations; no Prisma
schema diff; direct catalog checks of six native columns, three indexes, name CHECK,
FK actions, migrator table ownership and runtime CRUD grants. Manual partial-index
and CHECK verification must continue separately from Prisma datamodel diff.

- 15 database integration tests (8 User, 7 Workspace).
- 52 unit tests, including PrismaService singleton/lifecycle checks.
- 4 existing HTTP E2E tests; real-database live/ready endpoints also pass in test:db.
- API lint, typecheck, build and git diff --check pass.
- Runtime CREATE is denied by the existing User suite; Workspace tests also verify
  ALTER/DROP denied with PostgreSQL 42501 and transaction rollback safeguards.
- Workspace tests verify PERSONAL default/duplicates, multiple TEAM, invalid owner,
  UUID/timestamps, CRUD, owner delete/update restrictions and blank-name rejection.

Re-run from repository root, with local .env credentials and PostgreSQL available:

```bash
pnpm --filter api db:validate
pnpm --filter api db:generate
pnpm --filter api db:migrate:status
pnpm --filter api test:db
pnpm --filter api test
pnpm --filter api test:e2e
pnpm --filter api lint
pnpm --filter api typecheck
pnpm --filter api build
```

Recovery: investigate failed migrations before retrying; use a reviewed forward fix
for any applied schema issue. Do not edit applied SQL/history, reset data or drop
workspaces as an automatic rollback. This additive migration required no data backfill.

Dependency audit remains two HIGH findings (deepmerge-ts / braces, SEC-01/SEC-02),
zero moderate/critical; audit exits nonzero as expected. Dependencies were unchanged.
Staging/production are NOT APPROVED. No commit/push. Review this result before the
separate WorkspaceMember task.

References: [PostgreSQL partial indexes](https://www.postgresql.org/docs/18/indexes-partial.html),
[Prisma 7 referential actions](https://www.prisma.io/docs/orm/v7/prisma-schema/data-model/relations/referential-actions).
