# Phase 6 — Project (API và giao diện)

Ngày: 2026-10-12. Phạm vi: chỉ local development theo [IA-001](../security/local-development-authorization.md). Nguồn: ADR-003/007,
[authorization-matrix](authorization-matrix.md), schema đã có ([project-implementation](project-implementation.md)), dịch vụ phân quyền của
[Phase 5](workspace-api-implementation.md). **Không đổi schema, không migration mới.** Task chưa thuộc phạm vi (Phase sau).

## Kế hoạch

| Bước | Nội dung | Trạng thái |
| --- | --- | --- |
| 6.1 | Thiết kế + contracts | Xong |
| 6.2 | API: liệt kê, tạo, đọc, sửa | Xong |
| 6.3 | API: lưu trữ (archive) / khôi phục (restore) | Xong |
| 6.4 | Giao diện `/projects` | Xong |

## Quyền (ma trận)

| Hành động | OWNER | ADMIN | MEMBER |
| --- | --- | --- | --- |
| Liệt kê / đọc project (kể cả đã lưu trữ) | Có | Có | Có |
| Tạo / sửa / lưu trữ / khôi phục | Có | Có | 403 |
| Xóa cứng | Không có API (ADR-003) | | |

Mọi route nằm dưới `/workspaces/:workspaceId/projects` và dùng `WorkspaceAccessService`: người ngoài workspace → 404; project **luôn** được tìm
bằng cặp `(workspaceId, projectId)`, nên project của workspace khác cũng là 404 (không lộ sự tồn tại, không có đường vượt tenant).
`workspaceId` không bao giờ nhận từ body.

## API

| Route | Quyền | Ghi chú |
| --- | --- | --- |
| `GET /workspaces/:w/projects?status=active\|archived\|all` | thành viên | mặc định `active`; sắp xếp `createdAt, id` |
| `POST /workspaces/:w/projects` | OWNER/ADMIN | 201. Giới hạn 200 project/workspace → 409 `PROJECT_LIMIT_REACHED` |
| `GET /workspaces/:w/projects/:p` | thành viên | |
| `PATCH /workspaces/:w/projects/:p` | OWNER/ADMIN | một phần; `null` xóa description/color/icon; project đã lưu trữ → 409 `PROJECT_ARCHIVED` |
| `POST /workspaces/:w/projects/:p/archive` | OWNER/ADMIN | idempotent: đã lưu trữ thì trả trạng thái hiện tại, **không** ghi lại `archivedAt` |
| `POST /workspaces/:w/projects/:p/restore` | OWNER/ADMIN | idempotent tương tự |

- Dữ liệu: `name` (trim, 1–80, NFC, không ký tự điều khiển/ẩn), `description` (≤2000, cho phép xuống dòng/tab, rỗng → null),
  `color`/`icon` thuộc allowlist trong contracts (blueprint yêu cầu "application allowlist"). `.strict()`: `workspaceId`, `archivedAt`,
  `id`… bị từ chối thay vì bị bỏ qua.
- **Lưu trữ = chỉ đọc:** project đã lưu trữ không sửa được cho tới khi khôi phục (ADR-003: khôi phục trước khi thao tác tiếp; về sau cũng
  chặn thay đổi Task trong project đó). Lưu trữ không đụng tới dữ liệu con.
- Quyền và ghi nằm trong **cùng giao dịch**, membership bị `FOR SHARE` (như Phase 5). Tạo project khóa thêm hàng workspace (`FOR UPDATE`)
  để đếm giới hạn không bị vượt khi tạo song song. Lưu trữ/khôi phục dùng `UPDATE … WHERE archived_at IS NULL/NOT NULL` nguyên tử.
- Throttle ghi: 30/phút/người dùng. Phản hồi `Cache-Control: private, no-store`.
- Không dùng `SensitiveSessionGuard` (quy tắc AUTH-R05 ở Phase 5).

## Giao diện `/projects`

Danh sách có bộ lọc Đang hoạt động / Đã lưu trữ; form tạo, sửa tại chỗ, nút Lưu trữ / Khôi phục chỉ hiện với OWNER/ADMIN (server vẫn kiểm tra).
Màu và biểu tượng chọn từ allowlist (biểu tượng hiển thị bằng nhãn chữ, chưa có bộ icon).

## Câu hỏi mở

- Bộ icon thật và bảng màu theo giao diện (hiện chỉ là giá trị allowlist + nhãn).
- Phân trang khi nới giới hạn 200 project/workspace.

## Kết quả kiểm thử

- Contracts: `project.spec` (chuẩn hóa tên/mô tả, allowlist màu/icon, trường thừa, bộ lọc).
- API database (`project-api.db-spec`, 10 test): OWNER/ADMIN tạo được, MEMBER 403 ở mọi thao tác ghi nhưng đọc được; người ngoài 404 ở mọi route;
  project của workspace khác không truy cập/sửa/lưu trữ được qua id workspace của mình; id sai định dạng 404; 400 cho dữ liệu sai và trường lạ;
  sửa một phần và xóa trường bằng `null`; lưu trữ/khôi phục idempotent (không ghi lại `archivedAt`), lọc danh sách, project lưu trữ chỉ đọc (409);
  giới hạn 200 kể cả tạo song song (5 yêu cầu đồng thời còn đúng 2 chỗ); thu hồi role/khóa tài khoản có hiệu lực ngay; personal workspace dùng được.
- Web: actions (tải, tạo, sửa, lưu trữ/khôi phục, ánh xạ lỗi), `ProjectsView` (tạo, lưu trữ rời danh sách đang hoạt động, bộ lọc đã lưu trữ,
  ẩn điều khiển với MEMBER, lỗi tải), điều hướng.
