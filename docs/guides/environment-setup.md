# Hướng dẫn cấu hình môi trường (`.env`) để chạy Shanflow thật

Tài liệu này dành cho việc **chạy ứng dụng thật** (đăng ký, đăng nhập, gửi email, ảnh đại diện, Google…), không phải chạy test.
Mọi giá trị dưới đây được lấy từ mã nguồn (schema kiểm tra env ở `apps/api/src/config/*.ts`, `prisma.config.ts`,
`scripts/db/*`); ứng dụng **kiểm tra cấu hình lúc khởi động và dừng ngay nếu sai** (thông báo lỗi nêu tên biến, không in giá trị bí mật).

> **Phạm vi được duyệt:** theo [IA-001](../security/local-development-authorization.md) dự án mới được duyệt cho **chạy local**.
> Staging và production **chưa được duyệt** (xem [mục 8](#8-trước-khi-đưa-lên-staging--production)). Mục 5 mô tả cách cấu hình
> theo đúng luật của chế độ `production` để bạn chuẩn bị, không phải là xác nhận đã sẵn sàng phát hành.

---

## 1. Hai nơi đọc cấu hình, và vì sao dễ nhầm

| Phần | Đọc env từ đâu | Ghi chú |
| --- | --- | --- |
| **API (NestJS)** và **Prisma CLI** | file `.env` ở **gốc repo** (`/.env`); biến có sẵn trong shell luôn **thắng** file | Đường dẫn được tính từ vị trí file nên không phụ thuộc thư mục bạn đang đứng |
| **Web (Next.js)** | `apps/web/.env*` hoặc biến shell **lúc build/chạy** | Next.js **không** đọc `.env` ở gốc repo. Biến duy nhất của web là `NEXT_PUBLIC_API_URL` |
| **Docker Compose** (PostgreSQL local) | `.env` ở gốc repo | Chỉ dùng các biến `POSTGRES_*` |

**`.env` "của test" khác `.env` chạy thật.** Nếu `.env` của bạn do `scripts/ci/setup-database.sh` tạo ra (dùng trong CI hoặc
môi trường tạm), nó chỉ có 7 dòng và đặt `NODE_ENV=test`, mật khẩu ngẫu nhiên dùng một lần, thiếu `WEB_ORIGIN`, `MAIL_*`…
Đừng dùng file đó để chạy thật: hãy tạo lại từ `.env.example` theo hướng dẫn dưới. (Bộ test tự đặt thêm vài giá trị riêng như
thư mục avatar tạm và tắt giới hạn tốc độ; chạy thật thì không có những thứ này.)

---

## 2. Chạy thật trên máy local (development)

Cần: Node.js 24.15+, pnpm 11.18, Docker (cho PostgreSQL), Python 3.10+ (script cấp quyền).

### 2.1. Tạo `.env`

```bash
cp -n .env.example .env
chmod 600 .env          # file chứa bí mật: chỉ chủ sở hữu được đọc
```

Sinh các giá trị bí mật (mỗi lệnh một giá trị, **đừng dùng lại** giữa các môi trường):

```bash
openssl rand -hex 24      # dùng cho POSTGRES_PASSWORD, POSTGRES_APP_PASSWORD, POSTGRES_MIGRATOR_PASSWORD
openssl rand -base64 48   # dùng cho JWT_ACCESS_SECRET
```

Mật khẩu dán vào URL phải được **mã hóa URL** (ký tự `@ : / ? # % …` làm hỏng URL). Mật khẩu từ `openssl rand -hex` chỉ có chữ
và số nên không cần; nếu dùng mật khẩu khác:

```bash
python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1], safe=''))" 'mật-khẩu-của-bạn'
```

### 2.2. Mẫu `.env` cho local (chạy thật, `NODE_ENV=development`)

Thay các giá trị trong `<…>`. Các cổng dưới đây là mặc định; nếu 5432 bị chiếm, đổi `POSTGRES_PORT` và dùng cùng cổng đó trong cả ba URL.

```dotenv
NODE_ENV=development
PORT=3001

# --- PostgreSQL trong Docker (chỉ để khởi tạo; API không dùng POSTGRES_PASSWORD) ---
POSTGRES_DB=shanflow
POSTGRES_USER=shanflow
POSTGRES_PASSWORD=<bootstrap-password>
POSTGRES_PORT=5432
POSTGRES_APP_PASSWORD=<app-password>            # >= 16 ký tự ASCII in được
POSTGRES_MIGRATOR_PASSWORD=<migrator-password>  # >= 16 ký tự ASCII in được

# --- Kết nối ứng dụng (xem mục 3: tên role, database và schema bị khóa cứng) ---
DATABASE_URL=postgresql://shanflow_app:<app-password>@127.0.0.1:5432/shanflow?schema=public
DIRECT_DATABASE_URL=postgresql://shanflow_migrator:<migrator-password>@127.0.0.1:5432/shanflow?schema=public
SHADOW_DATABASE_URL=postgresql://shanflow_migrator:<migrator-password>@127.0.0.1:5432/shanflow_shadow?schema=public

# --- Xác thực ---
JWT_ACCESS_SECRET=<ít-nhất-32-ký-tự-ngẫu-nhiên>
AUTH_COOKIE_SECURE=false                         # http local; production bắt buộc true
WEB_ORIGIN=http://localhost:3000

# --- Địa chỉ công khai của API và nơi lưu ảnh đại diện ---
API_PUBLIC_URL=http://localhost:3001
# AVATAR_STORAGE_DIR=                            # bỏ trống = <repo>/.data/avatars (đã Git-ignore)

# --- Email: in ra log API, không gửi thật ---
MAIL_TRANSPORT=console
MAIL_FROM=Shanflow <no-reply@localhost>
```

Biến của web (file riêng, **không** nằm trong `.env` gốc). Với local có thể bỏ qua vì mặc định là `http://localhost:3001`:

```bash
# apps/web/.env.local
NEXT_PUBLIC_API_URL=http://localhost:3001
```

### 2.3. Khởi động

```bash
pnpm install                                  # cũng build @shanflow/contracts
docker compose up -d --wait postgres
python3 scripts/db/provision-roles.py         # tạo shanflow_app, shanflow_migrator, shanflow_shadow (không reset dữ liệu)
pnpm --filter api db:generate                 # sinh Prisma Client (không commit)
pnpm --filter api db:migrate:deploy           # áp dụng migration
pnpm dev                                      # API :3001 và web :3000
```

Kiểm tra: `curl localhost:3001/health/live` và `curl localhost:3001/health/ready` đều trả 200;
`pnpm --filter api db:check` thử đăng nhập bằng hai role; mở http://localhost:3000, đăng ký tài khoản, rồi lấy **link xác minh email trong log của API**
(vì `MAIL_TRANSPORT=console`).

---

## 3. Bảng biến môi trường

Cột "Bắt buộc" cho biết khi nào thiếu thì API **không khởi động**. "Dev" = `NODE_ENV=development`.

### 3.1. API và cơ sở dữ liệu

| Biến | Bắt buộc | Mặc định | Quy tắc / ghi chú |
| --- | --- | --- | --- |
| `NODE_ENV` | không | `development` | `development`, `test` hoặc `production`. `production` bật các luật chặt ở mục 5 |
| `PORT` | không | `3001` | Số nguyên 1–65535 |
| `DATABASE_URL` | **có** | — | Kết nối **chạy ứng dụng**. Phải là `postgres://`/`postgresql://`, người dùng **`shanflow_app`**, database **`shanflow`**, `schema=public`; không có tham số `user/password/host/port/database` trong query. Sai một điều kiện là dừng ngay |
| `DIRECT_DATABASE_URL` | **có** cho Prisma CLI (migrate, status) | — | Kết nối **migration**: người dùng **`shanflow_migrator`**, database `shanflow`, `schema=public` |
| `SHADOW_DATABASE_URL` | chỉ khi `prisma migrate dev` | — | Chỉ để **phát triển** migration: `shanflow_migrator` trên database **`shanflow_shadow`** (không bao giờ là `shanflow`). Production không cần |
| `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_PORT` | chỉ cho Docker Compose | `shanflow`, `shanflow`, (bắt buộc điền), `5432` | Khởi tạo container PostgreSQL local. API không đọc các biến này |
| `POSTGRES_APP_PASSWORD`, `POSTGRES_MIGRATOR_PASSWORD` | chỉ khi chạy `provision-roles.py` lần đầu | — | ≥16 ký tự ASCII in được. Chạy lại không đổi mật khẩu role đã có |

> Tên role/database bị khóa **có chủ đích** (tách quyền chạy ứng dụng khỏi quyền migration). Bạn không đổi được tên bằng cấu hình;
> muốn dùng tên khác phải sửa cả schema kiểm tra (`env.schema.ts`, `prisma.config.ts`) lẫn script cấp quyền.

### 3.2. Xác thực

| Biến | Bắt buộc | Mặc định | Quy tắc / ghi chú |
| --- | --- | --- | --- |
| `JWT_ACCESS_SECRET` | **có** | — | Khóa ký HS256, **≥32 ký tự**, không có khoảng trắng đầu/cuối. Đổi khóa ⇒ mọi access token đang dùng mất hiệu lực (người dùng sẽ tự làm mới bằng refresh cookie) |
| `JWT_ISSUER` | không | `shanflow-api` | Chuỗi không rỗng |
| `JWT_AUDIENCE` | không | `shanflow-web` | Chuỗi không rỗng |
| `ACCESS_TOKEN_TTL_SECONDS` | không | `900` | 60–3600 |
| `REFRESH_TOKEN_TTL_DAYS` | không | `30` | 1–90 |
| `AUTH_COOKIE_SECURE` | không | `true` ở production, còn lại `false` | **Phải `true` ở production** |
| `AUTH_COOKIE_DOMAIN` | không | bỏ trống (cookie theo đúng host của API) | Tên miền trần như `example.com`, không có `https://` |
| `WEB_ORIGIN` | không | `http://localhost:3000` | Gốc (scheme + host + cổng, **không có đường dẫn hay dấu `/` cuối**) của web. Dùng cho CORS, kiểm tra `Origin`, và link trong email. **Phải `https://` ở production** |

### 3.3. Địa chỉ công khai và ảnh đại diện

| Biến | Bắt buộc | Mặc định | Quy tắc / ghi chú |
| --- | --- | --- | --- |
| `API_PUBLIC_URL` | **có ở production** | dev: `http://localhost:<PORT>` | Gốc (không đường dẫn) của API **như trình duyệt truy cập**. API dùng nó để tạo URL ảnh đại diện. `https://` ở production |
| `AVATAR_STORAGE_DIR` | **có ở production** | `<repo>/.data/avatars` | Đường dẫn **tuyệt đối** (bắt đầu bằng `/`), trên ổ đĩa **bền vững** và có quyền ghi cho tiến trình API. Mất thư mục = mất ảnh |

### 3.4. Email

| Biến | Bắt buộc | Mặc định | Quy tắc / ghi chú |
| --- | --- | --- | --- |
| `MAIL_TRANSPORT` | không | `console` | `console` chỉ **in email ra log API** (dùng cho dev). **Production bắt buộc `smtp`** |
| `SMTP_URL` | khi `MAIL_TRANSPORT=smtp` | — | `smtp://` hoặc `smtps://`, kèm tài khoản: `smtps://user:mật%20khẩu@smtp.example.com:465` (mã hóa URL phần tài khoản) |
| `MAIL_FROM` | không | `Shanflow <no-reply@localhost>` | Một dòng, 3–200 ký tự. Dùng địa chỉ thuộc tên miền bạn đã cấu hình SPF/DKIM |

Email được gửi cho: xác minh email, đặt lại mật khẩu, và thông báo "mật khẩu đã đổi".

### 3.5. Đăng nhập bằng Google (tùy chọn)

Bật khi và chỉ khi **cả ba** biến sau được đặt; đặt thiếu một hoặc hai biến ⇒ API không khởi động.

| Biến | Ghi chú |
| --- | --- |
| `GOOGLE_CLIENT_ID` | Từ Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | Bí mật; không commit |
| `GOOGLE_REDIRECT_URI` | **Callback của API**, ví dụ `http://localhost:3001/auth/google/callback` (`https://` ở production). Phải **trùng khớp từng ký tự** với URI đã đăng ký ở Google |

Các biến `GOOGLE_AUTHORIZATION_ENDPOINT`, `GOOGLE_TOKEN_ENDPOINT`, `GOOGLE_JWKS_URI` chỉ để test với nhà cung cấp giả và **bị cấm ở production**. Đừng đặt chúng.

Thiết lập ở Google Cloud Console: *APIs & Services → OAuth consent screen* (điền tên ứng dụng, email hỗ trợ) → *Credentials → Create credentials →
OAuth client ID → Web application* → thêm **Authorized redirect URI** = đúng `GOOGLE_REDIRECT_URI`. Khi consent screen ở chế độ *Testing*, chỉ các
tài khoản bạn thêm làm test user mới đăng nhập được.

### 3.6. Web (Next.js)

| Biến | Bắt buộc | Mặc định | Quy tắc / ghi chú |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | không (nhưng gần như luôn phải đặt khi triển khai) | `http://localhost:3001` | Gốc của API mà **trình duyệt** gọi, không có `/` cuối. **Được nhúng vào bản build** (tiền tố `NEXT_PUBLIC_`): đổi giá trị ⇒ phải **build lại** web. Đặt trong `apps/web/.env.production` hoặc biến shell lúc `pnpm --filter web build` |

---

## 4. Các ràng buộc giữa các biến (nguyên nhân hay gặp của lỗi "chạy được nhưng không đăng nhập được")

1. **`WEB_ORIGIN` ⇔ địa chỉ thật của web.** API chỉ cho phép CORS đúng một origin này. Sai cổng hoặc scheme ⇒ trình duyệt chặn mọi lời gọi.
2. **`NEXT_PUBLIC_API_URL` ⇔ `API_PUBLIC_URL` ⇔ địa chỉ thật của API.** Ba nơi này phải cùng trỏ vào API: web gọi API, và API tạo URL ảnh đại diện cho trình duyệt.
3. **Web và API phải cùng "site"** (cùng tên miền đăng ký, ví dụ `app.example.com` và `api.example.com`). Cookie làm mới phiên là
   `HttpOnly; SameSite=Strict; Path=/auth` đặt bởi API; nếu web và API ở hai tên miền hoàn toàn khác nhau, trình duyệt sẽ không gửi cookie này và người dùng
   bị đăng xuất sau mỗi 15 phút. Ở local, `localhost:3000` và `localhost:3001` cùng site nên chạy bình thường.
4. **`GOOGLE_REDIRECT_URI` ⇔ Google Console ⇔ API.** Là địa chỉ của **API** (`…/auth/google/callback`), không phải của web. Sau khi xong, API chuyển hướng người dùng về `WEB_ORIGIN`.
5. **`DATABASE_URL`, `DIRECT_DATABASE_URL`, `SHADOW_DATABASE_URL`** phải cùng host và cùng cổng PostgreSQL; mật khẩu phải khớp mật khẩu role đã tạo.
6. Cổng web là **3000** cố định trong script (`next dev/start --port 3000`). Muốn cổng khác, sửa script và `WEB_ORIGIN` cho khớp.

---

## 5. Cấu hình theo luật `production`

Khi `NODE_ENV=production`, API **từ chối khởi động** nếu vi phạm bất kỳ điều nào sau:

| Phải thỏa | Biến |
| --- | --- |
| Cookie phải có cờ `Secure` | `AUTH_COOKIE_SECURE=true` (hoặc để trống) |
| Web phục vụ qua HTTPS | `WEB_ORIGIN=https://…` |
| API công khai qua HTTPS, đã đặt | `API_PUBLIC_URL=https://…` |
| Gửi email thật | `MAIL_TRANSPORT=smtp` và `SMTP_URL` hợp lệ |
| Có nơi lưu ảnh bền vững | `AVATAR_STORAGE_DIR=/đường/dẫn/tuyệt/đối` |
| Google (nếu dùng) qua HTTPS, không ghi đè endpoint | `GOOGLE_REDIRECT_URI=https://…`, không đặt `GOOGLE_*_ENDPOINT/JWKS_URI` |

Ví dụ (placeholder, thay bằng giá trị thật; đưa vào **biến môi trường của dịch vụ/secret manager**, không commit file):

```dotenv
NODE_ENV=production
PORT=3001

DATABASE_URL=postgresql://shanflow_app:<app-password>@<db-host>:5432/shanflow?schema=public
DIRECT_DATABASE_URL=postgresql://shanflow_migrator:<migrator-password>@<db-host>:5432/shanflow?schema=public
# SHADOW_DATABASE_URL: không cần ở production

JWT_ACCESS_SECRET=<chuỗi-ngẫu-nhiên-riêng-cho-production>
AUTH_COOKIE_SECURE=true
WEB_ORIGIN=https://app.example.com
API_PUBLIC_URL=https://api.example.com
AVATAR_STORAGE_DIR=/var/lib/shanflow/avatars

MAIL_TRANSPORT=smtp
SMTP_URL=smtps://<user>:<password>@smtp.example.com:465
MAIL_FROM=Shanflow <no-reply@example.com>

# Tùy chọn
GOOGLE_CLIENT_ID=<…>
GOOGLE_CLIENT_SECRET=<…>
GOOGLE_REDIRECT_URI=https://api.example.com/auth/google/callback
```

Web, lúc build: `NEXT_PUBLIC_API_URL=https://api.example.com pnpm --filter web build`.

Trình tự triển khai (rút gọn):

```bash
pnpm install --frozen-lockfile
pnpm --filter api db:generate
pnpm build                                  # build contracts, api, web
pnpm --filter api db:migrate:deploy         # dùng DIRECT_DATABASE_URL (shanflow_migrator)
pnpm --filter api start:prod                # node dist/main.js
pnpm --filter web start                     # next start --port 3000
```

Ở production nên truyền cấu hình bằng **biến môi trường thật** của tiến trình thay vì đặt file `.env` trên máy chủ: biến trong shell luôn thắng file.

> **Cơ sở dữ liệu production không dùng `provision-roles.py`.** Script đó được viết cho container Docker Compose local (chạy `docker compose exec`).
> Với PostgreSQL thật, bạn phải tạo hai role `shanflow_app` (chỉ quyền dữ liệu) và `shanflow_migrator` (quyền DDL trên database `shanflow`) với quyền tương đương
> những gì `scripts/db/provision-roles.sql` thiết lập, và **không** cấp cho `shanflow_app` quyền tạo/sửa/xóa bảng hay đọc bảng lịch sử migration.

---

## 6. Dữ liệu và bí mật cần sao lưu / bảo vệ

| Thứ | Vì sao | Lưu ý |
| --- | --- | --- |
| Cơ sở dữ liệu PostgreSQL | Toàn bộ người dùng, workspace, project, task | Sao lưu định kỳ; volume Docker `shanflow_postgres_data` chỉ là local |
| `AVATAR_STORAGE_DIR` | Ảnh đại diện (tệp trên đĩa, không nằm trong DB) | Sao lưu cùng DB; nhiều instance API cần chung một ổ lưu trữ |
| `JWT_ACCESS_SECRET` | Ký access token | Lộ khóa = giả mạo được phiên. Xoay khóa khi nghi ngờ |
| `GOOGLE_CLIENT_SECRET`, `SMTP_URL` | Truy cập dịch vụ ngoài | Không commit; `.env` đã nằm trong `.gitignore` |

Thao tác bí mật: không dán vào issue/PR/chat; không in `.env` ra log; mỗi môi trường dùng một bộ riêng.

---

## 7. Xử lý sự cố

| Triệu chứng | Nguyên nhân thường gặp | Cách sửa |
| --- | --- | --- |
| `Invalid runtime environment: DATABASE_URL is required and must be …` | URL không dùng `shanflow_app`/`shanflow`/`schema=public`, có khoảng trắng, hoặc mật khẩu chưa mã hóa URL | Sửa URL theo mục 3.1 |
| `Invalid auth environment: JWT_ACCESS_SECRET must be …` | Khóa <32 ký tự hoặc có khoảng trắng đầu/cuối | `openssl rand -base64 48` |
| `Invalid auth environment: … WEB_ORIGIN must be an origin …` | Có đường dẫn hoặc dấu `/` cuối (`http://localhost:3000/`) | Chỉ `scheme://host[:cổng]` |
| `… MAIL_TRANSPORT must be console or smtp, and smtp in production` | `NODE_ENV=production` mà vẫn `console` | Đặt `smtp` + `SMTP_URL` |
| `… GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REDIRECT_URI must be set together …` | Đặt thiếu một trong ba biến Google | Đặt đủ ba hoặc để trống cả ba |
| `Invalid user environment: … API_PUBLIC_URL … AVATAR_STORAGE_DIR …` | Production thiếu `API_PUBLIC_URL`/`AVATAR_STORAGE_DIR`, hoặc đường dẫn không tuyệt đối | Mục 3.3 |
| `Prisma CLI requires shanflow_migrator, primary database shanflow and a separate shadow database …` | `DIRECT_DATABASE_URL`/`SHADOW_DATABASE_URL` sai role hoặc tên database | Mục 3.1; shadow phải là `shanflow_shadow` |
| `SHADOW_DATABASE_URL is required for development migrations` | Chạy `migrate dev` mà chưa có URL shadow | Chỉ cần khi **phát triển** migration; triển khai dùng `db:migrate:deploy` |
| `Authentication failed … shanflow_migrator` | Mật khẩu role không khớp, hoặc `.env` bị tạo lại làm đổi mật khẩu mà DB vẫn giữ mật khẩu cũ | Đặt lại mật khẩu role cho khớp, hoặc dùng đúng mật khẩu đã cấp lúc provision |
| Trình duyệt báo lỗi CORS | `WEB_ORIGIN` khác origin thật của web | Sửa cho khớp rồi **khởi động lại API** |
| Đăng nhập được nhưng bị đăng xuất sau ~15 phút | Cookie làm mới không được gửi: khác site (mục 4.3), hoặc `AUTH_COOKIE_SECURE=true` mà web chạy `http://` | Cùng site và dùng HTTPS khi `Secure` |
| Ảnh đại diện không hiện | `API_PUBLIC_URL` sai, hoặc thư mục `AVATAR_STORAGE_DIR` không có quyền ghi | Mục 3.3 |
| Không thấy email xác minh | `MAIL_TRANSPORT=console`: email nằm trong **log của API**, không được gửi đi | Xem log, hoặc chuyển sang `smtp` |
| Đổi `NEXT_PUBLIC_API_URL` mà web vẫn gọi địa chỉ cũ | Giá trị được nhúng lúc build | Build lại web |
| `Hello World!`/trang trống ở `/` của API | Bình thường: API không có trang chủ | Dùng `/health/live`, `/health/ready` |

---

## 8. Trước khi đưa lên staging / production

Theo [báo cáo đóng Phase 3](../architecture/phase-3-closure.md) và [IA-001](../security/local-development-authorization.md), các mục sau **còn mở**; cấu hình đúng ở trên **chưa** giải quyết chúng:

- **Chưa có quyền staging/production** (cần quyết định chính thức của Project Owner).
- **AUTH-R03 — giới hạn tốc độ theo IP:** API **chưa bật `trust proxy`** và giới hạn theo IP lưu trong bộ nhớ. Sau reverse proxy/load balancer, API thấy IP của proxy
  (mọi người dùng gom chung một giới hạn IP; các giới hạn theo từng người dùng đã đăng nhập không bị ảnh hưởng), và chạy nhiều instance thì mỗi instance đếm riêng.
- **AUTH-R08 — chưa có Content-Security-Policy** cho web; access token nằm trong bộ nhớ nên XSS vẫn là rủi ro chính.
- **AUTH-R06/R07 — email và Google chưa được kiểm với dịch vụ thật** (SPF/DKIM/DMARC, màn hình đồng ý, redirect URI đã đăng ký).
- **AUTH-R04 — chưa có job dọn** `refresh_sessions` và `one_time_tokens` hết hạn.
- **Phụ thuộc:** SEC-02 (`braces`) vẫn mở, không có bản vá.
- **Không có kiểm thử trình duyệt tự động** (AUTH-R09); luồng trình duyệt cần được chạy thử thủ công sau khi cấu hình.

Danh sách kiểm tra nhanh trước khi chạy thật:

- [ ] `.env` tạo từ `.env.example`, quyền `600`, **không** có `NODE_ENV=test`.
- [ ] Mọi mật khẩu/khóa sinh ngẫu nhiên, riêng cho từng môi trường, không commit.
- [ ] `WEB_ORIGIN`, `API_PUBLIC_URL`, `NEXT_PUBLIC_API_URL` khớp địa chỉ thật; web và API cùng site.
- [ ] `db:migrate:deploy` chạy xong; `/health/ready` trả 200.
- [ ] Email gửi thật được (hoặc chấp nhận `console` khi còn ở local); Google (nếu dùng) đăng nhập thử thành công.
- [ ] `AVATAR_STORAGE_DIR` bền vững và được sao lưu (production).
