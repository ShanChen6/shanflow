import { describe, expect, it } from 'vitest';
import { moveTaskRequestSchema, moveTaskResponseSchema } from './task-lifecycle.js';

const a = '0b1f7a4e-3c1d-4a6e-9b6a-2f1c8d0e5a11';
const b = '1c2f7a4e-3c1d-4a6e-9b6a-2f1c8d0e5a22';

describe('moveTaskRequestSchema', () => {
  it('needs only the version: the task goes to the end of its own lane', () => {
    expect(moveTaskRequestSchema.parse({ version: 3 })).toEqual({ version: 3 });
  });

  it('names where to put the task by a neighbour, never by a rank', () => {
    expect(moveTaskRequestSchema.parse({ version: 1, beforeId: a })).toEqual({ version: 1, beforeId: a });
    expect(moveTaskRequestSchema.parse({ version: 1, afterId: b })).toEqual({ version: 1, afterId: b });
  });

  it('moves to a project or to Inbox (null), and keeps the project when it is omitted', () => {
    expect(moveTaskRequestSchema.parse({ version: 1, projectId: a })).toEqual({ version: 1, projectId: a });
    expect(moveTaskRequestSchema.parse({ version: 1, projectId: null, afterId: b })).toEqual({ version: 1, projectId: null, afterId: b });
  });

  it('cannot say both before and after', () => {
    expect(moveTaskRequestSchema.safeParse({ version: 1, beforeId: a, afterId: b }).success).toBe(false);
  });

  it('rejects ranks, statuses, ids that are not ids, a bad version and any other field', () => {
    for (const bad of [
      {},
      { version: 0 },
      { version: '1' },
      { version: 1, position: '1024' },
      { version: 1, position: 1024 },
      { version: 1, status: 'DONE' },
      { version: 1, beforeId: 'first' },
      { version: 1, afterId: '' },
      { version: 1, beforeId: null },
      { version: 1, projectId: 'inbox' },
      { version: 1, workspaceId: a },
    ]) {
      expect(moveTaskRequestSchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe('moveTaskResponseSchema', () => {
  it('carries the task and whether the lane had to be renumbered', () => {
    const task = {
      id: a, workspaceId: a, projectId: null, title: 't', description: null, status: 'TODO', priority: 'MEDIUM', dueAt: null, assigneeId: null,
      createdById: a, position: '1024', version: 2, completedAt: null, deletedAt: null, createdAt: '2026-10-12T00:00:00.000Z', updatedAt: '2026-10-12T00:00:00.000Z',
    };
    expect(moveTaskResponseSchema.safeParse({ task, laneRebalanced: false }).success).toBe(true);
    expect(moveTaskResponseSchema.safeParse({ task }).success).toBe(false);
  });
});
