# Shanflow — Phase 3 (Authentication) Closure Report

Ngày đóng: 2026-10-12. Nhánh: `feat/auth`. Quyết định đóng phase: theo yêu cầu của Project Owner trong phiên triển khai.
Phạm vi và quyền: **chỉ local development** theo [IA-001](../security/local-development-authorization.md); báo cáo này
**không** mở rộng quyền sang staging hoặc production.

## 1. Kết luận

Phase 3 hoàn thành phần triển khai: xác thực email/mật khẩu và Google, phiên làm mới có luân chuyển và phát hiện đánh cắp,
đăng xuất, xác minh email, quên/đặt lại/đổi mật khẩu, theo mô hình Vertical Slice trong
[auth-architecture.md](auth-architecture.md) (Accepted). Phase đóng với **các hạng mục mang sang** ở mục 6; không hạng mục nào
trong đó bị coi là đã được chấp nhận rủi ro thay cho Project Owner.

## 2. Phạm vi đã giao

| Slice (backend `features/auth/…`) | Endpoint | Trang web | Bản ghi |
| --- | --- | --- | --- |
| `register` | `POST /auth/register` | `/register` | [register](register-implementation.md) |
| `login` | `POST /auth/login` | `/login` | [login](login-implementation.md) |
| `me` + `JwtAuthGuard` | `GET /auth/me` | `/account` | [me + guard](me-guard-implementation.md) |
| `refresh` | `POST /auth/refresh` | khôi phục phiên khi tải trang | [refresh](refresh-implementation.md) |
| `logout` | `POST /auth/logout`, `/auth/logout-all` | nút trên `/account` | [logout](logout-implementation.md) |
| `verify-email` | `POST /auth/email-verification/{request,confirm}` | `/verify-email` | [account flows](account-flows-implementation.md) |
| `forgot-password`, `reset-password` | `POST /auth/password/{forgot,reset}` | `/forgot-password`, `/reset-password` | như trên |
| `change-password` | `POST /auth/password/change` | `/account` | như trên |
| `google` | `GET /auth/google/{start,callback}`, `POST /auth/google/link/start` | nút Google, liên kết trên `/account` | như trên |

Nền tảng: schema/migration [auth storage](auth-storage-implementation.md) và `add_oauth_and_one_time_tokens`, thành phần dùng chung
[shared](auth-shared-implementation.md), package `@shanflow/contracts`, mailer, `SensitiveSessionGuard`, 8 migration tổng cộng.
Tổng thay đổi so với `main`: 17 commit, ~200 file.

## 3. Đối chiếu quyết định thiết kế

| Mục | Kết quả |
| --- | --- |
| ADR-001 email/mật khẩu + Google, không liên kết ngầm theo email | Đạt: email trùng bị từ chối, chỉ liên kết có chủ đích sau khi nhập lại mật khẩu (có test + chạy thật) |
| ADR-010 `PasswordCredential`, `OAuthAccount`, `RefreshSession`, khóa theo family, reuse → thu hồi family | Đạt, kèm test đồng thời và kiểm tra đột biến cho khóa |
| D1 access token JWT HS256 15 phút, claim tối thiểu | Đạt (`sub`, `sid`, `iss`, `aud`, `iat`, `exp`); từ chối `alg: none`/thuật toán khác |
| D2 refresh token ngẫu nhiên chỉ lưu hash | Đạt |
| D3 cookie `HttpOnly`/`SameSite=Strict`/`Path=/auth`; D4 Origin + header | Đạt; cookie state OAuth là `Lax` có chủ đích |
| D5 argon2id | Đạt (m=19456, t=2, p=1), tự nâng hash cũ khi đăng nhập |
| D6 luân chuyển, D8 trần 30 ngày tuyệt đối | Đạt |
| D7 không có khoảng ân hạn khi refresh | **Giữ nguyên, chưa được chốt lại** (mục 6, AUTH-R01); giảm nhẹ bằng `keepalive` + Web Locks |
| D9 đăng nhập được khi chưa xác minh email | Đạt; xác minh đầy đủ nay có |
| D10 chống dò email | Login/forgot đồng nhất; **register trả 409** theo thiết kế, có giới hạn tốc độ |
| D11 đăng ký không tạo workspace | Đạt (việc của Phase 4) |
| D12 giới hạn tốc độ | Đạt trong bộ nhớ (mục 6, AUTH-R03) |
| D13 SUSPENDED → `INVALID_CREDENTIALS` | Đạt ở login/Google; refresh, reset, đổi mật khẩu cũng từ chối |

## 4. Thuộc tính bảo mật đã được kiểm chứng bằng test

- Mọi thất bại đăng nhập là một phản hồi giống hệt nhau (email lạ, sai mật khẩu, tài khoản khóa, chỉ-Google).
- Token (refresh, xác minh, đặt lại) chỉ lưu hash; refresh token không bao giờ nằm trong body; mật khẩu không bao giờ được phản chiếu
  trong lỗi.
- Refresh dùng một lần: 5 yêu cầu đồng thời chỉ 1 thắng; dùng lại token cũ thu hồi cả family; logout/logout-all/đổi mật khẩu/đặt lại
  chạy đua với refresh không để lại phiên sống (bỏ khóa thì test thất bại).
- Token một lần được claim nguyên tử (N yêu cầu song song, 1 thắng) và rollback cùng transaction của hành động.
- `SensitiveSessionGuard`: sau `logout-all`, access token còn hạn không đổi được mật khẩu hay bắt đầu liên kết Google.
- Google: sai audience, issuer, nonce, hết hạn, khóa lạ, thiếu ID token, state thiếu/giả/lệch/phát lại đều bị từ chối và không tạo
  tài khoản hay phiên; PKCE verifier thật sự được kiểm ở phía nhà cung cấp.
- Giới hạn tốc độ từng endpoint (đếm theo người dùng khi đã đăng nhập, theo IP+email cho luồng theo địa chỉ).
- Cấu hình fail-fast, thông báo lỗi không in bí mật; production cấm `console` mailer, cookie không `Secure`, origin không https và ghi
  đè điểm cuối Google.

## 5. Kết quả kiểm chứng

| Bộ | Kết quả |
| --- | --- |
| `@shanflow/contracts` | 25/25 |
| API unit | 197/197 |
| API + PostgreSQL thật (18 file) | 187/187 |
| API e2e | 4/4 |
| Web (vitest + Testing Library) | 126/126 |
| Lint / typecheck / build | Đạt (1 cảnh báo PostCSS có từ trước) |
| `pnpm audit` | 1 High: SEC-02 (SEC-01 đã xử lý bằng override, chờ Project Owner đóng) |

Chạy thật bằng Chromium (Playwright) trên API + `next start`: toàn bộ luồng đăng ký/đăng nhập/làm mới/đăng xuất, khôi phục phiên
sau tải lại, hai tab tải lại đồng thời không bị thu hồi nhầm, phát hiện đánh cắp token, hai "thiết bị", xác minh email từ trình duyệt
khác, đặt lại/đổi mật khẩu, Google (nhà cung cấp giả lập) gồm tạo tài khoản, từ chối liên kết ngầm và liên kết có chủ đích. Các script
là thủ công, **không nằm trong repo**.

## 6. Hạng mục mang sang (chưa đóng)

| ID | Nội dung | Mức | Chặn | Chủ / giai đoạn |
| --- | --- | --- | --- | --- |
| AUTH-R01 | Khoảng ân hạn ≤ 10 giây khi refresh (D7): thiếu thì mất `Set-Cookie` giữa chừng làm người dùng bị đăng xuất nhầm; có thì yếu hơn phát hiện đánh cắp. `keepalive` đã giảm nhưng không loại bỏ | Trung bình | Không | Project Owner quyết định |
| AUTH-R02 | SEC-02 (braces) vẫn mở, không có bản vá; SEC-01 cần Project Owner đóng chính thức (override major) | Cao | Staging, production | Dependency security review |
| AUTH-R03 | Giới hạn tốc độ theo `req.ip` lưu trong bộ nhớ: cần `trust proxy` đúng, Redis khi nhiều instance, và xem lại 30/phút/IP cho refresh khi nhiều người chung NAT | Cao | Staging | Triển khai hạ tầng |
| AUTH-R04 | Chưa có job dọn `refresh_sessions` và `one_time_tokens` hết hạn/đã dùng (chỉ xóa sau cửa sổ phát hiện reuse được duyệt) | Trung bình | Production | Backlog vận hành |
| AUTH-R05 | Access token còn hiệu lực tối đa 15 phút sau khi thu hồi phiên; Phase 4 phải quyết định API ghi nào dùng `SensitiveSessionGuard` (thêm một truy vấn DB mỗi yêu cầu) | Trung bình | Workspace/Task API | Phase 4 |
| AUTH-R06 | SMTP chưa gửi qua máy chủ thật; SPF/DKIM/DMARC và khả năng giao thư chưa kiểm | Trung bình | Staging | Vận hành |
| AUTH-R07 | Google chưa chạy với Google thật (cần client ID/secret, consent screen, redirect URI đã đăng ký); chưa có hủy liên kết và đổi email | Trung bình | Staging | Smoke test staging, backlog |
| AUTH-R08 | Chưa có Content-Security-Policy cho web (cần nonce cho script nội tuyến của Next); access token nằm trong bộ nhớ nên XSS vẫn là rủi ro chính | Cao | Production | Hardening web |
| AUTH-R09 | Không có kiểm thử trình duyệt tự động trong repo; luồng trình duyệt chỉ được chạy thủ công. (CI cho lint/typecheck/test/build/database đã được thêm sau khi đóng phase qua `.github/workflows/ci.yml`; xem README, mục CI) | Trung bình | Staging | Database/CI phase |
| AUTH-R10 | Chưa có khóa tài khoản sau nhiều lần sai, MFA, danh sách/thu hồi từng thiết bị, thông báo email khi đổi mật khẩu | Thấp–trung bình | Không | Backlog |
| AUTH-R11 | `register` trả 409 làm lộ email đã đăng ký (D10 chấp nhận); `forgot` có chênh thời gian nhỏ | Thấp | Không | Theo dõi |
| CDB-002/003/004 | Phân quyền theo workspace/vai trò, bootstrap/chuyển quyền sở hữu workspace, giao thức Task (từ [audit](core-database-audit.md)) vẫn mở | Cao | **Workspace API, Task API** | Phase 4 |

## 7. Cổng sẵn sàng sau Phase 3

| Cổng | Quyết định | Căn cứ |
| --- | --- | --- |
| Local development | **READY** | Mọi luồng chạy và có test trên PostgreSQL local |
| Auth implementation | **DONE (local)** | Mục 2–5 |
| Workspace API | **NOT READY** | Chưa có tầng phân quyền, bootstrap workspace/owner (CDB-002, CDB-003, AUTH-R05) |
| Task API | **NOT READY** | Chưa có chính sách vòng đời Task và giao thức đồng thời (CDB-002, CDB-004) |
| Staging | **NOT READY** | SEC-02, AUTH-R03, R06, R07, R09 và chưa có quyền staging |
| Production | **NOT READY** | Toàn bộ điều kiện staging cộng AUTH-R04, R08; chưa có quyền production |

## 8. Cách tiếp tục (Phase 4 — Workspace)

1. Chốt AUTH-R01 và quy tắc dùng `SensitiveSessionGuard` cho API ghi (AUTH-R05).
2. Xây tầng phân quyền dùng chung: tài khoản ACTIVE, membership ACTIVE, vai trò, phạm vi workspace; mọi service nghiệp vụ đi qua nó
   (CDB-002), dùng `JwtAuthGuard` đã export.
3. Bootstrap workspace PERSONAL + owner membership trong một transaction (ADR-011, CDB-003) — việc đăng ký/Google hiện cố ý không làm.
4. Trước staging: AUTH-R02, R03, R06, R07, R09 và provision hạ tầng.

## 9. Thay đổi cấu hình/tài liệu cấp repo

`.env.example` (biến auth, mail, Google, `NEXT_PUBLIC_API_URL`), `README.md` (mục Authentication, `packages/contracts`),
`pnpm-workspace.yaml` (override `deepmerge-ts`, `argon2` không chạy install script), `auth-architecture.md` (tiến độ).
Không đổi IA-001, RA-001, các ADR hay Design Freeze.
