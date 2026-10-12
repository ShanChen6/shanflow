import { SignJWT } from 'jose';
import { Clock } from '../../../shared/clock.js';
import { OAuthStateService } from './oauth-state.service.js';

const secret = 'oauth-state-test-secret-0123456789abcdef';
const config = { JWT_ACCESS_SECRET: secret, JWT_ISSUER: 'shanflow-api' };
const key = new TextEncoder().encode(secret);

class FakeClock extends Clock {
  constructor(public current = new Date('2026-10-12T00:00:00Z')) {
    super();
  }
  now(): Date {
    return this.current;
  }
}

const make = (clock = new FakeClock()) => ({
  clock,
  service: new OAuthStateService(config as never, clock),
});

describe('OAuthStateService', () => {
  it('starts a login attempt with fresh secrets and a PKCE S256 challenge', async () => {
    const { service } = make();
    const a = await service.start('login');
    const b = await service.start('login');
    for (const value of [a.state, a.nonce, a.codeChallenge])
      expect(value).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a.state).not.toBe(b.state);
    expect(a.nonce).not.toBe(b.nonce);
    expect(a.cookieValue).not.toBe(b.cookieValue);
  });

  it('reads back the payload when the state matches, and the challenge derives from the stored verifier', async () => {
    const { service } = make();
    const started = await service.start('login');
    const payload = await service.read(started.cookieValue, started.state);
    expect(payload).toMatchObject({
      state: started.state,
      nonce: started.nonce,
      intent: 'login',
    });
    const { createHash } = await import('node:crypto');
    expect(
      createHash('sha256').update(payload!.codeVerifier).digest('base64url'),
    ).toBe(started.codeChallenge);
    expect(payload?.userId).toBeUndefined();
  });

  it('binds a link attempt to the user who started it', async () => {
    const { service } = make();
    const started = await service.start('link', 'user-1');
    expect(
      await service.read(started.cookieValue, started.state),
    ).toMatchObject({ intent: 'link', userId: 'user-1' });
  });

  it('rejects a mismatched, missing or empty state and a missing cookie', async () => {
    const { service } = make();
    const started = await service.start('login');
    expect(await service.read(started.cookieValue, 'A'.repeat(43))).toBeNull();
    expect(
      await service.read(started.cookieValue, started.state.slice(1)),
    ).toBeNull();
    expect(await service.read(started.cookieValue, undefined)).toBeNull();
    expect(await service.read(started.cookieValue, '')).toBeNull();
    expect(await service.read(undefined, started.state)).toBeNull();
    expect(await service.read('not-a-jwt', started.state)).toBeNull();
  });

  it('expires after ten minutes', async () => {
    const { service, clock } = make();
    const started = await service.start('login');
    clock.current = new Date('2026-10-12T00:09:59Z');
    expect(
      await service.read(started.cookieValue, started.state),
    ).not.toBeNull();
    clock.current = new Date('2026-10-12T00:10:00Z');
    expect(await service.read(started.cookieValue, started.state)).toBeNull();
  });

  it('rejects tokens with another audience, type or secret, such as an access token', async () => {
    const { service, clock } = make();
    const base = (audience: string, typ: string, signingKey = key) =>
      new SignJWT({
        state: 's'.repeat(43),
        nonce: 'n',
        cv: 'v',
        intent: 'login',
      })
        .setProtectedHeader({ alg: 'HS256', typ })
        .setIssuer('shanflow-api')
        .setAudience(audience)
        .setIssuedAt(Math.floor(clock.current.getTime() / 1000))
        .setExpirationTime(Math.floor(clock.current.getTime() / 1000) + 600)
        .sign(signingKey);
    const state = 's'.repeat(43);
    expect(
      await service.read(
        await base('shanflow-oauth-state', 'oauth-state+jwt'),
        state,
      ),
    ).not.toBeNull();
    expect(
      await service.read(await base('shanflow-web', 'oauth-state+jwt'), state),
    ).toBeNull();
    expect(
      await service.read(await base('shanflow-oauth-state', 'JWT'), state),
    ).toBeNull();
    expect(
      await service.read(
        await base(
          'shanflow-oauth-state',
          'oauth-state+jwt',
          new TextEncoder().encode('x'.repeat(40)),
        ),
        state,
      ),
    ).toBeNull();
  });

  it('rejects a link payload without a user and an unknown intent', async () => {
    const { service, clock } = make();
    const forge = (claims: Record<string, unknown>) =>
      new SignJWT({ state: 's'.repeat(43), nonce: 'n', cv: 'v', ...claims })
        .setProtectedHeader({ alg: 'HS256', typ: 'oauth-state+jwt' })
        .setIssuer('shanflow-api')
        .setAudience('shanflow-oauth-state')
        .setIssuedAt(Math.floor(clock.current.getTime() / 1000))
        .setExpirationTime(Math.floor(clock.current.getTime() / 1000) + 600)
        .sign(key);
    const state = 's'.repeat(43);
    expect(
      await service.read(await forge({ intent: 'link' }), state),
    ).toBeNull();
    expect(
      await service.read(await forge({ intent: 'admin' }), state),
    ).toBeNull();
    expect(
      await service.read(await forge({ intent: 'link', uid: 'u' }), state),
    ).not.toBeNull();
  });
});
