import { describe, expect, it } from 'vitest';
import { chooseView } from './view-mode';

describe('chooseView', () => {
  it('honours a remembered choice, on any screen', () => {
    expect(chooseView('focus', true)).toBe('focus');
    expect(chooseView('list', true)).toBe('list');
    expect(chooseView('board', false)).toBe('board');
  });

  it('defaults to the board on a wide screen and to the list on a narrow one', () => {
    expect(chooseView(null, true)).toBe('board');
    expect(chooseView(null, false)).toBe('list');
  });

  it('ignores a remembered value that is not a known view', () => {
    expect(chooseView('kanban', true)).toBe('board');
    expect(chooseView('', false)).toBe('list');
    expect(chooseView('__proto__', true)).toBe('board');
  });
});
