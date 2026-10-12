import { z } from 'zod';

export const LOCALES = ['en', 'vi'] as const;
export const THEMES = ['system', 'light', 'dark'] as const;

export const DEFAULT_SETTINGS = { locale: 'en', timeZone: 'UTC', theme: 'dark' } as const;

function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** An IANA time zone such as `Asia/Ho_Chi_Minh` or `UTC`. */
export const timeZoneSchema = z
  .string()
  .max(64)
  .refine(isTimeZone, 'Unknown time zone');

export const userSettingsSchema = z.object({
  locale: z.enum(LOCALES),
  timeZone: timeZoneSchema,
  theme: z.enum(THEMES),
});

/** Partial update: at least one known field; unknown fields are an error rather than silently ignored. */
export const updateSettingsRequestSchema = userSettingsSchema
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'Provide at least one setting');

export const settingsResponseSchema = z.object({ settings: userSettingsSchema });

export type UserSettings = z.infer<typeof userSettingsSchema>;
export type UpdateSettingsRequest = z.infer<typeof updateSettingsRequestSchema>;
export type SettingsResponse = z.infer<typeof settingsResponseSchema>;
