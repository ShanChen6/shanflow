import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/database/prisma.service.js';
import type { InMemoryMailer } from '../src/shared/mail/mailer.js';
import {
  PASSWORD,
  createTestApp,
  createUser,
  deleteUsers,
  fixtureEmail,
  tokenFromEmail,
} from './support/db-test-support.js';

describe('Email verification (database)', () => {
  let app: INestApplication;
  let mailer: InMemoryMailer;
  let prisma: PrismaService;
  const userIds: string[] = [];

  const http = () => request(app.getHttpServer());
  const confirm = (token: unknown) =>
    http().post('/auth/email-verification/confirm').send({ token });

  async function loginAs(email: string): Promise<string> {
    const response = await http()
      .post('/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    return response.body.accessToken as string;
  }

  const requestLink = (accessToken?: string) => {
    const call = http().post('/auth/email-verification/request');
    return accessToken
      ? call.set('Authorization', `Bearer ${accessToken}`)
      : call;
  };

  beforeAll(async () => {
    ({ app, mailer } = await createTestApp());
    prisma = app.get(PrismaService);
  });

  afterEach(async () => {
    await deleteUsers(prisma, userIds);
    mailer.outbox.length = 0;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('sends a verification link on registration, which verifies the account once', async () => {
    const email = fixtureEmail('verify');
    await http()
      .post('/auth/register')
      .send({ email, password: PASSWORD, displayName: 'Verify Me' })
      .expect(201);
    const created = await prisma.user.findUniqueOrThrow({ where: { email } });
    userIds.push(created.id);

    const message = mailer.last(email);
    expect(message?.subject).toBe('Verify your Shanflow email');
    expect(message?.text).toContain(
      'http://localhost:3000/verify-email?token=',
    );
    const token = tokenFromEmail(message?.text);
    // The link carries the raw token; the database holds only its hash.
    const row = await prisma.oneTimeToken.findFirstOrThrow({
      where: { userId: created.id },
    });
    expect(row.tokenHash).not.toContain(token);
    expect(row.email).toBe(email);

    await confirm(token).expect(204);
    const verified = await prisma.user.findUniqueOrThrow({
      where: { id: created.id },
    });
    expect(verified.emailVerifiedAt).toBeInstanceOf(Date);

    const accessToken = await loginAs(email);
    const me = await http()
      .get('/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(me.body.user.emailVerified).toBe(true);

    // Single use.
    const again = await confirm(token).expect(400);
    expect(again.body).toMatchObject({ code: 'INVALID_TOKEN', status: 400 });
  });

  it('still registers the user when nothing can be emailed', async () => {
    const email = fixtureEmail('nomail');
    const original = mailer.send.bind(mailer);
    mailer.send = () => Promise.reject(new Error('smtp down'));
    try {
      await http()
        .post('/auth/register')
        .send({ email, password: PASSWORD, displayName: 'No Mail' })
        .expect(201);
    } finally {
      mailer.send = original;
    }
    const created = await prisma.user.findUniqueOrThrow({ where: { email } });
    userIds.push(created.id);
    expect(created.emailVerifiedAt).toBeNull();
  });

  it('rejects unknown, malformed, expired and email-changed tokens with the same answer', async () => {
    const user = await createUser(prisma, userIds, { label: 'bad-token' });
    const accessToken = await loginAs(user.email);
    await requestLink(accessToken).expect(202);
    const good = tokenFromEmail(mailer.last(user.email)?.text);

    const failures = [
      await confirm('A'.repeat(43)).expect(400),
      await confirm('short').expect(400),
      await confirm(undefined).expect(400),
    ];
    expect(failures[0]!.body.code).toBe('INVALID_TOKEN');
    expect(failures[1]!.body.code).toBe('VALIDATION_FAILED');

    // Email changed after the link was sent: the link is void and verifies nothing.
    await prisma.user.update({
      where: { id: user.id },
      data: { email: fixtureEmail('moved') },
    });
    const moved = await confirm(good).expect(400);
    expect(moved.body).toEqual(failures[0]!.body);
    const after = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    expect(after.emailVerifiedAt).toBeNull();
  });

  it('rejects an expired link', async () => {
    const user = await createUser(prisma, userIds, { label: 'expired' });
    const accessToken = await loginAs(user.email);
    await requestLink(accessToken).expect(202);
    const token = tokenFromEmail(mailer.last(user.email)?.text);
    await prisma.oneTimeToken.updateMany({
      where: { userId: user.id },
      data: {
        createdAt: new Date(Date.now() - 2 * 86_400_000),
        expiresAt: new Date(Date.now() - 1000),
      },
    });
    await confirm(token).expect(400);
  });

  it('does not verify a suspended account and keeps the link usable by nobody', async () => {
    const user = await createUser(prisma, userIds, { label: 'suspended' });
    const accessToken = await loginAs(user.email);
    await requestLink(accessToken).expect(202);
    const token = tokenFromEmail(mailer.last(user.email)?.text);
    await prisma.user.update({
      where: { id: user.id },
      data: { accountStatus: 'SUSPENDED' },
    });
    await confirm(token).expect(400);
    const after = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    expect(after.emailVerifiedAt).toBeNull();
    // The failed attempt rolled back, so the claim was not burned.
    const row = await prisma.oneTimeToken.findFirstOrThrow({
      where: { userId: user.id },
    });
    expect(row.usedAt).toBeNull();
  });

  it('resend requires sign-in and replaces the earlier link', async () => {
    await requestLink().expect(401);
    const user = await createUser(prisma, userIds, { label: 'resend' });
    const accessToken = await loginAs(user.email);
    await requestLink(accessToken).expect(202);
    const first = tokenFromEmail(mailer.last(user.email)?.text);
    await requestLink(accessToken).expect(202);
    const second = tokenFromEmail(mailer.last(user.email)?.text);
    expect(second).not.toBe(first);
    await confirm(first).expect(400);
    await confirm(second).expect(204);
  });

  it('answers a resend for an already verified account the same way, without sending mail', async () => {
    const user = await createUser(prisma, userIds, {
      label: 'already',
      verified: true,
    });
    const accessToken = await loginAs(user.email);
    await requestLink(accessToken).expect(202);
    expect(mailer.last(user.email)).toBeUndefined();
    await expect(
      prisma.oneTimeToken.count({ where: { userId: user.id } }),
    ).resolves.toBe(0);
  });

  it('lets exactly one of several concurrent confirmations win', async () => {
    const user = await createUser(prisma, userIds, { label: 'race' });
    const accessToken = await loginAs(user.email);
    await requestLink(accessToken).expect(202);
    const token = tokenFromEmail(mailer.last(user.email)?.text);
    const results = await Promise.all(
      Array.from({ length: 6 }, () => confirm(token)),
    );
    expect(
      results.map((result) => result.status).sort((a, b) => a - b),
    ).toEqual([204, 400, 400, 400, 400, 400]);
  });

  it('confirming does not need a session and does not set one', async () => {
    const user = await createUser(prisma, userIds, { label: 'anon' });
    const accessToken = await loginAs(user.email);
    await requestLink(accessToken).expect(202);
    const token = tokenFromEmail(mailer.last(user.email)?.text);
    const response = await confirm(token).expect(204);
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('needs no Origin check: the emailed token is the only credential', async () => {
    // Confirmation is authenticated by the emailed token alone, so it works from any origin.
    const user = await createUser(prisma, userIds, { label: 'origin' });
    const accessToken = await loginAs(user.email);
    await requestLink(accessToken).expect(202);
    const token = tokenFromEmail(mailer.last(user.email)?.text);
    await http()
      .post('/auth/email-verification/confirm')
      .set('Origin', 'http://elsewhere.example')
      .send({ token })
      .expect(204);
  });
});

describe('Email verification throttling', () => {
  it('limits resend to 3 per hour per user and the limit follows the user, not the address', async () => {
    const { app, mailer } = await createTestApp({ throttle: true });
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
          .post('/auth/email-verification/request')
          .set('Authorization', `Bearer ${token}`);
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await send(tokenA).expect(202);
      }
      const blocked = await send(tokenA).expect(429);
      expect(blocked.body.code).toBe('TOO_MANY_REQUESTS');
      // Another user from the same IP is unaffected.
      await send(tokenB).expect(202);
      expect(mailer.outbox).toHaveLength(4);
    } finally {
      await deleteUsers(prisma, ids);
      await app.close();
    }
  });
});
