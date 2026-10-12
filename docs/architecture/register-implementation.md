# Shanflow — Register Slice Implementation Record (Phase 3, step 3)

Ngày: 2026-10-12. Nhánh `feat/auth`. Bước 3 của [auth-architecture.md](auth-architecture.md).
Phạm vi: `POST /auth/register` và trang `/register`. Chưa có login, token, cookie hay guard.

## Backend (`apps/api/src/features/auth`)

| File | Vai trò |
| --- | --- |
| `register/register.controller.ts` | `POST /auth/register` → 201; zod pipe; `ThrottlerGuard` 5 yêu cầu/giờ/IP (D12), tính trước validation |
| `register/register.handler.ts` | `normalizeEmail` → hash argon2id (ngoài DB) → một `user.create` lồng `passwordCredential`; P2002 → `EmailAlreadyRegisteredError` (409) |
| `register/register.schema.ts` | Re-export contract từ `@shanflow/contracts` |
| `shared/auth.errors.ts` | `EmailAlreadyRegisteredError` |
| `auth.module.ts` | Nạp `authConfig` (fail-fast), throttler, `PasswordHasher`, `Clock`; được import vào `AppModule` |

`main.ts`: `helmet()`, CORS chỉ cho `WEB_ORIGIN` (`credentials: true`), JSON body tối đa 16 KB.
Mọi lỗi của controller trả `application/problem+json`; lỗi 413 từ body parser dùng định dạng mặc định của Nest.

## Contracts (`packages/contracts`, `@shanflow/contracts`)

Zod schema request/response của register, `problemDetailsSchema`, `AUTH_ERROR_CODES`. Mật khẩu 12–128 ký tự
(không trim, không luật thành phần), tên 1–80 ký tự, email ≤ 254. Package build ra `dist` (root `prepare`
chạy khi `pnpm install`); API và web import từ `dist`.

## Frontend (`apps/web/src`)

`features/auth/register/{register-form.tsx, register.action.ts}`, `shared/api/http-client.ts`,
`shared/config.ts` (`NEXT_PUBLIC_API_URL`), route `app/(auth)/register/page.tsx`. Form kiểm tra bằng đúng
contract schema trước khi gọi API, map `EMAIL_ALREADY_REGISTERED`/`VALIDATION_FAILED`/`TOO_MANY_REQUESTS` về
lỗi theo field hoặc form, không bao giờ hiển thị lại mật khẩu. Thêm vitest + Testing Library cho web.

## Quyết định và khác biệt so với kế hoạch

- Theo mặc định đã chấp nhận: register không tự đăng nhập; email trùng trả 409 (D10); không tạo workspace (D11).
- `AuthModule` nạp cấu hình auth ngay ở bước này (thay vì bước 4) vì CORS cần `WEB_ORIGIN`; hệ quả: API
  **bắt buộc có `JWT_ACCESS_SECRET`** khi khởi động. `.env.example` đã cập nhật, e2e stub biến này.
- Trang thành công chưa có liên kết đăng nhập vì `/login` thuộc bước 4.

## Giới hạn đã biết

- **Throttle theo `req.ip`, lưu trong bộ nhớ**: sau reverse proxy cần cấu hình `trust proxy` đúng, và nhiều
  instance cần storage dùng chung (Redis). Chưa làm; phải xử lý trước staging.
- Chưa có xác minh email nên người đăng ký có thể dùng email của người khác (`emailVerified` luôn false);
  liên kết Google phải chờ slice verify (ADR-010).
- `register` trả 409 nên lộ việc email đã đăng ký (D10 chấp nhận; rate limit giảm thiểu).
- Bootstrap trong `main.ts` (helmet, CORS, giới hạn body) không có test tự động; đã kiểm tra thủ công bằng
  server thật.

## Kiểm chứng

contracts 10/10, API unit 97/97, API db 70/70 (mới: tạo user + hash argon2id, trùng email không phân biệt
hoa/thường, 5 đăng ký đồng thời chỉ 1 thành công, 400 không echo mật khẩu, 429 sau 5 yêu cầu), e2e 4/4, web 16/16,
lint, typecheck, build đạt. Chạy thật API + `next start` và Chromium (Playwright): validate phía client, đăng ký
thành công qua CORS, email trùng hiện lỗi theo field. `pnpm audit` vẫn chỉ còn SEC-02.
