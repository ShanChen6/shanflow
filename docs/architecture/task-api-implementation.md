# Phase 7 — Task (API và giao diện)

Ngày: 2026-10-12. Phạm vi: chỉ local development theo [IA-001](../security/local-development-authorization.md). Nguồn: ADR-003/004/006/007/009,
[domain-analysis](domain-analysis.md) (đồ thị trạng thái), [authorization-matrix](authorization-matrix.md), schema đã có
([task-implementation](task-implementation.md)), `WorkspaceAccessService` (Phase 5), project (Phase 6). **Không đổi schema.**

## Kế hoạch

| Giai đoạn | Nội dung | Trạng thái |
| --- | --- | --- |
| 7.1 | Nền tảng backend: contracts, chính sách quyền, đồ thị trạng thái, bộ cấp `position`, `TaskStore` | Xong |
| 7.2 | CRUD API: tạo, liệt kê/lọc, đọc, sửa metadata | Xong |
| 7.3 | Vòng đời: đổi trạng thái, giao việc, xóa mềm, thùng rác, khôi phục | Xong — 7.3.1a (trạng thái), 7.3.1b (xóa mềm), 7.3.2 (ưu tiên và hạn chót), 7.3.3 (giao việc) và 7.3.4 (khôi phục) xong — **7.3 hoàn tất** |
| 7.4 | Sắp xếp và di chuyển: reorder, chuyển project/Inbox, rebalance | Xong |
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

## 7.3.1a — Chuyển trạng thái (TDD)

`POST /workspaces/:w/tasks/:id/status` với `{ status, version }` (strict; `completedAt`/`position` không nhận từ client).

- **Đồ thị** (`canTransition` ở contracts, áp dụng ở service): mọi chuyển đổi hợp lệ trừ `CANCELED → IN_PROGRESS/DONE` (→ 409 `INVALID_STATUS_TRANSITION`);
  mở lại task đã hủy phải qua TODO. 10 cặp hợp lệ và 2 cặp bị cấm đều được test từng cặp.
- **`completedAt`** (`completedAtAfter`, giờ lấy từ `Clock` của server): đặt khi vào DONE, xóa khi rời DONE (kể cả DONE→CANCELED vì hủy không phải hoàn thành),
  hoàn thành lại sau khi mở lại nhận mốc mới.
- **Idempotent:** yêu cầu đúng trạng thái task đang có là **no-op thành công** (200, trả trạng thái hiện tại, không đổi `version`, `position`, `completedAt`) và được
  xét **trước** kiểm tra `version`, nên request thử lại với `version` cũ vẫn an toàn. Chỉ khi trạng thái thật sự đổi mới kiểm tra `version` (409 nếu cũ).
- **Làn:** đổi trạng thái = sang làn mới của cùng project, nhận rank cuối làn (ADR-009), nhả rank cũ; làn khác không bị đụng. Hết chỗ rank → 409 `POSITION_CAPACITY_EXCEEDED` (rebalance ở 7.4).
- Mọi thành viên ACTIVE đều đổi được; project lưu trữ đóng băng (409 `PROJECT_ARCHIVED`); khác workspace / đã xóa / id sai → 404.
- **Cấu trúc:** phần mở đầu giao dịch chung (quyền + khóa workspace + task sống + project chưa lưu trữ) nằm ở `TaskMutationService.mutate`; `requireVersion` là guard
  cho optimistic concurrency. `update()` của 7.2 cũng dùng lại (bộ test 7.2 giữ nguyên, vẫn xanh).

**Kiểm thử:** contracts `task-status.spec` (2); database `task-status.db-spec` (28 test: lát, `completedAt`, no-op, đồ thị từng cặp, làn, 6 yêu cầu chuyển song song cùng làn, quyền, version, project lưu trữ, 401/404, body sai).

## 7.3.1b — Xóa mềm idempotent (TDD)

`DELETE /workspaces/:w/tasks/:id?version=N` (không body; `deleteTaskQuerySchema` strict nên không có tham số `hard`/`force`). Trả `200 { task }` là tombstone.

- **Chỉ đóng dấu `deletedAt`** (giờ server) và tăng `version`/`updatedAt`. Trạng thái, `completedAt`, `dueAt`, mô tả, project, người tạo và `position` giữ nguyên (xóa ≠ hủy);
  hàng **không bao giờ bị xóa vật lý** — API không có đường xóa cứng, test xác nhận hàng còn nguyên.
- **Giải phóng rank:** `deletedAt IS NOT NULL` nhả slot khỏi hai partial unique index (ADR-009). Tombstone giữ rank lịch sử, nhưng làn có thể cấp lại đúng rank đó
  (test: tạo task mới nhận lại 1024; chuyển task khác vào đúng slot của làn DONE).
- **Idempotent (chốt cho câu hỏi mở của ADR-003):** xóa task đã xóa → `200` trả đúng tombstone cũ, **không** đổi `deletedAt`, `version`, `updatedAt`; bỏ qua kiểm tra
  `version` (trạng thái mong muốn đã đúng) nên request thử lại an toàn; 6 yêu cầu xóa song song đều 200 và chỉ xóa đúng một lần (`version` = 2).
- **Quyền** (`canDeleteOrRestore`): OWNER/ADMIN xóa mọi task; MEMBER chỉ task mình tạo (được giao việc không đủ) → 403 với task còn sống không thuộc mình.
  Với task **đã xóa**, người không có quyền nhận **404** thay vì 403: thùng rác vô hình với họ, không lộ sự tồn tại.
- **Loại khỏi mặc định:** task đã xóa biến mất khỏi danh sách, `GET`, `PATCH`, đổi trạng thái (đều 404); danh sách không có tham số nào để xem task đã xóa
  (`?deleted`, `?includeDeleted`, `?deletedAt` → 400).
- **Bảo vệ:** `version` cũ ở lần xóa đầu → 409 `TASK_VERSION_CONFLICT`; project đã lưu trữ chặn xóa task còn sống (409) nhưng lặp lại một lệnh xóa cũ vẫn 200 (không có gì thay đổi);
  thu hồi membership có hiệu lực ngay; 401/404 cho chưa đăng nhập, người ngoài, workspace khác, id sai.
- **Cấu trúc:** `TaskMutationService.inWorkspace` (quyền + khóa workspace) là phần mở đầu chung; `mutate` xây trên nó cho task sống; `TaskStore.findAny` cho các thao tác phải xử lý cả hai trạng thái.

**Kiểm thử:** contracts `task-delete.spec` (2); database `task-delete.db-spec` (17).

## 7.3.4 — Thùng rác và khôi phục (TDD)

| Route | Quyền | Ghi chú |
| --- | --- | --- |
| `GET /workspaces/:w/task-trash?limit=` | thành viên | tombstone mới xóa nhất trước; OWNER/ADMIN thấy tất cả, MEMBER chỉ task do mình tạo; mặc định 50, tối đa 100 |
| `POST /workspaces/:w/tasks/:id/restore` `{ version }` | `canDeleteOrRestore` | 200 `{ task }` sống |

- **Thùng rác là đường riêng** (`/task-trash`), không phải bộ lọc của danh sách: không tham số nào trộn tombstone với task sống (`?status`, `?includeLive` → 400).
- **Quyền & tàng hình:** cùng `canDeleteOrRestore` với xóa (guard `requireTrashPermission` dùng chung). Task sống mà không có quyền → 403; task **đã xóa** mà không có quyền → 404 (được giao việc không cho
  quyền vào thùng rác). Người ngoài workspace / membership INACTIVE / id sai / workspace khác → 404; thu hồi quyền có hiệu lực ngay.
- **Hiệu lực khi khôi phục:** người gọi phải là thành viên ACTIVE (workspace không có lưu trữ ở MVP); project của task phải **chưa lưu trữ** (409 `PROJECT_ARCHIVED`, task vẫn ở thùng rác, khôi phục project rồi thử lại được);
  Inbox không phụ thuộc project. `version` của tombstone phải đúng (409 nếu cũ).
- **Rank & va chạm:** rank cũ **không bao giờ được dùng lại**. Task luôn vào **cuối làn** (cùng project/Inbox + cùng status) với rank mới (ADR-003/009), nên rank cũ đã bị người khác chiếm không gây va chạm
  (test: rank 1024 bị task khác dùng → task khôi phục nhận 2048); 4 tombstone cùng giữ rank 1024 khôi phục đồng thời nhận 1024/2048/3072/4096, không lỗi. Khóa workspace tuần tự hóa các thao tác ghi.
- **Giữ nguyên:** trạng thái, `completedAt`, hạn chót, mô tả, ưu tiên, người tạo, project. **Người được giao** được kiểm lại: không còn là thành viên ACTIVE (rời, bị vô hiệu hóa hoặc tài khoản bị khóa) → xóa (`assigneeId = null`), còn hợp lệ → giữ.
  Người tạo đã rời workspace không cản trở (FK còn nguyên, quản lý vẫn khôi phục được).
- **Idempotent:** khôi phục task đã sống → 200 trả đúng task, không đổi `version`/`position`, bỏ qua kiểm tra `version` (cùng nguyên tắc với xóa và đổi trạng thái); 6 yêu cầu song song chỉ khôi phục một lần (`version` = 3).
- **Cấu trúc:** `TaskStore.isActiveMember` (boolean) dùng cho cả kiểm tra người được giao khi tạo lẫn khi khôi phục.

**Kiểm thử:** contracts `task-restore.spec` (5); database `task-restore.db-spec` (24).

## 7.3.2 — Ưu tiên và hạn chót (TDD)

Không có route mới: `priority` và `dueAt` đi qua `POST` (tạo) và `PATCH` (sửa, cần `version`) của 7.2. Giai đoạn này chốt và chứng minh hành vi, và bổ sung hai điểm còn thiếu.

- **Ưu tiên:** `LOW | MEDIUM | HIGH | URGENT`, mặc định `MEDIUM`; giá trị khác (chữ thường, rỗng, `null`, số, mảng) → 400 và không đổi gì. Đổi được trên task đã DONE mà không đụng `status`/`completedAt`; mọi thành viên đều đổi được.
- **Hạn chót (ADR-004):** thêm / đổi / xóa (`null`); bỏ qua trường thì giữ nguyên. Chấp nhận mốc **thời điểm có `Z` hoặc offset số**, lưu đúng thời điểm đó và **luôn trả UTC dạng `YYYY-MM-DDTHH:mm:ss.sssZ`**
  (offset `+07:00`, `-05:00`, `+05:30`, `+12:45` đều quy về cùng một thời điểm; DST chỉ là offset). Độ chính xác dưới mili-giây bị **cắt** (không làm tròn sang mili-giây kế tiếp).
  Hạn chót trong quá khứ hợp lệ (quá hạn là trạng thái bình thường).
- **Giới hạn mới (`DUE_AT_MIN` … `DUE_AT_MAX`):** từ `1970-01-01T00:00:00.000Z` đến `9999-12-31T23:59:59.999Z`. Trước đây `0000-…`/năm 0001 lọt qua schema; ngày không tồn tại (`02-30`, `13-01`, giây 60, giờ 24) đã bị zod chặn
  nên mọi giá trị không lưu được đều là **400, không bao giờ 500**. Ngày trần, giờ không múi, `2026-10-12 09:00:00Z`, số epoch đều bị từ chối (cả khi tạo lẫn sửa).
- **Một định dạng ở mọi nơi:** tạo, đọc, danh sách, đổi trạng thái, xóa, thùng rác, khôi phục đều trả `dueAt`, `createdAt`, `updatedAt`, `completedAt`, `deletedAt` dạng UTC có mili-giây.
- **PATCH không đổi gì = no-op idempotent (mới):** nếu mọi trường gửi lên đã bằng giá trị đang lưu (so sánh thời điểm, nên `+07:00` và `Z` cùng thời điểm là bằng nhau) thì trả 200 với task hiện tại, **không** tăng `version`/`updatedAt`
  và bỏ qua kiểm tra `version` → gửi lại một lần sửa đã thành công là an toàn, người khác không bị xung đột oan; 6 yêu cầu giống hệt chạy song song đều 200, chỉ một lần đổi thật. Chỉ cần một trường khác biệt thì là thay đổi thật và `version` cũ bị 409.
  Project đã lưu trữ vẫn chặn (409) kể cả khi no-op, vì task bị đóng băng.
- Hàm thuần `detailChanges` tính phần khác biệt; `update()` còn lại là guard clause (không try/catch).

**Kiểm thử:** contracts `due-at.spec` (8: chuẩn hóa, cắt mili-giây, DST, ngày không tồn tại, dải giá trị); database `task-priority-deadline.db-spec` (24).

## 7.3.3 — Giao việc (TDD)

`PUT /workspaces/:w/tasks/:id/assignee` với `{ assigneeId: uuid | null, version }` (strict). Một route cho giao, đổi người và hủy giao (`null`); `assigneeId` **bắt buộc** nên thiếu trường không bao giờ bị hiểu là "hủy giao".
`assigneeId` không còn nhận ở `POST`/`PATCH` ngoài đường này (PATCH vẫn từ chối; tạo task vẫn cho giao lúc tạo theo cùng chính sách).

- **Quyền** (`canChangeAssignee`, ma trận): OWNER/ADMIN giao cho bất kỳ thành viên hợp lệ, đổi người, hủy giao của bất kỳ ai. MEMBER chỉ **tự nhận** task chưa có người, hoặc **bỏ nhận** task của chính mình;
  không giao cho người khác, không nhận task của người khác, không chuyển task của mình cho người khác, không hủy giao của người khác (đều 403, không đổi gì). Người tạo task không có thêm quyền.
- **Người được giao hợp lệ:** phải là thành viên **ACTIVE** của đúng workspace với tài khoản **ACTIVE** (FK một mình cho phép cả INACTIVE) → 422 `INVALID_ASSIGNEE` (INACTIVE, tài khoản bị khóa, người ngoài, id lạ). Kích hoạt lại thành viên thì giao lại được. Hủy giao không đòi hỏi điều này.
- **Idempotent:** giao đúng người đang giữ (hoặc hủy giao task chưa có ai) → 200, không đổi `version`/`updatedAt`, bỏ qua kiểm tra `version`; 6 yêu cầu giống hệt song song đều 200, chỉ một lần đổi thật. Giao người khác với `version` cũ → 409.
  Thứ tự guard: no-op → quyền (403) → `version` (409) → thành viên hợp lệ (422).
- **Thành viên bị vô hiệu hóa/rời đi:** task còn gán cho họ vẫn đọc/sửa được; quản lý luôn gỡ hoặc giao lại được; bản thân người rời đi mất mọi quyền (404, kể cả không thể tự bỏ nhận).
  Khôi phục task từ thùng rác tự xóa người được giao không còn hợp lệ (7.3.4).
- **Dọn dẹp khi rời workspace — `TaskAssignmentCleanup.unassignAll(tx, workspaceId, userId)`** (ADR-005/ma trận "administrative membership cleanup"): gỡ gán **mọi** task của người đó, gồm task đã xóa, đã hoàn thành và thuộc project đã lưu trữ
  (ngoại lệ quản trị duy nhất với project đóng băng, vì chỉ đổi người chịu trách nhiệm); tăng `version`/`updatedAt` của đúng các dòng đó, không đụng trạng thái, `completedAt`, `deletedAt`, rank; không đụng task của người khác, task chưa giao hay workspace khác.
  Tự khóa workspace; **phải gọi trong cùng giao dịch và trước** thay đổi membership (test: rollback chung, commit chung); chạy lại không làm gì (trả 0). Hiện **chưa có API quản lý thành viên** (MVP chỉ PERSONAL), nên dịch vụ được xuất từ `TaskModule` để API đó dùng sau.
- Bất biến còn lại: project lưu trữ chặn giao việc (409), task đã xóa / workspace khác / người ngoài / id sai → 404, 401 khi chưa đăng nhập.

**Kiểm thử:** contracts `task-assign.spec` (3); database `task-assign.db-spec` (23), `task-assignment-cleanup.db-spec` (6).

## 7.4 — Sắp xếp và di chuyển (TDD)

`POST /workspaces/:w/tasks/:id/move` với `{ version, projectId?, beforeId?, afterId? }` (strict) → `200 { task, laneRebalanced }`.
Một route cho cả sắp xếp lại trong làn lẫn chuyển sang project khác / Inbox (`projectId: null`); bỏ `projectId` = giữ nguyên project.

- **Client chỉ nêu láng giềng, không bao giờ gửi rank:** `beforeId` / `afterId` (không được cả hai), không có gì = cuối làn. `position`, `status`, `workspaceId` gửi lên → 400.
  Làn đích luôn là `(workspace, project đích | Inbox, status hiện tại của task)` (ADR-009): task giữ trạng thái và `completedAt`, vào làn cùng trạng thái của project đích; làn cũ được nhả rank; người được giao và mọi chi tiết khác giữ nguyên.
- **Láng giềng không hợp lệ → 422 `INVALID_PLACEMENT`:** không ở trong làn đích (khác project, khác trạng thái, đã xóa, workspace khác, id lạ) hoặc chính task đó. Hai trường hợp project đích: đã lưu trữ → 409 `PROJECT_ARCHIVED`; khác workspace / không tồn tại → 404.
  Task thuộc project đã lưu trữ bị đóng băng (409) như các thao tác ghi khác.
- **Idempotent:** đặt task vào đúng chỗ nó đang ở (cùng project, đã nằm đúng giữa láng giềng đó / đã ở cuối) → 200, không đổi `version`/`position`/`updatedAt`, bỏ qua kiểm tra `version`. Thay đổi thật với `version` cũ → 409.
- **Cấp rank:** trung điểm số nguyên giữa hai láng giềng (`positionBetween`), chèn đầu làn khi còn chỗ, nối cuối khi không có láng giềng sau. Chỉ task được di chuyển bị ghi (các task khác giữ nguyên rank và `version`).
- **Đánh số lại làn (rebalance) khi hết chỗ:** khi hai láng giềng liền kề (hoặc đầu làn ở rank 0, hoặc cuối làn sát giới hạn int64) mà không còn số nguyên trống, làn được đánh lại 1024·n giữ nguyên thứ tự rồi mới đặt task;
  response có `laneRebalanced: true` để client tải lại làn. Do chỉ mục unique **tức thời**, các dòng đổi rank được đưa sang rank tạm chưa ai giữ (`planRebalance`: đoạn số nguyên trống đầu tiên phía trên các rank cuối, kể cả khi đỉnh int64 đã bị chiếm)
  rồi mới về rank cuối trong một câu `UPDATE … FROM (VALUES …)` hai bước; chỉ các dòng thực sự đổi rank mới bị tăng `version`/`updatedAt`. Tombstone, làn khác và workspace khác không bị đụng. Hết chỗ rank → 409 `POSITION_CAPACITY_EXCEEDED`.
- **Đồng thời:** mọi bước nằm trong một giao dịch dưới khóa workspace; 6 task cùng chuyển vào một làn nhận 6 rank khác nhau; nhiều thao tác khác nhau trên cùng task với cùng `version` → tối đa một thắng, còn lại 409. Mọi thành viên ACTIVE đều di chuyển được. Throttle 120/phút/người dùng (kéo thả tạo nhiều request).
- **Cấu trúc:** hàm thuần `insertionIndex` / `neighbourRanks` (`placement.ts`) và `planRebalance` / `positionBetween` (`position.ts`); `TaskStore.rebalanceLane` chứa SQL; `OrderingHandlers.move` chỉ gồm guard clause.
- **Chưa làm / quyết ở 7.5:** thả task sang **cột trạng thái khác** (Kanban) hiện là hai lời gọi (`/status` rồi `/move`) vì `/status` luôn nối cuối làn đích; nếu UI cần một lời gọi, thêm `status` tùy chọn vào `/move` tái dùng `canTransition`/`completedAtAfter`.

**Kiểm thử:** contracts `task-move.spec` (6); unit `position.spec` (+7 cho `planRebalance`, kể cả `[0, MAX]`), `placement.spec` (4); database `task-move.db-spec` (22).

## Câu hỏi mở

- Lọc/sắp xếp danh sách theo hạn chót (quá hạn, sắp đến hạn) chưa có; thêm cùng giao diện ở 7.5 nếu cần.
- Thùng rác chưa có phân trang con trỏ (tối đa 100 tombstone gần nhất); thêm khi có chính sách lưu giữ/dọn dẹp (ADR-003: chưa chốt thời hạn).
- Sắp xếp danh sách đa làn: hiện theo `position, id`; thứ tự hiển thị theo làn do UI (7.5) lọc theo project + status.
