import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/database/prisma.service.js';
import {
  CSRF_HEADERS,
  PASSWORD,
  cookiePairFrom,
  createTestApp,
  createUser,
  deleteUsers,
} from './support/db-test-support.js';

const NEW_PASSWORD = 'an entirely different passphrase';

describe('POST /auth/password/change (database)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const userIds: string[] = [];

  const http = () => request(app.getHttpServer());
  const login = (email: string, password = PASSWORD) =>
    http().post('/auth/login').send({ email, password });
  const refresh = (cookie: string) =>
    http().post('/auth/refresh').set(CSRF_HEADERS).set('Cookie', cookie);
  const change = (
    accessToken: string | undefined,
    body: { currentPassword?: unknown; newPassword?: unknown },
  ) => {
    const call = http().post('/auth/password/change').send(body);
    return accessToken
      ? call.set('Authorization', `Bearer ${accessToken}`)
      : call;
  };

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

  it('changes the password, signs out every other device and keeps this one signed in', async () => {
    const user = await createUser(prisma, userIds, { label: 'change' });
    const here = await login(user.email).expect(200);
    const elsewhere = await login(user.email).expect(200);
    const accessToken = here.body.accessToken as string;

    await change(accessToken, {
      currentPassword: PASSWORD,
      newPassword: NEW_PASSWORD,
    }).expect(204);

    await login(user.email, PASSWORD).expect(401);
    await login(user.email, NEW_PASSWORD).expect(200);
    await refresh(cookiePairFrom(elsewhere)).expect(401);
    // The device that changed the password is not logged out, and its token still works.
    await refresh(cookiePairFrom(here)).expect(200);
    await http()
      .get('/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
  });

  it('refuses a wrong current password and changes nothing', async () => {
    const user = await createUser(prisma, userIds, { label: 'wrong' });
    const elsewhere = await login(user.email).expect(200);
    const accessToken = (await login(user.email).expect(200)).body
      .accessToken as string;
    const response = await change(accessToken, {
      currentPassword: 'definitely not it',
      newPassword: NEW_PASSWORD,
    }).expect(400);
    expect(response.body).toMatchObject({
      code: 'WRONG_PASSWORD',
      status: 400,
    });
    await login(user.email, PASSWORD).expect(200);
    await refresh(cookiePairFrom(elsewhere)).expect(200);
  });

  it('refuses a new password equal to the current one and a weak one', async () => {
    const user = await createUser(prisma, userIds, { label: 'same' });
    const accessToken = (await login(user.email).expect(200)).body
      .accessToken as string;
    const same = await change(accessToken, {
      currentPassword: PASSWORD,
      newPassword: PASSWORD,
    }).expect(400);
    expect(same.body.code).toBe('PASSWORD_UNCHANGED');
    const weak = await change(accessToken, {
      currentPassword: PASSWORD,
      newPassword: 'short',
    }).expect(400);
    expect(weak.body.code).toBe('VALIDATION_FAILED');
    expect(JSON.stringify(weak.body)).not.toContain(PASSWORD);
  });

  it('requires authentication', async () => {
    await change(undefined, {
      currentPassword: PASSWORD,
      newPassword: NEW_PASSWORD,
    }).expect(401);
    await change('not-a-jwt', {
      currentPassword: PASSWORD,
      newPassword: NEW_PASSWORD,
    }).expect(401);
  });

  it('honours revocation immediately even though the access token is still valid', async () => {
    const user = await createUser(prisma, userIds, { label: 'revoked' });
    const session = await login(user.email).expect(200);
    const accessToken = session.body.accessToken as string;
    await http()
      .post('/auth/logout-all')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(204);
    // The stateless guard still accepts the token...
    await http()
      .get('/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    // ...but a sensitive operation checks the session in the database.
    await change(accessToken, {
      currentPassword: PASSWORD,
      newPassword: NEW_PASSWORD,
    }).expect(401);
    await login(user.email, PASSWORD).expect(200);
  });

  it('tells a Google-only account to use the reset flow', async () => {
    const user = await createUser(prisma, userIds, {
      label: 'oauth-only',
      password: null,
    });
    // Without a password this account has no session to sign in with; issue one directly.
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
    const response = await change(token, {
      currentPassword: 'anything',
      newPassword: NEW_PASSWORD,
    }).expect(400);
    expect(response.body.code).toBe('PASSWORD_NOT_SET');
  });

  it('refuses a suspended account', async () => {
    const user = await createUser(prisma, userIds, { label: 'suspended' });
    const accessToken = (await login(user.email).expect(200)).body
      .accessToken as string;
    await prisma.user.update({
      where: { id: user.id },
      data: { accountStatus: 'SUSPENDED' },
    });
    await change(accessToken, {
      currentPassword: PASSWORD,
      newPassword: NEW_PASSWORD,
    }).expect(401);
  });
});

describe('POST /auth/password/change throttling', () => {
  it('allows 5 attempts per 15 minutes per user without blocking other users', async () => {
    const { app } = await createTestApp({ throttle: true });
    const prisma = app.get(PrismaService);
    const ids: string[] = [];
    try {
      const first = await createUser(prisma, ids, { label: 'throttle-a' });
      const second = await createUser(prisma, ids, { label: 'throttle-b' });
      const token = async (email: string) =>
        (
          await request(app.getHttpServer())
            .post('/auth/login')
            .send({ email, password: PASSWORD })
            .expect(200)
        ).body.accessToken as string;
      const [tokenA, tokenB] = [
        await token(first.email),
        await token(second.email),
      ];
      const attempt = (accessToken: string) =>
        request(app.getHttpServer())
          .post('/auth/password/change')
          .set('Authorization', `Bearer ${accessToken}`)
          .send({ currentPassword: 'wrong guess', newPassword: NEW_PASSWORD });
      for (let count = 0; count < 5; count += 1)
        await attempt(tokenA).expect(400);
      const blocked = await attempt(tokenA).expect(429);
      expect(blocked.body.code).toBe('TOO_MANY_REQUESTS');
      await attempt(tokenB).expect(400);
    } finally {
      await deleteUsers(prisma, ids);
      await app.close();
    }
  });
});
