'use client';

import { useEffect, useState, type ChangeEvent } from 'react';
import { LOCALES, THEMES, type UserSettings } from '@shanflow/contracts';
import { FormAlert } from '@/shared/ui/form-controls';
import { LOCALE_LABELS, THEME_LABELS, loadSettings, saveSettings, timeZoneOptions } from './settings.action';

const selectClass = 'w-full rounded-md border border-slate-300 px-3 py-2 text-base focus:border-slate-900 focus:outline-none';

/** Remembers the choice for the page; full dark styling is a later step, so only the browser's colour scheme follows it. */
function applyTheme(theme: UserSettings['theme']) {
  document.documentElement.style.colorScheme = theme === 'system' ? '' : theme;
}

export function SettingsView() {
  const [settings, setSettings] = useState<UserSettings>();
  const [loadFailed, setLoadFailed] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let active = true;
    void loadSettings().then((result) => {
      if (!active) return;
      if (result.status === 'ready') {
        setSettings(result.settings);
        applyTheme(result.settings.theme);
      } else setLoadFailed(true);
    });
    return () => {
      active = false;
    };
  }, []);

  if (loadFailed) {
    return (
      <p role="alert" className="text-red-700">
        Could not load your settings. Please reload the page.
      </p>
    );
  }
  if (!settings) {
    return (
      <p role="status" className="text-slate-600">
        Loading…
      </p>
    );
  }

  // Each control saves on change: a single preference per request, so a failure never loses the others.
  async function change(field: keyof UserSettings, value: string) {
    if (pending || !settings) return;
    setPending(true);
    setError(undefined);
    setSaved(false);
    try {
      const outcome = await saveSettings({ [field]: value } as Partial<UserSettings>);
      if (outcome.status === 'saved') {
        setSettings(outcome.settings);
        applyTheme(outcome.settings.theme);
        setSaved(true);
      } else if (outcome.status === 'error') setError(outcome.message);
    } finally {
      setPending(false);
    }
  }
  const onSelect = (field: keyof UserSettings) => (event: ChangeEvent<HTMLSelectElement>) => void change(field, event.currentTarget.value);

  return (
    <div className="flex max-w-sm flex-col gap-4">
      <h1 className="text-2xl font-bold">Settings</h1>
      {saved ? (
        <p role="status" className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-900">
          Saved.
        </p>
      ) : null}
      {error ? <FormAlert>{error}</FormAlert> : null}
      <div>
        <label htmlFor="locale" className="mb-1 block text-sm font-medium">
          Language
        </label>
        <select id="locale" value={settings.locale} disabled={pending} onChange={onSelect('locale')} className={selectClass}>
          {LOCALES.map((locale) => (
            <option key={locale} value={locale}>
              {LOCALE_LABELS[locale]}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="timeZone" className="mb-1 block text-sm font-medium">
          Time zone
        </label>
        <select id="timeZone" value={settings.timeZone} disabled={pending} onChange={onSelect('timeZone')} className={selectClass}>
          {timeZoneOptions(settings.timeZone).map((zone) => (
            <option key={zone} value={zone}>
              {zone}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="theme" className="mb-1 block text-sm font-medium">
          Appearance
        </label>
        <select id="theme" value={settings.theme} disabled={pending} onChange={onSelect('theme')} className={selectClass}>
          {THEMES.map((theme) => (
            <option key={theme} value={theme}>
              {THEME_LABELS[theme]}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
