import { validateEnvironment } from './env.schema.js';

const url = 'postgresql://shanflow_app@127.0.0.1:55432/shanflow?schema=public';

describe('runtime environment validation', () => {
  it('validates runtime values and strips unrelated migration/bootstrap variables', () => {
    expect(validateEnvironment({ NODE_ENV: 'production', PORT: '4100', DATABASE_URL: url,
      DIRECT_DATABASE_URL: 'not-required', SHADOW_DATABASE_URL: 'not-required', POSTGRES_PASSWORD: 'not-required' }))
      .toEqual({ NODE_ENV: 'production', PORT: 4100, DATABASE_URL: url });
  });

  it('defaults NODE_ENV and PORT without requiring tooling credentials', () => {
    expect(validateEnvironment({ DATABASE_URL: url }))
      .toEqual({ NODE_ENV: 'development', PORT: 3001, DATABASE_URL: url });
  });

  it.each(['development', 'test', 'production'])('accepts NODE_ENV %s', (NODE_ENV) => {
    expect(validateEnvironment({ NODE_ENV, DATABASE_URL: url }).NODE_ENV).toBe(NODE_ENV);
  });

  it.each([undefined, '', ' ', 'not-a-url', 'https://shanflow_app@localhost/shanflow',
    'postgresql://shanflow@localhost/shanflow', 'postgresql://shanflow_migrator@localhost/shanflow',
    'postgresql://shanflow_app@localhost/shanflow_shadow',
    'postgresql://shanflow_app@localhost/%73hanflow_shadow',
    'postgresql://shanflow_app@localhost/shanflow?schema=other',
    'postgresql://shanflow_app@localhost/shanflow?user=shanflow_migrator',
    'postgresql://shanflow_app@localhost/shanflow?database=shanflow_shadow',
    'postgresql://shanflow_app:bad%escape@localhost/shanflow'])('rejects invalid or privileged runtime URL case %#', (DATABASE_URL) => {
    expect(() => validateEnvironment({ DATABASE_URL })).toThrow('DATABASE_URL is required');
  });

  it('accepts correctly URL-encoded runtime credentials', () => {
    const DATABASE_URL = 'postgresql://%73hanflow_app:encoded%24%23%40@localhost/%73hanflow?schema=public';
    expect(validateEnvironment({ DATABASE_URL }).DATABASE_URL).toBe(DATABASE_URL);
  });

  it.each(['1', '3001', '65535', 4100])('converts valid PORT %s to an integer', (PORT) => {
    expect(validateEnvironment({ PORT, DATABASE_URL: url }).PORT).toBe(Number(PORT));
  });

  it.each(['', ' ', 'abc', '3001.5', '3e3', '-1', '0', '65536', 1.5, true, null])('rejects invalid PORT case %#', (PORT) => {
    expect(() => validateEnvironment({ PORT, DATABASE_URL: url })).toThrow('PORT must be an integer from 1 to 65535');
  });

  it('rejects invalid NODE_ENV', () => {
    expect(() => validateEnvironment({ NODE_ENV: 'staging', DATABASE_URL: url })).toThrow('NODE_ENV must be development, test or production');
  });

  it('does not expose credentials or any invalid input in error messages', () => {
    const secret = 'sensitive-marker';
    const DATABASE_URL = `postgresql://shanflow_migrator:${secret}@localhost/shanflow_shadow`;
    try {
      validateEnvironment({ DATABASE_URL, PORT: secret, NODE_ENV: secret });
      expect.fail('Expected validation failure');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      const message = error instanceof Error ? error.message : '';
      expect(message).toContain('Invalid runtime environment');
      expect(message).not.toContain(secret);
      expect(message).not.toContain(DATABASE_URL);
    }
  });
});
