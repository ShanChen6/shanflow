import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import { decodeJwt } from 'jose';
import request from 'supertest';
import { Argon2PasswordHasher } from '../src/shared/crypto/password-hasher.js';
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

const PASSWORD = 'correct horse battery staple';
const ORIGIN = 'http://localhost:3000';
const hasher = new Argon2PasswordHasher();

function fixtureEmail(label: string): string {
  return `${label}.${randomUUID()}@example.invalid`;
}

async function createApp(options: { throttle: boolean }) {
  let builder = Test.createTestingModule({ imports: [AppModule] });
  if (!options.throttle) {
    builder = builder
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true });
  }
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  return app;
}

/** Returns the `name=value` part of the refresh cookie set by a response. */
function cookiePair(response: request.Response): string {
  const header = (response.headers['set-cookie'] as unknown as string[]).find(
    (cookie) => cookie.startsWith('shanflow_refresh='),
  );
  if (!header) throw new Error('Missing refresh cookie');
  return header.split(';')[0]!;
}

function cookieValue(pair: string): string {
  return pair.slice('shanflow_refresh='.length);
}

describe('POST /auth/refresh (database)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const userIds: string[] = [];

  async function createUser(status: 'ACTIVE' | 'SUSPENDED' = 'ACTIVE') {
    const email = fixtureEmail('refresh');
    const user = await prisma.user.create({
      data: {
        email,
        displayName: 'Refresh Test',
        accountStatus: status,
        passwordCredential: {
          create: { passwordHash: await hasher.hash(PASSWORD) },
        },
      },
    });
    userIds.push(user.id);
    return { ...user, email };
  }

  async function loginAs(email: string) {
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    return { response, cookie: cookiePair(response) };
  }

  function refresh(
    cookie?: string,
    headers: Record<string, string> = {
      Origin: ORIGIN,
      'X-Requested-With': 'shanflow',
    },
  ) {
    let call = request(app.getHttpServer()).post('/auth/refresh');
    for (const [name, value] of Object.entries(headers)) {
      call = call.set(name, value);
    }
    return cookie ? call.set('Cookie', cookie) : call;
  }

  const sessionFor = (cookie: string) =>
    prisma.refreshSession.findUniqueOrThrow({
      where: { tokenHash: hashSecureToken(cookieValue(cookie)) },
    });

  beforeAll(async () => {
    assertLocalTestDatabase();
    app = await createApp({ throttle: false });
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

  it('rotates the refresh token and returns a new access token', async () => {
    const user = await createUser();
    const { cookie, response: login } = await loginAs(user.email);
    const original = await sessionFor(cookie);

    const response = await refresh(cookie).expect(200);
    const nextCookie = cookiePair(response);
    expect(nextCookie).not.toBe(cookie);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['set-cookie'][0]).toMatch(/HttpOnly/);
    expect(response.headers['set-cookie'][0]).toMatch(/SameSite=Strict/);
    expect(response.body).toEqual({
      accessToken: expect.any(String),
      tokenType: 'Bearer',
      expiresIn: 900,
      user: {
        id: user.id,
        email: user.email,
        displayName: 'Refresh Test',
        emailVerified: false,
      },
    });
    expect(response.body.accessToken).not.toBe(login.body.accessToken);
    expect(JSON.stringify(response.body)).not.toContain(
      cookieValue(nextCookie),
    );

    const successor = await sessionFor(nextCookie);
    const consumed = await prisma.refreshSession.findUniqueOrThrow({
      where: { id: original.id },
    });
    expect(consumed.usedAt).toBeInstanceOf(Date);
    expect(consumed.lastUsedAt).toBeInstanceOf(Date);
    expect(consumed.replacedById).toBe(successor.id);
    expect(successor).toMatchObject({
      familyId: original.familyId,
      userId: user.id,
      usedAt: null,
      revokedAt: null,
      replacedById: null,
    });
    // The 30-day cap is absolute: refreshing never extends it.
    expect(successor.expiresAt.getTime()).toBe(original.expiresAt.getTime());
    expect(decodeJwt(response.body.accessToken).sid).toBe(successor.id);
    // The new access token works against a protected route.
    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${response.body.accessToken}`)
      .expect(200);
  });

  it('keeps rotating along a chain of generations', async () => {
    const user = await createUser();
    let { cookie } = await loginAs(user.email);
    for (let generation = 0; generation < 3; generation += 1) {
      cookie = cookiePair(await refresh(cookie).expect(200));
    }
    const sessions = await prisma.refreshSession.findMany({
      where: { userId: user.id },
    });
    expect(sessions).toHaveLength(4);
    expect(new Set(sessions.map((session) => session.familyId)).size).toBe(1);
    expect(sessions.filter((session) => session.usedAt === null)).toHaveLength(
      1,
    );
  });

  it('treats reuse of a consumed token as theft: revokes the whole family and clears the cookie', async () => {
    const user = await createUser();
    const { cookie: first } = await loginAs(user.email);
    const second = cookiePair(await refresh(first).expect(200));

    const reuse = await refresh(first).expect(401);
    expect(reuse.body).toMatchObject({
      status: 401,
      code: 'UNAUTHENTICATED',
    });
    expect(reuse.headers['set-cookie'][0]).toMatch(
      /^shanflow_refresh=;.*Expires=Thu, 01 Jan 1970/,
    );
    const sessions = await prisma.refreshSession.findMany({
      where: { userId: user.id },
    });
    expect(sessions).toHaveLength(2);
    expect(sessions.every((session) => session.revokedAt !== null)).toBe(true);
    // The legitimate newest token is dead too.
    await refresh(second).expect(401);
  });

  it('does not touch other login sessions when one family is revoked', async () => {
    const user = await createUser();
    const { cookie: laptop } = await loginAs(user.email);
    const { cookie: phone } = await loginAs(user.email);
    const next = cookiePair(await refresh(laptop).expect(200));
    await refresh(laptop).expect(401); // reuse revokes the laptop family only
    await refresh(next).expect(401);
    await refresh(phone).expect(200);
  });

  it('lets exactly one of several concurrent refreshes with the same token win', async () => {
    const user = await createUser();
    const { cookie } = await loginAs(user.email);
    const results = await Promise.all(
      Array.from({ length: 5 }, () => refresh(cookie)),
    );
    const statuses = results
      .map((result) => result.status)
      .sort((a, b) => a - b);
    expect(statuses).toEqual([200, 401, 401, 401, 401]);
    const sessions = await prisma.refreshSession.findMany({
      where: { userId: user.id },
    });
    // Never two successors for one token; the loser's reuse detection revoked the family.
    expect(sessions).toHaveLength(2);
    expect(sessions.every((session) => session.revokedAt !== null)).toBe(true);
  });

  it('rejects a missing, malformed or unknown token and clears the cookie when one was sent', async () => {
    const none = await refresh().expect(401);
    expect(none.body.code).toBe('UNAUTHENTICATED');
    for (const value of ['garbage', 'a'.repeat(43), '%00']) {
      const response = await refresh(`shanflow_refresh=${value}`).expect(401);
      expect(response.body).toEqual(none.body);
      expect(response.headers['set-cookie'][0]).toMatch(/^shanflow_refresh=;/);
    }
  });

  it('rejects an expired session', async () => {
    const user = await createUser();
    const { cookie } = await loginAs(user.email);
    const session = await sessionFor(cookie);
    const day = 86_400_000;
    await prisma.refreshSession.update({
      where: { id: session.id },
      data: {
        createdAt: new Date(Date.now() - 2 * day),
        expiresAt: new Date(Date.now() - day),
      },
    });
    await refresh(cookie).expect(401);
    const after = await prisma.refreshSession.findUniqueOrThrow({
      where: { id: session.id },
    });
    expect(after.usedAt).toBeNull();
  });

  it('refuses and revokes the family of a suspended account', async () => {
    const user = await createUser();
    const { cookie } = await loginAs(user.email);
    await prisma.user.update({
      where: { id: user.id },
      data: { accountStatus: 'SUSPENDED' },
    });
    await refresh(cookie).expect(401);
    const session = await sessionFor(cookie);
    expect(session.revokedAt).toBeInstanceOf(Date);
    expect(session.usedAt).toBeNull();
  });

  it('refuses a revoked session without new side effects', async () => {
    const user = await createUser();
    const { cookie } = await loginAs(user.email);
    const session = await sessionFor(cookie);
    await prisma.refreshSession.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });
    await refresh(cookie).expect(401);
    await expect(
      prisma.refreshSession.count({ where: { userId: user.id } }),
    ).resolves.toBe(1);
  });

  it.each([
    ['no Origin', { 'X-Requested-With': 'shanflow' }],
    [
      'a foreign Origin',
      { Origin: 'http://evil.example', 'X-Requested-With': 'shanflow' },
    ],
    ['no marker header', { Origin: ORIGIN }],
    ['a wrong marker value', { Origin: ORIGIN, 'X-Requested-With': 'x' }],
  ])(
    'rejects a cross-site style request (%s) with 403 and consumes nothing',
    async (_name, headers) => {
      const user = await createUser();
      const { cookie } = await loginAs(user.email);
      const response = await refresh(cookie, headers).expect(403);
      expect(response.body).toMatchObject({
        status: 403,
        code: 'CSRF_REJECTED',
      });
      const session = await sessionFor(cookie);
      expect(session.usedAt).toBeNull();
      expect(session.revokedAt).toBeNull();
      // The token is still good for a legitimate request.
      await refresh(cookie).expect(200);
    },
  );

  it('stores only hashes of refresh tokens', async () => {
    const user = await createUser();
    const { cookie } = await loginAs(user.email);
    const next = cookiePair(await refresh(cookie).expect(200));
    const rows = await prisma.refreshSession.findMany({
      where: { userId: user.id },
    });
    for (const raw of [cookie, next].map(cookieValue)) {
      expect(rows.some((row) => row.tokenHash === raw)).toBe(false);
      expect(rows.some((row) => row.tokenHash === hashSecureToken(raw))).toBe(
        true,
      );
    }
  });
});

describe('POST /auth/refresh throttling', () => {
  it('allows 30 requests per minute per client and then returns 429', async () => {
    assertLocalTestDatabase();
    const app = await createApp({ throttle: true });
    try {
      const send = () =>
        request(app.getHttpServer())
          .post('/auth/refresh')
          .set('Origin', ORIGIN)
          .set('X-Requested-With', 'shanflow');
      for (let attempt = 0; attempt < 30; attempt += 1) {
        await send().expect(401);
      }
      const response = await send().expect(429);
      expect(response.body).toMatchObject({
        status: 429,
        code: 'TOO_MANY_REQUESTS',
      });
    } finally {
      await app.close();
    }
  });
});
