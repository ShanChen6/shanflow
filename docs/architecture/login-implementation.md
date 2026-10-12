# Shanflow — Login Slice Implementation Record (Phase 3, step 4)

Ngày: 2026-10-12. Nhánh `feat/auth`. Bước 4 của [auth-architecture.md](auth-architecture.md).
Phạm vi: `POST /auth/login`, phát access token + refresh session, trang `/login`. Chưa có refresh,
logout, `me` hay guard (bước 5–7).

## Backend (`apps/api/src/features/auth`)

| File | Vai trò |
| --- | --- |
| `login/login.handler.ts` | Tìm user theo email chuẩn hóa; email lạ hoặc tài khoản không có mật khẩu → `verifyDummy` rồi `INVALID_CREDENTIALS`; verify argon2id; kiểm tra `ACTIVE` **sau** mật khẩu; nâng hash cũ (lỗi nâng cấp không làm hỏng đăng nhập); tạo family; ký access token |
| `login/login.controller.ts` | `POST /auth/login` → 200, set cookie refresh, `Cache-Control: no-store`; throttle 50/15 phút/IP và 10/15 phút/(IP+email) |
| `shared/access-token.service.ts` | JWT HS256 (`jose`): claim chỉ `sub`, `sid`, `iss`, `aud`, `iat`, `exp`; `verify` chỉ nhận HS256 + iss/aud/exp/claim bắt buộc, trả `null` với mọi token sai |
| `shared/refresh-session.store.ts` | `createFamily`: token 256-bit, lưu SHA-256, `familyId` mới mỗi lần đăng nhập, hạn theo `REFRESH_TOKEN_TTL_DAYS` |
| `shared/auth-cookie.ts` | Cookie `shanflow_refresh`: HttpOnly, SameSite=Strict, `Path=/auth`, Secure theo cấu hình; `clearRefreshCookie` cùng thuộc tính |
| `shared/auth.errors.ts` | Thêm `InvalidCredentialsError` (401) |

Refresh token chỉ nằm trong cookie, không có trong body. `auth.module.ts` thêm throttler `login-email`
(tracker = IP + email chuẩn hóa từ body); route nào không muốn dùng phải `@SkipThrottle({ 'login-email': true })`
(register đã làm).

## Contracts / Frontend

`@shanflow/contracts`: `loginRequestSchema` (mật khẩu chỉ cần không rỗng, ≤ 128), `loginResponseSchema`,
`authUserSchema` dùng chung với register, mã `INVALID_CREDENTIALS`.
Web: `features/auth/login/{login-form.tsx, login.action.ts}`, `features/auth/shared/session-store.ts`
(access token chỉ trong bộ nhớ module, không localStorage), route `/login`; trang register có liên kết sang `/login`.
Mọi lỗi 401 hiển thị một thông báo chung "Invalid email or password."

## Quyết định

- Đúng các mặc định đã chấp nhận: SUSPENDED gộp vào `INVALID_CREDENTIALS` (D13); không `deviceLabel`
  (chưa có nhu cầu, tránh dữ liệu thiết bị); HS256 (D1).
- Sau đăng nhập web điều hướng về `/`; chưa có vùng đã đăng nhập thật nên chưa có gì để bảo vệ.

## Giới hạn đã biết

- **Tải lại trang làm mất phiên phía client** cho đến khi có `/auth/refresh` (bước 6) và hydrate ở `use-session`.
- Access token chưa được kiểm tra với DB (`sid`); guard và kiểm tra thao tác nhạy cảm thuộc bước 5.
- Throttle vẫn theo `req.ip` trong bộ nhớ (cần `trust proxy` và storage dùng chung trước staging).
- Hash giả (`verifyDummy`) cân bằng thời gian ở mức xấp xỉ, không phải bảo đảm tuyệt đối; test chỉ kiểm tra nó được gọi.
- Chưa có khóa tài khoản theo số lần sai; chỉ giới hạn tốc độ.

## Kiểm chứng

contracts 16/16, API unit 115/115, db 76/76 (mới: đăng nhập, cookie hardened, hash token lưu đúng, claim JWT, family
độc lập, bốn kiểu lỗi cho đúng một phản hồi, nâng hash, validate, throttle theo tài khoản), e2e 4/4, web 30/30,
lint, typecheck, build đạt. Chạy thật API + `next start` với Chromium: đăng ký → đăng nhập sai (thông báo chung) → đăng
nhập đúng; cookie `HttpOnly`, `SameSite=Strict`, `Path=/auth`, `document.cookie` trống, `localStorage` trống.
`pnpm audit` vẫn chỉ còn SEC-02.
