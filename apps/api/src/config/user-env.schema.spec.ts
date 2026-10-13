import { validateUserEnvironment } from './user-env.schema.js';

describe('user environment validation', () => {
  it('defaults the public URL to localhost on the API port and leaves the directory to the config', () => {
    expect(validateUserEnvironment({})).toEqual({
      API_PUBLIC_URL: 'http://localhost:3001',
      AVATAR_STORAGE_DIR: undefined,
    });
    expect(validateUserEnvironment({ PORT: '4100' }).API_PUBLIC_URL).toBe(
      'http://localhost:4100',
    );
  });

  it('treats blank values as unset', () => {
    expect(
      validateUserEnvironment({ API_PUBLIC_URL: '', AVATAR_STORAGE_DIR: '' }),
    ).toEqual({
      API_PUBLIC_URL: 'http://localhost:3001',
      AVATAR_STORAGE_DIR: undefined,
    });
  });

  it.each([
    'http://api.example.com/path',
    'http://api.example.com/',
    'ftp://x.example',
    'not-a-url',
    'http://u:p@api.example.com',
  ])(
    'rejects a public URL that is not a plain origin: %s',
    (API_PUBLIC_URL) => {
      expect(() => validateUserEnvironment({ API_PUBLIC_URL })).toThrow(
        'API_PUBLIC_URL',
      );
    },
  );

  it('requires an absolute storage directory', () => {
    expect(
      validateUserEnvironment({
        AVATAR_STORAGE_DIR: '/var/lib/shanflow/avatars',
      }).AVATAR_STORAGE_DIR,
    ).toBe('/var/lib/shanflow/avatars');
    expect(() =>
      validateUserEnvironment({ AVATAR_STORAGE_DIR: 'relative/avatars' }),
    ).toThrow('AVATAR_STORAGE_DIR');
    expect(() =>
      validateUserEnvironment({ AVATAR_STORAGE_DIR: '../escape' }),
    ).toThrow('AVATAR_STORAGE_DIR');
  });

  it('is strict in production: https public URL and an explicit directory', () => {
    const production = {
      NODE_ENV: 'production',
      API_PUBLIC_URL: 'https://api.example.com',
      AVATAR_STORAGE_DIR: '/data/avatars',
    };
    expect(validateUserEnvironment(production).API_PUBLIC_URL).toBe(
      'https://api.example.com',
    );
    expect(() =>
      validateUserEnvironment({ ...production, API_PUBLIC_URL: undefined }),
    ).toThrow('API_PUBLIC_URL');
    expect(() =>
      validateUserEnvironment({
        ...production,
        API_PUBLIC_URL: 'http://api.example.com',
      }),
    ).toThrow('API_PUBLIC_URL');
    expect(() =>
      validateUserEnvironment({ ...production, AVATAR_STORAGE_DIR: undefined }),
    ).toThrow('AVATAR_STORAGE_DIR');
  });

  it('does not echo the invalid input', () => {
    try {
      validateUserEnvironment({
        API_PUBLIC_URL: 'http://secret-marker.example.com/x',
      });
      expect.fail('Expected failure');
    } catch (error) {
      expect(error instanceof Error ? error.message : '').not.toContain(
        'secret-marker',
      );
    }
  });
});
