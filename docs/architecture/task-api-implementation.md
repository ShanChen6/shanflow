# Phase 7 — Task (API và giao diện)

Ngày: 2026-10-12. Phạm vi: chỉ local development theo [IA-001](../security/local-development-authorization.md). Nguồn: ADR-003/004/006/007/009,
[domain-analysis](domain-analysis.md) (đồ thị trạng thái), [authorization-matrix](authorization-matrix.md), schema đã có
([task-implementation](task-implementation.md)), `WorkspaceAccessService` (Phase 5), project (Phase 6). **Không đổi schema.**

## Kế hoạch

| Giai đoạn | Nội dung | Trạng thái |
| --- | --- | --- |
| 7.1 | Nền tảng backend: contracts, chính sách quyền, đồ thị trạng thái, bộ cấp `position`, `TaskStore` | Xong |
| 7.2 | CRUD API: tạo, liệt kê/lọc, đọc, sửa metadata | Xong |
| 7.3 | Vòng đời: đổi trạng thái, giao việc, xóa mềm, thùng rác, khôi phục | Chưa |
| 7.4 | Sắp xếp và di chuyển: reorder, chuyển project/Inbox, rebalance | Chưa |
| 7.5 | Giao diện quản lý Task | Chưa |
| 7.6 | Tích hợp và sẵn sàng phát hành | Chưa |

## Quy tắc đã chốt (từ ADR / ma trận) mà mọi giai đoạn tuân theo

- **Phạm vi tenant:** task luôn được tìm theo `(workspaceId, id)`; mặc định chỉ task **sống** (`deletedAt IS NULL`). Thùng rác là đường riêng
  có phân quyền, không có tham số `includeDeleted` tự do. Task ở workspace khác / đã xóa / id sai định dạng đều là 404.
- **Quyền:** đọc/tạo/sửa/đổi trạng thái/sắp xếp/di chuyển: mọi thành viên ACTIVE. Xóa mềm, đọc thùng rác, khôi phục: OWNER/ADMIN mọi task;
  MEMBER chỉ task do mình tạo (assignee **không** đủ). Giao việc: OWNER/ADMIN bất kỳ; MEMBER chỉ tự nhận task chưa có người hoặc bỏ nhận của chính mình.
  Các hàm này nằm trong contracts (`canDeleteOrRestore`, `canChangeAssignee`) để server áp dụng và UI chỉ ẩn nút.
- **Project lưu trữ đóng băng task:** tạo/sửa/đổi trạng thái/giao việc/di chuyển/sắp xếp/xóa/khôi phục bị chặn (409 `PROJECT_ARCHIVED`); đọc vẫn được.
  Đích của lần di chuyển phải thuộc cùng workspace và chưa lưu trữ; Inbox (`projectId = null`) luôn hợp lệ.
- **Trạng thái:** TODO, IN_PROGRESS, DONE, CANCELED. Mọi chuyển đổi hợp lệ trừ `CANCELED → IN_PROGRESS/DONE` (phải qua TODO) →
  409 `INVALID_STATUS_TRANSITION`. `completedAt` = giờ server khi vào DONE, giữ nguyên khi DONE→DONE, xóa ở mọi trạng thái khác
  (`completedAtAfter`). CANCELED không phải hoàn thành.
- **Hạn chót (ADR-004):** `dueAt` là một thời điểm; API nhận ISO có `Z` hoặc offset số, trả về UTC `Z`. Ngày trần hoặc giờ không múi → 400.
- **Đồng thời (optimistic):** mọi thay đổi gửi `version` hiện có; không khớp → 409 `TASK_VERSION_CONFLICT`, không tự ghi đè. Thành công tăng
  `version` và `updatedAt`.
- **Thứ tự (ADR-006/009):** `position` là int64, API trả **chuỗi thập phân**; client không bao giờ tính rank, chỉ gửi id láng giềng / đích.
  Làn = workspace + project(hoặc Inbox) + status; rank sống là duy nhất trong làn (DB chặn bằng hai partial unique index).
- **Giao thức khóa:** mọi thao tác ghi task: kiểm tra quyền (khóa chia sẻ membership) → `lockWorkspace` (`SELECT … FOR UPDATE` hàng workspace,
  bao cả làn rỗng) → đọc lại những gì phụ thuộc → ghi, **cùng một giao dịch**. Người ghi khác giao thức vẫn bị unique index chặn va chạm rank.
- **Người được giao** phải là thành viên ACTIVE có tài khoản ACTIVE của đúng workspace (FK một mình cho phép cả INACTIVE) → 422 `INVALID_ASSIGNEE`.
- Không có xóa cứng task qua API. Không dùng `SensitiveSessionGuard` (AUTH-R05).

## 7.1 — Nền tảng backend

**Contracts** (`packages/contracts/src/task/task.ts`): `taskSchema` (vị trí là chuỗi, `version`, `dueAt` UTC), enum trạng thái/ưu tiên,
`taskTitleSchema` (trim, 1–200, NFC, không ký tự điều khiển/ẩn), `taskDescriptionSchema` (≤10 000, cho phép xuống dòng, rỗng → null),
`dueAtSchema`, `positionSchema`, `canTransition`, `completedAtAfter`, `canDeleteOrRestore`, `canChangeAssignee`. Mã lỗi mới:
`TASK_VERSION_CONFLICT`, `INVALID_STATUS_TRANSITION`, `INVALID_ASSIGNEE`, `POSITION_CAPACITY_EXCEEDED`.

**API (`apps/api/src/features/task/`)**
- `shared/position.ts`: `appendPosition` (đầu làn = 1024, sau đó +1024, trả `null` thay vì tràn int64), `positionBetween` (trung điểm số nguyên,
  chèn đầu làn khi còn khoảng trống, không bao giờ âm; `null` = hết chỗ → cần rebalance ở 7.4), `positionToString`.
- `shared/task.mapper.ts`: danh sách cột được phép (`TASK_SELECT`) và `toTask` (BigInt → chuỗi; JSON không bao giờ chứa BigInt).
- `shared/task.errors.ts`: các lỗi miền ở trên.
- `shared/task-store.service.ts` (`TaskStore`): `lockWorkspace`, `findLive`, `findDeleted`, `requireEditableProject`, `requireActiveAssignee`,
  `lastPosition`, `laneTasks`. Mọi hàm nhận `tx` của người gọi; không quyết định "ai được làm gì".
- `task.module.ts` đăng ký `TaskStore`, chưa có route (route thêm ở 7.2+).

**Kiểm thử:** contracts `task.spec` (trường, đồ thị trạng thái, completedAt, chính sách quyền); API unit `position.spec`; database
`task-foundation.db-spec` (7 test): chỉ task sống đúng workspace, project hợp lệ (Inbox / hoạt động / lưu trữ / workspace khác), người được giao
(ACTIVE vs INACTIVE/bị khóa/người lạ), rank theo làn chỉ tính task sống, rank do bộ cấp tạo ra thỏa ràng buộc DB, ánh xạ vị trí 2^63−1 thành chuỗi,
khóa workspace thật sự tuần tự hóa hai giao dịch.


## 7.2 — CRUD API (làm theo TDD)

Quy trình: mỗi lát là một vòng đỏ → xanh qua đúng seam công khai (schema ở contracts, route HTTP với DB thật; không mock thành phần nội bộ).
Thứ tự lát: schema CRUD → tạo (mặc định) → tạo (đủ trường, rank theo làn, tạo song song) → quyền/project/người được giao/giới hạn → đọc → danh sách/lọc/phân trang → sửa với `version`.

| Route | Quyền | Ghi chú |
| --- | --- | --- |
| `POST /workspaces/:w/tasks` | mọi thành viên ACTIVE | 201. Luôn `TODO`, người tạo = người gọi, `position` do server cấp (cuối làn) |
| `GET /workspaces/:w/tasks` | thành viên | chỉ task sống; lọc `projectId` (uuid hoặc `inbox`), `status`, `priority`, `assigneeId` (uuid hoặc `unassigned`), `q`, `limit` (mặc định 50, tối đa 100), `cursor` |
| `GET /workspaces/:w/tasks/:id` | thành viên | task đã xóa / workspace khác / id sai → 404 |
| `PATCH /workspaces/:w/tasks/:id` | thành viên | `version` bắt buộc + ≥1 trong `title`, `description`, `priority`, `dueAt` (`null` xóa hạn; mô tả rỗng → null) |

- **Chỉ nhận trường của hợp đồng:** `.strict()` từ chối `status`, `position`, `version` (khi tạo), `createdById`, `workspaceId`, `deletedAt`, và ở PATCH cả `assigneeId`, `projectId`
  (các thao tác đó có quy tắc riêng, làm ở 7.3/7.4). Không có tham số nào để xem task đã xóa (thùng rác là đường riêng ở 7.3).
- **Giao việc khi tạo:** theo `canChangeAssignee`: OWNER/ADMIN giao thành viên ACTIVE bất kỳ; MEMBER chỉ tự giao (403 nếu giao người khác);
  người được giao không phải thành viên ACTIVE → 422 `INVALID_ASSIGNEE`.
- **Project:** Inbox (`null`/bỏ qua) luôn hợp lệ; project phải thuộc workspace (404 nếu khác/lạ) và chưa lưu trữ (409 `PROJECT_ARCHIVED`).
  Task thuộc project đã lưu trữ đọc được nhưng không sửa được.
- **Giới hạn:** tối đa 5000 task/workspace (kể cả đã xóa) → 409 `TASK_LIMIT_REACHED`, đếm dưới khóa workspace nên tạo song song không vượt.
- **Đồng thời:** mọi ghi chạy trong một giao dịch: quyền (khóa chia sẻ membership) → `lockWorkspace` → đọc lại → ghi. 8 lần tạo song song cho 8 rank khác nhau
  (1024…8192); 6 lần sửa song song cùng `version` chỉ 1 lần thắng, 5 lần 409 `TASK_VERSION_CONFLICT`.
- **Danh sách:** sắp xếp `position, id`; phân trang keyset bằng cursor mờ (`base64url("<position>.<id>")`, kiểm tra chặt, sai → 400), ổn định khi có task thêm/xóa
  giữa các trang. `q` tìm theo tiêu đề không phân biệt hoa thường và **`%`, `_` được xem là ký tự thường** (Prisma không tự thoát chúng, đã tự thoát).
  `position` trả dạng chuỗi (kể cả 2^63−1).
- `completedAt` không bị đụng tới khi sửa task đã DONE. Throttle ghi 60/phút/người dùng. `Cache-Control: private, no-store`.

**Kiểm thử:** contracts `task-crud.spec` (12 test); API unit `cursor.spec` (9); database `task-api.db-spec` (29 test: tạo, đọc, danh sách, sửa — gồm quyền theo vai trò, thu hồi quyền có hiệu lực ngay,
cô lập tenant, xóa mềm/lưu trữ, tạo/sửa song song, giới hạn).

## Câu hỏi mở

- Xóa/khôi phục lặp lại (7.3): đề xuất idempotent, quyết khi làm 7.3.
- Sắp xếp danh sách đa làn: hiện theo `position, id`; thứ tự hiển thị theo làn do UI (7.5) lọc theo project + status.
