import { describe, expect, it } from 'vitest';
import {
  canChangeAssignee,
  canDeleteOrRestore,
  canTransition,
  completedAtAfter,
  dueAtSchema,
  positionSchema,
  taskDescriptionSchema,
  taskTitleSchema,
  type TaskStatus,
} from './task.js';

describe('task fields', () => {
  it('normalises titles and rejects blank, long and hidden-character ones', () => {
    expect(taskTitleSchema.parse('  Café ')).toBe('Café');
    for (const bad of ['', '  ', 'x'.repeat(201), 'a\nb', 'a‮b']) expect(taskTitleSchema.safeParse(bad).success).toBe(false);
  });

  it('allows line breaks in descriptions, turns blank into null, rejects control characters', () => {
    expect(taskDescriptionSchema.parse(' a\nb ')).toBe('a\nb');
    expect(taskDescriptionSchema.parse('   ')).toBeNull();
    expect(taskDescriptionSchema.safeParse('a\u0000b').success).toBe(false);
    expect(taskDescriptionSchema.safeParse('x'.repeat(10_001)).success).toBe(false);
  });

  it('requires an explicit offset on deadlines and answers in UTC', () => {
    expect(dueAtSchema.parse('2026-10-12T09:00:00+07:00')).toBe('2026-10-12T02:00:00.000Z');
    expect(dueAtSchema.parse('2026-10-12T02:00:00Z')).toBe('2026-10-12T02:00:00.000Z');
    for (const bad of ['2026-10-12', '2026-10-12T09:00:00', 'tomorrow']) expect(dueAtSchema.safeParse(bad).success).toBe(false);
  });

  it('accepts positions up to int64 as strings only', () => {
    for (const ok of ['0', '1024', '9223372036854775807']) expect(positionSchema.safeParse(ok).success).toBe(true);
    for (const bad of ['-1', '01', '1.5', '', 'abc', '99999999999999999999']) expect(positionSchema.safeParse(bad).success).toBe(false);
    expect(positionSchema.safeParse(1024).success).toBe(false);
  });
});

describe('status transitions', () => {
  const all: TaskStatus[] = ['TODO', 'IN_PROGRESS', 'DONE', 'CANCELED'];

  it('follows the approved graph', () => {
    for (const from of ['TODO', 'IN_PROGRESS', 'DONE'] as const) for (const to of all) expect(canTransition(from, to)).toBe(true);
    expect(canTransition('CANCELED', 'TODO')).toBe(true);
    expect(canTransition('CANCELED', 'CANCELED')).toBe(true);
    expect(canTransition('CANCELED', 'IN_PROGRESS')).toBe(false);
    expect(canTransition('CANCELED', 'DONE')).toBe(false);
  });

  it('sets completedAt on entering DONE, keeps it while DONE, clears it otherwise', () => {
    const now = new Date('2026-10-12T10:00:00Z');
    const earlier = new Date('2026-10-01T10:00:00Z');
    expect(completedAtAfter('TODO', 'DONE', null, now)).toEqual(now);
    expect(completedAtAfter('IN_PROGRESS', 'DONE', null, now)).toEqual(now);
    expect(completedAtAfter('DONE', 'DONE', earlier, now)).toEqual(earlier);
    expect(completedAtAfter('DONE', 'TODO', earlier, now)).toBeNull();
    expect(completedAtAfter('DONE', 'CANCELED', earlier, now)).toBeNull();
    expect(completedAtAfter('TODO', 'IN_PROGRESS', null, now)).toBeNull();
    // reopening then completing again gives a new timestamp
    expect(completedAtAfter('TODO', 'DONE', null, now)).toEqual(now);
  });
});

describe('task permission policy', () => {
  const me = '1c2f7a4e-3c1d-4a6e-9b6a-2f1c8d0e5a22';
  const other = '2d3f7a4e-3c1d-4a6e-9b6a-2f1c8d0e5a33';

  it('lets managers delete/restore any task and members only their own', () => {
    expect(canDeleteOrRestore({ role: 'OWNER', userId: me }, { createdById: other, assigneeId: null })).toBe(true);
    expect(canDeleteOrRestore({ role: 'ADMIN', userId: me }, { createdById: other, assigneeId: null })).toBe(true);
    expect(canDeleteOrRestore({ role: 'MEMBER', userId: me }, { createdById: me, assigneeId: null })).toBe(true);
    expect(canDeleteOrRestore({ role: 'MEMBER', userId: me }, { createdById: other, assigneeId: me })).toBe(false); // assignee is not enough
  });

  it('lets managers assign anyone and members only self-assign an unassigned task or clear their own', () => {
    const manager = { role: 'ADMIN', userId: me } as const;
    const member = { role: 'MEMBER', userId: me } as const;
    expect(canChangeAssignee(manager, other, null)).toBe(true);
    expect(canChangeAssignee(manager, null, other)).toBe(true);
    expect(canChangeAssignee(member, null, me)).toBe(true);
    expect(canChangeAssignee(member, me, null)).toBe(true);
    expect(canChangeAssignee(member, other, me)).toBe(false); // cannot take another's task
    expect(canChangeAssignee(member, null, other)).toBe(false); // cannot assign someone else
    expect(canChangeAssignee(member, other, null)).toBe(false); // cannot clear another's assignment
    expect(canChangeAssignee(member, other, other)).toBe(true); // unchanged is not a change
  });
});
