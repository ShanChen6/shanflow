# Shanflow

Ứng dụng quản lý công việc cá nhân. Foundation hiện có monorepo, frontend
placeholder, API mặc định và PostgreSQL development qua Docker Compose.
Prisma đã tích hợp vào NestJS dependency injection và lifecycle runtime;
chưa có models, migrations hoặc tính năng nghiệp vụ.

## Tech stack

- Frontend: Next.js 16, React 19, TypeScript strict, App Router, Tailwind CSS 4, ESLint.
- Backend: NestJS 12, TypeScript strict, REST API (Express), Oxlint.
- Workspace: pnpm, một lockfile chung; chưa cần công cụ orchestration bổ sung.
- Database development: PostgreSQL 18.6 qua Docker Compose.
- ORM foundation (API workspace): Prisma 7.10.0, PostgreSQL driver adapter.

## Repository structure

```text
apps/
  web/                 # Next.js frontend, src/app, public
  api/                 # NestJS backend, src, test
    prisma/            # Schema chưa có business models
    prisma.config.ts   # Prisma CLI dùng migration connection
packages/              # Chỗ trống cho shared packages khi thực sự cần
package.json
pnpm-workspace.yaml
pnpm-lock.yaml
compose.yaml
.env.example
scripts/db/            # Provision PostgreSQL roles trên volume hiện hữu
```

## Requirements

- Node.js 24.15+ (khuyến nghị Node.js 24 LTS).
- pnpm 11.18.0, được khai báo trong `packageManager`.
- Docker Engine/Desktop đang chạy và Docker Compose v2 (để chạy PostgreSQL).
- Python 3.10+ (để chạy script provisioning roles, không cần package bổ sung).

## Install dependencies

Từ root repository:

```bash
pnpm install
```

## Development

### First-time local setup

> Cấu hình `.env` đầy đủ (mọi biến, giá trị mặc định, luật `production`, Google, SMTP, xử lý sự cố):
> [docs/guides/environment-setup.md](docs/guides/environment-setup.md).

Thực hiện theo thứ tự sau từ root repository:

1. `pnpm install`.
2. `cp -n .env.example .env`, rồi `chmod 600 .env` trên Linux/macOS. Giữ nguyên
   file đã tồn tại. Điền ba mật khẩu bootstrap/app/migrator tương ứng, cùng runtime/migration/shadow URLs (password phải URL-encode).
   `DATABASE_URL` dùng `shanflow_app` trên `shanflow`; hai CLI URLs dùng
   `shanflow_migrator`, lần lượt trên `shanflow` và `shanflow_shadow`.
   Mọi URL phải dùng đúng `POSTGRES_PORT`; chọn port trống nếu 5432 bị chiếm.
3. `docker compose config --quiet`, rồi `docker compose up -d --wait postgres`.
4. `python3 scripts/db/provision-roles.py` để tạo roles/shadow mà không reset.
5. `pnpm --filter api db:validate` và `pnpm --filter api db:generate`.
6. `pnpm lint`, `pnpm typecheck`, `pnpm build`, rồi API unit/e2e tests bên dưới.
7. Chạy API và frontend ở hai terminal theo các lệnh bên dưới; kiểm tra
   `/health/live` và `/health/ready` bằng curl.

Generated Prisma Client không được commit: phải generate trước khi build,
typecheck hoặc chạy tests trên clone mới. Validate/generate không cần kết nối
database, nhưng Prisma config vẫn yêu cầu URL migration hợp lệ về cấu trúc.
Unit/HTTP e2e tests dùng mocks và tự khai báo runtime test environment.

Frontend tại http://localhost:3000:

```bash
pnpm --filter web dev
```

Backend tại http://localhost:3001 (`GET /` trả về `Hello World!`):

Trước khi chạy API, khởi động PostgreSQL, provision roles và điền các URL trong
root `.env` theo hướng dẫn bên dưới, rồi generate Prisma Client:

```bash
docker compose up -d postgres
pnpm --filter api db:generate
```

Chạy toàn bộ dự án bằng Docker (api + web + migrate): xem mục 2.4 của
[docs/guides/environment-setup.md](docs/guides/environment-setup.md) (`docker compose --profile app up -d --build`).

```bash
pnpm --filter api dev
```

Chạy cả hai ứng dụng (Ctrl+C để dừng):

```bash
pnpm dev
```

Frontend dùng Webpack và Tailwind PostCSS để build được trong môi trường
hạn chế cổng worker của Turbopack. Không bỏ qua lint hoặc TypeScript checking.

## Checks and build

```bash
pnpm lint
pnpm typecheck
pnpm build
pnpm --filter api test
pnpm --filter api test:e2e
```

Root scripts chạy kiểm tra/build cho cả hai workspace. Có thể dùng
`pnpm --filter web <script>` hoặc `pnpm --filter api <script>` để chạy riêng.

Sau khi build, chạy frontend bằng `pnpm --filter web start` và backend bằng
`pnpm --filter api start:prod`, trên cùng port development tương ứng.

Không commit secret, `.env*` (ngoại trừ `.env.example`), dependencies hay build output. `packages/contracts`
(`@shanflow/contracts`) chứa schema request/response dùng chung giữa API và web; `pnpm install` tự build nó
(`prepare`), chạy lại `pnpm --filter @shanflow/contracts build` sau khi sửa.

## PostgreSQL development

Chạy các lệnh sau từ root repository. Tạo cấu hình local nếu chưa có `.env`:

```bash
cp -n .env.example .env
```

Điền mật khẩu development riêng vào `POSTGRES_PASSWORD` trong `.env`.
Nếu mật khẩu có ký tự `$` hoặc `#`, đặt giá trị trong dấu nháy đơn để tránh
interpolation của Compose. `.env` được Git ignore; không chia sẻ hoặc commit
file này. `.env.example` chỉ chứa tên biến và không có mật khẩu.

Mặc định database/user là `shanflow`, host port `5432`. Compose yêu cầu mật
khẩu không rỗng và chỉ publish `127.0.0.1`, phục vụ development local.
Không dùng cấu hình này để triển khai production.

Image được pin `postgres:18.6-bookworm`; named volume `shanflow_postgres_data`
mount tại `/var/lib/postgresql`, đúng layout PostgreSQL 18. Xem
[tài liệu official image](https://hub.docker.com/_/postgres).
User bootstrap `shanflow` được official image tạo với quyền superuser và chỉ
dùng để quản trị/provisioning. Hai role runtime và migration được thiết lập
riêng bên dưới; NestJS runtime dùng role `shanflow_app`.

### Start và healthcheck

```bash
docker compose config --quiet
docker compose up -d postgres
docker compose ps
docker compose logs -f postgres
```

Trong `docker compose ps`, chờ trạng thái `healthy`. Có thể kiểm tra trực tiếp:

```bash
docker compose exec postgres sh -c 'pg_isready -h 127.0.0.1 -p 5432 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
```

Healthcheck chạy qua TCP, dùng đúng database/user, interval 5s, timeout 5s,
10 retries, start period 20s. `pg_isready` kiểm tra server nhận kết nối;
không xác minh mật khẩu, nên kiểm tra đăng nhập bằng `psql` bên dưới.

### Kết nối bằng psql

Không cần cài `psql` trên host để dùng client trong container:

```bash
docker compose exec postgres sh -c 'psql -h 127.0.0.1 -p 5432 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -W'
```

Nhập mật khẩu từ `.env` khi được hỏi. Trong `psql`, kiểm tra:

```sql
SELECT current_database(), current_user;
\dt
\q
```

Database mới chưa có bảng nghiệp vụ. Nếu đã cài PostgreSQL client trên host:

```bash
psql -h 127.0.0.1 -p 5432 -U shanflow -d shanflow -W
```

Thay port/database/user trong lệnh host nếu đã đổi cấu hình.

### Port conflict và persistence

Nếu port 5432 đã được sử dụng, đổi `POSTGRES_PORT` trong `.env` sang một port
trống, ví dụ `55432`, rồi chạy lại `docker compose up -d postgres`.
Container vẫn dùng port 5432; lệnh `psql` trên host dùng port mới.

```bash
docker compose down
docker compose up -d postgres
docker volume inspect shanflow_postgres_data
```

`down` xóa container/network nhưng giữ named volume và dữ liệu. Không thêm
`-v` và không xóa/prune volume. Giữ nguyên Compose project name `shanflow`
để tái sử dụng đúng volume. Các biến database/user/password chỉ khởi tạo khi
volume rỗng; sửa `.env` không đổi credentials của database đã tồn tại.
Nếu thông tin đăng nhập không khớp, dùng credentials hiện hữu hoặc thay đổi
role qua SQL bằng quyền quản trị; không xóa volume để xử lý lỗi.

## PostgreSQL roles và permissions

| Role | Mục đích | Quyền |
| --- | --- | --- |
| `shanflow` | Bootstrap/provisioning | Superuser, giữ ownership database; không dùng cho runtime hoặc migration |
| `shanflow_app` | NestJS runtime trong bước sau | LOGIN, CONNECT `shanflow`, USAGE `public`, SELECT/INSERT/UPDATE/DELETE, USAGE sequences |
| `shanflow_migrator` | Prisma migrations trong bước sau | LOGIN, CONNECT `shanflow`, owner `public` và objects do chính role tạo; owner database development `shanflow_shadow` |

Cả hai role mới đều NOSUPERUSER, NOCREATEDB, NOCREATEROLE, NOREPLICATION,
NOBYPASSRLS và không có role membership. Runtime không có CREATE schema/table,
ALTER/DROP table, TRUNCATE, TEMP hoặc quyền chuyển sang migrator.
Migrator không sở hữu database chính; chỉ sở hữu `shanflow_shadow` và không có quyền quản trị cluster.

Schema `public` ban đầu thuộc `pg_database_owner` trong PostgreSQL 18; sau
provisioning thuộc `shanflow_migrator`. Database vẫn thuộc bootstrap `shanflow`.
Xem [PostgreSQL 18 schema permissions](https://www.postgresql.org/docs/18/ddl-schemas.html).

### Provisioning trên database hiện hữu

Thêm vào `.env` ở root (không thay đổi bootstrap credentials):

```ini
POSTGRES_APP_PASSWORD=
POSTGRES_MIGRATOR_PASSWORD=
```

Điền hai mật khẩu riêng, tối thiểu 16 ký tự ASCII in được. Có thể dùng password
manager hoặc sinh bằng `secrets.token_hex(32)`. Nếu có `$`/`#`, đặt giá trị trong
dấu nháy đơn. Mật khẩu thật chỉ nằm trong `.env` đã Git ignore; không đưa vào
SQL, command arguments, README hoặc shell history.

```bash
docker compose up -d postgres
python3 scripts/db/provision-roles.py
docker compose ps
```

Script dùng `psql` trong container qua Unix socket bằng bootstrap role;
không cần cài PostgreSQL client hoặc Python database driver trên host.
Compose đọc `.env` và environment của shell; environment được ưu tiên.
Không cần recreate container để script đọc các biến mật khẩu mới.

Provisioning chạy trong một transaction, có advisory lock, không reset
database/volume, không tạo bảng và không phụ thuộc `/docker-entrypoint-initdb.d`.
Sau transaction roles/permissions, script tạo shadow database ở session autocommit
riêng (CREATE DATABASE không được chạy trong transaction), rồi thiết lập ACLs.
Nếu database shadow đã tồn tại, giữ nguyên database/dữ liệu và kiểm tra owner;
owner không đúng thì dừng để audit, không tự ý đổi owner hoặc recreate database.
Database mới tạm chặn connections cho đến khi ACLs được thiết lập.
Password verifier SCRAM được tạo trong bộ nhớ; script tắt session statement
logging trước khi truyền verifier và không in credentials/SQL lỗi.

Chạy lại cùng command để đồng bộ permissions. Role đã tồn tại sẽ giữ nguyên
mật khẩu, ngay cả khi giá trị trong `.env` thay đổi; không cần cung cấp mật khẩu
của role đã tồn tại để provisioning. Đổi mật khẩu phải là thao tác quản trị riêng,
sau đó cập nhật `.env` cho khớp. Script sẽ dừng và rollback nếu managed role có
membership, sở hữu database ngoài shadow dành riêng cho migrator, runtime sở hữu objects/schema, hoặc objects trong
`public` thuộc role khác; cần audit ownership rõ ràng trước khi chạy lại.

Script dành cho cluster development riêng của Shanflow: thu hồi CONNECT từ
`PUBLIC` trên tất cả database hiện có, rồi cấp CONNECT `shanflow` cho hai role
và CONNECT `shanflow_shadow` riêng cho migrator.
Điều này ngăn truy cập `postgres`/`template1`; bootstrap vẫn quản trị được.
Các cluster/dự án Docker khác không bị thay đổi. Nếu thêm database mới vào
cluster này, chạy lại provisioning để thu hồi CONNECT mặc định của database
mới. Không sử dụng script nguyên trạng trên cluster chia sẻ với ứng dụng khác.

### Runtime connection và migration connection

Runtime dùng `shanflow_app` và `POSTGRES_APP_PASSWORD`; migration dùng
`shanflow_migrator` và `POSTGRES_MIGRATOR_PASSWORD`. Cả hai dùng database
`shanflow`, schema `public`, host `127.0.0.1` và `POSTGRES_PORT` trong `.env`
(local hiện tại `55432`). `DATABASE_URL` và `DIRECT_DATABASE_URL` được chuẩn bị
ở phần Prisma bên dưới; PrismaService dùng runtime URL qua NestJS DI.

Mọi migration phải tạo objects dưới role `shanflow_migrator` để default
privileges cấp CRUD và sequence usage tự động cho runtime. Objects tạo bằng
bootstrap không nhận defaults này. Xem
[ALTER DEFAULT PRIVILEGES](https://www.postgresql.org/docs/18/sql-alterdefaultprivileges.html).
Không tự động cấp EXECUTE application routines cho runtime hoặc `PUBLIC`.

Migrator giữ NOCREATEDB; Prisma `migrate dev` dùng shadow database được bootstrap
provision sẵn ở phần workflow bên dưới, không cần nâng quyền migrator.

### Kiểm tra đăng nhập và quyền

Nhập mật khẩu tương ứng khi `psql` hỏi (thay port nếu `.env` dùng giá trị khác):

```bash
psql -h 127.0.0.1 -p 55432 -U shanflow_app -d shanflow -W
psql -h 127.0.0.1 -p 55432 -U shanflow_migrator -d shanflow -W
```

Không có `psql` trên host thì dùng client trong container:

```bash
docker compose exec postgres psql -h 127.0.0.1 -U shanflow_app -d shanflow -W
docker compose exec postgres psql -h 127.0.0.1 -U shanflow_migrator -d shanflow -W
```

Kiểm tra sau khi đăng nhập:

```sql
SELECT current_database(), current_user;
SELECT rolname, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls
FROM pg_roles WHERE rolname IN ('shanflow_app', 'shanflow_migrator');
SELECT has_schema_privilege(current_user, 'public', 'USAGE') AS can_use_schema,
       has_schema_privilege(current_user, 'public', 'CREATE') AS can_create;
SELECT datname, has_database_privilege(current_user, oid, 'CONNECT') AS can_connect
FROM pg_database ORDER BY datname;
\dn+
\dp public.*
\ddp
```

Runtime có `can_create = false`; migrator có `can_create = true`.
Kiểm thử Foundation đã dùng bảng disposable `_shanflow_roles_verify_<random>`
để xác nhận migrator CREATE/ALTER/index/constraint/DROP, runtime CRUD/sequence
usage, runtime bị chặn DDL/TRUNCATE/TEMP/SET ROLE, và dữ liệu/mật khẩu được giữ
khi provisioning chạy lại. Bảng kiểm thử được xóa bởi migrator sau kiểm tra;
không thay đổi bảng nghiệp vụ hoặc reset cluster.

## Prisma ORM foundation

API dùng Prisma CLI, Client và `@prisma/adapter-pg` cùng phiên bản stable
`7.10.0`, pin rõ ràng để tránh vô tình cài release candidate. `pg` là driver
PostgreSQL; `dotenv` nạp `.env` ở root cho Prisma config và script kiểm tra.
PrismaService/PrismaModule đã tích hợp ở phần bên dưới; chưa có business models
hoặc migrations.

### Cấu hình connections

Thêm các URL vào `.env` ở root, giữ nguyên các biến PostgreSQL đã có:

```ini
DATABASE_URL=
DIRECT_DATABASE_URL=
```

- `DATABASE_URL`: role `shanflow_app`, dùng cho runtime trong bước sau.
- `DIRECT_DATABASE_URL`: role `shanflow_migrator`, dùng cho Prisma CLI/migrations.

Định dạng URL: `postgresql://<role>:<encoded-password>@127.0.0.1:<port>/shanflow?schema=public`.
Dùng mật khẩu của role đã provision, URL-encode phần username/password bằng
`encodeURIComponent` (JavaScript) hoặc `urllib.parse.quote(value, safe='')`
(Python). Không encode toàn bộ URL; không dùng bootstrap role.
Port phải khớp `.env` (`55432` trên môi trường local hiện tại).

`prisma.config.ts` nạp root `.env` bằng đường dẫn dựa trên vị trí file, không
phụ thuộc working directory; environment của shell được ưu tiên. Prisma 7
đọc datasource URL từ config thay vì schema. Config dùng `DIRECT_DATABASE_URL`
và từ chối URL có role/database/schema khác; không fallback sang runtime URL.
Xem [Prisma 7 config](https://www.prisma.io/docs/orm/v7/reference/prisma-config-reference).

Mật khẩu đã tồn tại không thay đổi khi provisioning chạy lại; nếu URL không
đăng nhập được, kiểm tra credentials thực tế thay vì reset database.
Không in connection strings hoặc commit `.env`.

### Validate, generate và kiểm tra

```bash
pnpm install
pnpm --filter api db:validate
pnpm --filter api db:generate
pnpm --filter api db:check
pnpm --filter api typecheck
pnpm --filter api build
```

Generator `prisma-client` output tại `apps/api/src/generated/prisma`, format
ESM, source `.ts`, imports `.js`, phù hợp NestJS `nodenext` hiện tại. Không đổi
module system backend. Prisma 7.10 hỗ trợ generate không có models bằng
`prisma generate` mặc định; không thêm model giả. Generated output được Git
ignore và chỉ loại khỏi lint mã nguồn tự viết; vẫn được TypeScript/build xử lý.
Chạy `db:generate` sau install hoặc khi đổi schema, không sửa generated files.

`db:check` chỉ đọc `SELECT 1`, database/user và role flags bằng `pg`, kiểm tra
cả runtime/migration URL riêng biệt, không tạo bảng và không in URL/error chứa
credentials. Cần PostgreSQL healthy; không cần shadow database cho thao tác này.

Prisma CLI cũng có thể kiểm tra connection bằng truy vấn chỉ đọc:

```bash
pnpm --filter api exec prisma db execute --stdin <<'SQL'
SELECT 1;
SQL
```

`pnpm --filter api db:status` chạy `prisma migrate status` bằng migration URL.
Chưa có migrations nên command có thể báo chưa có migration history và exit
khác 0; đây không phải lỗi runtime connection. Không dùng `db push`, `migrate dev`
hoặc reset trong foundation này.

### Shadow database và migration workflow

Shadow `shanflow_shadow` chỉ phục vụ development, cùng PostgreSQL instance/port
với database chính. Owner database và schema `public` là `shanflow_migrator`.
Runtime `shanflow_app` không có CONNECT; không cấp SUPERUSER hoặc CREATEDB
cho migrator. Database chính vẫn thuộc bootstrap, quyền runtime giữ nguyên.

Provision hoặc chạy lại an toàn:

```bash
python3 scripts/db/provision-roles.py
```

Thêm `SHADOW_DATABASE_URL` trong root `.env`, dùng credentials đã provision của
`shanflow_migrator`, URL-encode password đúng như migration URL, nhưng database
path là `/shanflow_shadow?schema=public`. Không dùng shadow URL trong NestJS.
Giữ nguyên `DATABASE_URL` và `DIRECT_DATABASE_URL`; không commit URLs thật.

Prisma config dùng `datasource.url` từ `DIRECT_DATABASE_URL` và
`datasource.shadowDatabaseUrl` từ `SHADOW_DATABASE_URL`. Guard parse URL và decode
tên database để chặn shadow trỏ vào `shanflow`, kể cả khác hostname, port,
credentials/query string hoặc tên database được percent-encode. Shadow phải
đúng tên `shanflow_shadow`, role migrator, schema `public`.

`SHADOW_DATABASE_URL` bắt buộc cho `migrate dev`, không cần trong production
`migrate deploy`/status. Khi deploy production, cung cấp migration URL qua
environment và không cung cấp shadow URL hoặc mang theo `.env` development.
Không chạy provisioning development này trên production.

Kiểm tra bằng bootstrap (nhập mật khẩu khi được hỏi):

```bash
psql -h 127.0.0.1 -p 55432 -U shanflow -d shanflow -W
```

```sql
SELECT datname, pg_get_userbyid(datdba) AS owner,
       has_database_privilege('shanflow_app', oid, 'CONNECT') AS runtime_connect,
       has_database_privilege('shanflow_migrator', oid, 'CONNECT') AS migrator_connect
FROM pg_database WHERE datname IN ('shanflow', 'shanflow_shadow');
```

Migrator đăng nhập được; runtime command phải bị từ chối:

```bash
psql -h 127.0.0.1 -p 55432 -U shanflow_migrator -d shanflow_shadow -W
psql -h 127.0.0.1 -p 55432 -U shanflow_app -d shanflow_shadow -W
```

Development workflow cho các phase có models sau này:

```bash
pnpm --filter api db:migrate:dev --name <migration_name> --create-only
# Review SQL trong apps/api/prisma/migrations trước khi áp dụng.
pnpm --filter api db:migrate:dev
pnpm --filter api db:generate
pnpm --filter api db:migrate:status
```

`migrate dev` kiểm tra drift/replay migrations trong shadow và có thể soft-reset
shadow; vì vậy shadow không được chứa dữ liệu cần giữ. `--create-only` vẫn dùng
shadow và có thể yêu cầu reset nếu database chính có drift. Nếu Prisma đề nghị
reset database chính, dừng để audit/backup và xử lý drift; không chấp nhận reset
trong workflow này. Review và commit schema cùng migration SQL khi phase sau
được triển khai; không sửa migration đã áp dụng.

Production workflow (chỉ áp dụng migrations đã được review và commit):

```bash
pnpm --filter api db:migrate:deploy
pnpm --filter api db:migrate:status
```

`migrate deploy` không cần shadow và không tạo migration mới; không dùng
`migrate dev` trên production. Không có script reset và HTTP startup không tự
chạy migrations. `db:status` giữ lại như alias cũ của status command.

Foundation hiện chưa có migrations/business models: chưa chạy `migrate dev`,
`migrate deploy` hoặc tạo migration mới. Verification dùng connection/permission
checks và read-only queries; không reset database chính, shadow hoặc volume.
Xem [Prisma 7 shadow database](https://www.prisma.io/docs/orm/v7/prisma-migrate/understanding-prisma-migrate/shadow-database).

## NestJS Prisma integration

`src/database/prisma.module.ts` cung cấp và export một `PrismaService` singleton.
AppModule import PrismaModule tường minh; module khác cần dùng database sẽ
import PrismaModule rồi inject PrismaService, không khai báo lại provider và
không tạo client/pool theo request. Module không dùng `@Global()`.

PrismaService kế thừa generated PrismaClient ESM, dùng `PrismaPg` với runtime
`DATABASE_URL`. Configuration layer từ chối bootstrap/migration role, database/schema khác
hoặc URL thiếu/sai, không fallback sang `DIRECT_DATABASE_URL`.
`AppConfigModule` nạp và validate root `.env` một lần cho runtime source/compiled;
biến environment được ưu tiên. PrismaService nhận runtime URL đã validate qua DI.

Lifecycle:

- `OnModuleInit`: `$connect()` rồi truy vấn chỉ đọc `SELECT 1` để xác nhận server
  thực sự nhận kết nối trước khi HTTP server lắng nghe PORT đã validate (mặc định 3001). Promise khởi
  tạo được giữ lại để không gọi connect lặp khi lifecycle được gọi lại.
- `OnModuleDestroy`: `$disconnect()` đúng một lần; adapter sở hữu pool và đóng
  pool khi disconnect. Service không tạo `pg.Pool` riêng hoặc gọi `pool.end()`.
- `main.ts` bật shutdown hooks cho SIGTERM/SIGINT. Nếu startup thất bại, service
  cố gắng disconnect, bootstrap đóng Nest app đã tạo và kết thúc với exit khác 0.
  Lỗi cấu hình/kết nối/cleanup dùng thông báo không chứa URL/password hoặc lỗi
  driver nguyên bản. Không có retry loop.

Xem [NestJS lifecycle](https://docs.nestjs.com/fundamentals/lifecycle-events).
Endpoint mặc định vẫn trả `Hello World!`; API hiện yêu cầu runtime database
sẵn sàng khi startup.

Kiểm tra từ root (generate trước vì generated client không được commit):

```bash
pnpm --filter api db:generate
pnpm --filter api lint
pnpm --filter api typecheck
pnpm --filter api build
pnpm --filter api test
pnpm --filter api test:e2e
```

Unit tests mock Prisma Client/adapter để kiểm tra DI/export singleton,
runtime-only credentials, thiếu/sai URL, lifecycle và cleanup/error handling.
HTTP e2e test override PrismaService nên cũng không yêu cầu Docker/database.
Smoke verification riêng đã kiểm tra PostgreSQL thật, HTTP 200 trên port 3001,
pool được giải phóng khi SIGTERM, và startup thất bại rõ ràng khi URL thiếu hoặc
database không khả dụng. Không reset database hoặc thay đổi models/roles/Compose.

## Runtime environment configuration

NestJS dùng `@nestjs/config` và Zod, tập trung tại `src/config/`:

- `env.schema.ts`: schema và validation với thông báo lỗi không chứa đầu vào.
- `app.config.ts`: một factory namespace `app`, nạp root `.env` và validate trước
  khi PrismaService được tạo. AppConfigModule được import tường minh.
- PrismaService inject `ConfigType<typeof appConfig>`; các module khác có thể
  inject `ConfigService<AppConfiguration, true>` và lấy namespace `app` bằng
  `get('app', { infer: true })`. Không đọc `process.env` trong service nghiệp vụ.

| Runtime variable | Default | Validation |
| --- | --- | --- |
| `NODE_ENV` | `development` | `development`, `test`, `production` |
| `PORT` | `3001` | Integer 1–65535; biến environment dạng chuỗi được chuyển sang number |
| `DATABASE_URL` | Không có | PostgreSQL URL, role `shanflow_app`, database `shanflow`, schema `public` |

`DATABASE_URL` không được rỗng hoặc dùng bootstrap/migrator/shadow. Các query
parameters ghi đè user/database/host/port/password bị từ chối để tránh bỏ qua
kiểm tra URL. Password có ký tự đặc biệt phải được URL-encode như hướng dẫn trên.

Runtime không yêu cầu `DIRECT_DATABASE_URL`, `SHADOW_DATABASE_URL`, PostgreSQL
bootstrap password hoặc mật khẩu provisioning. Các biến đó chỉ dành cho
Prisma CLI/Docker/provisioning; schema runtime loại bỏ chúng khỏi config đã
validate. Không có JWT/OAuth hoặc biến cấu hình tính năng chưa triển khai.

Loader dùng đường dẫn dựa trên `import.meta.url`, chạy đúng từ root, `apps/api`,
`pnpm --filter api`, Nest watch mode và compiled build. Environment inject từ
hệ thống được ưu tiên hơn `.env`; defaults chỉ áp dụng khi biến chưa tồn tại,
không áp dụng cho giá trị rỗng hoặc sai. Không ghi lại hoặc overwrite `.env`.
Prisma CLI giữ loader/config riêng vì chạy trong process riêng; main.ts không
còn nạp dotenv lần thứ hai.

Development dùng root `.env` đã cấu hình runtime URL. Đổi port qua environment:

```bash
PORT=4100 pnpm --filter api dev
```

Production: inject `NODE_ENV=production`, `PORT` nếu cần và `DATABASE_URL` qua
secret/environment settings của deployment platform. Không mang theo `.env`
development; API runtime không cần migration/bootstrap credentials. Migration
command nhận `DIRECT_DATABASE_URL` riêng, không chạy trong HTTP startup.

Lỗi thường gặp:

- Thiếu/rỗng hoặc sai role/database của `DATABASE_URL`: startup bị từ chối trước
  khi tạo adapter/pool; sửa runtime URL, không dùng migration/bootstrap URL.
- `PORT` rỗng, số thập phân, ngoài phạm vi hoặc `NODE_ENV` không hợp lệ: sửa biến
  hoặc bỏ biến để dùng default; validation chỉ in tên biến và yêu cầu hợp lệ.
- URL hợp lệ nhưng PostgreSQL không khả dụng: startup vẫn thất bại qua Prisma
  lifecycle; không báo HTTP ready giả và không in driver error/connection string.

Unit tests kiểm tra schema/defaults/secret-safe errors, typed DI, validation
trước adapter và giữ nguyên lifecycle. HTTP e2e dùng environment test hợp lệ và
mock PrismaService; không phụ thuộc database thật.

## API health checks

HealthModule dùng PrismaModule/PrismaService singleton hiện có; không thêm client,
pool hoặc dependency health framework. Không có global API prefix.

| Endpoint | Mục đích | HTTP |
| --- | --- | --- |
| `GET /health/live` | HTTP server đang xử lý request; không query database | 200 |
| `GET /health/ready` | Runtime PostgreSQL connection sẵn sàng | 200 hoặc 503 |

```bash
curl -i http://localhost:3001/health/live
curl -i http://localhost:3001/health/ready
```

Thay port nếu runtime `PORT` được cấu hình khác. Liveness trả:

```json
{ "status": "ok" }
```

Readiness khi database up (HTTP 200):

```json
{ "status": "ok", "checks": { "database": "up" } }
```

Khi database lỗi, pool chờ lâu hoặc check hết hạn (HTTP 503):

```json
{ "status": "error", "checks": { "database": "down" } }
```

503 nghĩa là instance chưa sẵn sàng cho request phụ thuộc database, không nhất
thiết là HTTP server đã dừng. Sau khi API boot thành công, database mất kết nối
không làm liveness query database hoặc đổi response liveness. Lifecycle startup
vẫn yêu cầu PostgreSQL sẵn sàng như trước; `GET /` vẫn trả `Hello World!`.
Responses không chứa environment, credentials, SQL, host/port hoặc error stack.
Health service không log raw errors hoặc retry liên tục.

### Database check và timeout

Readiness mượn connection từ pool hiện có, chạy transaction READ ONLY, đặt
`SET LOCAL statement_timeout = '1500ms'`, rồi gọi tagged `$queryRaw` với `SELECT 1`.
Không có business writes, shadow connection hoặc migration credentials.
Local setting được PostgreSQL khôi phục khi transaction kết thúc; không thay
đổi cấu hình pool/role/database toàn ứng dụng.

Prisma transaction dùng `maxWait: 5000` và `timeout: 2500` milliseconds; response
HTTP có deadline 4000 milliseconds. `statement_timeout` hủy truy vấn phía
PostgreSQL khi server nhận được truy vấn. HTTP deadline không tự hủy SQL hoặc
khắc phục network stall: service giữ operation đang chạy cho đến khi nó settle,
các probe mới dùng chung kết quả thay vì tạo thêm query. Có tối đa một health
operation đang chạy trong mỗi process, kể cả sau khi HTTP đã trả 503.
Không có retry loop; check mới có thể chạy sau khi operation cũ hoàn tất.
Xem [Prisma 7 transaction options](https://www.prisma.io/docs/orm/v7/prisma-client/queries/transactions)
và [PostgreSQL statement timeout](https://www.postgresql.org/docs/18/runtime-config-client.html).

### Tích hợp probe

Dùng `/health/live` cho liveness probe của Docker/Kubernetes và `/health/ready`
cho readiness/load balancer để ngừng chuyển traffic đến instance chưa ready.
Đặt probe timeout lớn hơn deadline HTTP (ví dụ 5s) và chu kỳ hợp lý (ví dụ 10s),
có khoảng startup phù hợp. Không dùng database readiness failure làm lý do
restart HTTP server liên tục. Bước này chỉ tài liệu hóa; không sửa Compose hoặc
thêm Kubernetes/monitoring configuration.

Unit tests mock Prisma, kiểm tra coalescing, local timeout, HTTP deadline,
late rejection/recovery và response an toàn. HTTP e2e mock database để kiểm tra
200/503 mà không cần Docker. Smoke test riêng dùng PostgreSQL thật đã xác nhận
health endpoints, server hủy truy vấn đọc chậm bằng local timeout, readiness
phục hồi, timeout không leak sang lần dùng connection tiếp theo và schema không đổi.

## Authentication (Phase 3)

Đăng ký, đăng nhập (email/mật khẩu và Google), làm mới/thu hồi phiên, xác minh email, quên/đặt lại/đổi mật khẩu.
Thiết kế và bản ghi từng bước: [auth-architecture.md](docs/architecture/auth-architecture.md); đóng phase:
[phase-3-closure.md](docs/architecture/phase-3-closure.md).

Cấu hình thêm trong `.env` (xem `.env.example`): `JWT_ACCESS_SECRET` là **bắt buộc** (≥ 32 ký tự ngẫu nhiên, ví dụ
`openssl rand -base64 48`); `NEXT_PUBLIC_API_URL` cho web. Email mặc định in link ra log API (`MAIL_TRANSPORT=console`,
chỉ dùng local). Google sign-in tắt cho tới khi đặt đủ `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`.

Kiểm thử (cần PostgreSQL local đã provision cho bộ database):

```bash
pnpm test                       # contracts, API unit, web
pnpm --filter api test:db       # API + PostgreSQL thật (kể cả Google với provider giả lập)
pnpm --filter api test:e2e
```

Trang: `/register`, `/login`, `/forgot-password`, `/reset-password`, `/verify-email`, `/account`.
Luồng trình duyệt chưa có kiểm thử tự động trong repo; đã được chạy thủ công (xem các bản ghi triển khai).

### CI

`.github/workflows/ci.yml` chạy trên mọi pull request vào `develop`/`main` và mọi push vào hai nhánh này:

- `static`: cài đặt đóng băng lockfile, generate Prisma Client, lint, typecheck, unit test, build, `pnpm audit` (lỗi nếu có
  mức critical; báo cáo đầy đủ chỉ để tham khảo vì SEC-02 còn mở và không bị che giấu).
- `database`: PostgreSQL 18.6 (cùng image với `compose.yaml`), dựng roles/shadow bằng `scripts/ci/setup-database.sh`
  (dùng chính `scripts/db/provision-*.sql`), áp dụng migration lên database trống, kiểm tra không lệch schema và migration
  replay được trên shadow database, rồi chạy test database và e2e.

`scripts/ci/setup-database.sh` chỉ dành cho database trống/dùng một lần: từ chối host không phải local, từ chối ghi đè `.env`
ngoài CI và từ chối chạy khi roles đã tồn tại. Nên bật branch protection để yêu cầu cả hai job đạt trước khi merge.

