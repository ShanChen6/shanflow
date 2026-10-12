'use client';

import { useCallback, useState } from 'react';

export const VIEWS = ['board', 'list', 'focus'] as const;
export type View = (typeof VIEWS)[number];

export const VIEW_LABELS: Record<View, string> = { board: 'Board', list: 'List', focus: 'Focus' };

const STORAGE_KEY = 'shanflow.tasks.view';
/** Wide enough for four columns side by side. */
const WIDE_QUERY = '(min-width: 1024px)';

/** A remembered choice wins; otherwise the board on a wide screen and the list on a narrow one. */
export function chooseView(stored: string | null, wide: boolean): View {
  const remembered = VIEWS.find((view) => view === stored);
  return remembered ?? (wide ? 'board' : 'list');
}

function isWideScreen(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(WIDE_QUERY).matches;
}

function readStored(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null; // storage can be blocked; the screen must work without it
  }
}

/** The view the user last picked on this device (a per-viewer convenience, so browser storage is the right place). */
export function useViewMode(): [View, (view: View) => void] {
  const [view, setView] = useState<View>(() => chooseView(readStored(), isWideScreen()));
  const choose = useCallback((next: View) => {
    setView(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // not remembered, still applied
    }
  }, []);
  return [view, choose];
}
