# Shanflow — Refresh Slice Implementation Record (Phase 3, step 6)

Ngày: 2026-10-12. Nhánh `feat/auth`. Bước 6 của [auth-architecture.md](auth-architecture.md).
Phạm vi: `POST /auth/refresh` (rotation, khóa family, phát hiện dùng lại token), kiểm tra Origin + header,
khôi phục phiên phía client, trang `/account` được bảo vệ. Chưa có logout (bước 7).

## Backend (`apps/api/src/features/auth`)

| File | Vai trò |
| --- | --- |
| `shared/refresh-session.store.ts` → `rotate()` | Một transaction: tìm theo hash → `pg_advisory_xact_lock(hashtextextended(familyId))` → đọc lại dưới khóa. Đã dùng → thu hồi cả family (`reuse`); hết hạn → `invalid`; user không ACTIVE → thu hồi family; hợp lệ → tạo successor cùng family, đánh dấu cũ `usedAt`/`replacedById`. Successor giữ `expiresAt` của family (trần 30 ngày tuyệt đối, D8). Kết quả lỗi được **trả về chứ không ném** để việc thu hồi được commit |
| `refresh/refresh.handler.ts` | Mọi thất bại là một `UnauthenticatedError`; thành công ký access token gắn `sid` của session mới |
| `refresh/refresh.controller.ts` | `POST /auth/refresh` → 200, `Cache-Control: no-store`; throttle 30/phút/IP; thất bại xóa cookie; thành công đặt cookie mới |
| `shared/cookie-csrf.guard.ts` | `Origin` phải đúng `WEB_ORIGIN` và có `X-Requested-With: shanflow` (D4), nếu không 403 `CSRF_REJECTED`, không tiêu thụ token |
| `shared/auth-cookie.ts` | Thêm `readCookie` (thay cho `cookie-parser`: chỉ cần đọc một cookie) |

Reuse được ghi log cảnh báo chỉ với `userId` và `familyId`, không bao giờ token hay hash.

## Contracts / Frontend

Contracts: `refreshResponseSchema` (= login response), `CSRF_HEADER_NAME/VALUE`, mã `CSRF_REJECTED`.
Web:

- `shared/api/http-client.ts`: `requestJson` (GET/POST, Bearer, header CSRF cho POST, `keepalive`).
- `features/auth/shared/auth-client.ts`: `refreshSession()` single-flight trong tab + **Web Locks** giữa các tab;
  `authedGetJson()` làm mới trước khi token sắp hết hạn (10 giây) và thử lại đúng một lần sau 401, không lặp.
- `features/auth/session/{bootstrap-store,use-auth-status}.ts`, `shared/require-auth.tsx`: tải lại trang → đổi cookie
  lấy phiên mới; 401 → `/login`; mất mạng/429 → hiển thị "Try again", không đăng xuất.
- Route `app/(app)/account` (trong `(app)/layout.tsx` bọc `RequireAuth`) hiển thị hồ sơ từ `/auth/me`; đăng nhập
  chuyển tới `/account`.

## Khác với kế hoạch

- **Web Locks thay cho BroadcastChannel** để tuần tự hóa refresh giữa các tab: tab sau lấy khóa rồi đọc cookie mà tab
  trước vừa xoay, không cần truyền tin giữa tab.
- **`keepalive: true` cho request refresh** (xem dưới). Không có trong kế hoạch ban đầu.
- Không thêm `cookie-parser`.

## Phát hiện khi chạy thật: tải lại trang giữa lúc refresh làm hỏng phiên

Thử bằng Chromium với hai tab cùng tải lại liên tục: bản đầu **có phát hiện reuse và thu hồi cả family** dù không có
kẻ tấn công. Nguyên nhân: server đã xoay token nhưng trang bị hủy trước khi nhận phản hồi, nên cookie mới không về
trình duyệt; lần tải sau gửi lại token cũ. `keepalive: true` cho phép request và `Set-Cookie` hoàn tất sau khi trang
bị hủy. Sau khi sửa, chạy lại 3/3 lần liên tiếp (mỗi lần 2 tab × 4 lượt tải lại đồng thời) không có reuse nào ngoài
lần phát lại token đánh cắp chủ ý.

**Rủi ro còn lại:** `keepalive` giảm chứ không loại bỏ hoàn toàn khả năng mất cookie (mạng đứt giữa chừng, trình
duyệt không hỗ trợ). Khi đó người dùng bị đăng xuất vì phát hiện reuse. Khoảng ân hạn ngắn phía server (≤ 10 giây, chỉ
khi successor chưa được dùng) là cách giảm thêm nhưng làm yếu phát hiện trộm token, và D7 đã chọn không có. **Đây là
quyết định bảo mật cần Project Owner chốt**; chưa triển khai.

## Giới hạn đã biết

- Throttle 30/phút/IP có thể chạm trần với nhiều người dùng sau cùng một NAT; cần `trust proxy` đúng và storage dùng chung.
- Khi bước 7 gọi `clearSession()` lúc `RequireAuth` đang gắn, hook sẽ thử khôi phục phiên một lần (401 → `/login`).
  Logout nên đặt phase bootstrap thành `done` để tránh request thừa.
- Thu hồi session không vô hiệu hóa access token đã phát (tối đa 15 phút), đúng thiết kế ở 4.3.
- Chưa có dọn dẹp session hết hạn/revoke (job riêng sau MVP).

## Kiểm chứng

contracts 19/19, API unit 149/149, db 99/99 (mới 15 test refresh: xoay + liên kết family + giữ trần hạn, chuỗi nhiều
thế hệ, reuse thu hồi family và xóa cookie, family khác không bị ảnh hưởng, 5 refresh đồng thời chỉ 1 thắng, thiếu/hỏng/
lạ/hết hạn/bị thu hồi/suspended, bốn kiểu yêu cầu thiếu Origin hoặc header trả 403 mà không tiêu thụ token, chỉ lưu hash,
throttle), e2e 4/4, web 49/49, lint, typecheck, build đạt. Kiểm tra đột biến: bỏ dòng khóa advisory thì test đồng thời
thất bại (3 request cùng thắng), nên khóa thực sự cần thiết. Chạy thật Chromium: chặn khi chưa đăng nhập, đăng nhập →
`/account`, tải lại khôi phục phiên, hai tab tải lại đồng thời 3 lần chạy liên tiếp không bị thu hồi, phát lại cookie đã
dùng thu hồi family và đăng xuất nạn nhân. `pnpm audit` vẫn chỉ còn SEC-02.
