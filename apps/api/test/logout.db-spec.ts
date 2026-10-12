import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import request from 'supertest';
import { Argon2PasswordHasher } from '../src/shared/crypto/password-hasher.js';
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

describe('POST /auth/logout and /auth/logout-all (database)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const userIds: string[] = [];

  async function createUser() {
    const email = fixtureEmail('logout');
    const user = await prisma.user.create({
      data: {
        email,
        displayName: 'Logout Test',
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
    return {
      cookie: cookiePair(response),
      accessToken: response.body.accessToken as string,
    };
  }

  const csrf = { Origin: ORIGIN, 'X-Requested-With': 'shanflow' };
  const http = () => request(app.getHttpServer());

  function logout(cookie?: string, headers: Record<string, string> = csrf) {
    let call = http().post('/auth/logout');
    for (const [name, value] of Object.entries(headers)) {
      call = call.set(name, value);
    }
    return cookie ? call.set('Cookie', cookie) : call;
  }

  const refresh = (cookie: string) =>
    http().post('/auth/refresh').set(csrf).set('Cookie', cookie);

  const logoutAll = (accessToken?: string) => {
    const call = http().post('/auth/logout-all');
    return accessToken
      ? call.set('Authorization', `Bearer ${accessToken}`)
      : call;
  };

  const liveSessions = (userId: string) =>
    prisma.refreshSession.count({ where: { userId, revokedAt: null } });

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

  it('logout revokes the whole family, clears the cookie and kills later refreshes', async () => {
    const user = await createUser();
    const { cookie: first } = await loginAs(user.email);
    const second = cookiePair(await refresh(first).expect(200));

    const response = await logout(second).expect(204);
    expect(response.text).toBe('');
    expect(response.headers['set-cookie'][0]).toMatch(
      /^shanflow_refresh=;.*Expires=Thu, 01 Jan 1970/,
    );
    expect(response.headers['cache-control']).toBe('no-store');
    expect(await liveSessions(user.id)).toBe(0);
    await expect(
      prisma.refreshSession.count({ where: { userId: user.id } }),
    ).resolves.toBe(2);
    await refresh(second).expect(401);
    await refresh(first).expect(401);
  });

  it("logout leaves the user's other devices signed in", async () => {
    const user = await createUser();
    const { cookie: laptop } = await loginAs(user.email);
    const { cookie: phone } = await loginAs(user.email);
    await logout(laptop).expect(204);
    await refresh(laptop).expect(401);
    await refresh(phone).expect(200);
  });

  it('logout is idempotent and also accepts an already consumed token', async () => {
    const user = await createUser();
    const { cookie: first } = await loginAs(user.email);
    const second = cookiePair(await refresh(first).expect(200));
    await logout(first).expect(204); // a consumed generation still proves possession
    expect(await liveSessions(user.id)).toBe(0);
    await logout(first).expect(204);
    await logout(second).expect(204);
  });

  it('logout without a cookie or with an unknown token still answers 204 and clears the cookie', async () => {
    const none = await logout().expect(204);
    expect(none.headers['set-cookie'][0]).toMatch(/^shanflow_refresh=;/);
    const unknown = await logout('shanflow_refresh=not-a-real-token').expect(
      204,
    );
    expect(unknown.headers['set-cookie'][0]).toMatch(/^shanflow_refresh=;/);
  });

  it.each([
    ['no Origin', { 'X-Requested-With': 'shanflow' }],
    [
      'a foreign Origin',
      { Origin: 'http://evil.example', 'X-Requested-With': 'shanflow' },
    ],
    ['no marker header', { Origin: ORIGIN }],
  ])(
    'logout rejects a cross-site style request (%s) with 403 and revokes nothing',
    async (_name, headers) => {
      const user = await createUser();
      const { cookie } = await loginAs(user.email);
      const response = await logout(cookie, headers).expect(403);
      expect(response.body.code).toBe('CSRF_REJECTED');
      expect(await liveSessions(user.id)).toBe(1);
      await refresh(cookie).expect(200);
    },
  );

  it('logout-all requires a valid access token', async () => {
    await logoutAll().expect(401);
    await logoutAll('not-a-jwt').expect(401);
  });

  it("logout-all revokes every family of the user and nobody else's", async () => {
    const user = await createUser();
    const other = await createUser();
    const laptop = await loginAs(user.email);
    const phone = await loginAs(user.email);
    const bystander = await loginAs(other.email);

    const response = await logoutAll(laptop.accessToken).expect(204);
    expect(response.headers['set-cookie'][0]).toMatch(/^shanflow_refresh=;/);
    expect(await liveSessions(user.id)).toBe(0);
    await refresh(laptop.cookie).expect(401);
    await refresh(phone.cookie).expect(401);
    expect(await liveSessions(other.id)).toBe(1);
    await refresh(bystander.cookie).expect(200);

    // Signing in again afterwards works and starts a fresh session.
    const again = await loginAs(user.email);
    await refresh(again.cookie).expect(200);
  });

  it('keeps a still-valid access token usable until it expires (stateless guard, documented limit)', async () => {
    const user = await createUser();
    const { accessToken } = await loginAs(user.email);
    await logoutAll(accessToken).expect(204);
    await http()
      .get('/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
  });

  it('leaves no live session when logout-all races a refresh, in either order', async () => {
    for (let round = 0; round < 6; round += 1) {
      const user = await createUser();
      const { cookie, accessToken } = await loginAs(user.email);
      await Promise.all([refresh(cookie), logoutAll(accessToken)]);
      expect(await liveSessions(user.id)).toBe(0);
    }
  });

  it('leaves no live session when logout races a refresh of the same family', async () => {
    for (let round = 0; round < 6; round += 1) {
      const user = await createUser();
      const { cookie } = await loginAs(user.email);
      await Promise.all([refresh(cookie), logout(cookie)]);
      expect(await liveSessions(user.id)).toBe(0);
    }
  });
});
