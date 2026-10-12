# Shanflow — Account Flows Implementation Record (Phase 3, step 8)

Ngày: 2026-10-12. Nhánh `feat/auth`. Bước 8 của [auth-architecture.md](auth-architecture.md): xác minh email,
quên/đặt lại/đổi mật khẩu, đăng nhập và liên kết Google. Phạm vi local development (IA-001).

## Endpoints

| Endpoint | Xác thực | Kết quả | Giới hạn tốc độ |
| --- | --- | --- | --- |
| `POST /auth/email-verification/request` | Bearer | 202 (gửi lại link; tài khoản đã xác minh: không làm gì, cùng phản hồi) | 3/giờ/**người dùng** |
| `POST /auth/email-verification/confirm` | token trong body | 204; sai/hết hạn/đã dùng: 400 `INVALID_TOKEN` | 30/15 phút/IP |
| `POST /auth/password/forgot` | không | 202 **luôn giống nhau**, kể cả email lạ hoặc tài khoản bị khóa | 20/giờ/IP và 3/giờ/(IP+email) |
| `POST /auth/password/reset` | token trong body | 204; không đăng nhập hộ | 10/15 phút/IP |
| `POST /auth/password/change` | Bearer + **phiên còn sống trong DB** | 204; thiết bị này vẫn đăng nhập, mọi thiết bị khác bị thu hồi | 5/15 phút/người dùng |
| `GET /auth/google/start` | không | 302 sang Google (hoặc `/login?error=oauth_unavailable`) | 20/phút/IP |
| `GET /auth/google/callback` | cookie state | 302 về web; thành công đặt cookie refresh | 30/phút/IP |
| `POST /auth/google/link/start` | Bearer + phiên còn sống + **mật khẩu hiện tại** | 200 `{ authorizationUrl }` | 5/15 phút/người dùng |

`GET /auth/me` có thêm `security: { hasPassword, linkedProviders }` để giao diện chỉ hiện hành động áp dụng được.

## Thiết kế

**Token một lần** (`one_time_tokens`, `OneTimeTokenStore`): 256-bit, chỉ lưu SHA-256; TTL 24 giờ (xác minh) và 1 giờ
(đặt lại). Chỉ link mới nhất của mỗi mục đích còn hiệu lực. `consume` là **một câu UPDATE nguyên tử** nên với N yêu cầu
đồng thời đúng một yêu cầu thắng (có test 6–8 yêu cầu song song), và chạy trong transaction của người gọi để việc dùng token
và hành động mà nó cho phép commit cùng nhau hoặc cùng rollback. Link xác minh gắn với **địa chỉ email lúc gửi**: đổi email
làm link vô hiệu.

**Gửi email** (`Mailer`): cổng với ba transport — `console` (in link ra log API, chỉ local), `in-memory` (test), `smtp`
(nodemailer, chỉ văn bản thuần). Cấu hình từ chối `console` ở production. Việc gửi **không được await** để thời gian phản hồi
không tiết lộ địa chỉ có tài khoản hay không; lỗi gửi được ghi log không kèm người nhận hay link. Đăng ký vẫn thành công khi
không phát hành được link.

**Quên mật khẩu**: phản hồi và giao diện giống hệt nhau cho mọi địa chỉ; chỉ tài khoản ACTIVE mới được gửi link. Tài khoản chỉ có
Google được phép dùng luồng này để đặt mật khẩu đầu tiên (đọc được hộp thư là bằng chứng sở hữu).

**Đặt lại mật khẩu**: trong một transaction — claim token, ghi hash mới, đặt `emailVerifiedAt` nếu còn trống (hộp thư đã được
chứng minh), xóa các link đặt lại khác, **thu hồi mọi phiên**. Không tự đăng nhập.

**Đổi mật khẩu**: cần mật khẩu hiện tại (xác thực lại), từ chối mật khẩu mới trùng cũ, và dùng `SensitiveSessionGuard`:
access token hợp lệ chưa đủ, phiên của nó phải còn sống trong DB. Nhờ vậy sau `logout-all` token JWT còn hạn **không** đổi được
mật khẩu (có test), khác với `/auth/me` vốn chỉ stateless. Việc thu hồi chạy chung transaction và chừa lại family hiện tại.

**Google** (authorization code + PKCE S256 + `state` + `nonce`): cookie state là JWT riêng (audience và `typ` khác access
token, 10 phút, `SameSite=Lax` vì callback là điều hướng từ site khác; cookie refresh vẫn `Strict`). ID token được xác minh bằng
JWKS của Google (RS256, issuer, audience, hạn, nonce), `email_verified` phải đúng. Khóa danh tính là `sub`, **không bao giờ là
email**. Hành vi theo ADR-001/ADR-010:

- `sub` đã liên kết → đăng nhập.
- Email trùng một tài khoản chưa liên kết → **từ chối** (`account_exists`), không liên kết ngầm. Chủ tài khoản đăng nhập bằng
  mật khẩu rồi liên kết có chủ đích.
- Chưa có gì → tạo tài khoản đã xác minh, không có mật khẩu.
- Liên kết: người dùng đã đăng nhập + phiên còn sống + nhập lại mật khẩu; cookie state buộc vào đúng người đã bắt đầu; một người
  một tài khoản Google; một `sub` chỉ thuộc một người. Lỗi chuyển về `/login?error=<mã cố định>`, không bao giờ phản chiếu
  văn bản của nhà cung cấp.
- Cấu hình điểm cuối nhà cung cấp chỉ cho phép ghi đè ngoài production (để chạy nhà cung cấp giả lập).

## Frontend

Trang `/verify-email` (xác nhận bằng **bấm nút**, không tự chạy khi tải trang để trình quét thư không dùng mất token),
`/forgot-password`, `/reset-password`; trang này và trang xác minh xóa token khỏi thanh địa chỉ ngay sau khi tải và có
`Referrer-Policy: no-referrer` + `Cache-Control: no-store`. `/account` ghép các slice độc lập (tóm tắt, gửi lại xác minh, đổi mật
khẩu, liên kết Google, đăng xuất) theo dữ liệu `security` của server; nút "Continue with Google" là liên kết điều hướng thuần.
`next.config.ts` thêm `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy` cho mọi trang.

## Lưu trữ, cấu hình, phụ thuộc

- Migration `add_oauth_and_one_time_tokens`: `oauth_accounts` (UNIQUE `(provider, provider_account_id)` và `(user_id, provider)`),
  `one_time_tokens`, kèm CHECK thủ công (định dạng hash, hạn sau thời điểm tạo, token xác minh phải có email, subject không rỗng).
- Biến môi trường mới: `MAIL_TRANSPORT`, `SMTP_URL`, `MAIL_FROM`, `GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI` (+ ghi đè điểm cuối cho
  test). Production bắt buộc `smtp`; Google bật khi đủ ba biến. Lỗi cấu hình không in giá trị.
- Phụ thuộc mới: `nodemailer@10.1.0` (pin chính xác). `pnpm audit` vẫn chỉ còn SEC-02.

## Khác với kế hoạch

- Kế hoạch ghi "verify email, forgot/change password, Google" là bốn slice; thực tế `reset-password` tách khỏi `forgot-password`
  vì hai endpoint có quyền và rủi ro khác nhau.
- Thêm `SensitiveSessionGuard` và `RefreshSessionStore.findLiveSession` (ý tưởng đã nêu ở 4.3 của kiến trúc nhưng chưa làm).
- Thêm cột `security` vào `/auth/me`.

## Giới hạn đã biết

- SMTP chỉ được kiểm bằng transport giả lập của nodemailer, **chưa gửi qua máy chủ SMTP thật**; SPF/DKIM/DMARC là việc vận hành.
- Google chỉ được kiểm bằng nhà cung cấp OIDC giả lập có PKCE và ID token RS256 thật, **chưa chạy với Google thật** (cần
  client ID/secret và consent screen).
- Chưa có hủy liên kết Google (cần quy tắc "không gỡ phương thức đăng nhập cuối cùng") và chưa có đổi email.
- `forgot` có chênh lệch thời gian nhỏ giữa tài khoản có và không có (một ghi DB), giảm nhẹ bằng giới hạn tốc độ.
- Chưa có khóa tài khoản sau nhiều lần sai và chưa có xác thực hai yếu tố.

## Kiểm chứng

contracts 25/25, API unit 197/197, db 187/187, e2e 4/4, web 126/126, lint, typecheck, build đạt. Kiểm tra đột biến: bỏ kiểm tra
`nonce` hoặc `audience` của ID token thì test Google tương ứng thất bại. Chạy thật bằng Chromium (API + `next start` + nhà
cung cấp Google giả lập + mailer console): đăng ký → link xác minh mở ở trình duyệt khác → xác nhận → link dùng lại bị từ chối;
đổi mật khẩu đăng xuất thiết bị kia và giữ thiết bị này; quên mật khẩu trả cùng trang cho địa chỉ lạ, đặt lại đăng xuất mọi thiết bị,
link chỉ dùng một lần, chỉ mật khẩu mới nhất đăng nhập được; Google tạo tài khoản đã xác minh không mật khẩu; email trùng không bị
liên kết ngầm; liên kết có chủ đích sau khi nhập mật khẩu (sai mật khẩu bị chặn) rồi đăng nhập Google vào đúng tài khoản; token biến
mất khỏi thanh địa chỉ và không có Referer nào mang token.
