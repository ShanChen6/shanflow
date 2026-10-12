# Task implementation — Prompt 2.3B

Date: 2026-10-12. Scope: local development under
[IA-001](../security/local-development-authorization.md). Sources:
[Prisma blueprint](prisma-modeling-plan.md), [Design Freeze](data-decisions.md),
[domain](domain-analysis.md), [ERD](erd.md), [authorization policy](authorization-matrix.md)
and [Project implementation](project-implementation.md). This completes the five
core database entities. It adds no API, service, DTO, Kanban UI or extension models.

## Model and storage contract

`Task` maps to `tasks` with the exact frozen fields:

| Field | PostgreSQL mapping | Rule/default |
| --- | --- | --- |
| id | uuid PK | Prisma uuid(); SQL inserts supply UUID |
| workspaceId | workspace_id uuid | Required Workspace boundary |
| projectId | project_id uuid nullable | NULL means Inbox |
| title | text | Required and nonblank |
| description | text nullable | Optional |
| status | task_status | TODO default; TODO/IN_PROGRESS/DONE/CANCELED |
| priority | task_priority | MEDIUM default; LOW/MEDIUM/HIGH/URGENT |
| dueAt | due_at timestamptz(3) nullable | UTC instant, no deadline when NULL |
| assigneeId | assignee_id uuid nullable | User identity through scoped membership |
| createdById | created_by_id uuid | Required creator identity through membership |
| position | bigint/int8 | Required, nonnegative, no shared default |
| version | integer/int4 | Default 1, must be at least 1 |
| completedAt | completed_at timestamptz(3) nullable | Required exactly for DONE |
| deletedAt | deleted_at timestamptz(3) nullable | NULL live; non-NULL soft-deleted |
| createdAt | created_at timestamptz(3) | now() |
| updatedAt | updated_at timestamptz(3) | now() + Prisma @updatedAt |

No ProjectStatus, deleted/status wrapper entity, checklist, tag, comment, attachment,
recurrence or auth model. Task itself has all four inverse/named relations required
by Prisma; no redundant direct creator/assignee User FKs were added.

## Relationships and database invariants

- `workspace_id → workspaces.id` is required.
- `(workspace_id, project_id) → projects(workspace_id,id)` rejects cross-workspace
  Projects. PostgreSQL MATCH SIMPLE permits project_id NULL while the standalone
  Workspace FK still applies, so Inbox has no fake Project.
- `(workspace_id, created_by_id) → workspace_members(workspace_id,user_id)` requires
  creator membership existence in the same Workspace.
- `(workspace_id, assignee_id) → workspace_members(workspace_id,user_id)` applies
  when assignee is non-NULL; MATCH SIMPLE permits unassigned Tasks.
- All four FKs are validated, non-deferrable, ON DELETE RESTRICT / ON UPDATE NO ACTION.
- UNIQUE(workspace_id,id) is an all-row scoped target for future child relations.

The pinned Prisma 7.10 schema successfully represents one required workspace scalar
shared by the standalone Workspace relation and three compound relations. Validation,
client generation and real CRUD relation queries pass; no cloned tenant columns,
relationMode workaround or manual-only FK representation was necessary.

Four manual CHECK constraints enforce: btrim(title) nonblank; DONE if and only if
completed_at is non-NULL; position >= 0; version >= 1. CANCELED is not completion.
Soft-deleted DONE rows retain completion because deleted_at is independent.

## Ordering, soft delete and query indexes

Two immediate partial unique indexes implement ADR-009:

| Index | Unique key | Predicate |
| --- | --- | --- |
| task_live_project_position_unique | workspace_id, project_id, status, position | deleted_at IS NULL AND project_id IS NOT NULL |
| task_live_inbox_position_unique | workspace_id, status, position | deleted_at IS NULL AND project_id IS NULL |

Together they cover every live row. Soft-deleted rows keep their historical position
but release the live slot. Restore is one atomic update that must first allocate a
free destination rank; blindly clearing deletedAt is rejected when the stored rank
now conflicts. Archived Project Tasks remain live and continue reserving positions.

The indexes are immediate, not deferrable. A direct two-row rank swap fails on the
first colliding update, verified in integration tests. Future TaskService must lock
the Workspace, re-read neighbors/versions, allocate unused nonnegative temporary
int64 positions, then write final 1024*n ranks in one transaction. It must preflight
capacity and retry the whole transaction only for approved transient conflicts.
This schema proves final persisted uniqueness; it does not complete concurrent
create/reorder/rebalance behavior.

All-row FK indexes cover workspace+project, workspace+creator and workspace+assignee,
including tombstones. Additional partial indexes support live workspace/status,
live assignment, live deadlines and trash queries. Catalog verification confirms
all eleven Task indexes are valid/ready with exact predicates; manual indexes are
not represented by ordinary Prisma datamodel diff and must remain migration-reviewed.

Position is a signed PostgreSQL bigint constrained only to the approved nonnegative
range; the maximum int64 value is accepted. API work must serialize it as a decimal
string. JavaScript JSON.stringify on BigInt and Number conversion are prohibited;
clients send neighbor/destination IDs and expected version rather than calculate ranks.

## Service and direct-SQL limitations

Database constraints prove reference existence and lane integrity, not authorization:

- Membership can be INACTIVE; account can be SUSPENDED. Tests explicitly show an
  INACTIVE assignee still satisfies the FK. Future service must require ACTIVE states.
- Archived Projects still accept Task writes at the DB layer. Service must block all
  ordinary Task mutations until Project restore.
- Transition graph rules and server-owned completion timestamps are not encoded
  beyond DONE/completedAt equivalence. Service must implement the approved graph.
- creator/workspace immutability, role permissions, actor trust and expected-version
  compare-and-update require transactional service checks.
- deleted Tasks remain physically queryable and writable. Repository/service queries
  must default to deletedAt IS NULL and expose trash/restore only through authorized paths.
- The DB permits hard delete by a role with DELETE and direct changes to dueAt,
  timestamps, ranks and version when checks pass. No business hard-delete API exists.
- Assignee removal must unassign every Task, including deleted/archived-Project rows,
  before deactivating/removing membership; creator membership remains for provenance.

## Migration and safety evidence

Migration `20261012003450_add_task` was generated with migrate dev --create-only,
supplemented with four CHECKs, two partial unique indexes, four partial query indexes
and BEGIN/COMMIT, reviewed, then replayed on disposable `shanflow_shadow`. Shadow
catalog verified 16 columns/types, all CHECKs/indexes, four MATCH SIMPLE FKs and
transaction-rolled-back Inbox, duplicate rank, cross-workspace, completion and
soft-delete cases before main apply.

Apply used migrate deploy with `shanflow_migrator` against verified PostgreSQL 18.6
at 127.0.0.1:55432, database shanflow/public. Preflight confirmed the separate shadow,
healthy container, existing named volume, schema ownership, runtime/migrator least
privilege, empty local business tables and four existing checksums. No bootstrap role,
reset, db push, provisioning, destructive SQL, data rewrite, dependency change or
edit to prior migration was used.

Post-apply catalog confirms table ownership by migrator, runtime CRUD grants, exact
enums/native types/FKs/CHECKs/index definitions and five matching migration checksums.
Prisma status is current and diff is empty. All test fixtures were removed by random
IDs in child-before-parent transactions; User, Workspace, WorkspaceMember, Project
and Task contain zero rows, matching the preflight inventory. PostgreSQL and the same
persistent volume remain healthy.

Recovery: stop and inspect failed migration/transaction state. Use a reviewed forward
fix after a successful apply. Do not edit applied history, reset databases, delete
volumes or broadly delete business rows. This additive empty-table migration required
no backfill; installations with existing parent rows remain unchanged.

## Verification

- Prisma format/validate/generate pass on 7.10.0; PrismaService remains the only
  application PrismaClient provider and real relation queries use it.
- 55 database integration tests pass across all five core entities; 19 are Task tests.
  Task coverage includes CRUD/defaults/timestamps/relations, Inbox, scoped FKs,
  inactive membership limitation, all enum values, completion combinations, invalid
  enum values, soft-delete/restore collision, both lane guards, lane separation by
  status/Project/Workspace, immediate swap failure, int64 maximum, validation checks,
  parent restrictions, optional MATCH SIMPLE relations and runtime DDL denial.
- 52 existing unit tests and 4 HTTP E2E tests pass. Real-database health live/ready
  coverage remains part of test:db.
- API/root lint, typecheck and build pass; existing frontend PostCSS lint warning
  remains unchanged. Existing tests were not modified. git diff --check passes.
- Fresh dependency audit remains two HIGH findings only: deepmerge-ts and braces
  (SEC-01/SEC-02), with no suppression or dependency change.

Run from repository root with the verified local environment:

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

SEC-01/SEC-02 remain HIGH/OPEN. Staging/production remain NOT APPROVED. No commit or
push. Review the complete core schema before approving any API/service phase.
