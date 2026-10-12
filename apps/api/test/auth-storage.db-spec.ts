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

function tokenHash(): string {
  return `${randomUUID()}${randomUUID()}`.replaceAll('-', '').slice(0, 64);
}

describe('Auth storage database integration', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const userIds: string[] = [];

  async function createUser() {
    const user = await prisma.user.create({
      data: { email: fixtureEmail('auth'), displayName: 'Auth Test' },
    });
    userIds.push(user.id);
    return user;
  }

  function sessionData(
    userId: string,
    overrides: Record<string, unknown> = {},
  ) {
    return {
      userId,
      familyId: randomUUID(),
      tokenHash: tokenHash(),
      expiresAt: new Date(Date.now() + 3_600_000),
      ...overrides,
    };
  }

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
    await prisma.refreshSession.updateMany({
      where: { userId: { in: ids } },
      data: { replacedById: null },
    });
    await prisma.refreshSession.deleteMany({ where: { userId: { in: ids } } });
    await prisma.passwordCredential.deleteMany({
      where: { userId: { in: ids } },
    });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  });

  afterAll(async () => {
    await app?.close();
  });

  it('defaults emailVerifiedAt to null', async () => {
    const user = await createUser();
    expect(user.emailVerifiedAt).toBeNull();
  });

  it('allows one password credential per user and rejects a blank hash', async () => {
    const user = await createUser();
    const credential = await prisma.passwordCredential.create({
      data: { userId: user.id, passwordHash: '$argon2id$v=19$example' },
    });
    expect(credential.passwordUpdatedAt).toBeInstanceOf(Date);
    await expect(
      prisma.passwordCredential.create({
        data: { userId: user.id, passwordHash: '$argon2id$v=19$other' },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
    const other = await createUser();
    await expect(
      prisma.passwordCredential.create({
        data: { userId: other.id, passwordHash: '   ' },
      }),
    ).rejects.toThrow();
  });

  it('restricts deleting a user that has a credential or sessions', async () => {
    const user = await createUser();
    await prisma.passwordCredential.create({
      data: { userId: user.id, passwordHash: '$argon2id$v=19$example' },
    });
    await expect(
      prisma.user.delete({ where: { id: user.id } }),
    ).rejects.toThrow();
    await prisma.passwordCredential.delete({ where: { userId: user.id } });
    await prisma.refreshSession.create({ data: sessionData(user.id) });
    await expect(
      prisma.user.delete({ where: { id: user.id } }),
    ).rejects.toThrow();
  });

  it('stores a refresh session and enforces a unique token hash', async () => {
    const user = await createUser();
    const data = sessionData(user.id);
    const session = await prisma.refreshSession.create({ data });
    expect(session).toMatchObject({
      usedAt: null,
      revokedAt: null,
      replacedById: null,
    });
    await expect(
      prisma.refreshSession.create({
        data: sessionData(user.id, { tokenHash: data.tokenHash }),
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('rejects malformed token hashes and non-future expiry', async () => {
    const user = await createUser();
    for (const bad of ['short', 'G'.repeat(64), tokenHash().toUpperCase()]) {
      await expect(
        prisma.refreshSession.create({
          data: sessionData(user.id, { tokenHash: bad }),
        }),
      ).rejects.toThrow();
    }
    const createdAt = new Date();
    await expect(
      prisma.refreshSession.create({
        data: sessionData(user.id, { createdAt, expiresAt: createdAt }),
      }),
    ).rejects.toThrow();
  });

  it('links one successor per session and guards rotation integrity', async () => {
    const user = await createUser();
    const familyId = randomUUID();
    const first = await prisma.refreshSession.create({
      data: sessionData(user.id, { familyId }),
    });
    const second = await prisma.refreshSession.create({
      data: sessionData(user.id, { familyId }),
    });
    // A successor can only be recorded together with usedAt.
    await expect(
      prisma.refreshSession.update({
        where: { id: first.id },
        data: { replacedById: second.id },
      }),
    ).rejects.toThrow();
    // A session cannot replace itself.
    await expect(
      prisma.refreshSession.update({
        where: { id: first.id },
        data: { usedAt: new Date(), replacedById: first.id },
      }),
    ).rejects.toThrow();
    await prisma.refreshSession.update({
      where: { id: first.id },
      data: { usedAt: new Date(), replacedById: second.id },
    });
    // The same successor cannot have two predecessors.
    const third = await prisma.refreshSession.create({
      data: sessionData(user.id, { familyId }),
    });
    await expect(
      prisma.refreshSession.update({
        where: { id: third.id },
        data: { usedAt: new Date(), replacedById: second.id },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });
});
