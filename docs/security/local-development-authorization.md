# IA-001 — Local Development Implementation Authorization

## A. Metadata

| Field | Value |
| --- | --- |
| Record ID | IA-001 |
| Project | Shanflow |
| Status | **APPROVED FOR LOCAL DEVELOPMENT** |
| Approved scope | Local Development Implementation |
| Decision authority | Project Owner |
| Proposal date | 2026-10-12 (Asia/Ho_Chi_Minh) |
| Implementation owner | Development Team |
| Approval authority | Project Owner |
| Approval decision | Approved |
| Approval date | 2026-10-12 (Asia/Ho_Chi_Minh) |
| Approval source | Explicit Project Owner confirmation in ChatGPT conversation (Prompt 2.1D) |
| Production authorization | NOT APPROVED |
| Staging authorization | NOT APPROVED |

Project Owner xác nhận riêng trong Prompt 2.1D:

> Tôi, với vai trò Project Owner, phê duyệt IA-001 cho Local Development Implementation theo phạm vi và giới hạn đã ghi trong hồ sơ.

Đây là explicit approval, không suy diễn từ yêu cầu lập hồ sơ 2.1C. Không thêm chữ
ký/tên người duyệt. [RA-001](risk-acceptance-001.md) giữ nguyên design-only decision
và lịch sử; IA-001 ghi riêng quyền local implementation cùng các controls bên dưới,
không production/staging approval hoặc tuyên bố findings đã được khắc phục.

Baseline: [Foundation audit](../foundation-audit.md),
[11 ADR và Design Freeze](../architecture/data-decisions.md#phase-21-mvp-domain-design-freeze),
[Domain](../architecture/domain-analysis.md), [ERD](../architecture/erd.md),
[Authorization matrix](../architecture/authorization-matrix.md).

## B. Approved Implementation Scope — Local Development Only

1. Prisma schema modeling.
2. Tạo Prisma models theo Design Freeze: User, Workspace, WorkspaceMember,
   Project, Task; Inbox/soft-delete/instant deadline/BigInt lane ordering và owner invariants.
3. Tạo local PostgreSQL migrations.
4. Review migration SQL gồm Prisma-generated SQL và manual supplement.
5. Apply migrations trên local development database **đã xác minh** target/roles/environment.
6. Triển khai database constraints và indexes cần thiết theo ADR/blueprint.
7. Prisma schema validation.
8. Prisma Client generation.
9. Database integration tests.
10. Verification/migration qualification trên disposable local database.
11. NestJS modules trong các bước được phê duyệt tiếp theo.

IA-001 là quyền local theo phạm vi/giới hạn đã ghi, không instruction tự triển khai
mọi Phase 2.2. Task implementation tiếp theo cần scope cụ thể và tuân preflight/
SQL review/recovery controls; không xin lại approval IA-001 chỉ vì bắt đầu hoạt
động đã nằm trong scope này. Auth supporting implementation, full APIs/team features
và NestJS modules vẫn theo các bước được duyệt tiếp theo; không tự mở rộng core scope.
Scope amendment cần ghi lý do và migration impact nếu khác Design Freeze.

Prompt 2.1D chỉ record approval; không tạo models/migrations hoặc execute commands.

## C. Restricted Activities

- Không production deployment/public release; staging cũng cần approval riêng.
- Không reset/drop database hoặc xóa/prune volume đang giữ dữ liệu; không chấp
  nhận Prisma reset prompt như thao tác sửa drift mặc định.
- Không destructive migration chưa review cụ thể; local envelope không tự cấp
  quyền DROP/TRUNCATE/data rewrite phá hủy. Cần review/recovery plan và quyết định riêng.
- Không đổi database roles/passwords/permissions/ownership ngoài scope được duyệt;
  không nâng runtime/migrator thành superuser hoặc thay bootstrap credentials.
- Không disable/ignore dependency audit, bỏ qua SEC-01/SEC-02 hoặc hạ severity.
- Không commit secrets hoặc dùng production credentials trong local verification.
- Không major dependency upgrade chưa review/approve; không tự đổi ORM/stack.
- Không commit/push hoặc thay Compose/source trong lượt documentation-only 2.1D.

## D. Environment Isolation — preflight bắt buộc cho task implementation sau

| Boundary | Documented local target / requirement |
| --- | --- |
| PostgreSQL instance | Compose project shanflow, service postgres, pinned postgres:18.6-bookworm, host 127.0.0.1; default configured host port 5432, README/audit local port 55432 |
| Persistent storage | Compose named postgres_data → shanflow_postgres_data theo project; không down -v/prune/reset volume |
| Primary database | shanflow; schema public; xác nhận connection identity và target trước bất kỳ DDL |
| Runtime role | shanflow_app; DATABASE_URL; không bootstrap/migration URL fallback |
| Migration role | shanflow_migrator; DIRECT_DATABASE_URL; giữ least privilege hiện hữu |
| Shadow database | shanflow_shadow qua SHADOW_DATABASE_URL, riêng primary và chỉ migration role; không chứa dữ liệu cần giữ |
| Bootstrap | shanflow chỉ quản trị/provisioning riêng đã review; không runtime và không default migration connection |

Các targets là cấu hình/tài liệu hiện hữu, không fresh DB verification trong 2.1C.
Sau approval, preflight phải xác minh host/port/instance/database/schema/current_user,
named volume và ownership bằng read-only checks an toàn, không log URL/password.
Không suy đoán local chỉ từ tên database; không dùng connection không xác định hoặc
production/staging endpoint. Nếu lệch targets/roles hoặc không chứng minh isolation,
dừng dependent DDL để review; không tự sửa roles/config hoặc reset để làm checks pass.

Root .env được Git ignore; .env.example chỉ templates. Runtime chỉ nhận
DATABASE_URL + runtime config; CLI dùng DIRECT_DATABASE_URL/SHADOW_DATABASE_URL;
POSTGRES_PASSWORD và POSTGRES_APP_PASSWORD/POSTGRES_MIGRATOR_PASSWORD dành cho
Compose/provisioning. Không copy production secrets, print credential values hoặc
đưa connection strings vào record/logs/command history.

Prisma config hiện guard tên primary/shadow/role. Disposable verification không
được bypass guards hoặc trỏ shadow vào primary. Ưu tiên instance local tách biệt
có cùng logical names, port/volume riêng; setup/provisioning disposable environment
phải nằm trong task được duyệt sau, không đụng cluster/roles/volume hiện hữu. Không
tự tạo disposable DB hoặc đổi Compose trong lượt 2.1C. Nếu dùng existing local
primary chứa dữ liệu cần giữ, review data inventory/backup trước apply.

## E. Migration Safety Requirements — Conditions of Approval

1. Review từng migration SQL trước apply, bao gồm generated và manual statements,
   constraints/index predicates, referential actions và data transformation. Ưu tiên
   additive; không silent-drop guard để Prisma schema compile.
2. Tách generation/review/apply; migrate dev --create-only vẫn có thể dùng/reset
   shadow hoặc hỏi reset primary khi drift. Không coi create-only là vô hại; khi
   có reset/drift prompt dừng và đánh giá, không tự confirm hoặc migrate reset.
3. Validate exact environment/role trước apply. Không automatic migrations trong
   API startup; không deploy/reset từ runtime role; không provision permissions
   như tác dụng phụ để migration pass.
4. Verify trên disposable local environment trước apply vào primary cần giữ:
   FK cross-workspace, nullable Inbox, two live-lane unique guards, soft-delete/
   restore, completedAt CHECK, owner limits và concurrent operations. DB checks
   phải xét tombstones/history và migration drift, không chỉ schema/client compile.
5. Review lock duration/backfill/unique conflicts và feasibility trên pinned Prisma
   7.10.0/PostgreSQL 18.6; partial-index support/Preview hoặc SQL supplement cần
   đánh giá rõ. Bounded concurrency retries không thay strict DB guards.
6. Recovery plan per migration: ưu tiên reviewed forward fix cho additive changes;
   trước data-loss/change có backup/snapshot và restore rehearsal trên disposable
   environment khi phù hợp. PostgreSQL transaction rollback chỉ áp dụng statements
   đã chứng minh transactional; không giả định Prisma có automatic down migration
   hoặc mọi DDL tự rollback. Record applied state, verification và recovery evidence.
7. Sau apply: verify migration history/schema constraints/indexes, preserved data,
   role isolation, runtime connection/health và integration tests phù hợp. Không
   xóa/rewrite applied migration history để che lỗi; recovery trên DB cần giữ cần
   review riêng. Cleanup disposable resources chỉ sau xác nhận đúng ownership/scope.

Những controls này là điều kiện của approval cho task implementation tiếp theo,
chưa được execute/verify ở 2.1D. Trước apply phải xác minh target, roles/environment,
review SQL/destructive operations, có verification và recovery strategy phù hợp.
Ưu tiên additive/small migrations; không prisma db push thay migration history.
Không chạy migration commands, SQL hoặc backup/reset trong lượt documentation này.

## F. Security Risk Controls

| Finding | Current recorded status | Local residual risk |
| --- | --- | --- |
| SEC-01, deepmerge-ts@7.1.5, GHSA-ggr8-5vv4-36mx | **High / Open** | Prisma config/tooling có thể stack-exhaustion với crafted cyclic graphs; production dependency inventory cũng có optional peer path |
| SEC-02, braces@3.0.3, GHSA-vfj7-8cjw-p6xm | **High / Open** | Lint/glob tooling có thể gặp deeply nested pattern DoS; không khẳng định devDependency an toàn |

Status kế thừa audit/RA-001; 2.1C không rerun audit hoặc xác minh patch availability.
Không có bằng chứng HTTP exploitation hiện tại không loại bỏ tooling residual risk.
Local approval 2.1D không sửa findings, hạ severity hoặc mở production/staging gate.

Conditions: dùng trusted repository/configuration/plugins và reviewed inputs; giữ
controlled lockfile, frozen-lockfile verification và audit trong dependency review/
implementation verification. Không suppress để output xanh; unexpected findings
được review/disposition, không tự coi IA-001 bao phủ findings mới. Có compatible
fix phải reassess/remediate theo compatibility review. RA-001 deadline **2026-11-11**
và triggers giữ nguyên; không tự gia hạn qua approval IA-001. Chưa có automatic
monitoring/CI hoặc enforcement mới được tạo trong proposal này.

## G. Approval Gate & Evidence

| State | Evidence / effect |
| --- | --- |
| PENDING OWNER APPROVAL — historical 2.1C | Proposal 2026-10-12, chưa có approval khi lập; chỉ design theo RA-001 |
| **APPROVED FOR LOCAL DEVELOPMENT — current 2.1D** | Explicit Project Owner confirmation in ChatGPT conversation, 2026-10-12; local scope B + restrictions/controls C–F; staging/production NOT APPROVED |

Yêu cầu tạo proposal/Design READY/silence không phải approval. State được đổi bởi
xác nhận riêng đã trích ở A, không bởi inference. Không chữ ký/thông tin cá nhân
suy diễn, không tổ chức security approval độc lập.

Readiness/audit cập nhật theo evidence 2.1D. RA-001 vẫn design-only historical
acceptance; IA-001 current record bổ sung local authorization riêng. Không blanket
Auth/team/staging/production scope hoặc automatic Phase 2.2 execution. Khi task nằm
ngoài approved scope hoặc controls không đáp ứng, review phần đó thay vì suy rộng.

## H. Reassessment Triggers

Review ngay nếu có dependency security fix; major upgrade; DB environment/port/
instance/roles/volume đổi; chuẩn bị staging/production; scope implementation đổi;
destructive migration; finding mới nghiêm trọng hoặc exploit/exposure evidence.
Inherited RA-001 triggers/deadline vẫn áp dụng. Dừng dependent risky operation tới
khi target/scope/disposition được review, không tự mở rộng authorization hoặc
coi approval local là production risk acceptance hoặc remediation.

## I. Current Readiness & Documentation Verification

| Dimension | Status |
| --- | --- |
| Domain Design | READY (11 ADR + Design Freeze) |
| Local Implementation Authorization | **APPROVED FOR LOCAL DEVELOPMENT** |
| Prisma Modeling | AUTHORIZED FOR LOCAL DEVELOPMENT |
| Migrations | AUTHORIZED FOR VERIFIED LOCAL DATABASE ONLY |
| Staging Release | **NOT APPROVED** |
| Production Release | **NOT APPROVED** |
| Security Findings | **SEC-01/SEC-02 High/Open** |

Verification 2.1C: required proposal sections, pending state, local-only scope và
restrictions, Markdown links và git diff --check. RA-001, 11 ADRs và Design Freeze
giữ nguyên; audit history chỉ append IA-001 reference. Không build/tests, DB commands,
models/migrations/source/dependency changes, commit/push hoặc Phase 2.2.

## J. Decision History & Verification — Prompt 2.1D

- 2026-10-12, 2.1C: proposal IA-001 PENDING OWNER APPROVAL, no implementation authority.
- 2026-10-12, 2.1D: Project Owner explicitly approves IA-001 for local development
  theo scope/limits; current metadata, gate và readiness cập nhật. Staging/production
  vẫn NOT APPROVED, SEC-01/SEC-02 vẫn HIGH/OPEN.

Verification 2.1D: approval quote/source/date/scope, links, four-document-only diff,
RA-001 và 11 ADR/Design Freeze unchanged, blueprint/migration sequence unchanged;
git diff --check pass. Không fresh dependency audit/DB verification, build/tests,
models/migrations/database/source/dependency changes, commit/push hoặc Prompt 2.2B.
Historical verification 2.1C phía trên giữ lại theo ngày thực hiện, không current gate.
