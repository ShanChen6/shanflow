import { randomUUID } from 'node:crypto';
import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import { Controller, Get, Module, UseGuards } from '@nestjs/common';
import { SignJWT } from 'jose';
import request from 'supertest';
import { Argon2PasswordHasher } from '../src/shared/crypto/password-hasher.js';
import { AuthModule } from '../src/features/auth/auth.module.js';
import { CurrentPrincipal } from '../src/features/auth/shared/current-principal.decorator.js';
import { JwtAuthGuard } from '../src/features/auth/shared/jwt-auth.guard.js';
import type { Principal } from '../src/features/auth/shared/principal.js';
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

// Stands in for a future feature module (workspace, task) that reuses the auth guard.
@Controller('probe')
class ProbeController {
  @Get()
  @UseGuards(JwtAuthGuard)
  read(@CurrentPrincipal() principal: Principal) {
    return principal;
  }
}

@Module({ imports: [AuthModule], controllers: [ProbeController] })
class ProbeModule {}

const PASSWORD = 'correct horse battery staple';
const hasher = new Argon2PasswordHasher();

function fixtureEmail(label: string): string {
  return `${label}.${randomUUID()}@example.invalid`;
}

describe('GET /auth/me (database)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const userIds: string[] = [];

  async function createUser(status: 'ACTIVE' | 'SUSPENDED' = 'ACTIVE') {
    const email = fixtureEmail('me');
    const user = await prisma.user.create({
      data: {
        email,
        displayName: 'Me Test',
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
    return response;
  }

  const me = (authorization?: string) => {
    const call = request(app.getHttpServer()).get('/auth/me');
    return authorization ? call.set('Authorization', authorization) : call;
  };

  function signToken(
    userId: string,
    options: { secret?: string; issuer?: string; expiresIn?: string } = {},
  ) {
    const secret = new TextEncoder().encode(
      options.secret ?? process.env.JWT_ACCESS_SECRET,
    );
    return new SignJWT({ sid: randomUUID() })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(userId)
      .setIssuer(options.issuer ?? 'shanflow-api')
      .setAudience('shanflow-web')
      .setIssuedAt()
      .setExpirationTime(options.expiresIn ?? '15m')
      .sign(secret);
  }

  beforeAll(async () => {
    assertLocalTestDatabase();
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule, ProbeModule],
    })
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();
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

  it('returns the profile for the token issued by login, and never secrets', async () => {
    const user = await createUser();
    const login = await loginAs(user.email);
    const response = await me(`Bearer ${login.body.accessToken}`).expect(200);
    expect(response.body).toEqual({
      user: {
        id: user.id,
        email: user.email,
        displayName: 'Me Test',
        emailVerified: false,
      },
    });
    expect(response.headers['cache-control']).toBe('no-store');
    const text = JSON.stringify(response.body);
    expect(text).not.toContain('argon2');
    expect(text).not.toContain('password');
  });

  it('reflects email verification', async () => {
    const user = await createUser();
    await prisma.user.update({
      where: { id: user.id },
      data: { emailVerifiedAt: new Date() },
    });
    const login = await loginAs(user.email);
    const response = await me(`Bearer ${login.body.accessToken}`).expect(200);
    expect(response.body.user.emailVerified).toBe(true);
  });

  it('answers 401 problem+json with WWW-Authenticate when no token is sent', async () => {
    const response = await me().expect(401);
    expect(response.type).toBe('application/problem+json');
    expect(response.headers['www-authenticate']).toBe('Bearer');
    expect(response.body).toMatchObject({
      status: 401,
      code: 'UNAUTHENTICATED',
    });
  });

  it('does not accept the refresh cookie as a credential', async () => {
    const user = await createUser();
    const login = await loginAs(user.email);
    const cookie = (login.headers['set-cookie'] as unknown as string[])[0]!;
    await me().set('Cookie', cookie.split(';')[0]!).expect(401);
  });

  it('rejects forged, foreign, expired and malformed tokens with one identical response', async () => {
    const user = await createUser();
    const valid = await signToken(user.id);
    const [header, , signature] = valid.split('.');
    const forgedPayload = Buffer.from(
      JSON.stringify({
        sub: user.id,
        sid: randomUUID(),
        iss: 'shanflow-api',
        aud: 'shanflow-web',
        iat: 1,
        exp: 9_999_999_999,
      }),
    ).toString('base64url');
    const attempts = [
      `Bearer ${await signToken(user.id, { secret: 'x'.repeat(40) })}`,
      `Bearer ${await signToken(user.id, { issuer: 'someone-else' })}`,
      `Bearer ${await signToken(user.id, { expiresIn: '-1m' })}`,
      `Bearer ${header}.${forgedPayload}.${signature}`,
      'Bearer not-a-jwt',
      `Token ${valid}`,
      `Basic ${Buffer.from('a:b').toString('base64')}`,
    ];
    const bodies = [];
    for (const attempt of attempts) {
      const response = await me(attempt).expect(401);
      bodies.push(response.body);
    }
    for (const body of bodies) expect(body).toEqual(bodies[0]);
    // Sanity: the untampered token of the same user is accepted.
    await me(`Bearer ${valid}`).expect(200);
  });

  it('treats a suspended account as signed out even with a valid token', async () => {
    const user = await createUser();
    const login = await loginAs(user.email);
    await prisma.user.update({
      where: { id: user.id },
      data: { accountStatus: 'SUSPENDED' },
    });
    await me(`Bearer ${login.body.accessToken}`).expect(401);
  });

  it('treats a deleted account as signed out even with a valid token', async () => {
    const user = await createUser();
    const token = await signToken(user.id);
    await prisma.passwordCredential.delete({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
    userIds.splice(userIds.indexOf(user.id), 1);
    await me(`Bearer ${token}`).expect(401);
  });

  it('lets another feature module protect its routes with the exported guard', async () => {
    const user = await createUser();
    const login = await loginAs(user.email);
    await request(app.getHttpServer()).get('/probe').expect(401);
    const response = await request(app.getHttpServer())
      .get('/probe')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .expect(200);
    expect(response.body).toEqual({
      userId: user.id,
      sessionId: expect.any(String),
    });
  });
});
