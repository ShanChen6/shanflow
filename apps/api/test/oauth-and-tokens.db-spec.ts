import { randomUUID } from 'node:crypto';
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

function fixtureEmail(label: string): string {
  return `${label}.${randomUUID()}@example.invalid`;
}

function hash(): string {
  return `${randomUUID()}${randomUUID()}`.replaceAll('-', '').slice(0, 64);
}

describe('OAuth accounts and one-time tokens (database)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const userIds: string[] = [];

  async function createUser() {
    const user = await prisma.user.create({
      data: { email: fixtureEmail('oauth'), displayName: 'Token Test' },
    });
    userIds.push(user.id);
    return user;
  }

  const future = () => new Date(Date.now() + 3_600_000);

  beforeAll(async () => {
    assertLocalTestDatabase();
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterEach(async () => {
    const ids = userIds.splice(0);
    await prisma.oAuthAccount.deleteMany({ where: { userId: { in: ids } } });
    await prisma.oneTimeToken.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  });

  afterAll(async () => {
    await app?.close();
  });

  it('keys an OAuth identity by provider and subject, one subject per user', async () => {
    const first = await createUser();
    const second = await createUser();
    const subject = randomUUID();
    await prisma.oAuthAccount.create({
      data: {
        userId: first.id,
        provider: 'GOOGLE',
        providerAccountId: subject,
        providerEmail: 'a@example.invalid',
        providerEmailVerified: true,
      },
    });
    // The same Google subject cannot be attached to a second user.
    await expect(
      prisma.oAuthAccount.create({
        data: {
          userId: second.id,
          provider: 'GOOGLE',
          providerAccountId: subject,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
    // A user cannot link two Google accounts.
    await expect(
      prisma.oAuthAccount.create({
        data: {
          userId: first.id,
          provider: 'GOOGLE',
          providerAccountId: randomUUID(),
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('rejects a blank provider subject and restricts deleting a linked user', async () => {
    const user = await createUser();
    await expect(
      prisma.oAuthAccount.create({
        data: { userId: user.id, provider: 'GOOGLE', providerAccountId: '  ' },
      }),
    ).rejects.toThrow();
    await prisma.oAuthAccount.create({
      data: {
        userId: user.id,
        provider: 'GOOGLE',
        providerAccountId: randomUUID(),
      },
    });
    await expect(
      prisma.user.delete({ where: { id: user.id } }),
    ).rejects.toThrow();
  });

  it('stores a unique, well-formed token hash with a future expiry', async () => {
    const user = await createUser();
    const tokenHash = hash();
    const token = await prisma.oneTimeToken.create({
      data: {
        userId: user.id,
        purpose: 'PASSWORD_RESET',
        tokenHash,
        expiresAt: future(),
      },
    });
    expect(token).toMatchObject({ usedAt: null, email: null });
    await expect(
      prisma.oneTimeToken.create({
        data: {
          userId: user.id,
          purpose: 'PASSWORD_RESET',
          tokenHash,
          expiresAt: future(),
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
    for (const bad of ['short', 'G'.repeat(64), hash().toUpperCase()]) {
      await expect(
        prisma.oneTimeToken.create({
          data: {
            userId: user.id,
            purpose: 'PASSWORD_RESET',
            tokenHash: bad,
            expiresAt: future(),
          },
        }),
      ).rejects.toThrow();
    }
    const createdAt = new Date();
    await expect(
      prisma.oneTimeToken.create({
        data: {
          userId: user.id,
          purpose: 'PASSWORD_RESET',
          tokenHash: hash(),
          createdAt,
          expiresAt: createdAt,
        },
      }),
    ).rejects.toThrow();
  });

  it('requires an email on verification tokens but not on reset tokens', async () => {
    const user = await createUser();
    await expect(
      prisma.oneTimeToken.create({
        data: {
          userId: user.id,
          purpose: 'EMAIL_VERIFICATION',
          tokenHash: hash(),
          expiresAt: future(),
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.oneTimeToken.create({
        data: {
          userId: user.id,
          purpose: 'EMAIL_VERIFICATION',
          email: user.email,
          tokenHash: hash(),
          expiresAt: future(),
        },
      }),
    ).resolves.toMatchObject({ email: user.email });
  });
});
