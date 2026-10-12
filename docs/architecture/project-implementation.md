# Project implementation — Prompt 2.3A

Date: 2026-10-12. Scope: local development under
[IA-001](../security/local-development-authorization.md). Sources:
[Prisma blueprint](prisma-modeling-plan.md), [Design Freeze](data-decisions.md),
[domain](domain-analysis.md), [ERD](erd.md) and [authorization policy](authorization-matrix.md).
No ADR changes, API, Task model or authorization guard were introduced.

## Model, relation and archive semantics

`Project` maps to `projects` with the complete approved blueprint:

| Field | PostgreSQL mapping | Rule/default |
| --- | --- | --- |
| id | uuid primary key | Prisma uuid(); direct SQL must supply UUID |
| workspaceId | workspace_id uuid | Required Workspace relation |
| name | text | Required, nonblank; no business uniqueness |
| description | text nullable | NULL by default |
| archivedAt | archived_at timestamptz(3) nullable | NULL active; non-NULL archived |
| color | text nullable | Future application allowlist |
| icon | text nullable | Future application allowlist |
| createdAt | created_at timestamptz(3) | now() |
| updatedAt | updated_at timestamptz(3) | now() + Prisma @updatedAt |

Color and icon are included because the frozen blueprint approves them even though
the prompt's required-field shortlist omits them. No ProjectStatus enum, deletedAt,
owner, slug or other fields. Workspace gains only the inverse `projects` relation.

`archivedAt = NULL` means active; a timestamp means archived. Archive/restore is an
ordinary nullable timestamp update and never deletes the Project. There are no Tasks
yet. Future service code must block ordinary Task mutations while its Project is
archived and must restore the Project before Task restoration. Database constraints
do not implement authorization, transition policy, automatic child changes or a
hard-delete workflow. Prisma @updatedAt does not maintain timestamps for direct SQL.

## Constraints and indexes

- `projects_workspace_id_fkey`: workspace_id → workspaces.id, ON DELETE RESTRICT /
  ON UPDATE NO ACTION, validated and non-deferrable. Project cannot omit Workspace.
- `projects_workspace_id_id_key`: all-row UNIQUE(workspace_id, id), with columns in
  that order and no predicate. Future nullable Task(workspaceId, projectId) can use
  it as the same-workspace FK target. Archived rows remain covered.
- `projects_workspace_archive_created_id_idx` supports workspace/archive listings.
- `projects_name_nonblank_check`: btrim(name) must be nonempty.
- Project names are case-sensitive and intentionally not unique, globally or within
  a Workspace. No approved max length; text storage and a long-name test confirm
  no invented varchar bound. Color/icon allowlists remain future application checks.

The UUID primary key makes `(workspace_id,id)` logically redundant for identity,
but PostgreSQL needs the exact composite unique target for the future scoped Task FK.
That Task relation is deliberately absent from this implementation.

## Migration and safety evidence

Migration `20261012003002_add_project` was generated with migrate dev --create-only,
supplemented with the manual nonblank CHECK and BEGIN/COMMIT, reviewed, replayed on
the disposable `shanflow_shadow`, then applied to local `shanflow/public` through
`migrate deploy` using `shanflow_migrator`. It only creates the table, constraints
and indexes. No data rewrite, reset, db push, destructive statement, permission
change or edit to any prior migration occurred.

Preflight confirmed PostgreSQL 18.6 at 127.0.0.1:55432, healthy Compose container,
the existing `shanflow_postgres_data` volume, separate shadow database, schema
ownership, runtime/migrator least privilege and three existing checksums. User,
Workspace and WorkspaceMember inventories were empty on this local instance.
Shadow catalog verified all nine columns/types, required workspace, name CHECK,
three indexes, FK actions and compound-key lookup using rolled-back fixtures.

After apply, catalog verification confirms table owner `shanflow_migrator`, runtime
SELECT/INSERT/UPDATE/DELETE grants, exact FK/index definitions, no ProjectStatus,
and four matching applied migration checksums. Prisma reports current migration
status and no schema difference. All four fixture tables contain zero rows after
ID-scoped child-before-parent cleanup. Runtime DDL remains denied.

Recovery: stop and inspect a failed migration/transaction before retry. For an
already-applied issue, create a reviewed forward fix. Do not edit applied SQL/history,
reset databases, delete volumes or broadly remove rows. This additive migration
needed no backfill; an existing installation's Workspace rows remain unchanged.

## Verification

- Prisma format/validate/generate pass with Prisma 7.10.0; PrismaService remains the
  sole application client/provider.
- 36 database integration tests pass across User, Workspace, WorkspaceMember and
  Project; 7 are Project-specific.
- Project tests cover UUID/defaults/timestamps, all nullable fields, inverse relation,
  runtime CRUD, composite selector, invalid/missing Workspace, archive/restore,
  nonblank/duplicate/case-distinct/long names, parent RESTRICT/NO ACTION and DDL denial.
- 52 unit tests and 4 HTTP E2E tests pass, including existing real-database
  health/live and health/ready coverage in the DB suite.
- API lint, typecheck and build pass; root monorepo lint/typecheck/build pass.
  Existing tests were not changed. git diff --check passes.
- Fresh audit remains two HIGH findings only: deepmerge-ts and braces
  (SEC-01/SEC-02). No audit suppression or dependency change.

Run from root with the verified local environment:

```bash
pnpm --filter api db:validate
pnpm --filter api db:generate
pnpm --filter api db:migrate:status
pnpm --filter api test:db
pnpm --filter api test
pnpm --filter api test:e2e
pnpm lint
pnpm typecheck
pnpm build
```

SEC-01/SEC-02 remain HIGH/OPEN. Staging and production remain NOT APPROVED.
No commit or push. Review this implementation before a separate Task-model task.
