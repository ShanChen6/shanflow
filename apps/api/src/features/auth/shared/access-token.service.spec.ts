import { SignJWT, decodeJwt, decodeProtectedHeader } from 'jose';
import { Clock } from '../../../shared/clock.js';
import { AccessTokenService } from './access-token.service.js';

const config = {
  NODE_ENV: 'test',
  JWT_ACCESS_SECRET: 'unit-test-secret-unit-test-secret-0123456789',
  JWT_ISSUER: 'shanflow-api',
  JWT_AUDIENCE: 'shanflow-web',
  ACCESS_TOKEN_TTL_SECONDS: 900,
  REFRESH_TOKEN_TTL_DAYS: 30,
  AUTH_COOKIE_SECURE: false,
  AUTH_COOKIE_DOMAIN: undefined,
  WEB_ORIGIN: 'http://localhost:3000',
};

class FakeClock extends Clock {
  constructor(public current = new Date('2026-10-12T00:00:00Z')) {
    super();
  }
  now(): Date {
    return this.current;
  }
}

const claims = {
  userId: '0b1f7a4e-3c1d-4a6e-9b6a-2f1c8d0e5a11',
  sessionId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
};
const key = new TextEncoder().encode(config.JWT_ACCESS_SECRET);

function service(
  clock = new FakeClock(),
  overrides: Partial<typeof config> = {},
) {
  return new AccessTokenService({ ...config, ...overrides } as never, clock);
}

describe('AccessTokenService', () => {
  it('signs an HS256 token with only identity claims and the configured lifetime', async () => {
    const { token, expiresIn } = await service().sign(claims);
    expect(expiresIn).toBe(900);
    expect(decodeProtectedHeader(token)).toMatchObject({
      alg: 'HS256',
      typ: 'JWT',
    });
    const payload = decodeJwt(token);
    expect(payload).toEqual({
      sub: claims.userId,
      sid: claims.sessionId,
      iss: 'shanflow-api',
      aud: 'shanflow-web',
      iat: Date.parse('2026-10-12T00:00:00Z') / 1000,
      exp: Date.parse('2026-10-12T00:15:00Z') / 1000,
    });
  });

  it('verifies its own tokens', async () => {
    const tokens = service();
    const { token } = await tokens.sign(claims);
    await expect(tokens.verify(token)).resolves.toEqual(claims);
  });

  it('rejects an expired token and accepts it right before expiry', async () => {
    const clock = new FakeClock();
    const tokens = service(clock);
    const { token } = await tokens.sign(claims);
    clock.current = new Date('2026-10-12T00:14:59Z');
    await expect(tokens.verify(token)).resolves.toEqual(claims);
    clock.current = new Date('2026-10-12T00:15:00Z');
    await expect(tokens.verify(token)).resolves.toBeNull();
  });

  it('rejects tokens with a different secret, issuer or audience', async () => {
    const { token } = await service().sign(claims);
    await expect(
      service(undefined, { JWT_ACCESS_SECRET: 'x'.repeat(40) }).verify(token),
    ).resolves.toBeNull();
    await expect(
      service(undefined, { JWT_ISSUER: 'other' }).verify(token),
    ).resolves.toBeNull();
    await expect(
      service(undefined, { JWT_AUDIENCE: 'other' }).verify(token),
    ).resolves.toBeNull();
  });

  it('rejects other algorithms, including an unsigned alg none token', async () => {
    const base = () =>
      new SignJWT({ sid: claims.sessionId })
        .setSubject(claims.userId)
        .setIssuer('shanflow-api')
        .setAudience('shanflow-web')
        .setIssuedAt()
        .setExpirationTime('15m');
    const hs512 = await base().setProtectedHeader({ alg: 'HS512' }).sign(key);
    await expect(
      service(new FakeClock(new Date())).verify(hs512),
    ).resolves.toBeNull();
    const encode = (value: object) =>
      Buffer.from(JSON.stringify(value)).toString('base64url');
    const none = `${encode({ alg: 'none', typ: 'JWT' })}.${encode({ sub: claims.userId, sid: claims.sessionId, iss: 'shanflow-api', aud: 'shanflow-web', iat: 1, exp: 9_999_999_999 })}.`;
    await expect(service().verify(none)).resolves.toBeNull();
  });

  it('rejects tokens missing the session id or subject and malformed input', async () => {
    const clock = new FakeClock(new Date());
    const noSid = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(claims.userId)
      .setIssuer('shanflow-api')
      .setAudience('shanflow-web')
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(key);
    const noSub = await new SignJWT({ sid: claims.sessionId })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer('shanflow-api')
      .setAudience('shanflow-web')
      .setIssuedAt()
      .setExpirationTime('15m')
      .sign(key);
    const tokens = service(clock);
    await expect(tokens.verify(noSid)).resolves.toBeNull();
    await expect(tokens.verify(noSub)).resolves.toBeNull();
    for (const bad of ['', 'abc', 'a.b.c', 'x'.repeat(5000)])
      await expect(tokens.verify(bad)).resolves.toBeNull();
  });

  it('rejects a token with a tampered payload', async () => {
    const tokens = service();
    const { token } = await tokens.sign(claims);
    const [header, , signature] = token.split('.');
    const forged = Buffer.from(
      JSON.stringify({
        sub: 'attacker',
        sid: claims.sessionId,
        iss: 'shanflow-api',
        aud: 'shanflow-web',
        iat: 1,
        exp: 9_999_999_999,
      }),
    ).toString('base64url');
    await expect(
      tokens.verify(`${header}.${forged}.${signature}`),
    ).resolves.toBeNull();
  });
});
