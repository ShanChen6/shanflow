import { validateAuthEnvironment } from './auth-env.schema.js';

const secret = 'a'.repeat(32);

describe('auth environment validation', () => {
  it('applies defaults when only the signing secret is set', () => {
    expect(validateAuthEnvironment({ JWT_ACCESS_SECRET: secret })).toEqual({
      NODE_ENV: 'development',
      JWT_ACCESS_SECRET: secret,
      JWT_ISSUER: 'shanflow-api',
      JWT_AUDIENCE: 'shanflow-web',
      ACCESS_TOKEN_TTL_SECONDS: 900,
      REFRESH_TOKEN_TTL_DAYS: 30,
      AUTH_COOKIE_SECURE: false,
      AUTH_COOKIE_DOMAIN: undefined,
      WEB_ORIGIN: 'http://localhost:3000',
    });
  });

  it.each([undefined, '', 'short', 'a'.repeat(31), ` ${secret}`, `${secret} `])(
    'rejects an unusable signing secret case %#',
    (JWT_ACCESS_SECRET) => {
      expect(() => validateAuthEnvironment({ JWT_ACCESS_SECRET })).toThrow(
        'JWT_ACCESS_SECRET',
      );
    },
  );

  it.each(['59', '3601', '1.5', 'abc'])(
    'rejects invalid access TTL %s',
    (value) => {
      expect(() =>
        validateAuthEnvironment({
          JWT_ACCESS_SECRET: secret,
          ACCESS_TOKEN_TTL_SECONDS: value,
        }),
      ).toThrow('ACCESS_TOKEN_TTL_SECONDS');
    },
  );

  it.each(['0', '91', 'x'])('rejects invalid refresh TTL %s', (value) => {
    expect(() =>
      validateAuthEnvironment({
        JWT_ACCESS_SECRET: secret,
        REFRESH_TOKEN_TTL_DAYS: value,
      }),
    ).toThrow('REFRESH_TOKEN_TTL_DAYS');
  });

  it.each([
    'http://localhost:3000/',
    'http://localhost:3000/path',
    'ftp://x.example',
    'http://u:p@x.example',
    'not-a-url',
  ])('rejects WEB_ORIGIN that is not a plain origin: %s', (WEB_ORIGIN) => {
    expect(() =>
      validateAuthEnvironment({ JWT_ACCESS_SECRET: secret, WEB_ORIGIN }),
    ).toThrow('WEB_ORIGIN');
  });

  it('requires secure cookies and an https origin in production', () => {
    const base = {
      NODE_ENV: 'production',
      JWT_ACCESS_SECRET: secret,
      WEB_ORIGIN: 'https://app.example.com',
    };
    expect(validateAuthEnvironment(base).AUTH_COOKIE_SECURE).toBe(true);
    expect(() =>
      validateAuthEnvironment({ ...base, AUTH_COOKIE_SECURE: 'false' }),
    ).toThrow('AUTH_COOKIE_SECURE');
    expect(() =>
      validateAuthEnvironment({
        ...base,
        WEB_ORIGIN: 'http://app.example.com',
      }),
    ).toThrow('WEB_ORIGIN');
  });

  it('accepts a cookie domain and treats an empty one as unset', () => {
    expect(
      validateAuthEnvironment({
        JWT_ACCESS_SECRET: secret,
        AUTH_COOKIE_DOMAIN: 'example.com',
      }).AUTH_COOKIE_DOMAIN,
    ).toBe('example.com');
    expect(
      validateAuthEnvironment({
        JWT_ACCESS_SECRET: secret,
        AUTH_COOKIE_DOMAIN: '',
      }).AUTH_COOKIE_DOMAIN,
    ).toBeUndefined();
    expect(() =>
      validateAuthEnvironment({
        JWT_ACCESS_SECRET: secret,
        AUTH_COOKIE_DOMAIN: 'a b;c',
      }),
    ).toThrow('AUTH_COOKIE_DOMAIN');
  });

  it('never includes the secret or invalid input in the error message', () => {
    const leaked = 'sensitive-marker-value';
    try {
      validateAuthEnvironment({
        JWT_ACCESS_SECRET: leaked,
        WEB_ORIGIN: leaked,
      });
      expect.fail('Expected validation failure');
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      expect(message).toContain('Invalid auth environment');
      expect(message).not.toContain(leaked);
    }
  });
});
