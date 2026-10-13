import {
  AUTH_ERROR_CODES,
  LOCALES,
  THEMES,
  settingsResponseSchema,
  updateSettingsRequestSchema,
  type UpdateSettingsRequest,
  type UserSettings,
} from '@shanflow/contracts';
import { authedGetJson, authedPatchJson } from '@/features/auth/shared/auth-client';

export const LOCALE_LABELS: Record<(typeof LOCALES)[number], string> = { en: 'English', vi: 'Tiếng Việt' };
export const THEME_LABELS: Record<(typeof THEMES)[number], string> = { system: 'Match my device', light: 'Light', dark: 'Dark' };

export type SettingsLoad = { status: 'ready'; settings: UserSettings } | { status: 'error' } | { status: 'signed-out' };
export type SettingsSave = { status: 'saved'; settings: UserSettings } | { status: 'error'; message: string } | { status: 'signed-out' };

export async function loadSettings(): Promise<SettingsLoad> {
  const result = await authedGetJson('/users/me/settings', settingsResponseSchema);
  if (result.ok) return { status: 'ready', settings: result.data.settings };
  return result.kind === 'signed-out' ? { status: 'signed-out' } : { status: 'error' };
}

/** Time zones the browser knows, with UTC first; falls back to a short list on old browsers. */
export function timeZoneOptions(current: string): string[] {
  let zones: string[] = [];
  try {
    zones = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.('timeZone') ?? [];
  } catch {
    zones = [];
  }
  return Array.from(new Set(['UTC', current, ...zones]));
}

export async function saveSettings(changes: UpdateSettingsRequest): Promise<SettingsSave> {
  if (!updateSettingsRequestSchema.safeParse(changes).success) return { status: 'error', message: 'Those settings are not valid.' };
  const result = await authedPatchJson('/users/me/settings', changes, settingsResponseSchema);
  if (result.ok) return { status: 'saved', settings: result.data.settings };
  if (result.kind === 'signed-out') return { status: 'signed-out' };
  if (result.kind === 'problem') {
    if (result.problem.code === AUTH_ERROR_CODES.unauthenticated) return { status: 'signed-out' };
    if (result.problem.code === AUTH_ERROR_CODES.tooManyRequests) return { status: 'error', message: 'Too many changes. Please wait a moment.' };
    if (result.problem.code === AUTH_ERROR_CODES.validationFailed) return { status: 'error', message: 'Those settings are not valid.' };
  }
  return { status: 'error', message: 'Could not save your settings. Check your connection and try again.' };
}
