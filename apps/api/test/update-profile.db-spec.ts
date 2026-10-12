import type { INestApplication } from '@nestjs/common';
import { updateProfileResponseSchema } from '@shanflow/contracts';
import request from 'supertest';
import { PrismaService } from '../src/database/prisma.service.js';
import {
  PASSWORD,
  createTestApp,
  createUser,
  deleteUsers,
} from './support/db-test-support.js';

describe('PATCH /users/me (database)', () => {
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
  const patch = (accessToken: string | undefined, body: unknown) => {
    const call = http()
      .patch('/users/me')
      .send(body as object);
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

  it('changes the display name, persists it and returns the contract-valid profile', async () => {
    const user = await createUser(prisma, userIds, { label: 'rename' });
    const before = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    const accessToken = await login(user.email);

    const response = await patch(accessToken, {
      displayName: '  Nguyễn Văn A  ',
    }).expect(200);
    expect(updateProfileResponseSchema.safeParse(response.body).success).toBe(
      true,
    );
    expect(response.body.user).toMatchObject({
      id: user.id,
      email: user.email,
      displayName: 'Nguyễn Văn A',
    });
    expect(response.headers['cache-control']).toBe('private, no-store');

    const after = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    expect(after.displayName).toBe('Nguyễn Văn A');
    expect(after.updatedAt.getTime()).toBeGreaterThan(
      before.updatedAt.getTime(),
    );
    expect(response.body.user.updatedAt).toBe(after.updatedAt.toISOString());

    // GET sees the same value.
    const read = await http()
      .get('/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(read.body.user.displayName).toBe('Nguyễn Văn A');
  });

  it('normalises the name to NFC before storing it', async () => {
    const user = await createUser(prisma, userIds, { label: 'nfc' });
    await patch(await login(user.email), { displayName: 'Café' }).expect(200);
    const stored = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    expect(stored.displayName).toBe('Café');
  });

  it.each([
    ['an empty name', { displayName: '' }],
    ['only spaces', { displayName: '    ' }],
    ['a name over 80 characters', { displayName: 'n'.repeat(81) }],
    ['a name with a newline', { displayName: 'Ann\nBob' }],
    ['a right-to-left override', { displayName: 'Ann‮txt' }],
    ['a zero-width space', { displayName: 'Ann​Bob' }],
    ['a non-string name', { displayName: 42 }],
    ['an empty body', {}],
  ])('rejects %s with 400 and changes nothing', async (_name, body) => {
    const user = await createUser(prisma, userIds, { label: 'invalid' });
    const accessToken = await login(user.email);
    const response = await patch(accessToken, body).expect(400);
    expect(response.body.code).toBe('VALIDATION_FAILED');
    const stored = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    expect(stored.displayName).toBe('Test User');
  });

  it('refuses to change anything but the display name, and says so', async () => {
    const user = await createUser(prisma, userIds, { label: 'strict' });
    const other = await createUser(prisma, userIds, { label: 'victim' });
    const accessToken = await login(user.email);
    for (const extra of [
      { email: 'hijacked@example.invalid' },
      { avatarUrl: 'https://evil.example.invalid/a.png' },
      { id: other.id },
      { accountStatus: 'SUSPENDED' },
      { emailVerifiedAt: new Date().toISOString() },
    ]) {
      const response = await patch(accessToken, {
        displayName: 'Mallory',
        ...extra,
      }).expect(400);
      expect(response.body.code).toBe('VALIDATION_FAILED');
    }
    const stored = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    expect(stored).toMatchObject({
      displayName: 'Test User',
      email: user.email,
      avatarUrl: null,
      accountStatus: 'ACTIVE',
      emailVerifiedAt: null,
    });
  });

  it('only ever edits the caller, whatever the request carries', async () => {
    const first = await createUser(prisma, userIds, { label: 'mine' });
    const second = await createUser(prisma, userIds, { label: 'theirs' });
    const accessToken = await login(first.email);
    const response = await http()
      .patch(`/users/${second.id}?id=${second.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ displayName: 'Changed' });
    expect(response.status).toBe(404); // there is no per-id route
    await http()
      .patch(`/users/me?id=${second.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-User-Id', second.id)
      .send({ displayName: 'Changed' })
      .expect(200);
    const [mine, theirs] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: first.id } }),
      prisma.user.findUniqueOrThrow({ where: { id: second.id } }),
    ]);
    expect(mine.displayName).toBe('Changed');
    expect(theirs.displayName).toBe('Test User');
  });

  it('requires authentication', async () => {
    const response = await patch(undefined, { displayName: 'Anyone' }).expect(
      401,
    );
    expect(response.body.code).toBe('UNAUTHENTICATED');
    await patch('not-a-jwt', { displayName: 'Anyone' }).expect(401);
  });

  it('refuses a suspended account whose token is still valid, without changing it', async () => {
    const user = await createUser(prisma, userIds, { label: 'suspended' });
    const accessToken = await login(user.email);
    await prisma.user.update({
      where: { id: user.id },
      data: { accountStatus: 'SUSPENDED' },
    });
    await patch(accessToken, { displayName: 'Still Me' }).expect(401);
    const stored = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    expect(stored.displayName).toBe('Test User');
  });

  it('keeps concurrent edits consistent: the last write wins and the row stays valid', async () => {
    const user = await createUser(prisma, userIds, { label: 'concurrent' });
    const accessToken = await login(user.email);
    const names = Array.from({ length: 6 }, (_, index) => `Name ${index}`);
    const results = await Promise.all(
      names.map((displayName) => patch(accessToken, { displayName })),
    );
    expect(results.every((result) => result.status === 200)).toBe(true);
    const stored = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    expect(names).toContain(stored.displayName);
  });

  it('applies to new registrations too: invalid names are rejected at signup', async () => {
    const response = await http()
      .post('/auth/register')
      .send({
        email: 'someone.new@example.invalid',
        password: PASSWORD,
        displayName: 'Ann‮txt',
      })
      .expect(400);
    expect(response.body.code).toBe('VALIDATION_FAILED');
  });
});

describe('PATCH /users/me throttling', () => {
  it('allows 20 updates per minute per user and then returns 429, without affecting other users', async () => {
    const { app } = await createTestApp({ throttle: true });
    const prisma = app.get(PrismaService);
    const ids: string[] = [];
    try {
      const first = await createUser(prisma, ids, { label: 'throttle-a' });
      const second = await createUser(prisma, ids, { label: 'throttle-b' });
      const login = async (email: string) =>
        (
          await request(app.getHttpServer())
            .post('/auth/login')
            .send({ email, password: PASSWORD })
            .expect(200)
        ).body.accessToken as string;
      const [tokenA, tokenB] = [
        await login(first.email),
        await login(second.email),
      ];
      const send = (token: string) =>
        request(app.getHttpServer())
          .patch('/users/me')
          .set('Authorization', `Bearer ${token}`)
          .send({ displayName: 'Same' });
      for (let count = 0; count < 20; count += 1)
        await send(tokenA).expect(200);
      expect((await send(tokenA).expect(429)).body.code).toBe(
        'TOO_MANY_REQUESTS',
      );
      await send(tokenB).expect(200);
    } finally {
      await deleteUsers(prisma, ids);
      await app.close();
    }
  });
});
