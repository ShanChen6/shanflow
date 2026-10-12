# Shanflow — Prisma Schema & Migration Blueprint

Ngày: 2026-10-12. Phạm vi: **Prompt 2.2A, planning-only**. Tài liệu này là blueprint,
không schema, migration SQL files hoặc database verification đã thực hiện.

## 1. Executive Summary

Modeling baseline là năm core entities User, Workspace, WorkspaceMember, Project,
Task, tuân thủ [11 ADR/Design Freeze](data-decisions.md#phase-21-mvp-domain-design-freeze).
Task luôn có Workspace, Project nullable (Inbox); Project archive; Task soft delete;
BigInt positions unique theo live lane workspace+Project/Inbox+status. Schema chuẩn
bị PERSONAL/TEAM, UI đầu chỉ PERSONAL; supporting Auth thuộc phase riêng.

[IA-001](../security/local-development-authorization.md) hiện **APPROVED FOR LOCAL
DEVELOPMENT**, explicit Project Owner confirmation 2.1D ngày 2026-10-12.
[RA-001](../security/risk-acceptance-001.md) vẫn giữ design-only history/scope. Prisma
modeling AUTHORIZED FOR LOCAL DEVELOPMENT; migrations AUTHORIZED FOR VERIFIED
LOCAL DATABASE ONLY. Staging/Production NOT AUTHORIZED. Current 2.1D documentation
update không tạo models/migrations hoặc tự bắt đầu Prompt 2.2B.
[Foundation audit](../foundation-audit.md) vẫn SEC-01/SEC-02 High/Open; không đóng
finding, hạ severity, đổi ADR hoặc coi blueprint là risk acceptance mới.

Đã đọc [Domain](domain-analysis.md), [ERD](erd.md), [Permissions](authorization-matrix.md),
Prisma schema/config hiện hữu, package manifests và documented migration workflow.
Source hiện có generator prisma-client ESM/TS, output src/generated/prisma; datasource
PostgreSQL; không business models/enums/migrations. CLI/Client/adapter-pg pin 7.10.0;
Compose pin PostgreSQL 18.6-bookworm. Chưa chạy database command hoặc schema prototype.

### Current environment/workflow boundaries

| Boundary | Existing configuration / future preflight |
| --- | --- |
| Primary | shanflow/public, local 127.0.0.1; README/audit port 55432, Compose default 5432; verify actual target trước DDL |
| Runtime | shanflow_app qua DATABASE_URL; không bootstrap/migrator fallback |
| Migration | shanflow_migrator qua DIRECT_DATABASE_URL, own public schema/objects; NOCREATEDB, không superuser |
| Shadow | shanflow_shadow qua SHADOW_DATABASE_URL; migrator-owned, runtime không CONNECT; phải disposable, không chứa dữ liệu cần giữ |
| Config guards | prisma.config.ts kiểm tra exact role/database/schema; shadow phải tên riêng, bắt buộc cho migrate dev; không bypass guards để đổi target |
| Existing scripts | db:validate, db:generate, db:migrate:dev, db:migrate:deploy, db:migrate:status/db:status; chỉ dùng khi được phép |

Đây là repository/history inspection, không fresh role/DB health/PG version verification.
Disposable qualification ưu tiên local instance riêng với cùng logical DB/role names,
port/volume riêng; setup cần task được duyệt. Không chỉnh Compose/roles/URLs trong
2.2A. Không production credentials, migrations on startup, db push, reset, down -v
hoặc xóa volume để xử lý drift. create-only vẫn có shadow/reset side effects, không
được chạy tại planning step.

## 2. Model Blueprint

Bảng dùng logical camelCase fields, map relational table/column sang snake_case.
Đây là field attributes proposal dạng tài liệu, không executable schema.prisma.
Required/Optional áp dụng scalar columns; inverse relation lists không tạo columns.
Không thêm lifecycle Workspace, slug, custom statuses, Auth credentials trên User,
Organization/Comment/Notification/ActivityLog hoặc future business fields.

Common conventions: UUID v4 app/Prisma-client-generated qua uuid() + native uuid,
không ngầm có SQL DEFAULT UUID; SQL insert phải supply id. createdAt DB now();
updatedAt default now() + Prisma @updatedAt, direct SQL UPDATE không tự nhận timestamp
refresh. Mọi timestamps @db.Timestamptz(3), UTC instants; API explicit offset/UTC Z.
Text dùng @db.Text; domain length limits do DTO/row CHECK review, không invent new
VarChar limits. PK/unique indexes toàn rows gồm tombstones nếu không ghi predicate.

### User → users

| Field | Prisma type | PostgreSQL native type | Nullability | Default / key |
| --- | --- | --- | --- | --- |
| id | String @db.Uuid | uuid | Required | uuid(), PK |
| email | String @db.Text | text | Required | No default; UNIQUE canonical email |
| displayName | String @db.Text | text | Required | No default, nonblank |
| avatarUrl | String? @db.Text | text | Optional | NULL |
| accountStatus | AccountStatus | account_status enum | Required | ACTIVE |
| createdAt | DateTime @db.Timestamptz(3) | timestamptz(3) | Required | now() |
| updatedAt | DateTime @db.Timestamptz(3) | timestamptz(3) | Required | now() + @updatedAt |

Relations: ownedWorkspaces via WorkspaceOwner, memberships via MembershipUser;
creator/assignee business identity đi qua Member relations, không redundant direct
Task→User FKs. Index: PK + email unique; chưa index profile/status mặc định.
Rules: canonical email trim/lowercase, không strip dots/+ aliases; nonblank name,
account suspension chặn authorization. Email uniqueness không evidence auto-link.
emailVerifiedAt và PasswordCredential/OAuthAccount/RefreshSession thuộc Auth modeling
riêng theo ADR-010, không silently thêm core fields/tables. Direct-SQL canonicalization
CHECK có thể bổ sung M006 như S-05, không citext extension bắt buộc.

### Workspace → workspaces

| Field | Prisma type | PostgreSQL native type | Nullability | Default / key |
| --- | --- | --- | --- | --- |
| id | String @db.Uuid | uuid | Required | uuid(), PK |
| name | String @db.Text | text | Required | No default, nonblank |
| ownerId | String @db.Uuid | uuid | Required | No default, User FK |
| type | WorkspaceType | workspace_type enum | Required | PERSONAL |
| createdAt | DateTime @db.Timestamptz(3) | timestamptz(3) | Required | now() |
| updatedAt | DateTime @db.Timestamptz(3) | timestamptz(3) | Required | now() + @updatedAt |

Relations: owner, members, projects, tasks. Indexes: PK; ownerId lookup; partial
unique ownerId WHERE type=PERSONAL. Review ordinary owner lookup vs partial index
query plans để tránh redundant indexes. No archivedAt/deletedAt/lifecycle status.
Owner valid User, matching active OWNER membership nghiệp vụ ADR-005/011; PERSONAL
single-member policy ở service, TEAM supports multiple members nhưng không UI mới.

### WorkspaceMember → workspace_members

| Field | Prisma type | PostgreSQL native type | Nullability | Default / key |
| --- | --- | --- | --- | --- |
| id | String @db.Uuid | uuid | Required | uuid(), PK |
| workspaceId | String @db.Uuid | uuid | Required | Workspace FK |
| userId | String @db.Uuid | uuid | Required | User FK |
| role | WorkspaceRole | workspace_role enum | Required | MEMBER; owner bootstrap explicitly OWNER |
| membershipStatus | MembershipStatus | membership_status enum | Required | ACTIVE |
| joinedAt | DateTime @db.Timestamptz(3) | timestamptz(3) | Required | now(), first join retained |
| createdAt | DateTime @db.Timestamptz(3) | timestamptz(3) | Required | now() |
| updatedAt | DateTime @db.Timestamptz(3) | timestamptz(3) | Required | now() + @updatedAt |

Relations: workspace, user, createdTasks (TaskCreatorMembership), assignedTasks
(TaskAssigneeMembership). Keys: UNIQUE(workspaceId,userId); partial unique workspaceId
WHERE role=OWNER (không predicate ACTIVE, để inactive OWNER cũng không tạo owner thứ hai).
Indexes: (userId,membershipStatus,workspaceId), (workspaceId,membershipStatus).
Retain INACTIVE rows cho provenance; removal unassign tất cả Tasks kể cả deleted,
không đổi creator. joinedAt không ghi đè khi reactivate. Invitation/VIEWER không MVP.

### Project → projects

| Field | Prisma type | PostgreSQL native type | Nullability | Default / key |
| --- | --- | --- | --- | --- |
| id | String @db.Uuid | uuid | Required | uuid(), PK |
| workspaceId | String @db.Uuid | uuid | Required | Workspace FK |
| name | String @db.Text | text | Required | No default, nonblank; không business-unique |
| description | String? @db.Text | text | Optional | NULL |
| archivedAt | DateTime? @db.Timestamptz(3) | timestamptz(3) | Optional | NULL=active |
| color | String? @db.Text | text | Optional | NULL, application allowlist |
| icon | String? @db.Text | text | Optional | NULL, application allowlist |
| createdAt | DateTime @db.Timestamptz(3) | timestamptz(3) | Required | now() |
| updatedAt | DateTime @db.Timestamptz(3) | timestamptz(3) | Required | now() + @updatedAt |

Relations: workspace, tasks. UNIQUE(workspaceId,id) all rows cho compound FK target;
query index(workspaceId,archivedAt,createdAt,id). Không redundant ProjectStatus enum.
workspaceId immutable MVP; archive không xóa/complete Task; ordinary task mutations
trong archived Project bị chặn, restore Project trước. No hard delete CRUD.

### Task → tasks

| Field | Prisma type | PostgreSQL native type | Nullability | Default / key |
| --- | --- | --- | --- | --- |
| id | String @db.Uuid | uuid | Required | uuid(), PK |
| workspaceId | String @db.Uuid | uuid | Required | Workspace FK, immutable MVP |
| projectId | String? @db.Uuid | uuid | Optional | NULL=Inbox, scoped compound FK |
| title | String @db.Text | text | Required | No default, nonblank |
| description | String? @db.Text | text | Optional | NULL |
| status | TaskStatus | task_status enum | Required | TODO |
| priority | TaskPriority | task_priority enum | Required | MEDIUM |
| dueAt | DateTime? @db.Timestamptz(3) | timestamptz(3) | Optional | NULL=no deadline |
| assigneeId | String? @db.Uuid | uuid | Optional | NULL, User ID through membership key |
| createdById | String @db.Uuid | uuid | Required | Trusted actor ID through membership key, immutable |
| position | BigInt @db.BigInt | bigint/int8 | Required | No shared default; server allocation first 1024 |
| version | Int @db.Integer | integer/int4 | Required | 1 |
| completedAt | DateTime? @db.Timestamptz(3) | timestamptz(3) | Optional | NULL unless DONE |
| deletedAt | DateTime? @db.Timestamptz(3) | timestamptz(3) | Optional | NULL=live |
| createdAt | DateTime @db.Timestamptz(3) | timestamptz(3) | Required | now() |
| updatedAt | DateTime @db.Timestamptz(3) | timestamptz(3) | Required | now() + @updatedAt |

Relations: workspace, optional project, creatorMembership required,
assigneeMembership optional. UNIQUE(workspaceId,id) all rows giữ frozen scoped target
key cho future child references, dù global id đã unique. Table này không thêm enum
Deleted/Blocked hoặc Task owner khác Workspace. Keys/indexes xem sections 5–6.
DONE entry đặt completedAt; DONE→non-DONE reset null, DONE→DONE giữ time. CANCELED
khác DONE/deleted; soft delete giữ completion/history, default queries exclude deleted.

## 3. Enums

| Logical Prisma enum → mapped PostgreSQL enum | Values | Default usage |
| --- | --- | --- |
| AccountStatus → account_status | ACTIVE, SUSPENDED | User ACTIVE |
| WorkspaceType → workspace_type | PERSONAL, TEAM | Workspace PERSONAL |
| WorkspaceRole → workspace_role | OWNER, ADMIN, MEMBER | Member MEMBER; bootstrap OWNER |
| MembershipStatus → membership_status | ACTIVE, INACTIVE | Member ACTIVE |
| TaskStatus → task_status | TODO, IN_PROGRESS, DONE, CANCELED | Task TODO |
| TaskPriority → task_priority | LOW, MEDIUM, HIGH, URGENT | Task MEDIUM |

Giữ symbolic values như freeze, map enum type names ổn định qua migrations. Không
ProjectStatus, custom statuses, VIEWER hoặc auth verification enum trong core.
Display lane order explicit TODO/IN_PROGRESS/DONE/CANCELED, không dựa UI alphabetic.

## 4. Relations & Cross-Workspace Integrity

Tất cả FKs đề xuất explicit onDelete Restrict / onUpdate NoAction (non-deferrable
baseline), không dựa default Prisma optional SetNull hoặc update Cascade. NoAction
không tự đồng nghĩa DEFERRABLE; nếu chọn deferred guard phải SQL riêng. Không SET
NULL whole compound tuple vì workspaceId required. [Prisma referential actions](https://www.prisma.io/docs/orm/v7/prisma-schema/data-model/relations/referential-actions).

| Relation name / cardinality | Referencing → referenced fields | Protection |
| --- | --- | --- |
| WorkspaceOwner: User 0..N, Workspace 1 | Workspace.ownerId → User.id | Valid owner User, không membership role/status |
| WorkspaceMembership: Workspace 1..N after bootstrap, Member 1 | Member.workspaceId → Workspace.id | Workspace exists; min one owner là business invariant, không FK minimum |
| MembershipUser: User 0..N, Member 1 | Member.userId → User.id | Valid membership identity |
| WorkspaceProjects: Workspace 0..N, Project 1 | Project.workspaceId → Workspace.id | Canonical boundary |
| WorkspaceTasks: Workspace 0..N, Task 1 | Task.workspaceId → Workspace.id | Boundary tồn tại cả khi project null |
| TaskProject: Project 0..N, Task 0..1 | Task(workspaceId,projectId) → Project(workspaceId,id) | Same-workspace Project; MATCH SIMPLE |
| TaskCreatorMembership: Member 0..N, Task 1 | Task(workspaceId,createdById) → Member(workspaceId,userId) | Scoped creator identity; inactive historical member vẫn valid |
| TaskAssigneeMembership: Member 0..N, Task 0..1 | Task(workspaceId,assigneeId) → Member(workspaceId,userId) | Scoped assignee existence, nullable |

Project/Member compound target keys là all-row UNIQUE; partial filtered target
không đủ FK target. projectId/assigneeId NULL làm MATCH SIMPLE không kiểm tra tuple
đó; Task.workspaceId NOT NULL + standalone Workspace FK không bị bỏ qua. Không
MATCH FULL, vì partially-null tuple hợp lệ cho Inbox/unassigned. [PostgreSQL constraints](https://www.postgresql.org/docs/18/ddl-constraints.html).

Prisma declaration cần relation fields/inverse names explicit; overlapping workspaceId
trong standalone Workspace FK và three compound relations là feasibility gate trên
7.10.0. Không clone workspace scalar để né validator hoặc drop scoped FK. Nếu
Prisma không biểu diễn topology, đề xuất client relation representation + manual
composite SQL guards, có drift/replay verification; nếu cần đổi field/semantics phải
amend ADR trước. Không coi blueprint này là proof schema/client đã validate.

ACTIVE account/member khi create/assign/restore; project editable; creator/tenant
immutability và role matrix là service checks cùng transaction. FK không authorize
read/write và không chứng minh status ACTIVE. Application authorization cũng không
thay compound DB referential integrity; cần cả hai.

## 5. Database Constraints & Compatibility Classification

| Guard / capability | Category | Meaning / version verification |
| --- | --- | --- |
| UUID fields/default uuid(), BigInt, enums, timestamptz(3) | Prisma-native | Mapping được docs hỗ trợ, chưa compile prototype trên pinned 7.10.0 |
| PK, canonical email unique, membership pair unique, scoped Project/Task keys | Prisma-native | Normal @id/@unique/@@unique; references all rows |
| Scalar/compound FK, Restrict/NoAction | Prisma-native design | Validate nullable/overlapping relations ở implementation; DB FK final guard |
| PERSONAL partial unique, OWNER partial unique, live Project/Inbox position unique | Manual SQL baseline; Prisma Preview alternative | Pinned support cần validate nếu dùng where/partialIndexes; không bật Preview ở 2.2A |
| completedAt/status CHECK, version>=1, position>=0, nonblank text | Manual SQL | Không dựa ordinary Prisma enum để enforce cross-field checks |
| Exactly-one matching ACTIVE OWNER, immutable tenant/creator guards | Service baseline; DB trigger strengthening optional | Không đầy đủ từ unique/FK; riêng SQL design/test nếu muốn full direct-SQL enforcement |
| Reorder/transfer authorization, active membership, assignment cleanup, query visibility | Service enforcement | Requires locks/version/scoped lookups; chưa service code |
| DEFERRABLE owner FK/constraint trigger | Manual SQL alternative | Không default core FK; sẽ có bootstrap cycle/privilege/snapshot tests nếu chọn |

PostgreSQL 18.6 hỗ trợ required primitives trong PostgreSQL 18 docs; image pin không
proof server đang chạy đúng version. Prisma docs v7 xác nhận mapping String uuid,
BigInt bigint, DateTime explicit Timestamptz; tránh default DateTime timestamp(3)
không timezone. [Prisma PostgreSQL connector](https://www.prisma.io/docs/orm/v7/core-concepts/supported-databases/postgresql).
Prisma index docs hiện yêu cầu partialIndexes Preview cho where; tránh kéo tính năng
Prisma 8 vào 7.10.0. [Prisma partial indexes](https://www.prisma.io/docs/orm/v7/prisma-schema/data-model/indexes#configuring-partial-indexes-with-where).

## 6. Manual SQL Requirements — catalog, không migration files

Recommended baseline giữ partial unique guards bằng named SQL indexes nếu chưa
approve/qualify Preview. Nếu pinned where support được chọn, mỗi guard chỉ tạo
**một lần**, không duplicate native và SQL index. Review drift/shadow replay,
introspection và tương lai migration diff; không bỏ SQL guards vì schema không
round-trip toàn tính năng. Chưa viết CREATE/ALTER scripts trong lượt này.

| ID | Logical SQL object / requirement | Timing and rationale |
| --- | --- | --- |
| S-01 | workspaces_personal_owner_unique: UNIQUE(owner_id) WHERE type='PERSONAL' | Có thể kèm M002; mọi persisted PERSONAL, no Workspace lifecycle escape |
| S-02 | workspace_members_one_owner_unique: UNIQUE(workspace_id) WHERE role='OWNER' | Có thể kèm M003; role-only predicate, immediate at-most-one |
| S-03 | task_live_project_position_unique: UNIQUE(workspace_id,project_id,status,position) WHERE deleted_at IS NULL AND project_id IS NOT NULL | Kèm M005 nếu cần expose writes ngay, hoặc M006 với no-write gate |
| S-04 | task_live_inbox_position_unique: UNIQUE(workspace_id,status,position) WHERE deleted_at IS NULL AND project_id IS NULL | Cùng S-03, không id trong key, không ordinary NULL uniqueness |
| S-05 | Required text nonblank btrim checks; proposed email=btrim/lower canonical check | M006; canonical policy theo freeze, no alias rewriting/citext extension |
| S-06 | Task completion CHECK: DONE⇔completed_at IS NOT NULL; version>=1, position>=0 | M006 hoặc M005 trước writes; deleted_at độc lập |
| S-07 | Partial live deadline/status/assignee indexes; trash partial index | M006 query performance, không substitute integrity unique |
| S-08 | Optional owner/immutability DB triggers hoặc DEFERRABLE cyclic FK | Không baseline migration; separate approval/design nếu chọn, chưa create trigger |

Index query proposals: Member(user_id,membership_status,workspace_id) và
(workspace_id,membership_status); Project(workspace_id,archived_at,created_at,id);
Task all-row (workspace_id,project_id), (workspace_id,created_by_id),
(workspace_id,assignee_id) để dependent FK checks gồm tombstones; live filters
(workspace_id,status,id), assigned live (workspace_id,assignee_id,status,id),
deadline (workspace_id,due_at,id) WHERE deleted_at IS NULL AND due_at IS NOT NULL;
trash (workspace_id,deleted_at,id) WHERE deleted_at IS NOT NULL. Lane unique guards
đã có btree theo lane/rank, không tự thêm duplicate index chỉ khác tên. Tune EXPLAIN
sau data, không thêm title unique hoặc FTS/RLS/infrastructure ngoài scope.

Index validity/predicates và CHECK validated status phải catalog-verify, không chỉ
sự hiện diện object. Live ordering indexes include archived Project tasks nếu vẫn
live; soft-deleted Tasks không reserve rank, titles được trùng. Unique position
không chứa id: thêm id sẽ vô hiệu invariant distinct rank.

## 7. Ownership Strategy

### Bootstrap without circular FK

User phải tồn tại trước Workspace. Transaction tạo Workspace(ownerId=user.id) rồi
Member(workspaceId,userId,role=OWNER,membershipStatus=ACTIVE). WorkspaceOwner chỉ FK
User, không FK ngược owner membership ở baseline nên không cycle; unique personal
owner chống concurrent duplicate bootstrap, final service check trước commit.
Membership id riêng UUID; compound pair unique, không đổi primary key để modeling.
Không dùng nested connect member chưa tồn tại hoặc cấp MEMBER default rồi commit.

M002 có thể tồn tại trước M003 vì không backward membership FK, nhưng **không mở
business writes/onboarding ở intermediate release**. Migrations/PRs nhỏ không có
nghĩa incomplete owner semantics được phép expose. Exactly-one/member match chưa
DB-enforced đầy đủ; bare SQL tạo Workspace không member có thể pass baseline.

### Transfer/locking baseline and limits

TEAM test fixtures cho transfer vì PERSONAL single-owner UI không có target member.
Authorization/current owner + target ACTIVE precheck → begin transaction → lock
involved Users sorted (khi account checks) → Workspace FOR UPDATE → member rows
sorted → revalidate target/current owner/expectedOwnerId → update ownerId → demote
old OWNER ADMIN → promote new OWNER → final recheck → commit atomically.

Immediate partial unique nên old demote trước new promote; temporary zero OWNER
không commit qua service path. Two transfers/revoke/role changes/workspace updates
cùng lock protocol serialize, stale owner requests reject. Update metadata không
cho body đổi ownerId tùy ý. Service-controlled writes không bảo vệ mọi direct SQL
bằng runtime CRUD role: FK/unique cho existence/at-most-one, không existence/member
ACTIVE/match. Prisma transaction đơn thuần chưa đủ chống stale prechecks/races.

Deferred compound owner FK có thể bảo vệ member existence nhưng thêm circular
bootstrap, cần SQL DEFERRABLE và không tự enforce ACTIVE/OWNER. Deferred consistency
trigger + DB locking strengthening cần OLD/NEW workspace coverage, direct-SQL
races/privileges/cleanup tests riêng; không tạo hoặc chốt như DB guard đã chạy.
ADR-011 cho phép ghi known limitation; full enforcement nếu được yêu cầu phải
separate reviewed migration, không quietly đổi ADR hoặc cấp superuser.

## 8. Task Ordering Strategy

Live partition = workspaceId + projectId/Inbox + status, deletedAt IS NULL. First
1024; append max+1024; prepend nếu còn nonnegative space, otherwise rebalance;
insert between integer midpoint khi gap>1. Project/status move và restore allocate
destination append, update relation/status/completion/version/rank atomically.
Same-status metadata edit giữ rank; CANCELED lane riêng, không deletion. Soft-delete
giữ rank/history nhưng nhả unique slot; restore không reuse stale position.

MVP recommended serialization Workspace FOR UPDATE trước read rank/neighbors,
Task rows locks sorted, expected version conditional update; active account/member/
editable source/destination Project được recheck sau locks. Empty Inbox lane được
Workspace lock cover; task row lock đơn lẻ không serialize concurrent empty inserts.
Future canonical partition advisory locks có thể tăng throughput nhưng cần Inbox
key/source-destination lock order, không thêm lock table/LexoRank trong baseline.
Unique guards final backstop kể cả writer không theo service protocol. Retry whole
transaction bounded (recommend max 3) cho unique/serialization/deadlock, fresh ranks;
không auto-retry stale user expected-version hoặc authorization failure.

Immediate partial unique không deferrable: swapping/rebalancing to final ranks
trực tiếp có thể collide giữa updates. Hai phases trong cùng transaction: allocate
staging positions **nonnegative, in int64, distinct và chưa live row dùng**, rồi
assign final 1024*n giữ relative order. Preflight cả staging/final capacity/range;
không soft-delete tạm rows hoặc dùng negative band khi CHECK position>=0. Không đủ
free staging capacity thì fail/rollback, không overflow/partial commit. Rebalance
increment version/updatedAt các rows đổi rank, deleted rows không tham gia.

No direct JSON.stringify BigInt; output position decimal string, frontend chỉ gửi
neighbor/destination IDs và expected version, không tự tính arbitrary rank. Int64
bounds/range checks dùng BigInt arithmetic, không Number conversion. Các algorithm
được mô tả để review, chưa reorder service/tests hoặc concurrency proof.

## 9. Migration Sequence — proposed small PRs

M001–M006 là plan identifiers, **không migration folders/history đã tạo**. Generated
SQL và supplement cùng một migration phải được review/replay; không execute ad hoc
DDL ngoài history. No business writes cho tới core+required guards hoàn chỉnh.
Cho phép rút gọn guard timing theo S-01..S-06 nhưng không silent reordering/drop.

| Step / dependencies | SQL objects planned | Principal risks | Future verification query set | Recovery consideration |
| --- | --- | --- | --- | --- |
| M001 Core enums + User; no domain tables dependency | Six enums, users columns/PK/email unique | Enum maps/timezone/UUID client-vs-DB defaults; existing object conflict | Q0 preflight, Q1 enums, Q2 users | Additive forward fix; don't drop used enums/User data; recover backup if corrupt writes |
| M002 Workspace; M001 | workspaces + owner User FK, owner lookup; S-01 partial PERSONAL unique recommended here | Owner member not yet present at intermediate stage; duplicate existing PERSONAL if guard added later | Q2 workspaces, Q3 FKs, Q4 indexes | Keep User data; no automatic DROP workspace; forward fix predicate before expose writes |
| M003 WorkspaceMember; M001–2 | workspace_members, pair unique, User/Workspace FKs, member indexes; S-02 recommended here | Incomplete owner check, inactive OWNER collision, new defaults | Q2 member, Q3/Q4; Q6 owner consistency | Preserve provenance; invalid rows require reviewed reconciliation, no broad DELETE/demotion |
| M004 Project; M002 | projects + Workspace FK/scoped unique/query index | Wrong cascade default, immutable workspace not DB-enforced, redundant ProjectStatus drift | Q2 projects, Q3/Q4 | Archive not destructive; forward fix FK/index, retain rows |
| M005 Task; M001–4 | tasks/enums/FKs/scoped key; optional relations, field defaults/indexes; bundle S-03/04/06 if writes permitted | Overlapping FK Prisma validator, NULL/SetNull behavior, rank/restore collisions | Q2 tasks, Q3, Q4, Q5, Q7 | Do not DROP table/data to rollback; review forward fix; constraint changes cannot hide invalid data |
| M006 Remaining DB-only guards/query indexes; M001–5 | S-03/04/05/06 if not bundled earlier, S-07; no trigger automatically | Unique/backfill conflicts, lock duration, drift/SQL replay/Preview mismatch | Q3–Q7, migration history verification | Transaction rollback only if qualified; after applied use reviewed corrective migration/restore plan, don't rewrite history |

No circular FK requires order change baseline. If S-08 chosen later, postpone it
until Member exists and review cyclic constraint bootstrap; amend plan/ADR with
migration impact. DB constraints split PRs are additive, but unsafe intermediate
states never exposed to app CRUD. ForeignKeys mode must remain DB-backed, not
relationMode=prisma emulation that silently removes FK guarantees.

### Read-only verification query catalog — not executed

Names below follow proposed snake_case maps; queries requiring tables chỉ chạy sau
đúng migration stage và target authorization. Query results must be reviewed against
expected definition, not merely exit 0. Snapshot exact counts/schema before/after
any non-disposable apply; don't print environment URLs/passwords.

Q0 — identity/version before every apply: expected shanflow/public,
shanflow_migrator for DDL; runtime role separate. Compare connection port/instance
out-of-band to approved target; DB name alone không chứng minh isolation.

```sql
SELECT current_database(), current_user, current_schema(),
       current_setting('server_version'), inet_server_addr(), inet_server_port();
```

Q1 — enum type/value mapping, after M001:

```sql
SELECT t.typname, e.enumlabel, e.enumsortorder
FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
JOIN pg_namespace n ON n.oid = t.typnamespace
WHERE n.nspname = 'public'
  AND t.typname IN ('account_status', 'workspace_type', 'workspace_role',
                   'membership_status', 'task_status', 'task_priority')
ORDER BY t.typname, e.enumsortorder;
```

Q2 — columns/types/null/default, after relevant entity stage:

```sql
SELECT table_name, column_name, data_type, udt_name, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('users', 'workspaces', 'workspace_members', 'projects', 'tasks')
ORDER BY table_name, ordinal_position;
```

Q3 — actual FK/unique/CHECK definition, validity, deferrability and actions:

```sql
SELECT c.conrelid::regclass AS object_name, c.conname, c.contype,
       c.convalidated, c.condeferrable, c.condeferred,
       pg_get_constraintdef(c.oid) AS definition
FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
WHERE n.nspname = 'public'
  AND c.conrelid IN (SELECT t.oid FROM pg_class t JOIN pg_namespace p ON p.oid = t.relnamespace
                    WHERE p.nspname = 'public'
                      AND t.relname IN ('users','workspaces','workspace_members','projects','tasks'))
ORDER BY object_name, c.conname;
```

Q4 — index keys/predicates/unique/valid/ready, including standalone partial indexes
không được coi là table UNIQUE constraints từ Q3:

```sql
SELECT t.relname AS table_name, x.relname AS index_name, i.indisunique,
       i.indisvalid, i.indisready, pg_get_indexdef(i.indexrelid) AS definition,
       pg_get_expr(i.indpred, i.indrelid) AS predicate
FROM pg_index i JOIN pg_class t ON t.oid = i.indrelid
JOIN pg_class x ON x.oid = i.indexrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
WHERE n.nspname = 'public'
  AND t.relname IN ('users','workspaces','workspace_members','projects','tasks')
ORDER BY t.relname, x.relname;
```

Q5 — completion/version/nonnegative ranks, expected 0 rows after M005/M006:

```sql
SELECT id FROM public.tasks
WHERE (status = 'DONE' AND completed_at IS NULL)
   OR (status <> 'DONE' AND completed_at IS NOT NULL)
   OR version < 1 OR position < 0;
```

Q6 — owner consistency diagnostic, expected 0 rows after approved bootstrap/transfer
fixtures; **diagnostic không phải DB enforcement**:

```sql
SELECT w.id
FROM public.workspaces w LEFT JOIN public.workspace_members m ON m.workspace_id = w.id
GROUP BY w.id, w.owner_id
HAVING count(*) FILTER (WHERE m.role = 'OWNER') <> 1
    OR count(*) FILTER (WHERE m.role = 'OWNER' AND m.membership_status = 'ACTIVE'
                          AND m.user_id = w.owner_id) <> 1;
```

Q7 — strict live rank collisions, expected 0 rows after guards/fixtures. GROUP BY
nhóm NULL Inbox đúng để diagnostic, khác ordinary UNIQUE NULL semantics:

```sql
SELECT workspace_id, project_id, status, position, count(*)
FROM public.tasks WHERE deleted_at IS NULL
GROUP BY workspace_id, project_id, status, position HAVING count(*) > 1;
```

Migration history plan: approved db:migrate:status + inspection _prisma_migrations
finished/failed/rolled-back state; expected six plan steps hoặc approved consolidated
sequence, no checksum rewrite. Current database chưa được queried ở 2.2A. These SELECT
queries không validate authorization hoặc prove race safety; negative/parallel tests
below are necessary after scope approval.

Recovery per step: review actual SQL transactional properties, snapshot needed data,
record pre-apply state; migration engine failure không đồng nghĩa every statement
rolled back. No auto down migration, db push, reset hoặc migrate resolve masking failure.
Disposable replay/recovery can qualify plan; dữ liệu cần giữ dùng approved forward-fix/
restore path, never blanket table/volume deletion. PostgreSQL roles không đổi để pass.

## 10. Verification Matrix — future cases, chưa viết/chạy tests

All mutation cases below chỉ ở approved disposable local environment, clear fixture
names/IDs, isolated connections/cleanup. No business data hiện hữu bị test destructive
queries. DB-level cases qua migrator-controlled fixtures; runtime capability checks
qua app role, không bootstrap. Service cases require later scoped implementation.

| Case | Layer / expected result |
| --- | --- |
| Create User | Prisma round-trip uuid/timestamps/default ACTIVE, canonical email unique; explicit SQL IDs khi không DB uuid default |
| Create personal Workspace + owner membership | Transaction order User→Workspace→Member, matching OWNER ACTIVE; no incomplete committed service bootstrap |
| Reject duplicate membership | Pair unique fails same workspace/user even different membership ids |
| Reject second personal Workspace | S-01 rejects same owner PERSONAL; TEAM of same User allowed, no Workspace archive escape |
| Reject cross-workspace Project | Compound FK rejects Task.workspaceId=A/projectId in B even both standalone IDs valid |
| Reject cross-workspace creator/assignee | Composite Member FK rejects identity not member of Task workspace; NULL assignee allowed |
| Create Inbox Task | projectId NULL allowed, Workspace required/existing; status/priority/deadline/assignee work as Project tasks |
| Move Inbox↔Project and between same-workspace Projects | Scoped service guards, destination fresh rank/version; cross-workspace move rejected |
| Reject duplicate live Project rank | S-03 fails same workspace/project/status/position; different lane/status may use same position |
| Reject duplicate live Inbox rank | S-04 fails projectId NULL collision; no reliance on ordinary compound @@unique |
| Soft-delete slot reuse | Tombstone giữ original rank/history/completion; live task can use freed rank, default queries hide tombstone |
| Restore deleted Task | New rank+clear deletedAt atomic; active assignment recheck; completion retained; no collision resurrected |
| Archived Project | Read allowed, task create/update/complete/move/reorder/delete/restore blocked; owner/admin project restore first |
| DONE/reopen/cancel | completedAt/status CHECK rejects inconsistent rows incl deleted DONE; service transition policy separately tested |
| Owner transfer TEAM | Current owner auth, target active; demote-before-promote; final owner/member agree, not exposed in PERSONAL UI |
| Concurrent owner transfers/removal/role update | Dedicated connections/barriers; Workspace lock serialize, stale expected owner reject, no service invalid final state |
| Direct-SQL owner mismatch/inactive/demotion | Document baseline gap: constraints may allow; test limitation, not claim full DB rejection unless strengthening added |
| Concurrent reorder/create in empty Inbox lane | Locks + S-04: unique final ranks, bounded retry; transaction-alone test not proof |
| Rebalance / near-int64 overflow | Staging/final unique preserved, stable order/version updates; capacity error rollback, no temporary rank commit |
| Membership deactivate vs assign/restore | Same lock/recheck; unassign all tasks incl deleted; creator kept; no stale authorization |
| Runtime role permissions | App CRUD/sequence where relevant, no DDL; migrator schema ownership; default grants verify without role changes |
| SQL guards migration replay/drift | Full history + supplement replay in shadow/disposable; schema diff won't silently drop manual indexes/CHECK |
| Regression after modeling | frozen-lockfile, validate/generate, lint/typecheck/build, existing unit/E2E, fresh audit; additional DB tests only as authorized |

## 11. Risks and Open Questions — classified prerequisites

Không phát hiện lý do để sửa 11 ADR trong planning. Các feasibility/risk gates sau
phải được giải quyết có bằng chứng ở task implementation riêng:

- **Authorization gate:** IA-001 APPROVED FOR LOCAL DEVELOPMENT; migration chỉ
  verified local database, subject preflight/SQL review/recovery controls; chưa
  implementation ở 2.1D. RA-001 deadline 2026-11-11/triggers không thay đổi.
- **Prisma 7.10.0 overlap/partial-index support:** chưa prototype/validate; nếu không
  hỗ trợ cần SQL supplement và client-relation representation review, không drop FK.
- **SQL supplementary history:** decide Preview vs manual representation trước generate;
  preserve guards in replay/introspection/drift checks. CHECK/deferrability không
  mặc định schema-native. No full compatibility PASS từ documentation inspection.
- **Ownership limits:** ADR-011 baseline không exact-one/ACTIVE/match trước mọi direct
  SQL; explicit controlled write policy và separate strengthening decision nếu cần.
- **Concurrency:** immediate unique rebalance/staging/free-range, overflow, stale
  version và lock ordering tests chưa chạy; no duplicate-tolerant fallback.
- **Retention/Auth boundary:** Workspace deletion/account deletion/purge/advanced auth
  field details deferred; không thêm full Auth fields/models để “hoàn thiện” core.
- **Technical naming:** concrete enum/relation/index mapping ở plan cần review trước
  generation, không schema semantics mới. Timestamps/UUID direct SQL defaults khác
  ORM behavior cần fixture expectations rõ.
- **Security:** SEC-01/SEC-02 High/Open; tooling config trusted, lockfile controlled,
  audit/reassessment vẫn bắt buộc; no major upgrade/security suppression ở plan.

Nếu modeling đòi thêm field, đổi predicate/role/lifecycle hoặc phá Design Freeze,
record issue + ADR amendment + migration/backfill/compatibility impact trước apply;
không tự sửa ADR, authorization record hoặc existing schema trong 2.2A.

## 12. Implementation Checklist & Readiness

- [x] Blueprint đủ five core entities, scalar types/null/default/keys/relations/actions.
- [x] Six core enums và native uuid/timestamptz/bigint mapping rõ.
- [x] Owner bootstrap without reverse membership FK cycle; baseline/gaps classified.
- [x] Composite Project/member FKs và nullable Inbox/assignee strategy documented.
- [x] Strict two partial rank unique guards, lock/restore/rebalance/serialization plan.
- [x] Six migration PR steps, dependency/risk/query/recovery plan và no-write gate.
- [x] Manual SQL/Prisma-native/service requirements phân loại; no implicit guard drop.
- [x] Future verification matrix + documented limitations, no actual test implementation.
- [x] Explicit IA-001 approval for local development, recorded 2.1D (2026-10-12).
- [ ] Technical review blueprint/mapping và task implementation scope cụ thể;
  IA-001 approval không tự chứng minh toàn bộ blueprint đã compatibility-reviewed.
- [ ] Approved implementation task/environment preflight/disposable setup.
- [ ] Pinned Prisma validation, SQL diff/guard replay and reviewed migration SQL.
- [ ] Future DB integration/concurrency/recovery verification and regressions pass.

**Prisma Modeling Blueprint: READY FOR IMPLEMENTATION PLANNING. IA-001: APPROVED
FOR LOCAL DEVELOPMENT. Prisma Modeling: AUTHORIZED FOR LOCAL DEVELOPMENT.
Migrations: AUTHORIZED FOR VERIFIED LOCAL DATABASE ONLY. Database/Prisma compatibility
verification: NOT RUN. Staging/Production: NOT AUTHORIZED (NOT APPROVED).**
Chỉ tạo tài liệu này; không modify schema/config/ADRs/source/dependencies, tạo
migrations/tests hoặc chạy DB commands. Dừng sau Prompt 2.2A để review trước modeling.


Authorization update 2.1D (2026-10-12) chỉ đổi implementation gates/checklist, giữ
nguyên five-model blueprint, relations/constraints, ownership/order limits, M001–M006
sequence và verification matrix. Pending gate trong lịch sử 2.2A được supersede
bởi explicit IA-001 approval; không approval staging/production hoặc automatic
execution. Dừng sau documentation update để nhận task tiếp theo.
