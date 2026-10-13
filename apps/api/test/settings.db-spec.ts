import type { INestApplication } from '@nestjs/common';
import { DEFAULT_SETTINGS, settingsResponseSchema } from '@shanflow/contracts';
import request from 'supertest';
import { PrismaService } from '../src/database/prisma.service.js';
import {
  PASSWORD,
  createTestApp,
  createUser,
  deleteUsers,
} from './support/db-test-support.js';

describe('user settings (database)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const userIds: string[] = [];
  const http = () => request(app.getHttpServer());
  const login = async (email: string) =>
    (
      await http()
        .post('/auth/login')
        .send({ email, password: PASSWORD })
        .expect(200)
    ).body.accessToken as string;
  const get = (token: string) =>
    http().get('/users/me/settings').set('Authorization', `Bearer ${token}`);
  const patch = (token: string, body: unknown) =>
    http()
      .patch('/users/me/settings')
      .set('Authorization', `Bearer ${token}`)
      .send(body as object);

  beforeAll(async () => {
    ({ app } = await createTestApp());
    prisma = app.get(PrismaService);
  });
  afterEach(async () => {
    await deleteUsers(prisma, userIds);
    userIds.length = 0;
  });
  afterAll(async () => {
    await app.close();
  });

  async function signedIn() {
    const user = await createUser(prisma, userIds);
    return { user, token: await login(user.email) };
  }

  it('returns the defaults (without creating a row) for a user who never changed anything', async () => {
    const { user, token } = await signedIn();
    const res = await get(token).expect(200);
    expect(settingsResponseSchema.safeParse(res.body).success).toBe(true);
    expect(res.body.settings).toEqual(DEFAULT_SETTINGS);
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(
      await prisma.userSettings.count({ where: { userId: user.id } }),
    ).toBe(0);
  });

  it('changes only the supplied fields and keeps the rest', async () => {
    const { token } = await signedIn();
    await patch(token, { theme: 'dark' }).expect(200);
    const res = await patch(token, {
      timeZone: 'Asia/Ho_Chi_Minh',
      locale: 'vi',
    }).expect(200);
    expect(res.body.settings).toEqual({
      locale: 'vi',
      timeZone: 'Asia/Ho_Chi_Minh',
      theme: 'dark',
    });
    expect((await get(token).expect(200)).body.settings.theme).toBe('dark');
  });

  it('gives a first, partial change the same defaults as no change at all (dark first)', async () => {
    const { user, token } = await signedIn();
    const res = await patch(token, { locale: 'vi' }).expect(200);
    expect(res.body.settings).toEqual({ ...DEFAULT_SETTINGS, locale: 'vi' });
    expect((await prisma.userSettings.findUniqueOrThrow({ where: { userId: user.id } })).theme).toBe('DARK');
  });

  it('rejects invalid values and unknown fields without changing anything', async () => {
    const { user, token } = await signedIn();
    for (const body of [
      {},
      { theme: 'purple' },
      { locale: 'fr' },
      { timeZone: 'Mars/Base' },
      { theme: 'dark', userId: user.id },
    ]) {
      await patch(token, body).expect(400);
    }
    expect(
      await prisma.userSettings.count({ where: { userId: user.id } }),
    ).toBe(0);
  });

  it("never touches another user's settings and ignores ids from the client", async () => {
    const a = await signedIn();
    const b = await signedIn();
    await patch(a.token, { theme: 'dark' }).expect(200);
    expect((await get(b.token).expect(200)).body.settings).toEqual(
      DEFAULT_SETTINGS,
    );
  });

  it('requires authentication and an active account', async () => {
    await http().get('/users/me/settings').expect(401);
    await http()
      .patch('/users/me/settings')
      .send({ theme: 'dark' })
      .expect(401);
    const { user, token } = await signedIn();
    await prisma.user.update({
      where: { id: user.id },
      data: { accountStatus: 'SUSPENDED' },
    });
    await get(token).expect(401);
    await patch(token, { theme: 'dark' }).expect(401);
  });

  it('is removed with the user', async () => {
    const { user, token } = await signedIn();
    await patch(token, { theme: 'light' }).expect(200);
    await deleteUsers(prisma, [user.id]);
    expect(
      await prisma.userSettings.count({ where: { userId: user.id } }),
    ).toBe(0);
    userIds.length = 0;
  });
});
