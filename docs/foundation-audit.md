# Shanflow — Foundation Integration Review

Ngày audit: 2026-10-12. Phạm vi: Prompt 1.6, Foundation 1.1–1.5.

**Trạng thái hiện tại sau Prompt 1.6B (2026-10-12):** Functional Foundation:
**PASS**; Security Findings: **2 HIGH OPEN**; Domain Design Authorization:
**CONDITIONALLY APPROVED**; Production Release Authorization: **NOT APPROVED**.
Xem [RA-001](security/risk-acceptance-001.md) và mục J. Các kết luận gate trong
mục A–I bên dưới giữ nguyên như lịch sử tại thời điểm audit, trước RA-001.

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

## I. Prompt 1.6A — Dependency Security Remediation Addendum

Ngày kiểm tra lại: 2026-10-12. Các mục A–H giữ nguyên như lịch sử Prompt 1.6;
trạng thái mới nhất của SEC-01/SEC-02 được ghi dưới đây. Working tree sạch khi
bắt đầu lượt này, khác với trạng thái chưa commit được ghi trong audit trước.

### Executive summary và decision

Hai findings vẫn **Open / High**. Đã truy cập registry và advisories chính thức,
kiểm tra dependency graph, phiên bản cha, source của tooling, production traces
và chạy lại regression checks. Chưa tìm được bản vá patch/minor hoặc cập nhật
cha cùng major giải quyết findings. Không áp dụng dependency update vô ích,
override chưa kiểm chứng, audit ignore hoặc sửa node_modules.

SEC-01 có bản vá ở major 8 với breaking changes; theo giới hạn của Prompt 1.6A,
chỉ trình bày phương án, chưa thực hiện nâng major. SEC-02 chưa có fixed release
trên registry. Chưa có quyết định chấp nhận rủi ro được phê duyệt.

### Verified dependency chains

```text
api devDependency prisma@7.10.0
  → @prisma/config@7.10.0 → deepmerge-ts@7.1.5
api dependency @prisma/client@7.10.0
  → prisma@7.10.0 (resolved optional peer)
    → @prisma/config@7.10.0 → deepmerge-ts@7.1.5

web devDependency eslint-config-next@16.4.0
  → @next/eslint-plugin-next@16.4.0 → fast-glob@3.3.1
    → micromatch@4.0.8 → braces@3.0.3
```

`pnpm why ... -r` và pnpm-lock.yaml đồng nhất; mỗi affected package có một
resolved version. Không package nào là direct dependency của workspace.

### SEC-01 — deepmerge-ts / GHSA-ggr8-5vv4-36mx

- **Advisory severity:** High; affected `<8.0.0`, patched `8.0.0` trở lên theo
  [GitHub advisory](https://github.com/advisories/GHSA-ggr8-5vv4-36mx).
- **Available fixes:** registry có 7.1.6 và 8.0.0/8.0.1/8.0.2. 7.1.6 vẫn thuộc
  affected range; [release 7.1.6](https://github.com/RebeccaStevens/deepmerge-ts/releases/tag/v7.1.6)
  chỉ sửa typing của object keys, không phải security backport. Stable Prisma 7
  và @prisma/config 7 mới nhất được registry trả về là 7.10.0;
  @prisma/config@7.10.0 pin chính xác deepmerge-ts 7.1.5.
- **Classification:** Prisma CLI/config tooling trong development và generation;
  cũng hiện diện trong production dependency graph qua optional peer của Client.
  `pnpm audit --prod --json` vẫn trả về một High của deepmerge-ts. Không được
  kết luận đây chỉ là devDependency hoặc production install chắc chắn loại bỏ nó.
- **Reachability:** @prisma/config/dist/index.js tải deepmerge động và truyền nó
  vào c12 làm config merger. prisma.config.ts hiện export object cấu hình đơn
  giản, không tạo cyclic graph và không nhận HTTP request. PrismaService import
  generated client/runtime và adapter-pg, không import Prisma CLI config.
  Node module-resolution trace khi tạo Nest app, init Prisma và chạy readiness
  thật ghi nhận 987 resolved modules, không nạp @prisma/config/deepmerge-ts/braces.
  Đây là bằng chứng cho startup và health path hiện tại, không chứng minh mọi
  đường chạy tương lai hoặc deployment artifact chưa được thiết kế.
- **Exploit prerequisite:** attacker-controlled cyclic object graphs được đưa
  vào merge API; JSON thuần không biểu diễn được điều kiện cyclic này. Chưa xác
  định đường HTTP tới sink trong code hiện tại. Config/plugins không đáng tin
  cậy hoặc integration mới có thể thay đổi kết luận.
- **Compatibility:** [release 8](https://github.com/RebeccaStevens/deepmerge-ts/releases/tag/v8.0.0)
  thay đổi cách merge Maps và một số API/types. 8.0.2 hỗ trợ Node >=16.9.0 và
  ESM/CJS, nhưng engine/export phù hợp chưa chứng minh compatibility với c12
  và Prisma. Chưa thử major override trong repository, chưa xác nhận an toàn.
- **Disposition:** Open / High. Không nâng 7.1.6 vì không sửa finding; không ép
  major 8 khi chưa được phê duyệt và kiểm chứng.

### SEC-02 — braces / GHSA-vfj7-8cjw-p6xm

- **Advisory severity:** High, affected `<=3.0.3`; [GitHub advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)
  ghi patched versions **None**. Audit registry ghi `>=3.0.4`, nhưng
  `pnpm view braces@3.0.4 version` trả ERR_PNPM_PACKAGE_NOT_FOUND và danh sách
  published versions kết thúc ở 3.0.3. Không dùng metadata này làm bằng chứng
  rằng bản vá có thể cài được.
- **Parent candidates:** latest stable eslint-config-next 16 và plugin 16 vẫn
  16.4.0, plugin pin fast-glob 3.3.1. fast-glob 3.3.3 đã phát hành nhưng vẫn
  phụ thuộc micromatch ^4.0.8; latest micromatch 4.0.8 vẫn dùng braces ^3.0.3.
  Cập nhật riêng fast-glob không loại bỏ finding.
- **Upstream:** [issue #70](https://github.com/micromatch/braces/issues/70) còn
  Open; maintainer phản đối đánh giá exploitability. Chưa xác minh được fixed
  release/backport chính thức phù hợp. Tranh luận không thay thế advisory hoặc
  quyết định risk acceptance; giữ High và không suppress audit.
- **Classification/reachability:** frontend lint tooling, absent trong prod
  audit. Plugin get-root-dirs.js gọi fast-glob.globSync cho settings.next.rootDir;
  eslint.config.mjs hiện không đặt rootDir glob, nên helper dùng context.cwd.
  Không có HTTP input vào lint settings. Đây không phải exhaustive sink analysis
  của mọi ESLint plugin. Không tìm thấy affected package references trong JS của
  apps/api/dist hoặc apps/web/.next/server; ba Next server .nft.json manifests
  cũng không chứa tooling trên. Manifest/source inspection không thay thế audit
  deployment production đầy đủ, và không đánh giá vendored code ngoài lockfile.
- **Exploit prerequisite:** brace patterns có độ lồng sâu được chuyển tới
  recursive AST walkers, có thể gây stack exhaustion. Input-length limit đơn
  thuần chưa được kiểm chứng là mitigation đủ cho advisory này.
- **Disposition:** Open / High; không có published compatible fix đã xác minh.

### Changes made và compensating controls

Chỉ bổ sung mục I vào docs/foundation-audit.md. Không đổi package manifests,
pnpm-workspace.yaml, lockfile hoặc source ứng dụng. Override mysql2 từ SEC-03
được giữ nguyên, không mở rộng phạm vi. Không thực hiện migrations, provisioning,
reset volume, thay roles/schema, commit hoặc push. Generated client/build outputs
được tái tạo qua scripts hiện hữu và vẫn được Git ignore.

Controls hiện có: config được quản lý trong repository; runtime dùng Client và
pg adapter; HTTP handlers không chuyển input sang tooling; ESLint dùng config
cố định. Khuyến nghị tiếp tục review mọi thay đổi Prisma config/rootDir globs,
không chạy config/plugins không đáng tin cậy với credentials, và tách tooling
khỏi runtime artifact khi thiết kế deployment. Đây là giảm exposure, không phải
security patch, và deployment isolation chưa được triển khai ở bước này.

### Regression verification

| Check | Result |
| --- | --- |
| pnpm install --frozen-lockfile | PASS; lockfile unchanged; no peer/resolution warnings |
| pnpm --filter api db:validate | PASS |
| pnpm --filter api db:generate | PASS; client 7.10.0, no business models |
| pnpm lint | PASS, 0 errors; existing import/no-anonymous-default-export warning in web/postcss.config.mjs |
| pnpm typecheck | PASS, API and web |
| pnpm build | PASS, Nest and Next Webpack/static pages |
| pnpm --filter api test | PASS, 52/52 |
| pnpm --filter api test:e2e | PASS, 4/4; mocked DB as designed |
| Real Nest init + read-only readiness + close | PASS; readiness ok; affected tooling not resolved in traced path |
| Next server traces | 3 manifests checked; no affected tooling references |
| Final pnpm audit --json | 2 High, 0 Critical/Moderate/Low |
| pnpm audit --prod --json | 1 High, deepmerge-ts through optional Prisma peer |
| Git hygiene | Root/app env and generated client ignored; only documentation diff |

Verification dùng Node 25.9.0/pnpm 11.18.0 như audit trước. Không có dependency
update nên không có compatibility regression mới cần kiểm tra; install không
báo peer conflict nhưng chưa thực hiện independent exhaustive peer validation.
Unit/E2E success không chứng minh patched behavior vì chưa áp dụng bản vá.
Runtime trace chỉ chạy init và health read-only, không có DDL hoặc role SQL.

### Residual risk, readiness và concrete next-step proposal

Hai advisories tiếp tục là blockers. Project-specific HTTP exposure hiện chưa
được chứng minh; tooling crash/availability risk vẫn còn nếu input/config policy
thay đổi. Không hạ advisory severity do dev classification, không định lượng
residual risk là Low khi thiếu production artifact/sink analysis đầy đủ.

**NOT READY FOR PHASE 2.** Chưa có approval cho High risk acceptance.

Phương án cần review trước khi thực hiện:

1. SEC-01: ưu tiên upstream Prisma 7 update/backport có patched deepmerge được
   hỗ trợ. Nếu cần giải quyết trước upstream, xin phê duyệt đánh giá major
   transitive override giới hạn `@prisma/config@7.10.0>deepmerge-ts: 8.0.2`.
   Chỉ áp dụng sau khi so sánh config merger semantics (objects/arrays/Maps),
   cyclic-input regression và validate/generate trên config fixture riêng;
   không chạy migrate dev/reset trên DB hiện hữu. Chạy toàn bộ checks và audit,
   rollback workspace override/lockfile nếu compatibility không đạt. Chưa áp
   dụng override này hoặc khẳng định tương thích.
2. SEC-02: theo dõi fixed braces release hoặc parent release loại bỏ dependency;
   kiểm tra publish thực tế trước khi pin. Custom patch/thay lint stack cần
   đánh giá riêng và không được tự thực hiện trong lượt này.
3. Nếu cần tiếp tục trước khi có fix, security owner phải phê duyệt risk
   acceptance theo từng ID, phạm vi, controls, thời hạn và điều kiện review lại.
   Addendum này không phải approval. Sau remediation/disposition, chạy audit và
   regression lại rồi cập nhật gate. Không triển khai Phase 2 trong Prompt 1.6A.

## J. Prompt 1.6B — Conditional Security Risk Acceptance

Ngày ghi nhận: **2026-10-12**. Project Owner cung cấp quyết định
**Conditional Risk Acceptance — Development and Domain Design Only** trong
cuộc trao đổi qua Prompt 1.6B. Đây không phải approval của tổ chức bảo mật độc
lập; không thêm tên người phê duyệt hoặc chữ ký suy diễn.

Record: [RA-001 — Conditionally Accepted for Domain Design](security/risk-acceptance-001.md).
Implementation owner: Development Team. Initial review deadline:
**2026-11-11** (30 ngày); review ngay nếu có trigger, không tự đóng findings
hoặc mở production gate khi tới hạn.

| Gate | Current status |
| --- | --- |
| Functional Foundation | PASS |
| Security Findings | 2 HIGH OPEN |
| Domain Design Authorization | CONDITIONALLY APPROVED |
| Production Release Authorization | NOT APPROVED |

**Phase 2.1 — Domain Analysis & ERD được phép bắt đầu có điều kiện.** Quyền này
giới hạn domain/requirement analysis, ERD, schema proposals, documentation và
non-destructive local verification. Implementation cần review phạm vi/rủi ro
riêng. Không cấp quyền production deployment, public release, tự áp dụng
migrations, đổi permissions/infrastructure hoặc bỏ qua security checks.

SEC-01 (deepmerge-ts@7.1.5, GHSA-ggr8-5vv4-36mx) và SEC-02 (braces@3.0.3,
GHSA-vfj7-8cjw-p6xm) vẫn **Open / High**. Risk acceptance không khắc phục
dependency, không hạ severity và không thay thế remediation. Exposure đã biết,
giới hạn verification, residual risks và controls được ghi riêng cho mỗi finding
trong RA-001. Production security gate vẫn chưa đạt; Foundation không được coi
là hoàn toàn security-ready.

Verification lượt 1.6B: fresh `pnpm audit --json` xác nhận đúng hai High IDs,
0 Critical/Moderate/Low; metadata/deadline (30 ngày), scopes, cross-references và
`git diff --check` pass. Functional PASS kế thừa verification 1.6/1.6A; không
chạy lại build/tests hoặc DB checks cho thay đổi chỉ gồm tài liệu.

Chỉ tạo docs/security/risk-acceptance-001.md và cập nhật tài liệu audit này;
giữ nguyên lịch sử, code, dependencies, lockfile, schema, Compose và database.
Không commit/push hoặc bắt đầu Phase 2 trong lượt này. Bước tiếp theo được phép
là Phase 2.1 theo điều kiện RA-001 khi có yêu cầu triển khai riêng; Development
Team tiếp tục theo dõi fixes và review controls/triggers tới deadline.

## K. Prompt 2.1C — Local Development Authorization Proposal

Ngày lập: 2026-10-12. [IA-001 — Local Development Implementation Proposal](security/local-development-authorization.md)
có trạng thái **PENDING OWNER APPROVAL**. Prompt 2.1C chỉ yêu cầu chuẩn bị hồ sơ,
không có xác nhận riêng cho implementation; không tự mở rộng RA-001 design-only.

Domain Design: **READY** theo 11 ADR/Design Freeze; Local Implementation
Authorization: **PENDING OWNER APPROVAL**; Production Release: **NOT APPROVED**.
SEC-01 và SEC-02 vẫn **High/Open**; không sửa severity, findings hoặc lịch sử audit.
IA-001 đề xuất local modeling/migrations/verification sau approval, kèm isolation,
SQL review/recovery controls; không cấp quyền staging/production hoặc destructive
operations ngoài review. Không thực hiện implementation trong lượt này.


## L. Prompt 2.1D — IA-001 Approval Recorded

Ngày approval: **2026-10-12**. Project Owner xác nhận rõ trong ChatGPT conversation
(Prompt 2.1D): phê duyệt IA-001 cho Local Development Implementation theo phạm vi
và giới hạn hồ sơ. [IA-001](security/local-development-authorization.md) hiện
**APPROVED FOR LOCAL DEVELOPMENT**; không suy diễn tên người duyệt/chữ ký.

Quyền local bao gồm modeling/models, migration SQL review/apply trên target local
đã xác minh, constraints/indexes, validate/generate và integration/disposable DB
verification. NestJS modules theo bước được duyệt tiếp theo; không tự triển khai
Phase 2.2 trong lượt record approval. Preflight target/runtime-migrator roles,
review SQL/destructive operations, verification/recovery controls vẫn bắt buộc.

SEC-01/SEC-02 vẫn **HIGH / OPEN**; severity/kết quả audit không đổi. Production
Release và Staging Release đều **NOT APPROVED**, không production-ready. RA-001
scope/lịch sử/deadline giữ nguyên; IA-001 là local authorization record riêng.
Mục K pending là lịch sử 2.1C, được supersede ở gate hiện tại bởi approval này.
Không models/migrations/DB/source/dependency changes hoặc commit/push ở 2.1D.
