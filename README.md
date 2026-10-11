# Personal Todo List

Ứng dụng quản lý công việc cá nhân. Foundation Step 1 chỉ khởi tạo monorepo,
frontend placeholder và API mặc định; chưa có tính năng nghiệp vụ hoặc database.

## Tech stack

- Frontend: Next.js 16, React 19, TypeScript strict, App Router, Tailwind CSS 4, ESLint.
- Backend: NestJS 12, TypeScript strict, REST API (Express), Oxlint.
- Workspace: pnpm, một lockfile chung; chưa cần công cụ orchestration bổ sung.

## Repository structure

```text
apps/
  web/                 # Next.js frontend, src/app, public
  api/                 # NestJS backend, src, test
packages/              # Chỗ trống cho shared packages khi thực sự cần
package.json
pnpm-workspace.yaml
pnpm-lock.yaml
```

## Requirements

- Node.js 24.15+ (khuyến nghị Node.js 24 LTS).
- pnpm 11.18.0, được khai báo trong `packageManager`.

## Install dependencies

Từ root repository:

```bash
pnpm install
```

## Development

Frontend tại http://localhost:3000:

```bash
pnpm --filter web dev
```

Backend tại http://localhost:3001 (`GET /` trả về `Hello World!`):

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

Không commit secret, `.env*`, dependencies hay build output. `packages/` hiện
không có package hoặc abstraction dùng chung.
