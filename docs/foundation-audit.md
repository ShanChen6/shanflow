# Shanflow — Foundation Integration Review

Ngày audit: 2026-10-12. Phạm vi: Prompt 1.6, Foundation 1.1–1.5.

## A. Executive Summary

**NOT READY FOR PHASE 2 theo security gate của prompt:** còn hai dependency
advisories High chưa xử lý, không có Critical advisory được phát hiện.
Functional foundation hoạt động: install có lockfile, root lint/typecheck/build,
Prisma validate/generate, 52 unit tests và 4 HTTP e2e tests đều pass.

Audit đã sửa lỗi isolation của unit test và áp dụng mysql2 security update cùng
major, giới hạn trong dependency của Prisma CLI. Không nâng major, reset DB,
tạo models/migrations, đổi roles/Compose/frontend, commit hoặc push.

Hai advisory còn lại nằm trong Prisma configuration và frontend lint tooling.
Code hiện tại không cung cấp HTTP input cho các API bị ảnh hưởng; audit không
chứng minh đường khai thác remote qua HTTP handlers hiện có. Tuy nhiên security
gate yêu cầu không để lại High findings chưa xử lý, nên chưa kết luận READY.

## B. Architecture Review

### Monorepo và frontend

- Workspace `apps/*`, `packages/*`; một pnpm lockfile; pnpm 11.18.0 được pin.
- Web/API không import source của nhau. Không phát hiện API source import cycle.
- Next.js 16.4, React 19.3, App Router, `src/`, Tailwind 4 qua PostCSS/Webpack,
  layout/page placeholder và TypeScript strict phù hợp Foundation.
- Frontend build không cần PostgreSQL. Web dùng TypeScript 5.9, API dùng 6.0
  tương ứng toolchain; không ép dùng chung compiler/config khi chưa cần.
- Root dev script cấu hình port 3000/3001. Port 3000 thuộc project khác trên
  host, nên không chạy root dev để tránh can thiệp process hiện hữu; cả hai
  workspace build và backend startup được kiểm tra riêng.

### NestJS, configuration và Prisma

- AppModule import configuration, Prisma và HealthModule tường minh. Providers
  không có request scope; DI tests xác nhận một PrismaClient instance.
- Runtime config factory validate trước adapter; typed namespace chỉ có
  NODE_ENV/PORT/DATABASE_URL. Runtime không yêu cầu migration/bootstrap secrets.
- Root .env path dựa trên import.meta.url; system environment được ưu tiên.
- Prisma CLI/Client/adapter đều 7.10.0, generator ESM và imports .js phù hợp
  NodeNext. Generated source được ignore, không có business models/migrations.
- Runtime dùng shanflow_app; CLI dùng shanflow_migrator; shadow URL parse/decode
  database path riêng. Read-only CLI assertion xác nhận thêm dbname/database
  query parameters không chuyển connection target ở phiên bản đã cài.
- Startup thực hiện connect và SELECT 1; lỗi cấu hình/kết nối không báo ready
  giả. Disconnect được giữ lại để không đóng pool hai lần. SIGTERM cleanup và
  startup failure đã được smoke test; không thấy pool leak trong các trường hợp
  đã chạy. Không suy rộng kết quả này thành bảo đảm cho mọi network fault.

### PostgreSQL

- Image postgres:18.6-bookworm, pg_isready TCP, named volume mount đúng layout
  PostgreSQL 18, publish 127.0.0.1:55432 trên host hiện tại.
- Cluster ID và volume creation time không đổi; audit không chạy down/up hoặc
  xóa volume. Persistence cycle đã được kiểm tra ở Foundation trước; audit này
  xác minh mount, PGDATA layout và cluster identity trên volume hiện hữu.
- Main database owner shanflow; public schema owner shanflow_migrator.
- App role có CONNECT/USAGE và default CRUD/sequence USAGE, không có database
  CREATE/TEMP/schema CREATE, không có memberships hoặc cluster admin flags.
- Migrator không SUPERUSER/CREATEDB/CREATEROLE; có CONNECT main/shadow và own
  shadow database. App role bị từ chối đăng nhập shadow; không CONNECT postgres
  hoặc template1. Default privileges áp dụng cho objects do migrator tạo.
- Hai provisioning reruns giữ nguyên main database OID/ownership/effective ACLs,
  role password fingerprints và shadow OID. Một số default-ACL catalog OIDs
  được PostgreSQL tạo lại bởi REVOKE/GRANT; grants hiệu lực không thay đổi.
- Provisioning chỉ dành cho dedicated development cluster, có scope thu hồi
  PUBLIC CONNECT trên cluster này; không phù hợp cluster production chia sẻ.

### Health timeout assessment

`statement_timeout=1500ms` < transaction timeout 2500ms là thứ tự hợp lý để server
hủy query và transaction có thời gian rollback. maxWait 5000ms áp dụng trước
transaction; HTTP deadline 4000ms là budget riêng, có thể trả 503 trước khi
transaction kết thúc. Đây là hành vi có chủ đích, không phải chứng cứ lỗi timeout.

Health service giữ shared operation sau HTTP timeout; không thêm health query
đến khi operation cũ settle. Nominal DB budget có thể khoảng 7.5s trước cleanup,
trong khi caller nhận 503 sau khoảng 4s. Unit test kiểm tra timeout/late rejection
và recovery; PostgreSQL smoke xác nhận server cancel query đọc chậm, rollback,
readiness phục hồi và statement_timeout không leak sang connection tiếp theo.
Không thay đổi timeout hoặc pool config trong audit vì chưa phát hiện lỗi cụ thể.

## C. Verification Matrix

| Kiểm tra đã thực sự chạy | Kết quả |
| --- | --- |
| pnpm install --frozen-lockfile --offline | Pass trước và sau security fix |
| pnpm lint | Pass cả web/API |
| pnpm typecheck | Pass cả web/API |
| pnpm build | Pass Next.js và NestJS |
| api db:validate / db:generate | Pass, Prisma 7.10.0 |
| api unit tests | 52 pass |
| Unit tests với PORT sai và NODE_ENV=staging từ shell | Tái hiện 1 failure; sau fix 52 pass |
| api HTTP E2E | 4 pass; mocks, không cần Docker |
| api db:check / Prisma CLI SELECT 1 | Pass, runtime/migration roles riêng |
| Compose config, role/schema/default ACLs, volume/host binding | Pass |
| Existing provisioning rerun hai lần | Không reset, không đổi credentials/effective permissions |
| Real root/liveness/readiness HTTP | 200, exact contract |
| Real slow-query timeout | 503, liveness 200, readiness hồi phục |
| Default/custom PORT, runtime-only configuration, invalid startup | Pass |
| SIGTERM/app.close pool cleanup | Pass; zero runtime connections sau kiểm tra |
| Local secret scan tracked/commit candidates, ignore rules, diff check | Pass |
| API source import cycles / pnpm peer dependencies | Không phát hiện issues |
| pnpm audit --json ban đầu | 3 High, 1 Moderate, 0 Critical |
| pnpm audit --json sau fix | 2 High, 0 Moderate, 0 Critical; exit khác 0 |

Unit/e2e suites không thay đổi dữ liệu thật. Smoke dùng truy vấn chỉ đọc; delayed
SQL chỉ được thay trong process kiểm thử, production source vẫn SELECT 1.
Không chạy migrate dev/deploy/reset hoặc tạo migration giả. Không kiểm tra lại
network partition dài hạn hoặc qualification trên Node 24 LTS; host audit dùng
Node 25.9.0. Secret scan không thay thế một forensic audit toàn bộ Git history.

## D. Findings

### SEC-01 — High — Open dependency advisory

- **Location:** pnpm-lock.yaml, prisma 7.10.0 → @prisma/config → deepmerge-ts 7.1.5.
- **Description:** installed version nằm trong vulnerable range <8.0.0 của
  [GHSA-ggr8-5vv4-36mx](https://github.com/advisories/GHSA-ggr8-5vv4-36mx).
- **Impact:** stack exhaustion khi merge recursive object graphs. Hiện được dùng
  bởi CLI config với source trusted; không thấy HTTP route gọi thư viện này với
  input của client. High là mức advisory/supply-chain gate, không phải xác nhận
  remote exploitation trên Shanflow.
- **Recommended fix:** review upstream Prisma release hoặc backport/override
  đã được kiểm chứng. Patched major 8 không được tự động áp dụng theo scope.
- **Fix status:** Open, cần review; còn được registry audit báo High.

### SEC-02 — High — Open dependency advisory

- **Location:** pnpm-lock.yaml, eslint-config-next → fast-glob/micromatch → braces 3.0.3.
- **Description:** deeply nested patterns có thể gây stack exhaustion theo
  [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm).
- **Impact:** frontend lint/tooling; hiện không có HTTP input đưa vào glob parser.
  Installed dependency vẫn vulnerable theo inventory gate.
- **Recommended fix:** dùng bản upstream patched đã phát hành hoặc review
  backport cụ thể. npm audit gợi ý >=3.0.4 nhưng registry query cho 3.0.4 trả
  “No matching version”; không thêm override đến version không tồn tại.
- **Fix status:** Open, cần review; còn được registry audit báo High.

### SEC-03 — High — Fixed narrow dependency advisory

- **Location:** pnpm-workspace.yaml:5, pnpm-lock.yaml; prisma → mysql2.
- **Description:** mysql2 3.15.3 có auth downgrade/plaintext-password advisory
  [GHSA-3f6p-5ww8-9rcr](https://github.com/advisories/GHSA-3f6p-5ww8-9rcr), cùng
  compressed-protocol Moderate advisory
  [GHSA-rgwj-5xj2-c3m3](https://github.com/advisories/GHSA-rgwj-5xj2-c3m3).
- **Impact:** MySQL CLI driver; Shanflow hiện chỉ dùng PostgreSQL. Không phát
  hiện MySQL connection path trong ứng dụng.
- **Recommended fix:** scoped same-major update, không đổi Prisma version.
- **Fix status:** Fixed bằng prisma@7.10.0>mysql2:3.23.1. Cả hai advisories đã
  biến mất khỏi audit; install, CLI validate/generate/connectivity, builds/tests pass.

### TEST-01 — Medium — Fixed test isolation defect

- **Location:** apps/api/src/database/prisma.service.spec.ts:32.
- **Description:** DI test chỉ stub DATABASE_URL; ambient PORT/NODE_ENV vẫn đi
  vào config factory. PORT=not-a-number tái hiện 1 failure trong 52 tests.
- **Impact:** unit suite phụ thuộc shell/.env ngoài test; có thể fail dù code đúng.
- **Recommended fix:** stub đầy đủ runtime environment và restore sau test.
- **Fix status:** Fixed NODE_ENV=test, PORT=3001; suite pass cả khi shell có
  PORT sai và NODE_ENV=staging. Runtime validation không bị nới lỏng.

### DOC-01 — Low — Fixed onboarding order ambiguity

- **Location:** README.md, first-time local setup.
- **Description:** prerequisites/environment/roles/client-generation được mô tả
  rải rác; developer có thể chạy root checks trước khi generate ignored client.
- **Impact:** clone mới có thể gặp missing generated imports hoặc thiếu CLI URL.
- **Recommended fix:** thêm thứ tự install → env → postgres → roles → generate
  → checks → apps/health; giữ hướng dẫn cũ chi tiết.
- **Fix status:** Fixed bằng quickstart và ghi chú generate trước checks/tests.

## E. Changes Made

Chỉ các thay đổi sau thuộc lượt audit này; các thay đổi chưa commit từ Foundation
trước được giữ nguyên, không được tính thành fixes mới của audit:

1. prisma.service.spec.ts: stub NODE_ENV/PORT để sửa isolation defect đã tái hiện.
2. pnpm-workspace.yaml: scoped mysql2 3.23.1 security override, cùng major.
3. pnpm-lock.yaml: resolution tương ứng, không nâng Prisma/Nest/Next major.
4. README.md: first-time setup sequence và generate prerequisite rõ ràng.
5. docs/foundation-audit.md: báo cáo audit này.

Không sửa API contract, health timeouts, module architecture, DB roles, Compose,
schema, migrations, frontend UI hoặc .env local. Không thêm infrastructure.

## F. Remaining Risks và recommendations

- SEC-01/SEC-02 vẫn mở; review dependency remediation trước khi thông qua gate.
- Runtime/CLI validators pin role/database/schema names. Convention này đang
  phù hợp dedicated deployment; staging/production với tên khác cần thiết kế
  configuration policy riêng. Đây là recommendation, không phải lỗi hiện tại;
  không tự động nới lỏng role/shadow guards.
- Network blackhole/late transaction acquisition chưa được fault-injection test.
  Shared check giới hạn health workload trong application layer, nhưng HTTP
  deadline không bảo đảm hủy mọi driver/network activity. Cần qualification
  trước production; chưa phát hiện known leak trong các scenarios đã kiểm tra.
- Development Compose/provisioning không phải production deployment. Node 24
  LTS là runtime được README khuyến nghị; kết quả audit trên Node 25 không thay
  thế qualification trên LTS hoặc môi trường production đích.
- Git working tree có các thay đổi Foundation chưa commit. Secret/artifact
  ignore checks pass; cần review diff trước commit. Audit không stage/commit/push.

## G. Foundation Readiness

**NOT READY FOR PHASE 2.**

Functional gates pass. Blockers theo security acceptance criteria: SEC-01 và
SEC-02 còn High và chưa có remediation/review disposition được chấp thuận.
Không phát hiện Critical finding hoặc broken runtime integration trong phạm vi
code, configurations và tests đã audit.

## H. Recommended Next Step

Review hai dependency findings cùng reachability thực tế của tooling; quyết định
upstream fix/backport phù hợp hoặc security disposition rõ ràng. Không tự nâng
major dependencies để làm audit output xanh. Sau khi xử lý gate, chạy lại các
checks và cập nhật readiness, rồi mới chuyển Phase 2 Domain Analysis & Database
Design. Chưa triển khai Phase 2 hoặc business features.
