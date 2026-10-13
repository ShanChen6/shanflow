export const THEMES = ['system', 'light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];
export type ShownTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'shanflow.theme';
const LIGHT_QUERY = '(prefers-color-scheme: light)';

export function parseTheme(value: string | null): Theme | null {
  return THEMES.find((theme) => theme === value) ?? null;
}

/** What is actually drawn: an explicit choice as it is, "system" following the device. */
export function resolveTheme(theme: Theme, systemPrefersLight: boolean): ShownTheme {
  if (theme === 'system') return systemPrefersLight ? 'light' : 'dark';
  return theme;
}

const systemQuery = () => (typeof window.matchMedia === 'function' ? window.matchMedia(LIGHT_QUERY) : null);

let stopFollowing: (() => void) | undefined;

function show(theme: ShownTheme): void {
  document.documentElement.dataset.theme = theme;
}

/**
 * Shows a theme and remembers the choice on this device (so the next page load can paint it at once, before any request).
 * "system" keeps following the device while the page is open; any other choice stops following.
 */
export function applyTheme(theme: Theme): void {
  stopFollowing?.();
  stopFollowing = undefined;

  const query = systemQuery();
  show(resolveTheme(theme, query?.matches ?? false));
  if (theme === 'system' && query) {
    const onChange = () => show(resolveTheme('system', query.matches));
    query.addEventListener('change', onChange);
    stopFollowing = () => query.removeEventListener('change', onChange);
  }
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Not remembered (storage blocked), but applied.
  }
}

/**
 * Runs in <head> before the first paint. It mirrors `parseTheme`/`resolveTheme` in plain ES5 because it executes outside the
 * bundle: with nothing remembered the theme is dark (dark first); "system" resolves against the device.
 */
export const THEME_BOOT_SCRIPT = `(function(){var t='dark';try{var s=localStorage.getItem('${THEME_STORAGE_KEY}');if(s==='light'||s==='dark')t=s;else if(s==='system'){t=window.matchMedia('${LIGHT_QUERY}').matches?'light':'dark';}}catch(e){}document.documentElement.setAttribute('data-theme',t);})();`;
