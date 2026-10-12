# Shanflow — Auth Shared Components Implementation Record (Phase 3, step 2)

Ngày: 2026-10-12. Nhánh `feat/auth`. Bước 2 của [auth-architecture.md](auth-architecture.md).
Chỉ thêm thành phần kỹ thuật dùng chung và cấu hình; chưa có controller, slice, route
hay thay đổi `AppModule`/`main.ts`, nên hành vi runtime hiện tại không đổi.

## Thành phần (`apps/api/src`)

| File | Vai trò |
| --- | --- |
| `shared/clock.ts` | `Clock` trừu tượng + `SystemClock` để test expiry/rotation |
| `shared/crypto/secure-token.ts` | Token 256-bit base64url, hash SHA-256 hex 64 ký tự (khớp CHECK của `refresh_sessions`), so sánh hằng thời gian |
| `shared/crypto/password-hasher.ts` | `PasswordHasher` + `Argon2PasswordHasher` (argon2id m=19456, t=2, p=1); `verify` không ném lỗi với hash hỏng hoặc mật khẩu quá dài; `needsRehash`; `verifyDummy` cân bằng thời gian cho tài khoản không tồn tại; giới hạn 128 ký tự |
| `shared/errors/domain-error.ts` | `DomainError` (code, HTTP status, message cố định) và `RequestValidationError` |
| `shared/http/zod-validation.pipe.ts` | Validate bằng zod; chỉ trả path và mã lỗi, không echo giá trị (mật khẩu) |
| `shared/http/problem-details.filter.ts` | Map lỗi sang `application/problem+json`; lỗi lạ thành 500 chung, không lộ message/stack |
| `config/auth-env.schema.ts`, `config/auth.config.ts` | Schema môi trường auth (fail-fast, thông báo không chứa giá trị) và `registerAs('auth')` |

Biến môi trường mới (đã thêm vào `.env.example`): `JWT_ACCESS_SECRET` (bắt buộc, ≥ 32 ký tự),
`JWT_ISSUER`, `JWT_AUDIENCE`, `ACCESS_TOKEN_TTL_SECONDS` (60–3600, mặc định 900),
`REFRESH_TOKEN_TTL_DAYS` (1–90, mặc định 30), `AUTH_COOKIE_SECURE` (production bắt buộc true),
`AUTH_COOKIE_DOMAIN`, `WEB_ORIGIN` (origin thuần, https ở production).
Schema auth **chưa** được nạp vào `AppModule`, vì vậy chưa yêu cầu `JWT_ACCESS_SECRET` khi khởi động;
`AuthModule` sẽ nạp ở bước 4.

## Dependency

`argon2@0.45.1` (pin chính xác). Gói đã kèm binary dựng sẵn nên `allowBuilds: argon2: false`
(không chạy install script). `pnpm audit` vẫn chỉ còn SEC-02.

## Khác với kế hoạch

- **Throttler, helmet, cookie-parser, JWT library chưa thêm**: chúng chỉ có tác dụng khi có
  controller (bước 3–4), nên thêm cùng slice dùng chúng để tránh dependency chưa dùng.
- HS256 được chọn cho D1 (một API, đơn giản hơn); đổi sang EdDSA chỉ cần đổi `AccessTokenService`.

## Kiểm chứng

Unit 92/92 (mới: hasher, token, clock, pipe, filter, auth env), db 64/64, e2e 4/4, lint,
typecheck, build đạt.
