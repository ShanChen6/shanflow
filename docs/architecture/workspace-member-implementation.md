# WorkspaceMember implementation — Prompt 2.2D

Date: 2026-10-12. Local implementation authorized by
[IA-001](../security/local-development-authorization.md). Sources:
[blueprint](prisma-modeling-plan.md), [11 ADR / Design Freeze](data-decisions.md),
[authorization policy](authorization-matrix.md), [Workspace implementation](workspace-implementation.md).
No ADR changes, APIs, authorization guards or ownership transfer service in this step.

## Model and relations

`WorkspaceMember` maps to `workspace_members`, with eight required scalar fields:

| Field | PostgreSQL mapping | Default |
| --- | --- | --- |
| id | uuid, primary key | Prisma uuid(), not a database UUID default |
| workspaceId | workspace_id uuid | Required Workspace FK |
| userId | user_id uuid | Required User FK |
| role | workspace_role enum: OWNER / ADMIN / MEMBER | MEMBER |
| membershipStatus | membership_status enum: ACTIVE / INACTIVE | ACTIVE |
| joinedAt | joined_at timestamptz(3) | now(), original join time |
| createdAt | created_at timestamptz(3) | now() |
| updatedAt | updated_at timestamptz(3) | now() + Prisma @updatedAt |

The blueprint names the field `membershipStatus`, not `status`, and requires
`joinedAt`. Reactivation changes status without rewriting joinedAt. Direct SQL can
still overwrite joined_at; the future service must preserve it. Direct SQL updates
also need to maintain updated_at explicitly; @updatedAt operates through Prisma.

Relations: `WorkspaceMembership` (Workspace.members ↔ WorkspaceMember.workspace)
and `MembershipUser` (User.memberships ↔ WorkspaceMember.user). Existing
WorkspaceOwner is unchanged; inverse relation lists add no User/Workspace columns.

## Database constraints and manual SQL

- Composite UNIQUE(workspace_id, user_id) applies to all membership statuses/roles.
- Both membership FKs use ON DELETE RESTRICT / ON UPDATE NO ACTION, non-deferrable.
- `workspace_members_one_owner_unique`: UNIQUE(workspace_id) WHERE role='OWNER'.
  It includes INACTIVE owners. Status is deliberately absent from the predicate:
  an inactive OWNER must still block another OWNER, per S-02 / ADR-011.
- Lookup indexes cover (user_id, membership_status, workspace_id) and
  (workspace_id, membership_status). Including PK, pair unique and partial unique,
  the table has five indexes.
- Enums reject values outside the approved sets; no VIEWER/invitation state.

The OWNER index is manual migration SQL, without a Prisma preview flag. It enforces
uniqueness only on qualifying rows, as described in
[PostgreSQL partial indexes](https://www.postgresql.org/docs/18/indexes-partial.html).
Preserve it in future migration reviews and verify the catalog, not just Prisma diff.
Explicit FK actions avoid default update cascades; see
[Prisma 7 referential actions](https://www.prisma.io/docs/orm/v7/prisma-schema/data-model/relations/referential-actions).

## Ownership invariant coverage and direct-SQL gaps

| Invariant | Current enforcement |
| --- | --- |
| Workspace.ownerId references an existing User | Existing Workspace FK |
| Membership references existing Workspace/User | New membership FKs |
| One membership per workspace/user | Composite unique index |
| At most one OWNER per workspace, including INACTIVE | Manual partial unique index |
| At least one OWNER membership exists | Not enforced; future service transaction/final check |
| OWNER userId equals Workspace.ownerId | Not enforced; future service protocol |
| OWNER membership is ACTIVE | Not enforced; future service protocol |
| Account ACTIVE / authorized actor / PERSONAL owner-only membership | Not enforced by FKs; future authorization and service checks |

Direct SQL with the runtime CRUD role can create a Workspace with no membership,
insert a mismatched INACTIVE OWNER, demote/delete the OWNER, or change ownerId to
another existing User. Tests deliberately demonstrate accepted inconsistent states
on isolated fixture IDs; they do not expect DB rejection where no guard exists.
No circular FK, custom trigger or complete ownership-integrity claim is introduced.

Future bootstrap flow: validate/lock the existing active User, then in one transaction
create Workspace(ownerId=user.id), create WorkspaceMember(userId=user.id,
role=OWNER, membershipStatus=ACTIVE), check the final matching owner state, commit.
There is no circular FK: Workspace references User, then membership references
the already-created Workspace/User. A positive integration test commits this order
and verifies the relation after commit; it is a contract example, not a service.

Future mutations must follow ADR-011 locks (Users in ID order → Workspace → members),
recheck permissions and expected state while locked, reject ordinary removal or
deactivation of the current owner, and atomically validate the final state. For a
future approved TEAM transfer, demote the old OWNER before promoting the new OWNER
because the partial index is immediate. Transactions alone do not guarantee these
checks, and service enforcement cannot protect arbitrary direct SQL. Production
business writes must wait for the missing service/authorization controls.

## Migration and safety evidence

Migration: `20261012002238_add_workspace_member`. Generated with migrate dev
--create-only, supplemented with the role-only partial unique index and BEGIN/COMMIT,
reviewed, replayed on shanflow_shadow, then applied using migrate deploy on local
shanflow/public. SQL adds two enums, one table, five indexes and two FKs; no data
rewrite, destructive statement or edit to either previously applied migration.

Preflight verified loopback 127.0.0.1:55432, PostgreSQL 18.6, healthy Compose container,
existing shanflow_postgres_data volume, distinct shadow target, schema owner and
runtime/migrator identities with no elevated flags or role memberships. Main and
shadow User/Workspace tables were empty. Both existing checksums matched history.
Shadow catalog and rolled-back SQL fixtures verified that an INACTIVE OWNER blocks
a second OWNER before main apply. Shadow contained only disposable migration objects.

Main apply used shanflow_migrator, not bootstrap. Runtime shanflow_app received
SELECT/INSERT/UPDATE/DELETE through existing default privileges; no role/provisioning
changes. Catalog verifies migrator ownership, native column types/defaults, exact
enums, FK actions, pair uniqueness, partial predicate and no custom ownership triggers.
All three migration checksums match; migration status is current and Prisma schema
diff is empty. User, Workspace and membership fixture rows are all zero after cleanup,
matching the initial empty data inventory. The same persistent volume remains healthy.

Recovery: stop on a failed migration and inspect history/transaction outcome. Use a
reviewed forward fix after successful apply; never edit applied SQL/history, reset
the database or remove existing volume/data to resolve drift. Existing Workspace
rows on another local installation would not be auto-backfilled with memberships;
their ownership reconciliation must be reviewed before opening business writes.

## Verification

- Prisma format/validate/generate pass with pinned 7.10.0; no new PrismaClient provider.
- 29 DB integration tests pass: existing User 8, Workspace 7, WorkspaceMember 14.
- New tests cover CRUD, UUID/defaults/timestamps, relation/inverse lookups, pair
  duplicates across statuses, both invalid FKs, OWNER insert/promotion uniqueness
  for ACTIVE/INACTIVE, ADMIN/MEMBER, joinedAt preservation, all four parent delete/
  update restrictions, matching-owner bootstrap, direct-SQL gaps and DDL denial.
- Runtime ALTER/DROP returns PostgreSQL 42501; unexpected successful probes roll back.
  Existing User tests also verify CREATE denied. Fixture cleanup targets only random
  per-test Workspace/User IDs, in child-before-parent order within a transaction.
- 52 existing unit tests and 4 E2E tests pass. Existing real-DB live/ready tests pass.
- API and root monorepo lint/typecheck/build pass. The sandboxed Next.js build
  initially exited unsuccessfully; the build passed outside the sandbox with no
  source change. No old tests were modified. git diff --check passes.
- Fresh dependency audit: two HIGH (deepmerge-ts / braces, SEC-01/SEC-02), zero other
  severities. Nonzero audit exit is retained; no suppression or dependency changes.

Run from the repository root with the verified local PostgreSQL and .env available:

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

SEC-01/SEC-02 remain HIGH/OPEN. Staging/production NOT APPROVED. No commit/push.
Review this result before requesting Project implementation; ownership services
remain a separate future task.
