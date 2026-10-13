# Phase 5 — Workspace (API và giao diện)

Ngày: 2026-10-12. Phạm vi: chỉ local development theo [IA-001](../security/local-development-authorization.md); staging/production
chưa được duyệt. Nguồn: ADR-002/005/008/011 trong [data-decisions](data-decisions.md), [authorization-matrix](authorization-matrix.md),
schema đã có ([workspace](workspace-implementation.md), [workspace member](workspace-member-implementation.md)). Không đổi ADR, không đổi schema.

## Kế hoạch

| Bước | Nội dung | Trạng thái |
| --- | --- | --- |
| 5.1 | Thiết kế + contracts (tài liệu này) | Xong |
| 5.2 | Dịch vụ phân quyền workspace (CDB-002) | Xong |
| 5.3 | Tạo personal workspace nguyên tử + OWNER membership (CDB-003, ADR-011) | Xong |
| 5.4 | API đọc/sửa workspace, danh sách thành viên | Xong |
| 5.5 | Giao diện `/workspace` | Xong |

## Phạm vi MVP (ADR-002, ADR-008)

- Chỉ **PERSONAL** có luồng sản phẩm: mỗi người dùng đúng một, tạo tự động khi đăng ký; **không** API/UI tạo TEAM, mời, chuyển quyền,
  chuyển PERSONAL→TEAM, lưu trữ/xóa workspace (ma trận ghi rõ "Future").
- Quyền theo ma trận: đọc (OWNER/ADMIN/MEMBER); sửa metadata (OWNER/ADMIN); MEMBER nhận 403.

## 5.2 — Dịch vụ phân quyền (`WorkspaceAccessService`)

Một điểm duy nhất trả lời "người này có quyền gì trong workspace này?", mọi slice workspace/project/task sau này dùng lại.

- Actor luôn là `userId` từ access token, không bao giờ từ body/URL.
- `require(client, userId, workspaceId, { roles?, lock? })` truy vấn **một câu SQL** nối `workspace_members`, `workspaces`, `users`:
  membership `ACTIVE` **và** tài khoản `ACTIVE`. Không đạt → `404 NOT_FOUND` (không phân biệt workspace không tồn tại, không phải thành viên,
  thành viên INACTIVE hay tài khoản bị khóa — không lộ sự tồn tại; ma trận mục 6). Có membership nhưng role không đủ → `403 FORBIDDEN`.
- Quyền được đọc **trực tiếp từ DB** ở mỗi request (không nhét role vào JWT) nên thu hồi có hiệu lực ngay.
- `lock: true` thêm `FOR SHARE OF m`: khi ghi, hàng membership bị khóa chia sẻ đến hết giao dịch, nên việc hạ quyền/vô hiệu hóa thành viên
  chạy song song phải chờ → không có khoảng hở kiểm tra-rồi-ghi (ma trận mục 7). Kiểm tra quyền và ghi nằm trong **cùng một giao dịch**.
- Id không phải UUID → 404 như id lạ.

**Quy tắc guard (AUTH-R05):** API ghi thông thường dùng `JwtAuthGuard` + kiểm tra membership sống ở trên; `SensitiveSessionGuard`
(phiên còn sống trong DB) chỉ dành cho thao tác bảo mật/thông tin xác thực (đổi mật khẩu, liên kết tài khoản). Đổi tên workspace không thuộc nhóm đó.

## 5.3 — Khởi tạo personal workspace (`PersonalWorkspaceService`)

Bất biến (ADR-005/011): `ownerId` là User hợp lệ **và** có đúng một membership `OWNER`/`ACTIVE` cùng workspace; tối đa một PERSONAL/người dùng.
Schema chỉ bảo đảm "tối đa một"; "đúng một và khớp" do dịch vụ này bảo đảm:

1. Chạy trong giao dịch (nhận `tx` của người gọi, hoặc tự mở).
2. `SELECT … FROM users WHERE id = $1 FOR UPDATE` — tuần tự hóa mọi lần gọi đồng thời cho cùng người dùng.
3. Đã có PERSONAL của người này → **sửa cho khớp** (tạo membership OWNER nếu thiếu, bật lại nếu INACTIVE) và trả về; không có → tạo
   `Workspace(PERSONAL, ownerId)` + `WorkspaceMember(OWNER, ACTIVE)` cùng giao dịch. Idempotent.
4. Chỉ tạo OWNER; unique index `workspaces_personal_owner_unique` và `workspace_members_one_owner_unique` là lớp chặn cuối.

Nơi gọi: đăng ký email và đăng ký Google gọi trong **cùng giao dịch** với việc tạo user (không có user thiếu workspace do lỗi giữa chừng);
`GET /workspaces` gọi bù (chỉ khi chưa có membership nào) cho người dùng tạo trước Phase 5. Tên mặc định `Personal` (không phụ thuộc ngôn ngữ);
đổi được qua PATCH.

Để tránh phụ thuộc vòng, `WorkspaceCoreModule` (chỉ cần Prisma) cung cấp hai dịch vụ trên; `AuthModule` và `WorkspaceModule` cùng import nó.

## 5.4 — API

Mọi route: `JwtAuthGuard`, `Cache-Control: private, no-store`, lỗi `application/problem+json`.

| Route | Quyền | Mô tả |
| --- | --- | --- |
| `GET /workspaces` | đã đăng nhập | Workspace mà tôi là thành viên ACTIVE, kèm `role` của tôi |
| `GET /workspaces/:id` | thành viên ACTIVE | Chi tiết + `role` của tôi |
| `PATCH /workspaces/:id` | OWNER, ADMIN | Chỉ `name` (`.strict()`: trường khác → 400). 20/phút/người dùng |
| `GET /workspaces/:id/members` | thành viên ACTIVE | Thành viên ACTIVE: `userId`, `displayName`, `role`, `joinedAt`. **Không** trả email |

`name`: trim, 1–80 ký tự, NFC, không ký tự điều khiển/định dạng ẩn (cùng luật hiển thị tên của hồ sơ). Cập nhật cuối-thắng (chưa có version);
sẽ thêm version khi workspace có nhiều người sửa đồng thời (TEAM).

## 5.5 — Giao diện

Trang `/workspace` (trong khu vực đã đăng nhập): tên, vai trò của tôi, danh sách thành viên; form đổi tên chỉ hiện với OWNER/ADMIN
(server vẫn kiểm tra). Link "Workspace" trên thanh điều hướng.

## Câu hỏi mở

- **AUTH-R01** (cửa sổ ân hạn khi xoay refresh token): chưa có quyết định; Phase 5 không phụ thuộc.
- Khi mở TEAM: cần API mời/thành viên/chuyển quyền (ma trận) và version cho metadata.

## Kết quả kiểm thử

- Contracts: `workspace.spec` (tên, trường thừa, không lộ email).
- API database (`workspace-api.db-spec`, 15 test): signup tạo user + workspace nguyên tử; `ensure` idempotent với 6 lần gọi song song,
  tự sửa membership thiếu/INACTIVE, rollback cùng giao dịch cha; `GET /workspaces` bù cho tài khoản cũ; chỉ liệt kê membership ACTIVE;
  404 cho người lạ/INACTIVE/tài khoản bị khóa/id lạ/id sai định dạng; OWNER+ADMIN đổi tên được, MEMBER 403; không đổi được owner/type;
  thu hồi role có hiệu lực ngay; `FOR SHARE` chặn hạ quyền song song đến hết giao dịch ghi.
- API unit: handler đăng ký gọi `ensure` trong cùng `tx`.
- Web: actions, `WorkspaceView` (đổi tên, ẩn form với MEMBER, lỗi tải), điều hướng.
- Helper `deleteUsers` của test nay xóa cả workspace và membership của người dùng test (FK RESTRICT).

Chưa có test riêng cho đường đăng ký Google tạo workspace (dùng cùng dịch vụ và cùng mẫu giao dịch với đăng ký email).
