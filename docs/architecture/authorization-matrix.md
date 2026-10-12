# Shanflow — Authorization Matrix

Ngày cập nhật: 2026-10-12, Prompt 2.1B. 11 ADR Accepted ở
[data-decisions.md](data-decisions.md); detailed permission policy dưới đây vẫn
**Implementation policy proposal, không thêm task ACL model**, không được tự coi mọi permission đã được Project Owner duyệt.
Theo [RA-001](../security/risk-acceptance-001.md), chỉ documentation/design;
production chưa approved. Liên quan: [domain](domain-analysis.md), [ERD](erd.md).

## Workspace roles và prerequisites

OWNER là membership role khớp Workspace.ownerId. ADMIN quản lý hoạt động và MEMBER
thông thường; MEMBER làm việc trên tasks. VIEWER Future, chưa enum MVP. Account
ACTIVE và membership ACTIVE bắt buộc; INACTIVE/SUSPENDED không có access. Assignee
hoặc creator không tự cấp role. PostgreSQL runtime role không phải workspace role.

ADR-002: schema hỗ trợ PERSONAL/TEAM, **MVP UI chỉ PERSONAL**. PERSONAL đề xuất
chỉ owner member; TEAM có nhiều thành viên. Team permissions/workflows bên dưới
chuẩn bị cho phase sau, không mở TEAM UI/API tự động. ADR-008 không Workspace archive/delete API/UI/lifecycle fields/job trong MVP;
không workspace archive view hoặc restore policy để làm active-personal escape.

## Permission matrix

| Action trong đúng workspace | OWNER | ADMIN | MEMBER |
| --- | --- | --- | --- |
| Create PERSONAL workspace | Bất kỳ authenticated ACTIVE User, không cần role ở workspace chưa tồn tại; tối đa một persisted PERSONAL/user (không lifecycle fields) | Cùng quy tắc actor, không cấp quyền global bởi ADMIN | Cùng quy tắc actor, không cấp quyền global bởi MEMBER |
| Create TEAM workspace | Future onboarding review, không MVP UI | Không suy ra từ role workspace khác | Không suy ra từ role workspace khác |
| Read workspace/members/live projects/tasks | Có | Có | Có |
| Update workspace metadata | Có | Có | Không |
| Archive/restore/delete Workspace | Không MVP API/UI/job; Future decision riêng | Không | Không |
| Convert PERSONAL→TEAM | Future review, chưa cho phép | Không | Không |
| Transfer TEAM ownership | Current OWNER, target ACTIVE member/account; dedicated atomic workflow; chưa MVP UI/API | Không | Không |
| Transfer PERSONAL ownership | Chưa cho phép | Không | Không |
| Add/reactivate existing TEAM member | ADMIN hoặc MEMBER | Chỉ MEMBER | Không |
| Deactivate/remove TEAM member | ADMIN/MEMBER; không current OWNER | Chỉ MEMBER | Không |
| Set ordinary member role | ADMIN ↔ MEMBER; không grant OWNER trực tiếp | Không | Không |
| Leave TEAM | Sau transfer mới leave nếu từng là owner | Có | Có |
| Leave PERSONAL | Không | Không áp dụng | Không áp dụng |
| Workspace physical purge/account deletion | Future review, không MVP API hoặc automatic cascade | Không | Không |
| Project read/list (archive readable) | Có | Có | Có |
| Project create/update/archive/restore | Có | Có | Không |
| Project hard delete | Không ordinary CRUD | Không ordinary CRUD | Không |
| Task read/create/update/status/reorder | Có | Có | Có |
| Complete/reopen/cancel Task | Có, valid transition | Có, valid transition | Có, valid transition |
| Soft delete Task | Có, confirmation/version | Có, confirmation/version | Chỉ task actor tạo, confirmation/version |
| Read trash / restore Task | Có | Có | Chỉ task actor tạo; không quyền từ assignee |
| Task hard delete/purge | Không ordinary CRUD; retention review riêng | Không ordinary CRUD | Không |
| Set/change/clear assignee bất kỳ | Active same-workspace member/account | Active same-workspace member/account | Không |
| Self-assign live Task | Có | Có | Chỉ unassigned Task, không lấy task người khác |
| Clear self-assignment | Có | Có | Chỉ actor đang là assignee |
| Move task giữa inbox/projects trong workspace | Có | Có | Có |
| Move task/project sang workspace khác | Không MVP | Không MVP | Không MVP |

All task mutations cần live Task (deletedAt null), valid Workspace membership và current/
destination Project.archivedAt null (hoặc inbox). Deleted Task chỉ authorized trash
read/restore, không ordinary update/complete/assignment/reorder. Archived Project
readable, không tự complete/delete children; restore Project trước Task mutation.
Restore Task phải recheck permission/version/assignee và allocate mới như ADR-003.

Soft delete/restore của MEMBER giữ creator-based deletion policy proposal 2.1,
không assignee-based; Project archive do OWNER/ADMIN. Task CANCELED vẫn live nếu
không deleted; cancel không thay soft delete hoặc completedAt DONE semantics.

Administrative membership cleanup unassign **mọi Task gồm deleted/archived-project
rows** là exception quản trị atomic; không mở quyền chỉnh task khác. Workspace
archive/restore/delete không có permission trong MVP; không parent lifecycle fields.
Mọi persisted PERSONAL chiếm personal uniqueness slot theo ADR-008.
No workspace archive/team transfer UI hoặc destructive workflow được triển khai.

## Ownership rules và transfer

- ADR-005 Accepted: ownerId valid User và đúng một ACTIVE OWNER membership cùng
  workspace; current owner không được remove/deactivate/demote ngoài valid transfer.
- TEAM transfer cần target active member/account; actor=current owner, không admin.
  Precheck, transaction lock Users theo ID → Workspace → memberships theo ID,
  transactional recheck; compare expected current owner; ownerId update rồi demote
  old OWNER→ADMIN trước promote new OWNER; final-state check và atomic commit.
  Deferred consistency guard chỉ khi được triển khai theo ADR-011 strengthening.
- Two concurrent transfers serialize; request stale owner reject, không silently
  overwrite. Target=self reject; MEMBER role mutation không tạo OWNER.
- PERSONAL transfer/conversion chưa cho phép; PERSONAL uniqueness của target
  là additional future guard, không tự lấy workspace riêng của người khác.
- createdById immutable provenance, chỉ ảnh hưởng MEMBER soft-delete/trash/restore;
  không cho creator access sau membership revoked. assigneeId là trách nhiệm công
  việc, không ownership hoặc workspace admin.
- Removed member INACTIVE giữ row cho history/creator FKs; unassign atomic kể cả
  deleted tasks để restore không resurrect revoked assignment.

Service transaction bảo vệ service paths, **không** tự enforce trước direct SQL.
ADR-011 minimum baseline: reference/unique constraints + Workspace lock/service
controlled writes; deferred DB guards là strengthening chưa implemented/tested.
Exactly-one/match/ACTIVE không được baseline FK/partial unique enforce hoàn toàn. Không khẳng định Prisma relation
thuần enforce được role/status/owner exact-match.

## Cross-workspace authorization và query visibility

1. Actor ID từ trusted email/password hoặc Google authenticated context (Auth
   chưa triển khai), không body userId. Linking method không cấp workspace roles.
2. Resolve account ACTIVE và membership ACTIVE trong workspace route; UUID chỉ
   identifier. Resource read/write scoped bằng workspaceId + resourceId.
3. Default Task lists/search/progress/assignment/reorder thêm deletedAt IS NULL;
   trash là explicit authorized path, không client-controlled generic includeDeleted
   bypass. Project archive filters cần context view rõ ràng; Workspace không archive filters.
4. Project cùng workspace; creator/assignee identity qua membership composite key.
   Actor/assignee ACTIVE check trong transaction; FK membership existence không
   enforce ACTIVE hoặc permission. Reject cross-workspace IDs không chuyển tenant.
5. Reject immutable workspaceId/createdById hoặc ownerId/role mutation trái dedicated
   workflow; DTO allowlist ở implementation, không chỉ frontend validation.
6. Counts/joins/tags future cũng scoped; đề xuất 404 resource ngoài scope, 403 action
   bị cấm trên resource được thấy. Full API contract còn cần review riêng.
7. Authorization và mutation cùng transaction; User locks (IDs sorted) trước
   Workspace, memberships/Task sau; recheck account/roles sau lock, expected version
   cho task. Member removal, project archive, reorder/status/restore cùng protocol.

DB FKs chống wrong references, không thay authorization hoặc default query scopes.
Runtime shanflow_app dùng chung không chứng minh actor-level isolation; RLS Future
cần pooling/session context design. Bootstrap/migrator credentials không runtime.

## Design review cases (không phải tests đã chạy)

| Case | Expected policy |
| --- | --- |
| Task A tham chiếu project/member Workspace B | Reject; scoped lookup + compound FK |
| MEMBER edit live task của người khác trong TEAM | Allow theo permission policy proposal, editable project/version khớp |
| MEMBER soft-delete/restore task người khác dù assignee | Reject |
| Deleted Task xuất hiện trong search/progress/default list | Reject/default filter loại row |
| Restore deleted DONE Task | DONE/completedAt giữ nguyên; revalidate assignee; append lane position, deletedAt null |
| Task trong archived Project | Read allowed; mutations và restore Task reject tới khi restore Project |
| ADMIN promote self hoặc transfer ownership | Reject |
| INACTIVE creator đọc task cũ/trash | Reject, provenance không cấp quyền |
| Owner account SUSPENDED | Reject; recovery policy riêng O-07 |
| Đồng thời transfer hoặc revoke member/reorder | Serialize, transactional recheck; stale authorization/version reject |
| SQL trực tiếp demote owner rồi COMMIT không replacement | DB guard phải reject khi được implementation/test; hiện chưa có guarantee |

## Design-freeze authorization impacts

ADR-007 chốt Inbox/project optionality; cùng permission checks cho Inbox và Project
Tasks, không cross-workspace movement. ADR-009 strict unique live ranks làm reorder/
status/move/restore phụ thuộc cùng locking protocol và unique constraints; id tie-break
không cho phép duplicate positions. Task restore allocate mới rồi clear deletedAt
atomic, không resurrect rank đã dùng. Archived Project vẫn chặn tất cả ordinary Task
mutations; administrative member cleanup là exception unassign, không reorder.

ADR-010 standardized PasswordCredential/OAuthAccount/RefreshSession là Auth storage
riêng; linking cần ownership proof, không email-only grant access. Auth credentials/
refresh rotation không thay workspace roles. Core design freeze cho planning/review;
không implementation authorization theo RA-001, production vẫn NOT APPROVED.
