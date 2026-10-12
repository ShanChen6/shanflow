# Shanflow — Me Slice and JwtAuthGuard Implementation Record (Phase 3, step 5)

Ngày: 2026-10-12. Nhánh `feat/auth`. Bước 5 của [auth-architecture.md](auth-architecture.md).
Phạm vi: `GET /auth/me`, `JwtAuthGuard`, `@CurrentPrincipal()`. Chưa có refresh/logout (bước 6–7); web chưa gọi `me`
(client có token chưa cần, và hydrate cần refresh nên thuộc bước 6).

## Thành phần (`apps/api/src/features/auth`)

| File | Vai trò |
| --- | --- |
| `shared/jwt-auth.guard.ts` | Đọc `Authorization: Bearer <token>` (scheme không phân biệt hoa thường, ≤ 2048 ký tự, ký tự hợp lệ), verify bằng `AccessTokenService`, gắn `request.principal`; mọi lỗi là `UnauthenticatedError` |
| `shared/current-principal.decorator.ts` | Lấy principal; ném 401 nếu route quên guard (fail closed) |
| `shared/principal.ts` | `Principal { userId, sessionId }`: chỉ danh tính, không quyền |
| `me/me.{controller,handler,schema}.ts` | `GET /auth/me` → `{ user }`, `Cache-Control: no-store`; token hợp lệ nhưng user bị xóa hoặc SUSPENDED → 401 |
| `auth.module.ts` | Export `JwtAuthGuard` và `AccessTokenService` để module khác dùng `@UseGuards(JwtAuthGuard)` |
| `shared/auth.errors.ts` | `UnauthenticatedError` (401, `UNAUTHENTICATED`) |

`ProblemDetailsFilter` thêm header `WWW-Authenticate: Bearer` cho mọi 401. Contracts thêm `meResponseSchema` và mã
`UNAUTHENTICATED`.

## Phát hiện trong lúc làm: lỗi guard của module khác trả 500

Bài test dùng một module giả lập (đại diện cho workspace/task) gắn `JwtAuthGuard` vào route riêng đã trả **500**
thay vì 401, vì `DomainError` không phải `HttpException` và filter chỉ gắn trên controller auth. Sửa: đăng ký
`DomainErrorFilter` (`@Catch(DomainError)`, kế thừa `ProblemDetailsFilter`) làm global qua `APP_FILTER`. Cố ý chỉ bắt
`DomainError`: bản đầu tiên bắt mọi lỗi đã làm hỏng thân 503 của `/health/ready` (e2e phát hiện) nên bị loại.
Controller auth vẫn dùng filter đầy đủ để map 429/validation của framework.

## Quyết định và giới hạn

- Guard **không truy cập DB**: nó chứng minh danh tính chứ không chứng minh tài khoản còn ACTIVE hay session chưa bị thu hồi.
  Service nghiệp vụ phải tự kiểm tra ACTIVE account, membership và role (CDB-002). `me` kiểm tra ACTIVE ngay tại handler.
- Access token đã phát vẫn dùng được đến hết hạn (tối đa 15 phút) sau khi session bị thu hồi. Thao tác nhạy cảm
  (đổi mật khẩu, liên kết Google) phải đối chiếu `sid` với DB khi các slice đó được làm.
- `me` chưa có throttle riêng (cần token hợp lệ; throttle chung sẽ thêm cùng storage dùng chung trước staging).
- Cookie refresh không bao giờ được chấp nhận làm credential cho `me` (có test).

## Kiểm chứng

contracts 17/17, API unit 134/134, db 84/84 (mới: profile theo token đăng nhập, không lộ hash, emailVerified,
401 problem+json + `WWW-Authenticate`, cookie không phải credential, token giả/sai khóa/sai issuer/hết hạn/payload
bị sửa/sai scheme cho đúng một phản hồi, suspended và deleted bị từ chối, module khác dùng guard đã export), e2e 4/4,
lint, typecheck, build đạt. `pnpm audit` vẫn chỉ còn SEC-02.
