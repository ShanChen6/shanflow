# Shanflow — Auth Storage Implementation Record (Phase 3, step 1)

Ngày: 2026-10-12. Nhánh `feat/auth`. Thực hiện theo [ADR-010](data-decisions.md) và
[auth-architecture.md](auth-architecture.md) (bước 1: schema + migration + test).
Phạm vi: chỉ local development theo IA-001; không có API, service hay UI auth.

## Thay đổi

Migration `add_auth_storage` (một transaction):

| Hạng mục | Chi tiết |
| --- | --- |
| `users.email_verified_at` | `timestamptz(3)` nullable; không đổi `account_status` (D9) |
| `password_credentials` | `user_id` PK/FK (RESTRICT), `password_hash`, `password_updated_at`, `created_at`, `updated_at` |
| `refresh_sessions` | `id`, `user_id` FK (RESTRICT), `family_id`, `token_hash` UNIQUE, `created_at`, `expires_at`, `used_at?`, `revoked_at?`, `replaced_by_id?` UNIQUE self-FK (RESTRICT), `last_used_at?`, `device_label?` |
| Index | `refresh_sessions(user_id)`, `(family_id)`, `(expires_at)` |
| CHECK (thủ công) | `password_hash` không rỗng; `token_hash ~ '^[0-9a-f]{64}$'`; `expires_at > created_at`; không tự thay thế; `replaced_by_id` chỉ khi có `used_at` |

`oauth_accounts` chưa tạo (slice Google, sau MVP).

## Quyết định thiết kế

- `token_hash` là SHA-256 hex (64 ký tự thường); token thô không bao giờ được lưu.
- Successor cùng user/family **chưa** có ràng buộc DB; transaction rotation của
  `RefreshSessionStore` phải kiểm tra (ADR-010 cho phép "transactional checks").
  Ràng buộc composite FK là phương án tăng cường nếu cần sau review.
- Không có cột IP; `device_label` do client cung cấp, cần giới hạn độ dài ở lớp slice.
- `shanflow_app` nhận CRUD trên bảng mới qua default privileges; vẫn không có quyền
  trên `_prisma_migrations` (đã kiểm chứng).

## Kiểm chứng

`prisma migrate dev` (replay trên shadow), `migrate diff` không khác biệt, test DB 64/64
(`test/auth-storage.db-spec.ts` mới: credential 1:1, hash rỗng, RESTRICT, unique/format
token hash, expiry, successor duy nhất và guard), unit, e2e, lint, typecheck, build đạt.

## Còn lại

Service rotation/family lock, hash mật khẩu, JWT và mọi slice thuộc các bước 2–7.
