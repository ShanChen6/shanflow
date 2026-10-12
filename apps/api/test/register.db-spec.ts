import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { deleteUsers } from './support/db-test-support.js';

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

describe('POST /auth/register (database)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const emails: string[] = [];

  function post(body: unknown) {
    return request(app.getHttpServer())
      .post('/auth/register')
      .send(body as object);
  }

  beforeAll(async () => {
    assertLocalTestDatabase();
    app = await createApp({ throttle: false });
    prisma = app.get(PrismaService);
  });

  afterEach(async () => {
    const users = await prisma.user.findMany({
      where: { email: { in: emails.splice(0) } },
      select: { id: true },
    });
    const ids = users.map((user) => user.id);
    await deleteUsers(prisma, ids);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('creates a user with a hashed credential and returns the public profile', async () => {
    const email = fixtureEmail('register');
    emails.push(email);
    const response = await post({
      email: `  ${email.toUpperCase()} `,
      password: PASSWORD,
      displayName: '  New User ',
    }).expect(201);
    expect(response.body).toEqual({
      user: {
        id: expect.any(String),
        email,
        displayName: 'New User',
        emailVerified: false,
      },
    });
    expect(JSON.stringify(response.body)).not.toContain(PASSWORD);

    const stored = await prisma.user.findUniqueOrThrow({
      where: { email },
      include: { passwordCredential: true },
    });
    expect(stored.accountStatus).toBe('ACTIVE');
    expect(stored.emailVerifiedAt).toBeNull();
    expect(stored.passwordCredential?.passwordHash).toMatch(/^\$argon2id\$/);
    expect(stored.passwordCredential?.passwordHash).not.toContain(PASSWORD);
  });

  it('rejects a duplicate canonical email with 409 and creates nothing extra', async () => {
    const email = fixtureEmail('duplicate');
    emails.push(email);
    const body = { email, password: PASSWORD, displayName: 'First' };
    await post(body).expect(201);
    const response = await post({
      ...body,
      email: email.toUpperCase(),
      displayName: 'Second',
    }).expect(409);
    expect(response.type).toBe('application/problem+json');
    expect(response.body).toMatchObject({
      status: 409,
      code: 'EMAIL_ALREADY_REGISTERED',
    });
    await expect(prisma.user.count({ where: { email } })).resolves.toBe(1);
    await expect(
      prisma.passwordCredential.count({ where: { user: { email } } }),
    ).resolves.toBe(1);
  });

  it('lets exactly one of several concurrent signups for the same email succeed', async () => {
    const email = fixtureEmail('race');
    emails.push(email);
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, index) =>
        post({ email, password: PASSWORD, displayName: `Racer ${index}` }),
      ),
    );
    const statuses = results
      .map((result) => result.status)
      .sort((a, b) => a - b);
    expect(statuses).toEqual([201, 409, 409, 409, 409]);
    await expect(prisma.user.count({ where: { email } })).resolves.toBe(1);
  });

  it('returns 400 with field paths and without echoing the password', async () => {
    const weak = 'short';
    const response = await post({
      email: 'not-an-email',
      password: weak,
      displayName: '',
    }).expect(400);
    expect(response.body.code).toBe('VALIDATION_FAILED');
    expect(
      response.body.issues.map((issue: { path: string }) => issue.path).sort(),
    ).toEqual(['displayName', 'email', 'password']);
    expect(JSON.stringify(response.body)).not.toContain(weak);
  });

  it('rejects missing and malformed JSON bodies', async () => {
    await post(undefined).expect(400);
    await request(app.getHttpServer())
      .post('/auth/register')
      .set('Content-Type', 'application/json')
      .send('{not json')
      .expect(400);
  });
});

describe('POST /auth/register throttling', () => {
  let app: INestApplication;

  beforeAll(async () => {
    assertLocalTestDatabase();
    // Fresh app means fresh in-memory counters.
    app = await createApp({ throttle: true });
  });

  afterAll(async () => {
    await app?.close();
  });

  it('allows five requests per hour per client and then returns 429', async () => {
    const send = () =>
      request(app.getHttpServer()).post('/auth/register').send({});
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await send().expect(400);
    }
    const response = await send().expect(429);
    expect(response.body).toMatchObject({
      status: 429,
      code: 'TOO_MANY_REQUESTS',
    });
  });
});
