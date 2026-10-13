import { describe, expect, it } from 'vitest';
import { buildDatabaseUrl, resolveDatabaseUrls } from './database-url.js';

describe('database URLs derived from individual settings', () => {
  const parts = { POSTGRES_APP_PASSWORD: 'p@ss/w:rd#1', POSTGRES_MIGRATOR_PASSWORD: 'm1gr@tor-secret' };

  it('uses localhost:5432/shanflow by default and percent-encodes credentials', () => {
    expect(buildDatabaseUrl(parts, 'app')).toBe(
      'postgresql://shanflow_app:p%40ss%2Fw%3Ard%231@localhost:5432/shanflow?schema=public',
    );
  });

  it('follows POSTGRES_HOST, POSTGRES_PORT and POSTGRES_DB', () => {
    const url = new URL(
      buildDatabaseUrl({ ...parts, POSTGRES_HOST: 'postgres', POSTGRES_PORT: '6543', POSTGRES_DB: 'shanflow' }, 'migrator')!,
    );
    expect([url.username, url.hostname, url.port, url.pathname]).toEqual(['shanflow_migrator', 'postgres', '6543', '/shanflow']);
  });

  it('brackets IPv6 hosts', () => {
    expect(new URL(buildDatabaseUrl({ ...parts, POSTGRES_HOST: '::1' }, 'app')!).hostname).toBe('[::1]');
  });

  it('is undefined while the role password is missing', () => {
    expect(buildDatabaseUrl({}, 'app')).toBeUndefined();
    expect(buildDatabaseUrl({ POSTGRES_APP_PASSWORD: '  ' }, 'app')).toBeUndefined();
  });

  it('derives the shadow URL on shanflow_shadow with the migrator role', () => {
    expect(new URL(resolveDatabaseUrls(parts).SHADOW_DATABASE_URL!).pathname).toBe('/shanflow_shadow');
  });

  it('lets an explicitly set URL win and treats blank values as unset', () => {
    const explicit = 'postgresql://shanflow_app:x@db.example:5432/shanflow?schema=public';
    expect(resolveDatabaseUrls({ ...parts, DATABASE_URL: explicit }).DATABASE_URL).toBe(explicit);
    expect(resolveDatabaseUrls({ ...parts, DATABASE_URL: '' }).DATABASE_URL).toContain('localhost');
  });
});
