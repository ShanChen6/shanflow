# Shanflow Core Database Integration & Security Audit

Date: 2026-10-12 (Asia/Ho_Chi_Minh)  
Scope: Prompt 2.4A, audit only  
Target: local PostgreSQL 18.6 database `shanflow`, schema `public`  
Authorization: IA-001 **APPROVED FOR LOCAL DEVELOPMENT**; staging and production **NOT APPROVED**

## 1. Executive Summary

The five-model core database is internally consistent with the accepted ERD, 11
ADRs, Design Freeze and Prisma Modeling Blueprint. Prisma validation passes, the
database matches the Prisma schema, all five recorded migration checksums match
the SQL files, and the complete SQL sequence replayed successfully in an isolated,
temporary schema on `shanflow_shadow`. The main database was not reset or mutated,
and the replay schema was removed after verification.

Database constraints provide strong referential tenant consistency for Task to
Project and Task to creator/assignee membership. They do not provide actor
authorization or row-level security. The accepted ADR-011 ownership baseline also
does not enforce exactly one matching ACTIVE OWNER for every Workspace. Task
membership activity, account activity, archived-project policy, lifecycle
transitions and reorder locking remain service responsibilities.

Local schema work is ready. Auth implementation can begin locally with its own
modeling and security review. Workspace and Task APIs must not be exposed until
the service authorization and transaction protocols identified here are
implemented and tested. Staging and production remain blocked by SEC-01 and
SEC-02, both High/Open, as well as the missing API authorization layer.

## 2. Audit Scope and Method

Reviewed evidence:

- `domain-analysis.md`, `erd.md`, `authorization-matrix.md`,
  `data-decisions.md` and `prisma-modeling-plan.md`.
- The four model implementation records and IA-001/RA-001/foundation audit.
- `schema.prisma`, `prisma.config.ts`, PrismaService, five migration SQL files and
  all existing database integration tests.
- Live PostgreSQL catalogs for columns, constraints, indexes, roles, ownership,
  ACLs, RLS flags and `_prisma_migrations`.
- Prisma validate/status/diff; all test suites; root lint/typecheck/build; fresh
  dependency audit; Docker health.

No schema, migration, application source, role, business data or dependency was
changed. The only repository change from this audit is this document.

Classification meanings:

| Classification | Meaning |
| --- | --- |
| MATCH | Implementation and live catalog conform to the approved design. |
| INTENTIONAL DEVIATION | Approved semantics are preserved through reviewed manual SQL or an explicitly documented implementation choice. |
| MISMATCH | Implementation conflicts with an accepted design requirement. |
| NOT VERIFIED | Evidence was unavailable or a safe audit was not possible. |

## 3. Schema Conformance Matrix

| Area | Classification | Evidence and conclusion |
| --- | --- | --- |
| User | MATCH | UUID Prisma default; canonical unique `email`; required nonblank `displayName`; nullable `avatarUrl`; `AccountStatus` ACTIVE/SUSPENDED with ACTIVE default; millisecond `timestamptz` timestamps; table `users`. |
| Workspace | MATCH | UUID; required name/owner; PERSONAL/TEAM with PERSONAL default; User FK RESTRICT/NO ACTION; no lifecycle fields; table `workspaces`. |
| WorkspaceMember | MATCH | UUID; required Workspace/User; OWNER/ADMIN/MEMBER; ACTIVE/INACTIVE; MEMBER/ACTIVE defaults; `joinedAt`, created/updated timestamps; unique workspace/user; RESTRICT/NO ACTION FKs. |
| Project | MATCH | UUID; required Workspace/name; nullable description/archive/color/icon; millisecond `timestamptz`; Workspace FK; scoped `(workspaceId,id)` unique target; no name uniqueness. |
| Task | MATCH | All 16 approved fields and nullability; TODO/MEDIUM/version=1 defaults; BigInt position; nullable Project/assignee/deadline/completion/deletion; UUID identity references; millisecond `timestamptz`; table `tasks`. |
| Enum values | MATCH | Catalog contains exactly the approved values for account, workspace, membership, task status and task priority enums. |
| Naming | MATCH | Prisma camelCase maps consistently to snake_case tables/columns and named constraints/indexes. |
| Native types | MATCH | UUID, TEXT, PostgreSQL enums, BIGINT, INTEGER and TIMESTAMPTZ(3) match the blueprint. |
| Referential actions | MATCH | All business FKs are MATCH SIMPLE, non-deferrable, `ON DELETE RESTRICT`, `ON UPDATE NO ACTION`. |
| Manual checks/indexes | INTENTIONAL DEVIATION | Partial unique indexes and CHECK constraints are represented in migration SQL because they are outside the chosen Prisma schema representation. Schema diff is empty and catalog verification confirms them. |
| Migration grouping | INTENTIONAL DEVIATION | Blueprint M006 guards were bundled into the model migrations before writes were exposed. This preserves the approved semantics and was documented in each implementation record. |

No schema mismatch was found.

Prisma `@default(uuid())` is a client-side default in this setup; catalog columns
do not have a PostgreSQL UUID default. This matches the blueprint and tests, but
direct SQL writers must supply UUIDs.

## 4. Database Constraint Coverage

| Invariant | Database coverage | Remaining boundary |
| --- | --- | --- |
| Canonical unique email | Unique index plus nonempty/trim/lower CHECK. | Normalization before insert remains an application input concern. |
| Nonblank required names/title | CHECKs on User display name, Workspace name, Project name and Task title. | No product-specific maximum length was approved. |
| One persisted PERSONAL Workspace per owner | Partial unique `workspaces_personal_owner_unique`. | Workspace bootstrap and matching owner membership remain transactional service work. |
| One membership per Workspace/User | Compound unique index. | ACTIVE status and account status are not encoded in the FK. |
| At most one OWNER role | Role-only partial unique index, including INACTIVE OWNER. | Existence, ACTIVE state and equality to `Workspace.ownerId` are not enforced. |
| Project belongs to Workspace | Required Project→Workspace FK and scoped `(workspace_id,id)` unique target. | Archived Project edit policy is a service rule. |
| Task belongs to Workspace | Required Task→Workspace FK. | Actor authorization is not implied. |
| Task Project tenant consistency | Compound `(workspace_id,project_id)` FK; nullable Project uses MATCH SIMPLE. | Inbox is valid when `project_id` is null. |
| Creator/assignee tenant consistency | Compound FKs to `(workspace_id,user_id)` membership; assignee nullable. | ACTIVE membership/account and role permissions require service checks. |
| Completion consistency | CHECK enforces DONE iff `completed_at` is non-null. | Allowed status transition graph and timestamp preservation require service logic. |
| Rank/version domain | `position >= 0`, `version >= 1`. | Allocation, increments and optimistic conflict handling require service logic. |
| Live lane rank uniqueness | Separate partial unique indexes for Project and Inbox lanes by Workspace/status/position; deleted rows excluded. | Immediate uniqueness requires a staged reorder algorithm. |
| Parent deletion safety | RESTRICT prevents deletion while referenced. | Empty parents can still be deleted by a role with DELETE; APIs must enforce MVP no-delete rules. |

## 5. Cross-Workspace Isolation

The database enforces referential tenant consistency:

- `Project.workspaceId` must reference an existing Workspace.
- `WorkspaceMember.workspaceId` and `userId` must reference existing rows.
- `Task.workspaceId` is always required.
- A non-null Task `projectId` is valid only through the compound
  `(workspaceId, projectId)` Project key.
- Task `createdById` and non-null `assigneeId` are valid only through compound
  membership keys in the same Workspace.

This prevents cross-workspace Project, creator and assignee references even when
the individual UUIDs exist. It does not decide whether the current caller may
read or mutate a row. `shanflow_app` is a shared database role with table-wide
CRUD, and all core tables have RLS disabled. Actor identity, ACTIVE account and
membership checks, role decisions, workspace-scoped query predicates and
response filtering must be implemented in NestJS. The current system must not be
described as having application authorization or PostgreSQL RLS.

## 6. Ownership Integrity

Current database enforcement:

- `Workspace.ownerId` references a valid User.
- Membership is unique per Workspace/User.
- At most one membership can have role OWNER in a Workspace, including an
  INACTIVE OWNER.
- FKs prevent deleting referenced Users, Workspaces or memberships when dependent
  rows exist.

Current database gaps, accepted and documented by ADR-011:

- A Workspace can commit with no OWNER membership.
- The single OWNER can differ from `Workspace.ownerId`.
- The OWNER membership can be INACTIVE.
- A PERSONAL Workspace can contain additional ADMIN/MEMBER memberships.
- Direct SQL can change `ownerId`, role or membership status without the approved
  ownership-transfer protocol.

Duplicate OWNER is rejected by the partial unique index. Missing, mismatched and
inactive OWNER states are possible. Creation must atomically create Workspace then
matching ACTIVE OWNER membership. TEAM ownership transfer must lock Users in
stable ID order, then the Workspace, then memberships; re-read the expected owner;
demote the old owner before promoting the new one because uniqueness is immediate;
update `ownerId`; validate the final state; and commit or roll back as a unit.
Concurrent transfers need stale-owner rejection and bounded retry for database
conflicts. PERSONAL transfer remains outside MVP.

## 7. Task Lifecycle

Database rules:

- Status is exactly TODO, IN_PROGRESS, DONE or CANCELED.
- Priority is exactly LOW, MEDIUM, HIGH or URGENT.
- DONE requires `completedAt`; every other status requires it to be null.
- `deletedAt` is an independent nullable tombstone.
- Soft-deleted rows remain stored and no longer reserve a live lane position.
- Project, creator and assignee references remain valid across soft delete.

Future TaskService rules:

- Enforce the approved transition graph and retain the prior timestamp on
  DONE→DONE metadata updates.
- Hide deleted tasks from normal reads and mutations; expose them only through an
  authorized trash flow.
- Reject task mutations under an archived Project.
- Require ACTIVE actor/member/account; assignment targets must be ACTIVE members
  with ACTIVE accounts.
- On membership deactivation, unassign live and deleted tasks atomically while
  retaining creator provenance.
- Restore only into an active Project or Inbox, revalidate/clear assignee, allocate
  a new destination position, and reject stale versions.
- Keep `workspaceId` and `createdById` immutable in MVP.

## 8. Ordering and Concurrency

The two partial unique indexes correctly partition live ranks:

- Project lane: Workspace + Project + status + position.
- Inbox lane: Workspace + status + position.
- Different Projects, statuses or Workspaces may reuse a rank.
- Deleted Tasks do not reserve a rank; a conflicting restore is rejected.

The indexes are immediate. Direct rank swaps can fail on the first UPDATE, and a
restore can collide with a position reused after deletion. `version` supports
optimistic concurrency but does not increment itself.

Recommended TaskService transaction protocol:

1. Parse/return BigInt as a decimal string and reject values outside signed int64.
2. Begin a transaction and lock relevant Users in stable order, then the Workspace
   `FOR UPDATE`, then Task rows in stable ID order.
3. Re-read actor/member/account, source/destination Project, deleted state,
   neighbors and expected version after locks are acquired.
4. Allocate gaps of 1024. For rebalance, preflight capacity and move affected rows
   through distinct unused nonnegative staging ranks before final ranks, all in the
   same transaction.
5. Apply status/completion/project/position/version/updatedAt changes atomically.
6. Retry the entire transaction a bounded number of times for unique,
   serialization or deadlock conflicts with fresh reads. Return a conflict for a
   stale client version rather than overwriting it.

The Workspace lock is required to serialize writers into an empty lane, where no
Task row exists to lock. This protocol is designed but not implemented or
concurrency-tested.

## 9. Migration Integrity

| Check | Result |
| --- | --- |
| Migration order | PASS — the five expected migrations are applied in dependency order. |
| Migration status | PASS — database is up to date. |
| Checksums | PASS — every `_prisma_migrations.checksum` equals the SHA-256 of its SQL file. |
| Failed/rolled-back history | PASS — all five are finished, none rolled back, one applied step each. |
| Schema diff | PASS — no difference from configured datasource to `schema.prisma`. |
| Catalog constraints/indexes | PASS — all expected constraints validated and all expected indexes present. |
| Full SQL replay | PASS — all five files replayed in order in a newly created schema on `shanflow_shadow`; five tables, six enum types, 56 constraints and 24 indexes were created; the schema was then removed. |
| Main data preservation | PASS — no main schema mutation; all five business tables contained zero rows before and after test fixture cleanup. |

Migrations 2–5 have explicit `BEGIN`/`COMMIT`. `init_user` has no explicit
transaction boundary. Prisma successfully applied it and the disposable replay
passed, but running that SQL outside a transaction could leave partial objects on
failure. Do not rewrite the applied migration; require explicit transaction review
for future manual migrations and use forward recovery if an applied environment
fails.

The replay tested the repository SQL sequence without using the bootstrap
superuser. It used `shanflow_migrator` in an isolated temporary schema owned by
that role. No database or main schema was created, dropped or reset.

## 10. Database Permissions

| Control | Result |
| --- | --- |
| Runtime identity | `shanflow_app`: LOGIN, no SUPERUSER/CREATEDB/CREATEROLE/REPLICATION/BYPASSRLS, `NOINHERIT`, no role memberships. |
| Migrator identity | `shanflow_migrator`: LOGIN, same cluster-level restrictions, `NOINHERIT`, no role memberships. |
| Main ownership | Database owned by bootstrap `shanflow`; `public` schema and all core tables owned by `shanflow_migrator`. |
| Runtime database scope | CONNECT only to `shanflow`; cannot CONNECT to `postgres` or `shanflow_shadow`. |
| Runtime schema scope | USAGE on main `public`, no CREATE. |
| Runtime data privileges | SELECT/INSERT/UPDATE/DELETE on core tables; no TRUNCATE/REFERENCES/TRIGGER and no DDL. |
| Migrator scope | CONNECT main and shadow; owns schema/objects; no cluster administration. |
| Shadow isolation | Shadow database and `public` schema owned by migrator; app has neither CONNECT nor schema access. |
| Sequences | None exist; default sequence USAGE grant is prepared for future objects. |
| RLS | Disabled on all core tables and migration history. |

One least-privilege defect exists: the migrator's default table ACL granted
`shanflow_app` SELECT/INSERT/UPDATE/DELETE on `_prisma_migrations`. Runtime cannot
execute DDL, but it can corrupt migration history and block or mislead later
deployments. Remediate through reviewed provisioning/ACL changes and add a negative
permission test before any shared environment; do not alter permissions in this
audit.

## 11. Test Coverage

Executed results:

| Suite/check | Result |
| --- | --- |
| Database integration | PASS — 55 tests across User, Workspace, WorkspaceMember, Project and Task. |
| Unit | PASS — 52 tests. |
| HTTP E2E | PASS — 4 tests. |
| Prisma validation/status/diff | PASS. |
| Root lint | PASS with one pre-existing web PostCSS anonymous-default-export warning and zero errors. |
| Root typecheck/build | PASS. |
| Health | PASS — live/ready behavior is covered by integration and E2E tests; PostgreSQL container is healthy. |

Coverage strengths include CRUD/defaults/timestamps, canonical email uniqueness,
PERSONAL uniqueness, membership uniqueness, FK actions, cross-workspace Task
Project/creator/assignee rejection, completion checks, soft-delete slot behavior,
Inbox/Project lane uniqueness, restore collision, BigInt boundary acceptance and
runtime DDL denial.

Coverage gaps:

| Severity | Gap |
| --- | --- |
| HIGH | No implemented authorization/service tests for account status, active membership, roles, scoped reads or object-level mutation permission. |
| HIGH | No WorkspaceService test for atomic owner bootstrap, final invariant enforcement, ownership transfer, stale owner or concurrent transfer/removal races. Existing DB tests intentionally demonstrate direct-SQL gaps. |
| HIGH | No TaskService concurrency tests for empty-lane writers, simultaneous reorder/move/restore, two-phase rebalance, deadlock/serialization retry or optimistic version conflicts. |
| HIGH | No service tests for archived Project mutation denial, transition graph, default soft-delete filtering, restore policy or deactivate-member/unassign race. |
| MEDIUM | Migration replay is verified manually in this audit but is not an automated repeatable test. |
| MEDIUM | No negative permission test prevents runtime access to `_prisma_migrations`; current access is excessive. |
| MEDIUM | No near-capacity rebalance/overflow rollback test; current tests only accept maximum nonnegative bigint as a stored rank. |
| LOW | No query-plan/performance tests with representative data volume. |

No missing database-level test was classified CRITICAL because the current code
does not expose business APIs. The HIGH gaps become release blockers as soon as
those APIs are implemented.

## 12. Security Findings

### CDB-001 — Runtime can mutate Prisma migration history

- **Severity:** MEDIUM.
- **Evidence:** Catalog ACLs give `shanflow_app` SELECT/INSERT/UPDATE/DELETE on
  `public._prisma_migrations`; app has no CREATE/TRUNCATE/TRIGGER privileges.
- **Impact:** A compromised or defective runtime query could corrupt migration
  bookkeeping, causing deployment failure or an incorrect migration status.
- **Recommended action:** Revoke runtime privileges on `_prisma_migrations`, adjust
  provisioning/default-grant handling, and add a negative runtime permission test.
- **Proposed phase:** Database security remediation before staging.

### CDB-002 — Actor authorization and row isolation are absent

- **Severity:** HIGH.
- **Evidence:** Runtime role has table-wide CRUD; RLS is disabled; no Auth,
  Workspace, Project or Task API/service authorization layer exists.
- **Impact:** Exposing business CRUD without scoped service guards could permit
  horizontal cross-workspace access despite referential FK consistency.
- **Recommended action:** Implement authentication first, then centralized ACTIVE
  account/member/role checks and mandatory Workspace predicates; test deny paths.
  Adopt RLS only through a separate ADR and connection-context design if desired.
- **Proposed phase:** Auth and each API implementation, before endpoint exposure.

### CDB-003 — Ownership invariant is only partially enforced

- **Severity:** HIGH.
- **Evidence:** FK and partial unique prevent invalid User and duplicate OWNER, but
  tests prove missing, mismatched and INACTIVE OWNER states can commit.
- **Impact:** Direct SQL or an incorrect service transaction can leave a Workspace
  unmanageable or grant owner authority to the wrong user.
- **Recommended action:** Implement ADR-011 controlled writes and locking with
  atomic bootstrap/transfer tests. Evaluate deferred SQL strengthening separately.
- **Proposed phase:** Workspace API prerequisite.

### CDB-004 — Task policy and concurrency invariants require an unimplemented service

- **Severity:** HIGH.
- **Evidence:** FKs accept INACTIVE members; database accepts writes under archived
  Projects and does not encode transition, immutability, version increment or lock
  protocols. Immediate unique indexes reject direct swaps.
- **Impact:** Races or incomplete checks can produce unauthorized assignment,
  lost updates, incorrect lifecycle state or avoidable reorder failures.
- **Recommended action:** Implement the transaction protocol in sections 7–8 and
  add deterministic multi-connection concurrency tests.
- **Proposed phase:** Task API prerequisite.

### CDB-005 — Initial migration lacks an explicit transaction boundary

- **Severity:** LOW.
- **Evidence:** `init_user/migration.sql` has no `BEGIN`/`COMMIT`; all later files do.
  Applied checksum and disposable replay are valid.
- **Impact:** Manual execution outside a transaction could leave partial enum/table
  state if a statement fails.
- **Recommended action:** Preserve applied history; require transaction-boundary
  review for future SQL and document forward recovery.
- **Proposed phase:** Next migration workflow review.

### SEC-01 — deepmerge-ts stack exhaustion

- **Severity:** HIGH / OPEN.
- **Evidence:** Fresh `pnpm audit --json` reports GHSA-ggr8-5vv4-36mx against
  `deepmerge-ts@7.1.5` through Prisma config, including a production dependency path.
- **Impact:** Crafted recursive graphs reaching the vulnerable merge path can cause
  availability loss. No HTTP reachability was found, but exhaustive absence is not proven.
- **Recommended action:** Reassess compatible Prisma/remediation options under
  RA-001; keep config/tooling inputs trusted; do not suppress the finding.
- **Proposed phase:** Security remediation before staging/production.

### SEC-02 — braces stack exhaustion

- **Severity:** HIGH / OPEN.
- **Evidence:** Fresh audit reports GHSA-vfj7-8cjw-p6xm against `braces@3.0.3`
  through Next lint tooling.
- **Impact:** Deeply nested untrusted glob patterns can cause tooling denial of
  service; current HTTP/runtime reachability was not found.
- **Recommended action:** Reassess the dependency chain and compatible patched
  release; keep tooling inputs trusted; do not suppress or downgrade the finding.
- **Proposed phase:** Security remediation before staging/production.

SQL injection review found no untrusted raw-query construction in application
source. Runtime source uses static Prisma tagged templates for connectivity and
health. Unsafe raw calls are confined to integration tests with fixed DDL probes;
they are not request handlers. This conclusion must be revisited when business APIs
introduce filtering, sorting or search.

Secret handling passed repository checks: root `.env` is ignored, generated Prisma
Client is ignored, and only `.env.example` is tracked. No credential value was
printed or added to this report.

## 13. Risk Register

| Risk | Severity | Status | Release effect | Owner / next phase |
| --- | --- | --- | --- | --- |
| CDB-001 runtime migration-history ACL | MEDIUM | OPEN | Block staging until fixed and retested. | Database security remediation |
| CDB-002 missing authorization/RLS | HIGH | OPEN / expected pre-API | Blocks every business API from exposure. | Auth + API services |
| CDB-003 incomplete owner enforcement | HIGH | OPEN / accepted baseline | Blocks Workspace API exposure. | WorkspaceService |
| CDB-004 task policy/concurrency service absent | HIGH | OPEN | Blocks Task API exposure. | TaskService |
| CDB-005 initial migration transaction boundary | LOW | ACCEPTED HISTORY / monitor | Does not block local work; preserve history. | Migration workflow |
| SEC-01 vulnerable deepmerge-ts | HIGH | OPEN | Blocks staging/production approval. | Dependency security review |
| SEC-02 vulnerable braces | HIGH | OPEN | Blocks staging/production approval. | Dependency security review |
| No RLS | HIGH if service scoping fails | DESIGN CHOICE / future ADR | Requires complete application authorization and tests. | API architecture |
| No automated full migration replay | MEDIUM | OPEN | Add before shared environment promotion. | Database CI future phase |

## 14. Remediation Recommendations

1. Complete Auth storage/modeling review and implement authentication without
   weakening the current database-role separation.
2. Remove runtime CRUD on `_prisma_migrations`; verify default ACL behavior still
   grants core-table CRUD and future sequence usage only where required.
3. Build a single authorization boundary that checks ACTIVE account, ACTIVE
   membership, role and Workspace scope for every business operation.
4. Implement Workspace bootstrap and ADR-011 ownership transactions before
   Workspace endpoints; test concurrent transfers and membership changes.
5. Implement Task lifecycle, archive, soft-delete, assignment, version and ordering
   transaction protocols before Task endpoints; include real multi-connection tests.
6. Automate clean disposable migration replay, checksum verification, schema diff
   and runtime permission denial before shared-environment promotion.
7. Reassess and remediate SEC-01/SEC-02 under RA-001 before requesting staging or
   production approval.

## 15. Implementation Readiness Decision

| Gate | Decision | Basis / condition |
| --- | --- | --- |
| LOCAL DEVELOPMENT READINESS | **READY** | Core schema, migrations, catalog, role separation, tests and replay pass under IA-001. Open risks remain documented. |
| AUTH IMPLEMENTATION READINESS | **READY WITH CONDITIONS** | Local implementation may begin. Auth models/session/linking policy require their dedicated review; SEC findings remain open; no endpoint should bypass the future authorization boundary. |
| WORKSPACE API READINESS | **NOT READY** | Authentication/authorization and ADR-011 bootstrap/ownership transaction protocols and race tests are absent. |
| TASK API READINESS | **NOT READY** | Authorization, archived-project policy, active assignment, soft-delete defaults, transition/version semantics and reorder concurrency protocol are absent. |
| STAGING READINESS | **NOT READY** | SEC-01/SEC-02 High/Open, CDB-001 ACL defect and missing business authorization/service controls block promotion; no staging approval exists. |
| PRODUCTION READINESS | **NOT READY** | Production approval is absent and all staging blockers apply. Production isolation/deployment controls have not been audited. |

The recommended next step is a Project Owner review of this audit, followed by the
dedicated Auth modeling/implementation phase for local development. Workspace and
Task APIs should remain gated until their listed service controls and tests exist.
