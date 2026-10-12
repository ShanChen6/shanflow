# Phase 7 — Task (API và giao diện)

Ngày: 2026-10-12. Phạm vi: chỉ local development theo [IA-001](../security/local-development-authorization.md). Nguồn: ADR-003/004/006/007/009,
[domain-analysis](domain-analysis.md) (đồ thị trạng thái), [authorization-matrix](authorization-matrix.md), schema đã có
([task-implementation](task-implementation.md)), `WorkspaceAccessService` (Phase 5), project (Phase 6). **Không đổi schema.**

## Kế hoạch

| Giai đoạn | Nội dung | Trạng thái |
| --- | --- | --- |
| 7.1 | Nền tảng backend: contracts, chính sách quyền, đồ thị trạng thái, bộ cấp `position`, `TaskStore` | Xong |
| 7.2 | CRUD API: tạo, liệt kê/lọc, đọc, sửa metadata | Chưa |
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

## Câu hỏi mở

- Giới hạn số task mỗi workspace/làn và phân trang danh sách (quyết ở 7.2).
- Chính sách phản hồi khi xóa/khôi phục lặp lại (ADR-003 để cho thiết kế API; đề xuất idempotent, quyết ở 7.3).
