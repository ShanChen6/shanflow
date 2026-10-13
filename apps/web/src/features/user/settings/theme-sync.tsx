'use client';

import { useEffect } from 'react';
import { applyTheme } from '@/shared/ui/theme';
import { loadSettings } from './settings.action';

/**
 * Applies the signed-in user's saved theme everywhere in the app (the settings page is only one place to change it).
 * The first paint already used the theme remembered on this device; this makes the account's choice win on a new device.
 */
export function ThemeSync() {
  useEffect(() => {
    let active = true;
    void loadSettings().then((result) => {
      if (active && result.status === 'ready') applyTheme(result.settings.theme);
    });
    return () => {
      active = false;
    };
  }, []);
  return null;
}
