# RA-001 — Conditional Security Risk Acceptance

## A. Record Metadata

| Field | Value |
| --- | --- |
| Record ID | RA-001 |
| Project | Shanflow |
| Decision | Conditional Risk Acceptance — Development and Domain Design Only |
| Status | Conditionally Accepted for Domain Design |
| Decision date | 2026-10-12 (Asia/Ho_Chi_Minh) |
| Decision authority | Project Owner |
| Implementation owner | Development Team |
| Initial review deadline | 2026-11-11 (30 ngày kể từ decision date) |

Project Owner cung cấp quyết định này trực tiếp trong cuộc trao đổi qua Prompt
1.6B. Record ghi nhận quyết định đó, không phải phê duyệt bảo mật của một tổ chức
độc lập. Không suy diễn tên cá nhân, chữ ký hoặc thẩm quyền khác.

Bằng chứng và lịch sử: [Foundation audit, mục I và J](../foundation-audit.md#i-prompt-16a--dependency-security-remediation-addendum).
Kết quả checks chức năng kế thừa Prompt 1.6/1.6A; lượt 1.6B chỉ sửa tài liệu và
kiểm tra lại dependency audit, không chạy lại build/tests hoặc database checks.

## B. Risk Scope

### SEC-01 — Open / High

- **Advisory:** [GHSA-ggr8-5vv4-36mx](https://github.com/advisories/GHSA-ggr8-5vv4-36mx).
- **Affected package/version:** deepmerge-ts@7.1.5; affected range <8.0.0.
- **Dependency chain:** API prisma@7.10.0 → @prisma/config@7.10.0 →
  deepmerge-ts@7.1.5. API @prisma/client@7.10.0 cũng resolve optional peer
  prisma@7.10.0, đưa cùng chain vào production dependency graph.
- **Advisory severity:** High; giữ nguyên, không hạ severity theo classification.
- **Known exposure:** Prisma CLI/config merger sử dụng dependency này. Audit
  1.6A ghi nhận một High trong production dependency graph; startup/readiness
  trace không nạp affected tooling. Config hiện là object đơn giản do repository
  quản lý; chưa xác định HTTP path truyền input tới merge sink.
- **Unknown exposure:** chưa chứng minh mọi execution path, deployment artifact
  hoặc config/plugin tương lai không sử dụng dependency. Package inventory và
  execution reachability là hai phạm vi khác nhau.
- **Available remediation:** upstream patched version từ major 8; 8.0.2 đã được
  xác minh phát hành trong 1.6A. 7.1.6 vẫn thuộc affected range.
- **Current limitation:** Prisma config pin 7.1.5; major 8 có breaking changes,
  compatibility với Prisma/c12 chưa xác minh. RA-001 không phê duyệt major upgrade.
- **Residual risk:** cyclic object graphs tới merge API có thể gây stack
  exhaustion/availability failure. Exposure HTTP hiện chưa được chứng minh;
  không đủ bằng chứng khẳng định package hoặc production hoàn toàn an toàn.

### SEC-02 — Open / High

- **Advisory:** [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm).
- **Affected package/version:** braces@3.0.3; affected range <=3.0.3.
- **Dependency chain:** web eslint-config-next@16.4.0 →
  @next/eslint-plugin-next@16.4.0 → fast-glob@3.3.1 → micromatch@4.0.8 →
  braces@3.0.3.
- **Advisory severity:** High; giữ nguyên dù thuộc lint tooling/devDependency.
- **Known exposure:** glob tooling của ESLint. Config hiện không đặt
  settings.next.rootDir glob. Audit 1.6A không tìm thấy affected tooling trong
  Next server trace manifests hoặc runtime startup/health path đã kiểm tra.
- **Unknown exposure:** chưa phân tích exhaustive mọi tooling sink, vendored code
  hoặc artifact production tương lai. Không có bằng chứng khai thác qua HTTP hiện
  tại không đồng nghĩa đã chứng minh không thể khai thác.
- **Available remediation:** 1.6A chưa xác minh được compatible fixed release.
  Audit gợi ý >=3.0.4 nhưng registry lookup trả package version không tồn tại;
  GitHub advisory ghi patched versions None. Đây là kết quả tại thời điểm 1.6A,
  cần kiểm tra registry lại khi reassessment, không giả định trạng thái vĩnh viễn.
- **Current limitation:** parent updates cùng major được kiểm tra trong 1.6A
  chưa loại bỏ vulnerable chain; chưa có backport chính thức phù hợp được xác minh.
- **Residual risk:** deeply nested brace patterns tới recursive walkers có thể
  gây stack exhaustion/DoS trong tooling. Input-length limit chưa được kiểm chứng
  là mitigation đủ; không coi tranh luận upstream là remediation hoặc approval.

`pnpm audit --json` chạy lại ngày 2026-10-12 trong 1.6B vẫn báo đúng hai IDs trên,
đều High; 0 Critical/Moderate/Low. Acceptance không sửa findings hoặc audit output.

## C. Acceptance Scope

RA-001 cho phép bắt đầu **Phase 2.1 — Domain Analysis & ERD** có điều kiện, gồm:

- Domain analysis và requirement analysis.
- ERD design và database schema proposals dưới dạng thiết kế/tài liệu.
- Documentation.
- Non-destructive local verification trong phạm vi development.

Theo quyết định này, không cho phép:

- Production deployment hoặc public release.
- Bỏ qua dependency audit, disable/suppress security checks hoặc coi acceptance
  là bản vá.
- Tự động triển khai database migrations hoặc áp dụng schema proposals vào DB.
- Thay đổi database permissions hoặc production infrastructure.

Implementation về sau cần review riêng theo phạm vi và rủi ro; quyền thiết kế
không tự mở rộng sang triển khai. Prompt 1.6B chỉ lập record và cập nhật audit,
không bắt đầu Phase 2.1 trong lượt này.

## D. Compensating Controls

### Đã xác minh trong Foundation 1.6/1.6A

- Versions/resolutions được quản lý bằng pnpm lockfile; frozen-lockfile install
  pass trong 1.6A, không đổi dependencies ở 1.6B.
- Prisma config và ESLint config hiện do repository quản lý; những HTTP handlers
  được review không chuyển input sang affected tooling.
- Runtime dùng role shanflow_app qua validated DATABASE_URL; bootstrap/migrator
  credentials không dùng làm runtime connection. Database least-privilege roles
  và shadow isolation đã pass trong audit trước, không kiểm tra lại DB ở 1.6B.
- Dependency audit vẫn hoạt động: lần kiểm tra 1.6B giữ hai High findings; không
  dùng ignore/suppression hoặc đổi severity.

Các bằng chứng trên có phạm vi và ngày kiểm tra cụ thể, không bảo đảm trạng thái
runtime/database hoặc exposure sẽ không thay đổi sau đó.

### Điều kiện vận hành cần tiếp tục áp dụng — chưa có automated enforcement

- Không chạy Prisma CLI với untrusted config/plugins; không chạy tooling trên
  repository hoặc inputs không đáng tin cậy, nhất là khi có credentials.
- Giữ least-privilege roles, tách runtime/migration/bootstrap credentials.
- Dùng frozen-lockfile cho verification và tiếp tục dependency audit khi review
  dependency changes; không vô hiệu hóa checks để tiếp tục thiết kế.
- Development Team theo dõi upstream fixes và review dependency changes trước
  merge; kiểm tra phiên bản publish và compatibility trước remediation.
- Review RA-001 khi gặp triggers dưới đây; không tự mở rộng acceptance sang
  release/implementation. Tách tooling khỏi runtime deployment artifact là đề
  xuất cho bước deployment sau, chưa triển khai hoặc kiểm chứng trong record này.

Đây là controls giảm exposure, không thay thế remediation. Không có CI/CD,
scheduled monitoring hay production isolation mới được tạo bởi RA-001.

## E. Reassessment Triggers

Development Team phải review lại ngay, không chờ deadline, khi:

1. Bản vá tương thích được phát hành.
2. Prisma hoặc Next.js dependency chain thay đổi.
3. Xuất hiện bằng chứng khai thác thực tế.
4. Affected dependency xuất hiện trong production execution path.
5. Dự án chuẩn bị production deployment/public release.
6. Thực hiện major dependency upgrade.
7. Phạm vi ứng dụng thay đổi làm tăng exposure hoặc cần hoạt động ngoài scope.

Nếu không giữ được controls hoặc phát hiện exposure mới, dừng hoạt động phụ
thuộc điều kiện đó để đánh giá lại và ghi nhận quyết định của Project Owner.
Production gate vẫn chặn cho tới khi được review/phê duyệt riêng.

## F. Review Deadline

Initial review deadline: **2026-11-11**, 30 ngày sau **2026-10-12**,
timezone Asia/Ho_Chi_Minh. Development Team thực hiện reassessment và ghi lại
kết quả, trạng thái findings, fixes, controls và quyết định tiếp theo.

Trigger quan trọng yêu cầu review ngay. Deadline là mốc review, không phải ngày
tự động hết rủi ro, tự đóng findings hoặc tự cấp quyền production. Khi quá hạn,
record vẫn giữ các findings mở và ghi nhận review overdue; cần review trước khi
tiếp tục dựa vào conditional authorization, không tự gia hạn.

## G. Exit Criteria

Chỉ đóng acceptance cho finding tương ứng khi:

- Finding được khắc phục, audit cùng verification phù hợp pass và bằng chứng
  được ghi nhận; hoặc
- Sau reassessment có quyết định thay thế được ghi nhận bởi authority thích hợp.

Nếu chỉ xử lý một finding, finding còn lại và acceptance của nó vẫn mở. Không
tự đóng finding khi tới deadline, dependency được phân loại dev-only hoặc tests
chức năng pass. Quyết định thay thế không tự làm vulnerability biến mất; cần giữ
lịch sử finding và trạng thái chưa khắc phục nếu vẫn còn affected dependency.

## H. Readiness và Verification

| Gate | Current status |
| --- | --- |
| Functional Foundation | PASS |
| Security Findings | 2 HIGH OPEN |
| Domain Design Authorization | CONDITIONALLY APPROVED |
| Production Release Authorization | NOT APPROVED |

Security remediation gate vẫn chưa đạt; RA-001 chỉ cấp quyền thiết kế có điều
kiện. Không có tuyên bố Foundation hoàn toàn security-ready hoặc production-ready.

Verification 1.6B: hai High IDs còn trong fresh dependency audit; metadata,
allowed/restricted scope, deadline và cross-reference đã kiểm tra;
`git diff --check` pass. Không chạy lại build/tests cho documentation-only change.
Chỉ tạo record này và cập nhật [audit, mục J](../foundation-audit.md#j-prompt-16b--conditional-security-risk-acceptance).
