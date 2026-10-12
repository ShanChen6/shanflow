# Shanflow — Data Decisions & Accepted ADRs

Ngày cập nhật: 2026-10-12, Prompt 2.1B. Project Owner phê duyệt ADR-001–ADR-006
ở 2.1A và ADR-007–ADR-011 ở 2.1B: **11 ADR Accepted** trong cuộc trao đổi. Accepted áp dụng cho decision, không
ngầm phê duyệt tất cả implementation recommendations dưới đây. Chưa có Prisma
models, migrations, auth implementation hoặc DB constraints mới.

Liên quan: [Domain](domain-analysis.md), [ERD](erd.md),
[Authorization](authorization-matrix.md), [RA-001](../security/risk-acceptance-001.md).
SEC-01/SEC-02 vẫn High/Open; RA-001 cho phép thiết kế có điều kiện, không production.

## Accepted architecture decisions

### ADR-001 — Authentication Strategy

- **Status:** Accepted. Authority: Project Owner, 2026-10-12.
- **Context:** User cần identity ổn định, có thể dùng nhiều phương thức đăng nhập;
  email có thể thay đổi và linking không được tạo account takeover/duplicate User.
- **Decision:** Email/password + Google OAuth; một User liên kết nhiều login
  methods. Không lưu plaintext password; không tự link dựa riêng email chưa verified.
- **Rationale:** Hỗ trợ đăng nhập quen thuộc và Google mà giữ cùng User/workspaces.
- **Alternatives considered:** Password-only thiếu Google; OAuth-only không đáp
  ứng password; passwordHash nullable trực tiếp trên User đơn giản nhưng trộn
  profile với credentials và khó mở rộng identities/lifecycle.
- **Consequences:** Năm core domain entities không phải toàn bộ auth storage.
  Auth phải có modeling phase riêng trước khi expose authenticated APIs; không
  bỏ credentials/session records chỉ để giữ tổng schema có năm tables.
- **Implementation considerations (proposed):**

| Supporting auth entity | Cardinality / proposed fields | Integrity và security requirement |
| --- | --- | --- |
| PasswordCredential | User 1 → 0..1; userId PK/FK, passwordHash, passwordUpdatedAt, createdAt, updatedAt | OAuth-only User không có credential; hash có salt/algorithm parameters, không plaintext; hash algorithm/work factor cần auth review |
| OAuthAccount | User 1 → 0..N; id, userId FK, provider, providerAccountId, providerEmail?, providerEmailVerified?, createdAt, updatedAt | UNIQUE(provider,providerAccountId); GOOGLE ban đầu; provider identity không dùng email làm stable key; unlink không bỏ phương thức login cuối cùng |
| RefreshSession | User 1 → 0..N; tokenHash/familyId, expiry/revocation/generation fields theo ADR-010 | Hash-only secret; từng rotation generation lưu riêng; concurrency/family policy cần Auth-phase implementation |

User cần đánh giá thêm emailVerifiedAt nullable và canonical email policy. Existing
User unique email không đồng nghĩa OAuth identity email là linking key. Google
`sub` là identity ổn định, email có thể đổi; validate issuer/audience/expiry/signature
và OAuth state/nonce trước linking. [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect).

Linking recommendation: require authenticated User + recent reauthentication và
validated Google flow. Nếu identity đã gắn User khác, reject; nếu Google email
trùng existing User mà chưa login/reauth, yêu cầu chứng minh existing account,
không tạo duplicate và không silent-link. Verified Google email cũng không tự
được coi là authorization link; verification là evidence, không thay reauth policy.
Identity insert/link và User/session changes atomic, UNIQUE key chống concurrent
callbacks. Password signup chưa verified có pending-verification flow; status,
verification/reset token storage và cleanup cần auth modeling riêng, không tự thêm
enum accountStatus hoặc migration ở lượt này. Không lưu provider access/refresh
credentials nếu chỉ cần login; Google API access sẽ cần secret storage design riêng.

Refresh storage/linking và rotation được cụ thể hóa ở ADR-010. Token TTL/cookies/
CSRF, verification/reset expiry, retention và last-method unlink policy là Auth-phase
parameters, không core-schema blocker. Chưa triển khai các biện pháp này.

### ADR-002 — Workspace Strategy

- **Status:** Accepted. Authority: Project Owner, 2026-10-12.
- **Context:** Personal task management cần simple MVP, không khóa đường team.
- **Decision:** Schema hỗ trợ PERSONAL và TEAM; MVP UI chỉ PERSONAL. User có personal
  workspace, tối đa một PERSONAL đang hoạt động; membership hỗ trợ roles về sau.
- **Rationale:** Giữ tenant boundary thống nhất khi mở cộng tác, không buộc ship team UI.
- **Alternatives considered:** Personal-only schema phải retrofit tenancy; team
  UI ngay tăng scope invitations/member management; project-owned tasks làm inbox khó.
- **Consequences:** Required workspaceId trên Project/Task, WorkspaceMember từ core.
  TEAM UI, invite/onboarding và PERSONAL→TEAM conversion không trong MVP đầu tiên.
- **Implementation considerations:** ADR-008 thay active marker proposal: không
  Workspace.archivedAt/deletedAt hoặc lifecycle flag trong MVP. Tất cả persisted
  workspaces được coi active; partial unique ownerId WHERE type=PERSONAL enforce
  một personal workspace/user. Signup/bootstrap atomic/idempotent bảo đảm tạo
  personal workspace; uniqueness chỉ at-most-one, không at-least-one.

PERSONAL chỉ owner member; TEAM 1..N, owner membership ACTIVE (khác User account
status). TEAM UI/conversion future. Workspace/account deletion deferred, không
bypass unique bằng SUSPENDED account hoặc archived Project. ADR-008 supersede
đề xuất archivedAt/restore ở 2.1A, giữ tradeoff ở ADR-008.

### ADR-003 — Retention & Deletion

- **Status:** Accepted. Authority: Project Owner, 2026-10-12.
- **Context:** Hard delete thường xuyên gây mất dữ liệu và cản trở restore/history.
- **Decision:** Archive Project + Soft Delete Task. Task.deletedAt nullable; default
  queries loại deleted tasks; restore có kiểm soát; soft delete không xóa audit history.
- **Rationale:** Xóa khỏi working view mà giữ provenance, trạng thái và khả năng restore.
- **Alternatives considered:** Hard delete đơn giản nhưng irreversible; CANCELED
  là lifecycle nghiệp vụ, không thay soft delete; deleted enum trộn hai dimensions.
- **Consequences:** Loại project/task hard delete khỏi CRUD thông thường. Filters,
  search/progress, assignment/reorder và indexes phải xét deletedAt. History
  TaskActivity vẫn Future; khi có history, soft delete không cascade xóa nó.
- **Implementation considerations (proposed):** Project.archivedAt là source of
  truth (null=active), bỏ redundant Project.status ACTIVE/ARCHIVED tránh drift.
  Archive giữ Tasks nguyên status/completedAt/deletedAt, readable; block create/
  update/status/assignment/move/reorder/soft-delete/restore tasks ở archived project.
  OWNER/ADMIN restore project trước. Membership cleanup là exception quản trị.

Task soft-delete đặt deletedAt server time và increment version/updatedAt, giữ
status/completedAt/dueAt/position/project và audit history. Không tự chuyển CANCELED.
Deleted task chỉ đọc qua authorized trash query, không edit/assign/move/complete.
Restore trong transaction: check role/account/membership trong Workspace, Project active hoặc null,
expected version; revalidate assignee ACTIVE/account ACTIVE (không còn hợp lệ thì
clear assignee); giữ creator/status/completedAt/dueAt, allocate position ở cuối
partition hiện tại, clear deletedAt, increment version. Repeated delete/restore
cần idempotent response policy trong API design, không ghi lại event/timestamp vô hạn.

Retention duration và purge chưa chốt, không giả định 30/90 ngày hoặc tạo job.
Workspace archive/delete không trong MVP theo ADR-008. Workspace/account
physical deletion, retention duration và purge là future review; FKs RESTRICT
tránh accidental cascade. Không tự thêm backup/privacy/export workflows. Soft delete không chạy ON DELETE action; tombstone vẫn giữ FKs.
Tên task không unique; live position unique theo ADR-009; PK/compound FK target uniques giữ
cả deleted rows để history ổn định. Nếu sau này thêm live-only business uniqueness,
phải review partial predicate và restore conflicts. Trash/default queries không lọt
resource cross-workspace.

### ADR-004 — Deadline Strategy

- **Status:** Accepted. Authority: Project Owner, 2026-10-12.
- **Context:** Deadline instant phải nhất quán giữa server, browser và timezone.
- **Decision:** dueAt nullable PostgreSQL timestamptz; null=no deadline; exchange
  timestamp có explicit timezone, ưu tiên UTC; display theo timezone user. Date-only
  là future, không tự đổi thành 23:59 UTC hoặc timezone-free datetime.
- **Rationale:** Tránh ambiguous timestamps và ngày hiển thị sai do implicit zone.
- **Alternatives considered:** date-only phù hợp all-day nhưng thiếu instant;
  timestamp without time zone cần convention ngoài type; two-mode fields tăng scope.
- **Consequences:** No dueDate/allDay field trong MVP; browser timezone có thể dùng
  trước User preferences, không bắt buộc preferences table.
- **Implementation considerations (proposed):** @db.Timestamptz(3) cho instants;
  require ISO timestamp có Z hoặc numeric offset ở API; trả UTC Z. overdue hợp lệ,
  không CHECK dueAt>=createdAt. PostgreSQL không lưu IANA timezone name trong instant;
  recurring/date-only cần design riêng.

| Timestamp | Meaning / mutation policy |
| --- | --- |
| createdAt | Server time khi row được tạo, immutable |
| updatedAt | Server time khi persisted row thay đổi; không thay vì read |
| completedAt | Current DONE entry time; null khi status khác DONE; DONE→DONE giữ nguyên |
| dueAt | User-specified deadline instant, nullable, không completion/deletion time |
| deletedAt | Task tombstone server time, nullable; restore reset null, không đổi completedAt |
| archivedAt | Chỉ Project lifecycle instant; null active, khác Task.deletedAt; Workspace không có field này |

### ADR-005 — Workspace Owner Consistency

- **Status:** Accepted. Authority: Project Owner, 2026-10-12.
- **Context:** ownerId và role OWNER là duplicated representation cần commit consistency.
- **Decision:** Workspace.ownerId → valid User; đúng một matching WorkspaceMember
  role OWNER/status ACTIVE trong cùng workspace. Không remove/deactivate/demote
  current owner ngoài ownership transfer hợp lệ.
- **Rationale:** Ownership query rõ và cùng role model cho mọi member.
- **Alternatives considered:** Role-only bỏ direct owner FK; ownerMemberId tạo cycle;
  service-only checks dễ bị SQL ngoài service phá invariant.
- **Consequences:** Pure Prisma relations/ordinary transaction chưa đủ cho mọi direct SQL; baseline
  và optional custom DB strengthening cần review/test theo ADR-011 trước migrations.
- **Implementation considerations (recommended MVP protection, chưa triển khai):**

| Mechanism | What it protects / limit |
| --- | --- |
| User FK và UNIQUE(workspaceId,userId) | Valid owner identity, không duplicate membership |
| Partial unique workspaceId WHERE role=OWNER | At most one OWNER, kể cả inactive; không enforce existence/ACTIVE/match ownerId; immediate, không deferrable |
| Compound owner FK optional design | (Workspace.id,ownerId) → Member(workspaceId,userId) bảo đảm owner membership exists; tạo cyclic bootstrap FK cần DEFERRABLE custom SQL; không tự enforce role/status |
| Deferred constraint triggers trên Workspace và WorkspaceMember | Check final commit state: exactly one OWNER, ACTIVE, userId=ownerId; membership/owner/type changes kể cả delete; PERSONAL member count; row-local CHECK không làm được |
| Database-side locking guard cho ownership/member writes | Serialize writers trên cùng Workspace trước khi kiểm tra; SQL callers ngoài service cũng cần guard; deferred check đơn lẻ không thay serialization |
| Service transaction + row locks | Authorization + atomic transfer; chỉ bảo vệ service callers tuân thủ protocol, không tự ngăn mọi direct SQL |
| Serializable isolation alternative | Retry serialization failures, không thay missing constraints hoặc authorization |

Đề xuất strengthening từ 2.1A: User/member FKs + immediate OWNER partial unique
và database-side locking/deferred triggers. ADR-011 chốt minimum viable baseline
và known limits; không coi full trigger design đã approved/tested. Compound owner
FK là alternative, không cộng thêm cyclic relation vào ERD nếu không chọn ở ADR-011 baseline.
DB triggers phải check OLD/NEW affected workspace, update/insert/delete ở cả bảng,
parent deletion và snapshot/locking race; dedicated disposable-DB tests bắt buộc.
Không có guard này trên database hiện tại; chưa khẳng định SQL direct bảo toàn owner.
Privileged DBA/migrator có thể disable triggers/constraints; đây không phải threat
model được ordinary application role tự bảo vệ tuyệt đối.

Transfer workflow được thiết kế cho TEAM; chưa mở UI/API trong MVP PERSONAL:

1. Pre-validate authenticated actor=current owner và target active same-workspace
   member/account; precheck không thay transactional recheck. Reject target=self.
2. Begin transaction; lock involved Users theo ID, Workspace FOR UPDATE, rồi
   membership rows theo ID. Tất cả related mutations dùng lock order này.
3. Re-read ownerId/roles/status sau lock, compare expectedOwnerId/updatedAt token;
   stale request reject. Hai transfers đồng thời serialize; không silent last-write-wins.
4. Update Workspace.ownerId=target; demote old OWNER → ADMIN; promote target → OWNER.
   **Old demotion trước new promotion** vì partial unique immediate. Intermediate
   zero OWNER chỉ trong atomic transfer, phải validate final state trước commit. Nếu
   chọn deferred trigger thì guard thực thi ở commit; baseline limits xem ADR-011.
5. Recheck final owner/member state; deferred DB guard kiểm tra thêm nếu được triển
   khai theo ADR-011; commit atomically hoặc rollback toàn bộ.

PERSONAL transfer bị chặn trong first MVP; target membership không thể tồn tại
nếu giữ single-member personal policy. Future conversion/transfer cần review personal
uniqueness cho target; không conversion/transfer PERSONAL trong MVP. Owner không còn ACTIVE membership chỉ được xử lý
bằng recovery policy riêng, không tự gán người khác. Direct SQL writers không tuân
lock order có thể deadlock và cần abort/retry; DB concurrency guard phải test
races chứ không chỉ chạy happy path transaction. [PostgreSQL constraint triggers](https://www.postgresql.org/docs/18/sql-createtrigger.html).

### ADR-006 — Task Ordering

- **Status:** Accepted. Authority: Project Owner, 2026-10-12.
- **Context:** List/inbox/future Kanban cần reorder với deterministic sequence.
- **Decision:** Task.position kiểu BigInt. Không Float, không tự triển khai LexoRank.
- **Rationale:** Integer precision rõ, gap allocation/rebalance đơn giản cho MVP nhỏ.
- **Alternatives considered:** Float midpoint có precision drift; Decimal giữ
  precision nhưng vẫn hết gap; LexoRank/string phức tạp và chưa cần.
- **Consequences:** Rename proposal sortOrder → position; int64 bounds; không JSON
  number conversion mất precision. Partition/strict uniqueness chốt ADR-009;
  allocator/retry tuning là implementation recommendation.
- **Implementation considerations:** ADR-009 chính thức hóa lane scope và strict
  live position uniqueness; supersede duplicate-tolerant proposal của 2.1A. BigInt
  API decimal string, không direct JSON.stringify hoặc Number(BigInt). Alternative
  Float/Decimal/LexoRank giữ như tradeoff, không sử dụng trong MVP.

### ADR-007 — Optional Project & Inbox Tasks

- **Status:** Accepted. Authority: Project Owner, 2026-10-12.
- **Context:** Personal capture không nên buộc tạo Project hệ thống.
- **Decision:** Task.workspaceId required, projectId nullable; null=Inbox; đúng một
  Workspace, Project nếu có phải cùng Workspace. Không Project giả Inbox.
- **Rationale:** Inbox có full task lifecycle/priority/dueAt/position/assignee mà
  vẫn chung authorization/tenant boundary.
- **Alternatives considered:** Required Project đơn giản nullability nhưng cần
  special Inbox project; FK đơn projectId không chống cross-workspace đầy đủ.
- **Consequences:** Project UNIQUE(workspaceId,id) all rows; compound Task FK
  (workspaceId,projectId) → Project(workspaceId,id), MATCH SIMPLE. projectId null
  bỏ check compound relation, required Workspace FK vẫn bảo vệ tenant tồn tại.
- **Implementation considerations:** Scoped account/member authorization; create
  Inbox, move Inbox→Project, Project→Inbox, Project→Project cùng Workspace cần
  live Task và current/destination Project archivedAt null. workspaceId immutable;
  không move cross-workspace MVP. Move allocate position destination lane ADR-009,
  status/completedAt giữ nguyên, expected version increment. Deleted Task phải
  restore trước move; archived Project phải restore trước move. Queries projectId
  IS NULL cho inbox, deletedAt IS NULL default, không OR unscoped project relation.

### ADR-008 — Workspace Lifecycle

- **Status:** Accepted. Authority: Project Owner, 2026-10-12.
- **Context:** Workspace retention/deletion chưa là nhu cầu personal MVP.
- **Decision:** Không archive/delete Workspace API/UI/job trong MVP; không tự cascade
  dữ liệu Workspace. Workspace là boundary Project/Task; account deletion Future.
- **Rationale:** Giảm lifecycle state chưa dùng và accidental destructive deletion.
- **Alternatives considered:** archivedAt/deletedAt cho Workspace hỗ trợ recovery/
  nhiều historical personal workspaces nhưng tăng filters/restore/retention scope.
- **Consequences:** Bỏ Workspace.archivedAt proposal 2.1A; không deletedAt/status
  lifecycle trong MVP. PERSONAL unique ownerId WHERE type=PERSONAL trên toàn rows;
  active personal rule trở thành at-most-one persisted personal workspace/user.
- **Implementation considerations:** RESTRICT cho Workspace→Members/Projects/Tasks,
  User→Workspace/Member; no hard-delete endpoint hoặc retention job. Direct SQL
  delete workspace empty vẫn cần controlled write policy, FK RESTRICT không cấm
  deletion parent không dependents. Future archive/delete/account workflows phải
  ADR amendment/migration-impact review trước thêm fields/predicates/cleanup; không
  thiết kế GDPR/export trong bước này. Project.archive và Task.soft-delete giữ nguyên.

### ADR-009 — Task Ordering Partition

- **Status:** Accepted. Authority: Project Owner, 2026-10-12.
- **Context:** Inbox NULL và soft-delete làm ordinary unique key không đủ.
- **Decision:** Partition workspaceId + projectId/inbox + status; position BigInt
  tăng dần, **không hai live Tasks cùng position trong partition**; deletedAt khác
  null không chiếm active slot. Project/status change nhận position mới; reorder atomic.
- **Rationale:** Independent list/Kanban lanes và deterministic ordering có DB backstop.
- **Alternatives considered:** Status-independent ranks trộn lanes; nonunique/id
  tie-break proposal 2.1A không đáp ứng strict uniqueness; expression COALESCE project
  sentinel cần sentinel collision constraint; NULLS NOT DISTINCT index hợp lệ PG18
  nhưng Prisma support cần kiểm tra. Chọn hai partial unique indexes dễ review.
- **Consequences:** PostgreSQL 18.6 design dùng đúng hai guards (logical names):

| Guard | Unique key | Predicate |
| --- | --- | --- |
| task_live_project_position_unique | (workspaceId,projectId,status,position) | deletedAt IS NULL AND projectId IS NOT NULL |
| task_live_inbox_position_unique | (workspaceId,status,position) | deletedAt IS NULL AND projectId IS NULL |

Ordinary UNIQUE(workspaceId,projectId,status,position) xem NULL distinct nên không
chặn Inbox collision; cũng sai nếu giữ deleted rows trong guard. Hai predicates
cover mọi live Task và loại tombstones; archived-project Tasks vẫn live và reserve
positions. id tie-break chỉ pagination fallback, **không** mitigation duplicate
live ranks. [PostgreSQL partial indexes](https://www.postgresql.org/docs/18/indexes-partial.html).

- **Implementation considerations — allocator/transaction:**

| Operation | Design rule |
| --- | --- |
| Initial/append | First=1024; append last+1024; validate signed int64 trước ghi |
| Insert before/between | Dùng integer gap; midpoint khi còn free integer, prepend nếu đủ nonnegative gap; không Float |
| Project/status move | Lock source/destination scopes, allocate cuối destination, update project/status/completedAt/position/version atomically |
| Restore | Allocate mới trong stored Project/Inbox+status rồi clear deletedAt trong cùng update/transaction; không reuse stale rank |
| Soft-delete | Giữ position lịch sử; deletedAt non-null nhả unique slot, không xóa history |
| Rebalance | Giữ relative live order, final ranks 1024*n; version/updatedAt của rows đổi rank; check capacity trước toàn transaction |

Partial unique indexes immediate, không deferrable: rebalance trực tiếp swap ranks
có thể collide ngay giữa updates. Recommended two-phase rebalance dùng distinct
**temporary positions nonnegative chưa bị live rows dùng** rồi chuyển tới final
ranks, cùng transaction; chứng minh đủ free integer slots/range trước ghi. Không
soft-delete rows tạm để né guard; không expose temporary ranks. Nếu không có staging
space trong int64, abort với capacity/conflict error, không overflow hoặc coi rank
không giới hạn. Negative band alternative cần amend nonnegative CHECK, chưa chọn.

MVP locking recommendation: Users theo ID → Workspace FOR UPDATE → Task rows theo
ID; Workspace lock serialize create/reorder/status/project/restore/delete trong tenant,
cover cả partition rỗng. Re-read active neighbors/scopes/version sau lock; all writers
cùng protocol. Transaction đơn lẻ không đủ; task row lock không khóa empty lane.
Future partition advisory locks có thể tăng concurrency, cần canonical key cho Inbox
và source/destination lock order; chưa cần extra lock table. Unique guards chặn live
collisions kể cả writers khác protocol. Retry whole transaction bounded (đề xuất tối
đa 3 lần) với fresh ranks cho unique conflict/serialization/deadlock; stale user
expected-version conflict trả lỗi, không blind retry overwrite. DB race/rebalance
behavior cần tests ở implementation phase, chưa chạy tại 2.1B.

Prisma có thể model BigInt/enums/fields và normal compound indexes. Docs hiện hành
có partial-index where syntax qua partialIndexes Preview feature; phải validate pinned 7.10.0 cho hai predicates/named
unique indexes. Nếu không đủ support/feature settings, preserve SQL migration
supplement; không dùng ordinary @@unique làm thay thế. Alternative NULLS NOT DISTINCT,
expression indexes và CHECK/trigger SQL cần separate support verification; không tự
viết migration. [Prisma index support](https://www.prisma.io/docs/orm/v7/prisma-schema/data-model/indexes).
API position decimal string; backend nhận neighbor/destination IDs/expected version,
frontend không tính rank hoặc trực tiếp JSON.stringify BigInt.

### ADR-010 — Authentication Storage

- **Status:** Accepted. Authority: Project Owner, 2026-10-12.
- **Context:** Identity/profile cần tách password/OAuth/refresh-secret lifecycle.
- **Decision:** User + PasswordCredential + OAuthAccount + RefreshSession supporting
  models riêng; thuộc Auth implementation phase. Năm core domain entities không đổi.
- **Rationale:** Một User nhiều login methods, no plaintext passwords, revoke/rotate
  refresh sessions độc lập; stable provider identity không duplicate.
- **Alternatives considered:** Credentials trên User dễ coupling; raw refresh-token
  storage làm lộ reusable secret; tự auto-link qua email chưa verified không hợp lệ.
- **Consequences:** Chuẩn hóa AuthIdentity/AuthSession đề xuất 2.1A thành OAuthAccount/
  RefreshSession, providerSubject thành providerAccountId. Không thêm full auth schema
  vào core ERD; supporting field details cần Auth modeling/security review riêng.
- **Implementation considerations — separate Auth storage contract:**

| Entity | Recommended fields / cardinality | Constraints và rules |
| --- | --- | --- |
| User | UUID id, canonical email, displayName/avatar, accountStatus, createdAt/updatedAt; emailVerifiedAt nullable auth integration field | Email trim/canonical lowercase policy, no dot/+ alias rewriting; unique canonical email; ACTIVE/SUSPENDED là existing proposal; verification không suy ra từ ACTIVE |
| PasswordCredential | userId PK/FK, passwordHash, passwordUpdatedAt, createdAt/updatedAt; hash algorithm/version nếu encoded hash chưa đủ | User 0..1; salted adaptive hash, never plaintext; OAuth-only không row; algorithm/work-factor phase Auth review |
| OAuthAccount | id PK, userId FK, provider, providerAccountId, providerEmail?, providerEmailVerified?, createdAt/updatedAt | User 0..N; UNIQUE(provider,providerAccountId); Google sub là stable ID; linking authenticated ownership+reauth/valid OAuth evidence; email không sole key |
| RefreshSession | id PK, userId FK, familyId, tokenHash UK, createdAt, expiresAt, usedAt?, revokedAt?, replacedById? FK, lastUsedAt?, deviceLabel? | User 0..N; mỗi row một refresh generation; high-entropy token, hash-only; unique replacedById nullable để một successor không bị nhiều predecessors; no raw secret/IP history default |

Rotation recommendation: lock current session/family, check expiry/revocation/usedAt,
create one successor và mark used/replacedBy trong cùng transaction. Concurrent
refresh cùng token chỉ một thắng; request khác reject, không issue successor thứ hai.
Retain consumed hashes trong replay-detection window; family revocation khi reuse theo
security policy. FamilyId grouping per User; self successor FK cần validate same User/
family bằng transactional checks hoặc compound guard khi Auth modeling. Logout/
password change/suspension revoke sessions theo policy; new sessions không resurrect
revoked family. Family serialization không chỉ lock một generation nếu revocation
cạnh tranh successor refresh; cụ thể family-level lock/key cần phase Auth design.

Email verification/reset tokens, access JWT vs opaque, cookie/CSRF, rotation race
response/grace, retention cleanup/TTL, device privacy và family lock implementation
là **Auth-phase classified prerequisites**, không thêm tables/API trong Phase 2.1B.
Pending verification không cho email làm evidence link; verified Google email trùng
existing User yêu cầu chứng minh existing ownership, không silent-link/duplicate.
Provider identity unique còn backstop concurrent login/link. Cleanup chỉ xóa expired/
revoked generations sau replay window đã duyệt; không đặt job/retention number ở đây.

### ADR-011 — Workspace Owner Consistency Enforcement

- **Status:** Accepted. Authority: Project Owner, 2026-10-12.
- **Context:** ADR-005 invariant cần realistic boundary giữa service và database.
- **Decision:** Transaction/locking + DB constraints, ghi rõ enforcement limits.
  ownerId valid User; matching ACTIVE OWNER membership, một OWNER/workspace.
- **Rationale:** Chặn reference/duplicate corruption và serialize ownership writes
  mà không tuyên bố Prisma schema thuần bảo vệ mọi SQL operation.
- **Alternatives considered:** Service-only không chặn direct SQL; role-only model
  đổi ADR-005; cyclic compound owner FK/deferred triggers mạnh hơn nhưng thêm SQL
  feasibility/privilege/concurrency verification cần phase implementation.
- **Consequences:** Minimum viable design baseline: User/Workspace FKs, Member
  UNIQUE(workspaceId,userId), partial unique workspaceId WHERE role=OWNER,
  service-controlled owner/member writes dùng Workspace lock + final recheck.
  Exactly-one/matching ACTIVE owner vẫn không được các FK/unique này enforce đầy đủ.
- **Implementation considerations:** DB deferred constraint/locking triggers là
  recommended strengthening cho commit-time role/status/existence invariant, không
  được coi là có trên DB hiện tại. Compound owner FK (Workspace.id,ownerId)→Member
  (workspaceId,userId) là alternative, cyclic bootstrap cần DEFERRABLE SQL, không
  tự chứng minh OWNER/ACTIVE. Pure Prisma không biểu diễn toàn bộ guards.

Ownership transfer: authorization/target precheck → begin transaction → lock Users
sorted (nếu account checks) rồi Workspace row → lock/recheck membership/current
owner/target ACTIVE và expectedOwnerId → update ownerId → demote old OWNER ADMIN
→ promote target OWNER → validate final state → commit atomic. Partial OWNER unique
immediate nên không promote trước demote. TEAM workflow future; PERSONAL transfer
chưa trong MVP UI/API, không tự tạo target member/conversion.

| Race | Baseline handling / limitation |
| --- | --- |
| Two transfers | Same Workspace lock; stale expectedOwnerId fail sau recheck |
| Transfer vs target removal/role change | Same lock protocol; whichever second recheck target state, không dùng precheck cũ |
| Transfer vs workspace metadata update | Same Workspace lock; owner-only action recheck owner trước write |
| Direct SQL remove/demote owner hoặc ownerId mismatch | FK/partial unique chỉ bảo vệ existence/at-most-one; controlled write access/DB trigger cần bổ sung nếu bảo đảm full invariant |

Controlled write access là application policy, không tuyên bố runtime CRUD role đã
bị DB hạn chế column-level. Ordinary direct SQL bằng runtime role có thể bypass
service logic; DBA/migrator còn có quyền thay guards. Deferred triggers/locking phải
handle OLD/NEW workspace, membership changes, bootstrap and concurrent snapshots;
phải verify trên disposable DB trước khi khẳng định full commit guarantee.
Không tạo triggers hoặc thay roles trong bước này. Validation/SQL feasibility là
implementation prerequisite đã phân loại, không còn undecided domain representation.

## Remaining questions — classified, không hidden core-schema blockers

| Item từ 2.1A | Disposition sau 2.1B | Remaining phase/impact |
| --- | --- | --- |
| O-01 Project optionality | Resolved ADR-007 | Permission granularity giữ proposed OWNER/ADMIN projects, MEMBER shared edit/creator trash policy; API/product review, không extra ACL table trong core baseline |
| O-02 Workspace lifecycle | Resolved ADR-008, no lifecycle fields | Physical Workspace/account deletion, retention/purge Future; cần new ADR/migration review khi scope đổi |
| O-03 Owner enforcement | Resolved architecture ADR-011, limits explicit | SQL guard feasibility, direct-SQL/concurrency tests và controlled-write enforcement là implementation prerequisites |
| O-04 Ordering | Resolved ADR-009 strict unique lanes | Allocation/rebalance staging/retry tuning tests ở implementation, không duplicate-tolerant policy |
| O-05 Auth storage | Resolved ADR-010 model boundaries/names | Token/verification/reset storage details và User.emailVerifiedAt belong Auth-phase schema review, không tự embed tables vào core modeling |
| O-06 IDs/mapping/text | Technical modeling baseline: application-generated UUID v4/native uuid; snake_case map, nonblank limits giữ proposal | Engineering default trong freeze, không invented Project Owner ADR; nếu đổi UUID strategy phải migration-impact note; limits validated before DTO/API |
| O-07 Recovery/suspension | Core retain INACTIVE membership; unassign all tasks incl deleted rows | Team/Auth recovery/retention policies deferred, không personal MVP APIs |
| O-08 Search/RLS/history | Core scoped simple title search, no new entities | FTS/RLS/custom statuses/history future; separate ADR nếu cần từ MVP |

Tradeoffs P-01..P-12 trong 2.1 và O decisions 2.1A được retained dưới ADR alternatives/
remaining table. Đề xuất Workspace.archivedAt bị ADR-008 thay thế; nonunique position
bị ADR-009 thay thế; auth naming được ADR-010 chuẩn hóa. Không xóa lý do/tradeoffs.

## Frozen core field and integrity baseline

Full dictionary ở domain/ERD. UUID v4 application-generated/native PostgreSQL uuid
cho entity PKs; createdAt/updatedAt instants timestamptz(3); deadline/soft-delete
instants cùng precision. Prisma default UUID generation có thể thực hiện ở ORM
client, không giả định SQL direct insert có DB uuid default nếu chưa chọn rõ.

Defaults: User ACTIVE; Workspace PERSONAL; Member MEMBER/ACTIVE (owner bootstrap
OWNER); Project.archivedAt null; Task TODO/MEDIUM/version=1/deletedAt=null/completedAt
null. Task.position required do allocator tính (first 1024), không shared default 0.
User required email/displayName/status; avatar nullable; Workspace ownerId/name/type
required, không archive/delete fields; Member workspaceId/userId/role/status/joinedAt
required; Project name/workspace required, description/color/icon/archive nullable;
Task required title/workspace/creator/status/priority/position/version/timestamps,
project/assignee/description/dueAt/completedAt/deletedAt nullable. emailVerifiedAt
classified Auth-phase field chưa lẫn core ERD; separate auth proposal phải review.

| Invariant | Enforcement layer/constraint | Limit / prerequisite |
| --- | --- | --- |
| Membership unique/valid User | UNIQUE(workspaceId,userId) + User/Workspace FKs | ACTIVE status cần business transaction checks |
| Owner valid và at-most-one OWNER | ownerId User FK + OWNER partial unique | Exactly-one/match/ACTIVE cần ADR-011 service+optional SQL guard, không schema thuần |
| Một PERSONAL/User | Partial unique Workspace(ownerId) WHERE type=PERSONAL | At-most-one; User bootstrap bảo đảm creation, không archive escape |
| Project same Workspace | Required Workspace FK + Project UNIQUE(workspaceId,id) all rows | workspaceId immutable application, SQL immutability guard separate |
| Task project/member references scoped | Compound Project FK MATCH SIMPLE + creator/assignee Member composite FKs | Non-null Workspace FK; active/authorization không FK substitute |
| Live ordering unique | Hai partial unique ADR-009 cho Project/Inbox + status | SQL/type support verify; immediate guards ảnh hưởng rebalance |
| DONE/completion consistent | Row CHECK (DONE AND completedAt non-null) OR (not DONE AND completedAt null) | Deleted DONE giữ completion; transition graph/timestamp origin service |
| Position/version validity | BigInt int64; proposed position>=0, version>=1 CHECK | Finite staging space; conditional version writes; overflow guard before arithmetic |
| Default visibility/isolation | deletedAt IS NULL, scoped joins/search/counts; active member auth | Runtime DB role không per-workspace RLS; no generic includeDeleted bypass |

FK target keys/PK giữ cả tombstones, không partial; Project TaskTag future references
same scoped strategy. Proposed onDelete RESTRICT/onUpdate NoAction for User→Workspace/
Member, Workspace→Member/Project/Task, Project→Task, Member→Creator/Assignee. Soft-delete/
archive không invoke delete actions. No workspace/task/project hard-delete ordinary
workflow; future purge reviewed separately. No SET NULL whole composite tuple vì
workspaceId required. UpdatedAt writes qua Prisma không tự bảo vệ direct SQL timestamps.

Additional index proposals: Member(userId,membershipStatus,workspaceId), Project
(workspaceId,archivedAt,createdAt,id); Task deadline/workspace-status/assignee live
indexes WHERE deletedAt IS NULL; trash (workspaceId,deletedAt,id) WHERE deletedAt IS
NOT NULL; all-row Task FK lookup indexes(workspaceId,projectId/createdById/assigneeId)
để tombstones không bị bỏ qua integrity cleanup. Titles không business-unique.
Task lane unique indexes không chứa id trong unique key (thêm id sẽ cho duplicate rank).
Index optimizations tune bằng data/EXPLAIN ở implementation, không auto redundant indexes.

PostgreSQL NULL uniqueness/MATCH SIMPLE và partial predicates có semantics riêng;
Prisma docs hiện hành hỗ trợ một số partial-index where syntax, cần validate pinned
7.10.0/feature settings. Triggers/CHECK/deferrability và unsupported predicates cần
SQL migration supplement khi implementation được phép. Không viết hoặc chạy SQL
ở 2.1B. [PostgreSQL constraints](https://www.postgresql.org/docs/18/ddl-constraints.html).

## Phase 2.1 MVP Domain Design Freeze

Trạng thái: **FROZEN FOR CORE MODELING DESIGN**, ngày 2026-10-12, theo decisions
Project Owner cung cấp trong 2.1A/2.1B. Không permission tạo models/migrations.

| ADR | Accepted decision |
| --- | --- |
| ADR-001 | Email/password + Google OAuth, multi-method User |
| ADR-002 | PERSONAL/TEAM schema, PERSONAL-only first MVP UI |
| ADR-003 | Archive Project + soft-delete Task |
| ADR-004 | dueAt nullable timestamptz instant |
| ADR-005 | Workspace.ownerId + matching ACTIVE OWNER membership |
| ADR-006 | BigInt Task.position |
| ADR-007 | Workspace required, optional Project/Inbox |
| ADR-008 | No Workspace archive/delete API/UI/fields/jobs MVP |
| ADR-009 | Strict unique live position per workspace+project/inbox+status |
| ADR-010 | Supporting PasswordCredential/OAuthAccount/RefreshSession, separate Auth phase |
| ADR-011 | Transaction/locking + DB guards, known ownership limits |

Core: User/Workspace/WorkspaceMember/Project/Task. Auth supporting models riêng;
Tag/TaskTag/Checklist should-have, collaboration/history/files/reminders/recurrence/
notifications/VIEWER/team UI/custom statuses/RLS/advanced search/date-only Future.
MVP boundaries: personal UI, scoped core CRUD, Project archive, Task soft-delete/
restore/lifecycle/ordering. No Workspace deletion/retention jobs, fake Inbox project,
Auth implementation hoặc full team UI tự thêm.

DB invariants và limitations là phần của freeze: composite references, member/owner/
personal uniqueness, live-lane uniqueness, completion CHECK; role/ACTIVE/exact-one
owner needs ADR-011 guards, schema-support chưa verified trên pinned version. Implementation prerequisites:
Prisma overlapping-FK validation, custom index/CHECK SQL plan, owner guard tests,
unique-preserving rebalance/restore/race tests, auth phase detail review, separate
scope authorization. Freeze không bất biến: nếu 2.2 phát hiện constraint/API issue,
phải amend ADR với reason, backfill/uniqueness/drift/migration impact trước thay
field/predicate/referential action. Không silently drop guards để schema compile.

## Prisma Modeling Readiness Checklist

- [x] Core fields/types/defaults và nullable fields đã ghi đầy đủ: frozen dictionary,
  ADR-007/008/009; auth-only User additions được phân loại riêng.
- [x] Relationships/cardinality đã chốt: Workspace required, Project optional,
  Member many-to-many User/Workspace, creator required/assignee optional.
- [x] Primary key strategy: technical baseline UUID v4 application-generated/native uuid.
- [x] Unique constraints: member pair, scoped FK targets, PERSONAL owner, OWNER role,
  strict live Project/Inbox lane position; không id trong unique rank key.
- [x] Foreign keys + MATCH SIMPLE/NULL semantics rõ; active checks không nhầm FK.
- [x] Referential actions RESTRICT/NoAction, no accidental Workspace cascade.
- [x] Partial indexes PostgreSQL predicates + Prisma support/SQL supplement plan ghi.
- [x] Database-only CHECK/trigger/deferrability và owner limits phân loại riêng.
- [x] Auth supporting boundary/names + separate modeling prerequisites rõ.
- [x] Owner transfer/concurrency/direct-SQL limitations rõ (ADR-011).
- [x] Position allocator/rebalance/retry/restore/serialization strategy rõ (ADR-009).
- [x] MVP/future scope và Design Freeze đã ghi.
- [x] Local implementation authorization: **APPROVED FOR LOCAL DEVELOPMENT** theo
  [IA-001](../security/local-development-authorization.md), explicit Project Owner
  confirmation 2.1D ngày 2026-10-12. RA-001 giữ design-only lịch sử; local scope/
  controls ghi riêng IA-001, không automatic models/migrations trong lượt này.

| Readiness dimension | Status / meaning |
| --- | --- |
| Domain Design | READY FOR PHASE 2.2 PLANNING/REVIEW; no unclassified core schema decision blocker |
| Prisma Modeling Blueprint | READY FOR IMPLEMENTATION PLANNING; xem [modeling plan](prisma-modeling-plan.md) |
| Actual Prisma/SQL compatibility verification | NOT RUN; thực hiện ở task local tiếp theo theo IA-001, không coi approval là verification |
| Local Development Authorization | APPROVED — IA-001, local only + scope/controls |
| Auth detailed modeling | SEPARATE PHASE, storage boundaries decided, detailed security parameters review before Auth code |
| Production Release | NOT APPROVED; SEC-01/SEC-02 High/Open, RA-001 unchanged |
| Staging Release | NOT APPROVED |

Historical readiness update 2.1C (2026-10-12, trước approval 2.1D): [IA-001](../security/local-development-authorization.md)
chỉ là đề xuất local implementation. Yêu cầu lập hồ sơ không phải approval;
để authorization checklist unchecked tới khi Project Owner xác nhận riêng.
11 ADR Accepted và Design Freeze không thay đổi; không tự chuyển Phase 2.2.

Verification 2.1B chỉ tài liệu: Mermaid parse, links, 11 unique Accepted ADR IDs,
field/relationship/lifecycle/order consistency, freeze/checklist và git diff --check.
Không build/tests, Prisma commands, migrations hoặc DB changes. Dừng review;
không tự chuyển Phase 2.2. RA-001 review deadline vẫn 2026-11-11 và triggers có hiệu lực.


Readiness update 2.1D (2026-10-12): IA-001 được Project Owner explicitly approved
for local development. Domain Design READY; Prisma Modeling Blueprint READY FOR
IMPLEMENTATION PLANNING; Local Development Authorization APPROVED; Production/
Staging NOT APPROVED. 11 Accepted ADRs, Design Freeze/invariants/limitations giữ
nguyên; approval không xác minh SQL/Prisma compatibility hoặc sửa SEC-01/SEC-02.
Không tự thực hiện Prompt 2.2B; task implementation tiếp theo phải tuân IA-001.
