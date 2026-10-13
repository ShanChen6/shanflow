import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/database/prisma.service.js';
import type { InMemoryMailer } from '../src/shared/mail/mailer.js';
import {
  CSRF_HEADERS,
  PASSWORD,
  cookiePairFrom,
  createTestApp,
  createUser,
  deleteUsers,
  fixtureEmail,
  tokenFromEmail,
} from './support/db-test-support.js';

const NEW_PASSWORD = 'an entirely different passphrase';

describe('Password reset (database)', () => {
  let app: INestApplication;
  let mailer: InMemoryMailer;
  let prisma: PrismaService;
  const userIds: string[] = [];

  const http = () => request(app.getHttpServer());
  const forgot = (email: unknown) =>
    http().post('/auth/password/forgot').send({ email });
  const reset = (token: unknown, newPassword: unknown = NEW_PASSWORD) =>
    http().post('/auth/password/reset').send({ token, newPassword });
  const login = (email: string, password: string) =>
    http().post('/auth/login').send({ email, password });

  async function resetTokenFor(email: string): Promise<string> {
    await forgot(email).expect(202);
    return tokenFromEmail(mailer.last(email)?.text);
  }

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

  describe('POST /auth/password/forgot', () => {
    it('emails a reset link to an active account, whatever the email casing', async () => {
      const user = await createUser(prisma, userIds, { label: 'forgot' });
      await forgot(` ${user.email.toUpperCase()} `).expect(202);
      const message = mailer.last(user.email);
      expect(message?.subject).toBe('Reset your Shanflow password');
      expect(message?.text).toContain(
        'http://localhost:3000/reset-password?token=',
      );
      const token = tokenFromEmail(message?.text);
      const row = await prisma.oneTimeToken.findFirstOrThrow({
        where: { userId: user.id },
      });
      expect(row.purpose).toBe('PASSWORD_RESET');
      expect(row.tokenHash).not.toContain(token);
      expect(row.email).toBeNull();
    });

    it('answers identically for unknown, suspended and real accounts, and mails only the real one', async () => {
      const real = await createUser(prisma, userIds, { label: 'real' });
      const suspended = await createUser(prisma, userIds, {
        label: 'suspended',
        status: 'SUSPENDED',
      });
      const responses = [
        await forgot(real.email).expect(202),
        await forgot(fixtureEmail('nobody')).expect(202),
        await forgot(suspended.email).expect(202),
      ];
      for (const response of responses) {
        expect(response.body).toEqual(responses[0]!.body);
        expect(response.text).toBe(responses[0]!.text);
      }
      expect(mailer.outbox).toHaveLength(1);
      expect(mailer.outbox[0]?.to).toBe(real.email);
    });

    it('lets a Google-only account (no password) obtain a link too', async () => {
      const user = await createUser(prisma, userIds, {
        label: 'oauth-only',
        password: null,
      });
      await forgot(user.email).expect(202);
      expect(mailer.last(user.email)).toBeDefined();
    });

    it('validates the request and survives a mail failure', async () => {
      const bad = await forgot('not-an-email').expect(400);
      expect(bad.body.code).toBe('VALIDATION_FAILED');
      const user = await createUser(prisma, userIds, { label: 'mailfail' });
      const original = mailer.send.bind(mailer);
      mailer.send = () => Promise.reject(new Error('smtp down'));
      try {
        await forgot(user.email).expect(202);
      } finally {
        mailer.send = original;
      }
    });

    it('issues a new link that replaces the old one', async () => {
      const user = await createUser(prisma, userIds, { label: 'replace' });
      const first = await resetTokenFor(user.email);
      const second = await resetTokenFor(user.email);
      await reset(first).expect(400);
      await reset(second).expect(204);
    });
  });

  describe('POST /auth/password/reset', () => {
    it('sets the new password, ends every session and does not sign anyone in', async () => {
      const user = await createUser(prisma, userIds, { label: 'reset' });
      const bystander = await createUser(prisma, userIds, {
        label: 'bystander',
      });
      const laptop = await login(user.email, PASSWORD).expect(200);
      const phone = await login(user.email, PASSWORD).expect(200);
      const other = await login(bystander.email, PASSWORD).expect(200);
      const token = await resetTokenFor(user.email);

      const response = await reset(token).expect(204);
      expect(response.headers['set-cookie']).toBeUndefined();

      // New password works, old one does not.
      await login(user.email, PASSWORD).expect(401);
      await login(user.email, NEW_PASSWORD).expect(200);
      // Every earlier session is dead; someone else's is not.
      for (const stale of [laptop, phone]) {
        await http()
          .post('/auth/refresh')
          .set(CSRF_HEADERS)
          .set('Cookie', cookiePairFrom(stale))
          .expect(401);
      }
      await http()
        .post('/auth/refresh')
        .set(CSRF_HEADERS)
        .set('Cookie', cookiePairFrom(other))
        .expect(200);
    });

    it('tells the owner by email that the password was reset', async () => {
      const user = await createUser(prisma, userIds, { label: 'reset-notice' });
      const token = await resetTokenFor(user.email);
      await reset(token).expect(204);
      const notice = mailer.last(user.email);
      expect(notice?.subject).toBe('Your Shanflow password was changed');
      expect(notice?.text).toMatch(/was just reset/);
      expect(notice?.text).not.toContain(token);
      expect(notice?.text).not.toContain(NEW_PASSWORD);
    });

    it('sends no notice for a rejected reset', async () => {
      const user = await createUser(prisma, userIds, {
        label: 'reset-no-notice',
      });
      await resetTokenFor(user.email);
      const before = mailer.outbox.length;
      await reset('A'.repeat(43)).expect(400);
      expect(mailer.outbox).toHaveLength(before);
    });

    it('works once, and only for reset links', async () => {
      const user = await createUser(prisma, userIds, { label: 'once' });
      const token = await resetTokenFor(user.email);
      await reset(token).expect(204);
      const again = await reset(token, 'yet another passphrase here').expect(
        400,
      );
      expect(again.body.code).toBe('INVALID_TOKEN');
      await login(user.email, NEW_PASSWORD).expect(200);

      // A verification link must not reset a password.
      const other = await createUser(prisma, userIds, {
        label: 'wrongpurpose',
      });
      const accessToken = (await login(other.email, PASSWORD).expect(200)).body
        .accessToken as string;
      await http()
        .post('/auth/email-verification/request')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(202);
      const verificationToken = tokenFromEmail(mailer.last(other.email)?.text);
      await reset(verificationToken).expect(400);
      await login(other.email, PASSWORD).expect(200);
    });

    it('rejects unknown, malformed and expired tokens and weak passwords', async () => {
      const user = await createUser(prisma, userIds, { label: 'invalid' });
      const token = await resetTokenFor(user.email);
      expect((await reset('A'.repeat(43)).expect(400)).body.code).toBe(
        'INVALID_TOKEN',
      );
      expect((await reset('short').expect(400)).body.code).toBe(
        'VALIDATION_FAILED',
      );
      const weak = await reset(token, 'short').expect(400);
      expect(weak.body.code).toBe('VALIDATION_FAILED');
      expect(JSON.stringify(weak.body)).not.toContain('short"');
      // The rejected attempts must not have burned or changed anything.
      await login(user.email, PASSWORD).expect(200);

      await prisma.oneTimeToken.updateMany({
        where: { userId: user.id },
        data: {
          createdAt: new Date(Date.now() - 2 * 3_600_000),
          expiresAt: new Date(Date.now() - 1000),
        },
      });
      await reset(token).expect(400);
      await login(user.email, PASSWORD).expect(200);
    });

    it('refuses a suspended account and leaves its password alone', async () => {
      const user = await createUser(prisma, userIds, { label: 'suspend' });
      const token = await resetTokenFor(user.email);
      await prisma.user.update({
        where: { id: user.id },
        data: { accountStatus: 'SUSPENDED' },
      });
      await reset(token).expect(400);
      await prisma.user.update({
        where: { id: user.id },
        data: { accountStatus: 'ACTIVE' },
      });
      await login(user.email, PASSWORD).expect(200);
      // The failed attempt rolled back, so the link was not consumed.
      const row = await prisma.oneTimeToken.findFirstOrThrow({
        where: { userId: user.id },
      });
      expect(row.usedAt).toBeNull();
    });

    it('marks the email verified, since the mailbox was proven', async () => {
      const user = await createUser(prisma, userIds, { label: 'verified' });
      const token = await resetTokenFor(user.email);
      await reset(token).expect(204);
      const after = await prisma.user.findUniqueOrThrow({
        where: { id: user.id },
      });
      expect(after.emailVerifiedAt).toBeInstanceOf(Date);
    });

    it('lets a Google-only account set a first password', async () => {
      const user = await createUser(prisma, userIds, {
        label: 'first-password',
        password: null,
      });
      const token = await resetTokenFor(user.email);
      await reset(token).expect(204);
      await login(user.email, NEW_PASSWORD).expect(200);
      await expect(
        prisma.passwordCredential.count({ where: { userId: user.id } }),
      ).resolves.toBe(1);
    });

    it('lets exactly one of several concurrent resets win and keeps that password', async () => {
      const user = await createUser(prisma, userIds, { label: 'race' });
      const token = await resetTokenFor(user.email);
      const passwords = Array.from(
        { length: 5 },
        (_, index) => `passphrase number ${index} here`,
      );
      const results = await Promise.all(
        passwords.map((password) => reset(token, password)),
      );
      expect(
        results.map((result) => result.status).sort((a, b) => a - b),
      ).toEqual([204, 400, 400, 400, 400]);
      const winner =
        passwords[results.findIndex((result) => result.status === 204)]!;
      await login(user.email, winner).expect(200);
      for (const password of passwords.filter(
        (candidate) => candidate !== winner,
      )) {
        await login(user.email, password).expect(401);
      }
    });
  });
});

describe('Password reset throttling', () => {
  it('limits forgot to 3 per hour per address without blocking other addresses', async () => {
    const { app } = await createTestApp({ throttle: true });
    try {
      const send = (email: string) =>
        request(app.getHttpServer())
          .post('/auth/password/forgot')
          .send({ email });
      const target = fixtureEmail('target');
      for (let attempt = 0; attempt < 3; attempt += 1)
        await send(target).expect(202);
      const blocked = await send(target.toUpperCase()).expect(429);
      expect(blocked.body.code).toBe('TOO_MANY_REQUESTS');
      await send(fixtureEmail('other')).expect(202);
    } finally {
      await app.close();
    }
  });

  it('limits reset attempts to 10 per 15 minutes per client', async () => {
    const { app } = await createTestApp({ throttle: true });
    try {
      const send = () =>
        request(app.getHttpServer())
          .post('/auth/password/reset')
          .send({ token: 'A'.repeat(43), newPassword: NEW_PASSWORD });
      for (let attempt = 0; attempt < 10; attempt += 1)
        await send().expect(400);
      await send().expect(429);
    } finally {
      await app.close();
    }
  });
});
