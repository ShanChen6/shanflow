import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { avatarResponseSchema } from '@shanflow/contracts';
import request from 'supertest';
import sharp from 'sharp';
import { PrismaService } from '../src/database/prisma.service.js';
import {
  PASSWORD,
  createTestApp,
  createUser,
  deleteUsers,
} from './support/db-test-support.js';

const image = (format: 'png' | 'jpeg' | 'webp', size = 400) =>
  sharp({
    create: {
      width: size,
      height: size / 2,
      channels: 3,
      background: { r: 200, g: 40, b: 40 },
    },
  })
    [format]()
    .toBuffer();

describe('avatar (database)', () => {
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
  const put = (token: string, type: string, body: Buffer) =>
    http()
      .put('/users/me/avatar')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', type)
      .send(body);
  const filesOf = (userId: string) => {
    const dir = join(process.env.AVATAR_STORAGE_DIR!, userId);
    return existsSync(dir) ? readdirSync(dir) : [];
  };

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

  it.each(['png', 'jpeg', 'webp'] as const)(
    're-encodes an uploaded %s to a 256x256 WebP and serves it',
    async (format) => {
      const { user, token } = await signedIn();
      const res = await put(
        token,
        `image/${format}`,
        await image(format),
      ).expect(200);
      expect(avatarResponseSchema.safeParse(res.body).success).toBe(true);
      const url = new URL(res.body.user.avatarUrl);
      expect(url.pathname).toBe(`/users/${user.id}/avatar`);
      const served = await http()
        .get(`${url.pathname}${url.search}`)
        .buffer(true)
        .parse((r, cb) => {
          const chunks: Buffer[] = [];
          r.on('data', (c: Buffer) => chunks.push(c));
          r.on('end', () => cb(null, Buffer.concat(chunks)));
        })
        .expect(200);
      expect(served.headers['content-type']).toBe('image/webp');
      expect(served.headers['x-content-type-options']).toBe('nosniff');
      expect(served.headers['cross-origin-resource-policy']).toBe('same-site');
      expect(served.headers['cache-control']).toContain('immutable');
      const meta = await sharp(served.body).metadata();
      expect([meta.format, meta.width, meta.height]).toEqual([
        'webp',
        256,
        256,
      ]);
      const etag = served.headers.etag as string;
      await http()
        .get(`${url.pathname}${url.search}`)
        .set('If-None-Match', etag)
        .expect(304);
    },
  );

  it('strips metadata from the stored image', async () => {
    const { token } = await signedIn();
    const withExif = await sharp(await image('jpeg'))
      .withExif({ IFD0: { Copyright: 'secret-marker' } })
      .toBuffer();
    const res = await put(token, 'image/jpeg', withExif).expect(200);
    const url = new URL(res.body.user.avatarUrl);
    const served = await http()
      .get(url.pathname)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect((served.body as Buffer).includes('secret-marker')).toBe(false);
    expect((await sharp(served.body).metadata()).exif).toBeUndefined();
  });

  it('replaces the old file without leaving an orphan, and delete removes everything', async () => {
    const { user, token } = await signedIn();
    await put(token, 'image/png', await image('png')).expect(200);
    const first = filesOf(user.id);
    expect(first).toHaveLength(1);
    await put(token, 'image/png', await image('png', 300)).expect(200);
    const second = filesOf(user.id);
    expect(second).toHaveLength(1);
    expect(second[0]).not.toBe(first[0]);

    const res = await http()
      .delete('/users/me/avatar')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body.user.avatarUrl).toBeNull();
    expect(filesOf(user.id)).toHaveLength(0);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect([row.avatarStorageKey, row.avatarUpdatedAt, row.avatarUrl]).toEqual([
      null,
      null,
      null,
    ]);
    await http().get(`/users/${user.id}/avatar`).expect(404);
  });

  it('rejects wrong declared types, corrupt data and fake images', async () => {
    const { user, token } = await signedIn();
    await put(token, 'image/gif', await image('png')).expect(415);
    await put(token, 'text/html', Buffer.from('<script>1</script>')).expect(
      415,
    );
    await put(token, 'image/png', Buffer.from('not an image')).expect(400);
    // A PNG header followed by garbage.
    const truncated = (await image('png')).subarray(0, 60);
    await put(token, 'image/png', truncated).expect(400);
    // Declared png but really an SVG.
    await put(
      token,
      'image/png',
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'),
    ).expect(400);
    expect(filesOf(user.id)).toHaveLength(0);
  });

  it('rejects an oversized upload (declared and streamed) and an image bomb', async () => {
    const { token } = await signedIn();
    const big = Buffer.alloc(2 * 1024 * 1024 + 1, 1);
    await put(token, 'image/png', big).expect(413);
    // 10000x10000 of one colour compresses tiny but exceeds the pixel limit.
    const bomb = await sharp({
      create: {
        width: 10000,
        height: 10000,
        channels: 3,
        background: { r: 0, g: 0, b: 0 },
      },
    })
      .png({ compressionLevel: 9 })
      .toBuffer();
    if (bomb.length <= 2 * 1024 * 1024)
      await put(token, 'image/png', bomb).expect(400);
  }, 60_000);

  it('requires authentication and an active account', async () => {
    await http()
      .put('/users/me/avatar')
      .set('Content-Type', 'image/png')
      .send(await image('png'))
      .expect(401);
    await http().delete('/users/me/avatar').expect(401);
    const { user, token } = await signedIn();
    await put(token, 'image/png', await image('png')).expect(200);
    await prisma.user.update({
      where: { id: user.id },
      data: { accountStatus: 'SUSPENDED' },
    });
    await http().get(`/users/${user.id}/avatar`).expect(404);
    await put(token, 'image/png', await image('png')).expect(401);
  });

  it('returns 404 for unknown ids and malformed ids alike', async () => {
    await http()
      .get('/users/00000000-0000-4000-8000-000000000000/avatar')
      .expect(404);
    await http().get('/users/not-a-uuid/avatar').expect(404);
  });

  it('shows the uploaded avatar in GET /users/me', async () => {
    const { token } = await signedIn();
    await put(token, 'image/webp', await image('webp')).expect(200);
    const me = await http()
      .get('/users/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(me.body.user.avatarUrl).toMatch(/\/avatar\?v=\d+$/);
  });
});
