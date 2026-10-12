import type { INestApplication } from '@nestjs/common';
import { getUserMeResponseSchema } from '@shanflow/contracts';
import request from 'supertest';
import { PrismaService } from '../src/database/prisma.service.js';
import {
  PASSWORD,
  createTestApp,
  createUser,
  deleteUsers,
} from './support/db-test-support.js';

describe('GET /users/me (database)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const userIds: string[] = [];

  const http = () => request(app.getHttpServer());
  const me = (accessToken?: string) => {
    const call = http().get('/users/me');
    return accessToken
      ? call.set('Authorization', `Bearer ${accessToken}`)
      : call;
  };
  const login = async (email: string) =>
    (
      await http()
        .post('/auth/login')
        .send({ email, password: PASSWORD })
        .expect(200)
    ).body.accessToken as string;

  beforeAll(async () => {
    ({ app } = await createTestApp());
    prisma = app.get(PrismaService);
  });

  afterEach(async () => {
    await deleteUsers(prisma, userIds);
  });

  afterAll(async () => {
    await app?.close();
  });

  it("returns the signed-in user's profile, valid against the shared contract", async () => {
    const user = await createUser(prisma, userIds, {
      label: 'profile',
      verified: true,
    });
    const stored = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    const response = await me(await login(user.email)).expect(200);

    expect(getUserMeResponseSchema.safeParse(response.body).success).toBe(true);
    expect(response.body).toEqual({
      user: {
        id: user.id,
        email: user.email,
        emailVerified: true,
        displayName: 'Test User',
        avatarUrl: null,
        createdAt: stored.createdAt.toISOString(),
        updatedAt: stored.updatedAt.toISOString(),
      },
    });
    expect(response.headers['cache-control']).toBe('private, no-store');
  });

  it('never exposes credentials, account status or anything outside the allow-list', async () => {
    const user = await createUser(prisma, userIds, { label: 'secrets' });
    const response = await me(await login(user.email)).expect(200);
    expect(Object.keys(response.body)).toEqual(['user']);
    expect(Object.keys(response.body.user).sort()).toEqual([
      'avatarUrl',
      'createdAt',
      'displayName',
      'email',
      'emailVerified',
      'id',
      'updatedAt',
    ]);
    const text = JSON.stringify(response.body);
    for (const leaked of [
      'argon2',
      'passwordHash',
      'password_hash',
      'accountStatus',
      'tokenHash',
    ]) {
      expect(text).not.toContain(leaked);
    }
  });

  it('reports an unverified email and returns a stored https avatar', async () => {
    const user = await createUser(prisma, userIds, { label: 'avatar' });
    await prisma.user.update({
      where: { id: user.id },
      data: { avatarUrl: 'https://images.example.invalid/a.png' },
    });
    const { body } = await me(await login(user.email)).expect(200);
    expect(body.user).toMatchObject({
      emailVerified: false,
      avatarUrl: 'https://images.example.invalid/a.png',
    });
  });

  it('never hands out a stored avatar that is not https', async () => {
    const user = await createUser(prisma, userIds, { label: 'unsafe-avatar' });
    const accessToken = await login(user.email);
    for (const unsafe of [
      'http://images.example.invalid/a.png',
      'javascript:alert(1)',
      'not a url',
    ]) {
      await prisma.user.update({
        where: { id: user.id },
        data: { avatarUrl: unsafe },
      });
      const { body } = await me(accessToken).expect(200);
      expect(body.user.avatarUrl).toBeNull();
    }
  });

  it('answers each caller with their own profile only', async () => {
    const first = await createUser(prisma, userIds, { label: 'first' });
    const second = await createUser(prisma, userIds, { label: 'second' });
    const [tokenA, tokenB] = [
      await login(first.email),
      await login(second.email),
    ];
    expect((await me(tokenA).expect(200)).body.user.id).toBe(first.id);
    expect((await me(tokenB).expect(200)).body.user.id).toBe(second.id);
  });

  it('ignores any id-like input: the user comes from the token alone', async () => {
    const first = await createUser(prisma, userIds, { label: 'mine' });
    const other = await createUser(prisma, userIds, { label: 'other' });
    // Log in first: a supertest request must be built and sent without awaiting another request in between.
    const accessToken = await login(first.email);
    const response = await http()
      .get(`/users/me?id=${other.id}&userId=${other.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-User-Id', other.id)
      .expect(200);
    expect(response.body.user.id).toBe(first.id);
  });

  it('requires a valid access token, with the same problem+json as the other routes', async () => {
    const response = await me().expect(401);
    expect(response.type).toBe('application/problem+json');
    expect(response.headers['www-authenticate']).toBe('Bearer');
    expect(response.body).toMatchObject({
      status: 401,
      code: 'UNAUTHENTICATED',
    });
    await me('not-a-jwt').expect(401);
  });

  it('treats a suspended or deleted account as signed out even with a valid token', async () => {
    const suspended = await createUser(prisma, userIds, { label: 'suspended' });
    const suspendedToken = await login(suspended.email);
    await prisma.user.update({
      where: { id: suspended.id },
      data: { accountStatus: 'SUSPENDED' },
    });
    await me(suspendedToken).expect(401);

    const gone = await createUser(prisma, userIds, { label: 'gone' });
    const goneToken = await login(gone.email);
    await deleteUsers(prisma, [gone.id]);
    await me(goneToken).expect(401);
  });

  it('works for a Google-only account that has no password', async () => {
    const user = await createUser(prisma, userIds, {
      label: 'oauth-only',
      password: null,
    });
    const { RefreshSessionStore } =
      await import('../src/features/auth/shared/refresh-session.store.js');
    const { AccessTokenService } =
      await import('../src/features/auth/shared/access-token.service.js');
    const session = await app
      .get(RefreshSessionStore, { strict: false })
      .createFamily(user.id);
    const { token } = await app
      .get(AccessTokenService, { strict: false })
      .sign({ userId: user.id, sessionId: session.sessionId });
    expect((await me(token).expect(200)).body.user.email).toBe(user.email);
  });

  it('leaves /auth/me untouched: authentication state stays there', async () => {
    const user = await createUser(prisma, userIds, { label: 'auth-me' });
    const accessToken = await login(user.email);
    const { body } = await http()
      .get('/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(body.security).toEqual({ hasPassword: true, linkedProviders: [] });
  });
});
