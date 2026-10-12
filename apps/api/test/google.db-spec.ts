import { randomUUID } from 'node:crypto';
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
  fixtureEmail,
} from './support/db-test-support.js';
import { FakeGoogle, type FakeIdentity } from './support/fake-google.js';

const WEB = 'http://localhost:3000';
const API = 'http://localhost:3001';
const GOOGLE_ENV = [
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_REDIRECT_URI',
  'GOOGLE_AUTHORIZATION_ENDPOINT',
  'GOOGLE_TOKEN_ENDPOINT',
  'GOOGLE_JWKS_URI',
] as const;

const fixtureIdentity = (
  label: string,
  overrides: Partial<FakeIdentity> = {},
): FakeIdentity => ({
  sub: `sub-${randomUUID()}`,
  email: fixtureEmail(label),
  emailVerified: true,
  name: 'Google Person',
  ...overrides,
});

describe('Google sign-in (database, fake provider)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const google = new FakeGoogle();
  const userIds: string[] = [];
  /** Emails of users created through Google, which the tests did not insert themselves. */
  const googleEmails: string[] = [];

  const http = () => request(app.getHttpServer());

  /** Sends the browser to /auth/google/start and returns what it would carry forward. */
  async function start() {
    const response = await http().get('/auth/google/start').expect(302);
    const stateCookie = (
      response.headers['set-cookie'] as unknown as string[]
    ).find((cookie) => cookie.startsWith('shanflow_oauth='));
    return {
      response,
      authorizationUrl: response.headers.location as string,
      stateCookie: stateCookie?.split(';')[0],
      rawStateCookie: stateCookie,
    };
  }

  /** The provider sends the browser back to the API callback; returns that path and query. */
  async function authorize(authorizationUrl: string): Promise<string> {
    const response = await fetch(authorizationUrl, { redirect: 'manual' });
    const location = new URL(response.headers.get('location') ?? '');
    return `${location.pathname}${location.search}`;
  }

  const complete = (callbackPath: string, stateCookie?: string) => {
    const call = http().get(callbackPath);
    return stateCookie ? call.set('Cookie', stateCookie) : call;
  };

  /** A whole "Continue with Google" round trip for the given Google identity. */
  async function signInWith(identity: FakeIdentity) {
    google.nextIdentity = identity;
    const started = await start();
    const callbackPath = await authorize(started.authorizationUrl);
    return complete(callbackPath, started.stateCookie);
  }

  const redirectOf = (response: request.Response) =>
    response.headers.location as string;

  async function cleanupGoogleUsers() {
    const created = await prisma.user.findMany({
      where: { email: { in: googleEmails.splice(0) } },
      select: { id: true },
    });
    userIds.push(...created.map((user) => user.id));
    await deleteUsers(prisma, userIds);
  }

  beforeAll(async () => {
    await google.start();
    Object.assign(process.env, google.env(API));
    ({ app } = await createTestApp());
    prisma = app.get(PrismaService);
  });

  afterEach(async () => {
    google.tamper = {};
    google.denyNext = false;
    await cleanupGoogleUsers();
  });

  afterAll(async () => {
    await app?.close();
    for (const name of GOOGLE_ENV) delete process.env[name];
    await google.stop();
  });

  describe('sign-in and sign-up', () => {
    it('sends the browser to Google with state, nonce and PKCE, and a Lax state cookie', async () => {
      const { response, authorizationUrl, rawStateCookie } = await start();
      const url = new URL(authorizationUrl);
      expect(url.searchParams.get('client_id')).toBe(google.clientId);
      expect(url.searchParams.get('response_type')).toBe('code');
      expect(url.searchParams.get('scope')).toBe('openid email profile');
      expect(url.searchParams.get('code_challenge_method')).toBe('S256');
      expect(url.searchParams.get('redirect_uri')).toBe(
        `${API}/auth/google/callback`,
      );
      for (const name of ['state', 'nonce', 'code_challenge']) {
        expect(url.searchParams.get(name)).toMatch(/^[A-Za-z0-9_-]{43}$/);
      }
      expect(rawStateCookie).toMatch(/HttpOnly/);
      expect(rawStateCookie).toMatch(/SameSite=Lax/);
      expect(rawStateCookie).toMatch(/Path=\/auth\/google/);
      expect(rawStateCookie).toMatch(/Max-Age=600/);
      expect(response.headers['cache-control']).toBe('no-store');
      // The PKCE verifier lives only in the cookie; the challenge is all Google sees.
      expect(authorizationUrl).not.toContain(
        rawStateCookie!.split(';')[0]!.slice('shanflow_oauth='.length),
      );
    });

    it('creates a verified, password-less account for a new Google user and signs them in', async () => {
      const identity = fixtureIdentity('new', {
        picture: 'https://images.example.invalid/a.png',
      });
      googleEmails.push(identity.email);
      const response = await signInWith(identity).then((result) => {
        expect(result.status).toBe(302);
        return result;
      });
      expect(redirectOf(response)).toBe(`${WEB}/account`);
      expect(response.headers['cache-control']).toBe('no-store');
      const cookies = response.headers['set-cookie'] as unknown as string[];
      expect(
        cookies.some((cookie) => cookie.startsWith('shanflow_oauth=;')),
      ).toBe(true); // one attempt per state cookie
      const refreshCookie = cookiePairFrom(response);

      const user = await prisma.user.findUniqueOrThrow({
        where: { email: identity.email },
        include: { passwordCredential: true, oauthAccounts: true },
      });
      expect(user).toMatchObject({
        displayName: 'Google Person',
        avatarUrl: 'https://images.example.invalid/a.png',
        accountStatus: 'ACTIVE',
      });
      expect(user.emailVerifiedAt).toBeInstanceOf(Date);
      expect(user.passwordCredential).toBeNull();
      expect(user.oauthAccounts).toMatchObject([
        {
          provider: 'GOOGLE',
          providerAccountId: identity.sub,
          providerEmail: identity.email,
          providerEmailVerified: true,
        },
      ]);

      // The refresh cookie from the redirect restores a session for the web app.
      const refreshed = await http()
        .post('/auth/refresh')
        .set(CSRF_HEADERS)
        .set('Cookie', refreshCookie)
        .expect(200);
      expect(refreshed.body.user).toMatchObject({
        id: user.id,
        email: identity.email,
        emailVerified: true,
      });
      const me = await http()
        .get('/auth/me')
        .set('Authorization', `Bearer ${refreshed.body.accessToken}`)
        .expect(200);
      expect(me.body.security).toEqual({
        hasPassword: false,
        linkedProviders: ['google'],
      });
    });

    it('signs a returning user in without creating anything, even if their email changed at Google', async () => {
      const identity = fixtureIdentity('returning');
      googleEmails.push(identity.email);
      await signInWith(identity);
      const before = await prisma.user.findUniqueOrThrow({
        where: { email: identity.email },
      });

      const moved = { ...identity, email: fixtureEmail('moved-at-google') };
      const response = await signInWith(moved);
      expect(redirectOf(response)).toBe(`${WEB}/account`);
      expect(cookiePairFrom(response)).toMatch(/^shanflow_refresh=/);
      await expect(
        prisma.user.count({ where: { id: before.id } }),
      ).resolves.toBe(1);
      await expect(
        prisma.oAuthAccount.count({ where: { userId: before.id } }),
      ).resolves.toBe(1);
      const account = await prisma.oAuthAccount.findFirstOrThrow({
        where: { userId: before.id },
      });
      // The subject is the key; the provider email is refreshed, the account email is not rewritten.
      expect(account.providerEmail).toBe(moved.email);
      const after = await prisma.user.findUniqueOrThrow({
        where: { id: before.id },
      });
      expect(after.email).toBe(identity.email);
    });

    it('never links silently to an existing account with the same email, verified or not', async () => {
      const local = await createUser(prisma, userIds, {
        label: 'takeover',
        verified: false,
      });
      const response = await signInWith(
        fixtureIdentity('x', { email: local.email }),
      );
      expect(redirectOf(response)).toBe(`${WEB}/login?error=account_exists`);
      expect(response.headers['set-cookie']).not.toEqual(
        expect.arrayContaining([
          expect.stringMatching(/^shanflow_refresh=[^;]/),
        ]),
      );
      await expect(
        prisma.oAuthAccount.count({ where: { userId: local.id } }),
      ).resolves.toBe(0);
      // The password account is untouched and still works.
      await http()
        .post('/auth/login')
        .send({ email: local.email, password: PASSWORD })
        .expect(200);
      const stillUnverified = await prisma.user.findUniqueOrThrow({
        where: { id: local.id },
      });
      expect(stillUnverified.emailVerifiedAt).toBeNull();
    });

    it('matches the existing account case-insensitively', async () => {
      const local = await createUser(prisma, userIds, { label: 'casing' });
      const response = await signInWith(
        fixtureIdentity('x', { email: local.email.toUpperCase() }),
      );
      expect(redirectOf(response)).toBe(`${WEB}/login?error=account_exists`);
    });

    it('refuses an unverified Google email and creates nothing', async () => {
      const identity = fixtureIdentity('unverified', { emailVerified: false });
      const response = await signInWith(identity);
      expect(redirectOf(response)).toBe(`${WEB}/login?error=email_unverified`);
      await expect(
        prisma.user.count({ where: { email: identity.email } }),
      ).resolves.toBe(0);
    });

    it('accepts the string form "true" of email_verified', async () => {
      const identity = fixtureIdentity('stringy', { emailVerified: 'true' });
      googleEmails.push(identity.email);
      expect(redirectOf(await signInWith(identity))).toBe(`${WEB}/account`);
    });

    it('refuses a suspended account with the same generic outcome and no session', async () => {
      const identity = fixtureIdentity('suspended');
      googleEmails.push(identity.email);
      await signInWith(identity);
      await prisma.user.updateMany({
        where: { email: identity.email },
        data: { accountStatus: 'SUSPENDED' },
      });
      const response = await signInWith(identity);
      expect(redirectOf(response)).toBe(
        `${WEB}/login?error=account_unavailable`,
      );
      expect(
        (response.headers['set-cookie'] as unknown as string[]).some((cookie) =>
          /^shanflow_refresh=[^;]/.test(cookie),
        ),
      ).toBe(false);
    });

    it('reports a cancelled consent without leaking provider text', async () => {
      google.denyNext = true;
      const started = await start();
      const callbackPath = await authorize(started.authorizationUrl);
      const response = await complete(callbackPath, started.stateCookie);
      expect(redirectOf(response)).toBe(`${WEB}/login?error=oauth_cancelled`);
      const hostile = await complete(
        '/auth/google/callback?error=%3Cscript%3Ealert(1)%3C%2Fscript%3E',
        started.stateCookie,
      );
      expect(redirectOf(hostile)).toBe(`${WEB}/login?error=oauth_failed`);
    });

    it.each([
      [
        'an ID token for another audience',
        { audience: 'someone-elses-client-id' },
      ],
      ['an ID token from another issuer', { issuer: 'https://evil.example' }],
      ['a replayed nonce', { nonce: 'a-different-nonce-than-the-one-we-sent' }],
      ['an expired ID token', { expired: true }],
      ['an ID token signed with an unknown key', { foreignKey: true }],
      ['a token response without an ID token', { omitIdToken: true }],
      ['a failing token endpoint', { tokenStatus: 500 }],
    ])(
      'rejects %s and creates no account or session',
      async (_name, tamper) => {
        google.tamper = tamper;
        const identity = fixtureIdentity('tampered');
        const response = await signInWith(identity);
        expect(redirectOf(response)).toBe(`${WEB}/login?error=oauth_failed`);
        await expect(
          prisma.user.count({ where: { email: identity.email } }),
        ).resolves.toBe(0);
        expect(
          (response.headers['set-cookie'] as unknown as string[]).some(
            (cookie) => /^shanflow_refresh=[^;]/.test(cookie),
          ),
        ).toBe(false);
      },
    );

    it('sends the PKCE verifier and client secret to the token endpoint, and the code only once', async () => {
      google.nextIdentity = fixtureIdentity('pkce');
      googleEmails.push(google.nextIdentity.email);
      const started = await start();
      const callbackPath = await authorize(started.authorizationUrl);
      await complete(callbackPath, started.stateCookie);
      const request = google.tokenRequests.at(-1)!;
      expect(request.get('code_verifier')).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(request.get('client_secret')).toBe(google.clientSecret);
      expect(request.get('grant_type')).toBe('authorization_code');
      // Replaying the same callback fails: the code is single use and the attempt is over.
      const replay = await complete(callbackPath, started.stateCookie);
      expect(redirectOf(replay)).toBe(`${WEB}/login?error=oauth_failed`);
    });

    it('rejects a callback with a missing, forged, mismatched or foreign state cookie', async () => {
      google.nextIdentity = fixtureIdentity('state');
      const first = await start();
      const callbackPath = await authorize(first.authorizationUrl);
      const failure = `${WEB}/login?error=oauth_failed`;

      expect(redirectOf(await complete(callbackPath))).toBe(failure); // no cookie
      expect(
        redirectOf(await complete(callbackPath, 'shanflow_oauth=forged')),
      ).toBe(failure);
      // A valid cookie from a different attempt does not match this attempt's state.
      const second = await start();
      expect(redirectOf(await complete(callbackPath, second.stateCookie))).toBe(
        failure,
      );
      // A different state in the query with the right cookie.
      const swapped = callbackPath.replace(
        /state=[^&]+/,
        `state=${'A'.repeat(43)}`,
      );
      expect(redirectOf(await complete(swapped, first.stateCookie))).toBe(
        failure,
      );
      // No code at all.
      expect(
        redirectOf(await complete('/auth/google/callback', first.stateCookie)),
      ).toBe(failure);
      await expect(
        prisma.user.count({ where: { email: google.nextIdentity.email } }),
      ).resolves.toBe(0);
    });

    it('does not accept an access token as a state cookie', async () => {
      const user = await createUser(prisma, userIds, { label: 'confused' });
      const login = await http()
        .post('/auth/login')
        .send({ email: user.email, password: PASSWORD })
        .expect(200);
      google.nextIdentity = fixtureIdentity('confused-google');
      const started = await start();
      const callbackPath = await authorize(started.authorizationUrl);
      const response = await complete(
        callbackPath,
        `shanflow_oauth=${login.body.accessToken}`,
      );
      expect(redirectOf(response)).toBe(`${WEB}/login?error=oauth_failed`);
    });

    it('keeps a missing name and unsafe picture out of the profile', async () => {
      const identity = fixtureIdentity('plain', {
        name: undefined,
        picture: 'http://insecure.example.invalid/a.png',
      });
      googleEmails.push(identity.email);
      await signInWith(identity);
      const user = await prisma.user.findUniqueOrThrow({
        where: { email: identity.email },
      });
      expect(user.displayName).toBe(identity.email.split('@')[0]!.slice(0, 80));
      expect(user.avatarUrl).toBeNull();
    });

    it('creates exactly one account when two callbacks for the same new user race', async () => {
      const identity = fixtureIdentity('race');
      googleEmails.push(identity.email);
      google.nextIdentity = identity;
      const [a, b] = await Promise.all([start(), start()]);
      const [pathA, pathB] = await Promise.all([
        authorize(a.authorizationUrl),
        authorize(b.authorizationUrl),
      ]);
      const [first, second] = await Promise.all([
        complete(pathA, a.stateCookie),
        complete(pathB, b.stateCookie),
      ]);
      expect(redirectOf(first)).toBe(`${WEB}/account`);
      expect(redirectOf(second)).toBe(`${WEB}/account`);
      await expect(
        prisma.user.count({ where: { email: identity.email } }),
      ).resolves.toBe(1);
      await expect(
        prisma.oAuthAccount.count({
          where: { providerAccountId: identity.sub },
        }),
      ).resolves.toBe(1);
    });
  });

  describe('linking Google to an existing account', () => {
    const linkStart = (accessToken: string | undefined, password: unknown) => {
      const call = http().post('/auth/google/link/start').send({ password });
      return accessToken
        ? call.set('Authorization', `Bearer ${accessToken}`)
        : call;
    };

    async function passwordSession(email: string): Promise<string> {
      return (
        await http()
          .post('/auth/login')
          .send({ email, password: PASSWORD })
          .expect(200)
      ).body.accessToken as string;
    }

    /** Runs the link flow: start (authenticated), consent at Google, callback in the browser. */
    async function link(accessToken: string, identity: FakeIdentity) {
      const started = await linkStart(accessToken, PASSWORD).expect(200);
      const stateCookie = (started.headers['set-cookie'] as unknown as string[])
        .find((cookie) => cookie.startsWith('shanflow_oauth='))!
        .split(';')[0]!;
      google.nextIdentity = identity;
      const callbackPath = await authorize(
        started.body.authorizationUrl as string,
      );
      return complete(callbackPath, stateCookie);
    }

    it('links after password confirmation, then Google sign-in reaches the same account', async () => {
      const user = await createUser(prisma, userIds, { label: 'link' });
      const accessToken = await passwordSession(user.email);
      const identity = fixtureIdentity('different-email');

      const response = await link(accessToken, identity);
      expect(redirectOf(response)).toBe(`${WEB}/account?linked=google`);
      // Linking does not start a session of its own.
      expect(
        (response.headers['set-cookie'] as unknown as string[]).some((cookie) =>
          /^shanflow_refresh=[^;]/.test(cookie),
        ),
      ).toBe(false);
      const account = await prisma.oAuthAccount.findFirstOrThrow({
        where: { userId: user.id },
      });
      expect(account).toMatchObject({
        provider: 'GOOGLE',
        providerAccountId: identity.sub,
        providerEmail: identity.email,
      });

      const me = await http()
        .get('/auth/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      expect(me.body.security).toEqual({
        hasPassword: true,
        linkedProviders: ['google'],
      });

      const viaGoogle = await signInWith(identity);
      expect(redirectOf(viaGoogle)).toBe(`${WEB}/account`);
      const refreshed = await http()
        .post('/auth/refresh')
        .set(CSRF_HEADERS)
        .set('Cookie', cookiePairFrom(viaGoogle))
        .expect(200);
      expect(refreshed.body.user.id).toBe(user.id);
    });

    it('needs the current password, a signed-in user and a live session', async () => {
      const user = await createUser(prisma, userIds, { label: 'reauth' });
      const accessToken = await passwordSession(user.email);
      const wrong = await linkStart(accessToken, 'not my password').expect(400);
      expect(wrong.body.code).toBe('WRONG_PASSWORD');
      expect(wrong.headers['set-cookie']).toBeUndefined();
      expect(
        (await linkStart(accessToken, undefined).expect(400)).body.code,
      ).toBe('VALIDATION_FAILED');
      await linkStart(undefined, PASSWORD).expect(401);

      await http()
        .post('/auth/logout-all')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(204);
      await linkStart(accessToken, PASSWORD).expect(401);
      await expect(
        prisma.oAuthAccount.count({ where: { userId: user.id } }),
      ).resolves.toBe(0);
    });

    it('refuses to link a second Google account, or one that belongs to someone else', async () => {
      const owner = await createUser(prisma, userIds, { label: 'owner' });
      const thief = await createUser(prisma, userIds, { label: 'thief' });
      const ownerToken = await passwordSession(owner.email);
      const identity = fixtureIdentity('contested');
      expect(redirectOf(await link(ownerToken, identity))).toBe(
        `${WEB}/account?linked=google`,
      );

      // Already has one: refused before leaving the app.
      expect(
        (await linkStart(ownerToken, PASSWORD).expect(409)).body.code,
      ).toBe('ALREADY_LINKED');

      // Someone else tries to attach the same Google subject.
      const thiefToken = await passwordSession(thief.email);
      expect(redirectOf(await link(thiefToken, identity))).toBe(
        `${WEB}/login?error=already_linked`,
      );
      await expect(
        prisma.oAuthAccount.count({ where: { userId: thief.id } }),
      ).resolves.toBe(0);
    });

    it('re-running consent for an already linked subject is harmless', async () => {
      const user = await createUser(prisma, userIds, { label: 'idempotent' });
      const accessToken = await passwordSession(user.email);
      const identity = fixtureIdentity('idempotent-google');
      await link(accessToken, identity);
      // Start the flow before the account is linked twice by two tabs: simulate by completing a second flow.
      const started = await linkStart(accessToken, PASSWORD);
      expect(started.status).toBe(409);
    });

    it('does not let a link-intent cookie be completed by a browser that never started it', async () => {
      const user = await createUser(prisma, userIds, { label: 'cookie-bound' });
      const accessToken = await passwordSession(user.email);
      const started = await linkStart(accessToken, PASSWORD).expect(200);
      google.nextIdentity = fixtureIdentity('victim-flow');
      const callbackPath = await authorize(
        started.body.authorizationUrl as string,
      );
      // A different browser (no state cookie) finishing the callback links nothing.
      expect(redirectOf(await complete(callbackPath))).toBe(
        `${WEB}/login?error=oauth_failed`,
      );
      await expect(
        prisma.oAuthAccount.count({ where: { userId: user.id } }),
      ).resolves.toBe(0);
    });

    it('refuses an unverified Google email when linking too', async () => {
      const user = await createUser(prisma, userIds, {
        label: 'link-unverified',
      });
      const accessToken = await passwordSession(user.email);
      const response = await link(
        accessToken,
        fixtureIdentity('unverified-link', { emailVerified: false }),
      );
      expect(redirectOf(response)).toBe(`${WEB}/login?error=email_unverified`);
      await expect(
        prisma.oAuthAccount.count({ where: { userId: user.id } }),
      ).resolves.toBe(0);
    });
  });
});

describe('Google sign-in when it is not configured', () => {
  it('redirects to the sign-in page with a neutral error and refuses link start', async () => {
    for (const name of GOOGLE_ENV) delete process.env[name];
    const { app } = await createTestApp();
    const prisma = app.get(PrismaService);
    const ids: string[] = [];
    try {
      const start = await request(app.getHttpServer())
        .get('/auth/google/start')
        .expect(302);
      expect(start.headers.location).toBe(
        `${WEB}/login?error=oauth_unavailable`,
      );
      expect(start.headers['set-cookie']).toBeUndefined();
      const callback = await request(app.getHttpServer())
        .get('/auth/google/callback?code=x&state=y')
        .expect(302);
      expect(callback.headers.location).toBe(
        `${WEB}/login?error=oauth_unavailable`,
      );

      const user = await createUser(prisma, ids, { label: 'unconfigured' });
      const accessToken = (
        await request(app.getHttpServer())
          .post('/auth/login')
          .send({ email: user.email, password: PASSWORD })
          .expect(200)
      ).body.accessToken as string;
      const link = await request(app.getHttpServer())
        .post('/auth/google/link/start')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ password: PASSWORD })
        .expect(503);
      expect(link.body.code).toBe('OAUTH_NOT_CONFIGURED');
    } finally {
      await deleteUsers(prisma, ids);
      await app.close();
    }
  });
});

describe('Google start throttling', () => {
  it('allows 20 starts per minute per client', async () => {
    const google = new FakeGoogle();
    await google.start();
    Object.assign(process.env, google.env(API));
    const { app } = await createTestApp({ throttle: true });
    try {
      for (let attempt = 0; attempt < 20; attempt += 1) {
        await request(app.getHttpServer())
          .get('/auth/google/start')
          .expect(302);
      }
      const blocked = await request(app.getHttpServer())
        .get('/auth/google/start')
        .expect(429);
      expect(blocked.body.code).toBe('TOO_MANY_REQUESTS');
    } finally {
      await app.close();
      for (const name of GOOGLE_ENV) delete process.env[name];
      await google.stop();
    }
  });
});
