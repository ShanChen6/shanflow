import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { OneTimeTokenStore } from '../src/features/auth/shared/one-time-token.store.js';
import { RefreshSessionStore } from '../src/features/auth/shared/refresh-session.store.js';
import { hashSecureToken } from '../src/shared/crypto/secure-token.js';
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

describe('Auth shared stores (database)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tokens: OneTimeTokenStore;
  let sessions: RefreshSessionStore;
  const userIds: string[] = [];

  async function createUser() {
    const user = await prisma.user.create({
      data: { email: fixtureEmail('store'), displayName: 'Store Test' },
    });
    userIds.push(user.id);
    return user;
  }

  const consume = (
    token: string,
    purpose: 'EMAIL_VERIFICATION' | 'PASSWORD_RESET',
  ) => prisma.$transaction((tx) => tokens.consume(tx, token, purpose));

  beforeAll(async () => {
    assertLocalTestDatabase();
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    tokens = app.get(OneTimeTokenStore, { strict: false });
    sessions = app.get(RefreshSessionStore, { strict: false });
  });

  afterEach(async () => {
    const ids = userIds.splice(0);
    await prisma.refreshSession.updateMany({
      where: { userId: { in: ids } },
      data: { replacedById: null },
    });
    await prisma.refreshSession.deleteMany({ where: { userId: { in: ids } } });
    await prisma.oneTimeToken.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('OneTimeTokenStore', () => {
    it('issues a token that is stored only as a hash and can be consumed once', async () => {
      const user = await createUser();
      const token = await tokens.issue(user.id, 'EMAIL_VERIFICATION', {
        email: user.email,
      });
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      const rows = await prisma.oneTimeToken.findMany({
        where: { userId: user.id },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.tokenHash).toBe(hashSecureToken(token));
      expect(rows[0]?.tokenHash).not.toContain(token);

      await expect(consume(token, 'EMAIL_VERIFICATION')).resolves.toEqual({
        userId: user.id,
        email: user.email,
      });
      await expect(consume(token, 'EMAIL_VERIFICATION')).resolves.toBeNull();
    });

    it('expires verification links after 24 hours and reset links after one hour', async () => {
      const user = await createUser();
      const verification = await tokens.issue(user.id, 'EMAIL_VERIFICATION', {
        email: user.email,
      });
      const reset = await tokens.issue(user.id, 'PASSWORD_RESET');
      const rows = await prisma.oneTimeToken.findMany({
        where: { userId: user.id },
      });
      const ttl = (purpose: string) => {
        const row = rows.find((candidate) => candidate.purpose === purpose)!;
        return (row.expiresAt.getTime() - row.createdAt.getTime()) / 60_000;
      };
      expect(ttl('EMAIL_VERIFICATION')).toBe(24 * 60);
      expect(ttl('PASSWORD_RESET')).toBe(60);

      await prisma.oneTimeToken.updateMany({
        where: { userId: user.id },
        data: {
          createdAt: new Date(Date.now() - 2 * 86_400_000),
          expiresAt: new Date(Date.now() - 1000),
        },
      });
      await expect(
        consume(verification, 'EMAIL_VERIFICATION'),
      ).resolves.toBeNull();
      await expect(consume(reset, 'PASSWORD_RESET')).resolves.toBeNull();
    });

    it('does not accept a token for a different purpose, or an unknown one', async () => {
      const user = await createUser();
      const reset = await tokens.issue(user.id, 'PASSWORD_RESET');
      await expect(consume(reset, 'EMAIL_VERIFICATION')).resolves.toBeNull();
      await expect(
        consume('A'.repeat(43), 'PASSWORD_RESET'),
      ).resolves.toBeNull();
      // The wrong-purpose attempt must not have burned the token.
      await expect(consume(reset, 'PASSWORD_RESET')).resolves.toMatchObject({
        userId: user.id,
      });
    });

    it('keeps only the newest unused token per user and purpose', async () => {
      const user = await createUser();
      const first = await tokens.issue(user.id, 'PASSWORD_RESET');
      const second = await tokens.issue(user.id, 'PASSWORD_RESET');
      const other = await tokens.issue(user.id, 'EMAIL_VERIFICATION', {
        email: user.email,
      });
      await expect(consume(first, 'PASSWORD_RESET')).resolves.toBeNull();
      await expect(consume(second, 'PASSWORD_RESET')).resolves.not.toBeNull();
      await expect(
        consume(other, 'EMAIL_VERIFICATION'),
      ).resolves.not.toBeNull();
    });

    it('lets exactly one of many concurrent consumers win', async () => {
      const user = await createUser();
      const token = await tokens.issue(user.id, 'PASSWORD_RESET');
      const results = await Promise.all(
        Array.from({ length: 8 }, () => consume(token, 'PASSWORD_RESET')),
      );
      expect(results.filter((result) => result !== null)).toHaveLength(1);
    });

    it("rolls the claim back with the caller's transaction", async () => {
      const user = await createUser();
      const token = await tokens.issue(user.id, 'PASSWORD_RESET');
      await expect(
        prisma.$transaction(async (tx) => {
          await tokens.consume(tx, token, 'PASSWORD_RESET');
          throw new Error('later step failed');
        }),
      ).rejects.toThrow('later step failed');
      await expect(consume(token, 'PASSWORD_RESET')).resolves.not.toBeNull();
    });
  });

  describe('RefreshSessionStore', () => {
    it('finds a session only while it is live and belongs to the user', async () => {
      const user = await createUser();
      const other = await createUser();
      const created = await sessions.createFamily(user.id);
      await expect(
        sessions.findLiveSession(created.sessionId, user.id),
      ).resolves.toEqual({ familyId: created.familyId });
      await expect(
        sessions.findLiveSession(created.sessionId, other.id),
      ).resolves.toBeNull();
      await expect(
        sessions.findLiveSession(randomUUID(), user.id),
      ).resolves.toBeNull();

      await sessions.revokeFamilyByToken(created.token);
      await expect(
        sessions.findLiveSession(created.sessionId, user.id),
      ).resolves.toBeNull();
    });

    it('treats an expired session as not live', async () => {
      const user = await createUser();
      const created = await sessions.createFamily(user.id);
      await prisma.refreshSession.update({
        where: { id: created.sessionId },
        data: {
          createdAt: new Date(Date.now() - 2 * 86_400_000),
          expiresAt: new Date(Date.now() - 1000),
        },
      });
      await expect(
        sessions.findLiveSession(created.sessionId, user.id),
      ).resolves.toBeNull();
    });

    it('revokes every family except the one it is told to keep', async () => {
      const user = await createUser();
      const keep = await sessions.createFamily(user.id);
      const drop1 = await sessions.createFamily(user.id);
      const drop2 = await sessions.createFamily(user.id);
      await sessions.revokeAllForUser(user.id, {
        exceptFamilyId: keep.familyId,
      });
      await expect(
        sessions.findLiveSession(keep.sessionId, user.id),
      ).resolves.not.toBeNull();
      await expect(
        sessions.findLiveSession(drop1.sessionId, user.id),
      ).resolves.toBeNull();
      await expect(
        sessions.findLiveSession(drop2.sessionId, user.id),
      ).resolves.toBeNull();
    });

    it("revokes inside the caller's transaction so it rolls back with it", async () => {
      const user = await createUser();
      const created = await sessions.createFamily(user.id);
      await expect(
        prisma.$transaction(async (tx) => {
          await sessions.revokeAllForUser(user.id, { tx });
          throw new Error('later step failed');
        }),
      ).rejects.toThrow('later step failed');
      await expect(
        sessions.findLiveSession(created.sessionId, user.id),
      ).resolves.not.toBeNull();
    });
  });
});
