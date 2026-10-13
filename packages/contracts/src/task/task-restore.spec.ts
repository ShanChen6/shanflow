import { describe, expect, it } from 'vitest';
import { listTrashQuerySchema, restoreTaskRequestSchema, trashResponseSchema } from './task-lifecycle.js';

const id = '0b1f7a4e-3c1d-4a6e-9b6a-2f1c8d0e5a11';
const now = '2026-10-12T00:00:00.000Z';

describe('restoreTaskRequestSchema', () => {
  it('needs only the version of the deleted task', () => {
    expect(restoreTaskRequestSchema.parse({ version: 2 })).toEqual({ version: 2 });
  });

  it('rejects a missing or bad version and anything the server decides itself', () => {
    for (const bad of [
      {},
      { version: 0 },
      { version: '2' },
      { version: 1.5 },
      { version: 1, position: '1024' },
      { version: 1, deletedAt: null },
      { version: 1, status: 'TODO' },
      { version: 1, projectId: null },
      { version: 1, assigneeId: id },
    ]) {
      expect(restoreTaskRequestSchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe('listTrashQuerySchema', () => {
  it('has a safe default and parses the limit from a query string', () => {
    expect(listTrashQuerySchema.parse({})).toEqual({ limit: 50 });
    expect(listTrashQuerySchema.parse({ limit: '10' })).toEqual({ limit: 10 });
  });

  it('rejects out-of-range limits and unknown parameters', () => {
    for (const bad of [{ limit: '0' }, { limit: '101' }, { limit: 'x' }, { status: 'TODO' }, { includeLive: '1' }]) {
      expect(listTrashQuerySchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe('trashResponseSchema', () => {
  it('lists tombstones, which carry deletedAt', () => {
    const task = {
      id, workspaceId: id, projectId: null, title: 't', description: null, status: 'TODO', priority: 'MEDIUM', dueAt: null,
      assigneeId: null, createdById: id, position: '1024', version: 2, completedAt: null, deletedAt: now, createdAt: now, updatedAt: now,
    };
    expect(trashResponseSchema.safeParse({ tasks: [task] }).success).toBe(true);
    expect(trashResponseSchema.safeParse({ tasks: [{ ...task, position: 1024 }] }).success).toBe(false);
  });
});
