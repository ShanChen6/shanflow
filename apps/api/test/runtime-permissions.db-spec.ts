import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';

config({
  path: fileURLToPath(new URL('../../../.env', import.meta.url)),
  quiet: true,
});

function assertLocalTestDatabase(): void {
  if (process.env.NODE_ENV === 'production')
    throw new Error('Database tests refuse NODE_ENV=production.');
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error('DATABASE_URL is required for database tests.');
  const url = new URL(raw);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const expectedPort = Number(process.env.POSTGRES_PORT || 5432);
  const actualPort = Number(url.port || 5432);
  const forbiddenOverrides = [
    'user',
    'username',
    'password',
    'database',
    'dbname',
    'host',
    'port',
  ];
  if (
    !['127.0.0.1', 'localhost', '::1'].includes(host) ||
    actualPort !== expectedPort ||
    decodeURIComponent(url.username) !== 'shanflow_app' ||
    decodeURIComponent(url.pathname.slice(1)) !== 'shanflow' ||
    (url.searchParams.get('schema') ?? 'public') !== 'public' ||
    forbiddenOverrides.some((key) => url.searchParams.has(key))
  ) {
    throw new Error(
      'Database tests require the verified local shanflow_app target.',
    );
  }
}

describe('Runtime role permissions', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    assertLocalTestDatabase();
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app?.close();
  });

  // CDB-001: migration bookkeeping belongs to the migration role only.
  it('has no privileges on the Prisma migration history table', async () => {
    const granted = await prisma.$queryRaw<Array<{ privilege: string }>>`
      SELECT p AS privilege
      FROM unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) AS p
      WHERE has_table_privilege(current_user, 'public._prisma_migrations', p)
    `;
    expect(granted).toEqual([]);
  });

  it('is denied reading and deleting migration history', async () => {
    await expect(
      prisma.$queryRawUnsafe('SELECT 1 FROM "_prisma_migrations" LIMIT 1'),
    ).rejects.toThrow();
    await expect(
      prisma.$executeRawUnsafe('DELETE FROM "_prisma_migrations" WHERE false'),
    ).rejects.toThrow();
  });

  it('keeps CRUD on business tables', async () => {
    const [row] = await prisma.$queryRaw<Array<{ ok: boolean }>>`
      SELECT bool_and(has_table_privilege(current_user, t, 'SELECT,INSERT,UPDATE,DELETE')) AS ok
      FROM unnest(ARRAY['public.users', 'public.workspaces', 'public.workspace_members', 'public.projects', 'public.tasks']) AS t
    `;
    expect(row?.ok).toBe(true);
  });
});
