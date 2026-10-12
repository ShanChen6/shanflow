# Shanflow — Phase 4 (User) Implementation Record

Ngày bắt đầu: 2026-10-12. Nhánh: `feat/user` (từ `develop`). Phạm vi: chỉ local development theo
[IA-001](../security/local-development-authorization.md); không mở rộng quyền sang staging hoặc production.
Phase 4 theo yêu cầu của Project Owner là **User** và được làm **từng bước một**, mỗi bước kiểm chứng xong mới sang bước sau.
Phác thảo "Phase 4 — Workspace" trong [phase-3-closure.md](phase-3-closure.md#8-cách-tiếp-tục-phase-4--workspace) được thay thế bởi
kế hoạch này; Workspace chuyển sang phase sau, các điều kiện ở đó (CDB-002…004) vẫn nguyên giá trị.

## Kế hoạch

| Bước | Nội dung | Trạng thái |
| --- | --- | --- |
| 4.1 | `GET /users/me` | **Xong** (bản ghi bên dưới) |
| 4.2 | Cập nhật hồ sơ (backend) | **Xong** |
| 4.3 | Giao diện hồ sơ | **Xong** |
| 4.4 | Đổi mật khẩu | Chưa làm — xem câu hỏi mở |
| 4.5 | Ảnh đại diện | Chưa làm — cần quyết định lưu trữ |
| 4.6 | Cài đặt người dùng | Chưa làm — cần quyết định lưu trữ |

### Câu hỏi mở cho các bước sau

- **4.4:** `POST /auth/password/change` (xác thực lại bằng mật khẩu hiện tại, thu hồi các thiết bị khác, kiểm tra phiên còn sống,
  giới hạn 5/15 phút/người dùng) và biểu mẫu trên `/account` **đã có từ Phase 3**. Bước này nên là gì: (a) chuyển biểu mẫu sang trang
  hồ sơ mới, (b) bổ sung (ví dụ gửi email thông báo khi đổi mật khẩu, AUTH-R10), hay (c) bỏ vì đã đủ?
- **4.5:** ảnh lưu ở đâu (hệ thống tệp local, object storage, hay chỉ URL)? Quyết định này kéo theo giới hạn kích thước/loại tệp,
  quét nội dung, phục vụ ảnh và dọn dẹp. Hiện `users.avatar_url` có sẵn và được Google đăng nhập điền bằng URL https.
- **4.6:** cài đặt gồm những gì (ngôn ngữ, múi giờ, giao diện sáng/tối, thông báo)? Cần bảng riêng (`user_settings`) hay cột JSON?
- **4.2 (đã chốt bởi Project Owner):** chỉ `displayName` có thể sửa; email cần luồng xác minh riêng, avatar ở 4.5.

## 4.1 — `GET /users/me`

### Hợp đồng (`@shanflow/contracts`, `user/profile.ts`)

```json
{ "user": { "id": "uuid", "email": "canonical", "emailVerified": true, "displayName": "string",
            "avatarUrl": "https://… | null", "createdAt": "ISO-8601", "updatedAt": "ISO-8601" } }
```

Cố ý **không** có thông tin xác thực: phương thức đăng nhập (`hasPassword`, `linkedProviders`) vẫn thuộc `GET /auth/me`, nơi
giao diện bảo mật đang dùng. Hai endpoint không trùng vai trò: `/auth/me` trả lời "tôi đăng nhập thế nào", `/users/me` trả lời
"hồ sơ của tôi là gì" và sẽ mở rộng dần (cài đặt ở 4.6).

### Backend (`apps/api/src/features/user/`)

| File | Vai trò |
| --- | --- |
| `user.module.ts` | Module tính năng mới; import `AuthModule` để dùng `JwtAuthGuard` đã export |
| `me/me.controller.ts` | `GET /users/me`, `JwtAuthGuard`, `Cache-Control: private, no-store` |
| `me/me.handler.ts` | Đọc theo `userId` **trong token**, `select` danh sách cho phép (không bao giờ chọn credential hay trạng thái), từ chối tài khoản bị xóa/khóa (401), `safeAvatarUrl` |
| `me/me.schema.ts` | Re-export hợp đồng dùng chung |

- `id` chỉ lấy từ token đã xác minh; tham số `id`/`userId` hay header `X-User-Id` bị bỏ qua (có test).
- Chỉ URL ảnh `https:` được trả ra; mọi giá trị khác trong DB (http, `javascript:`, rác) thành `null`, phòng thủ chiều sâu cho
  giao diện sẽ hiển thị ảnh.
- Không giới hạn tốc độ riêng, giống `/auth/me`: cần token hợp lệ, chỉ đọc; sẽ cân nhắc cùng storage dùng chung (AUTH-R03).
- Guard vẫn stateless: token còn hạn sau khi thu hồi phiên vẫn đọc được hồ sơ của chính mình tới khi hết hạn (AUTH-R05). Đây là
  thao tác chỉ đọc nên không dùng `SensitiveSessionGuard`; các bước ghi (4.2…4.6) sẽ quyết định riêng.
- Không đổi web: giao diện hồ sơ thuộc 4.3.

### Kiểm chứng

contracts 33/33 (thêm 8), API unit 202/202 (thêm 5), db 197/197 (thêm 10 trong `user-me.db-spec.ts`), e2e 4/4, lint, typecheck, build đạt.
Test database: hồ sơ hợp lệ theo hợp đồng chung, danh sách trường chính xác và không rò `argon2`/`passwordHash`/`accountStatus`/`tokenHash`,
email đã/chưa xác minh, avatar https được giữ còn http/`javascript:`/rác bị loại, mỗi người chỉ thấy hồ sơ của mình, bỏ qua mọi
`id` do client gửi, 401 `problem+json` kèm `WWW-Authenticate`, tài khoản khóa hoặc bị xóa bị từ chối, tài khoản chỉ có Google
đọc được, `/auth/me` không đổi.

## 4.2 — `PATCH /users/me`

Chỉ đổi `displayName` (Project Owner xác nhận). Hợp đồng `updateProfileRequestSchema` là `.strict()`: gửi `email`, `avatarUrl`, `id`,
`accountStatus`… trả **400** thay vì bị bỏ qua âm thầm, để client không tưởng đã đổi được. `displayNameSchema` dùng chung với đăng ký:
cắt khoảng trắng, chuẩn hóa Unicode NFC, 1–80 ký tự, **cấm ký tự điều khiển và ký tự định dạng ẩn** (zero-width, right-to-left override,
dấu phân dòng) vốn dùng để giả mạo tên; đăng ký vì vậy cũng chặt hơn trước.

Backend (`features/user/update-profile/`): `JwtAuthGuard` rồi `ThrottlerGuard` (20 lần/phút **mỗi người dùng**); handler dùng
`updateMany({ id từ token, accountStatus: ACTIVE })` nên tài khoản bị khóa không tự sửa được dù token chưa hết hạn; `id` trong URL,
query hay header bị bỏ qua và không có route theo id. Logic ánh xạ hồ sơ được tách thành `shared/profile.mapper.ts` dùng chung với `GET`.
CORS cho phép thêm `PATCH`, `PUT`, `DELETE` (cho các bước sau).

Kiểm chứng: contracts 51/51, API unit 204/204, db 214/214 (thêm 17): đổi tên + `updatedAt` tăng + GET thấy giá trị mới, NFC, 8 kiểu đầu vào sai,
5 trường không được phép bị từ chối và không đổi gì, chỉ sửa chính mình, 401, tài khoản khóa, 6 yêu cầu đồng thời, đăng ký từ chối tên có
ký tự giả mạo, giới hạn 20/phút theo người dùng và không ảnh hưởng người khác.

## 4.3 — Giao diện hồ sơ

Cấu trúc trang cho người đã đăng nhập (đều nằm trong `app/(app)/`, bọc bởi `RequireAuth` và thanh điều hướng `AppNav`):

| Trang | Nội dung |
| --- | --- |
| `/profile` | Thông tin cá nhân: ảnh/chữ cái đầu, tên, email + trạng thái xác minh, ngày tham gia, sửa tên (4.3), ảnh đại diện (4.5) |
| `/account` ("Security") | Bảo mật: xác minh email, đổi mật khẩu, liên kết Google, đăng xuất (Phase 3) |
| `/settings` | Tùy chọn (4.6) |

Web (`features/user/profile/`): `profile.action.ts` (tải hồ sơ, kiểm tra tên bằng đúng `displayNameSchema` của API trước khi gửi, ánh xạ lỗi),
`use-profile.ts`, `profile-form.tsx`, `profile-view.tsx`. Sau khi lưu, hiển thị **giá trị đã chuẩn hóa mà server trả về** (không phải chuỗi người dùng
gõ) và cập nhật tên trong session bộ nhớ mà không động tới token. Avatar chỉ là `<img>` khi URL là https, có `referrerpolicy="no-referrer"`; không có thì
dùng chữ cái đầu. Slice `user` dùng client xác thực qua `features/auth/shared/auth-client` (API công khai của feature auth), không import slice khác.
`http-client` hỗ trợ thêm `PATCH`/`PUT`/`DELETE`.

Kiểm chứng: web 141/141 (thêm 15), lint, typecheck, build đạt. Chạy thật bằng Chromium: đăng ký → đăng nhập → vào Profile từ thanh điều hướng → sửa tên có
khoảng trắng thừa thành "Nguyễn Văn A" (ô nhập hiển thị giá trị đã chuẩn hóa) → tải lại vẫn giữ → ký tự ẩn bị từ chối ngay trên ô nhập.

