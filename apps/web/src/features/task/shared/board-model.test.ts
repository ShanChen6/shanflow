import type { Task } from '@shanflow/contracts';
import { describe, expect, it } from 'vitest';
import { assigneeChoices, dropPlacement, fromDateTimeLocalValue, groupByStatus, isOverdue, stepPlacement, toDateTimeLocalValue } from './board-model';

const task = (id: string, status: Task['status'], position: string, extra: Partial<Task> = {}): Task => ({
  id,
  workspaceId: 'w',
  projectId: null,
  title: id,
  description: null,
  status,
  priority: 'MEDIUM',
  dueAt: null,
  assigneeId: null,
  createdById: 'u',
  position,
  version: 1,
  completedAt: null,
  deletedAt: null,
  createdAt: '2026-10-12T00:00:00.000Z',
  updatedAt: '2026-10-12T00:00:00.000Z',
  ...extra,
});

describe('groupByStatus', () => {
  it('puts tasks in their column in rank order, comparing ranks as numbers, not text', () => {
    const columns = groupByStatus([task('c', 'TODO', '10240'), task('a', 'TODO', '1024'), task('d', 'DONE', '2048'), task('b', 'TODO', '2048')]);
    expect(columns.TODO.map((t) => t.id)).toEqual(['a', 'b', 'c']); // text order would put '10240' before '2048'
    expect(columns.DONE.map((t) => t.id)).toEqual(['d']);
    expect(columns.IN_PROGRESS).toEqual([]);
    expect(columns.CANCELED).toEqual([]);
  });

  it('compares 64-bit ranks without losing precision', () => {
    const big = groupByStatus([task('y', 'TODO', '9223372036854775807'), task('x', 'TODO', '9223372036854775806')]);
    expect(big.TODO.map((t) => t.id)).toEqual(['x', 'y']);
  });

  it('breaks ties by id so the order is always the same', () => {
    expect(groupByStatus([task('b', 'TODO', '5'), task('a', 'TODO', '5')]).TODO.map((t) => t.id)).toEqual(['a', 'b']);
  });
});

describe('dropPlacement', () => {
  const column = [task('a', 'TODO', '1'), task('b', 'TODO', '2'), task('c', 'TODO', '3')];

  it('names the task the card lands in front of, or nothing for the end of the column', () => {
    expect(dropPlacement(column, 'x', 0)).toEqual({ beforeId: 'a' });
    expect(dropPlacement(column, 'x', 2)).toEqual({ beforeId: 'c' });
    expect(dropPlacement(column, 'x', 3)).toEqual({});
    expect(dropPlacement([], 'x', 0)).toEqual({});
  });

  it('ignores the dragged card itself when counting positions inside its own column', () => {
    // Dragging "a" to the slot after "b": the others are [b, c], slot index 1 is in front of "c".
    expect(dropPlacement(column, 'a', 1)).toEqual({ beforeId: 'c' });
    expect(dropPlacement(column, 'a', 2)).toEqual({});
  });

  it('clamps a slot that is out of range to the end', () => {
    expect(dropPlacement(column, 'x', 99)).toEqual({});
    expect(dropPlacement(column, 'x', -5)).toEqual({ beforeId: 'a' });
  });
});

describe('stepPlacement (keyboard-friendly reordering)', () => {
  const column = [task('a', 'TODO', '1'), task('b', 'TODO', '2'), task('c', 'TODO', '3')];

  it('moves a card one place up or down by naming its new neighbour', () => {
    expect(stepPlacement(column, 'b', 'up')).toEqual({ beforeId: 'a' });
    expect(stepPlacement(column, 'b', 'down')).toEqual({ afterId: 'c' });
  });

  it('does nothing at the ends of the column or for an unknown card', () => {
    expect(stepPlacement(column, 'a', 'up')).toBeNull();
    expect(stepPlacement(column, 'c', 'down')).toBeNull();
    expect(stepPlacement(column, 'zzz', 'up')).toBeNull();
  });
});

describe('isOverdue', () => {
  const now = new Date('2026-10-12T12:00:00.000Z');

  it('is true only for open tasks whose deadline has passed', () => {
    expect(isOverdue(task('a', 'TODO', '1', { dueAt: '2026-10-12T11:59:59.000Z' }), now)).toBe(true);
    expect(isOverdue(task('a', 'IN_PROGRESS', '1', { dueAt: '2020-01-01T00:00:00.000Z' }), now)).toBe(true);
    expect(isOverdue(task('a', 'TODO', '1', { dueAt: '2026-10-12T12:00:01.000Z' }), now)).toBe(false);
    expect(isOverdue(task('a', 'TODO', '1'), now)).toBe(false);
  });

  it('never flags a finished or cancelled task', () => {
    expect(isOverdue(task('a', 'DONE', '1', { dueAt: '2020-01-01T00:00:00.000Z' }), now)).toBe(false);
    expect(isOverdue(task('a', 'CANCELED', '1', { dueAt: '2020-01-01T00:00:00.000Z' }), now)).toBe(false);
  });
});

describe('deadline input conversion', () => {
  it('shows a stored instant as the local value of a datetime-local input and gets the same instant back', () => {
    const iso = '2026-10-12T02:30:00.000Z';
    const local = toDateTimeLocalValue(iso);
    expect(local).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    expect(fromDateTimeLocalValue(local)).toBe(iso);
  });

  it('treats an empty input as no deadline, and a missing deadline as an empty input', () => {
    expect(fromDateTimeLocalValue('')).toBeNull();
    expect(fromDateTimeLocalValue('   ')).toBeNull();
    expect(toDateTimeLocalValue(null)).toBe('');
  });

  it('answers null for text that is not a date, instead of sending nonsense', () => {
    expect(fromDateTimeLocalValue('not a date')).toBeNull();
    expect(fromDateTimeLocalValue('2026-13-45T99:99')).toBeNull();
  });
});

describe('assigneeChoices', () => {
  const members = [
    { userId: 'me', displayName: 'Me', role: 'MEMBER' as const, joinedAt: '2026-10-12T00:00:00.000Z' },
    { userId: 'olive', displayName: 'Olive', role: 'ADMIN' as const, joinedAt: '2026-10-12T00:00:00.000Z' },
  ];
  const free = task('t', 'TODO', '1');
  const held = task('t', 'TODO', '1', { assigneeId: 'olive' });
  const mine = task('t', 'TODO', '1', { assigneeId: 'me' });

  it('lets a manager pick anybody, or nobody', () => {
    const choices = assigneeChoices({ role: 'ADMIN', userId: 'olive' }, held, members);
    expect(choices).toEqual([
      { value: '', label: 'Unassigned', disabled: false },
      { value: 'me', label: 'Me', disabled: false },
      { value: 'olive', label: 'Olive', disabled: false },
    ]);
  });

  it('lets a plain member take a free task, but nothing else on it', () => {
    const byValue = Object.fromEntries(assigneeChoices({ role: 'MEMBER', userId: 'me' }, free, members).map((c) => [c.value, c.disabled]));
    expect(byValue).toEqual({ '': false, me: false, olive: true });
  });

  it('freezes a task held by somebody else for a plain member (cannot take it over or clear it)', () => {
    const choices = assigneeChoices({ role: 'MEMBER', userId: 'me' }, held, members);
    expect(choices.filter((c) => !c.disabled).map((c) => c.value)).toEqual(['olive']); // only "unchanged" stays selectable
  });

  it('lets a plain member give up their own task, but not hand it to someone else', () => {
    const choices = assigneeChoices({ role: 'MEMBER', userId: 'me' }, mine, members);
    expect(choices.filter((c) => !c.disabled).map((c) => c.value)).toEqual(['', 'me']);
  });
});
