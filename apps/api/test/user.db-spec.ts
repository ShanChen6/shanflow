import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { normalizeEmail } from '../src/database/normalize-email.js';

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

function fixtureEmail(label: string): string {
  return `${label}.${randomUUID()}@example.invalid`;
}

describe('User database integration', () => {
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

    const [identity] = await prisma.$queryRaw<
      Array<{
        database: string;
        role: string;
        schema: string;
        elevated: boolean;
        schemaCreate: boolean;
      }>
    >`
      SELECT current_database() AS database, current_user AS role, current_schema() AS schema,
             (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) AS elevated,
             has_schema_privilege(current_user, 'public', 'CREATE') AS "schemaCreate"
      FROM pg_roles WHERE rolname = current_user
    `;
    if (
      !identity ||
      identity.database !== 'shanflow' ||
      identity.role !== 'shanflow_app' ||
      identity.schema !== 'public' ||
      identity.elevated ||
      identity.schemaCreate
    ) {
      throw new Error(
        'Runtime database identity or privileges are unsafe for tests.',
      );
    }
  });

  afterAll(async () => {
    await app?.close();
  });

  it('creates and reads a User with UUID/default/timestamp mappings', async () => {
    const email = fixtureEmail('create');
    const user = await prisma.user.create({
      data: { email, displayName: 'Test User' },
    });
    try {
      expect(user.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
      expect(user).toMatchObject({
        email,
        displayName: 'Test User',
        avatarUrl: null,
        accountStatus: 'ACTIVE',
      });
      expect(user.createdAt).toBeInstanceOf(Date);
      expect(user.updatedAt).toBeInstanceOf(Date);
      await expect(
        prisma.user.findUnique({ where: { email } }),
      ).resolves.toMatchObject({ id: user.id });
    } finally {
      await prisma.user.deleteMany({ where: { id: user.id } });
    }
  });

  it('normalizes email and rejects a duplicate canonical value', async () => {
    const local = `duplicate.${randomUUID()}`;
    const canonical = normalizeEmail(
      `  ${local.toUpperCase()}@EXAMPLE.INVALID  `,
    );
    const user = await prisma.user.create({
      data: { email: canonical, displayName: 'First User' },
    });
    try {
      await expect(
        prisma.user.create({
          data: {
            email: normalizeEmail(canonical),
            displayName: 'Second User',
          },
        }),
      ).rejects.toMatchObject({ code: 'P2002' });
    } finally {
      await prisma.user.deleteMany({ where: { id: user.id } });
    }
  });

  it('updates updatedAt and deletes only its own fixture', async () => {
    const user = await prisma.user.create({
      data: { email: fixtureEmail('update'), displayName: 'Before' },
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    try {
      const updated = await prisma.user.update({
        where: { id: user.id },
        data: { displayName: 'After' },
      });
      expect(updated.displayName).toBe('After');
      expect(updated.updatedAt.getTime()).toBeGreaterThan(
        user.updatedAt.getTime(),
      );
    } finally {
      await prisma.user.deleteMany({ where: { id: user.id } });
    }
    await expect(
      prisma.user.findUnique({ where: { id: user.id } }),
    ).resolves.toBeNull();
  });

  it.each([
    [
      'uncanonical email',
      { email: 'Not-Canonical@Example.Invalid ', displayName: 'Valid Name' },
    ],
    [
      'blank display name',
      { email: fixtureEmail('blank-name'), displayName: '   ' },
    ],
  ])('rejects %s at the database boundary', async (_label, data) => {
    await expect(prisma.user.create({ data })).rejects.toMatchObject({
      code: 'P2039',
    });
  });

  it('keeps dot and plus aliases distinct', async () => {
    const token = randomUUID();
    const emails = [
      `alias.${token}@example.invalid`,
      `alias${token}+tag@example.invalid`,
    ];
    const users = [];
    try {
      for (const email of emails)
        users.push(
          await prisma.user.create({
            data: { email, displayName: 'Alias Test' },
          }),
        );
      expect(new Set(users.map((user) => user.email))).toEqual(new Set(emails));
    } finally {
      await prisma.user.deleteMany({
        where: { id: { in: users.map((user) => user.id) } },
      });
    }
  });

  it('denies runtime DDL and leaves no probe table', async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(
          'CREATE TABLE public.__shanflow_runtime_ddl_probe (id integer)',
        );
        throw new Error('Runtime DDL unexpectedly succeeded; rolling back.');
      }),
    ).rejects.toMatchObject({ code: 'P2010' });
    const [{ exists }] = await prisma.$queryRaw<Array<{ exists: boolean }>>`
      SELECT to_regclass('public.__shanflow_runtime_ddl_probe') IS NOT NULL AS exists
    `;
    expect(exists).toBe(false);
  });

  it('keeps API liveness and database readiness healthy with the singleton service', async () => {
    expect(app.get(PrismaService)).toBe(prisma);
    await request(app.getHttpServer())
      .get('/health/live')
      .expect(200)
      .expect({ status: 'ok' });
    await request(app.getHttpServer())
      .get('/health/ready')
      .expect(200)
      .expect({ status: 'ok', checks: { database: 'up' } });
  });
});
