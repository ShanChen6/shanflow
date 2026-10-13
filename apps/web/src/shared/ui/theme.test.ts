import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { THEME_BOOT_SCRIPT, applyTheme, parseTheme, resolveTheme } from './theme';

/** A controllable stand-in for the OS colour-scheme preference. */
function fakeSystem(prefersLight: boolean) {
  const listeners = new Set<() => void>();
  const state = { prefersLight };
  vi.stubGlobal('matchMedia', () => ({
    get matches() {
      return state.prefersLight;
    },
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
  }));
  return {
    change(next: boolean) {
      state.prefersLight = next;
      listeners.forEach((fn) => fn());
    },
    listenerCount: () => listeners.size,
  };
}
const shown = () => document.documentElement.dataset.theme;

beforeEach(() => {
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
});
afterEach(() => vi.unstubAllGlobals());

describe('resolveTheme', () => {
  it('uses an explicit choice as it is, and follows the device for "system"', () => {
    expect(resolveTheme('dark', true)).toBe('dark');
    expect(resolveTheme('light', false)).toBe('light');
    expect(resolveTheme('system', true)).toBe('light');
    expect(resolveTheme('system', false)).toBe('dark');
  });
});

describe('parseTheme', () => {
  it('accepts the three themes and nothing else', () => {
    expect(parseTheme('system')).toBe('system');
    expect(parseTheme('light')).toBe('light');
    expect(parseTheme('dark')).toBe('dark');
    for (const bad of [null, '', 'Dark', 'purple', '__proto__']) expect(parseTheme(bad)).toBeNull();
  });
});

describe('applyTheme', () => {
  it('shows the chosen theme and remembers the choice for the next page load', () => {
    fakeSystem(false);
    applyTheme('light');
    expect(shown()).toBe('light');
    expect(window.localStorage.getItem('shanflow.theme')).toBe('light');
    applyTheme('dark');
    expect(shown()).toBe('dark');
  });

  it('follows the device for "system", live, and stops following once a theme is chosen', () => {
    const system = fakeSystem(false);
    applyTheme('system');
    expect(shown()).toBe('dark');
    system.change(true);
    expect(shown()).toBe('light'); // the OS switched while the page was open
    applyTheme('dark');
    expect(system.listenerCount()).toBe(0);
    system.change(true);
    expect(shown()).toBe('dark'); // no longer following
  });

  it('never stacks listeners when "system" is applied repeatedly', () => {
    const system = fakeSystem(false);
    applyTheme('system');
    applyTheme('system');
    applyTheme('system');
    expect(system.listenerCount()).toBe(1);
  });

  it('still shows the theme when browser storage is blocked', () => {
    fakeSystem(false);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => applyTheme('light')).not.toThrow();
    expect(shown()).toBe('light');
    vi.restoreAllMocks();
  });
});

describe('the boot script (runs before the page paints, so there is no flash)', () => {
  const run = () => new Function(THEME_BOOT_SCRIPT)();

  it('is dark when nothing was ever chosen: dark first', () => {
    fakeSystem(true); // even on a light device
    run();
    expect(shown()).toBe('dark');
  });

  it('applies the remembered choice, resolving "system" against the device', () => {
    fakeSystem(true);
    window.localStorage.setItem('shanflow.theme', 'light');
    run();
    expect(shown()).toBe('light');
    window.localStorage.setItem('shanflow.theme', 'system');
    run();
    expect(shown()).toBe('light');
    fakeSystem(false);
    run();
    expect(shown()).toBe('dark');
  });

  it('ignores a remembered value it does not know, and survives blocked storage', () => {
    fakeSystem(true);
    window.localStorage.setItem('shanflow.theme', 'purple');
    run();
    expect(shown()).toBe('dark');
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(run).not.toThrow();
    expect(shown()).toBe('dark');
    vi.restoreAllMocks();
  });
});
