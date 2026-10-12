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

function refreshCookie(response: request.Response): {
  value: string;
  attributes: string;
} {
  const header = (response.headers['set-cookie'] as unknown as string[]).find(
    (cookie) => cookie.startsWith('shanflow_refresh='),
  );
  if (!header) throw new Error('Missing refresh cookie');
  const [pair = '', ...rest] = header.split('; ');
  return {
    value: pair.slice('shanflow_refresh='.length),
    attributes: rest.join('; '),
  };
}

describe('POST /auth/login (database)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const userIds: string[] = [];

  async function createUser(
    options: {
      withPassword?: boolean;
      status?: 'ACTIVE' | 'SUSPENDED';
      passwordHash?: string;
    } = {},
  ) {
    const email = fixtureEmail('login');
    const user = await prisma.user.create({
      data: {
        email,
        displayName: 'Login Test',
        accountStatus: options.status ?? 'ACTIVE',
        ...(options.withPassword === false
          ? {}
          : {
              passwordCredential: {
                create: {
                  passwordHash:
                    options.passwordHash ?? (await hasher.hash(PASSWORD)),
                },
              },
            }),
      },
    });
    userIds.push(user.id);
    return { ...user, email };
  }

  const login = (body: unknown) =>
    request(app.getHttpServer())
      .post('/auth/login')
      .send(body as object);

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

  it('logs in, returns an access token and sets a hardened refresh cookie', async () => {
    const user = await createUser();
    const response = await login({
      email: ` ${user.email.toUpperCase()} `,
      password: PASSWORD,
    }).expect(200);

    expect(response.body).toEqual({
      accessToken: expect.any(String),
      tokenType: 'Bearer',
      expiresIn: 900,
      user: {
        id: user.id,
        email: user.email,
        displayName: 'Login Test',
        emailVerified: false,
      },
    });
    expect(response.headers['cache-control']).toBe('no-store');
    // The refresh secret must only be in the cookie.
    const cookie = refreshCookie(response);
    expect(JSON.stringify(response.body)).not.toContain(cookie.value);
    expect(cookie.attributes).toMatch(/Path=\/auth/);
    expect(cookie.attributes).toMatch(/HttpOnly/);
    expect(cookie.attributes).toMatch(/SameSite=Strict/);
    expect(cookie.attributes).toMatch(/Expires=/);
    expect(cookie.attributes).not.toMatch(/Secure/); // local http; production forces it

    const stored = await prisma.refreshSession.findUniqueOrThrow({
      where: { tokenHash: hashSecureToken(cookie.value) },
    });
    expect(stored).toMatchObject({
      userId: user.id,
      usedAt: null,
      revokedAt: null,
      replacedById: null,
    });
    expect(stored.tokenHash).not.toBe(cookie.value);
    const days = (stored.expiresAt.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThanOrEqual(30);

    const claims = decodeJwt(response.body.accessToken);
    expect(claims).toMatchObject({
      sub: user.id,
      sid: stored.id,
      iss: 'shanflow-api',
      aud: 'shanflow-web',
    });
    expect(Object.keys(claims).sort()).toEqual([
      'aud',
      'exp',
      'iat',
      'iss',
      'sid',
      'sub',
    ]);
  });

  it('starts an independent session family on every login', async () => {
    const user = await createUser();
    const body = { email: user.email, password: PASSWORD };
    const first = await login(body).expect(200);
    const second = await login(body).expect(200);
    expect(refreshCookie(first).value).not.toBe(refreshCookie(second).value);
    const sessions = await prisma.refreshSession.findMany({
      where: { userId: user.id },
    });
    expect(sessions).toHaveLength(2);
    expect(new Set(sessions.map((session) => session.familyId)).size).toBe(2);
  });

  it('returns the identical 401 for every kind of failure', async () => {
    const active = await createUser();
    const suspended = await createUser({ status: 'SUSPENDED' });
    const oauthOnly = await createUser({ withPassword: false });
    const attempts = [
      { email: fixtureEmail('unknown'), password: PASSWORD },
      { email: active.email, password: 'wrong password entirely' },
      { email: suspended.email, password: PASSWORD },
      { email: oauthOnly.email, password: PASSWORD },
    ];
    const responses = [];
    for (const attempt of attempts) {
      const response = await login(attempt).expect(401);
      expect(response.type).toBe('application/problem+json');
      expect(response.headers['set-cookie']).toBeUndefined();
      responses.push(response.body);
    }
    for (const body of responses) expect(body).toEqual(responses[0]);
    expect(responses[0]).toMatchObject({
      status: 401,
      code: 'INVALID_CREDENTIALS',
    });
    await expect(
      prisma.refreshSession.count({
        where: {
          userId: { in: [active.id, suspended.id, oauthOnly.id] },
        },
      }),
    ).resolves.toBe(0);
  });

  it('upgrades a hash created with weaker parameters', async () => {
    const argon2 = (await import('argon2')).default;
    const weak = await argon2.hash(PASSWORD, {
      type: argon2.argon2id,
      memoryCost: 8192,
      timeCost: 1,
      parallelism: 1,
    });
    const user = await createUser({ passwordHash: weak });
    await login({ email: user.email, password: PASSWORD }).expect(200);
    const credential = await prisma.passwordCredential.findUniqueOrThrow({
      where: { userId: user.id },
    });
    expect(credential.passwordHash).not.toBe(weak);
    expect(hasher.needsRehash(credential.passwordHash)).toBe(false);
    await expect(
      hasher.verify(credential.passwordHash, PASSWORD),
    ).resolves.toBe(true);
  });

  it('validates the request shape with 400 and does not echo the password', async () => {
    const response = await login({
      email: 'not-an-email',
      password: '',
    }).expect(400);
    expect(response.body.code).toBe('VALIDATION_FAILED');
    await login(undefined).expect(400);
  });
});

describe('POST /auth/login throttling', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    assertLocalTestDatabase();
    app = await createApp({ throttle: true });
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('limits 10 attempts per IP and account, without blocking other accounts', async () => {
    const send = (email: string) =>
      request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password: 'wrong password' });
    const target = fixtureEmail('target');
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await send(target).expect(401);
    }
    const blocked = await send(target.toUpperCase()).expect(429);
    expect(blocked.body).toMatchObject({
      status: 429,
      code: 'TOO_MANY_REQUESTS',
    });
    // A different account from the same IP is still served.
    await send(fixtureEmail('other')).expect(401);
    await expect(
      prisma.refreshSession.count({ where: { user: { email: target } } }),
    ).resolves.toBe(0);
  });
});
