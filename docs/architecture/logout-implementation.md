# Shanflow — Logout Slice Implementation Record (Phase 3, step 7)

Ngày: 2026-10-12. Nhánh `feat/auth`. Bước 7 của [auth-architecture.md](auth-architecture.md).
Phạm vi: `POST /auth/logout`, `POST /auth/logout-all`, nút đăng xuất trên `/account`.

## Backend (`apps/api/src/features/auth`)

| File | Vai trò |
| --- | --- |
| `shared/refresh-session.store.ts` → `revokeFamilyByToken()` | Một transaction: tìm theo hash → khóa advisory family (cùng khóa với `rotate`) → đặt `revokedAt` cho cả family. Idempotent; token lạ không đổi gì. Token **đã dùng** vẫn chấp nhận vì chứng minh quyền sở hữu phiên |
| `shared/refresh-session.store.ts` → `revokeAllForUser()` | Khóa mọi family còn sống của user theo thứ tự cố định (tránh deadlock), rồi thu hồi tất cả. Dùng lại được cho đổi mật khẩu và suspend |
| `logout/logout.controller.ts` | `logout`: 204, xác thực bằng cookie nên có `CookieCsrfGuard`, throttle 30/phút. `logout-all`: 204, `JwtAuthGuard` (Bearer không thể bị trang khác tự đính kèm nên không cần CSRF), throttle 10/phút. Cả hai luôn xóa cookie, `Cache-Control: no-store` |
| `logout/logout.handler.ts` | `logout` luôn thành công kể cả không có cookie; `logoutAll` chỉ dùng `userId` của principal |

Khóa family là bắt buộc: không có nó, một refresh đang chạy có thể tạo successor còn sống sau khi lệnh thu hồi đã đọc dữ liệu.

## Frontend (`apps/web/src`)

- `shared/api/http-client.ts`: `requestNoContent` cho phản hồi 204.
- `features/auth/shared/auth-client.ts`: tách `withAccessToken` (làm mới trước khi hết hạn, thử lại đúng một lần sau 401) dùng chung cho
  `authedGetJson` và `authedPostNoContent`; thêm `postLogout` (keepalive).
- `features/auth/shared/bootstrap-store.ts` (chuyển từ `session/` để các slice không import lẫn nhau) có `markSignedOut()`.
- `features/auth/logout/{logout.action.ts, logout-buttons.tsx}`: "Sign out" và "Sign out of all devices" trên `/account`.

**Chỉ đăng xuất cục bộ sau khi server xác nhận.** Nếu không liên lạc được server thì cookie refresh vẫn còn hiệu lực, xóa trạng thái cục bộ
sẽ gây hiểu nhầm vì lần tải sau người dùng được đăng nhập lại; giao diện báo lỗi và giữ nguyên phiên. `markSignedOut()` chạy trước
`clearSession()` để các trang đang mở chuyển hướng ngay thay vì thử khôi phục một phiên vừa bị thu hồi (đã xử lý lưu ý ở bước 6).
Đăng xuất toàn bộ coi 401 sau khi đã thử làm mới là "đã đăng xuất" (đúng trạng thái người dùng yêu cầu).

## Quyết định và giới hạn

- Khoảng ân hạn khi refresh (câu hỏi ở bước 6) **chưa được chốt**, giữ nguyên mặc định D7: không có.
- Access token đã phát vẫn dùng được đến hết hạn (tối đa 15 phút) sau logout; có test ghi nhận hành vi này. Các thao tác nhạy cảm
  sau này phải đối chiếu `sid` với DB.
- `logout-all` không ảnh hưởng đến phiên được tạo sau khi nó bắt đầu (đăng nhập mới hợp lệ).
- Chưa có cơ chế liệt kê thiết bị hoặc đăng xuất một thiết bị cụ thể.

## Kiểm chứng

contracts 19/19, API unit 152/152, db 111/111 (mới 12 test: logout thu hồi family + xóa cookie + chặn refresh sau đó, thiết bị khác không bị ảnh hưởng,
idempotent kể cả token đã dùng, không cookie hoặc token lạ vẫn 204, 3 kiểu thiếu Origin/header trả 403 và không thu hồi gì, logout-all cần token,
chỉ thu hồi đúng user, đăng nhập lại được, access token còn hạn vẫn dùng được, 6 vòng logout-all và 6 vòng logout chạy đua với refresh đều không còn
phiên sống), e2e 4/4, web 62/62, lint, typecheck, build đạt. Kiểm tra đột biến: bỏ khóa trong hai hàm thu hồi thì test đua thất bại cả 3 lần chạy.
Chạy thật Chromium với hai "thiết bị": đăng xuất thiết bị A (cookie bị xóa, `/account` chuyển về `/login`, cookie cũ phát lại trả 401, thiết bị B vẫn
đăng nhập), rồi đăng xuất mọi thiết bị từ B làm cả lần đăng nhập mới của A mất phiên. `pnpm audit` vẫn chỉ còn SEC-02.
