# Shanflow — Domain Analysis

Ngày: 2026-10-12. Trạng thái: **11 ADR Accepted theo Prompt 2.1B**, core domain
design frozen; implementation prerequisites phân loại riêng. Chưa có schema hoặc
hành vi đã triển khai. Thiết kế được phép theo [RA-001](../security/risk-acceptance-001.md);
SEC-01/SEC-02 vẫn High/Open và production release chưa được phê duyệt.

Tài liệu liên quan: [ERD](erd.md), [Authorization matrix](authorization-matrix.md),
[Data decisions và open questions](data-decisions.md), [Foundation audit](../foundation-audit.md).

## Domain overview

Shanflow giúp một người thu thập, tổ chức và hoàn thành công việc trong workspace,
nhóm các task liên quan thành project, quản lý deadline và theo dõi tiến độ.
Workspace là ranh giới dữ liệu và quyền truy cập. Project là nhóm công việc;
task là đơn vị hành động có lifecycle riêng, không phải phần phụ thuộc bắt buộc
của project. Kiến trúc dữ liệu chuẩn bị cho cộng tác nhưng MVP ưu tiên cá nhân.

Các bounded contexts dưới đây là ranh giới trách nhiệm logic trong một backend,
không yêu cầu microservices, event bus hoặc sáu NestJS modules ngay từ đầu.

## Bounded contexts

| Context | Responsibilities và entities | Relationships, business rules và invariants | MVP | Future |
| --- | --- | --- | --- | --- |
| Identity & Access | Identity/profile User; account status; giải quyết actor đã xác thực | User tham gia nhiều workspace qua WorkspaceMember; email canonical unique; account SUSPENDED không có quyền dù membership ACTIVE | User profile; email/password + Google OAuth Accepted (ADR-001); supporting auth modeling riêng bắt buộc trước authenticated APIs | MFA, additional providers, account anonymization |
| Workspace Management | Workspace, WorkspaceMember; ownership và membership | Một owner; owner phải là ACTIVE member role OWNER; một membership/user/workspace; PERSONAL chỉ owner; TEAM có nhiều thành viên | Schema PERSONAL/TEAM Accepted; MVP UI chỉ PERSONAL; membership scoping/role model | Invitations, chuyển PERSONAL→TEAM, ownership transfer, billing không trong mục tiêu hiện tại |
| Project Management | Project metadata và lifecycle | Project thuộc đúng một workspace; tên không rỗng; archived project không nhận task mới/chỉnh sửa task | archivedAt nullable; create/read/update/archive/restore, không hard-delete CRUD | Templates, milestones, portfolios |
| Task Management | Task title, status, priority, dueAt, creator, assignee, ordering | Task có workspace bắt buộc, project tùy chọn cùng workspace; creator immutable; assignee không cấp quyền; completedAt nhất quán status | CRUD, lifecycle, inbox, project filtering, deadline, một assignee tùy chọn | Dependencies/BLOCKED, subtasks, recurring instances, calendar views |
| Task Organization | Tag, TaskTag, ChecklistItem; query/filter semantics | Tags cùng workspace với task; task-tag pair unique; checklist thuộc một task | Filters status/priority/project và title search đơn giản trên Task, không thêm entities | Tags/checklist ở should-have; saved views, full-text search/index mở rộng |
| Activity & Collaboration | TaskActivity, TaskComment, TaskAttachment, Reminder, RecurrenceRule, Notification | Activity ghi nhận sự kiện sau mutation; comments/files cần membership; notification recipient phải có quyền với resource | Chưa lưu activity/comment/files; tiến độ được tính từ Task, không thêm counters | Status history, comments, attachments, reminders, recurring, notification delivery |

## Core entity dictionary

Tên camelCase trong tài liệu là tên logical field; relational names/actions chỉ
là đề xuất, mapping PostgreSQL/Prisma và design freeze xem data-decisions.md.

| Entity | Attributes (Accepted fields + proposed details) | Meaning và defaults |
| --- | --- | --- |
| User | id, email, displayName, avatarUrl?, accountStatus, createdAt, updatedAt; emailVerifiedAt? cần auth modeling review | Application-generated UUID v4/native uuid technical baseline; email canonical; displayName không rỗng; ACTIVE mặc định, SUSPENDED chặn access; avatar là URL metadata, chưa có upload |
| Workspace | id, name, ownerId, type, createdAt, updatedAt | PERSONAL/TEAM; ownerId valid User; tối đa một persisted PERSONAL/user; không archive/delete fields/API/UI/job MVP (ADR-008) |
| WorkspaceMember | id, workspaceId, userId, role, membershipStatus, joinedAt, createdAt, updatedAt | OWNER/ADMIN/MEMBER; ACTIVE/INACTIVE; joinedAt là lần tham gia đầu tiên, không bị ghi đè khi reactivate; không dùng INACTIVE như pending invitation |
| Project | id, workspaceId, name, description?, archivedAt?, color?, icon?, createdAt, updatedAt | archivedAt null là active, non-null archived (recommended representation); không redundant status enum; archive không xóa Tasks; tên không unique |
| Task | id, workspaceId, projectId?, title, description?, status, priority, dueAt?, assigneeId?, createdById, position, version, completedAt?, deletedAt?, createdAt, updatedAt | TODO/MEDIUM mặc định; projectId null là inbox; assigneeId là User ID được ràng buộc membership; version bắt đầu 1; position BigInt Accepted; deletedAt null là live; creator không thay đổi |

`ownerId`, `createdById`, `assigneeId` đều nhận User IDs nhưng có ý nghĩa khác nhau:
owner quản trị workspace; creator lưu provenance; assignee chịu trách nhiệm công
việc. Chỉ membership role cấp quyền. User có thể owner một workspace, member
workspace khác và assignee nhiều tasks.

## Task có cần Project không?

| Option | Benefit | Cost |
| --- | --- | --- |
| Project bắt buộc | Một cách group/order duy nhất; giảm nullable relation | Buộc tạo project “Inbox”, thêm lifecycle/quyền đặc biệt cho project hệ thống |
| Workspace bắt buộc, Project tùy chọn | Ghi nhanh task cá nhân; inbox không cần project giả; move task trong cùng workspace đơn giản | Queries phải xử lý projectId null và FK compound; ordering cần inbox partition |

**ADR-007 Accepted:** workspace bắt buộc và project tùy chọn (null=Inbox). Không
dùng ownership kiểu “workspace hoặc project”: Task luôn có workspaceId độc lập,
FK compound bảo vệ project/workspace consistency. MVP không chuyển task/project
sang workspace khác; thay project trong cùng workspace được phép nếu cả project
nguồn/đích editable. Inbox có full status/priority/dueAt/position/assignee, không Project giả;
MATCH SIMPLE cho nullable projectId, required Workspace FK vẫn tồn tại.

## Business rules và task lifecycle

1. Mọi đọc/ghi resource đều kiểm tra actor account ACTIVE và membership ACTIVE
   trong chính workspace đó; UI validation không phải security boundary.
2. Workspace có đúng một owner active. PERSONAL có đúng một member là owner.
   Thêm member chỉ thực hiện trong TEAM; schema hỗ trợ TEAM nhưng MVP UI chỉ
   PERSONAL (ADR-002). TEAM transfer được thiết kế ở ADR-005; chưa mở UI/API;
   PERSONAL conversion/transfer chưa cho phép. Một PERSONAL/user trên persisted
   rows; ADR-008 không archive/delete Workspace hoặc fields lifecycle trong MVP.
3. Project/workspaceId và Task/workspaceId không đổi trong MVP. Creator phải là
   active member khi tạo task; membership lịch sử được giữ nếu họ rời workspace.
4. Assignee null được phép. Gán người khác chỉ tới active member có account ACTIVE
   trong cùng workspace. Remove/deactivate member phải unassign tất cả tasks kể cả soft-deleted rows
   trong cùng transaction; không đổi creator. Suspension toàn account cần policy riêng.
5. Project archivedAt non-null vẫn đọc được nhưng task create/update/complete/
   assign/move/reorder/soft-delete/restore bị chặn; OWNER/ADMIN restore project
   trước. Không hard-delete Project trong CRUD; archive không đổi Task status.
6. Status set: TODO, IN_PROGRESS, DONE, CANCELED; priority LOW, MEDIUM, HIGH,
   URGENT. Không cần BLOCKED hoặc custom statuses trong MVP.

| Transition | Rule |
| --- | --- |
| TODO ↔ IN_PROGRESS | completedAt null |
| TODO/IN_PROGRESS → DONE | completedAt = server transaction time |
| DONE → TODO/IN_PROGRESS | completedAt = null; có thể mở lại task |
| TODO/IN_PROGRESS/DONE → CANCELED | completedAt = null; cancellation không phải completion |
| CANCELED → TODO | Khôi phục rõ ràng, completedAt null; muốn DONE phải qua TODO |
| Status giữ nguyên DONE | Giữ completedAt cũ, không sửa thời điểm completion vì edit metadata |

Tất cả transitions dùng cùng permission Task update và optimistic version check.
completedAt biểu diễn lần completion hiện tại, không phải lịch sử; DONE rồi reopen
rồi DONE có timestamp mới. Status history là TaskActivity future,
không suy diễn được từ updatedAt.

**ADR-003 Accepted: Soft Delete Task.** deletedAt null là live; default list/search/
progress/assignment/reorder loại deleted rows. Delete giữ status/completedAt/dueAt/
position và history; chỉ đặt deletedAt/version/updatedAt, không chuyển CANCELED.
Deleted task chỉ đọc qua authorized trash view; không ordinary edit/complete/move.
Restore có kiểm soát: actor có active account/member trong Workspace, Project
phải active hoặc Inbox; kiểm tra role/version, revalidate
assignee (không active thì clear), giữ creator/status/completedAt/dueAt, allocate
position mới cuối lane, reset deletedAt. Không hard delete Task trong CRUD hoặc
retention job tự tạo. Audit history hiện Future; soft delete không xóa khi có history.
Project archive không tự DONE hoặc delete tasks. CANCELED khác DONE và deleted.

Progress dùng live Tasks: DONE / (TODO + IN_PROGRESS + DONE), bỏ CANCELED và
soft-deleted; empty denominator trả 0, không coi là completed project. Workspace không archive/delete trong MVP (ADR-008); Project archive giữ children.
Physical Workspace/account deletion và retention/purge là Future; RESTRICT guards
tránh accidental cascade, không tự cấp quyền deletion parent empty.

**ADR-004 Accepted:** dueAt là nullable instant timestamptz, API explicit offset và
ưu tiên UTC Z; browser/preferences timezone dùng để hiển thị. Không tự biến date-only
thành 23:59 UTC; all-day là future. createdAt là lúc tạo, updatedAt lúc persisted
mutation, completedAt lúc vào DONE, dueAt deadline, deletedAt tombstone và archivedAt
Project archive lifecycle; Workspace không có archivedAt; các trường không thay thế nhau.

**ADR-006/ADR-009 Accepted:** Task.position BigInt; partition workspace + Project/
Inbox + status, chỉ live Tasks. Không hai live tasks trùng position cùng lane;
soft-deleted Tasks không reserve slot. Status change/move/restore append destination,
DONE→DONE giữ position. Gaps 1024, integer midpoint, rebalance atomic với staging
ranks không collide immediate unique indexes. Initial first=1024, append last+1024;
overflow/capacity error không ghi partial. Task version và Workspace lock serialize
writers; bounded retry toàn transaction cho DB conflict, không overwrite stale version.
BigInt API decimal string, frontend không tính rank. Hai partial unique guards dành
riêng Project và Inbox; không ordinary NULL unique hoặc id tie-break để né collision.

## Inbox/move workflows và query scopes

Create Inbox Task giữ workspaceId required, projectId null và lane status riêng.
Move Inbox→Project, Project→Inbox, Project→Project trong cùng Workspace đều kiểm tra
actor/member, Task.deletedAt null, source/destination Project.archivedAt null hoặc
Inbox. workspaceId/creator immutable; không cross-workspace move MVP. Allocate rank
mới ở destination, update projectId/position/version atomic; status/completedAt giữ
nguyên khi chỉ đổi project. Combined status+project move cập nhật completion theo
status transition trong cùng transaction. Deleted task phải restore trước move;
archived Project phải restore trước move. Default queries luôn deletedAt IS NULL;
inbox projectId IS NULL, project filters và aggregates không bỏ Workspace scope.

## Supporting entity evaluation

| Entity | Classification | Reason và scope |
| --- | --- | --- |
| Tag | MVP Optional / should-have | Workspace labels; không cần cho task CRUD tối thiểu |
| TaskTag | MVP Optional / should-have | Join table chỉ thêm cùng Tag; không triển khai độc lập |
| ChecklistItem | MVP Optional / should-have | Checklist đơn giản trong task, chưa cần subtask hierarchy |
| TaskActivity | Future | Append-only status/change history; tránh lưu full task snapshot/PII mặc định |
| TaskComment | Future | Team collaboration, edit/moderation policy riêng |
| TaskAttachment | Future | Metadata + private object storage; không lưu binary PostgreSQL |
| Reminder | Future | Thời điểm gửi, retry/idempotence/timezone cần delivery design |
| RecurrenceRule | Future | Rule và generated instances, DST/idempotent generation cần proposal riêng |
| Notification | Future | Recipient/read state; không cần notification backend cho personal CRUD |

Không supporting task-organization/collaboration entity nào là MVP Required.
Auth supporting entities có dependency riêng, không nằm trong danh sách này. Tags/checklist là should-have sau
core, dù được vẽ trong future extension ERD; “Optional” không có nghĩa triển khai
cùng MVP schema ngay.

## MVP scope

**Must-have:** năm core entities; user/profile baseline; atomic personal workspace
bootstrap; project create/read/update/archive/restore và task CRUD với soft delete; inbox; lifecycle/priority/deadline; membership scoping;
filters/title search đơn giản; computed progress; database integrity và task version.
Email/password và Google OAuth đã Accepted; PasswordCredential/OAuthAccount/
RefreshSession và verification/session policy cần modeling riêng trước expose endpoints.

**Should-have sau core:** tags/checklist; assignment tự thân trong PERSONAL;
TEAM member management/UI chỉ future collaboration phase, không MVP UI; project presentation color/icon. Core giữ type/role/nullable
assignment để không cần redesign ownership khi mở cộng tác. Thiết kế matrix có
thể review ngay nhưng không kéo invitation/email/notification vào MVP.

**Future UI/features:** TEAM onboarding/collaboration, invitations, VIEWER, TEAM owner transfer, comments/files/history, reminders,
recurring tasks, Kanban views/custom statuses, calendar date-only semantics, advanced
search. Kanban/Calendar đơn giản có thể là views trên Task trước khi thêm entities.

## Example workflows — proposed data flows

Các workflows là thiết kế, không phải API/database operations đã chạy. Mọi mutation
và membership check cần transaction/locking strategy ở data-decisions.md.

| Workflow | Entities/data flow | Rules và authorization | Integrity/atomicity |
| --- | --- | --- | --- |
| 1. User đăng ký | Tạo User sau khi Identity xác nhận identity/email | Không dùng role workspace cho registration; email/password hoặc validated Google identity; linking cần reauth/evidence (ADR-001) | Canonical email/identity key unique; password hashed; pending verification/auth supporting modeling riêng; retry/link không duplicate User |
| 2. Tạo personal workspace | Tạo Workspace PERSONAL ownerId=user.id và WorkspaceMember OWNER/ACTIVE | Chỉ tạo cho đúng authenticated user, không nhận ownerId tùy ý từ client | Cùng transaction với signup nếu local; PERSONAL partial unique + owner/member atomic consistency, guards ADR-011; external provider failure/retry cần idempotency policy |
| 3. Tạo project | Actor → membership → Project workspaceId | OWNER/ADMIN trong TEAM; personal user là OWNER; name nonblank | FK workspace, project.archivedAt null; workspaceId lấy từ route đã scoped |
| 4. Tạo task | Task workspaceId, projectId tùy chọn, creator=actor | Active member; project phải cùng workspace và archivedAt null; assign người khác theo matrix | Compound FK project/members, TODO/MEDIUM defaults, version=1, completedAt null |
| 5. Cập nhật status | Read scoped Task, validate transition, update | Active member, project editable; creator/assignee không thay đổi quyền | Update status/completedAt/version atomically, expected version phải khớp |
| 6. Hoàn thành task | Task → DONE; progress tính lại từ query | Same update permission; server quyết định completedAt | CHECK status-completion consistency; repeated DONE giữ timestamp; conflict không ghi đè |
| 7. Thêm thành viên | TEAM Workspace + existing User → create/reactivate WorkspaceMember | OWNER thêm ADMIN/MEMBER; ADMIN chỉ MEMBER; target account ACTIVE; PERSONAL bị từ chối | Unique workspace/user; default MEMBER/ACTIVE; joinedAt lần đầu; chưa thiết kế invites, không tự convert workspace |
| 8. Assign task | Task.assigneeId → User qua WorkspaceMember | OWNER/ADMIN assign active member; MEMBER chỉ self-claim task unassigned hoặc clear self-assignment | Composite FK membership + active check trong transaction; không cross-workspace; version check; source project.archivedAt null, Task.deletedAt null |

Workflows 7–8 với nhiều người là future collaboration; schema TEAM được duyệt
nhưng MVP UI chỉ PERSONAL. Không triển khai TEAM onboarding/transfer UI ở bước đầu. Không tự thêm API, tables, migrations hoặc notification events.

## Authentication boundaries và review gate

Năm core entities không bao gồm mọi auth tables. Supporting authentication proposal:
User 0..1 PasswordCredential, 0..N OAuthAccount (unique provider/providerAccountId),
0..N RefreshSession (hashed refresh secret/expiry/revocation). Password hashes không
plaintext; Google identity không dùng unverified email để auto-link; authenticated
link/reauth và valid identity proof cần kiểm tra trước cùng User. ADR-010 chốt supporting model names/boundaries; session-generation rotation,
emailVerifiedAt/reset/verification details thuộc Auth-phase review, chưa models.
Future TaskActivity/Comment/Attachment/Reminder/RecurrenceRule/Notification tách khỏi
các auth dependencies. Không trì hoãn essential auth storage chỉ để giữ năm tables.

ADR-001–ADR-011 Accepted nằm trong [data-decisions.md](data-decisions.md), cùng
Phase 2.1 MVP Domain Design Freeze và classified prerequisites. Core design ready
cho Phase 2.2 planning/review; implementation authorization chưa có theo RA-001.
Không tự tạo models/migrations/Auth hoặc production. Auth detailed session/token/
verification schema cần phase riêng, không core design blocker bị che giấu.

## Ownership transfer — approved representation, proposed enforcement

OwnerId valid User và matching ACTIVE OWNER membership là ADR-005 Accepted.
TEAM workflow: precheck actor/target, begin transaction, lock Users theo ID rồi
Workspace và membership, recheck current owner và target sau lock, update ownerId,
demote old owner về ADMIN trước promote target, commit atomically. Partial OWNER
unique immediate; exactly-one/match/ACTIVE cần service final check và DB strengthening
hoặc controlled writes như ADR-011, không unique/FK tự enforce đầy đủ. Concurrent stale
transfer reject. PERSONAL transfer chưa bật; owner không tự leave/demote/delete.
Service transaction không tự bảo vệ against arbitrary SQL; ADR-011 baseline dùng constraints + locks/service-controlled writes; strengthening
DB trigger/locking cần implementation tests, chưa enforce trên database hiện tại.
