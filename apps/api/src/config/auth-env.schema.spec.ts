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
      MAIL_TRANSPORT: 'console',
      SMTP_URL: undefined,
      MAIL_FROM: 'Shanflow <no-reply@localhost>',
      GOOGLE: undefined,
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
      MAIL_TRANSPORT: 'smtp',
      SMTP_URL: 'smtps://mail.example.com',
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

  describe('mail', () => {
    const base = { JWT_ACCESS_SECRET: secret };

    it('requires an smtp URL for the smtp transport and rejects other schemes', () => {
      expect(() =>
        validateAuthEnvironment({ ...base, MAIL_TRANSPORT: 'smtp' }),
      ).toThrow('SMTP_URL');
      expect(() =>
        validateAuthEnvironment({
          ...base,
          MAIL_TRANSPORT: 'smtp',
          SMTP_URL: 'http://mail.example.com',
        }),
      ).toThrow('SMTP_URL');
      expect(
        validateAuthEnvironment({
          ...base,
          MAIL_TRANSPORT: 'smtp',
          SMTP_URL: 'smtps://u:p@mail.example.com:465',
        }).SMTP_URL,
      ).toBe('smtps://u:p@mail.example.com:465');
    });

    it('treats blank values as unset and refuses the console transport in production', () => {
      expect(
        validateAuthEnvironment({ ...base, SMTP_URL: '' }).SMTP_URL,
      ).toBeUndefined();
      const production = {
        ...base,
        NODE_ENV: 'production',
        WEB_ORIGIN: 'https://app.example.com',
      };
      expect(() => validateAuthEnvironment(production)).toThrow(
        'MAIL_TRANSPORT',
      );
      expect(
        validateAuthEnvironment({
          ...production,
          MAIL_TRANSPORT: 'smtp',
          SMTP_URL: 'smtps://mail.example.com',
        }).MAIL_TRANSPORT,
      ).toBe('smtp');
    });

    it('rejects a sender with line breaks', () => {
      expect(() =>
        validateAuthEnvironment({
          ...base,
          MAIL_FROM: 'a@b.io\r\nBcc: x@y.io',
        }),
      ).toThrow('MAIL_FROM');
    });

    it('does not leak the SMTP credentials in errors', () => {
      try {
        validateAuthEnvironment({
          ...base,
          MAIL_TRANSPORT: 'smtp',
          SMTP_URL: 'http://user:hunter2@host',
        });
        expect.fail('Expected failure');
      } catch (error) {
        expect(error instanceof Error ? error.message : '').not.toContain(
          'hunter2',
        );
      }
    });
  });

  describe('google', () => {
    const base = { JWT_ACCESS_SECRET: secret };
    const full = {
      GOOGLE_CLIENT_ID: 'id',
      GOOGLE_CLIENT_SECRET: 'secret',
      GOOGLE_REDIRECT_URI: 'http://localhost:3001/auth/google/callback',
    };

    it('is disabled unless all three settings are present, and rejects partial sets', () => {
      expect(validateAuthEnvironment(base).GOOGLE).toBeUndefined();
      expect(
        validateAuthEnvironment({
          ...base,
          GOOGLE_CLIENT_ID: '',
          GOOGLE_CLIENT_SECRET: '',
          GOOGLE_REDIRECT_URI: '',
        }).GOOGLE,
      ).toBeUndefined();
      expect(() =>
        validateAuthEnvironment({ ...base, GOOGLE_CLIENT_ID: 'id' }),
      ).toThrow('set together');
      expect(() =>
        validateAuthEnvironment({
          ...base,
          GOOGLE_CLIENT_ID: 'id',
          GOOGLE_CLIENT_SECRET: 'secret',
        }),
      ).toThrow('set together');
    });

    it('defaults to the real Google endpoints', () => {
      expect(validateAuthEnvironment({ ...base, ...full }).GOOGLE).toEqual({
        clientId: 'id',
        clientSecret: 'secret',
        redirectUri: full.GOOGLE_REDIRECT_URI,
        authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
        tokenEndpoint: 'https://oauth2.googleapis.com/token',
        jwksUri: 'https://www.googleapis.com/oauth2/v3/certs',
      });
    });

    it('allows endpoint overrides outside production only', () => {
      const overrides = {
        GOOGLE_AUTHORIZATION_ENDPOINT: 'http://127.0.0.1:9000/authorize',
        GOOGLE_TOKEN_ENDPOINT: 'http://127.0.0.1:9000/token',
        GOOGLE_JWKS_URI: 'http://127.0.0.1:9000/jwks',
      };
      expect(
        validateAuthEnvironment({ ...base, ...full, ...overrides }).GOOGLE
          ?.tokenEndpoint,
      ).toBe('http://127.0.0.1:9000/token');
      const production = {
        ...base,
        NODE_ENV: 'production',
        WEB_ORIGIN: 'https://app.example.com',
        MAIL_TRANSPORT: 'smtp',
        SMTP_URL: 'smtps://m.example.com',
        ...full,
        GOOGLE_REDIRECT_URI: 'https://api.example.com/auth/google/callback',
      };
      expect(validateAuthEnvironment(production).GOOGLE).toBeDefined();
      expect(() =>
        validateAuthEnvironment({ ...production, ...overrides }),
      ).toThrow('not allowed in production');
      expect(() =>
        validateAuthEnvironment({
          ...production,
          GOOGLE_REDIRECT_URI: 'http://api.example.com/cb',
        }),
      ).toThrow('GOOGLE_REDIRECT_URI');
    });

    it('rejects malformed redirect and endpoint URLs', () => {
      expect(() =>
        validateAuthEnvironment({
          ...base,
          ...full,
          GOOGLE_REDIRECT_URI: 'not a url',
        }),
      ).toThrow('GOOGLE_REDIRECT_URI');
      expect(() =>
        validateAuthEnvironment({
          ...base,
          ...full,
          GOOGLE_TOKEN_ENDPOINT: 'ftp://x',
        }),
      ).toThrow('GOOGLE_TOKEN_ENDPOINT');
    });

    it('never echoes the client secret', () => {
      try {
        validateAuthEnvironment({
          ...base,
          GOOGLE_CLIENT_SECRET: 'super-secret-value',
        });
        expect.fail('Expected failure');
      } catch (error) {
        expect(error instanceof Error ? error.message : '').not.toContain(
          'super-secret-value',
        );
      }
    });
  });
});
