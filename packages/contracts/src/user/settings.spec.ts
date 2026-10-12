import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, settingsResponseSchema, updateSettingsRequestSchema, userSettingsSchema } from './settings.js';

describe('settings contracts', () => {
  it('is dark by default: the app is dark first', () => {
    expect(DEFAULT_SETTINGS.theme).toBe('dark');
  });

  it('accepts the defaults and real IANA zones', () => {
    expect(userSettingsSchema.safeParse(DEFAULT_SETTINGS).success).toBe(true);
    expect(userSettingsSchema.safeParse({ ...DEFAULT_SETTINGS, timeZone: 'Asia/Ho_Chi_Minh' }).success).toBe(true);
    expect(settingsResponseSchema.safeParse({ settings: DEFAULT_SETTINGS }).success).toBe(true);
  });

  it('rejects unknown zones, locales and themes', () => {
    for (const bad of [{ timeZone: 'Mars/Base' }, { timeZone: '' }, { timeZone: 'x'.repeat(65) }, { locale: 'fr' }, { theme: 'purple' }]) {
      expect(updateSettingsRequestSchema.safeParse(bad).success).toBe(false);
    }
  });

  it('accepts partial updates but not empty or unknown-field ones', () => {
    expect(updateSettingsRequestSchema.safeParse({ theme: 'dark' }).success).toBe(true);
    expect(updateSettingsRequestSchema.safeParse({ locale: 'vi', timeZone: 'UTC' }).success).toBe(true);
    expect(updateSettingsRequestSchema.safeParse({}).success).toBe(false);
    expect(updateSettingsRequestSchema.safeParse({ theme: 'dark', email: 'x' }).success).toBe(false);
  });
});
